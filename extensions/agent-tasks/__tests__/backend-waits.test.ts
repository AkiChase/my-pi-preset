import { loadNativeLayout } from "../../shared/scroll-panel/native-layout.ts";
const layout = await loadNativeLayout();
import { completeToolCall } from "./tool-inputs.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import "./source-loader.mjs";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskPanel } from "../../task-ui/panel.ts";
import { FINISHED_LINGER_MS } from "../../task-ui/model.ts";
import { DEFAULTS as UI_DEFAULTS } from "../../task-ui/config.ts";
const { createNestedSubagentTools } = await import("../src/nested-tools.ts");
const { setDefaultMaxTurns } = await import("../src/agent-runner.ts");
const { AgentManager } = await import("../src/agent-manager.ts");
const { registerAgentWait, canDeliverAgentResult } = await import("../src/waits.ts");
const { createAgentTaskSource } = await import("../src/source.ts");
const { createWorkflowTask, completeWorkflowTask } = await import("../src/workflow/task.ts");
const { runWorkflow } = await import("../src/workflow/runtime.ts");
const { createWorkflowHost } = await import("../src/workflow/host.ts");
const { registerAgents } = await import("../src/agent-types.ts");
import type { AgentManagerDependencies } from "../src/agent-manager.ts";
import type { RunResult } from "../src/agent-runner.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
// SDK objects have private runtime fields. The only boundary cast is the
// intentionally partial offline session; runner methods below never use models.
function fakeSession(): AgentSession {
  return { messages: [], sessionManager: { getSessionFile: () => undefined },
    dispose() {}, steer: async () => {}, subscribe: () => () => {}, getContextUsage: () => undefined,
  } as unknown as AgentSession;
}
const pi = {} as ExtensionAPI;
const ctx = { cwd: tmpdir() } as ExtensionContext;
function fixture(extra: AgentManagerDependencies = {}, notify?: (record: import("../src/types.ts").AgentRecord) => void) {
  const calls: { id: string; session: AgentSession; options: Parameters<NonNullable<AgentManagerDependencies["runAgent"]>>[3]; finish: (text?: string, failure?: string) => void }[] = [];
  const resumes: { session: AgentSession; options: Parameters<NonNullable<AgentManagerDependencies["resumeAgent"]>>[2]; finish: (text?: string) => void }[] = [];
  const deps: AgentManagerDependencies = {
    runAgent: async (_ctx, _type, _prompt, options) => {
      const result = deferred<RunResult>();
      const session = fakeSession();
      const call = { id: options.agentId!, session, options,
        finish: (text = "answer", failure?: string) => result.resolve({ responseText: text, session, aborted: false, steered: false, failure }) };
      calls.push(call);
      // The real runner creates the session asynchronously; preserve that seam.
      queueMicrotask(() => options.onSessionCreated?.(session));
      options.signal?.addEventListener("abort", () => call.finish("stopped"), { once: true });
      return result.promise;
    },
    resumeAgent: async (session, _prompt, options) => {
      const result = deferred<{ text: string }>();
      const call = { session, options, finish: (text = "resumed") => result.resolve({ text }) };
      resumes.push(call);
      options?.signal?.addEventListener("abort", () => call.finish("stopped"), { once: true });
      return result.promise;
    },
    ...extra,
  };
  const manager = new AgentManager(notify, 1, undefined, undefined, undefined, deps);
  manager.setMaxConcurrentForeground(1);
  const coordinator = new TaskCoordinator();
  const workflows = new Map<string, import("../src/workflow/task.ts").WorkflowTask>();
  const source = createAgentTaskSource(manager, coordinator, workflows);
  const off = coordinator.registerSource(source);
  return { manager, coordinator, calls, resumes, source, workflows, deps,
    spawn(background = false, options: Partial<Parameters<typeof manager.spawn>[4]> = {}) {
      return manager.spawn(pi, ctx, "general-purpose", "test", { description: "test", isBackground: background, blocking: !background, ...options });
    },
    async close() { manager.freezeAdmission(); manager.abortAll(); await tick(); off(); source.dispose(); coordinator.dispose(); await manager.dispose(); },
  };
}

