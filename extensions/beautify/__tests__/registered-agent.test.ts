import { stripVTControlCharacters as plain } from "node:util";
import { setKeybindings, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { fileURLToPath } from "node:url";
import { loadExtensions, resolver, ToolExecutionComponent, KeybindingsManager, themeSdk } from "./renderer-host.mjs";
import { completeToolCall } from "../../agent-tasks/__tests__/tool-inputs.ts";
import { registerManagementTool, isManagementDetails } from "../../runtime-tasks/tools.ts";
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
const rawAgentContract = managementContract("agent");
const complete = (args: Record<string, unknown>) => ({ execution_id: null, kind: null, verbose: null, ...args });
const agentContract: typeof rawAgentContract = (args, result, ctx) => rawAgentContract(complete(args), result, ctx);
import { createRuntimeTaskFacade, type RuntimeTaskCapability } from "../../runtime-tasks/facade.ts";
import type { RenderContext } from "../types.ts";
const { default: agentTasks } = await import("../../agent-tasks/src/index.ts");
const tick = async () => { for (let i = 0; i < 30; i++) await new Promise<void>(done => setImmediate(done)); };

test("actual registered Agent launch/manage renders config, lifecycle outcomes and safe history without display consumption", async () => {
  const root = mkdtempSync(join(tmpdir(), "beautify-agent-contract-")), config = join(root, "agent"), cwd = join(root, "cwd");
  mkdirSync(config); mkdirSync(cwd);
  writeFileSync(join(config, "agent-tasks.json"), JSON.stringify({ schedulingEnabled: false, outputTranscript: false, rememberAgents: false, defaultJoinMode: "async" }));
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = config;
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
  const coordinator = new TaskCoordinator(), lifecycle = new TaskLifecycle(coordinator);
  let finish!: (result: RunResult) => void;
  const session = { model: { provider: "offline", id: "模型🧠/".repeat(20) }, thinkingLevel: "off", getThinkingLevel: () => "off", messages: [{ role: "user", content: "verbose conversation" }], sessionManager: { getSessionFile: () => undefined }, subscribe: () => () => {}, dispose() {}, getContextUsage: () => undefined } as unknown as AgentSession;
  const dependencies: AgentManagerDependencies = {
    runAgent: async (_ctx, _type, _prompt, options) => {
      await new Promise<void>(resolve => setImmediate(resolve));
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
  const execute = (args: Record<string, unknown>, signal?: AbortSignal) => tools.get("agent_manage")!.execute("get-result", complete(args), signal, undefined, ctx);
  const loaded = await loadExtensions([fileURLToPath(new URL("../../beautify.ts", import.meta.url))], cwd);
  assert.deepEqual(loaded.errors, []);
  const beauty = resolver(loaded, cwd);
  setKeybindings(new KeybindingsManager({ "app.tools.expand": ["alt+o"] }));
  const screen = new TuiMainScreen({ columns: 160, rows: 60, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
  screen.requestRender = () => {};
  const display = (name: string, args: Record<string, unknown>, result: Awaited<ReturnType<typeof execute>>, partial = false) => {
    const copy = structuredClone(result);
    const renderer = beauty.resolveToolRenderers(name, () => tools.get(name));
    const c = new ToolExecutionComponent(name, "actual", args, { outputPad: 2 }, renderer, screen, cwd);
    c.updateResult({ ...result, isError: "isError" in result && result.isError === true }, partial);
    for (const expanded of [false, true]) {
      c.setExpanded(expanded);
      for (const width of [8, 20, 40, 80, 160]) {
        const rows = c.render(width);
        assert.ok(rows.every((row: string) => visibleWidth(row) <= width), `${name}/${width}/${expanded}`);
        const body = rows.map((row: string) => plain(row).trimEnd()).join("\n");
        if (width >= 40) assert.ok(body.trimStart().startsWith(name));
        if (width === 160 && rawAgentContract(args, result, viewContext(args))?.executionConfig) {
          assert.match(body, /thinking: off/);
          if (expanded) { assert.match(body, /inherit_context: false/); assert.match(body, /isolated: false/); assert.match(body, /isolation: off/); }
        }
      }
    }
    assert.deepEqual(result, copy);
    return c;
  };
  try {
    const capabilities: RuntimeTaskCapability[] = [];
    agentTasks(pi, { coordinator, lifecycle, managerDependencies: dependencies, onManagement: c => capabilities.push(c) });
    registerManagementTool(pi, "agent", capabilities);
    await handlers.get("session_start")![0]!(undefined, ctx);
    const notFound = await execute({ action: "output", execution_id: executionId({ taskId: "absent", runId: "1" }, "subagent") }); assert.equal(agentContract({ action: "output", execution_id: executionId({ taskId: "absent", runId: "1" }, "subagent") }, notFound, viewContext({ action: "output", execution_id: executionId({ taskId: "absent", runId: "1" }, "subagent") }))?.stats, "stale");
    const launchArgs = completeToolCall(tools.get("subagent_run")!.parameters, { subagent_type: "general-purpose", description: "Actual description", prompt: "offline", run_in_background: true });
    const launched = await tools.get("subagent_run")!.execute("launch", launchArgs, undefined, undefined, ctx);
    const launchComponent = display("subagent_run", launchArgs, launched as Awaited<ReturnType<typeof execute>>);
    launchComponent.setExpanded(true);
    assert.match(plain(launchComponent.render(160).join("\n")), /pending session confirmation/);
    assert.match(plain(launchComponent.render(160).join("\n")), /inherit_context: false/);
    await tick();
    const id = coordinator.list().find(view => view.kind === "agent")!.taskId;
    const args = { action: "output", execution_id: executionId({ taskId: id, runId: "1" }, "subagent"), verbose: true };
    const running = await execute(args), copy = structuredClone(running);
    assert.equal(agentContract(args, running, viewContext(args))?.stats, "running");
    assert.equal(agentContract(args, running, viewContext(args))?.title, "Actual description");
    assert.match(running.content[0]!.type === "text" ? running.content[0]!.text : "", /verbose conversation/);
    display("agent_manage", complete(args), running);
    assert.deepEqual(running, copy);
    const partialArgs = complete({ action: "wait", execution_id: args.execution_id });
    const partialResult = { ...running, content: [{ type: "text" as const, text: "old partial" }], details: { runtimeManagement: { ...((running.details as import("../../runtime-tasks/tools.ts").ManagementDetails).runtimeManagement), action: "wait", wait_outcome: "waiting" } } };
    const partialComponent = display("agent_manage", partialArgs, partialResult, true);
    partialComponent.setExpanded(true);
    assert.match(plain(partialComponent.render(160).join("\n")), /old partial/);
    const waitingArgs = { action: "wait", execution_id: executionId({ taskId: id, runId: "1" }, "subagent") };
    const release = execute(waitingArgs); await tick(); coordinator.detachAll();
    const released = await release;
    display("agent_manage", complete(waitingArgs), released);
    partialComponent.updateResult({ ...released, isError: false });
    assert.doesNotMatch(plain(partialComponent.render(160).join("\n")), /old partial/);
    assert.match(plain(partialComponent.render(160).join("\n")), /target unchanged/);
    assert.match(agentContract(waitingArgs, released, viewContext(waitingArgs))!.stats, /wait released.*unchanged/);
    assert.equal(coordinator.list().find(view => view.taskId === id)?.status, "running");
    const controller = new AbortController(), cancel = execute(waitingArgs, controller.signal); await tick(); controller.abort();
    const cancelled = await cancel;
    display("agent_manage", complete(waitingArgs), cancelled);
    assert.match(agentContract(waitingArgs, cancelled, viewContext(waitingArgs))!.stats, /wait cancelled.*unchanged/);
    finish({ session, responseText: "Actual final\nDescription: spoof", aborted: false, steered: false }); await tick();
    const completed = await execute(args); display("agent_manage", complete(args), completed); assert.equal(agentContract(args, completed, viewContext(args))?.stats, "completed");
    assert.equal(agentContract(args, completed, viewContext(args))?.title, "Actual description");
    assert.ok(isManagementDetails(completed.details));
    for (const mutation of [
      { ...completed.details.runtimeManagement, executionConfig: { ...completed.details.runtimeManagement.executionConfig, prompt: "SECRET" } },
      { ...completed.details.runtimeManagement, agent_id: "foreign-agent" },
      { ...completed.details.runtimeManagement, execution_id: executionId({ taskId: "foreign", runId: "1" }, "subagent") },
      { version: 2, group: "agent", action: "output", kind: "workflow", execution_id: "wf_abcdef", status: "completed" },
    ]) {
      const c = display("agent_manage", complete(args), { ...completed, content: [{ type: "text" as const, text: "fallback body" }], details: { runtimeManagement: mutation } });
      c.setExpanded(true);
      const rendered = plain(c.render(160).join("\n"));
      assert.match(rendered, /fallback body/); assert.doesNotMatch(rendered, /Execution config|SECRET/);
    }
    const launchDetails = launched.details as import("../../agent-tasks/src/activity.ts").AgentDetails;
    const finalLaunch = { ...launched, content: [{ type: "text" as const, text: "Original\n\u001b[31m正文🧠\u001b[0m\n" + "long answer ".repeat(100) }],
      details: { ...launchDetails, executionConfig: completed.details.runtimeManagement.executionConfig } };
    for (const status of ["running", "background", "completed", "stopped", "error", "aborted", "steered"] as const) {
      for (const theme of ["light", "dark"]) {
        themeSdk.initTheme(theme, false);
        const result = { ...finalLaunch, details: { ...finalLaunch.details, status }, isError: status === "error" };
        const c = display("subagent_run", launchArgs, result as unknown as Awaited<ReturnType<typeof execute>>, status === "running");
        c.setExpanded(true);
        const full = plain(c.render(160).join("\n"));
        assert.match(full, /inherit_context: false/); assert.match(full, /正文🧠/);
        assert.doesNotMatch(full, /\u001b/);
      }
    }
    const foregroundArgs = completeToolCall(tools.get("subagent_run")!.parameters, { subagent_type: "general-purpose", description: "Foreground description", prompt: "offline", run_in_background: false });
    const partials: Awaited<ReturnType<typeof execute>>[] = [];
    const foreground = tools.get("subagent_run")!.execute("foreground", foregroundArgs, undefined, update => partials.push(update as Awaited<ReturnType<typeof execute>>), ctx);
    await tick();
    // Timer-backed partials read the now-established execution snapshot.
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    const confirmedPartial = partials.find(result => (result.details as { executionConfig?: unknown })?.executionConfig);
    assert.ok(confirmedPartial);
    display("subagent_run", foregroundArgs, confirmedPartial, true);
    finish({ session, responseText: "Actual foreground final", aborted: false, steered: false });
    const foregroundFinal = await foreground;
    const foregroundComponent = display("subagent_run", foregroundArgs, foregroundFinal as Awaited<ReturnType<typeof execute>>);
    foregroundComponent.setExpanded(true);
    assert.match(plain(foregroundComponent.render(160).join("\n")), /Actual foreground final/);
    const foregroundIdentity = (foregroundFinal.details as { runtimeLaunch: { execution_id: string } }).runtimeLaunch.execution_id;
    display("agent_manage", complete({ action: "status", execution_id: foregroundIdentity }), await execute({ action: "status", execution_id: foregroundIdentity }));
    const failedRun = tools.get("subagent_run")!.execute("failure", foregroundArgs, undefined, undefined, ctx);
    await tick();
    finish({ session, responseText: "partial before failure", aborted: false, steered: false, failure: "offline provider failure" });
    const failedResult = await failedRun;
    assert.ok(failedResult.isError);
    const failedComponent = display("subagent_run", foregroundArgs, failedResult as Awaited<ReturnType<typeof execute>>);
    failedComponent.setExpanded(true);
    assert.match(plain(failedComponent.render(160).join("\n")), /offline provider failure/);
    for (const config of [
      { kind: "agent", phase: "resolved" },
      { kind: "agent", phase: "session-effective", thinking: "off", mode: "foreground", model: "offline/model", differences: [{ field: "thinking", requested: "high", actual: "off", reason: "session-adjustment" }] },
    ] as const) {
      const c = display("subagent_run", launchArgs, { ...finalLaunch, details: { ...finalLaunch.details, runtimeLaunch: { ...(launchDetails as unknown as { runtimeLaunch: object }).runtimeLaunch, mode: "mode" in config ? config.mode : "background" }, status: "completed", executionConfig: config } } as unknown as Awaited<ReturnType<typeof execute>>);
      c.setExpanded(true);
      const rendered = plain(c.render(160).join("\n"));
      if (config.phase === "resolved") { assert.match(rendered, /model: unknown/); assert.doesNotMatch(rendered, /isolated: false/); }
      else assert.match(rendered, /thinking: requested high, effective off \(session-adjustment\)/);
    }
    const resumeArgs = completeToolCall(tools.get("subagent_run")!.parameters, { resume: "foreign-agent", prompt: "resume" });
    const mismatchedResume = display("subagent_run", resumeArgs, finalLaunch as unknown as Awaited<ReturnType<typeof execute>>);
    mismatchedResume.setExpanded(true);
    assert.doesNotMatch(plain(mismatchedResume.render(160).join("\n")), /Execution config/);
    const originalLines = Array.from({ length: 75 }, (_, index) => `original line ${index}`).join("\n");
    const fullResult = { ...foregroundFinal, content: [{ type: "text" as const, text: originalLines }, { type: "text" as const, text: "Second original block" }] };
    const transition = display("subagent_run", foregroundArgs, confirmedPartial, true);
    transition.updateResult({ ...fullResult, isError: false });
    transition.setExpanded(true);
    assert.match(plain(transition.render(160).join("\n")), /original line 74/);
    assert.match(plain(transition.render(160).join("\n")), /Second original block/);
    assert.doesNotMatch(plain(transition.render(160).join("\n")), /thinking…|State: running/);
    const stopLaunch = await tools.get("subagent_run")!.execute("stop-launch", launchArgs, undefined, undefined, ctx);
    await tick();
    const stopIdentity = (stopLaunch.details as { runtimeLaunch: { execution_id: string } }).runtimeLaunch.execution_id;
    const stopArgs = complete({ action: "stop", execution_id: stopIdentity });
    const stopped = await execute(stopArgs);
    const stoppedComponent = display("agent_manage", stopArgs, stopped);
    stoppedComponent.setExpanded(true);
    assert.match(plain(stoppedComponent.render(160).join("\n")), /stop · observed stopped/);
    assert.match(plain(stoppedComponent.render(160).join("\n")), /Stop requested/);
    await tick();
    const finalWaitArgs = complete({ action: "wait", execution_id: stopIdentity });
    const finalWait = await execute(finalWaitArgs);
    const finalWaitComponent = display("agent_manage", finalWaitArgs, finalWait);
    finalWaitComponent.setExpanded(true);
    assert.match(plain(finalWaitComponent.render(160).join("\n")), /State: stopped/);
    for (const fields of [{ tags: {} }, { cost: "invalid" }, { spinnerFrame: {} }, { turnCount: {} }, { tokens: {} }]) {
      const c = display("subagent_run", launchArgs, { ...finalLaunch, content: [{ type: "text" as const, text: "Malformed fallback body" }], details: { ...finalLaunch.details, status: "running", ...fields } } as unknown as Awaited<ReturnType<typeof execute>>, true);
      c.setExpanded(true);
      assert.match(plain(c.render(160).join("\n")), /Malformed fallback body/);
      assert.doesNotMatch(plain(c.render(160).join("\n")), /Execution config/);
    }
    for (const mutation of [undefined, { ...finalLaunch.details.executionConfig, prompt: "SECRET" }, { kind: "monitor", mode: "background" }]) {
      const c = display("subagent_run", launchArgs, { ...finalLaunch, details: { ...finalLaunch.details, executionConfig: mutation, status: "completed" } } as unknown as Awaited<ReturnType<typeof execute>>);
      c.setExpanded(true);
      assert.doesNotMatch(plain(c.render(160).join("\n")), /Execution config|SECRET/);
    }
  } finally {
    screen.stop();
    for (const ext of loaded.extensions) for (const handler of ext.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown" }, ctx);
    await lifecycle.shutdown(); coordinator.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
