import { completeToolCall } from "./tool-inputs.ts";
import { executionId } from "../../runtime-tasks/execution-id.ts";
import { registerManagementTool } from "../../runtime-tasks/tools.ts";
import { createRuntimeTaskFacade, type RuntimeTaskCapability } from "../../runtime-tasks/facade.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it, type TestContext } from "node:test";
import type { AgentSession, ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { observeWorkflowControl } from "./source-loader.mjs";
import type { WorkflowTask } from "../src/workflow/task.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import type { AgentManagerDependencies } from "../src/agent-manager.ts";
import type { RunResult } from "../src/agent-runner.ts";
const { sessionTaskDir } = await import("../src/output-file.ts");
const { setDefaultMaxTurns } = await import("../src/agent-runner.ts");
const { createNestedSubagentTools } = await import("../src/nested-tools.ts");
import type { AgentRecord, NotificationDetails } from "../src/types.ts";
const { default: agentTasks } = await import("../src/index.ts");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

async function factory(settings: Record<string, unknown> = {}, extra: AgentManagerDependencies = {}, mentionDependencies?: import("../src/mention-clone.ts").MentionCloneDependencies, host: { send?: (message: { customType: string; content: unknown; details?: NotificationDetails }) => void; exec?: ExtensionAPI["exec"]; flag?: string; localLifecycle?: boolean; onEvent?: (name: string) => void; customAgent?: boolean; ui?: ExtensionToolContext["ui"]; beforeStart?: (coordinator: TaskCoordinator, lifecycle: TaskLifecycle) => void; onSource?: (source: import("../../task-ui/types.ts").TaskSource, lifecycle: TaskLifecycle) => void } = {}) {
  const root = mkdtempSync(join(tmpdir(), "agent-tool-waits-")), cwd = join(root, "cwd"), config = join(root, "agent");
  mkdirSync(cwd); mkdirSync(config);
  writeFileSync(join(config, "agent-tasks.json"), JSON.stringify({ schedulingEnabled: false, outputTranscript: true, rememberAgents: false, defaultJoinMode: "async", ...settings }));
  if (host.customAgent) {
    mkdirSync(join(config, "agents"));
    writeFileSync(join(config, "agents", "custom.md"), "---\nname: custom\ndescription: Offline foreground-pinned agent\nrun_in_background: false\n---\nDo the requested work.\n");
  }
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = config;
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
  const entries: string[] = [];
  const rpcReplies: { name: string; value: unknown }[] = [];
  const bus = new Map<string, Set<(data: unknown) => void>>();
  const events = {
    emit(name: string, data: unknown) {
      rpcReplies.push({ name, value: data });
      host.onEvent?.(name);
      for (const fn of bus.get(name) ?? []) fn(data);
    },
    on(name: string, fn: (data: unknown) => void) {
      const set = bus.get(name) ?? new Set<(data: unknown) => void>();
      set.add(fn); bus.set(name, set);
      return () => { set.delete(fn); };
    },
  };
  const notices: { content: unknown; customType: string; details?: NotificationDetails }[] = [];
  const calls: { options: Parameters<NonNullable<AgentManagerDependencies["runAgent"]>>[3]; session: AgentSession; finish: (text?: string, failure?: string) => void }[] = [];
  const resumes: { session: AgentSession; options: Parameters<NonNullable<AgentManagerDependencies["resumeAgent"]>>[2]; finish: (text?: string) => void }[] = [];
  const deps: AgentManagerDependencies = {
    runAgent: async (_ctx, _type, _prompt, options) => {
      const result = deferred<RunResult>();
      const session = { messages: [], sessionManager: { getSessionFile: () => undefined },
        subscribe: () => () => {}, dispose() {}, getContextUsage: () => undefined,
      } as unknown as AgentSession;
      const call = { options, session, finish: (text = "inline answer", failure?: string) => result.resolve({ session, responseText: text, aborted: false, steered: false, failure }) };
      calls.push(call); queueMicrotask(() => options.onSessionCreated?.(session));
      options.signal?.addEventListener("abort", () => call.finish("stopped"), { once: true });
      return result.promise;
    },
    resumeAgent: async (session, _prompt, options) => {
      const result = deferred<{ text: string }>();
      const call = { session, options, finish: (text = "resume answer") => result.resolve({ text }) };
      resumes.push(call);
      options?.signal?.addEventListener("abort", () => call.finish("stopped"), { once: true });
      return result.promise;
    }, ...extra,
  };
  // Factory requires SDK registration surfaces only. The boundary cast avoids
  // inventing a second SDK tool type; all execute calls use its real definition.
  const pi = { registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { tools.set(tool.name, tool); },
    registerMessageRenderer() {}, registerEntryRenderer() {}, registerFlag() {}, registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    events, appendEntry(type: string) { entries.push(type); }, sendMessage(message: typeof notices[number]) { host.send?.(message); notices.push(message); },
    exec: host.exec, getFlag: () => host.flag, getAllTools: () => [], getActiveTools: () => [],
  } as unknown as ExtensionAPI;
  const coordinator = new TaskCoordinator(), lifecycle = new TaskLifecycle(coordinator);
  let source!: import("../../task-ui/types.ts").TaskSource;
  const register = coordinator.registerSource.bind(coordinator);
  coordinator.registerSource = value => { source = value; host.onSource?.(value, lifecycle); return register(value); };
  const capabilities: RuntimeTaskCapability[] = [];
  let reporter: ((id: string, result: import("../../runtime-tasks/contracts.ts").RuntimeTaskResult) => import("../../runtime-tasks/contracts.ts").RuntimeTaskResult) | undefined;
  agentTasks(pi, { coordinator, lifecycle: host.localLifecycle ? undefined : lifecycle, managerDependencies: deps, mentionDependencies, onManagement: c => capabilities.push(c), onManagementResult: r => { reporter = r; } });
  const facade = createRuntimeTaskFacade(capabilities);
  lifecycle.onClose(facade.close);
  const management = registerManagementTool(pi, "agent", capabilities, (id, result) => reporter?.(id, result) ?? result);
  lifecycle.onClose(management.close);
  if (!host.localLifecycle) pi.on("session_shutdown", async () => { await lifecycle.shutdown(); });
  const ctx = { cwd, hasUI: false, mode: "print", ui: { setWidget() { throw new Error("widget sink failed"); }, setStatus() { throw new Error("status sink failed"); }, notify() { throw new Error("notify sink failed"); } },
    sessionManager: { getSessionId: () => "offline-test", getBranch: () => [] }, modelRegistry: {},
  } as unknown as ExtensionToolContext;
  if (host.ui) { ctx.ui = host.ui; ctx.hasUI = true; }
  host.beforeStart?.(coordinator, lifecycle);
  await handlers.get("session_start")![0]!(undefined, ctx);
  // The existing backend registry is observed, not replaced with a fake manager.
  const registry = Reflect.get(globalThis, Symbol.for("pi-subagents:manager")) as {
    hasRunning(): boolean; getRecord(id: string): AgentRecord | undefined;
  };
  const execute = (name: string, params: Record<string, unknown>, signal?: AbortSignal, call: { id: string | undefined } = { id: "offline-call" }) => tools.get(name)!.execute(call.id!, name === "agent_manage" ? params : completeToolCall(tools.get(name)!.parameters, params), signal, () => { throw new Error("inline renderer failed"); }, ctx);
  return { coordinator, lifecycle, source, calls, events, rpcReplies, entries,
    rpc: (value: unknown) => events.emit("subagents:rpc:spawn", value),
    shutdownHandlers: () => handlers.get("session_shutdown")!.length, tools, resumes, notices, execute, ctx, registry, root,
    input: (text: string) => handlers.get("input")![0]!({ text, source: "interactive" }, ctx),
    repeatStart: () => handlers.get("session_start")![0]!(undefined, ctx),
    artifactDir: sessionTaskDir(cwd, "offline-test"),
    start(background = false, extra: Record<string, unknown> = {}, signal?: AbortSignal, call?: { id: string | undefined }) {
      const defaults = Object.hasOwn(extra, "resume") ? { prompt: "test", run_in_background: background } : { subagent_type: "general-purpose", description: "offline", prompt: "test", run_in_background: background };
      return execute("subagent_run", { ...defaults, ...extra }, signal, call);
    },
    async close() {
      const artifactDirs = new Set(coordinator.list().flatMap(row => row.artifacts.filter(artifact => artifact.kind === "conversation" && artifact.path.includes(root.split("/").pop()!)).map(artifact => dirname(artifact.path))));
      await handlers.get("session_shutdown")![0]!(); coordinator.dispose();
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      for (const directory of artifactDirs) rmSync(directory, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function text(result: Awaited<ReturnType<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>>): string {
  return result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
}

void it("model Agent schema omits turn limits at root and nested boundaries", async () => {
  const f = await factory();
  try {
    const nested = createNestedSubagentTools({ manager: {} as import("../src/nested-tools.ts").NestedAgentManager, pi: {} as ExtensionAPI,
      parentAgentId: "parent", depth: 1, maxSubagentDepth: 2, allowedSubagents: "all", configCwd: f.ctx.cwd });
    assert.equal(Object.hasOwn(Reflect.get(f.tools.get("subagent_run")!.parameters, "properties"), "max_turns"), false);
    assert.equal(Object.hasOwn(Reflect.get(nested[0]!.parameters, "properties"), "max_turns"), false);
  } finally { await f.close(); }
});

for (const background of [false, true]) void it(`legacy model turn limit cannot affect actual ${background ? "background" : "foreground"} new/resume execution or notices`, async () => {
  const f = await factory({ defaultMaxTurns: 7 });
  const pending: Promise<unknown>[] = [];
  try {
    const refused = await f.start(background, { max_turns: 1 });
    assert.equal(refused.isError, true); assert.equal(f.calls.length, 0);
    const launch = f.start(background); pending.push(launch); void launch.catch(() => {}); await tick();
    assert.equal(f.calls[0]!.options.maxTurns, 7);
    const id = f.calls[0]!.options.agentId!;
    assert.equal(f.registry.getRecord(id)?.maxTurns, 7);
    assert.equal(f.registry.getRecord(id)?.invocation?.maxTurns, 7);
    assert.equal(f.coordinator.list()[0]?.stats.maxTurns, 7);
    if (!background) f.coordinator.detachAll(); await launch;
    f.calls[0]!.options.onTurnEnd?.(3); f.calls[0]!.finish(); await tick(); await pause(260);
    assert.equal(f.notices[0]?.details?.maxTurns, 7);
    setDefaultMaxTurns(9);
    const resume = f.start(background, { resume: id }); pending.push(resume); void resume.catch(() => {}); await tick();
    assert.equal(f.resumes[0]!.options?.maxTurns, 9);
    assert.equal(f.registry.getRecord(id)?.invocation?.maxTurns, 9);
    assert.equal(f.coordinator.list()[0]?.stats.maxTurns, 9);
    if (!background) f.coordinator.detachAll(); await resume;
    f.resumes[0]!.finish(); await tick(); await pause(260);
    assert.equal(f.notices[1]?.details?.maxTurns, 9);
  } finally { await f.close(); await Promise.allSettled(pending); setDefaultMaxTurns(undefined); }
});

void it("model scheduled delegation never persists legacy or default turn budgets and fires with current user configuration", async () => {
  const f = await factory({ schedulingEnabled: true, defaultMaxTurns: 7 });
  try {
    const refused = await f.start(true, { schedule: "1s", max_turns: 1 });
    assert.equal(refused.isError, true); assert.equal(f.calls.length, 0);
    const result = await f.start(true, { schedule: "1s" });
    assert.match(text(result), /Scheduled/);
    const path = join(f.ctx.cwd, ".pi", "subagent-schedules", "offline-test.json");
    const stored = JSON.parse(readFileSync(path, "utf8")) as { jobs: { max_turns?: number }[] };
    assert.equal(Object.hasOwn(stored.jobs[0]!, "max_turns"), false);
    setDefaultMaxTurns(9);
    for (let i = 0; i < 150 && !f.calls.length; i++) await pause(10);
    assert.equal(f.calls[0]!.options.maxTurns ?? f.registry.getRecord(f.calls[0]!.options.agentId!)?.maxTurns, 9);
    assert.equal(f.registry.getRecord(f.calls[0]!.options.agentId!)?.invocation?.maxTurns, 9);
    f.calls[0]!.finish(); await tick(); await pause(260);
    assert.equal(f.notices[0]?.details?.maxTurns, 9);
  } finally { await f.close(); setDefaultMaxTurns(undefined); }
});

void it("actual root delegation preserves frontmatter limits including unlimited, ignores legacy values and resumes stored type", async () => {
  for (const budget of [0, 4]) {
    const f = await factory({ defaultMaxTurns: 7 });
    try {
      const agentDir = join(f.root, "agent", "agents");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "limited.md"), `---\nname: limited\ndescription: Offline configured agent\nmax_turns: ${budget}\n---\nDo work.\n`);
      await f.start(true, { subagent_type: "limited" }); await tick();
      const id = f.calls[0]!.options.agentId!, effective = budget || undefined;
      assert.equal(f.calls[0]!.options.maxTurns, budget);
      assert.equal(f.registry.getRecord(id)?.invocation?.maxTurns, effective);
      assert.equal(f.coordinator.list()[0]?.stats.maxTurns, effective);
      f.calls[0]!.finish(); await tick(); await pause(260);
      assert.equal(f.notices[0]?.details?.maxTurns, effective);
      await f.start(true, { resume: id }); await tick();
      assert.equal(f.resumes[0]!.options?.maxTurns, budget);
      assert.equal(f.registry.getRecord(id)?.invocation?.maxTurns, effective);
      f.resumes[0]!.finish(); await tick(); await pause(260);
      assert.equal(f.notices[1]?.details?.maxTurns, effective);
    } finally { await f.close(); }
  }
});

void it("default actual model delegation stays unlimited despite legacy budget", async () => {
  const f = await factory({ defaultMaxTurns: 0 });
  try {
    const refused = await f.start(true, { max_turns: 1 });
    assert.equal(refused.isError, true); assert.equal(f.calls.length, 0);
    await f.start(true); await tick();
    assert.equal(f.calls[0]!.options.maxTurns, 0);
    assert.equal(f.registry.getRecord(f.calls[0]!.options.agentId!)?.maxTurns, undefined);
    f.calls[0]!.finish(); await tick();
  } finally { await f.close(); }
});

void it("actual foreground Agent detaches before startup, keeps activity/transcript and delivers one failure notice", async () => {
  const startup = deferred<undefined>();
  const f = await factory({}, { createWorktree: async () => startup.promise, worktreeEnabled: () => true });
  try {
    const parent = new AbortController(), tool = f.start(false, { isolation: "worktree" }, parent.signal);
    await tick();
    const row = f.coordinator.list()[0]!;
    assert.equal(row.status, "starting"); assert.equal(row.waitCount, 1);
    f.coordinator.detachAll();
    const result = await tool;
    assert.match(text(result), new RegExp(row.taskId));
    parent.abort(); startup.resolve(undefined); await tick(); await pause(260);
    assert.equal(f.notices.length, 1); assert.match(String(f.notices[0]?.content), /Cannot run with isolation/);
    assert.equal(f.coordinator.list()[0]?.status, "failed");
    assert.ok(f.coordinator.list()[0]?.artifacts.length);
    assert.equal(f.coordinator.waitCount, 0);
  } finally { startup.resolve(undefined); await f.close(); }
});

void it("actual Agent completion returns inline despite UI failures and suppresses delayed notification", async () => {
  const f = await factory();
  try {
    const tool = f.start(); await tick();
    f.calls[0]!.finish("returned inline");
    assert.match(text(await tool), /returned inline/);
    await pause(260);
    assert.equal(f.notices.length, 0);
    assert.equal(f.coordinator.waitCount, 0);
  } finally { await f.close(); }
});

void it("actual launch detach preserves same run and transcript, later Esc cannot stop it, and resume appends same file", async () => {
  const f = await factory();
  try {
    const parent = new AbortController(), tool = f.start(false, {}, parent.signal); await tick();
    const row = f.coordinator.list()[0]!, path = row.artifacts.find(artifact => artifact.kind === "conversation")!.path;
    writeFileSync(path, "prior transcript\n");
    f.coordinator.detachAll(); await tool; parent.abort();
    assert.equal(f.calls[0]?.options.signal?.aborted, false);
    f.calls[0]!.options.onToolActivity?.({ type: "start", toolName: "read" });
    f.calls[0]!.options.onAssistantUsage?.({ input: 3, output: 2, cacheWrite: 0, cost: 0 });
    assert.equal(f.coordinator.list()[0]?.stats.activity, "read");
    f.calls[0]!.finish("background output"); await tick();
    const result = await f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: row.taskId, runId: "1" }, "subagent")});
    assert.match(text(result), /background output/);
    await pause(260); assert.equal(f.notices.length, 0);
    const resumeParent = new AbortController();
    const resumed = f.start(false, { resume: row.taskId }, resumeParent.signal); await tick();
    const current = f.coordinator.list()[0]!;
    assert.notEqual(current.runId, row.runId); assert.equal(f.resumes[0]?.session, f.calls[0]?.session);
    assert.equal(readFileSync(path, "utf8"), "prior transcript\n", "resume cannot truncate earlier turns");
    f.coordinator.detachAll(); await resumed; resumeParent.abort();
    assert.equal(f.resumes[0]?.options?.signal?.aborted, false);
    f.resumes[0]!.finish("resumed background"); await tick(); await pause(260);
    assert.equal(f.notices.length, 1);
    assert.match(String(f.notices[0]?.content), /resumed background/);
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});

