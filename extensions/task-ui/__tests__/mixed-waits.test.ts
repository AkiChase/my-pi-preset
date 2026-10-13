import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { AgentSession, ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import "../../agent-tasks/__tests__/source-loader.mjs";
import { TaskCoordinator } from "../coordinator.ts";
import { TaskPanel } from "../panel.ts";
import { DEFAULTS as UI_DEFAULTS } from "../config.ts";
import { BackgroundRegistry } from "../../process-tasks/state.ts";
import { DEFAULTS } from "../../process-tasks/config.ts";
import { registerBashTool } from "../../process-tasks/tools/bash.ts";
import { registerJobsTool } from "../../process-tasks/tools/jobs.ts";
import { terminateJobSilently } from "../../process-tasks/lifecycle.ts";
import { stopSidebarTicker } from "../../process-tasks/registry.ts";
import { processExists } from "../../process-tasks/spawn.ts";
import { createProcessTaskSource } from "../../process-tasks/source.ts";
import type { AgentManagerDependencies } from "../../agent-tasks/src/agent-manager.ts";
import type { RunResult } from "../../agent-tasks/src/agent-runner.ts";
const { AgentManager } = await import("../../agent-tasks/src/agent-manager.ts");
const { registerAgentWait } = await import("../../agent-tasks/src/waits.ts");
const { createAgentTaskSource } = await import("../../agent-tasks/src/source.ts");

void it("one shared /bg releases mixed shell/agent launch and retrieval waits without replacing execution", { timeout: 10_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "mixed-task-waits-"));
    const coordinator = new TaskCoordinator();
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir }, coordinator);
    const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
    const messages: unknown[] = [];
    // These partial SDK surfaces are the offline boundary; no host/model session is started.
    const pi = { registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => tools.set(tool.name, tool),
        sendMessage: (message: unknown) => messages.push(message) } as unknown as ExtensionAPI;
    const ctx = { cwd: dir, ui: { notify() {}, setWidget() {}, setStatus() {}, theme: { fg: (_color: string, text: string) => text } } } as unknown as ExtensionToolContext;
    const session = { messages: [], sessionManager: { getSessionFile: () => undefined },
        dispose() {}, subscribe: () => () => {}, getContextUsage: () => undefined } as unknown as AgentSession;
    let finish!: (result: RunResult) => void;
    const terminal = new Promise<RunResult>(resolve => { finish = resolve; });
    let starts = 0;
    let backendSignal: AbortSignal | undefined;
    const dependencies: AgentManagerDependencies = {
        runAgent: async (_ctx, _type, _prompt, options) => {
            starts++;
            backendSignal = options.signal;
            queueMicrotask(() => options.onSessionCreated?.(session));
            return terminal;
        },
    };
    const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, dependencies);
    const processSource = createProcessTaskSource(reg);
    const agentSource = createAgentTaskSource(manager, coordinator, new Map());
    const offProcess = coordinator.registerSource(processSource);
    const offAgent = coordinator.registerSource(agentSource);
    registerBashTool(pi, reg, {} as Parameters<typeof registerBashTool>[2]);
    registerJobsTool(pi, reg);
    try {
        const shellParent = new AbortController(), agentParent = new AbortController();
        const shellLaunch = tools.get("bash")!.execute("mixed-shell", { command: "printf 'shell-before\\n'; tail -f /dev/null" }, shellParent.signal, undefined, ctx);
        const job = [...reg.jobs.values()][0]!;
        const id = manager.spawn(pi, ctx as ExtensionContext, "general-purpose", "mixed agent", {
            description: "mixed agent", isBackground: false, blocking: true, signal: agentParent.signal,
        });
        const run = manager.getRun(id)!;
        const agentLaunch = registerAgentWait(manager, coordinator, run, "launch", agentParent.signal);
        const shellRetrieval = tools.get("jobs")!.execute("mixed-shell-retrieval", { action: "attach", jobId: job.id }, undefined, undefined, ctx);
        const agentRetrieval = registerAgentWait(manager, coordinator, run, "retrieval");
        const before = coordinator.list();
        assert.equal(before.length, 2);
        assert.equal(coordinator.waitCount, 4);
        assert.ok(before.every(task => task.executionMode === "foreground" && task.waitCount === 2));
        const panelArgs = { coordinator, config: UI_DEFAULTS, ctx,
            theme: { fg: (_color: string, text: string) => text }, keys: { matches: () => false },
            tui: { terminal: { rows: 40 }, requestRender() {} } as never, done() {} };
        const viewing = new TaskPanel(panelArgs);
        try {
            const rendered = viewing.render(180).join("\n");
            assert.match(rendered, /shell/); assert.match(rendered, /agent/);
            assert.equal(viewing.model.refresh(coordinator.list()).length, 2);
            viewing.handleInput("\u001b");
            assert.equal(coordinator.waitCount, 4, "viewing/closing real mixed tasks cannot detach");
        } finally { viewing.dispose(); }
        const detaching = new TaskPanel(panelArgs);
        try { detaching.handleInput("\u001b[98;6u"); } finally { detaching.dispose(); }
        assert.equal(coordinator.waitCount, 0, "the shared panel chord releases both backends");
        assert.equal(coordinator.detachAll(), 0);
        shellParent.abort(); agentParent.abort();
        assert.equal((await agentLaunch.result).kind, "detached");
        assert.equal((await agentRetrieval.result).kind, "detached");
        const shellResult = await shellLaunch;
        const retrievalResult = await shellRetrieval;
        assert.match(shellResult.content[0]?.type === "text" ? shellResult.content[0].text : "", new RegExp(job.id));
        assert.match(retrievalResult.content[0]?.type === "text" ? retrievalResult.content[0].text : "", /Stopped following/);
        assert.equal(coordinator.waitCount, 0);
        assert.equal(starts, 1);
        assert.equal(backendSignal?.aborted, false);
        assert.equal(manager.getRecord(id)?.session, session);
        assert.equal(manager.getRecord(id)?.status, "running");
        assert.equal(manager.getRecord(id)?.resultConsumed, false);
        assert.equal(reg.jobs.get(job.id), job);
        assert.equal(reg.totalStarted, 1);
        assert.ok(processExists(job.pid));
        assert.ok(coordinator.list().every(task => task.executionMode === "background" && task.waitCount === 0));
        assert.ok(before.every(task => task.executionMode === "foreground" && task.waitCount === 2), "old views remain immutable");
        // Wait on the real local child's first output, not an arbitrary duration.
        for (let attempt = 0; !readFileSync(job.logPath, "utf8").includes("shell-before") && attempt < 200; attempt++) {
            await new Promise<void>(resolve => setTimeout(resolve, 5));
        }
        assert.match(readFileSync(job.logPath, "utf8"), /shell-before/);
        finish({ responseText: "agent-after-detach", session, aborted: false, steered: false });
        assert.equal((await run.terminal).result, "agent-after-detach");
        assert.equal(manager.getRecord(id)?.resultConsumed, false);
        assert.equal(messages.length, 0);
    } finally {
        manager.freezeAdmission();
        manager.abortAll();
        finish({ responseText: "cleanup", session, aborted: false, steered: false });
        for (const job of reg.jobs.values()) {
            terminateJobSilently(reg, job);
            await job.donePromise;
        }
        stopSidebarTicker(reg);
        offProcess(); offAgent(); processSource.dispose(); agentSource.dispose(); coordinator.dispose();
        await manager.dispose();
        rmSync(dir, { recursive: true, force: true });
    }
});
