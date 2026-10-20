import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { AgentSession, ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import "./source-loader.mjs";
import { completeToolCall } from "./tool-inputs.ts";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import type { AgentManagerDependencies } from "../src/agent-manager.ts";
import type { RunOptions, RunResult } from "../src/agent-runner.ts";
import type { AgentRecord } from "../src/types.ts";
const { default: agentTasks } = await import("../src/index.ts");
const { MESSAGE_HOLD_MS, SUBAGENT_MESSAGE_TYPE, renderSubagentMessageCard } = await import("../src/parent-delivery.ts");
const { renderMessages } = await import("../../task-ui/detail-view.ts");
const { managementTool } = await import("../../runtime-tasks/tools.ts");
type Capability = import("../../runtime-tasks/facade.ts").RuntimeTaskCapability;
type Reporter = (id: string, result: import("../../runtime-tasks/contracts.ts").RuntimeTaskResult) => import("../../runtime-tasks/contracts.ts").RuntimeTaskResult;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const hold = () => new Promise(resolve => setTimeout(resolve, MESSAGE_HOLD_MS + 60));
const text = (result: { content: { type: string; text?: string }[] }) => result.content.filter(block => block.type === "text").map(block => block.text ?? "").join("\n");

interface Sent { customType: string; content: string; display?: boolean; options?: { triggerTurn?: boolean; deliverAs?: string } }

/** Real registration with offline runner/session seams; sinks are recorded. */
async function factory() {
  const root = mkdtempSync(join(tmpdir(), "agent-parent-delivery-"));
  const cwd = join(root, "cwd"), config = join(root, "agent"), rootSessionFile = join(root, "root.jsonl");
  mkdirSync(cwd); mkdirSync(config); writeFileSync(rootSessionFile, "");
  writeFileSync(join(config, "agent-tasks.json"), JSON.stringify({ outputTranscript: false, defaultJoinMode: "async" }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = config;
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
  const sent: Sent[] = [], entries: { type: string; data: unknown }[] = [], steers: string[] = [];
  const runs: { id: string; options: RunOptions; session: AgentSession; finish: (text?: string) => void }[] = [];
  const deps: AgentManagerDependencies = {
    runAgent: async (_ctx, _type, _prompt, options) => {
      const result = deferred<RunResult>();
      const sessionFile = join(root, `child-${runs.length}.jsonl`);
      writeFileSync(sessionFile, "");
      const session = { messages: [], sessionManager: { getSessionFile: () => sessionFile }, getContextUsage: () => undefined,
        steer: async (value: string) => { steers.push(value); }, subscribe: () => () => {}, dispose() {} } as unknown as AgentSession;
      runs.push({ id: options.agentId!, options, session, finish: (value = "final answer") => result.resolve({ responseText: value, session, aborted: false, steered: false }) });
      queueMicrotask(() => options.onSessionCreated?.(session));
      options.signal?.addEventListener("abort", () => result.resolve({ responseText: "stopped", session, aborted: true, steered: false }), { once: true });
      return result.promise;
    },
  };
  const pi = {
    registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { tools.set(tool.name, tool); },
    registerMessageRenderer() {}, registerEntryRenderer() {}, registerFlag() {}, registerCommand() {},
    on(name: string, handler: (...args: unknown[]) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    events: { emit() {}, on() { return () => {}; } },
    appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
    sendMessage(message: Sent, options?: Sent["options"]) { sent.push({ ...message, options }); },
    exec: undefined, getFlag: () => undefined, getAllTools: () => [], getActiveTools: () => [],
  } as unknown as ExtensionAPI;
  const coordinator = new TaskCoordinator();
  const lifecycle = new TaskLifecycle(coordinator);
  // Same management wiring as task-composition.ts.
  const capabilities: Capability[] = [];
  let report: Reporter | undefined;
  agentTasks(pi, { coordinator, lifecycle, managerDependencies: deps, onManagement: capability => capabilities.push(capability), onManagementResult: reporter => { report = reporter; } });
  const agentManage = managementTool("agent", capabilities, (id, result) => report?.(id, result) ?? result);
  const ctx = { cwd, hasUI: false, mode: "print", ui: { setWidget() {}, setStatus() {}, notify() {} },
    sessionManager: { getSessionId: () => "parent-delivery", getBranch: () => [], getSessionFile: () => rootSessionFile }, modelRegistry: {} } as unknown as ExtensionToolContext;
  await handlers.get("session_start")![0]!(undefined, ctx);
  const execute = (name: string, params: Record<string, unknown>, id = "call", signal?: AbortSignal) =>
    tools.get(name)!.execute(id, completeToolCall(tools.get(name)!.parameters, params), signal, () => {}, ctx);
  const registry = Reflect.get(globalThis, Symbol.for("pi-subagents:manager")) as { getRecord(id: string): AgentRecord | undefined };
  return {
    tools, sent, entries, steers, runs, coordinator, execute, registry,
    manage: (params: Record<string, unknown>) => agentManage.tool.execute("manage", completeToolCall(agentManage.tool.parameters, params) as never, undefined, undefined, ctx),
    async background() {
      await execute("subagent_run", { subagent_type: "general-purpose", description: "work", prompt: "work", run_in_background: true });
      await tick();
      const run = runs.at(-1)!;
      return { id: run.id, run, channel: run.options.parentChannel! };
    },
    messages: () => sent.filter(message => message.customType === SUBAGENT_MESSAGE_TYPE),
    cards: () => entries.filter(entry => entry.type === SUBAGENT_MESSAGE_TYPE),
    async close() {
      agentManage.close(); await lifecycle.shutdown(); coordinator.dispose();
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

void it("subagent_message schema: reply is required, nullable and enum-checked before effects", async () => {
  const f = await factory();
  try {
    const tool = f.tools.get("subagent_message")!;
    assert.deepEqual(Reflect.get(tool.parameters, "required"), ["agent_id", "message", "reply"]);
    const validate = (args: unknown) => validateToolArguments(tool as never, { type: "toolCall", id: "t", name: tool.name, arguments: args as never });
    assert.throws(() => validate({ agent_id: "a", message: "m" }));
    assert.throws(() => validate({ agent_id: "a", message: "m", reply: "later" }));
    assert.doesNotThrow(() => validate({ agent_id: "a", message: "m", reply: null }));
    const { id } = await f.background();
    for (const bad of [{ agent_id: id, message: "q" }, { agent_id: id, message: "q", reply: "later" }]) {
      const result = await tool.execute("t", bad as never, undefined, () => {}, {} as never);
      assert.equal(result.isError, true);
    }
    assert.deepEqual(f.steers, []);
    assert.equal(f.registry.getRecord(id)!.mailbox!.listRequests().length, 0);
  } finally { await f.close(); }
});

void it("reply null keeps plain steering; notify sends the question then its marker and delivers the reply", async () => {
  const f = await factory();
  try {
    const { id, channel } = await f.background();
    const plain = await f.execute("subagent_message", { agent_id: id, message: "continue", reply: null });
    assert.match(text(plain), /^Steering message sent to agent/);
    const asked = await f.execute("subagent_message", { agent_id: id, message: "Where is the schema?", reply: "notify" });
    const requestId = /Request ID: (req_\w+)/.exec(text(asked))![1]!;
    assert.match(text(asked), /Question sent/);
    assert.deepEqual(f.steers, ["continue", "Where is the schema?", `<parent-request request_id="${requestId}" reply_tool="reply_to_parent" />`]);

    assert.equal(channel.send("src/schema.ts", requestId).ok, true);
    // The card is immediate; the model-facing message follows the hold.
    assert.equal(f.cards().length, 1);
    assert.deepEqual((f.cards()[0]!.data as { requestId: string }).requestId, requestId);
    assert.equal(f.messages().length, 0);
    await hold();
    const [message] = f.messages();
    assert.ok(message);
    assert.equal(message.display, false);
    assert.deepEqual(message.options, { triggerTurn: true, deliverAs: "steer" });
    assert.match(message.content, new RegExp(`<reply request-id="${requestId}">src/schema.ts</reply>`));
    assert.match(message.content, /<subagent-message agent-id=/);
  } finally { await f.close(); }
});

void it("reply wait returns the matching reply only in the tool result while the run continues", async () => {
  const f = await factory();
  try {
    const { id, channel } = await f.background();
    const first = await f.execute("subagent_message", { agent_id: id, message: "first?", reply: "notify" });
    const firstId = /Request ID: (req_\w+)/.exec(text(first))![1]!;
    const waiting = f.execute("subagent_message", { agent_id: id, message: "second?", reply: "wait" }, "ask");
    await tick();
    const secondId = /request_id="(req_\w+)"/.exec(f.steers.at(-1)!)![1]!;
    assert.equal(f.coordinator.countWaits({ sourceId: "agent", taskId: id, runId: "1" }), 1);
    // A notice and an answer to the other question arrive during the wait.
    channel.send("found drift", null);
    channel.send("answer one", firstId);
    channel.send("answer two", secondId);
    const result = await waiting;
    assert.match(text(result), /Reply:\nanswer two/);
    assert.match(text(result), /--- Messages received during wait ---\n\[notice\] found drift\n\[reply req_\w+\] answer one/);
    assert.equal(f.registry.getRecord(id)!.status, "running");
    await hold();
    assert.equal(f.messages().length, 0, "messages handed to the wait are not delivered again");
    // Cards: the notice and first reply; the waited reply is only in the tool result.
    assert.deepEqual(f.cards().map(entry => (entry.data as { text: string }).text), ["found drift", "answer one"]);
  } finally { await f.close(); }
});

void it("released or ended reply waits leave the question open or report it closed", async () => {
  const f = await factory();
  try {
    const { id, channel, run } = await f.background();
    const waiting = f.execute("subagent_message", { agent_id: id, message: "q?", reply: "wait" }, "ask");
    await tick();
    const requestId = /request_id="(req_\w+)"/.exec(f.steers.at(-1)!)![1]!;
    assert.equal(f.coordinator.detachAll(), 1);
    // Detach must synchronously release the mailbox waiter: an answer sent
    // before this tool call resumes is late delivery, not a dropped wait reply.
    channel.send("late answer", requestId);
    const released = await waiting;
    assert.match(text(released), /Wait released; the question stays open/);
    assert.equal(f.registry.getRecord(id)!.status, "running", "releasing never stops the agent");
    await hold();
    assert.match(f.messages()[0]!.content, /late answer/);

    const ending = f.execute("subagent_message", { agent_id: id, message: "another?", reply: "wait" }, "ask-2");
    await tick();
    run.finish();
    const ended = await ending;
    assert.match(text(ended), /execution ended without a reply/);
  } finally { await f.close(); }
});

void it("questions to a session that is not ready queue together in order", async () => {
  const f = await factory();
  try {
    const { id } = await f.background();
    const record = f.registry.getRecord(id)!;
    record.session = undefined;
    const asked = await f.execute("subagent_message", { agent_id: id, message: "early?", reply: "notify" });
    assert.match(text(asked), /Question queued/);
    const requestId = /Request ID: (req_\w+)/.exec(text(asked))![1]!;
    assert.deepEqual(record.pendingSteers, ["early?", `<parent-request request_id="${requestId}" reply_tool="reply_to_parent" />`]);
  } finally { await f.close(); }
});

void it("unwaited notices precede the completion notification", async () => {
  const f = await factory();
  try {
    const { channel, run } = await f.background();
    assert.equal(channel.send("heads up", null).ok, true);
    run.finish("done");
    await hold(); await hold();
    const order = f.sent.map(message => message.customType);
    assert.deepEqual(order.filter(type => type === SUBAGENT_MESSAGE_TYPE || type === "subagent-notification"), [SUBAGENT_MESSAGE_TYPE, "subagent-notification"]);
  } finally { await f.close(); }
});

void it("foreground subagent_run appends messages received during its wait to the result", async () => {
  const f = await factory();
  try {
    const launch = f.execute("subagent_run", { subagent_type: "general-purpose", description: "fg", prompt: "fg", run_in_background: false }, "fg-call");
    await tick();
    const run = f.runs.at(-1)!;
    run.options.parentChannel!.send("progress worth knowing", null);
    run.finish("all done");
    const result = await launch;
    assert.match(text(result), /all done/);
    assert.match(text(result), /--- Messages received during wait ---\n\[notice\] progress worth knowing/);
    await hold();
    assert.equal(f.messages().length, 0);
    assert.deepEqual(f.entries.filter(entry => entry.type === SUBAGENT_MESSAGE_TYPE).map(entry => (entry.data as { text: string }).text), ["progress worth knowing"], "the card is still shown");
  } finally { await f.close(); }
});

void it("task detail lists questions and messages; running rows preview the latest message", async () => {
  const f = await factory();
  try {
    const { id, channel } = await f.background();
    await f.execute("subagent_message", { agent_id: id, message: "q?", reply: "notify" });
    const requestId = /request_id="(req_\w+)"/.exec(f.steers.at(-1)!)![1]!;
    channel.send("note\nsecond line", null);
    channel.send("answer", requestId);
    const view = f.coordinator.list().find(candidate => candidate.taskId === id)!;
    assert.equal(view.stats.latestMessage, "reply: answer");
    const detail = f.coordinator.detail(view)!;
    assert.deepEqual(detail.messages!.map(entry => entry.kind), ["question", "notice", "reply"]);
    assert.equal(detail.messages![0]!.kind === "question" && detail.messages![0]!.state, "replied");
    const theme = { fg: (_color: string, value: string) => value };
    const lines = renderMessages(detail.messages!, theme as never, 60);
    assert.ok(lines.some(line => line.includes(`↑ question ${requestId} [replied]`)));
    assert.ok(lines.includes("  second line"));
  } finally { await f.close(); }
});

void it("detail omits whole older message entries rather than silently truncating text", async () => {
  const f = await factory();
  try {
    const { id } = await f.background();
    const question = "q".repeat(20_000);
    await f.execute("subagent_message", { agent_id: id, message: question, reply: "notify" });
    const view = f.coordinator.list().find(candidate => candidate.taskId === id)!;
    const detail = f.coordinator.detail(view)!;
    assert.deepEqual(detail.messages, []);
    assert.equal(detail.messagesOmitted, 1);
  } finally { await f.close(); }
});

void it("message card renders kind, label and a collapsed body", () => {
  const theme = { fg: (_color: never, value: string) => value, bold: (value: string) => value };
  const data = { agentId: "a", label: "explore", executionId: "exec_x", requestId: null, text: "1\n2\n3\n4\n5", at: 0 };
  const collapsed = renderSubagentMessageCard(data, false, theme)!.render(80).map(line => line.trimEnd());
  assert.equal(collapsed[0], "↩ explore · notice");
  assert.ok(collapsed.includes("  … 2 more lines"));
  const expanded = renderSubagentMessageCard({ ...data, requestId: "req_1" }, true, theme)!.render(80).map(line => line.trimEnd());
  assert.equal(expanded[0], "↩ explore · reply req_1");
  assert.equal(expanded.length, 6);
  assert.equal(renderSubagentMessageCard(undefined, false, theme), undefined);
});

void it("message card strips external terminal controls before styling", () => {
  const theme = { fg: (_color: never, value: string) => value, bold: (value: string) => value };
  const rendered = renderSubagentMessageCard({
    agentId: "a", label: "\u001b[31mevil", executionId: "exec_x", requestId: "req_\u001b[2J1",
    text: "safe\u001b[2J\u0000 text", at: 0,
  }, true, theme)!.render(80).join("\n");
  assert.equal(rendered.includes("\u001b"), false);
  assert.match(rendered, /evil/);
  assert.match(rendered, /safe text/);
});

void it("agent_manage wait appends messages of the waited execution to its result", async () => {
  const f = await factory();
  try {
    const { id, channel, run } = await f.background();
    const execution = f.coordinator.list().find(view => view.taskId === id)!;
    const { executionId } = await import("../../runtime-tasks/execution-id.ts");
    const waiting = f.manage({ action: "wait", execution_id: executionId({ taskId: id, runId: execution.runId }, "subagent") });
    await tick();
    channel.send("halfway there", null);
    run.finish("finished");
    const result = await waiting;
    assert.match(text(result), /finished/);
    assert.match(text(result), /--- Messages received during wait ---\n\[notice\] halfway there/);
    await hold();
    assert.equal(f.messages().length, 0);
  } finally { await f.close(); }
});
