import { completeToolCall } from "./tool-inputs.ts";
import { registerManagementTool } from "../../runtime-tasks/tools.ts";
import "./source-loader.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import vm from "node:vm";
import { WORKER_SOURCE } from "../src/workflow/worker-source.ts";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createRuntimeTaskFacade, type RuntimeTaskCapability } from "../../runtime-tasks/facade.ts";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import { observeWorkflowControl } from "./source-loader.mjs";
import type { WorkflowTask } from "../src/workflow/task.ts";
import type { NotificationDetails } from "../src/types.ts";
const { default: agentTasks } = await import("../src/index.ts");

/** Actual extension, coordinator, worker and management tools; no provider or personal state. */
async function harness() {
    // Validate the requested template-source escape boundary before the host can
    // launch any real worker, not merely in the standalone worker suite.
    new vm.Script(WORKER_SOURCE, { filename: "workflow-worker.js" });
    const root = mkdtempSync(join(tmpdir(), "workflow-failure-host-"));
    const config = join(root, "agent"); mkdirSync(config);
    writeFileSync(join(config, "agent-tasks.json"), JSON.stringify({ workflowsEnabled: true }));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = config;
    const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
    const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
    const tasks = new Map<string, WorkflowTask>();
    const unobserve = observeWorkflowControl((task: WorkflowTask) => tasks.set(task.id, task));
    let deliver!: (message: { content: unknown; details: NotificationDetails }) => void;
    const notice = new Promise<{ content: unknown; details: NotificationDetails }>(resolve => { deliver = resolve; });
    const pi = {
        registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { tools.set(tool.name, tool); },
        registerMessageRenderer() {}, registerEntryRenderer() {}, registerFlag() {}, registerCommand() {},
        on(name: string, handler: (...args: unknown[]) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
        events: { on() { return () => {}; }, emit() {} }, appendEntry() {},
        sendMessage: deliver, getFlag() {}, getAllTools: () => [], getActiveTools: () => [],
    } as unknown as ExtensionAPI;
    const coordinator = new TaskCoordinator(), lifecycle = new TaskLifecycle(coordinator);
    const capabilities: RuntimeTaskCapability[] = [];
    agentTasks(pi, { coordinator, lifecycle, onManagement: capability => capabilities.push(capability),
        managerDependencies: { runAgent: async () => { throw new Error("No provider is allowed in these scripts"); } },
    });
    const facade = createRuntimeTaskFacade(capabilities); lifecycle.onClose(facade.close);
    registerManagementTool(pi, "agent", capabilities);
    const ctx = { cwd: root, hasUI: false, mode: "print", ui: { setWidget() {}, setStatus() {}, notify() {} },
        sessionManager: { getSessionId: () => "workflow-failure-test", getBranch: () => [] }, modelRegistry: {},
    } as unknown as ExtensionToolContext;
    await handlers.get("session_start")![0]!(undefined, ctx);
    return {
        tasks, notice, root,
        execute: (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("failure-host-call", completeToolCall(tools.get(name)!.parameters, params), undefined, undefined, ctx),
        async close() {
            try { await lifecycle.shutdown(); }
            finally {
                coordinator.dispose(); unobserve();
                if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
                rmSync(root, { recursive: true, force: true });
            }
        },
    };
}

function resultText(result: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["execute"]>>): string {
    return result.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
}

for (const construct of ["parallel", "pipeline"]) void it(`registered ${construct} failure diagnostics survive long values in notice, preview, terminal and management output`, { timeout: 10_000 }, async () => {
    const h = await harness();
    try {
        const call = construct === "parallel" ? 'await parallel([() => { throw new Error("thunk failed distinctly"); }]);'
            : 'await pipeline([1], () => { throw new Error("stage failed distinctly"); });';
        const launched = await h.execute("subagent_workflow", { script: `export const meta = { name: "Failure host", description: "offline" }; phase("Check"); ${call} return "value".repeat(2000);` });
        const id = (launched.details as { taskId: string }).taskId;
        const notice = await h.notice;
        const task = h.tasks.get(id)!;
        assert.ok(task); assert.equal(task.status, "completed"); assert.equal(task.value, "value".repeat(2000));
        const reason = construct === "parallel" ? /Check.*parallel\(\) branch 0.*thunk failed distinctly/ : /Check.*pipeline\(\) item 0 stage 0.*stage failed distinctly/;
        for (const text of [String(notice.content), notice.details.resultPreview, (await task.terminal).text, resultText(await h.execute("agent_manage", { action: "output", execution_id: id })), resultText(await h.execute("agent_manage", { action: "wait", execution_id: id }))]) {
            assert.match(text, /Tolerated failures \(1\)/);
            assert.match(text, reason);
        }
        assert.match(String(notice.content), /truncated/);
        assert.equal(notice.details.resultPreview.length, 501, "actual host preview limit is exercised");
    } finally { await h.close(); }
});

void it("registered workflow author failure appears in terminal, notification and management without spawning", { timeout: 10_000 }, async () => {
    const h = await harness();
    try {
        const launched = await h.execute("subagent_workflow", { script: 'export const meta = { name: "Author host", description: "offline" }; return await parallel([() => agent(" ")]);' });
        const id = (launched.details as { taskId: string }).taskId;
        const notice = await h.notice, task = h.tasks.get(id)!;
        assert.equal(task.status, "failed"); assert.equal(task.agentCount, 0); assert.equal(task.value, undefined);
        for (const text of [String(notice.content), notice.details.resultPreview, (await task.terminal).text, resultText(await h.execute("agent_manage", { action: "output", execution_id: id }))]) {
            assert.match(text, /agent\(prompt\).*non-empty string/);
        }
    } finally { await h.close(); }
});

for (const syntax of [false, true]) void it(`registered nested ${syntax ? "syntax" : "missing reference"} fails visibly instead of becoming a tolerant null`, { timeout: 10_000 }, async () => {
    const h = await harness();
    try {
        const scriptPath = join(h.root, "child.workflow.js");
        if (syntax) writeFileSync(scriptPath, 'export const meta = { name: "Child", description: "offline" }; return (;');
        const launched = await h.execute("subagent_workflow", { script: `export const meta = { name: "Nested author", description: "offline" }; return await pipeline([1], () => workflow({ scriptPath: ${JSON.stringify(scriptPath)} }));` });
        const id = (launched.details as { taskId: string }).taskId;
        const notice = await h.notice, task = h.tasks.get(id)!;
        assert.equal(task.status, "failed"); assert.equal(task.agentCount, 0); assert.equal(task.value, undefined);
        for (const text of [String(notice.content), notice.details.resultPreview, (await task.terminal).text, resultText(await h.execute("agent_manage", { action: "output", execution_id: id }))]) {
            assert.match(text, /workflow\(/);
            assert.match(text, syntax ? /Unexpected token|SyntaxError/ : /not found|ENOENT|cannot|could not/i);
            assert.doesNotMatch(text, /Tolerated failures/);
        }
    } finally { await h.close(); }
});