void it("nested actual delegation ignores legacy turn budgets and keeps user defaults across resume", async () => {
  const f = fixture();
  setDefaultMaxTurns(7);
  try {
    const tool = createNestedSubagentTools({ manager: f.manager, pi, parentAgentId: "parent", depth: 1,
      maxSubagentDepth: 2, allowedSubagents: "all", configCwd: ctx.cwd })[0]!;
    const params = { subagent_type: "general-purpose", description: "nested", prompt: "test" };
    const refused = await tool.execute("legacy", completeToolCall(tool.parameters, { ...params, max_turns: 1 }), undefined, undefined, ctx as import("@earendil-works/pi-coding-agent").ExtensionToolContext);
    assert.equal(refused.isError, true); assert.equal(f.calls.length, 0);
    const launch = tool.execute("nested", completeToolCall(tool.parameters, params), undefined, undefined, ctx as import("@earendil-works/pi-coding-agent").ExtensionToolContext); await tick();
    assert.equal(f.manager.getRecord(f.calls[0]!.id)?.maxTurns, 7);
    assert.equal(f.manager.getRecord(f.calls[0]!.id)?.invocation?.maxTurns, 7);
    f.calls[0]!.finish();
    const launchResult = await launch;
    assert.match(launchResult.content.map(block => block.type === "text" ? block.text : "").join(""), new RegExp(`agent_id=${f.calls[0]!.id} execution_id=exec_`));
    setDefaultMaxTurns(9);
    const resume = tool.execute("nested-resume", completeToolCall(tool.parameters, { prompt: "test", resume: f.calls[0]!.id }), undefined, undefined, ctx as import("@earendil-works/pi-coding-agent").ExtensionToolContext); await tick();
    assert.equal(f.resumes[0]!.options?.maxTurns, 9);
    assert.equal(f.manager.getRecord(f.calls[0]!.id)?.invocation?.maxTurns, 9);
    f.resumes[0]!.finish();
    const resumedResult = await resume;
    assert.match(resumedResult.content.map(block => block.type === "text" ? block.text : "").join(""), new RegExp(`agent_id=${f.calls[0]!.id} execution_id=exec_`));
  } finally { await f.close(); setDefaultMaxTurns(undefined); }
});

void it("trusted scheduler persistence and RPC retain explicit turn limits through actual manager execution", async () => {
  const { SubagentScheduler } = await import("../src/schedule.ts");
  const { ScheduleStore } = await import("../src/schedule-store.ts");
  const { registerRpcHandlers } = await import("../src/cross-extension-rpc.ts");
  const root = mkdtempSync(join(tmpdir(), "trusted-turns-")), f = fixture();
  const callbacks: (() => void)[] = [];
  const scheduler = new SubagentScheduler({ interval(callback) { callbacks.push(callback); return {} as NodeJS.Timeout; },
    once() { throw new Error("unexpected once"); }, cron() { throw new Error("unexpected cron"); }, clear() {} });
  const rpc = new Map<string, (value: unknown) => void>();
  const handlers = registerRpcHandlers({ events: { on(name, callback) { rpc.set(name, callback); return () => rpc.delete(name); }, emit() {} },
    pi, getCtx: () => ctx, manager: { spawn: f.manager.spawn.bind(f.manager), awaitStartup: f.manager.awaitStartup.bind(f.manager),
      getRecord: f.manager.getRecord.bind(f.manager), abort: f.manager.abort.bind(f.manager), consumeResult: () => false } });
  setDefaultMaxTurns(7);
  try {
    const path = join(root, "schedules.json"), store = new ScheduleStore(path);
    store.add(scheduler.buildJob({ name: "trusted", description: "test", schedule: "1h", subagent_type: "general-purpose", prompt: "test", max_turns: 3 }));
    scheduler.start({ events: { emit() {} } } as unknown as ExtensionAPI, ctx, f.manager, new ScheduleStore(path)); callbacks[0]!(); await tick();
    assert.equal(f.manager.getRecord(f.calls[0]!.id)?.maxTurns, 3);
    assert.equal(f.manager.getRecord(f.calls[0]!.id)?.invocation?.maxTurns, 3);
    f.calls[0]!.finish(); await scheduler.drain();
    assert.equal(new ScheduleStore(path).list()[0]?.max_turns, 3);
    rpc.get("subagents:rpc:spawn")!({ requestId: "trusted", type: "general-purpose", prompt: "test", options: { description: "rpc", maxTurns: 4 } }); await tick();
    assert.equal(f.calls[1]!.options.maxTurns, 4);
    assert.equal(f.manager.getRecord(f.calls[1]!.id)?.maxTurns, 4);
    assert.equal(f.coordinator.list().find(row => row.taskId === f.calls[1]!.id)?.stats.maxTurns, 4);
    f.calls[1]!.finish(); await tick();
  } finally { Object.values(handlers).forEach(off => off()); scheduler.stop("shutdown"); await f.close(); await scheduler.drain(); setDefaultMaxTurns(undefined); rmSync(root, { recursive: true, force: true }); }
});

void it("running foreground detach transfers current lease above a full background pool; later admission waits", async () => {
  const f = fixture();
  try {
    const bg = f.spawn(true), parent = new AbortController(), fg = f.spawn(false, { signal: parent.signal });
    const run = f.manager.getRun(fg)!;
    const wait = registerAgentWait(f.manager, f.coordinator, run, "launch", parent.signal);
    assert.equal(f.coordinator.detachAll(), 1);
    assert.equal((await wait.result).kind, "detached");
    parent.abort();
    assert.equal(f.manager.getRecord(fg)?.status, "running");
    assert.equal(f.calls.length, 2, "detach never reruns");
    const next = f.spawn(true);
    assert.equal(f.manager.getRecord(next)?.status, "queued");
    f.calls.find(call => call.id === bg)!.finish(); await tick();
    assert.equal(f.manager.getRecord(next)?.status, "queued", "transferred foreground still holds background slot");
    f.calls.find(call => call.id === fg)!.finish("continuous output"); await tick();
    assert.equal(f.manager.getRecord(next)?.status, "running");
    assert.equal((await run.terminal).result, "continuous output");
  } finally { await f.close(); }
});

