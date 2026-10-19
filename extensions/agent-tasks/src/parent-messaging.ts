/**
 * parent-messaging.ts — mid-run messages between a subagent and its parent.
 *
 * The child reports through one fixed tool, `reply_to_parent`, injected when its
 * session is created and never changed afterwards: questions arrive as ordinary
 * conversation messages carrying a host-assigned request id, so neither the
 * tool declaration nor the system prompt varies with what the parent asks.
 *
 * State lives in a per-record {@link AgentMailbox} owned by the agent backend.
 * The child tool only sees a {@link ParentChannel}: a narrow send function that
 * resolves the record's current execution on every call. It never receives the
 * manager, a session or another agent.
 */

import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { nullableControl, parseControlArguments } from "../../shared/tool-arguments.ts";

export const REPLY_TO_PARENT_TOOL_NAME = "reply_to_parent";

/** Hard bounds; refusals are reported to the caller, never silently dropped. */
export const PARENT_MESSAGE_LIMITS = Object.freeze({
  /** UTF-8 bytes of one child message. */
  messageBytes: 4096,
  /** Child messages accepted per execution; all of them are retained. */
  messagesPerRun: 30,
  /** Parent requests awaiting a reply at once, per agent. */
  pendingRequests: 8,
  /** Parent requests created per execution. */
  requestsPerRun: 30,
  /**
   * Executions whose records are retained; older ones are pruned on a new run.
   * Bounds memory for long-lived records resumed many times.
   */
  retainedRuns: 5,
});

export type ParentRequestState = "pending" | "replied" | "failed" | "closed";
export type ParentRequestCloseReason = "execution_ended" | "stopped" | "shutdown";

export interface ParentRequest {
  readonly requestId: string;
  readonly runId: string;
  /** The parent's message text, kept for the detail view. */
  readonly question: string;
  readonly createdAt: number;
  state: ParentRequestState;
  closeReason?: ParentRequestCloseReason;
  /** Sequence of the child message that answered it. */
  replySeq?: number;
}

export interface ChildMessage {
  /** Monotonic within the mailbox, across executions. */
  readonly seq: number;
  readonly runId: string;
  /** The answered request, or null for an unsolicited notice. */
  readonly requestId: string | null;
  readonly text: string;
  readonly at: number;
}

export type ReplyWaitOutcome =
  | { readonly kind: "replied"; readonly message: ChildMessage }
  | { readonly kind: "failed" }
  | { readonly kind: "closed"; readonly reason: ParentRequestCloseReason };

export type MailboxResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface AcceptedChildMessage {
  readonly message: ChildMessage;
  /** True when a pending reply waiter received it; the delivery layer must not deliver it again. */
  readonly deliveredToWaiter: boolean;
}

/** What the child-side tool can do: send, and nothing else. */
export interface ParentChannel {
  send(text: string, requestId: string | null): MailboxResult<AcceptedChildMessage>;
}

function ok<T>(value: T): MailboxResult<T> { return { ok: true, value }; }
function fail<T>(error: string): MailboxResult<T> { return { ok: false, error }; }

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

type Waiter = (outcome: ReplyWaitOutcome) => void;

/**
 * In-memory request/message state for one agent record. Not persisted: a new
 * activation never replays it. Every mutation is synchronous, so a reply, a
 * run closing and a waiter cancelling cannot interleave inside one call.
 */
export class AgentMailbox {
  private readonly requests = new Map<string, ParentRequest>();
  private readonly messages: ChildMessage[] = [];
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly runs: string[] = [];
  private seq = 0;
  private closed = false;

  constructor(private readonly now: () => number = Date.now) {}