void it("actual result waits during startup count independently, wait:false peeks and same-tick cancelled completion nudges once", async () => {
  const startup = deferred<NonNullable<import("../src/types.ts").AgentRecord["worktree"]>>();
  const f = await factory({}, { createWorktree: async () => startup.promise, cleanupWorktree: async () => ({ hasChanges: false }), worktreeEnabled: () => true });
  try {
    const launch = await f.start(true, { isolation: "worktree" });
    assert.match(text(launch), /background/);
    const row = f.coordinator.list()[0]!;
    const peek = await f.execute("agent_manage", { action: "output", execution_id: executionId({ taskId: row.taskId, runId: "1" }, "subagent")});
    assert.match(text(peek), /still running/);
    const parent = new AbortController();
    const a = f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: row.taskId, runId: "1" }, "subagent")}, parent.signal);
    const b = f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: row.taskId, runId: "1" }, "subagent")});
    await tick(); assert.equal(f.coordinator.list()[0]?.waitCount, 2);
    parent.abort(); await a; assert.equal(f.coordinator.list()[0]?.waitCount, 1);
    startup.resolve({ path: tmpdir(), branch: "fake", baseSha: "fake", workPath: tmpdir() }); await tick();
    f.calls[0]!.finish("not lost"); f.coordinator.detachAll(); await b;
    await tick(); await pause(260);
    assert.equal(f.notices.length, 1); assert.match(String(f.notices[0]?.content), /not lost/);
    assert.equal(f.coordinator.waitCount, 0);
    await pause(250); assert.equal(f.notices.length, 1, "no second reconsideration notice");
  } finally { await f.close(); }
});

