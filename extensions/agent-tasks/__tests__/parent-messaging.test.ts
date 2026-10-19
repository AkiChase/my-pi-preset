import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { AgentSession, DefaultResourceLoader, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import "./source-loader.mjs";
import type { AgentManagerDependencies } from "../src/agent-manager.ts";
import type { AgentRunnerDependencies, RunOptions, RunResult } from "../src/agent-runner.ts";
const { AgentMailbox, PARENT_MESSAGE_LIMITS, REPLY_TO_PARENT_TOOL_NAME, createReplyToParentTool } = await import("../src/parent-messaging.ts");
const { AgentManager } = await import("../src/agent-manager.ts");
const { runAgent, setRememberAgents, shutdownChildSession } = await import("../src/agent-runner.ts");

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) assert.fail(result.error);
  return result.value;
}
function expectError(result: { ok: boolean; error?: string }, pattern: RegExp): void {
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", pattern);
}

void it("mailbox correlates replies, rejects duplicates and cross-execution ids, and accepts notices", async () => {
  const mailbox = new AgentMailbox();
  mailbox.startRun("1");
  const first = expectOk(mailbox.createRequest("1", "Where is the schema?"));
  const second = expectOk(mailbox.createRequest("1", "Which tests fail?"));
  assert.notEqual(first.requestId, second.requestId);
  const wait = mailbox.waitForReply(second.requestId);

  const reply = expectOk(mailbox.accept("1", "  Two tests fail.  ", second.requestId));
  assert.equal(reply.deliveredToWaiter, true);
  assert.equal(reply.message.text, "Two tests fail.");
  const outcome = await wait.promise;
  assert.equal(outcome.kind, "replied");
  assert.equal(outcome.kind === "replied" && outcome.message.requestId, second.requestId);
  assert.equal(mailbox.getRequest(first.requestId)?.state, "pending");

  expectError(mailbox.accept("1", "again", second.requestId), /already answered/);
  expectError(mailbox.accept("2", "wrong run", first.requestId), /Unknown request_id/);
  expectError(mailbox.accept("1", "unknown", "req_missing"), /Unknown request_id/);
  expectError(mailbox.accept("1", " \n\t", null), /non-whitespace/);

  const notice = expectOk(mailbox.accept("1", "Found drift", null));
  assert.equal(notice.deliveredToWaiter, false);
  assert.equal(notice.message.requestId, null);
  // A settled request answers a later waiter immediately with the same reply.
  const late = await mailbox.waitForReply(second.requestId).promise;
  assert.equal(late.kind === "replied" && late.message.seq, reply.message.seq);
});

void it("mailbox enforces byte, message and request bounds explicitly", () => {
  const mailbox = new AgentMailbox();
  // Multi-byte text is measured in UTF-8 bytes, not code units.
  const tooLong = "界".repeat(Math.floor(PARENT_MESSAGE_LIMITS.messageBytes / 3) + 1);
  expectError(mailbox.accept("1", tooLong, null), /bytes; the limit is 4096/);
  expectOk(mailbox.accept("1", "界".repeat(Math.floor(PARENT_MESSAGE_LIMITS.messageBytes / 3)), null));
  for (let i = 1; i < PARENT_MESSAGE_LIMITS.messagesPerRun; i++) expectOk(mailbox.accept("1", `notice ${i}`, null));
  expectError(mailbox.accept("1", "one too many", null), /limit 30/);
  // The bound is per execution.
  expectOk(mailbox.accept("2", "next run", null));

  const requests = new AgentMailbox();
  for (let i = 0; i < PARENT_MESSAGE_LIMITS.pendingRequests; i++) expectOk(requests.createRequest("1", `q${i}`));
  expectError(requests.createRequest("1", "ninth"), /unanswered requests \(limit 8\)/);
  const answered = requests.listRequests("1")[0]!;
  expectOk(requests.accept("1", "answer", answered.requestId));
  expectOk(requests.createRequest("1", "after a reply"));
  for (const request of requests.listRequests("1")) if (request.state === "pending") requests.failRequest(request.requestId);
  while (requests.listRequests("1").length < PARENT_MESSAGE_LIMITS.requestsPerRun) {
    const request = expectOk(requests.createRequest("1", "filler"));
    requests.failRequest(request.requestId);
  }
  expectError(requests.createRequest("1", "over"), /limit of 30 parent requests/);
});