  /** Register an execution; prunes records of executions beyond the retention bound. */
  startRun(runId: string): void {
    if (this.closed || this.runs.includes(runId)) return;
    this.runs.push(runId);
    while (this.runs.length > PARENT_MESSAGE_LIMITS.retainedRuns) {
      const dropped = this.runs.shift()!;
      this.closeRun(dropped, "execution_ended");
      for (const [id, request] of this.requests) if (request.runId === dropped) this.requests.delete(id);
      for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i]!.runId === dropped) this.messages.splice(i, 1);
    }
  }

  createRequest(runId: string, question: string): MailboxResult<ParentRequest> {
    if (this.closed) return fail("The agent's message channel is closed.");
    const pending = [...this.requests.values()].filter(request => request.state === "pending").length;
    if (pending >= PARENT_MESSAGE_LIMITS.pendingRequests) {
      return fail(`This agent already has ${pending} unanswered requests (limit ${PARENT_MESSAGE_LIMITS.pendingRequests}). Wait for replies or send a plain message with reply set to null.`);
    }
    const inRun = [...this.requests.values()].filter(request => request.runId === runId).length;
    if (inRun >= PARENT_MESSAGE_LIMITS.requestsPerRun) {
      return fail(`This execution reached the limit of ${PARENT_MESSAGE_LIMITS.requestsPerRun} parent requests. Send a plain message with reply set to null.`);
    }
    this.startRun(runId);
    let requestId = newRequestId();
    while (this.requests.has(requestId)) requestId = newRequestId();
    const request: ParentRequest = { requestId, runId, question, createdAt: this.now(), state: "pending" };
    this.requests.set(requestId, request);
    return ok(request);
  }

  /** Delivery to the child failed: the request can never be answered. */
  failRequest(requestId: string): void {
    const request = this.requests.get(requestId);
    if (!request || request.state !== "pending") return;
    request.state = "failed";
    this.settleWaiters(requestId, { kind: "failed" });
  }

  accept(runId: string, rawText: string, requestId: string | null): MailboxResult<AcceptedChildMessage> {
    if (this.closed) return fail("The parent channel is closed.");
    const text = rawText.trim();
    if (!text) return fail("message must contain non-whitespace text.");
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > PARENT_MESSAGE_LIMITS.messageBytes) {
      return fail(`message is ${bytes} bytes; the limit is ${PARENT_MESSAGE_LIMITS.messageBytes}. Shorten it and send again.`);
    }
    const sent = this.messages.filter(message => message.runId === runId).length;
    if (sent >= PARENT_MESSAGE_LIMITS.messagesPerRun) {
      return fail(`This execution already sent ${sent} messages to the parent (limit ${PARENT_MESSAGE_LIMITS.messagesPerRun}). Put anything further in your final response.`);
    }
    let request: ParentRequest | undefined;
    if (requestId !== null) {
      request = this.requests.get(requestId);
      if (!request || request.runId !== runId) return fail(`Unknown request_id "${requestId}" for this execution. Copy it from the latest <parent-request>, or set request_id to null for a notice.`);
      if (request.state === "replied") return fail(`Request ${requestId} was already answered; each request accepts one reply.`);
      if (request.state !== "pending") return fail(`Request ${requestId} is no longer open.`);
    }
    this.startRun(runId);
    const message: ChildMessage = Object.freeze({ seq: ++this.seq, runId, requestId, text, at: this.now() });
    this.messages.push(message);
    let deliveredToWaiter = false;
    if (request) {
      request.state = "replied";
      request.replySeq = message.seq;
      deliveredToWaiter = this.settleWaiters(request.requestId, { kind: "replied", message });
    }
    return ok({ message, deliveredToWaiter });
  }

  /**
   * Await the reply to one request. Resolves immediately for a request that is
   * already settled. `cancel` only removes this waiter; the request stays open.
   */
  waitForReply(requestId: string): { promise: Promise<ReplyWaitOutcome>; cancel(): void } {
    const request = this.requests.get(requestId);
    if (!request) return { promise: Promise.resolve({ kind: "closed", reason: "execution_ended" }), cancel() {} };
    const settled = this.outcomeOf(request);
    if (settled) return { promise: Promise.resolve(settled), cancel() {} };
    let waiter!: Waiter;
    const promise = new Promise<ReplyWaitOutcome>(resolve => { waiter = resolve; });
    let set = this.waiters.get(requestId);
    if (!set) { set = new Set(); this.waiters.set(requestId, set); }
    set.add(waiter);
    return {
      promise,
      cancel: () => {
        const current = this.waiters.get(requestId);
        current?.delete(waiter);
        if (current?.size === 0) this.waiters.delete(requestId);
      },
    };
  }

  hasWaiter(requestId: string): boolean { return (this.waiters.get(requestId)?.size ?? 0) > 0; }

  /** Close every still-pending request of an execution and release its waiters. */
  closeRun(runId: string, reason: ParentRequestCloseReason): ParentRequest[] {
    const closed: ParentRequest[] = [];
    for (const request of this.requests.values()) {
      if (request.runId !== runId || request.state !== "pending") continue;
      request.state = "closed";
      request.closeReason = reason;
      closed.push(request);
      this.settleWaiters(request.requestId, { kind: "closed", reason });
    }
    return closed;
  }

  /** Activation shutdown or record removal: no further sends, every waiter released. */
  closeAll(reason: ParentRequestCloseReason = "shutdown"): void {
    if (this.closed) return;
    for (const runId of new Set([...this.requests.values()].map(request => request.runId))) this.closeRun(runId, reason);
    this.closed = true;
    for (const [requestId] of this.waiters) this.settleWaiters(requestId, { kind: "closed", reason });
  }

  get isClosed(): boolean { return this.closed; }

  getRequest(requestId: string): Readonly<ParentRequest> | undefined {
    const request = this.requests.get(requestId);
    return request ? { ...request } : undefined;
  }

  /** Immutable snapshots for display; never live state. */
  listRequests(runId?: string): readonly Readonly<ParentRequest>[] {
    return [...this.requests.values()].filter(request => runId === undefined || request.runId === runId).map(request => ({ ...request }));
  }
  listMessages(runId?: string): readonly ChildMessage[] {
    return this.messages.filter(message => runId === undefined || message.runId === runId);
  }

  private outcomeOf(request: ParentRequest): ReplyWaitOutcome | undefined {
    if (request.state === "failed") return { kind: "failed" };
    if (request.state === "closed") return { kind: "closed", reason: request.closeReason ?? "execution_ended" };
    if (request.state === "replied") {
      const message = this.messages.find(candidate => candidate.seq === request.replySeq);
      return message ? { kind: "replied", message } : { kind: "closed", reason: "execution_ended" };
    }
    return undefined;
  }

  private settleWaiters(requestId: string, outcome: ReplyWaitOutcome): boolean {
    const set = this.waiters.get(requestId);
    this.waiters.delete(requestId);
    if (!set?.size) return false;
    for (const waiter of set) {
      try { waiter(outcome); } catch { /* a resolver cannot throw; isolate defensively */ }
    }
    return true;
  }
}