void it("actual foreground Esc stops, background result Esc does not, and both naturally release waits", async () => {
  const f = await factory();
  try {
    const parent = new AbortController(), foreground = f.start(false, {}, parent.signal); await tick();
    parent.abort(); assert.match(text(await foreground), /interrupted/); await tick();
    assert.equal(f.calls[0]?.options.signal?.aborted, true);
    const background = await f.start(true); assert.match(text(background), /background/);
    const row = f.coordinator.list().find(view => view.status === "running")!;
    const cancel = new AbortController(), retrieval = f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: row.taskId, runId: "1" }, "subagent")}, cancel.signal);
    cancel.abort(); assert.match(text(await retrieval), /cancelled/);
    assert.equal(f.calls[1]?.options.signal?.aborted, false);
    f.calls[1]!.finish(); await tick();
  } finally { await f.close(); }
});

void it("grouped notices recheck consumed/current runs and preserve one upstream group delivery", async () => {
  const f = await factory({ defaultJoinMode: "group" });
  try {
    await f.start(true); await f.start(true); await pause(130);
    const rows = f.coordinator.list();
    f.calls[0]!.finish("one"); f.calls[1]!.finish("two"); await tick();
    await f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: rows[0]!.taskId, runId: "1" }, "subagent")});
    await pause(260);
    assert.equal(f.notices.length, 1); assert.match(String(f.notices[0]?.content), /group completed/);
    await f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: rows[1]!.taskId, runId: "1" }, "subagent")});
    assert.equal(f.notices.length, 1);
  } finally { await f.close(); }
});

void it("group completion while retrieval is active does not strand sibling notice or duplicate after cancelled wait", async () => {
  const f = await factory({ defaultJoinMode: "group" });
  try {
    await f.start(true); await f.start(true); await pause(130);
    const rows = f.coordinator.list(), parent = new AbortController();
    const retrieval = f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: rows[0]!.taskId, runId: "1" }, "subagent")}, parent.signal);
    f.calls[0]!.finish("waited"); f.calls[1]!.finish("sibling"); parent.abort();
    await retrieval; await tick(); await pause(260);
    assert.equal(f.notices.length, 1, "whole group closes promptly despite one cancelled wait");
    assert.match(String(f.notices[0]?.content), /group completed/);
    assert.match(String(f.notices[0]?.content), /sibling/);
    await pause(250); assert.equal(f.notices.length, 1);
  } finally { await f.close(); }
});

void it("delayed group nudge cannot deliver a resumed run through the old attempt's notification", async () => {
  const f = await factory({ defaultJoinMode: "group" });
  try {
    await f.start(true); await f.start(true); await pause(130);
    const original = f.coordinator.list().find(row => row.taskId === f.calls[0]?.options.agentId)!;
    f.calls[0]!.finish("old one"); f.calls[1]!.finish("old two"); await tick();
    const resumed = f.start(false, { resume: original.taskId }); await tick();
    assert.equal(f.coordinator.list().find(row => row.taskId === original.taskId)?.status, "running");
    await pause(260);
    assert.equal(f.notices.length, 1);
    assert.doesNotMatch(String(f.notices[0]?.content), /old one/);
    f.coordinator.detachAll(); await resumed;
    f.resumes[0]!.finish("new run answer"); await tick(); await pause(260);
    assert.equal(f.notices.length, 2);
    assert.match(String(f.notices[1]?.content), /new run answer/);
  } finally { await f.close(); }
});

void it("actual background new transcript filesystem failure rolls back before membership and rethrows, without runner/pool/wait orphan", async () => {
  for (const queued of [false, true]) {
    const startup = deferred<undefined>();
    const f = await factory({ maxConcurrent: 1, defaultJoinMode: "group" }, { worktreeEnabled: () => true, createWorktree: async () => startup.promise });
    try {
      if (queued) await f.start(true);
      // Deterministic ENOTDIR, even when the tests run with elevated permissions.
      // Keep a generated artifact outside the faulted leaf to prove rollback
      // doesn't delete the caller's existing files.
      const keep = join(dirname(f.artifactDir), "keep.txt"); writeFileSync(keep, "keep");
      rmSync(f.artifactDir, { recursive: true }); writeFileSync(f.artifactDir, "not a directory");
      await assert.rejects(f.start(true, queued ? {} : { isolation: "worktree" }), /ENOTDIR|EEXIST/);
      const failed = f.coordinator.list().find(row => row.status === "stopped")!;
      assert.ok(failed); assert.equal(f.coordinator.waitCount, 0);
      assert.equal(f.registry.getRecord(failed.taskId)?.abortController?.signal.aborted, true);
      assert.equal(f.registry.getRecord(failed.taskId)?.resultConsumed, true);
      assert.equal(f.registry.getRecord(failed.taskId)?.startGate, undefined);
      if (queued) { f.calls[0]!.finish("existing success"); await tick(); }
      startup.resolve(undefined); await tick();
      assert.equal(f.registry.hasRunning(), false); assert.equal(f.calls.length, queued ? 1 : 0);
      assert.equal(readFileSync(keep, "utf8"), "keep");
      rmSync(f.artifactDir); mkdirSync(f.artifactDir);
      await pause(260);
      assert.equal(f.notices.filter(notice => notice.details?.id === failed.taskId).length, 0);
      // Freed admission admits a new run, not a resurrected failed queued run.
      await f.start(true); await tick(); assert.equal(f.calls.length, queued ? 2 : 1);
      f.calls.at(-1)!.finish(); await tick();
    } finally { startup.resolve(undefined); await f.close(); }
  }
});

void it("actual background resume transcript stream setup error is rethrown unchanged, stops controller and releases pool", async () => {
  const f = await factory({ maxConcurrent: 1, defaultJoinMode: "group" });
  try {
    await f.start(true); f.calls[0]!.finish(); await tick();
    const row = f.coordinator.list()[0]!, session = f.calls[0]!.session;
    const original = session.subscribe, failure = new Error("transcript subscribe failed");
    session.subscribe = () => { throw failure; };
    await assert.rejects(f.start(true, { resume: row.taskId }), error => error === failure);
    assert.equal(f.resumes.length, 0, "failed stream setup cannot reach prompt runner");
    const record = f.registry.getRecord(row.taskId)!;
    assert.equal(record.abortController?.signal.aborted, true); assert.equal(record.resultConsumed, true);
    assert.equal(record.outputCleanup, undefined); assert.equal(f.registry.hasRunning(), false);
    await pause(260); assert.equal(f.notices.length, 0, "unreturned resume has no notification owner");
    session.subscribe = original;
    await f.start(true, { resume: row.taskId }); assert.equal(f.resumes.length, 1);
    f.resumes[0]!.finish(); await tick();
  } finally { await f.close(); }
});