void it("queued foreground moves the same admission to background, unlinks queue parent and releases original gate", async () => {
  const f = fixture();
  try {
    f.spawn(false); const bg = f.spawn(true), parent = new AbortController();
    const queued = f.spawn(false, { signal: parent.signal });
    const gate = f.manager.getRecord(queued)!.startGate!;
    const run = f.manager.getRun(queued)!;
    const wait = registerAgentWait(f.manager, f.coordinator, run, "launch", parent.signal);
    f.coordinator.detachAll(); await wait.result; parent.abort();
    assert.equal(f.manager.getRecord(queued)?.status, "queued");
    f.calls.find(call => call.id === bg)!.finish(); await gate;
    assert.equal(f.calls.filter(call => call.id === queued).length, 1);
    assert.equal(f.manager.getRecord(queued)?.isBackground, true);
    parent.abort();
    f.calls.find(call => call.id === queued)!.finish(); await run.terminal;
    const nextFg = f.spawn(false);
    assert.equal(f.manager.getRecord(nextFg)?.status, "queued", "original foreground still holds exactly one slot");
    f.calls[0]!.finish(); await tick();
    assert.equal(f.manager.getRecord(nextFg)?.status, "running");
  } finally { await f.close(); }
});

void it("worktree startup is visible and waitable immediately; detached failure remains a terminal same-ID outcome", async () => {
  const startup = deferred<undefined>();
  const completed: string[] = [];
  const f = fixture({ createWorktree: async () => startup.promise, worktreeEnabled: () => true }, record => completed.push(record.id));
  try {
    const parent = new AbortController(), id = f.spawn(false, { isolation: "worktree", signal: parent.signal });
    const run = f.manager.getRun(id)!;
    assert.equal(f.source.list()[0]?.status, "starting");
    assert.ok(f.manager.getRecord(id)?.promise);
    const launch = registerAgentWait(f.manager, f.coordinator, run, "launch", parent.signal);
    const retrieval = registerAgentWait(f.manager, f.coordinator, run, "retrieval");
    assert.equal(f.source.list()[0]?.waitCount, 2);
    launch.detach(); await launch.result; parent.abort();
    assert.equal(f.manager.getRecord(id)?.status, "running");
    assert.equal(retrieval.settled, false, "startup retrieval cannot return early");
    startup.resolve(undefined);
    const outcome = await retrieval.result;
    assert.equal(outcome.kind, "completed");
    assert.equal(f.manager.getRecord(id)?.status, "error");
    assert.deepEqual(completed, [id]);
    assert.equal(f.calls.length, 0);
    assert.equal(f.manager.getRecord(id)?.resultConsumed, true);
  } finally { startup.resolve(undefined); await f.close(); }
});

void it("detach during successful startup survives later Esc without creating another runner", async () => {
  const startup = deferred<NonNullable<import("../src/types.ts").AgentRecord["worktree"]>>();
  const f = fixture({ createWorktree: async () => startup.promise, cleanupWorktree: async () => ({ hasChanges: false }), worktreeEnabled: () => true });
  try {
    const parent = new AbortController(), id = f.spawn(false, { isolation: "worktree", signal: parent.signal });
    const run = f.manager.getRun(id)!;
    const wait = registerAgentWait(f.manager, f.coordinator, run, "launch", parent.signal);
    wait.detach(); await wait.result; parent.abort();
    startup.resolve({ path: tmpdir(), branch: "fake", baseSha: "fake", workPath: tmpdir() });
    await f.manager.awaitStartup(id);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]?.options.signal?.aborted, false);
    f.calls[0]!.finish(); await run.terminal;
    assert.equal(f.manager.getRecord(id)?.resultConsumed, false);
    assert.equal(canDeliverAgentResult(f.manager, f.coordinator, f.manager.getRecord(id)!, run.identity.runId), true);
  } finally { await f.close(); }
});

void it("true foreground Esc stops its run and descendants; queued already-aborted launches settle", async () => {
  const f = fixture();
  try {
    const parent = new AbortController(), id = f.spawn(false, { signal: parent.signal });
    const child = f.spawn(false, { parentAgentId: id });
    const run = f.manager.getRun(id)!;
    const wait = registerAgentWait(f.manager, f.coordinator, run, "launch", parent.signal);
    parent.abort();
    assert.equal((await wait.result).kind, "interrupted");
    assert.equal(f.manager.getRecord(child)?.status, "stopped");
    assert.equal((await run.terminal).status, "stopped");
    const aborted = new AbortController(); aborted.abort();
    const noRun = f.spawn(false, { signal: aborted.signal });
    assert.equal((await f.manager.getRun(noRun)!.terminal).status, "stopped");
    assert.equal(f.calls.some(call => call.id === noRun), false);
  } finally { await f.close(); }
});