const REPLY_TOOL_GUIDANCE = [
  `${REPLY_TO_PARENT_TOOL_NAME} usage:`,
  `  - The agent that started you may ask a question mid-task: its message is followed by <parent-request request_id="..." reply_tool="${REPLY_TO_PARENT_TOOL_NAME}" />. Answer by calling ${REPLY_TO_PARENT_TOOL_NAME} with that request_id; ordinary text in your conversation is not delivered to the parent.`,
  "  - Each request accepts one reply. Answer it promptly, then continue your task.",
  "  - Set request_id to null to notify the parent of an important finding, risk or decision it should know about while you keep working. Do not wait for a response and do not send routine progress.",
  "  - When you cannot continue without a parent decision, stop and explain the blocker and the decision needed in your final response; the parent can resume you with an answer.",
  `  - Keep each message under ${PARENT_MESSAGE_LIMITS.messageBytes} bytes. Success means the host accepted the message, not that the parent has read it.`,
  "  Examples:",
  `    {"message":"Yes, the schema lives in src/schema.ts.","request_id":"req_0123456789"}`,
  `    {"message":"Found config drift: production still uses v1 keys.","request_id":null}`,
].join("\n");

export interface ReplyToParentParams { message: string; request_id: string | null }

export function parseReplyToParentArguments(value: unknown): { message: string; requestId: string | null } {
  const params = parseControlArguments(value, ["message", "request_id"], ["request_id"]);
  if (typeof params.message !== "string" || !params.message.trim()) throw new Error("message must be a non-empty string.");
  const requestId = Object.hasOwn(params, "request_id") ? params.request_id : null;
  if (requestId !== null && (typeof requestId !== "string" || !requestId.trim())) {
    throw new Error("request_id must be a request id string from <parent-request>, or null for a notice.");
  }
  return { message: params.message, requestId: requestId === null ? null : (requestId as string).trim() };
}

/** The fixed child-side tool. Its definition never depends on runtime state. */
export function createReplyToParentTool(channel: ParentChannel): ToolDefinition {
  return defineTool({
    name: REPLY_TO_PARENT_TOOL_NAME,
    label: REPLY_TO_PARENT_TOOL_NAME,
    description: "Send a message to the agent that started you: answer one of its requests, or notify it of something important while you keep working.",
    promptSnippet: "Answer parent requests or notify the parent agent",
    promptGuidelines: [REPLY_TOOL_GUIDANCE],
    parameters: Type.Object({
      message: Type.String({ minLength: 1, description: `Message text for the parent; non-blank, at most ${PARENT_MESSAGE_LIMITS.messageBytes} UTF-8 bytes.` }),
      request_id: nullableControl(Type.String({ description: "request_id copied from <parent-request> when answering it; null for an unsolicited notice." })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, input) => {
      let parsed: { message: string; requestId: string | null };
      try { parsed = parseReplyToParentArguments(input); }
      catch (error) { return errorResult(error instanceof Error ? error.message : String(error)); }
      let result: MailboxResult<AcceptedChildMessage>;
      try { result = channel.send(parsed.message, parsed.requestId); }
      catch (error) { return errorResult(`The parent channel failed: ${error instanceof Error ? error.message : String(error)}`); }
      if (!result.ok) return errorResult(result.error);
      const text = parsed.requestId
        ? `Reply to ${parsed.requestId} accepted. This does not confirm the parent has read it; continue your task.`
        : "Notice accepted. This does not confirm the parent has read it; continue your task without waiting.";
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  }) as ToolDefinition;
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {}, isError: true };
}
