import "./source-loader.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import type { AgentSession, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "../src/agent-manager.ts";
import type { ScheduleTimers } from "../src/schedule.ts";
import type { MentionCloneDependencies } from "../src/mention-clone.ts";
const { runMentionClone } = await import("../src/mention-clone.ts");
const { SubagentScheduler } = await import("../src/schedule.ts");
const { ScheduleStore } = await import("../src/schedule-store.ts");
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function cloneFixture() {
  const reload = deferred<void>(), create = deferred<void>(), prompt = deferred<void>();
  const counts = { reload: 0, create: 0, prompt: 0, abort: 0, dispose: 0, spawn: 0 };
  let tool!: ToolDefinition;
  const session = { async prompt() { counts.prompt++; await prompt.promise; }, async abort() { counts.abort++; prompt.resolve(); }, dispose() { counts.dispose++; } } as unknown as AgentSession;
  const dependencies: MentionCloneDependencies = {
    createLoader: () => ({ async reload() { counts.reload++; await reload.promise; } }),
    async createSession(options) { counts.create++; tool = options!.customTools![0]!; await create.promise; return { session } as Awaited<ReturnType<MentionCloneDependencies["createSession"]>>; },
  };
  const ctx = { cwd: tmpdir(), getSystemPrompt: () => "parent", modelRegistry: {}, sessionManager: { getBranch: () => [], getSessionId: () => "origin" } } as unknown as ExtensionContext;
  const agentTool: ToolDefinition = { name: "Agent", label: "Agent", description: "offline", parameters: Type.Object({}), async execute(_id: string, params: unknown) { counts.spawn++; assert.equal((params as { run_in_background: boolean }).run_in_background, true); return { content: [], details: {} }; } };
  return { reload, create, prompt, counts, session, ctx, dependencies, agentTool, tool: () => tool };
}
void it("actual clone cancellation after reload prevents create, late create only locally disposes", async () => {
  for (const boundary of ["reload", "create"] as const) {
    const f = cloneFixture(), controller = new AbortController();
    const work = runMentionClone({ ctx: f.ctx, type: "general-purpose", message: "test", agentTool: f.agentTool, dependencies: f.dependencies, signal: controller.signal });
    if (boundary === "create") { f.reload.resolve(); await tick(); }
    controller.abort(); f.reload.resolve(); f.create.resolve();
    const result = await work;
    assert.equal(result.spawned, false); assert.equal(f.counts.prompt, 0); assert.equal(f.counts.spawn, 0);
    assert.equal(f.counts.create, boundary === "create" ? 1 : 0); assert.equal(f.counts.dispose, boundary === "create" ? 1 : 0);
  }
});
void it("actual clone aborts owned prompt; its retained Agent callback cannot spawn after close", async () => {
  const f = cloneFixture(), controller = new AbortController(); f.reload.resolve(); f.create.resolve();
  const work = runMentionClone({ ctx: f.ctx, type: "general-purpose", message: "test", agentTool: f.agentTool, dependencies: f.dependencies, signal: controller.signal });
  await tick(); assert.equal(f.counts.prompt, 1); controller.abort(); await work;
  const result = await f.tool().execute("clone", {}, undefined, undefined, f.ctx as never);
  assert.equal(result.isError, true); assert.deepEqual(f.counts, { reload: 1, create: 1, prompt: 1, abort: 1, dispose: 1, spawn: 0 });
});
void it("actual clone attempts one forced-background Agent call and never retries a throwing admission", async () => {
  const f = cloneFixture(); f.reload.resolve(); f.create.resolve();
  f.agentTool.execute = async () => { f.counts.spawn++; throw new Error("admitted then failed"); };
  const work = runMentionClone({ ctx: f.ctx, type: "general-purpose", message: "test", agentTool: f.agentTool, dependencies: f.dependencies });
  await tick(); await assert.rejects(f.tool().execute("one", {}, undefined, undefined, f.ctx as never), /admitted/);
  assert.equal((await f.tool().execute("two", {}, undefined, undefined, f.ctx as never)).isError, true);
  f.prompt.resolve(); const result = await work;
  assert.equal(result.spawned, false); assert.equal(result.attempted, true); assert.equal(f.counts.spawn, 1);
});

