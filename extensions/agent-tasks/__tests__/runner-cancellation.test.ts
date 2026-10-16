import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { AgentSession, AgentSessionEvent, DefaultResourceLoader, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import "./source-loader.mjs";
import type { AgentRunnerDependencies, RunOptions } from "../src/agent-runner.ts";
const { runAgent, resumeAgent, setRememberAgents, shutdownChildSession, setDefaultMaxTurns, getDefaultMaxTurns } = await import("../src/agent-runner.ts");
const { AgentManager } = await import("../src/agent-manager.ts");
const { TaskCoordinator } = await import("../../task-ui/coordinator.ts");
const { registerAgentWait } = await import("../src/waits.ts");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
type Boundary = "env" | "reload" | "create" | "bind" | "callback" | "prompt";

// Only the three expensive host inputs are replaced. The actual runner builds
// its prompt, binds the session, forwards abort, subscribes, and calls prompt.
function fixture(boundary?: Boundary) {
  const root = mkdtempSync(join(tmpdir(), "agent-real-runner-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  setRememberAgents(false);
  const gate = deferred(), reached = deferred(), controller = new AbortController();
  const calls = { env: 0, reload: 0, create: 0, bind: 0, prompt: 0, abort: 0, shutdown: 0, dispose: 0, ready: 0 };
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  async function delay(at: Boundary) { if (boundary === at) { reached.resolve(); await gate.promise; } }
  const session = {
    messages: [], setSessionName() {}, sessionManager: { getSessionFile: () => undefined },
    bindExtensions: async () => { calls.bind++; await delay("bind"); },
    subscribe(listener: (event: AgentSessionEvent) => void) {
      listeners.add(listener);
      if (boundary === "prompt") controller.abort();
      return () => { listeners.delete(listener); };
    },
    prompt: async () => { calls.prompt++; }, abort: async () => { calls.abort++; }, steer: async () => {},
    extensionRunner: { hasHandlers: () => true, emit: async () => { calls.shutdown++; } },
    dispose() { calls.dispose++; },
  } as unknown as AgentSession;
  const deps: AgentRunnerDependencies = {
    detectEnv: async () => { calls.env++; await delay("env"); return { isGitRepo: false, branch: "", platform: "test" }; },
    createResourceLoader: () => ({ reload: async () => { calls.reload++; await delay("reload"); } }) as unknown as DefaultResourceLoader,
    createAgentSession: async () => { calls.create++; await delay("create"); return { session } as Awaited<ReturnType<NonNullable<AgentRunnerDependencies["createAgentSession"]>>>; },
  };
  const ctx = { cwd: root, getSystemPrompt: () => "", modelRegistry: {}, sessionManager: { getBranch: () => [], getSessionFile: () => undefined } } as unknown as ExtensionContext;
  const pi = {} as ExtensionAPI;
  const options: RunOptions = { pi, isolated: true, signal: controller.signal,
    onSessionCreated() { calls.ready++; if (boundary === "callback") controller.abort(); },
  };
  return { deps, ctx, pi, options, controller, session, calls, gate, reached, listeners,
    async close() {
      gate.resolve(); await shutdownChildSession(session);
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

for (const boundary of ["env", "reload", "create", "bind", "callback", "prompt"] as const) {
  void it(`actual runner cancellation at ${boundary} never starts a prompt and closes partial sessions once`, async () => {
    const f = fixture(boundary);
    try {
      const result = runAgent(f.ctx, "general-purpose", "must not prompt", f.options, f.deps);
      const rejection = assert.rejects(result, /cancelled/);
      if (boundary !== "callback" && boundary !== "prompt") {
        await f.reached.promise; f.controller.abort(); f.gate.resolve();
      }
      await rejection;
      assert.equal(f.calls.prompt, 0);
      assert.equal(f.listeners.size, 0);
      assert.equal(f.calls.create, ["env", "reload"].includes(boundary) ? 0 : 1);
      assert.equal(f.calls.dispose, ["env", "reload"].includes(boundary) ? 0 : 1);
      assert.equal(f.calls.shutdown, f.calls.dispose);
      if (f.calls.create) { await shutdownChildSession(f.session); assert.equal(f.calls.dispose, 1); }
    } finally { await f.close(); }
  });
}

void it("actual runner already-aborted launch/resume do no startup, subscriptions or prompt", async () => {
  const f = fixture();
  try {
    f.controller.abort();
    await assert.rejects(runAgent(f.ctx, "general-purpose", "no", f.options, f.deps), /cancelled/);
    await assert.rejects(resumeAgent(f.session, "no", { signal: f.controller.signal }), /cancelled/);
    assert.equal(f.calls.env, 0); assert.equal(f.calls.prompt, 0); assert.equal(f.listeners.size, 0);
  } finally { await f.close(); }
});

void it("actual manager/runner delayed startup stays starting; Esc/x cancels and releases the admission for a replacement", async () => {
  for (const stop of ["parent", "backend"] as const) {
    const f = fixture("bind");
    const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
      runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
    });
    try {
      const parent = new AbortController();
      const id = manager.spawn(f.pi, f.ctx, "general-purpose", "cancel", { description: "cancel", isBackground: false, isolated: true, signal: parent.signal });
      await f.reached.promise;
      assert.equal(manager.getRecord(id)?.starting, true);
      if (stop === "parent") parent.abort(); else manager.stopRun(manager.getRun(id)!.identity);
      f.gate.resolve(); await tick();
      assert.equal(f.calls.prompt, 0); assert.equal(manager.isRunActive(id), false);
      assert.equal(manager.getRecord(id)?.status, "stopped");
      assert.equal(f.calls.dispose, 1);
      manager.spawn(f.pi, f.ctx, "general-purpose", "replacement", { description: "replacement", isBackground: true, isolated: true });
      await tick(); assert.equal(f.calls.prompt, 1, "cancelled startup cannot retain pool capacity");
    } finally { await manager.dispose(); await f.close(); }
  }
});

void it("actual runner normal new/resume and parent-detached delayed startup still prompt exactly once per run", async () => {
  const f = fixture("env"), coordinator = new TaskCoordinator();
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  try {
    const parent = new AbortController();
    const id = manager.spawn(f.pi, f.ctx, "general-purpose", "continue", { description: "continue", signal: parent.signal, isolated: true, isBackground: false });
    const wait = registerAgentWait(manager, coordinator, manager.getRun(id)!, "launch", parent.signal);
    await f.reached.promise; coordinator.detachAll(); await wait.result; parent.abort();
    assert.equal(manager.getRecord(id)?.abortController?.signal.aborted, false);
    f.gate.resolve(); await tick(); assert.equal(f.calls.prompt, 1); assert.equal(manager.getRecord(id)?.starting, false);
    await resumeAgent(f.session, "resume"); assert.equal(f.calls.prompt, 2); assert.equal(f.listeners.size, 0);
  } finally { coordinator.dispose(); await manager.dispose(); await f.close(); }
});

for (const initial of [2, undefined]) {
  void it(`actual manager/runner freezes ${initial ?? "unlimited"} turns across delayed bind and resume`, async () => {
    const f = fixture("bind"), coordinator = new TaskCoordinator();
    const { createAgentTaskSource } = await import("../src/source.ts");
    const previous = getDefaultMaxTurns();
    const notices: (number | undefined)[] = [], boundaries: (number | undefined)[] = [];
    const manager = new AgentManager(record => { notices.push(record.maxTurns); }, 1, undefined, undefined, undefined, {
      runAgent: (ctx, type, prompt, options) => {
        boundaries.push(options.maxTurns);
        return runAgent(ctx, type, prompt, options, f.deps);
      },
      resumeAgent: async (session, prompt, options) => {
        boundaries.push(options?.maxTurns);
        // A default change before the real resume must not affect this run.
        setDefaultMaxTurns(9);
        return resumeAgent(session, prompt, options);
      },
    });
    const source = createAgentTaskSource(manager, coordinator, new Map());
    let steers = 0;
    const steerAt: number[] = [];
    f.session.steer = async () => { steers++; steerAt.push(manager.listAgents()[0]!.turnCount!); return "queued"; };
    f.session.prompt = async () => {
      for (let i = 0; i < 3; i++) for (const callback of f.listeners) callback({ type: "turn_end" } as AgentSessionEvent);
    };
    try {
      setDefaultMaxTurns(initial);
      const id = manager.spawn(f.pi, f.ctx, "general-purpose", "frozen", { description: "frozen", isolated: true, invocation: {} });
      await f.reached.promise;
      assert.equal(manager.getRecord(id)?.maxTurns, initial);
      assert.equal(manager.getRecord(id)?.invocation?.maxTurns, initial);
      setDefaultMaxTurns(3); f.gate.resolve(); await manager.waitForAll();
      assert.equal(steers, initial === undefined ? 0 : 1, "unlimited cannot re-read a later limit");
      assert.deepEqual(steerAt, initial === undefined ? [] : [initial], "limited run steers at admission limit, not changed default");
      assert.equal(source.list().find(row => row.taskId === id)?.stats.maxTurns, initial);
      setDefaultMaxTurns(initial);
      assert.ok(manager.resumeRun(id, "frozen resume")); await manager.waitForAll();
      assert.equal(steers, initial === undefined ? 0 : 2);
      assert.equal(manager.getRecord(id)?.maxTurns, initial);
      assert.equal(manager.getRecord(id)?.invocation?.maxTurns, initial);
      assert.equal(source.list().find(row => row.taskId === id)?.stats.maxTurns, initial);
      assert.deepEqual(notices, [initial, initial]);
      assert.deepEqual(boundaries, [initial ?? 0, initial ?? 0], "runtime unlimited is explicit, never absent");
      assert.equal(f.listeners.size, 0);
    } finally { source.dispose(); coordinator.dispose(); await manager.dispose(); await f.close(); setDefaultMaxTurns(previous); }
  });
}

void it("actual runner callback failure closes exposed session once even through manager disposal", async () => {
  const f = fixture(), failure = new Error("session callback failure");
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  try {
    f.session.sessionManager.getSessionFile = () => join(f.ctx.cwd, "partial-session.jsonl");
    const id = manager.spawn(f.pi, f.ctx, "general-purpose", "no", { description: "failure", isolated: true, onSessionCreated() { throw failure; } });
    await tick();
    assert.equal(manager.getRecord(id)?.status, "error"); assert.equal(manager.getRecord(id)?.error, failure.message);
    assert.equal(manager.isRunActive(id), false); assert.equal(f.calls.prompt, 0);
    assert.equal(f.calls.shutdown, 1); assert.equal(f.calls.dispose, 1);
    assert.equal(manager.getRecord(id)?.session, undefined);
    assert.equal(manager.getRecord(id)?.sessionFile, undefined);
    assert.equal(manager.resumeRun(id, "cannot resume disposed startup"), undefined);
    await manager.dispose(); assert.equal(f.calls.dispose, 1);
  } finally { await manager.dispose(); await f.close(); }
});

void it("actual runner structured retry remains cancelled after a first prompt and resume turn accounting resets per invocation", async () => {
  const f = fixture();
  try {
    const { compileJsonSchema } = await import("../src/workflow/json-schema.ts");
    f.session.prompt = async () => { f.calls.prompt++; f.controller.abort(); };
    const schema = compileJsonSchema({ type: "object" });
    assert.ok(schema.ok);
    const result = await runAgent(f.ctx, "general-purpose", "schema", { ...f.options, structuredOutput: schema.compiled }, f.deps);
    assert.equal(f.calls.prompt, 1); assert.equal(result.structuredRetried, undefined);
    assert.equal(f.listeners.size, 0);
    f.session.prompt = async () => {
      f.calls.prompt++;
      for (const callback of f.listeners) callback({ type: "turn_end" } as AgentSessionEvent);
    };
    const turns: number[] = [];
    await resumeAgent(f.session, "first", { onTurnEnd: count => turns.push(count) });
    await resumeAgent(f.session, "second", { onTurnEnd: count => turns.push(count) });
    assert.deepEqual(turns, [1, 1]); assert.equal(f.listeners.size, 0);
  } finally { await f.close(); }
});

for (const resume of [false, true]) void it(`${resume ? "resume" : "new"} subscription setup failure cleans earlier listeners before prompting`, async () => {
  const f = fixture(), failure = new Error("collector subscription failed");
  try {
    const original = f.session.subscribe.bind(f.session); let subscriptions = 0;
    f.session.subscribe = listener => { if (++subscriptions === 2) throw failure; return original(listener); };
    const work = resume
      ? resumeAgent(f.session, "no", { signal: f.controller.signal, onTurnEnd() {} })
      : runAgent(f.ctx, "general-purpose", "no", f.options, f.deps);
    await assert.rejects(work, error => error === failure);
    assert.equal(f.listeners.size, 0); assert.equal(f.calls.prompt, 0);
    assert.equal(f.calls.dispose, resume ? 0 : 1);
    const aborts = f.calls.abort;
    f.controller.abort(); assert.equal(f.calls.abort, aborts, "setup failure must unlink the parent abort listener");
  } finally { await f.close(); }
});

void it("actual new/resume retain soft steering and hard turn limit enforcement", async () => {
  const f = fixture();
  try {
    const { getGraceTurns } = await import("../src/agent-runner.ts");
    let steers = 0;
    f.session.steer = async () => { steers++; return "queued"; };
    f.session.prompt = async () => {
      for (let i = 0; i < 2 + getGraceTurns(); i++) for (const callback of f.listeners) callback({ type: "turn_end" } as AgentSessionEvent);
    };
    const result = await runAgent(f.ctx, "general-purpose", "limited", { ...f.options, maxTurns: 2 }, f.deps);
    assert.equal(result.aborted, true); assert.equal(result.steered, true); assert.equal(steers, 1); assert.equal(f.calls.abort, 1);
    const resumed = await resumeAgent(f.session, "limited again", { maxTurns: 2 });
    assert.equal(Reflect.get(resumed, "aborted"), true);
    assert.equal(steers, 2); assert.equal(f.calls.abort, 2); assert.equal(f.listeners.size, 0);
  } finally { await f.close(); }
});

void it("actual prompt failure retains live session for resume unlike disposed startup", async () => {
  const f = fixture(), failure = new Error("provider prompt rejected");
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  try {
    f.session.prompt = async () => { throw failure; };
    const id = manager.spawn(f.pi, f.ctx, "general-purpose", "fail prompt", { description: "provider", isolated: true });
    await tick();
    assert.equal(manager.getRecord(id)?.session, f.session); assert.equal(f.calls.dispose, 0);
    const old = manager.getRun(id)!; assert.equal((await old.terminal).status, "error");
    f.session.prompt = async () => { f.calls.prompt++; };
    assert.ok(manager.resumeRun(id, "retry")); await tick();
    assert.equal(manager.getRecord(id)?.status, "completed"); assert.equal(f.calls.prompt, 1);
    assert.notEqual(manager.getRun(id)?.identity.runId, old.identity.runId);
    assert.equal((await old.terminal).status, "error", "prior run snapshot stays unchanged");
    await manager.dispose(); await manager.dispose(); assert.equal(f.calls.dispose, 1);
  } finally { await manager.dispose(); await f.close(); }
});

void it("actual resume outcome flags and manager terminal priority preserve current text, stats and prior run snapshots", async () => {
  const { getGraceTurns } = await import("../src/agent-runner.ts");
  for (const kind of ["hard", "soft", "provider", "stopped"] as const) {
    const f = fixture(), notices: string[] = [];
    const manager = new AgentManager(record => { notices.push(record.status); }, 1, undefined, undefined, undefined, {
      runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
    });
    try {
      const id = manager.spawn(f.pi, f.ctx, "general-purpose", "first", { description: kind, isolated: true });
      await tick(); const prior = manager.getRun(id)!;
      const turns = kind === "soft" ? 2 : kind === "provider" ? 1 : 2 + getGraceTurns();
      f.session.prompt = async () => {
        for (let i = 0; i < turns; i++) for (const callback of f.listeners) callback({ type: "turn_end" } as AgentSessionEvent);
        // Offline SDK message boundary: only fields consumed by text/error
        // collection are needed; no provider or usage transport is invoked.
        f.session.messages.push({ role: "assistant", content: [{ type: "text", text: `${kind} current text` }], stopReason: kind === "provider" || kind === "hard" ? "error" : "stop", errorMessage: "provider failure" } as unknown as AgentSession["messages"][number]);
        if (kind === "stopped") manager.abort(id);
      };
      if (kind !== "stopped") {
        const outcome = await resumeAgent(f.session, "direct", { maxTurns: 2 });
        assert.equal(Reflect.get(outcome, "aborted"), kind === "hard");
        assert.equal(Reflect.get(outcome, "steered"), kind !== "provider");
        assert.equal(outcome.text, `${kind} current text`);
      }
      manager.resumeRun(id, "current", undefined, { maxTurns: 2 });
      const current = manager.getRun(id)!; await tick();
      const record = manager.getRecord(id)!;
      const expected = kind === "hard" ? "aborted" : kind === "soft" ? "steered" : kind === "provider" ? "error" : "stopped";
      assert.equal(record.status, expected); assert.equal(notices.at(-1), expected);
      assert.equal(record.turnCount, turns); assert.equal(record.maxTurns, 2); assert.equal(record.result, `${kind} current text`);
      assert.equal((await current.terminal).status, expected); assert.equal((await prior.terminal).status, "completed");
      assert.notEqual(current.identity.runId, prior.identity.runId);
    } finally { await manager.dispose(); await f.close(); }
  }
});

void it("actual workflow host treats hard-aborted resume as non-success without changing workflow decisions", async () => {
  const f = fixture();
  const { createWorkflowHost } = await import("../src/workflow/host.ts");
  const { registerAgents } = await import("../src/agent-types.ts");
  const { setDefaultMaxTurns, getDefaultMaxTurns, getGraceTurns } = await import("../src/agent-runner.ts");
  const previousLimit = getDefaultMaxTurns(); setDefaultMaxTurns(2); registerAgents(new Map());
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, { ...options, isolated: true }, f.deps),
  });
  try {
    const host = createWorkflowHost({ pi: f.pi, ctx: f.ctx, manager, workflowId: "followup-outcome" });
    assert.equal((await host.spawnAgent({ agentId: "wf-child", index: 0, prompt: "first", label: "first", agentType: "general-purpose" })).ok, true);
    f.session.prompt = async () => {
      for (let i = 0; i < 2 + getGraceTurns(); i++) for (const callback of f.listeners) callback({ type: "turn_end" } as AgentSessionEvent);
    };
    assert.ok(host.resumeAgent);
    const outcome = await host.resumeAgent("wf-child", "hard limited");
    assert.equal(outcome.ok, false); assert.match(outcome.error ?? "", /aborted/);
    assert.equal(manager.listAgents()[0]?.status, "aborted");
  } finally { setDefaultMaxTurns(previousLimit); await manager.dispose(); await f.close(); }
});

void it("3B1 stopped terminal is not actual execution drain (new and resume)", async () => {
  const f = fixture();
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  try {
    const id = manager.spawn(f.pi, f.ctx, "general-purpose", "initial", { description: "drain", isolated: true });
    await manager.waitForAll();
    for (const resume of [false, true]) {
      const gate = deferred(), reached = deferred();
      f.session.prompt = async () => { f.calls.prompt++; reached.resolve(); await gate.promise; };
      const active = resume ? manager.resumeRun(id, "resume")!.id : manager.spawn(f.pi, f.ctx, "general-purpose", "new", { description: "new", isolated: true, isBackground: true });
      await reached.promise;
      const run = manager.getRun(active)!;
      manager.abort(active);
      assert.equal((await run.terminal).status, "stopped");
      let drained = false;
      const drain = manager.waitForAll().then(() => { drained = true; });
      await tick();
      const early = drained;
      gate.resolve(); await drain;
      assert.equal(early, false, "terminal settled while actual prompt still owned");
      assert.equal(f.listeners.size, 0);
    }
  } finally { await manager.dispose(); await f.close(); }
});

void it("3B1 freeze during actual create/bind only closes late sessions, with stable disposal", async () => {
  for (const boundary of ["create", "bind"] as const) {
    const f = fixture(boundary), notices: string[] = [];
    const manager = new AgentManager(() => { notices.push("complete"); }, 1, undefined, undefined, undefined, {
      runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
    });
    try {
      const id = manager.spawn(f.pi, f.ctx, "general-purpose", "late", { description: "late", isolated: true,
        onSessionCreated() { notices.push("ready"); }, onTurnEnd() { notices.push("turn"); },
      });
      await f.reached.promise;
      manager.freezeAdmission(); manager.abortAll();
      // Protocol final disposal follows its bounded drain with an explicit seal.
      manager.sealHostEffects();
      const first = manager.dispose(), second = manager.dispose();
      const stable = first === second;
      f.gate.resolve(); await first;
      assert.equal(stable, true, "dispose must return the same owned promise");
      assert.equal(f.calls.prompt, 0); assert.equal(f.calls.shutdown, 0); assert.equal(f.calls.dispose, 1);
      assert.deepEqual(notices, []); assert.equal(manager.listAgents().length, 0);
      assert.equal(manager.getRun(id), undefined); assert.equal(manager.steer(id, "late"), false);
      assert.equal(manager.resumeRun(id, "late"), undefined);
    } finally { await manager.dispose(); await f.close(); }
  }
});

void it("3B1 noncooperative prompt survives bounded close only as an effectless cleanup owner", async () => {
  const f = fixture(), gate = deferred(), reached = deferred(), effects: string[] = [];
  const manager = new AgentManager(() => { effects.push("complete"); }, 1, undefined, undefined, undefined, {
    disposeTimeoutMs: 15,
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  let flushes = 0;
  try {
    f.session.prompt = async () => { f.calls.prompt++; reached.resolve(); await gate.promise; };
    const id = manager.spawn(f.pi, f.ctx, "general-purpose", "noncooperative", { description: "late", isolated: true,
      onSessionCreated() { effects.push("ready"); }, onTurnEnd() { effects.push("turn"); }, onTextDelta() { effects.push("text"); },
    });
    await reached.promise; effects.length = 0;
    manager.getRecord(id)!.outputCleanup = () => { flushes++; throw new Error("flush failed"); };
    const first = manager.dispose(); assert.equal(first, manager.dispose());
    await first;
    assert.equal(manager.listAgents().length, 0); assert.ok(manager.executionCount > 0);
    assert.equal(f.calls.abort, 1); assert.equal(f.calls.dispose, 0, "do not dispose a session still executing prompt");
    for (const listener of f.listeners) listener({ type: "turn_end" } as AgentSessionEvent);
    assert.deepEqual(effects, []); assert.equal(flushes, 1);
    gate.resolve(); await manager.drainExecution();
    assert.equal(manager.executionCount, 0); assert.equal(f.listeners.size, 0);
    assert.equal(f.calls.dispose, 1); assert.equal(f.calls.shutdown, 0, "no late shutdown hooks on invalid host");
    assert.equal(manager.getRecord(id), undefined); assert.deepEqual(effects, []);
  } finally { gate.resolve(); await manager.drainExecution(); await manager.dispose(); await f.close(); }
});

void it("3B1 queued/nested stop drains siblings despite throwing observers and output cleanup", async () => {
  const f = fixture(), gate = deferred(), reached = deferred();
  let ready = 0, output = 0, complete = 0;
  const manager = new AgentManager(() => { complete++; throw new Error("observer"); }, 1, () => { throw new Error("start"); }, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  try {
    f.session.prompt = async () => { reached.resolve(); await gate.promise; };
    const parent = manager.spawn(f.pi, f.ctx, "general-purpose", "parent", { description: "parent", isolated: true, isBackground: true });
    await reached.promise;
    const queued = manager.spawn(f.pi, f.ctx, "general-purpose", "queued", { description: "queued", isolated: true, isBackground: true, onSessionCreated() { ready++; } });
    const child = manager.spawn(f.pi, f.ctx, "general-purpose", "child", { description: "child", isolated: true, parentAgentId: parent });
    await tick();
    for (const record of manager.listAgents()) record.outputCleanup = () => { output++; throw new Error("output"); };
    manager.freezeAdmission(); manager.abortAll();
    const waits = [parent, queued, child].map(id => manager.getRun(id)!.terminal);
    assert.ok((await Promise.all(waits)).every(record => record.status === "stopped"));
    const dispose = manager.dispose(); gate.resolve(); await dispose;
    assert.equal(ready, 0); assert.equal(complete, 0); assert.equal(output, 3);
    assert.equal(f.calls.prompt, 0); // this fixture overrides prompt without incrementing
    assert.equal(f.calls.abort, 1); assert.equal(f.calls.dispose, 1);
    assert.equal(manager.executionCount, 0); assert.equal(manager.listAgents().length, 0);
  } finally { gate.resolve(); await manager.dispose(); await f.close(); }
});

void it("3B1 synchronous onStart closure blocks subsequent resume output setup and prompt", async () => {
  const f = fixture(); let closing = false, outputSetup = 0;
  const manager = new AgentManager(undefined, 1, () => { if (closing) { manager.freezeAdmission(); manager.abortAll(); } }, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  try {
    const id = manager.spawn(f.pi, f.ctx, "general-purpose", "first", { description: "first", isolated: true });
    await manager.waitForAll(); closing = true;
    manager.resumeRun(id, "never", undefined, { onStarted() { outputSetup++; } });
    await manager.dispose();
    assert.equal(outputSetup, 0); assert.equal(f.calls.prompt, 1); assert.equal(f.calls.dispose, 1);
  } finally { await manager.dispose(); await f.close(); }
});

void it("3B1 throwing subscription disposers cannot strand other subscriptions or parent link", async () => {
  for (const resume of [false, true]) {
    const f = fixture(); let cleaned = 0;
    try {
      const original = f.session.subscribe.bind(f.session);
      f.session.subscribe = listener => {
        const off = original(listener);
        return () => { off(); cleaned++; throw new Error("unsubscribe failed"); };
      };
      if (resume) await resumeAgent(f.session, "resume", { signal: f.controller.signal, onTurnEnd() {} });
      else await runAgent(f.ctx, "general-purpose", "new", f.options, f.deps);
      assert.equal(cleaned, 2); assert.equal(f.listeners.size, 0);
      f.controller.abort(); assert.equal(f.calls.abort, 0, "abort listener still unlinks after teardown failure");
    } finally { await f.close(); }
  }
});


function hookResource(f: ReturnType<typeof fixture>, fail = false) {
  // Observe extension cleanup ownership without creating an OS timer.
  let active = false;
  f.session.bindExtensions = async () => { f.calls.bind++; active = true; };
  const emit = async () => {
    f.calls.shutdown++;
    active = false;
    if (fail) throw new Error("child shutdown failed");
  };
  // Generic SDK emit has private runtime events; this partial seam implements
  // only session_shutdown, the exact event exercised by actual runner teardown.
  Object.defineProperty(f.session, "extensionRunner", { value: { hasHandlers: () => true, emit }, configurable: true });
  return { get active() { return active; }, release() { active = false; } };
}

for (const direct of [false, true]) void it(`completed child shutdown releases retained resources through ${direct ? "direct dispose" : "stop/drain"}`, async () => {
  const f = fixture(), resource = hookResource(f);
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  try {
    const id = manager.spawn(f.pi, f.ctx, "general-purpose", "completed", { description: "retained", isolated: true, workflowId: "active-owner" });
    manager.setOwnerRetention(() => true);
    await manager.waitForAll(); assert.equal(resource.active, true);
    if (!direct) {
      manager.freezeAdmission(); manager.stopForShutdown(); await manager.drainExecution();
      assert.equal(f.calls.shutdown, 1); assert.equal(resource.active, false);
      manager.sealHostEffects();
    }
    const close = manager.dispose(); assert.equal(close, manager.dispose()); await close;
    assert.equal(f.calls.shutdown, 1); assert.equal(resource.active, false);
    assert.equal(f.calls.dispose, 1); assert.equal(manager.getRecord(id), undefined);
  } finally { resource.release(); await manager.dispose(); await f.close(); }
});

void it("3B1 followup shutdown stops running child before disposal and includes completed retained parent", async () => {
  const done = fixture(), active = fixture(), doneResource = hookResource(done), activeResource = hookResource(active);
  const gate = deferred(), reached = deferred();
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, prompt === "parent" ? done.deps : active.deps),
  });
  try {
    const parent = manager.spawn(done.pi, done.ctx, "general-purpose", "parent", { description: "completed parent", isolated: true });
    await manager.waitForAll(); manager.setOwnerRetention(() => true);
    active.session.prompt = async () => { active.calls.prompt++; reached.resolve(); await gate.promise; };
    active.session.abort = async () => { active.calls.abort++; gate.resolve(); };
    active.session.dispose = () => { assert.equal(active.calls.abort, 1, "cancel actual prompt before local disposal"); active.calls.dispose++; };
    manager.spawn(active.pi, active.ctx, "general-purpose", "child", { description: "running child", isolated: true, parentAgentId: parent });
    await reached.promise;
    manager.freezeAdmission(); assert.equal(manager.stopForShutdown(), 1); assert.equal(manager.stopForShutdown(), 0);
    await manager.drainExecution();
    assert.equal(done.calls.shutdown, 1); assert.equal(active.calls.shutdown, 1);
    assert.equal(doneResource.active, false); assert.equal(activeResource.active, false);
    manager.sealHostEffects(); await manager.dispose();
    assert.equal(done.calls.dispose, 1); assert.equal(active.calls.dispose, 1); assert.equal(manager.executionCount, 0);
  } finally { gate.resolve(); doneResource.release(); activeResource.release(); await manager.dispose(); await active.close(); await done.close(); }
});

void it("3B1 followup throwing completed child hook cannot block sibling resource cleanup", async () => {
  const first = fixture(), second = fixture(), one = hookResource(first, true), two = hookResource(second);
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, prompt === "first" ? first.deps : second.deps),
  });
  try {
    manager.spawn(first.pi, first.ctx, "general-purpose", "first", { description: "first", isolated: true });
    manager.spawn(second.pi, second.ctx, "general-purpose", "second", { description: "second", isolated: true });
    await manager.waitForAll(); manager.setOwnerRetention(() => true);
    manager.freezeAdmission(); manager.stopForShutdown(); await manager.drainExecution();
    assert.equal(first.calls.shutdown, 1); assert.equal(second.calls.shutdown, 1);
    assert.equal(one.active, false); assert.equal(two.active, false);
    manager.sealHostEffects(); await manager.dispose();
    assert.equal(first.calls.dispose, 1); assert.equal(second.calls.dispose, 1);
  } finally { one.release(); two.release(); await manager.dispose(); await second.close(); await first.close(); }
});