void it("actual background resume filesystem initialization failure cannot start a new run or lose prior transcript", async () => {
  const f = await factory();
  try {
    await f.start(true, {}, undefined, { id: "original-before-fault" }); f.calls[0]!.finish(); await tick();
    const row = f.coordinator.list()[0]!, oldDir = f.artifactDir + "-saved";
    // Existing finished record has no runtime to roll back when preparation
    // fails before resumeRun; no new controller/revision/prompt may be created.
    const { renameSync } = await import("node:fs");
    renameSync(f.artifactDir, oldDir); writeFileSync(f.artifactDir, "blocked");
    try {
      await assert.rejects(f.start(true, { resume: row.taskId }), /ENOTDIR|EEXIST/);
      assert.equal(f.resumes.length, 0); assert.equal(f.registry.hasRunning(), false);
      assert.equal(f.coordinator.list()[0]?.runId, row.runId);
      assert.equal(f.registry.getRecord(row.taskId)?.toolCallId, "original-before-fault");
    } finally { rmSync(f.artifactDir); renameSync(oldDir, f.artifactDir); }
    await pause(260); assert.equal(f.notices.length, 1, "preflight failure cannot swallow the previous run's result");
    assert.equal(f.notices[0]?.details?.toolCallId, "original-before-fault");
  } finally { await f.close(); }
});

void it("actual foreground detach notifications carry exact new/resume/mention call correlation and terminal per-run turn stats", async () => {
  const f = await factory({ defaultMaxTurns: 7 });
  try {
    const tool = f.start(false, {}, undefined, { id: "new-call-17" }); await tick();
    const id = f.calls[0]!.options.agentId!;
    f.calls[0]!.options.onTurnEnd?.(3); f.coordinator.detachAll(); await tool;
    f.calls[0]!.finish(); await tick(); await pause(260);
    assert.equal(f.notices[0]?.details?.turnCount, 3); assert.equal(f.notices[0]?.details?.maxTurns, 7);
    assert.equal(f.notices[0]?.details?.toolCallId, "new-call-17");
    assert.match(String(f.notices[0]?.content), /<tool-use-id>new-call-17<\/tool-use-id>/);
    setDefaultMaxTurns(9);
    const resume = f.start(false, { resume: id }, undefined, { id: "resume-call-29" }); await tick();
    f.resumes[0]!.options?.onTurnEnd?.(2); f.coordinator.detachAll(); await resume;
    f.resumes[0]!.finish(); await tick(); await pause(260);
    assert.equal(f.notices[1]?.details?.turnCount, 2); assert.equal(f.notices[1]?.details?.maxTurns, 9);
    assert.equal(f.notices[1]?.details?.toolCallId, "resume-call-29");
    assert.match(String(f.notices[1]?.content), /<tool-use-id>resume-call-29<\/tool-use-id>/);
    assert.doesNotMatch(String(f.notices[1]?.content), /new-call-17/);
    setDefaultMaxTurns(4);
    const mention = f.start(false, { resume: id }, undefined, { id: undefined }); await tick();
    f.resumes[1]!.options?.onTurnEnd?.(1); f.coordinator.detachAll(); await mention;
    f.resumes[1]!.finish(); await tick(); await pause(260);
    assert.equal(f.notices[2]?.details?.toolCallId, undefined); assert.doesNotMatch(String(f.notices[2]?.content), /tool-use-id/);
    assert.equal(f.notices[2]?.details?.turnCount, 1); assert.equal(f.notices[2]?.details?.maxTurns, 4);
  } finally { await f.close(); setDefaultMaxTurns(undefined); }
});

void it("actual delayed group details retain terminal stats for first/others and omit a consumed member", async () => {
  const f = await factory({ defaultJoinMode: "group" });
  try {
    for (let i = 0; i < 3; i++) {
      setDefaultMaxTurns(6 + i);
      await f.start(true, {}, undefined, { id: `group-call-${i}` });
    }
    await pause(130);
    for (let i = 0; i < 3; i++) { f.calls[i]!.options.onTurnEnd?.(i + 2); f.calls[i]!.finish(`answer-${i}`); }
    await tick(); await f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: f.calls[1]!.options.agentId!, runId: "1" }, "subagent")});
    await pause(260); assert.equal(f.notices.length, 1);
    const details = f.notices[0]!.details!;
    const all = [details, ...(details.others ?? [])]; assert.equal(all.length, 2);
    for (const i of [0, 2]) {
      const member = all.find(detail => detail.id === f.calls[i]!.options.agentId)!;
      assert.equal(member.turnCount, i + 2); assert.equal(member.maxTurns, 6 + i); assert.equal(member.toolCallId, `group-call-${i}`);
    }
    assert.ok(!all.some(detail => detail.id === f.calls[1]!.options.agentId));
  } finally { await f.close(); setDefaultMaxTurns(undefined); }
});

void it("actual queued background resume stream error settles without prompting or leaking admission, and reports the returned run failure once", async () => {
  const f = await factory({ maxConcurrent: 1 });
  try {
    await f.start(true); f.calls[0]!.finish(); await tick();
    const id = f.calls[0]!.options.agentId!, session = f.calls[0]!.session;
    await f.start(true); // Occupies the sole slot while the resume is prepared.
    const failure = new Error("queued transcript subscribe failed"), subscribe = session.subscribe;
    session.subscribe = () => { throw failure; };
    const resumed = await f.start(true, { resume: id }); assert.match(text(resumed), /queued/);
    f.calls[1]!.finish(); await tick();
    assert.equal(f.resumes.length, 0); assert.equal(f.registry.hasRunning(), false);
    assert.equal(f.registry.getRecord(id)?.abortController?.signal.aborted, true);
    assert.equal(f.registry.getRecord(id)?.outputCleanup, undefined);
    assert.equal(f.registry.getRecord(id)?.startGate, undefined);
    await pause(260);
    assert.equal(f.notices.filter(notice => notice.details?.id === id).length, 1);
    assert.match(String(f.notices.find(notice => notice.details?.id === id)?.content), /queued transcript subscribe failed/);
    session.subscribe = subscribe;
    await f.start(true, { resume: id }); assert.equal(f.resumes.length, 1);
    f.resumes[0]!.finish(); await tick();
  } finally { await f.close(); }
});

void it("actual foreground transcript filesystem failure preserves its existing stop/wait rollback", async () => {
  const startup = deferred<undefined>();
  const f = await factory({}, { worktreeEnabled: () => true, createWorktree: async () => startup.promise });
  try {
    rmSync(f.artifactDir, { recursive: true }); writeFileSync(f.artifactDir, "blocked");
    await assert.rejects(f.start(false, { isolation: "worktree" }), /ENOTDIR|EEXIST/);
    const row = f.coordinator.list()[0]!;
    assert.equal(row.status, "stopped"); assert.equal(f.coordinator.waitCount, 0);
    assert.equal(f.registry.getRecord(row.taskId)?.abortController?.signal.aborted, true);
    startup.resolve(undefined); await tick(); assert.equal(f.calls.length, 0); assert.equal(f.registry.hasRunning(), false);
  } finally { startup.resolve(undefined); await f.close(); }
});

void it("closed actual factory rejects retained tool callbacks before touching results", async () => {
  const f = await factory();
  try {
    await f.start(true); await f.close();
    const closed = await f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: "stale", runId: "1" }, "subagent") });
    assert.equal(closed.isError, true); assert.match(text(closed), /closing|closed/i);
  } finally { /* close already released this fixture */ }
});

void it("explicit source stop silently filters its group member but reports the natural sibling", async () => {
  const f = await factory({ defaultJoinMode: "group" });
  try {
    await f.start(true); await f.start(true); await pause(130);
    const rows = f.coordinator.list();
    f.source.stop!(rows[0]!);
    f.calls.find(call => call.options.agentId === rows[1]!.taskId)!.finish("natural sibling"); await tick(); await pause(260);
    assert.equal(f.notices.length, 1);
    assert.match(String(f.notices[0]?.content), /natural sibling/);
    assert.doesNotMatch(String(f.notices[0]?.content), /<status>stopped<\/status>/i);
  } finally { await f.close(); }
});

void it("injected participant freezes both backends before wait cancellation, drains retained child resources and repeated starts", async () => {
  let shutdowns = 0, resources = 0;
  const f = await factory({}, { runAgent: async (_ctx, _type, _prompt, options) => {
    resources++;
    const session = { messages: [], sessionManager: { getSessionFile: () => undefined }, subscribe: () => () => {}, dispose() {},
      extensionRunner: { hasHandlers: () => true, async emit() { shutdowns++; resources--; } },
    } as unknown as AgentSession;
    options.onSessionCreated?.(session);
    return { session, responseText: "retained", aborted: false, steered: false };
  } });
  let frozen = false, stopped = false;
  f.lifecycle.register({ name: "sibling", freeze() { frozen = true; }, stop() { assert.equal(frozen, true); stopped = true; }, async drain() {}, dispose() { throw new Error("optional cleanup"); } });
  try {
    await f.start(true); await tick(); assert.equal(resources, 1);
    await f.repeatStart(); await f.repeatStart(); assert.equal(f.coordinator.snapshot().length, 1);
    const close = f.lifecycle.shutdown(); assert.equal(close, f.lifecycle.shutdown());
    assert.equal(frozen, true); await close;
    assert.equal(stopped, true); assert.equal(shutdowns, 1); assert.equal(resources, 0);
    assert.equal(f.source.list().length, 0); await pause(260); assert.equal(f.notices.length, 0);
    await assert.rejects(f.start(true), /closing|closed/);
  } finally { await f.close(); }
});