void it("actual scheduler old timer/finalize cannot dispatch or mutate a rebound same-id store", async () => {
  const root = mkdtempSync(join(tmpdir(), "scheduler-owner-"));
  const callbacks: (() => void)[] = [], notices: unknown[] = [];
  const timers: ScheduleTimers = { interval(callback) { callbacks.push(callback); return {} as NodeJS.Timeout; }, once(callback) { callbacks.push(callback); return {} as NodeJS.Timeout; }, cron(_expression, callback) { callbacks.push(callback); return { stop() {}, nextRun: () => null }; }, clear() {} };
  const scheduler = new SubagentScheduler(timers);
  const first = new ScheduleStore(join(root, "first.json")), second = new ScheduleStore(join(root, "second.json"));
  const startup = deferred<void>(), terminal = deferred<void>(); let spawned = 0;
  const manager = { spawn() { spawned++; return "old-agent"; }, awaitStartup: () => startup.promise, getRecord: () => ({ promise: terminal.promise, status: "completed" }) } as unknown as AgentManager;
  const pi = { events: { emit(_name: string, event: unknown) { notices.push(event); } } } as unknown as ExtensionAPI;
  const ctx = { cwd: root, modelRegistry: {} } as unknown as ExtensionContext;
  const job = scheduler.buildJob({ name: "shared", description: "test", schedule: "1h", subagent_type: "general-purpose", prompt: "offline" });
  first.add(job); second.add({ ...job, prompt: "new", runCount: 17 });
  try {
    scheduler.start(pi, ctx, manager, first); callbacks[0]!(); assert.equal(spawned, 1);
    scheduler.start(pi, ctx, manager, second);
    const before = readFileSync(join(root, "second.json"), "utf8"), noticeCount = notices.length;
    callbacks[0]!(); startup.resolve(); terminal.resolve(); await scheduler.drain();
    assert.equal(spawned, 1); assert.equal(notices.length, noticeCount); assert.equal(readFileSync(join(root, "second.json"), "utf8"), before);
    assert.equal(second.get(job.id)?.runCount, 17); assert.ok(scheduler.getNextRun(job.id));
    scheduler.stop("shutdown"); callbacks[1]!(); assert.equal(spawned, 1); assert.equal(second.get(job.id)?.enabled, true);
  } finally { startup.resolve(); terminal.resolve(); scheduler.stop("shutdown"); await scheduler.drain(); rmSync(root, { recursive: true, force: true }); }
});

void it("actual scheduler once and cron callbacks retain binding and shutdown cancels its executing child signal", async () => {
  const root = mkdtempSync(join(tmpdir(), "schedule-kind-owner-")), callbacks: (() => void)[] = [];
  const timers: ScheduleTimers = { interval(callback) { callbacks.push(callback); return {} as NodeJS.Timeout; }, once(callback) { callbacks.push(callback); return {} as NodeJS.Timeout; }, cron(_expression, callback) { callbacks.push(callback); return { stop() {}, nextRun: () => null }; }, clear() {} };
  const scheduler = new SubagentScheduler(timers), first = new ScheduleStore(join(root, "first.json")), second = new ScheduleStore(join(root, "second.json"));
  let spawned = 0, childSignal: AbortSignal | undefined;
  const manager = { spawn(_pi: unknown, _ctx: unknown, _type: unknown, _prompt: unknown, options: { signal: AbortSignal }) { spawned++; childSignal = options.signal; return "agent"; }, async awaitStartup() {}, getRecord: () => ({ promise: Promise.resolve(), status: "completed" }) } as unknown as AgentManager;
  const pi = { events: { emit() {} } } as unknown as ExtensionAPI, ctx = { cwd: root, modelRegistry: {} } as unknown as ExtensionContext;
  const once = scheduler.buildJob({ name: "once", description: "test", schedule: "+1h", subagent_type: "general-purpose", prompt: "once" });
  const cron = scheduler.buildJob({ name: "cron", description: "test", schedule: "0 * * * * *", subagent_type: "general-purpose", prompt: "cron" });
  first.add(once); first.add(cron); second.add(once); second.add(cron);
  try {
    scheduler.start(pi, ctx, manager, first); scheduler.start(pi, ctx, manager, second);
    const before = readFileSync(join(root, "first.json"), "utf8"); callbacks[0]!(); callbacks[1]!();
    assert.equal(spawned, 0); assert.equal(readFileSync(join(root, "first.json"), "utf8"), before); assert.equal(second.get(once.id)?.enabled, true);
    callbacks[3]!(); assert.equal(spawned, 1); assert.equal(childSignal?.aborted, false);
    scheduler.stop("shutdown"); assert.equal(childSignal?.aborted, true); await scheduler.drain();
    assert.equal(second.get(cron.id)?.enabled, true);
  } finally { scheduler.stop("shutdown"); await scheduler.drain(); rmSync(root, { recursive: true, force: true }); }
});