void it("completion wins inline once, while detach wins same-tick completion without consuming", async () => {
  const f = fixture();
  try {
    const id = f.spawn(false), run = f.manager.getRun(id)!;
    const wait = registerAgentWait(f.manager, f.coordinator, run, "launch");
    f.calls[0]!.finish();
    assert.equal((await wait.result).kind, "completed");
    assert.equal(wait.detach(), false);
    assert.equal(f.manager.getRecord(id)?.resultConsumed, true);
    assert.equal(canDeliverAgentResult(f.manager, f.coordinator, f.manager.getRecord(id)!, run.identity.runId), false);
    const second = f.spawn(false), next = f.manager.getRun(second)!;
    const detached = registerAgentWait(f.manager, f.coordinator, next, "launch");
    f.calls.find(call => call.id === second)!.finish(); detached.detach();
    assert.equal((await detached.result).kind, "detached"); await next.terminal; await tick();
    assert.equal(f.manager.getRecord(second)?.resultConsumed, false);
    assert.equal(canDeliverAgentResult(f.manager, f.coordinator, f.manager.getRecord(second)!, next.identity.runId), true);
  } finally { await f.close(); }
});

void it("resume foreground uses new run controller/admission and the same session, and refuses simultaneous re-entry", async () => {
  const f = fixture();
  try {
    const id = f.spawn(false), original = f.manager.getRun(id)!;
    f.calls[0]!.finish(); await original.terminal; await tick();
    const parent = new AbortController();
    const record = f.manager.resumeRun(id, "more", parent.signal)!;
    const run = f.manager.getRun(id)!;
    assert.notEqual(run.identity.runId, original.identity.runId);
    assert.equal(f.resumes[0]?.session, f.calls[0]?.session);
    assert.equal(f.manager.resumeRun(id, "reenter"), undefined);
    const wait = registerAgentWait(f.manager, f.coordinator, run, "launch", parent.signal);
    wait.detach(); parent.abort();
    assert.equal(record.status, "running");
    assert.equal(f.manager.stopRun(original.identity), false, "stale run cannot stop resume");
    f.resumes[0]!.finish("new output"); await run.terminal;
    assert.equal((await original.terminal).result, "answer", "old terminal snapshot is stable across resume");
    assert.equal(f.manager.getRecord(id)?.result, "new output");
    assert.equal(f.manager.getRecord(id)?.resultConsumed, false);
  } finally { await f.close(); }
});

void it("multiple retrieval leases count independently; cancellation and /task-detach never stop or consume execution", async () => {
  const f = fixture();
  try {
    const id = f.spawn(true), run = f.manager.getRun(id)!, parent = new AbortController();
    const a = registerAgentWait(f.manager, f.coordinator, run, "retrieval", parent.signal);
    const b = registerAgentWait(f.manager, f.coordinator, run, "retrieval");
    assert.equal(f.source.list()[0]?.executionMode, "background");
    assert.equal(f.source.list()[0]?.waitCount, 2);
    parent.abort(); await a.result;
    assert.equal(f.source.list()[0]?.waitCount, 1);
    assert.equal(f.manager.getRecord(id)?.status, "running");
    f.calls[0]!.finish(); b.detach(); await b.result; await run.terminal; await tick();
    assert.equal(f.source.list()[0]?.waitCount, 0);
    assert.equal(f.manager.getRecord(id)?.resultConsumed, false);
    assert.equal(canDeliverAgentResult(f.manager, f.coordinator, f.manager.getRecord(id)!, run.identity.runId), true);
    const dead = new AbortController(); dead.abort();
    const cancelled = registerAgentWait(f.manager, f.coordinator, run, "retrieval", dead.signal);
    assert.equal((await cancelled.result).kind, "interrupted");
    assert.equal(f.manager.getRecord(id)?.resultConsumed, false);
  } finally { await f.close(); }
});

void it("source freezes all owned/workflow/queued/no-session views, reads bounded details without consuming, and scopes stop", async () => {
  const f = fixture(), dir = mkdtempSync(join(tmpdir(), "agent-source-"));
  try {
    const root = f.spawn(true), queued = f.spawn(true);
    const nested = f.spawn(false, { parentAgentId: root });
    const task = createWorkflowTask({ id: "wf_test", script: "", meta: { name: "pipeline", description: "test", phases: [{ title: "real phase" }] } });
    f.workflows.set(task.id, task);
    const owned = f.spawn(false, { workflowId: task.id });
    const rows = f.source.list();
    assert.equal(rows.length, 5);
    assert.ok(Object.isFrozen(rows));
    for (const row of rows) { assert.ok(Object.isFrozen(row)); assert.ok(Object.isFrozen(row.stats)); assert.ok(Object.isFrozen(row.artifacts)); assert.equal("session" in row, false); }
    assert.equal(rows.find(row => row.taskId === nested)?.parentKey, rows.find(row => row.taskId === root)?.key);
    assert.equal(rows.find(row => row.taskId === owned)?.parentKey, rows.find(row => row.taskId === task.id)?.key);
    assert.equal(rows.find(row => row.taskId === task.id)?.description, "test");
    assert.equal(rows.find(row => row.taskId === task.id)?.title, "pipeline");
    const queuedRow = rows.find(row => row.taskId === queued)!;
    assert.match(f.source.detail(queuedRow)!.text, /conversation not established/);
    const record = f.manager.getRecord(root)!;
    record.outputFile = join(dir, "transcript.output");
    writeFileSync(record.outputFile, "0123456789".repeat(4000));
    const identity = f.manager.getRun(root)!.identity;
    const detail = f.source.detail(identity, { offset: 10, limit: 21 })!;
    assert.equal(detail.text.length, 21); assert.equal(detail.start, 10); assert.equal(detail.end, 31); assert.equal(detail.omittedAfter, 39969);
    assert.ok(Object.isFrozen(detail));
    assert.equal(record.resultConsumed, false);
    assert.equal(f.source.detail(identity, { limit: Infinity })!.text.length, 16000);
    assert.deepEqual(f.source.detail(identity)!.conversation ?? [], [], "non-JSON transcript yields no structured entries");
    const liveSession = record.session; record.session = undefined;
    writeFileSync(record.outputFile, [{ role: "user", content: "task prompt" }, { role: "assistant", content: [{ type: "text", text: "answer" }] }]
      .map(message => JSON.stringify({ type: message.role, message })).join("\n") + "\n");
    assert.deepEqual(f.source.detail(identity)!.conversation?.map(entry => entry.kind), ["user", "assistant"], "swept session falls back to the transcript");
    record.session = liveSession;
    assert.equal(f.source.stop(f.manager.getRun(nested)!.identity), true);
    assert.equal(record.status, "running");
    assert.equal(f.manager.getRecord(owned)?.status, "running");
    assert.equal(f.source.stop(rows.find(row => row.taskId === task.id)!), true);
    assert.equal(task.abortController.signal.aborted, true);
    f.source.dispose(); assert.equal(f.source.list().length, 0); assert.equal(f.source.detail(identity), undefined);
  } finally { await f.close(); rmSync(dir, { recursive: true, force: true }); }
});