void it("actual factory clone late create cannot fallback or admit an Agent after shutdown", async () => {
  const created = deferred<Awaited<ReturnType<import("../src/mention-clone.ts").MentionCloneDependencies["createSession"]>>>();
  let createCalls = 0, prompts = 0;
  const f = await factory({ agentMentions: "model" }, {}, {
    createLoader: () => ({ async reload() {} }),
    async createSession() { createCalls++; return created.promise; },
  });
  f.ctx.ui.notify = () => {};
  f.ctx.getSystemPrompt = () => "offline parent";
  try {
    await f.input("@general-purpose do work"); await tick(); assert.equal(createCalls, 1);
    const close = f.lifecycle.shutdown();
    created.resolve({ session: { async prompt() { prompts++; }, async abort() {}, dispose() {} } as unknown as AgentSession } as Awaited<ReturnType<import("../src/mention-clone.ts").MentionCloneDependencies["createSession"]>>);
    await close; await tick(); assert.equal(prompts, 0); assert.equal(f.calls.length, 0); assert.equal(f.notices.length, 0);
  } finally { await f.close(); }
});

void it("actual factory shutdown releases queued launch/retrieval and awaited resume without an old notice", async () => {
  const f = await factory({ maxConcurrent: 1, maxConcurrentForeground: 1 });
  try {
    await f.start(true);
    const queued = await f.start(true); assert.match(text(queued), /queued/);
    const parent = new AbortController(), launch = f.start(false, {}, parent.signal); await tick();
    const retrieval = f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: f.coordinator.list()[0]!.taskId, runId: "1" }, "workflow")});
    const outcomes = Promise.allSettled([launch, retrieval]);
    await f.lifecycle.shutdown(); await outcomes;
    assert.ok(f.calls.every(call => call.options.signal?.aborted)); assert.equal(f.coordinator.waitCount, 0);
    await pause(260); assert.equal(f.notices.length, 0);
  } finally { await f.close(); }
  const resumed = await factory();
  try {
    await resumed.start(true); await tick(); const id = resumed.coordinator.list()[0]!.taskId;
    resumed.calls[0]!.finish(); await tick();
    const work = resumed.start(false, { resume: id }); await tick();
    const settled = Promise.allSettled([work]); await resumed.lifecycle.shutdown(); await settled;
    assert.equal(resumed.resumes[0]?.options?.signal?.aborted, true); assert.equal(resumed.coordinator.waitCount, 0);
    await pause(260); assert.equal(resumed.notices.length, 0);
  } finally { await resumed.close(); }
});

void it("actual factory workflow termination drains its in-flight host gate and blocks late journal/notice", { timeout: 10_000 }, async () => {
  const gate = deferred<{ code: number; stdout: string; stderr: string; killed: boolean }>();
  let entered = false, gateSignal: AbortSignal | undefined;
  const f = await factory({}, {}, undefined, { exec: async (_command, _args, options) => { entered = true; gateSignal = options?.signal; return gate.promise; } });
  try {
    const result = await f.execute("subagent_workflow", { script: 'export const meta = { name: "gate", description: "offline" }; return await agent("test", { gate: "verify" });' });
    for (let n = 0; n < 100 && !f.calls.length; n++) await pause(10);
    f.calls[0]!.finish("passed child");
    for (let n = 0; n < 100 && !entered; n++) await pause(10);
    assert.equal(entered, true); const id = (result.details as { taskId: string }).taskId;
    let closed = false; const closing = f.lifecycle.shutdown().then(() => { closed = true; });
    await pause(40); assert.equal(gateSignal?.aborted, true); assert.equal(closed, false, "worker termination cannot stand in for gate drain");
    gate.resolve({ code: 0, stdout: "late pass", stderr: "", killed: false }); await closing;
    assert.equal(f.notices.length, 0); assert.equal(f.source.list().length, 0);
    assert.throws(() => readFileSync(join(f.artifactDir, `${id}.workflow.jsonl`)), /ENOENT/);
  } finally { gate.resolve({ code: 1, stdout: "", stderr: "", killed: true }); await f.close(); }
});

void it("actual CLI workflow repeated start executes once; shutdown forbids late entry/next-turn delivery", { timeout: 10_000 }, async () => {
  const file = join(mkdtempSync(join(tmpdir(), "workflow-flag-")), "flag.js");
  writeFileSync(file, 'export const meta = { name: "flag", description: "offline" }; log("ready"); await new Promise(() => {});');
  const f = await factory({}, {}, undefined, { flag: file });
  try {
    await f.repeatStart(); await f.repeatStart(); await pause(60);
    assert.equal(f.source.list().filter(row => row.kind === "workflow").length, 1);
    await f.lifecycle.shutdown(); await pause(260);
    assert.equal(f.notices.length, 0); assert.equal(f.source.list().length, 0);
    assert.match(readFileSync(file, "utf8"), /flag/);
  } finally { await f.close(); rmSync(dirname(file), { recursive: true, force: true }); }
});

void it("actual factory shutdown during delayed worktree startup prevents late child admission and notice", async () => {
  const startup = deferred<undefined>();
  const f = await factory({}, { createWorktree: async () => startup.promise, worktreeEnabled: () => true });
  try {
    const foreground = f.start(false, { isolation: "worktree" }); await tick();
    const settled = Promise.allSettled([foreground]); const closing = f.lifecycle.shutdown();
    startup.resolve(undefined); await closing; await settled;
    assert.equal(f.calls.length, 0); assert.equal(f.coordinator.waitCount, 0); await pause(260); assert.equal(f.notices.length, 0);
  } finally { startup.resolve(undefined); await f.close(); }
});

void it("direct actual factory owns one local shutdown handler and rejects old callbacks", async () => {
  const f = await factory({}, {}, undefined, { localLifecycle: true });
  try {
    assert.equal(f.shutdownHandlers(), 1); await f.start(true); await f.close();
    await assert.rejects(f.start(true), /closing|closed/); assert.equal(f.coordinator.list().length, 0);
  } finally { /* already closed local fixture */ }
});

void it("synchronous shutdown from a completion event blocks subsequent entry and held notice", async () => {
  let close: Promise<void> | undefined;
  const f = await factory({}, {}, undefined, { onEvent(name) { if (name === "subagents:completed") close = f.lifecycle.shutdown(); } });
  try {
    await f.start(true); await tick(); f.calls[0]!.finish("late event"); await tick(); await close;
    await pause(260); assert.equal(f.notices.length, 0); assert.equal(f.coordinator.list().length, 0);
  } finally { await f.close(); }
});


// Spy real Node timer registrations, not implementation strings or copied owners.
function ownedTimers(t: TestContext) {
  const timers = new Set<NodeJS.Timeout>();
  const interval = globalThis.setInterval, timeout = globalThis.setTimeout;
  const clearInterval = globalThis.clearInterval, clearTimeout = globalThis.clearTimeout;
  t.mock.method(globalThis, "setInterval", ((callback: () => void, ms?: number) => {
    const handle = interval(callback, ms); timers.add(handle); return handle;
  }) as typeof setInterval);
  t.mock.method(globalThis, "setTimeout", ((callback: () => void, ms?: number) => {
    const handle = timeout(() => { timers.delete(handle); callback(); }, ms); timers.add(handle); return handle;
  }) as typeof setTimeout);
  t.mock.method(globalThis, "clearInterval", ((handle: NodeJS.Timeout) => { timers.delete(handle); clearInterval(handle); }) as typeof globalThis.clearInterval);
  t.mock.method(globalThis, "clearTimeout", ((handle: NodeJS.Timeout) => { timers.delete(handle); clearTimeout(handle); }) as typeof globalThis.clearTimeout);
  return timers;
}
function terminalUI(onRegister?: () => void, onWidget?: () => void) {
  let inputs = 0, unsubscribed = 0;
  const ui = {
    setWidget(_key: string, content: unknown) { if (content) onWidget?.(); }, setStatus() {}, notify() {},
    onTerminalInput() { inputs++; onRegister?.(); let released = false; return () => { assert.equal(released, false); released = true; inputs--; unsubscribed++; }; },
  } as unknown as ExtensionToolContext["ui"];
  return { ui, inputs: () => inputs, unsubscribed: () => unsubscribed };
}
void it("source publication shutdown cannot recreate terminal input or timers", async t => {
  const timers = ownedTimers(t), terminal = terminalUI();
  const f = await factory({}, {}, undefined, { ui: terminal.ui, beforeStart(coordinator, lifecycle) { coordinator.subscribe(() => { void lifecycle.shutdown(); }); } });
  try {
    await f.lifecycle.shutdown(); await tick();
    assert.equal(terminal.inputs(), 0); assert.equal(timers.size, 0);
    assert.equal(f.lifecycle.active, false); assert.equal(f.coordinator.snapshot().length, 0); assert.equal(f.coordinator.waitCount, 0);
    await assert.rejects(f.start(true), /closing or closed/);
  } finally { await f.close(); for (const timer of timers) { clearInterval(timer); clearTimeout(timer); } }
});
void it("agent factory never registers legacy terminal navigation even with TUI context", async t => {
  const timers = ownedTimers(t), terminal = terminalUI();
  const f = await factory({}, {}, undefined, { ui: terminal.ui });
  try { await f.repeatStart(); await f.lifecycle.shutdown(); await tick(); assert.equal(terminal.inputs(), 0); assert.equal(terminal.unsubscribed(), 0); assert.equal(timers.size, 0); }
  finally { await f.close(); for (const timer of timers) { clearInterval(timer); clearTimeout(timer); } }
});
for (const background of [true, false]) void it(`actual ${background ? "background" : "foreground"} starting source listener shutdown rejects without artifact or owner leaks`, async t => {
  const timers = ownedTimers(t), terminal = terminalUI();
  const f = await factory({ defaultJoinMode: "group" }, {}, undefined, { ui: terminal.ui, onSource(source, lifecycle) {
    source.subscribe(() => { if (source.list().some(row => row.status === "starting")) void lifecycle.shutdown(); });
  } });
  try {
    const result = f.start(background); const rejected = assert.rejects(result, /closing or closed/);
    await rejected; await f.lifecycle.shutdown(); await tick(); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(timers.size, 0, `unreleased owned timer(s): ${[...timers].map(timer => Reflect.get(timer, "_idleTimeout"))}`); assert.equal(terminal.inputs(), 0); assert.equal(f.coordinator.snapshot().length, 0); assert.equal(f.coordinator.waitCount, 0);
    assert.equal(f.notices.length, 0); assert.equal(f.calls.length, 0);
  } finally { await f.close(); for (const timer of timers) { clearInterval(timer); clearTimeout(timer); } }
});

