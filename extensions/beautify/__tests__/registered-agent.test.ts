import { registerManagementTool } from "../../runtime-tasks/tools.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import "../../agent-tasks/__tests__/source-loader.mjs";
import type { AgentManagerDependencies } from "../../agent-tasks/src/agent-manager.ts";
import type { RunResult } from "../../agent-tasks/src/agent-runner.ts";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import { managementContract } from "../tools/management.ts";
import { executionId } from "../../runtime-tasks/execution-id.ts";
const agentContract = managementContract("agent");
import { createRuntimeTaskFacade, type RuntimeTaskCapability } from "../../runtime-tasks/facade.ts";
import type { RenderContext } from "../types.ts";
const { default: agentTasks } = await import("../../agent-tasks/src/index.ts");
const tick = async () => { for (let i = 0; i < 30; i++) await new Promise<void>(done => setImmediate(done)); };

test("actual registered task_manage emits running/completed/verbose/not-found/released/cancelled contracts with no extra display consumption", async () => {
  const root = mkdtempSync(join(tmpdir(), "beautify-agent-contract-")), config = join(root, "agent"), cwd = join(root, "cwd");
  mkdirSync(config); mkdirSync(cwd);
  writeFileSync(join(config, "agent-tasks.json"), JSON.stringify({ schedulingEnabled: false, outputTranscript: false, rememberAgents: false, defaultJoinMode: "async" }));
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = config;
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
  const coordinator = new TaskCoordinator(), lifecycle = new TaskLifecycle(coordinator);
  let finish!: (result: RunResult) => void;
  const session = { messages: [{ role: "user", content: "verbose conversation" }], sessionManager: { getSessionFile: () => undefined }, subscribe: () => () => {}, dispose() {}, getContextUsage: () => undefined } as unknown as AgentSession;
  const dependencies: AgentManagerDependencies = {
    runAgent: async (_ctx, _type, _prompt, options) => {
      options.onSessionCreated?.(session);
      const promise = new Promise<RunResult>(resolve => { finish = resolve; });
      options.signal?.addEventListener("abort", () => finish({ session, responseText: "stopped", aborted: false, steered: false }), { once: true });
      return promise;
    },
  };
  const pi = { registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { tools.set(tool.name, tool); }, registerMessageRenderer() {}, registerEntryRenderer() {}, registerFlag() {}, registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    events: { emit() {}, on: () => () => {} }, appendEntry() {}, sendMessage() {}, getFlag: () => undefined, getAllTools: () => [], getActiveTools: () => [],
  } as unknown as ExtensionAPI;
  const ctx = { cwd, hasUI: false, mode: "print", ui: { setStatus() {}, setWidget() {}, notify() {} }, sessionManager: { getSessionId: () => "offline-beautify", getBranch: () => [] }, modelRegistry: {} } as unknown as ExtensionToolContext;
  const viewContext = (args: Record<string, unknown>): RenderContext => ({ args, toolCallId: "display", invalidate() {}, lastComponent: undefined, state: {}, cwd, executionStarted: true, argsComplete: true, isPartial: false, expanded: false, showImages: true, isError: false, durationMs: 0, outputPad: 1 });
  const execute = (args: Record<string, unknown>, signal?: AbortSignal) => tools.get("agent_manage")!.execute("get-result", args, signal, undefined, ctx);
  try {
    const capabilities: RuntimeTaskCapability[] = [];
    agentTasks(pi, { coordinator, lifecycle, managerDependencies: dependencies, onManagement: c => capabilities.push(c) });
    registerManagementTool(pi, "agent", capabilities);
    await handlers.get("session_start")![0]!(undefined, ctx);
    const notFound = await execute({ action: "output", execution_id: executionId({ taskId: "absent", runId: "1" }, "subagent") }); assert.equal(agentContract({ action: "output", execution_id: executionId({ taskId: "absent", runId: "1" }, "subagent") }, notFound, viewContext({ action: "output", execution_id: executionId({ taskId: "absent", runId: "1" }, "subagent") }))?.stats, "stale");
    await tools.get("subagent_run")!.execute("launch", { subagent_type: "general-purpose", description: "Actual description", prompt: "offline", run_in_background: true }, undefined, undefined, ctx);
    await tick();
    const id = coordinator.list().find(view => view.kind === "agent")!.taskId;
    const args = { action: "output", execution_id: executionId({ taskId: id, runId: "1" }, "subagent"), verbose: true };
    const running = await execute(args), copy = structuredClone(running);
    assert.equal(agentContract(args, running, viewContext(args))?.stats, "running");
    assert.equal(agentContract(args, running, viewContext(args))?.title, "Actual description");
    assert.match(running.content[0]!.type === "text" ? running.content[0]!.text : "", /verbose conversation/);
    assert.deepEqual(running, copy);
    const waitingArgs = { action: "wait", execution_id: executionId({ taskId: id, runId: "1" }, "subagent") };
    const release = execute(waitingArgs); await tick(); coordinator.detachAll();
    assert.match(agentContract(waitingArgs, await release, viewContext(waitingArgs))!.stats, /wait released.*unchanged/);
    assert.equal(coordinator.list().find(view => view.taskId === id)?.status, "running");
    const controller = new AbortController(), cancel = execute(waitingArgs, controller.signal); await tick(); controller.abort();
    assert.match(agentContract(waitingArgs, await cancel, viewContext(waitingArgs))!.stats, /wait cancelled.*unchanged/);
    finish({ session, responseText: "Actual final\nDescription: spoof", aborted: false, steered: false }); await tick();
    const completed = await execute(args); assert.equal(agentContract(args, completed, viewContext(args))?.stats, "completed");
    assert.equal(agentContract(args, completed, viewContext(args))?.title, "Actual description");
  } finally {
    await lifecycle.shutdown(); coordinator.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