void it("freeze/stop/dispose releases queued and startup terminal handles without an orphan wait", async () => {
  const startup = deferred<undefined>();
  const f = fixture({ createWorktree: async () => startup.promise, worktreeEnabled: () => true });
  try {
    const starting = f.spawn(false, { isolation: "worktree" }), queued = f.spawn(false);
    const a = f.manager.getRun(starting)!, b = f.manager.getRun(queued)!;
    f.manager.freezeAdmission(); f.manager.abortAll();
    assert.equal((await a.terminal).status, "stopped"); assert.equal((await b.terminal).status, "stopped");
    assert.throws(() => f.spawn(), /admission is closed/);
    startup.resolve(undefined); await tick(); assert.equal(f.calls.length, 0);
  } finally { startup.resolve(undefined); await f.close(); }
});

void it("workflow child stopped through actual source/host returns skipped and never auto-retries that attempt", { timeout: 10_000 }, async () => {
  registerAgents(new Map());
  const f = fixture();
  try {
    const task = createWorkflowTask({ id: "wf_actual", script: "" }); f.workflows.set(task.id, task);
    const entered = deferred<void>();
    const off = f.manager.subscribe(() => { if (f.calls.length) entered.resolve(); });
    const running = runWorkflow({ script: 'export const meta={name:"stop test",description:"test"}; await agent("test");',
      host: createWorkflowHost({ pi, ctx, manager: f.manager, workflowId: task.id }),
    });
    await entered.promise;
    const row = f.source.list().find(row => row.kind === "agent")!;
    assert.equal(f.source.stop(row), true);
    const result = await running;
    off();
    assert.equal(result.status, "completed");
    assert.equal(f.calls.length, 1, "user stop did not trigger a hidden retry");
    assert.ok(result.progress.some(entry => entry.type === "workflow_agent" && entry.skipped));
  } finally { await f.close(); }
});

void it("foreground resume queued admission can migrate to background without losing its original gate", async () => {
  const f = fixture();
  try {
    const id = f.spawn(false); f.calls[0]!.finish(); await f.manager.getRun(id)!.terminal; await tick();
    f.spawn(false); const bg = f.spawn(true);
    const parent = new AbortController(); f.manager.resumeRun(id, "queued continuation", parent.signal);
    const run = f.manager.getRun(id)!, gate = f.manager.getRecord(id)!.startGate!;
    const wait = registerAgentWait(f.manager, f.coordinator, run, "launch", parent.signal);
    wait.detach(); parent.abort();
    assert.equal(f.resumes.length, 0);
    f.calls.find(call => call.id === bg)!.finish(); await gate;
    assert.equal(f.resumes.length, 1);
    assert.equal(f.resumes[0]?.session, f.calls[0]?.session);
    assert.equal(f.resumes[0]?.options?.signal?.aborted, false);
    f.resumes[0]!.finish(); await run.terminal;
  } finally { await f.close(); }
});