function cloneTransport(run: (tool: import("@earendil-works/pi-coding-agent").ToolDefinition) => Promise<void>): import("../src/mention-clone.ts").MentionCloneDependencies {
  return { createLoader: () => ({ async reload() {} }), async createSession(options) {
    return { session: { async prompt() { await run(options!.customTools![0]!); }, async abort() {}, dispose() {} } as unknown as AgentSession } as Awaited<ReturnType<import("../src/mention-clone.ts").MentionCloneDependencies["createSession"]>>;
  } };
}
void it("actual clone privately overrides custom frontmatter foreground pin, ordinary Agent still honors it", async () => {
  let invoke!: (tool: import("@earendil-works/pi-coding-agent").ToolDefinition) => Promise<void>;
  const f = await factory({ agentMentions: "model" }, {}, cloneTransport(tool => invoke(tool)), { customAgent: true });
  const toasts: string[] = []; f.ctx.ui.notify = message => { toasts.push(message); }; f.ctx.getSystemPrompt = () => "original main system";
  invoke = async tool => { await tool.execute("clone-id", completeToolCall(tool.parameters, { subagent_type: "custom", description: "clone custom", prompt: "clone work" }), undefined, undefined, f.ctx); };
  try {
    await f.input("@custom clone work"); await tick();
    const row = f.coordinator.list()[0]!;
    assert.equal(row.executionMode, "background"); assert.equal(f.coordinator.waitCount, 0); assert.equal(f.registry.getRecord(row.taskId)?.resultConsumed, false);
    f.calls[0]!.finish("clone natural answer"); await tick(); await pause(260);
    assert.equal(f.notices.length, 1); assert.match(String(f.notices[0]?.content), /clone natural answer/); assert.equal(toasts.filter(toast => toast.startsWith("Could not start")).length, 0);
    const ordinary = f.start(true, { subagent_type: "custom" }); await tick();
    assert.equal(f.coordinator.waitCount, 1); assert.equal(f.coordinator.list().find(view => view.status === "running")?.executionMode, "foreground");
    f.calls[1]!.finish("ordinary inline"); assert.match(text(await ordinary), /ordinary inline/); await pause(260); assert.equal(f.notices.length, 1);
  } finally { await f.close(); }
});
void it("actual clone Agent model refusal reports original text once without fallback admission", async () => {
  let invoke!: (tool: import("@earendil-works/pi-coding-agent").ToolDefinition) => Promise<void>;
  const f = await factory({ agentMentions: "model" }, {}, cloneTransport(tool => invoke(tool)));
  const toasts: { text: string; type?: string }[] = []; f.ctx.ui.notify = (text, type) => { toasts.push({ text, type }); }; f.ctx.getSystemPrompt = () => "main";
  const known = { provider: "offline", id: "known", name: "Known model" };
  f.ctx.modelRegistry = { find: () => known, getAll: () => [known], getAvailable: () => [known] } as unknown as ExtensionToolContext["modelRegistry"];
  invoke = async tool => { await tool.execute("clone-id", completeToolCall(tool.parameters, { subagent_type: "general-purpose", description: "refused", prompt: "work", model: "missing-model" }), undefined, undefined, f.ctx); };
  try {
    await f.input("@general-purpose do work"); await tick();
    assert.equal(f.coordinator.list().length, 0); assert.equal(f.calls.length, 0);
    assert.deepEqual(toasts.filter(toast => toast.type === "error"), [{ type: "error", text: 'Could not start @general-purpose: Model not found: "missing-model".\n\nAvailable models:\n  offline/known' }]);
  } finally { await f.close(); }
});
void it("clone throwing after admission gives failure feedback but never retries the admitted run", async () => {
  let invoke!: (tool: import("@earendil-works/pi-coding-agent").ToolDefinition) => Promise<void>;
  const f = await factory({ agentMentions: "model" }, {}, cloneTransport(tool => invoke(tool)), { onEvent(name) { if (name === "subagents:created") throw new Error("partial admission observer failure"); } });
  const errors: string[] = []; f.ctx.ui.notify = (text, type) => { if (type === "error") errors.push(text); }; f.ctx.getSystemPrompt = () => "main";
  invoke = async tool => { await tool.execute("clone-id", completeToolCall(tool.parameters, { subagent_type: "general-purpose", description: "partial", prompt: "work" }), undefined, undefined, f.ctx); };
  try {
    await f.input("@general-purpose do work"); await tick();
    assert.equal(f.calls.length, 1); assert.equal(f.coordinator.list().length, 1);
    assert.deepEqual(errors, ["Could not start @general-purpose: partial admission observer failure"]);
    f.calls[0]!.finish("partial run answer"); await tick(); await pause(260); assert.equal(f.notices.length, 1);
  } finally { await f.close(); }
});

void it("actual RPC description defaults and strings complete with exactly one notice", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await factory();
  const notify = async () => { await tick(); t.mock.timers.tick(260); await tick(); };
  try {
    for (const [index, description] of [undefined, null, "  ", " exact description "].entries()) {
      f.rpc({ requestId: `description-${index}`, type: "general-purpose", prompt: "offline", options: { description } });
      await tick();
      const call = f.calls[index]!, expected = typeof description === "string" && description.trim() ? description : "general-purpose";
      assert.equal(f.registry.getRecord(call.options.agentId!)?.description, expected);
      call.finish(); await notify();
      assert.equal(f.notices.length, index + 1);
      assert.equal(f.notices[index]?.details?.description, expected);
    }
    f.rpc({ requestId: "omitted-options", type: "general-purpose", prompt: "offline" }); await tick();
    f.calls[4]!.finish(); await notify();
    assert.equal(f.notices.length, 5);
    for (const payload of [
      { options: { description: "" }, expected: "general-purpose" },
      { options: {}, expected: "general-purpose" },
      { options: { description: " " }, expected: "general-purpose" },
    ]) {
      f.rpc({ requestId: `fallback-${f.calls.length}`, type: "missing-agent", prompt: "offline", ...payload }); await tick();
      const call = f.calls.at(-1)!;
      assert.equal(f.registry.getRecord(call.options.agentId!)?.description, payload.expected);
      call.finish(); await notify();
    }
    assert.equal(f.notices.length, 8);
  } finally { await f.close(); }
});

void it("actual malformed RPC rejects before record or runner admission and never uses undefined reply channels", async t => {
  const f = await factory();
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  try {
    const malformed = [
      ...[42, {}, []].map(description => ({ type: "general-purpose", prompt: "test", options: { description } })),
      ...[null, [], 42, "bad"].map(options => ({ type: "general-purpose", prompt: "test", options })),
      { type: 42, prompt: "test" }, { type: " ", prompt: "test" }, { type: "general-purpose", prompt: null },
    ];
    for (const [index, payload] of malformed.entries()) {
      const requestId = `invalid-${index}`;
      f.rpc({ requestId, ...payload }); await tick();
      const reply = f.rpcReplies.find(reply => reply.name === `subagents:rpc:spawn:reply:${requestId}`);
      assert.equal((reply?.value as { success: boolean }).success, false);
      assert.equal(f.calls.length, 0); assert.equal(f.coordinator.list().length, 0);
    }
    for (const payload of [undefined, null, [], {}, { requestId: 42 }, { requestId: " " }]) { f.rpc(payload); await tick(); }
    assert.equal(warnings.length, 6);
    assert.ok(!f.rpcReplies.some(reply => /reply:undefined$/.test(reply.name)));
    assert.equal(f.calls.length, 0);
    await f.start(true); assert.equal(f.calls.length, 1, "rejections leave admission available");
  } finally { await f.close(); }
});