void it("3B1 followup direct dispose timeout seals late created child hooks and keeps artifacts", async () => {
  const f = fixture("create"), artifact = join(f.ctx.cwd, "session-kept.jsonl");
  const { writeFileSync, readFileSync } = await import("node:fs");
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    disposeTimeoutMs: 10,
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  try {
    writeFileSync(artifact, "preserve");
    manager.spawn(f.pi, f.ctx, "general-purpose", "late", { description: "late", isolated: true });
    await f.reached.promise;
    const close = manager.dispose(); assert.equal(close, manager.dispose()); await close;
    assert.ok(manager.executionCount > 0); assert.equal(f.calls.shutdown, 0);
    f.gate.resolve(); await manager.drainExecution();
    assert.equal(f.calls.prompt, 0); assert.equal(f.calls.bind, 0); assert.equal(f.calls.shutdown, 0);
    assert.equal(f.calls.dispose, 1); assert.equal(readFileSync(artifact, "utf8"), "preserve");
    assert.equal(manager.listAgents().length, 0); assert.equal(manager.executionCount, 0);
  } finally { f.gate.resolve(); await manager.drainExecution(); await manager.dispose(); await f.close(); }
});

void it("3B1 followup checks host permission at actual hook boundary after hasHandlers", async () => {
  const f = fixture(); let allowed = true;
  try {
    f.session.extensionRunner!.hasHandlers = () => { allowed = false; return true; };
    await shutdownChildSession(f.session, { canEmitShutdown: () => allowed });
    assert.equal(f.calls.shutdown, 0); assert.equal(f.calls.dispose, 1);
  } finally { await f.close(); }
});