void it("source observer changes and owner retention preserve completed children past sweep without recursive waits", async () => {
  const f = fixture();
  try {
    const task = createWorkflowTask({ id: "wf_retained", script: "" }); f.workflows.set(task.id, task);
    const parent = f.spawn(false), child = f.spawn(false, { parentAgentId: parent }), owned = f.spawn(false, { workflowId: task.id });
    f.calls.find(call => call.id === child)!.finish(); f.calls.find(call => call.id === owned)!.finish();
    await f.manager.getRun(child)!.terminal; await f.manager.getRun(owned)!.terminal; await tick();
    f.manager.consumeRun(f.manager.getRun(child)!.identity); f.manager.consumeRun(f.manager.getRun(owned)!.identity);
    f.manager.getRecord(child)!.completedAt = 0; f.manager.getRecord(owned)!.completedAt = 0;
    // Exercise the actual existing sweep, not a second test implementation.
    const sweep = Reflect.get(f.manager, "cleanup"); assert.equal(typeof sweep, "function"); sweep.call(f.manager);
    assert.ok(f.manager.getRecord(child)); assert.ok(f.manager.getRecord(owned));
    let events = 0; const off = f.source.subscribe(() => { events++; });
    const before = f.source.revision;
    f.calls.find(call => call.id === parent)!.options.onToolActivity?.({ type: "start", toolName: "edit" });
    const lease = registerAgentWait(f.manager, f.coordinator, f.manager.getRun(parent)!, "retrieval");
    lease.detach(); await lease.result;
    assert.ok(f.source.revision > before); assert.ok(events >= 3 && events < 10, "source/wait notifications cannot recurse");
    off();
  } finally { await f.close(); }
});

for (const elapsed of [0, FINISHED_LINGER_MS - 1, FINISHED_LINGER_MS]) {
  void it(`fresh panel after actual sweep retains consumed workflow child at group end + ${elapsed}ms only within window`, async t => {
    let now = 2_000_000;
    t.mock.method(Date, "now", () => now);
    const f = fixture();
    let panel: TaskPanel | undefined;
    try {
      const task = createWorkflowTask({ id: "wf_fresh_panel", script: "" });
      f.workflows.set(task.id, task);
      const completion = f.manager.spawnAndWait(pi, ctx, "general-purpose", "early child", {
        description: "early child", workflowId: task.id,
      });
      const id = f.calls[0]!.id;
      f.calls[0]!.finish("retained child answer");
      await completion; await f.manager.drainExecution();
      assert.equal(f.manager.getRecord(id)?.resultConsumed, true, "actual workflow wait consumes its result");
      now += 11 * 60_000;
      completeWorkflowTask(task, { status: "completed", meta: { name: "Long workflow", description: "retention" },
        agentCount: 1, replayedCount: 0, progress: [], value: "done" });
      now += elapsed;
      const sweep = Reflect.get(f.manager, "cleanup"); sweep.call(f.manager);
      const retained = elapsed < FINISHED_LINGER_MS;
      assert.equal(!!f.manager.getRecord(id), retained, "source retention ends exactly with the shared group window");
      panel = new TaskPanel({ coordinator: f.coordinator, config: UI_DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false },
        tui: { terminal: { rows: 40 }, requestRender() {} } as never, done() {} });
      const rows = panel.model.refresh(f.coordinator.list(), now);
      assert.deepEqual(rows.map(row => [row.view.taskId, row.depth]), retained ? [[task.id, 0], [id, 1]] : []);
      if (retained) {
        panel.handleInput("j"); panel.handleInput("\r");
        assert.match(panel.render(180).join("\n"), /retained child answer/);
        assert.equal(f.manager.getRecord(id)?.resultConsumed, true, "preview never changes result ownership");
      }
    } finally { panel?.dispose(); await f.close(); }
  });
}

void it("3B1 stop releases the transferred pool once without waiting for noncooperative execution", async () => {
  const pending = deferred<RunResult>(), session = fakeSession();
  const f = fixture({ runAgent: async (_ctx, _type, _prompt, options) => { options.onSessionCreated?.(session); return pending.promise; } });
  try {
    const id = f.spawn(false), run = f.manager.getRun(id)!;
    f.manager.detachRun(run.identity);
    f.manager.abort(id); f.manager.abort(id);
    assert.equal((await run.terminal).status, "stopped");
    assert.ok(f.manager.executionCount > 0);
    const next = f.spawn(true);
    assert.equal(f.manager.getRecord(next)?.status, "running", "stop releases current background lease immediately");
    assert.equal(f.manager.resumeRun(id, "cannot resume pending stopped prompt"), undefined);
    pending.resolve({ session, responseText: "late", aborted: false, steered: false });
    await f.manager.waitForAll();
    const first = f.spawn(true), queued = f.spawn(true);
    assert.equal(f.manager.getRecord(first)?.status, "running");
    assert.equal(f.manager.getRecord(queued)?.status, "queued", "late settle must not release the pool twice");
    await f.manager.waitForAll();
  } finally { pending.resolve({ session, responseText: "late", aborted: false, steered: false }); await f.close(); }
});


void it("direct manager admission normalizes descriptions before records and worktree cleanup", async () => {
  const descriptions: string[] = [];
  const f = fixture({ worktreeEnabled: () => true,
    createWorktree: async () => ({ path: tmpdir(), workPath: tmpdir(), branch: "offline", baseSha: "offline" }),
    cleanupWorktree: async (_pi, _cwd, _worktree, description) => { descriptions.push(description); return { hasChanges: false }; },
  });
  try {
    for (const description of [undefined, null, " ", " exact "]) {
      const id = f.manager.spawn(pi, ctx, "general-purpose", "offline", { description, isolation: "worktree" });
      await f.manager.awaitStartup(id);
      const expected = description?.trim() ? description : "general-purpose";
      assert.equal(f.manager.getRecord(id)?.description, expected);
      f.calls.at(-1)!.finish(); await f.manager.waitForAll();
      assert.equal(descriptions.at(-1), expected);
    }
    const count = f.manager.listAgents().length;
    for (const description of [42, {}, []]) {
      assert.throws(() => f.manager.spawn(pi, ctx, "general-purpose", "offline", {
        description: description as unknown as string,
      }), /description must be/);
      assert.equal(f.manager.listAgents().length, count);
      assert.equal(f.calls.length, 4);
    }
  } finally { await f.close(); }
});