for (const ui of [false, true]) void it(`notification failure gives only ${ui ? "UI warning" : "safe log"}, preserves result and isolates sinks`, async t => {
  const warnings: unknown[][] = [], toasts: string[] = []; let attempts = 0;
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); throw new Error("log sink failed"); });
  const f = await factory({}, {}, undefined, { send() { if (++attempts === 1) throw new Error("secret payload"); } });
  f.ctx.hasUI = ui;
  f.ctx.ui.notify = message => { toasts.push(message); throw new Error("UI sink failed"); };
  try {
    await f.start(true); const id = f.calls[0]!.options.agentId!;
    f.calls[0]!.finish("available result"); await tick(); await pause(260);
    assert.equal(attempts, 1); assert.equal(f.registry.getRecord(id)?.notificationDelivered, false);
    assert.equal(f.registry.getRecord(id)?.resultConsumed, false);
    assert.equal(f.notices.length, 0);
    assert.equal(ui ? toasts.length : warnings.length, 1);
    assert.equal(ui ? warnings.length : toasts.length, 0);
    assert.doesNotMatch(JSON.stringify([warnings, toasts]), /secret payload/);
    assert.deepEqual(f.entries, ["subagents:record"], "no persistent diagnostic entry");
    await pause(250); assert.equal(attempts, 1, "no automatic retry");
    assert.match(text(await f.execute("agent_manage", { action: "output", execution_id: executionId({ taskId: id, runId: "1" }, "subagent")})), /available result/);
    await f.start(true); f.calls[1]!.finish("sibling"); await tick(); await pause(260);
    assert.equal(f.notices.length, 1); assert.match(String(f.notices[0]?.content), /sibling/);
  } finally { await f.close(); }
});

void it("notification formatter failure is visible without consuming or marking delivery", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const f = await factory();
  try {
    await f.start(true); const id = f.calls[0]!.options.agentId!;
    f.calls[0]!.finish("answer"); await tick();
    const record = f.registry.getRecord(id)!;
    Object.defineProperty(record, "result", { configurable: true, get() { throw new Error("formatter injected"); } });
    t.mock.timers.tick(260); await tick();
    assert.equal(warnings.length, 1); assert.equal(record.notificationDelivered, false); assert.equal(record.resultConsumed, false);
    Object.defineProperty(record, "result", { configurable: true, writable: true, value: "answer" });
    assert.match(text(await f.execute("agent_manage", { action: "output", execution_id: executionId({ taskId: id, runId: "1" }, "subagent")})), /answer/);
  } finally { await f.close(); }
});

void it("individual notification synchronous resume cannot mark the new run delivered", async () => {
  let resumed: Promise<unknown> | undefined;
  const f = await factory({}, {}, undefined, { send(message) {
    if (!resumed) resumed = f.start(true, { resume: message.details!.id });
  } });
  try {
    await f.start(true); const id = f.calls[0]!.options.agentId!, old = f.registry.getRecord(id)!.runId;
    f.calls[0]!.finish("old answer"); await tick(); await pause(260); await resumed;
    const record = f.registry.getRecord(id)!;
    assert.notEqual(record.runId, old); assert.equal(record.notificationDelivered, false);
    f.resumes[0]!.finish("new answer"); await tick(); await pause(260);
    assert.equal(f.notices.length, 2); assert.match(String(f.notices[1]?.content), /new answer/);
    assert.equal(record.notificationDelivered, true);
  } finally { await f.close(); }
});

void it("shutdown reentered during notification send cannot mark or report an old run", async t => {
  let closing: Promise<void> | undefined;
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const f = await factory({}, {}, undefined, { send() { closing = f.lifecycle.shutdown(); throw new Error("send failed after shutdown"); } });
  try {
    await f.start(true); const record = f.registry.getRecord(f.calls[0]!.options.agentId!)!;
    f.calls[0]!.finish(); await tick(); await pause(260); await closing;
    assert.equal(record.notificationDelivered, false); assert.equal(warnings.length, 0);
    assert.equal(f.notices.length, 0);
  } finally { await f.close(); }
});


void it("group notification send failure leaves every result available without retry", async t => {
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  let attempts = 0;
  const f = await factory({ defaultJoinMode: "group" }, {}, undefined, { send() { attempts++; throw new Error("group sink fault"); } });
  try {
    await f.start(true); await f.start(true); await pause(130);
    for (const call of f.calls) call.finish("group result");
    await tick(); await pause(260);
    assert.equal(attempts, 1); assert.equal(warnings.length, 1); assert.equal(f.notices.length, 0);
    for (const call of f.calls) {
      const record = f.registry.getRecord(call.options.agentId!)!;
      assert.equal(record.notificationDelivered, false); assert.equal(record.resultConsumed, false);
    }
    await pause(250); assert.equal(attempts, 1);
    for (const call of f.calls) assert.match(text(await f.execute("agent_manage", { action: "output", execution_id: executionId({ taskId: call.options.agentId!, runId: "1" }, "subagent")})), /group result/);
  } finally { await f.close(); }
});


void it("group send synchronous resume marks only the original submitted runs", async () => {
  let resumed: Promise<unknown> | undefined, resumedId = "";
  const f = await factory({ defaultJoinMode: "group" }, {}, undefined, { send(message) {
    if (!resumed) { resumedId = message.details!.id; resumed = f.start(true, { resume: resumedId }); }
  } });
  try {
    await f.start(true); await f.start(true); await pause(130);
    for (const call of f.calls) call.finish("old group answer");
    await tick(); await pause(260); await resumed;
    assert.equal(f.registry.getRecord(resumedId)?.notificationDelivered, false);
    const sibling = f.calls.find(call => call.options.agentId !== resumedId)!;
    assert.equal(f.registry.getRecord(sibling.options.agentId!)?.notificationDelivered, true);
    f.resumes[0]!.finish("new group member answer"); await tick(); await pause(260);
    assert.equal(f.notices.length, 2); assert.match(String(f.notices[1]?.content), /new group member answer/);
  } finally { await f.close(); }
});


for (const beforeBatch of [false, true]) void it(`stopped noncooperative grouped runner closes membership ${beforeBatch ? "before" : "after"} batch without delaying sibling`, async () => {
  const pending = deferred<RunResult>();
  let heldSession!: AgentSession, heldOptions!: Parameters<NonNullable<AgentManagerDependencies["runAgent"]>>[3], runners = 0;
  const f = await factory({ defaultJoinMode: "group" }, { runAgent: async (_ctx, _type, _prompt, options) => {
    const session = { messages: [], sessionManager: { getSessionFile: () => undefined }, subscribe: () => () => {}, dispose() {}, getContextUsage: () => undefined } as unknown as AgentSession;
    options.onSessionCreated?.(session);
    if (++runners === 1) { heldSession = session; heldOptions = options; return pending.promise; }
    return { session, responseText: "natural sibling", aborted: false, steered: false };
  } });
  try {
    await f.start(true); await f.start(true);
    if (!beforeBatch) await pause(130);
    const row = f.coordinator.list().find(row => row.taskId === heldOptions.agentId)!;
    assert.equal(f.source.stop!(row), true);
    assert.equal(f.registry.getRecord(row.taskId)?.status, "stopped");
    assert.equal(f.lifecycle.active, true);
    await tick(); await pause(400);
    assert.equal(f.notices.length, 1, "must not wait thirty seconds for stopped execution");
    assert.match(String(f.notices[0]?.content), /natural sibling/);
    assert.doesNotMatch(String(f.notices[0]?.content), /partial|others still running|<status>Stopped/i);
    pending.resolve({ session: heldSession, responseText: "late stopped", aborted: false, steered: false });
    await tick(); await pause(260);
    assert.equal(f.notices.length, 1, "late runner settle cannot duplicate group notification");
  } finally { pending.resolve({ session: heldSession, responseText: "late stopped", aborted: false, steered: false }); await f.close(); }
});