void it("3B1 followup pending completed child hook retains owner after direct dispose budget", async () => {
  const f = fixture(), resource = hookResource(f), gate = deferred(), reached = deferred();
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    disposeTimeoutMs: 10,
    runAgent: (ctx, type, prompt, options) => runAgent(ctx, type, prompt, options, f.deps),
  });
  try {
    manager.spawn(f.pi, f.ctx, "general-purpose", "completed", { description: "pending hook", isolated: true });
    await manager.waitForAll();
    const original = f.session.extensionRunner!;
    Object.defineProperty(f.session, "extensionRunner", { value: {
      hasHandlers: () => true,
      emit: async () => { reached.resolve(); await gate.promise; return original.emit({ type: "session_shutdown", reason: "quit" }); },
    }, configurable: true });
    const close = manager.dispose(); await reached.promise; await close;
    assert.equal(resource.active, true); assert.ok(manager.executionCount > 0);
    assert.equal(f.calls.dispose, 0, "pending owned hook not silently discarded on budget timeout");
    gate.resolve(); await manager.drainExecution();
    assert.equal(resource.active, false); assert.equal(f.calls.shutdown, 1); assert.equal(f.calls.dispose, 1);
    assert.equal(manager.executionCount, 0); assert.equal(close, manager.dispose());
  } finally { gate.resolve(); resource.release(); await manager.drainExecution(); await manager.dispose(); await f.close(); }
});