void it("actual workflow host gate observes cancellation and drain waits for the real pi.exec promise", async () => {
  const { createWorkflowHost } = await import("../src/workflow/host.ts");
  const response = deferred<{ code: number; stdout: string; stderr: string; killed: boolean }>();
  const controller = new AbortController(), owned = new Set<Promise<unknown>>(); let calls = 0, signal: AbortSignal | undefined;
  const host = createWorkflowHost({ pi: { exec(_file: string, _args: string[], options: { signal: AbortSignal }) { calls++; signal = options.signal; return response.promise; } } as unknown as ExtensionAPI,
    ctx: { cwd: tmpdir() } as ExtensionContext, manager: {} as AgentManager, signal: controller.signal,
    own<T>(start: () => Promise<T>) { const promise = start(); owned.add(promise); void promise.then(() => owned.delete(promise), () => owned.delete(promise)); return promise; },
  });
  const gate = host.runGate!("verify", { agentId: "owned" });
  controller.abort(); assert.equal(signal?.aborted, true); assert.equal(owned.size, 1);
  response.resolve({ code: 0, stdout: "late", stderr: "", killed: false });
  await assert.rejects(gate, /closing/); assert.equal(owned.size, 0);
  await assert.rejects(host.runGate!("new", { agentId: "owned" }), /closing/); assert.equal(calls, 1);
});

void it("actual RPC retained callbacks and late spawn reply ignore closing activation", async () => {
  const { registerRpcHandlers } = await import("../src/cross-extension-rpc.ts");
  const callbacks = new Map<string, (value: unknown) => void>(); const replies: unknown[] = [], startup = deferred<void>(); let active = true, spawns = 0;
  const handle = registerRpcHandlers({ events: { on(name, callback) { callbacks.set(name, callback); return () => callbacks.delete(name); }, emit(_name, value) { replies.push(value); } },
    pi: {}, getCtx: () => ({}), isActive: () => active,
    manager: { spawn() { spawns++; return "old"; }, awaitStartup: () => startup.promise, abort: () => true, getRecord: () => ({}), consumeResult: () => true },
  });
  const spawn = callbacks.get("subagents:rpc:spawn")!;
  spawn({ requestId: "old", type: "general-purpose", prompt: "old" }); assert.equal(spawns, 1);
  active = false; Object.values(handle).forEach(off => off()); startup.resolve(); await tick();
  spawn({ requestId: "late", type: "general-purpose", prompt: "late" }); await tick();
  assert.equal(spawns, 1); assert.equal(replies.length, 0); assert.equal(callbacks.size, 0);
});

void it("actual clone reports only successful admission, preserves origin and forces background once", async () => {
  const f = cloneFixture(); f.reload.resolve(); f.create.resolve();
  f.agentTool.execute = async (_id, params, _signal, _update, ctx) => {
    assert.equal(ctx, f.ctx); assert.equal((params as { run_in_background: boolean }).run_in_background, true); f.counts.spawn++;
    return { content: [], details: { agentId: "admitted" } };
  };
  const work = runMentionClone({ ctx: f.ctx, type: "general-purpose", message: "test", agentTool: f.agentTool, dependencies: f.dependencies });
  await tick(); await f.tool().execute("clone", { run_in_background: false }, undefined, undefined, f.ctx as never);
  f.prompt.resolve(); assert.equal((await work).spawned, true); assert.equal(f.counts.spawn, 1); assert.equal(f.counts.dispose, 1);
});


void it("RPC captures validated reply identity across delayed startup and request mutation", async () => {
  const { registerRpcHandlers } = await import("../src/cross-extension-rpc.ts");
  for (const fail of [false, true]) {
    const callbacks = new Map<string, (value: unknown) => void>(), replies: string[] = [];
    const startup = deferred<void>();
    const handle = registerRpcHandlers({ events: { on(name, callback) { callbacks.set(name, callback); return () => callbacks.delete(name); }, emit(name) { replies.push(name); } },
      pi: {}, getCtx: () => ({}), manager: { spawn: () => "agent", awaitStartup: async () => { await startup.promise; if (fail) throw new Error("startup failed"); },
        abort: () => true, getRecord: () => ({}), consumeResult: () => true },
    });
    try {
      const request: { requestId?: string; type: string; prompt: string } = { requestId: "original", type: "general-purpose", prompt: "offline" };
      callbacks.get("subagents:rpc:spawn")!(request); delete request.requestId;
      startup.resolve(); await tick();
      assert.deepEqual(replies, ["subagents:rpc:spawn:reply:original"]);
    } finally { Object.values(handle).forEach(off => off()); }
  }
});