void it("genuine running group member retains partial timeout and later straggler delivery", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = deferred<RunResult>(); let calls = 0;
  const session = { messages: [], sessionManager: { getSessionFile: () => undefined }, subscribe: () => () => {}, dispose() {}, getContextUsage: () => undefined } as unknown as AgentSession;
  const f = await factory({ defaultJoinMode: "group" }, { runAgent: async (_ctx, _type, _prompt, options) => {
    options.onSessionCreated?.(session);
    if (++calls === 1) return held.promise;
    return { session, responseText: "early member", aborted: false, steered: false };
  } });
  try {
    await f.start(true); await f.start(true); await tick();
    t.mock.timers.tick(100); await tick();
    t.mock.timers.tick(29_999); await tick(); assert.equal(f.notices.length, 0);
    t.mock.timers.tick(1); await tick(); t.mock.timers.tick(200); await tick();
    assert.equal(f.notices.length, 1); assert.match(String(f.notices[0]?.content), /partial.*others still running/);
    held.resolve({ session, responseText: "straggler", aborted: false, steered: false }); await tick();
    t.mock.timers.tick(200); await tick();
    assert.equal(f.notices.length, 2); assert.match(String(f.notices[1]?.content), /straggler/);
  } finally { held.resolve({ session, responseText: "done", aborted: false, steered: false }); await f.close(); }
});


void it("mixed completed stopped and running group reports partial only for genuinely running member", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stopped = deferred<RunResult>(), running = deferred<RunResult>(); let calls = 0;
  const session = { messages: [], sessionManager: { getSessionFile: () => undefined }, subscribe: () => () => {}, dispose() {}, getContextUsage: () => undefined } as unknown as AgentSession;
  const f = await factory({ defaultJoinMode: "group" }, { runAgent: async (_ctx, _type, _prompt, options) => {
    options.onSessionCreated?.(session);
    if (++calls === 1) return stopped.promise;
    if (calls === 2) return running.promise;
    return { session, responseText: "completed member", aborted: false, steered: false };
  } });
  try {
    await f.start(true); const stopRow = f.coordinator.list()[0]!;
    await f.start(true); await f.start(true); await tick(); t.mock.timers.tick(100); await tick();
    f.source.stop!(stopRow); await tick(); t.mock.timers.tick(30_200); await tick(); t.mock.timers.tick(200); await tick();
    assert.equal(f.notices.length, 1); assert.match(String(f.notices[0]?.content), /partial.*others still running/);
    assert.match(String(f.notices[0]?.content), /completed member/);
    assert.equal(f.notices[0]?.details?.others, undefined, "stopped member excluded from submitted results");
    running.resolve({ session, responseText: "last running member", aborted: false, steered: false }); await tick(); t.mock.timers.tick(200); await tick();
    assert.equal(f.notices.length, 2); assert.doesNotMatch(String(f.notices[1]?.content), /partial|others still running/);
    stopped.resolve({ session, responseText: "late stopped", aborted: false, steered: false }); await tick(); t.mock.timers.tick(1_000); await tick();
    assert.equal(f.notices.length, 2);
  } finally {
    stopped.resolve({ session, responseText: "done", aborted: false, steered: false });
    running.resolve({ session, responseText: "done", aborted: false, steered: false }); await f.close();
  }
});

void it("actual RPC raw ID interoperates with task_manage without old tool aliases", async () => {
  const f = await factory();
  try {
    const response = new Promise<{ success: boolean; data: { id: string } }>(resolve => f.events.on("subagents:rpc:spawn:reply:description", data => resolve(data as { success: boolean; data: { id: string } })));
    f.events.emit("subagents:rpc:spawn", { requestId: "description", type: "general-purpose", prompt: "programmatic", options: { description: "programmatic task", cwd: f.ctx.cwd, isolation: "none" } });
    await tick(); const reply = await response;
    assert.equal(reply.success, true); assert.equal(reply.data.id, f.calls[0]!.options.agentId);
    assert.equal(f.registry.getRecord(reply.data.id)?.description, "programmatic task");
    f.calls[0]!.finish("RPC complete"); await tick(); await pause(260);
    assert.equal(f.notices.length, 1); assert.match(String(f.notices[0]!.content), /programmatic task.*completed/);
    const result = await f.execute("agent_manage", { action: "output", execution_id: executionId({ taskId: reply.data.id, runId: "1" }, "subagent") });
    assert.match(text(result), /RPC complete/); assert.equal((result.details as import("../../runtime-tasks/tools.ts").ManagementDetails).runtimeManagement.agent_id, reply.data.id);
    assert.equal(f.tools.has("Agent"), false); assert.equal(f.tools.has("get_subagent_result"), false);
  } finally { await f.close(); }
});

void it("registered task_manage carries pending subagent usage once and leaves disabled accounting empty", async () => {
  for (const reportUsage of [true, false]) {
    const f = await factory({ reportUsage });
    try {
      await f.start(true);
      const id = f.calls[0]!.options.agentId!;
      f.calls[0]!.options.onAssistantUsage?.({ input: 3, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.02 });
      const running = await f.execute("agent_manage", { action: "status", execution_id: executionId({ taskId: id, runId: "1" }, "subagent")});
      assert.equal(running.usage?.input, reportUsage ? 3 : undefined);
      assert.equal(running.usage?.output, reportUsage ? 5 : undefined);
      assert.equal((await f.execute("agent_manage", { action: "status", execution_id: executionId({ taskId: id, runId: "1" }, "subagent")})).usage, undefined);
      assert.notEqual(f.registry.getRecord(id)?.resultConsumed, true, "usage reporting does not consume a running result");
      f.calls[0]!.finish("usage answer"); await tick();
      assert.match(text(await f.execute("agent_manage", { action: "wait", execution_id: executionId({ taskId: id, runId: "1" }, "subagent")})), /usage answer/);
    } finally { await f.close(); }
  }
});

void it("registered workflow pause owner -> wait/stop drains worker and host without stopping independent sibling", { timeout: 10_000 }, async () => {
  const { pauseWorkflowTask } = await import("../src/workflow/task.ts");
  let task: WorkflowTask | undefined;
  const off = observeWorkflowControl((value: WorkflowTask) => { task = value; });
  const f = await factory({ workflowsEnabled: true });
  try {
    await f.execute("subagent_workflow", { script: 'export const meta = { name: "natural", description: "offline" }; return "done";' });
    for (let i = 0; i < 200 && !f.notices.length; i++) await pause(5);
    assert.equal(f.notices.length, 1); assert.match(String(f.notices[0]?.content), /done/);
    await f.start(true); const independent = f.calls[0]!;
    const launched = await f.execute("subagent_workflow", { script: "export const meta = { name: 'Pause chain', description: 'offline' }; await agent('first'); return await agent('must not start');" });
    const id = (launched.details as { taskId: string }).taskId;
    for (let i = 0; i < 200 && (!task?.control || f.calls.length < 2); i++) await pause(5);
    assert.ok(task?.control); assert.equal(task.id, id);
    assert.equal(pauseWorkflowTask(task), true, "same task/control used by workflow menu");
    assert.equal(f.source.list().find(row => row.taskId === id)?.status, "paused");
    const waiting = f.execute("agent_manage", { action: "wait", execution_id: id});
    f.calls[1]!.finish("first done while paused");
    await pause(30);
    assert.equal(f.calls.length, 2, "paused worker cannot start the next child");
    const stopped = await f.execute("agent_manage", { action: "stop", execution_id: id});
    assert.match(text(stopped), /Stop requested/);
    const terminal = await waiting;
    assert.equal((terminal.details as import("../../runtime-tasks/tools.ts").ManagementDetails).runtimeManagement.status, "stopped");
    assert.equal(task.control, undefined, "runtime returns only after worker terminate");
    assert.equal(independent.options.signal?.aborted, false);
    assert.equal(f.calls.length, 2);
    independent.finish("independent done");
    await f.lifecycle.shutdown();
    assert.equal(f.coordinator.waitCount, 0); assert.equal(f.source.list().length, 0, "actual auxiliary/host drain complete");
  } finally { off(); await f.close(); }
});

void it("actual workflow launcher and management return full answers, failed startup and concurrent waits", async () => {
  const f = await factory({ workflowsEnabled: true });
  const script = (body: string) => `export const meta = { name: 'Offline', description: 'Offline workflow' }; ${body}`;
  const launch = async (body: string, args?: unknown) => {
    const result = await f.execute("subagent_workflow", { script: script(body), ...(args === undefined ? {} : { args }) });
    const id = (result.details as { taskId: string }).taskId;
    assert.match(text(result), new RegExp(`execution_id=${id}`));
    return id;
  };
  try {
    const id = await launch("return 'answer'.repeat(5000);");
    const results = await Promise.all([f.execute("agent_manage", { action: "wait", execution_id: id}), f.execute("agent_manage", { action: "wait", execution_id: id})]);
    assert.ok(results.every(result => text(result).includes("answer".repeat(5000))));
    await pause(260); assert.equal(f.notices.length, 0, "retrieval consumes held workflow notification");
    const count = f.coordinator.list().length;
    const failed = await f.execute("subagent_workflow", { script: script("return args;"), args: { value: 1n } });
    assert.equal(failed.isError, true); assert.match(text(failed), /args|BigInt/i);
    assert.equal(f.coordinator.list().length, count, "invalid args must not create a workflow execution");
    const invalid = await f.execute("agent_manage", { action: "output", execution_id: id, limit: 2 });
    assert.equal((invalid as { isError?: boolean }).isError, true);
  } finally { await f.close(); }
});