void it("mailbox waits end on failure, run close or shutdown; cancel only removes that waiter", async () => {
  const mailbox = new AgentMailbox();
  const failed = expectOk(mailbox.createRequest("1", "q"));
  const failedWait = mailbox.waitForReply(failed.requestId);
  mailbox.failRequest(failed.requestId);
  assert.deepEqual(await failedWait.promise, { kind: "failed" });
  expectError(mailbox.accept("1", "late", failed.requestId), /no longer open/);

  const cancelled = expectOk(mailbox.createRequest("1", "q"));
  const releasedWait = mailbox.waitForReply(cancelled.requestId);
  releasedWait.cancel();
  assert.equal(mailbox.hasWaiter(cancelled.requestId), false);
  const late = expectOk(mailbox.accept("1", "late answer", cancelled.requestId));
  assert.equal(late.deliveredToWaiter, false, "a released wait leaves the reply for ordinary delivery");

  const ended = expectOk(mailbox.createRequest("1", "q"));
  const endedWait = mailbox.waitForReply(ended.requestId);
  const other = mailbox.waitForReply(ended.requestId);
  assert.deepEqual(mailbox.closeRun("1", "execution_ended").map(request => request.requestId), [ended.requestId]);
  assert.deepEqual(await endedWait.promise, { kind: "closed", reason: "execution_ended" });
  assert.deepEqual(await other.promise, { kind: "closed", reason: "execution_ended" });
  expectError(mailbox.accept("1", "after end", ended.requestId), /no longer open/);

  const open = expectOk(mailbox.createRequest("2", "q"));
  const shutdownWait = mailbox.waitForReply(open.requestId);
  mailbox.closeAll("shutdown");
  assert.deepEqual(await shutdownWait.promise, { kind: "closed", reason: "shutdown" });
  expectError(mailbox.accept("2", "after shutdown", null), /closed/);
  expectError(mailbox.createRequest("2", "after shutdown"), /closed/);
});

void it("mailbox retains a bounded number of executions", () => {
  const mailbox = new AgentMailbox();
  for (let run = 1; run <= PARENT_MESSAGE_LIMITS.retainedRuns + 2; run++) {
    mailbox.startRun(String(run));
    expectOk(mailbox.accept(String(run), `run ${run}`, null));
  }
  assert.deepEqual([...new Set(mailbox.listMessages().map(message => message.runId))], ["3", "4", "5", "6", "7"]);
});

void it("reply_to_parent schema is fixed, nullable and validated before the channel", async () => {
  const sends: [string, string | null][] = [];
  const channel = { send: (text: string, requestId: string | null) => { sends.push([text, requestId]); return { ok: true as const, value: { message: { seq: 1, runId: "1", requestId, text, at: 0 }, deliveredToWaiter: false } }; } };
  const tool = createReplyToParentTool(channel);
  const again = createReplyToParentTool({ send: () => ({ ok: false, error: "closed" }) });
  // The declaration never depends on the channel or on runtime state.
  for (const field of ["name", "description", "promptSnippet", "promptGuidelines", "parameters"] as const) {
    assert.deepEqual(JSON.stringify(tool[field]), JSON.stringify(again[field]));
  }
  assert.equal(tool.name, REPLY_TO_PARENT_TOOL_NAME);
  assert.deepEqual(Reflect.get(tool.parameters, "required"), ["message", "request_id"]);
  assert.equal(String(tool.promptGuidelines).split("\n")[0], "reply_to_parent usage:");
  const validate = (args: unknown) => validateToolArguments(tool as never, { type: "toolCall", id: "t", name: tool.name, arguments: args as never });
  assert.deepEqual(validate({ message: "hi", request_id: null }), { message: "hi", request_id: null });
  assert.throws(() => validate({ message: "hi" }));
  assert.throws(() => validate({ message: "hi", request_id: null, kind: "blocked" }));

  const run = (args: unknown) => tool.execute("t", args as never, undefined, undefined, {} as never);
  for (const bad of [{ message: "hi" }, { message: "   ", request_id: null }, { message: "hi", request_id: "  " }, { message: "hi", request_id: null, extra: null }]) {
    const result = await run(bad);
    assert.equal(result.isError, true, JSON.stringify(bad));
  }
  assert.equal(sends.length, 0, "refused arguments never reach the channel");
  const notice = await run({ message: "drift", request_id: null });
  assert.notEqual(notice.isError, true);
  assert.match(String(notice.content[0]?.type === "text" && notice.content[0].text), /Notice accepted/);
  const reply = await run({ message: "yes", request_id: " req_1 " });
  assert.match(String(reply.content[0]?.type === "text" && reply.content[0].text), /Reply to req_1 accepted/);
  assert.deepEqual(sends, [["drift", null], ["yes", "req_1"]]);
  const refused = await again.execute("t", { message: "x", request_id: null } as never, undefined, undefined, {} as never);
  assert.equal(refused.isError, true);
});