void it("manager snapshots resolution, actual session adjustment and resume without rewriting historical config", async () => {
  const { isAgentExecutionConfig } = await import("../../runtime-tasks/execution-config.ts");
  const f = fixture();
  try {
    const id = f.spawn(true, { thinkingLevel: "high", model: { provider: "offline", id: "first", name: "First" } as never,
      isolated: false, inheritContext: false, isolation: "off", invocation: { thinking: "high", sessionRequestedThinking: "high", sessionRequestedModel: "offline/first", requestedIsolated: true, isolated: false } });
    const record = f.manager.getRecord(id)!, resolved = record.executionConfig!;
    assert.ok(isAgentExecutionConfig(resolved)); assert.equal(resolved.phase, "resolved");
    assert.equal(resolved.thinking, "high"); assert.equal(resolved.isolated, false); assert.equal(resolved.isolation, "off");
    const session = f.calls[0]!.session;
    Object.defineProperty(session, "model", { configurable: true, value: { provider: "offline", id: "actual", name: "Actual" } });
    Object.defineProperty(session, "thinkingLevel", { configurable: true, value: "off" });
    await tick();
    const actual = record.executionConfig!;
    assert.equal(actual.phase, "session-effective"); assert.equal(actual.model, "offline/actual"); assert.equal(actual.thinking, "off");
    assert.deepEqual(actual.differences?.map(d => [d.field, d.reason]), [["isolated", "agent-configuration"], ["model", "session-adjustment"], ["thinking", "session-adjustment"]]);
    assert.equal(resolved.phase, "resolved"); assert.equal(resolved.thinking, "high");
    const row = f.source.list().find(row => row.taskId === id)!;
    assert.deepEqual(row.executionConfig, actual); assert.notEqual(row.executionConfig, actual);
    f.calls[0]!.finish(); const terminal = await f.manager.getRun(id)!.terminal; await tick();
    Object.defineProperty(session, "model", { configurable: true, value: { provider: "offline", id: "resumed", name: "Resumed" } });
    Object.defineProperty(session, "thinkingLevel", { configurable: true, value: "low" });
    const resumed = f.manager.resumeRun(id, "new prompt", undefined, { requestedRunInBackground: true })!;
    assert.equal(resumed.runId, "2"); assert.equal(resumed.executionConfig?.model, "offline/resumed");
    assert.equal(resumed.executionConfig?.thinking, "low"); assert.equal(resumed.executionConfig?.mode, "foreground");
    assert.equal(resumed.executionConfig?.inherit_context, undefined); assert.equal(resumed.executionConfig?.isolation, undefined);
    assert.deepEqual(resumed.executionConfig?.differences, [{ field: "mode", requested: "background", actual: "foreground", reason: "agent-configuration" }]);
    assert.equal(resumed.invocation?.requestedThinking, undefined); assert.equal(resumed.invocation?.requestedIsolated, undefined);
    assert.deepEqual(terminal.executionConfig, actual); assert.deepEqual(row.executionConfig, actual);
    f.resumes[0]!.finish(); await f.manager.waitForAll(); assert.equal(f.manager.executionCount, 0);
  } finally { await f.close(); }
});

void it("pre-session failure stays resolved and partial sessions preserve unknown actual model/thinking", async () => {
  const f = fixture({ runAgent: async () => { throw new Error("startup failure"); } });
  try {
    const id = f.spawn(true, { invocation: { thinking: "off" } });
    const terminal = await f.manager.getRun(id)!.terminal;
    assert.equal(terminal.status, "error"); assert.equal(terminal.executionConfig?.phase, "resolved");
    assert.equal(terminal.executionConfig?.thinking, "off"); assert.equal(terminal.executionConfig?.model, undefined);
    await f.manager.drainExecution(); assert.equal(f.manager.executionCount, 0);
  } finally { await f.close(); }
  const unknown = fixture();
  try {
    const id = unknown.spawn(true, { thinkingLevel: "high" }); await tick();
    assert.equal(unknown.manager.getRecord(id)?.executionConfig?.phase, "session-effective");
    assert.equal(unknown.manager.getRecord(id)?.executionConfig?.thinking, undefined);
    assert.equal(unknown.manager.getRecord(id)?.executionConfig?.model, undefined);
    const row = unknown.source.list().find(view => view.taskId === id)!;
    assert.equal(row.stats.thinking, undefined, "legacy stats must not re-advertise an unconfirmed request");
    assert.equal(row.stats.model, undefined);
  } finally { await unknown.close(); }
});