// Actual runner: only the expensive host inputs are replaced, as in runner-cancellation.
function runnerFixture() {
  const root = mkdtempSync(join(tmpdir(), "agent-parent-channel-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  setRememberAgents(false);
  const sessionOptions: Parameters<NonNullable<AgentRunnerDependencies["createAgentSession"]>>[0][] = [];
  let active: string[] = [];
  const session = {
    messages: [], setSessionName() {}, sessionManager: { getSessionFile: () => undefined },
    bindExtensions: async () => {}, subscribe: () => () => {},
    prompt: async () => {}, abort: async () => {}, steer: async () => {},
    getAllTools: () => ["read", REPLY_TO_PARENT_TOOL_NAME].map(name => ({ name })),
    getActiveToolNames: () => active, setActiveToolsByName: (names: string[]) => { active = names; },
    agent: {},
    extensionRunner: { hasHandlers: () => false, emit: async () => {} }, dispose() {},
  } as unknown as AgentSession;
  const deps: AgentRunnerDependencies = {
    detectEnv: async () => ({ isGitRepo: false, branch: "", platform: "test" }),
    createResourceLoader: () => ({ reload: async () => {}, getExtensions: () => ({ extensions: [] }) }) as unknown as DefaultResourceLoader,
    createAgentSession: async options => { sessionOptions.push(options!); return { session } as Awaited<ReturnType<NonNullable<AgentRunnerDependencies["createAgentSession"]>>>; },
  };
  const ctx = { cwd: root, getSystemPrompt: () => "", modelRegistry: {}, sessionManager: { getBranch: () => [], getSessionFile: () => undefined } } as unknown as ExtensionContext;
  return { deps, ctx, pi: {} as ExtensionAPI, sessionOptions, session, active: () => active,
    async close() {
      await shutdownChildSession(session);
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

void it("actual runner injects reply_to_parent only with a parent channel, including isolated children", async () => {
  const f = runnerFixture();
  try {
    const channel = { send: () => ({ ok: false as const, error: "unused" }) };
    const base: RunOptions = { pi: f.pi, isolated: true };
    await runAgent(f.ctx, "general-purpose", "work", { ...base, parentChannel: channel }, f.deps);
    await runAgent(f.ctx, "general-purpose", "work", { ...base, parentChannel: channel }, f.deps);
    await runAgent(f.ctx, "general-purpose", "work", base, f.deps);
    const [first, second, none] = f.sessionOptions;
    const names = (options: typeof first) => (options!.customTools ?? []).map(tool => (tool as ToolDefinition).name);
    assert.deepEqual(names(first), [REPLY_TO_PARENT_TOOL_NAME]);
    assert.ok(first!.tools?.includes(REPLY_TO_PARENT_TOOL_NAME), "isolated strict allowlist keeps the host tool");
    assert.deepEqual(names(none), []);
    assert.equal(none!.tools?.includes(REPLY_TO_PARENT_TOOL_NAME), false);
    // Two sessions declare byte-identical tool definitions.
    const declaration = (options: typeof first) => {
      const tool = options!.customTools![0] as ToolDefinition;
      return JSON.stringify([tool.name, tool.description, tool.promptSnippet, tool.promptGuidelines, tool.parameters]);
    };
    assert.equal(declaration(first), declaration(second));
  } finally { await f.close(); }
});

void it("actual runner keeps reply_to_parent through extension-mode registry and active-set gates", async () => {
  const f = runnerFixture();
  try {
    const channel = { send: () => ({ ok: false as const, error: "unused" }) };
    await runAgent(f.ctx, "general-purpose", "work", { pi: f.pi, isolated: false, parentChannel: channel }, f.deps);
    const options = f.sessionOptions[0]!;
    assert.equal(options.tools, undefined, "extension mode uses the live registry gate");
    assert.equal(options.excludeTools?.includes(REPLY_TO_PARENT_TOOL_NAME), false);
    assert.ok(f.active().includes(REPLY_TO_PARENT_TOOL_NAME), "the active-set narrow re-admits the host tool");
    const gate = (f.session as unknown as { agent: { beforeToolCall: (context: unknown) => Promise<unknown> } }).agent.beforeToolCall;
    assert.equal(await gate({ toolCall: { name: REPLY_TO_PARENT_TOOL_NAME } }), undefined);
  } finally { await f.close(); }
});

function managerFixture() {
  const calls: { id: string; options: RunOptions; session: AgentSession; finish: (text?: string) => void }[] = [];
  const resumes: { finish: (text?: string) => void }[] = [];
  const deps: AgentManagerDependencies = {
    runAgent: async (_ctx, _type, _prompt, options) => {
      const result = deferred<RunResult>();
      const session = { messages: [], sessionManager: { getSessionFile: () => undefined }, dispose() {}, steer: async () => {}, subscribe: () => () => {} } as unknown as AgentSession;
      calls.push({ id: options.agentId!, options, session, finish: (text = "done") => result.resolve({ responseText: text, session, aborted: false, steered: false }) });
      queueMicrotask(() => options.onSessionCreated?.(session));
      options.signal?.addEventListener("abort", () => result.resolve({ responseText: "stopped", session, aborted: false, steered: false }), { once: true });
      return result.promise;
    },
    resumeAgent: async (_session, _prompt, options) => {
      const result = deferred<{ text: string }>();
      resumes.push({ finish: (text = "resumed") => result.resolve({ text }) });
      options?.signal?.addEventListener("abort", () => result.resolve({ text: "stopped" }), { once: true });
      return result.promise;
    },
  };
  const manager = new AgentManager(undefined, 4, undefined, undefined, undefined, deps);
  const ctx = { cwd: tmpdir() } as ExtensionContext;
  return { manager, calls, resumes,
    spawn: (options: Partial<Parameters<typeof manager.spawn>[4]> = {}) => manager.spawn({} as ExtensionAPI, ctx, "general-purpose", "work", { description: "work", isBackground: true, ...options }),
    async close() { manager.freezeAdmission(); manager.abortAll(); await tick(); await manager.dispose(); },
  };
}

void it("manager gives top-level and nested children a channel, workflow children none", async () => {
  const f = managerFixture();
  try {
    const top = f.spawn();
    const nested = f.spawn({ parentAgentId: top, depth: 2 });
    const workflow = f.spawn({ workflowId: "wf_abcdef" });
    await tick();
    const channelOf = (id: string) => f.calls.find(call => call.id === id)!.options.parentChannel;
    assert.ok(channelOf(top));
    assert.ok(channelOf(nested));
    assert.equal(channelOf(workflow), undefined);
    assert.equal(f.manager.getRecord(workflow)?.mailbox, undefined);
    expectError(f.manager.createParentRequest(workflow, "q"), /no parent message channel/);
  } finally { await f.close(); }
});

void it("manager channel binds the current execution across resume and refuses stale sends", async () => {
  const f = managerFixture();
  try {
    const id = f.spawn();
    await tick();
    const channel = f.calls[0]!.options.parentChannel!;
    const seen: string[] = [];
    const off = f.manager.subscribeParentMessages((record, accepted) => seen.push(`${record.id}:${accepted.message.runId}:${accepted.message.text}`));

    const { request, identity } = expectOk(f.manager.createParentRequest(id, "q1"));
    assert.equal(identity.runId, "1");
    const wait = f.manager.getRecord(id)!.mailbox!.waitForReply(request.requestId);
    expectOk(channel.send("notice one", null));
    f.calls[0]!.finish();
    await tick();
    assert.deepEqual(await wait.promise, { kind: "closed", reason: "execution_ended" });
    expectError(channel.send("after end", null), /closed for this execution/);
    expectError(f.manager.createParentRequest(id, "late"), /not running/);

    assert.ok(f.manager.resumeRun(id, "continue", undefined, { isBackground: true }));
    await tick();
    assert.equal(f.manager.getRun(id)?.identity.runId, "2");
    // The same channel object now addresses the resumed execution.
    expectError(channel.send("stale reply", request.requestId), /Unknown request_id/);
    const next = expectOk(f.manager.createParentRequest(id, "q2"));
    const accepted = expectOk(channel.send("answer two", next.request.requestId));
    assert.equal(accepted.message.runId, "2");
    assert.equal(accepted.deliveredToWaiter, false);
    assert.deepEqual(seen, [`${id}:1:notice one`, `${id}:2:answer two`]);
    off();
    f.resumes[0]!.finish();
    await tick();
  } finally { await f.close(); }
});

void it("manager stop and shutdown close channels and release reply waiters", async () => {
  const f = managerFixture();
  try {
    const stopped = f.spawn();
    const live = f.spawn();
    await tick();
    const stoppedRequest = expectOk(f.manager.createParentRequest(stopped, "q")).request;
    const stoppedWait = f.manager.getRecord(stopped)!.mailbox!.waitForReply(stoppedRequest.requestId);
    f.manager.stopRun(f.manager.getRun(stopped)!.identity);
    expectError(f.calls[0]!.options.parentChannel!.send("after stop", null), /closed/);
    await tick();
    assert.equal((await stoppedWait.promise).kind, "closed");

    const liveRequest = expectOk(f.manager.createParentRequest(live, "q")).request;
    const liveWait = f.manager.getRecord(live)!.mailbox!.waitForReply(liveRequest.requestId);
    let delivered = 0;
    f.manager.subscribeParentMessages(() => { delivered++; });
    f.manager.freezeAdmission();
    assert.deepEqual(await liveWait.promise, { kind: "closed", reason: "shutdown" });
    expectError(f.calls[1]!.options.parentChannel!.send("after shutdown", null), /closed/);
    assert.equal(delivered, 0);
    assert.equal(f.manager.subscribeParentMessages(() => {})(), undefined);
  } finally { await f.close(); }
});

void it("manager stop closes unanswered requests with the terminal, before actual runner exit", async () => {
  const f = managerFixture();
  try {
    const id = f.spawn();
    await tick();
    const { request } = expectOk(f.manager.createParentRequest(id, "q"));
    const run = f.manager.getRun(id)!;
    let stateAtTerminal: string | undefined;
    void run.terminal.then(() => { stateAtTerminal = f.manager.getRecord(id)!.mailbox!.getRequest(request.requestId)?.state; });
    const wait = f.manager.getRecord(id)!.mailbox!.waitForReply(request.requestId);
    assert.equal(f.manager.abort(id), true);
    // Synchronously closed: a non-cooperative runner must not strand the waiter.
    assert.equal(f.manager.getRecord(id)!.mailbox!.getRequest(request.requestId)?.state, "closed");
    assert.deepEqual(await wait.promise, { kind: "closed", reason: "stopped" });
    await run.terminal;
    assert.equal(stateAtTerminal, "closed");
    expectError(f.calls[0]!.options.parentChannel!.send("late", request.requestId), /closed/);
    expectError(f.manager.createParentRequest(id, "after stop"), /not running/);
  } finally { await f.close(); }
});

void it("manager record removal closes the mailbox; listener reentrancy cannot revive admission", async () => {
  const f = managerFixture();
  try {
    const removed = f.spawn();
    const live = f.spawn();
    await tick();
    const mailbox = f.manager.getRecord(removed)!.mailbox!;
    f.calls[0]!.finish();
    await tick();
    f.manager.clearCompleted();
    assert.equal(f.manager.getRecord(removed), undefined);
    assert.equal(mailbox.isClosed, true);
    expectError(f.calls[0]!.options.parentChannel!.send("after removal", null), /closed/);

    const channel = f.calls[1]!.options.parentChannel!;
    let calls = 0;
    f.manager.subscribeParentMessages(() => { calls++; f.manager.freezeAdmission(); });
    f.manager.subscribeParentMessages(() => { calls++; });
    const accepted = expectOk(channel.send("first", null));
    assert.equal(accepted.message.text, "first");
    // The snapshot still reaches the second listener once; nothing after freeze.
    assert.equal(calls, 2);
    expectError(channel.send("second", null), /closed/);
    assert.equal(calls, 2);
    assert.equal(f.manager.getRecord(live)!.mailbox!.isClosed, true);
  } finally { await f.close(); }
});

void it("actual runner keeps reply_to_parent despite disallowed_tools and a narrow tools list", async () => {
  const { registerAgents } = await import("../src/agent-types.ts");
  registerAgents(new Map([["restricted", {
    name: "restricted", description: "restricted", builtinToolNames: ["read"], disallowedTools: [REPLY_TO_PARENT_TOOL_NAME, "bash"],
    extensions: true, skills: false, systemPrompt: "Restricted.", promptMode: "replace",
  }]]));
  const f = runnerFixture();
  try {
    const channel = { send: () => ({ ok: false as const, error: "unused" }) };
    await runAgent(f.ctx, "restricted", "work", { pi: f.pi, isolated: false, parentChannel: channel }, f.deps);
    await runAgent(f.ctx, "restricted", "work", { pi: f.pi, isolated: true, parentChannel: channel }, f.deps);
    const [extension, isolated] = f.sessionOptions;
    assert.equal(extension!.excludeTools?.includes(REPLY_TO_PARENT_TOOL_NAME), false);
    assert.ok(extension!.excludeTools?.includes("bash"));
    assert.ok(isolated!.tools?.includes(REPLY_TO_PARENT_TOOL_NAME));
    assert.equal(isolated!.tools?.includes("bash"), false);
  } finally { registerAgents(new Map()); await f.close(); }
});