void it("nested background startup failure retains launch identity and resolved config", async () => {
  const f = fixture({ worktreeEnabled: () => true, createWorktree: async () => undefined });
  const root = mkdtempSync(join(tmpdir(), "nested-config-error-"));
  const { mkdirSync } = await import("node:fs");
  try {
    mkdirSync(join(root, ".pi", "agents"), { recursive: true });
    writeFileSync(join(root, ".pi", "agents", "worktree-child.md"), "---\nname: worktree-child\ndescription: test\nisolation: worktree\n---\nPRIVATE_PROMPT\n");
    const tool = createNestedSubagentTools({ manager: f.manager, pi, parentAgentId: "parent", depth: 1,
      maxSubagentDepth: 2, allowedSubagents: "all", configCwd: root })[0]!;
    const result = await tool.execute("failure", completeToolCall(tool.parameters, { subagent_type: "worktree-child", description: "test", prompt: "test", run_in_background: true }), undefined, undefined, ctx as import("@earendil-works/pi-coding-agent").ExtensionToolContext);
    assert.equal(result.isError, true);
    const details = result.details as { executionConfig?: import("../../runtime-tasks/execution-config.ts").AgentExecutionConfig; runtimeLaunch?: unknown };
    assert.equal(details.executionConfig?.phase, "resolved");
    assert.equal(details.executionConfig?.isolation, "worktree");
    const { isLaunchMetadata } = await import("../../runtime-tasks/launch.ts");
    assert.ok(isLaunchMetadata(details.runtimeLaunch));
    const content = result.content.map(block => block.type === "text" ? block.text : "").join("\n");
    assert.match(content, /execution_id=exec_.*\nExecution config \(pending session confirmation\)/);
    assert.doesNotMatch(JSON.stringify(details), /PRIVATE_PROMPT|prompt|settings|auth/);
    assert.equal(f.calls.length, 0);
    await f.manager.drainExecution(); assert.equal(f.manager.executionCount, 0);
  } finally { await f.close(); rmSync(root, { recursive: true, force: true }); }
});

void it("source steer and workflow controls advertise only current windows and recheck identity before effects", async () => {
  const f = fixture();
  try {
    const id = f.spawn(true); await tick();
    const steered: string[] = [];
    const record = f.manager.getRecord(id)!;
    if (record.session) record.session.steer = (async (message: string) => { steered.push(message); }) as unknown as typeof record.session.steer;
    const identity = f.manager.getRun(id)!.identity;
    const row = () => f.source.list().find(view => view.taskId === id)!;
    assert.equal(row().capabilities.steer, true);
    assert.equal(f.coordinator.steer(identity, "   "), false);
    assert.equal(f.coordinator.steer({ ...identity, runId: "stale" }, "hi"), false);
    assert.equal(f.coordinator.steer(identity, "focus on auth"), true);
    await tick(); assert.deepEqual(steered, ["focus on auth"]);

    const calls: string[] = [];
    const task = createWorkflowTask({ id: "wf_ctl", script: "", meta: { name: "w", description: "d" } });
    task.control = { pause: () => calls.push("pause"), resume: () => calls.push("resume"), isPaused: () => false,
      skip: index => { calls.push(`skip ${index}`); return true; }, retry: index => { calls.push(`retry ${index}`); return true; } } as NonNullable<typeof task.control>;
    f.workflows.set(task.id, task);
    const child = f.spawn(true, { workflowId: task.id }); await tick();
    task.workflowProgress.push({ type: "workflow_agent", index: 3, label: "c", state: "start", recordId: child, startedAt: Date.now() } as never);
    const wfRow = () => f.source.list().find(view => view.kind === "workflow")!;
    const childRow = () => f.source.list().find(view => view.taskId === child)!;
    assert.deepEqual([wfRow().capabilities.pause, wfRow().capabilities.resume], [true, false]);
    assert.deepEqual([childRow().capabilities.skip, childRow().capabilities.retry], [true, true]);
    assert.equal(childRow().capabilities.steer, false, "workflow-owned children are steered by their script, not the panel");
    assert.equal(f.source.steer!(childRow(), "hi"), false);
    assert.equal(f.coordinator.control(childRow(), "pause"), false, "child rows do not pause the workflow");
    assert.equal(f.coordinator.control(wfRow(), "pause"), true); assert.equal(task.status, "paused");
    assert.deepEqual([wfRow().capabilities.pause, wfRow().capabilities.resume], [false, true]);
    assert.equal(f.coordinator.control(wfRow(), "resume"), true); assert.equal(task.status, "running");
    assert.equal(f.coordinator.control(childRow(), "retry"), true);
    assert.equal(f.coordinator.control(childRow(), "skip"), true);
    assert.deepEqual(calls, ["pause", "resume", "retry 3", "skip 3"]);
    // Settled row: no window, no effect even through the source directly.
    task.workflowProgress.push({ type: "workflow_agent", index: 3, label: "c", state: "done", recordId: child } as never);
    assert.deepEqual([childRow().capabilities.skip, childRow().capabilities.retry], [false, false]);
    assert.equal(f.source.control!(childRow(), "skip"), false); assert.equal(calls.length, 4);
    task.control = undefined;
    assert.equal(wfRow().capabilities.pause, false); assert.equal(f.source.control!(wfRow(), "pause"), false);
  } finally { await f.close(); }
});
