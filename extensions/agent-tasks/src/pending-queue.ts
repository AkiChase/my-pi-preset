import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PendingMessage, PendingMessages } from "../../task-ui/types.ts";

const MAX_ITEMS = 128;
const MAX_BYTES = 512 * 1024;
const EXTERNAL_BYTES = 4096;
type Item = { id: string; text: string; original?: string; state: PendingMessage["state"]; error?: string; truncated?: boolean; queue?: "steering" | "followUp"; waiting?: boolean; replaceId?: string };
function bounded(text: string): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text);
  if (bytes.length <= EXTERNAL_BYTES) return { text, truncated: false };
  // Do not cut a UTF-8 code point or pretend this is the complete original.
  let end = EXTERNAL_BYTES;
  while (end && (bytes[end]! & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

/** Run-owned observation only. Public tool delivery remains with its existing ordered chains. */
export class PendingQueue {
  private sequence = 0;
  private items: Item[] = [];
  private queues: Record<"steering" | "followUp", Item[]> = { steering: [], followUp: [] };
  private queueLengths = { steering: 0, followUp: 0 };
  private omitted = 0;
  private off: () => void = () => {};
  private session?: AgentSession;
  private closed = false;
  inFlight = 0;
  constructor(private readonly changed: () => void) {}
  private item(text: string, original?: string): Item {
    return { id: `pending-${++this.sequence}`, ...(original === undefined ? bounded(text) : { text }), original, state: "pending" };
  }
  /** UI-only exact-original memory admission; refusal happens before delivery. */
  admit(text: string, replaceId?: string): Item | undefined {
    const retained = this.items.filter(item => item.original !== undefined);
    if (retained.length >= MAX_ITEMS || retained.reduce((sum, item) => sum + Buffer.byteLength(item.original!), 0) + Buffer.byteLength(text) > MAX_BYTES) return undefined;
    const item = this.item(text, text);
    this.items.push(item);
    // Replace only after actual queue admission, not composer restoration or optimistic submission.
    if (replaceId) item.replaceId = replaceId;
    return item;
  }
  prepare(texts: readonly string[]): void {
    if (this.closed || this.session) return;
    const waiting = this.items.filter(item => item.waiting);
    const used = new Set<Item>();
    let omitted = 0;
    for (const text of texts) {
      const prior = waiting.find(item => !used.has(item) && (item.original === undefined ? item.text === bounded(text).text : item.original === text));
      if (prior) { used.add(prior); continue; }
      const ui = this.items.find(item => !item.waiting && !item.queue && item.state === "pending" && item.original === text);
      if (ui) { ui.waiting = true; used.add(ui); }
      else if (this.items.filter(item => item.original === undefined).length < MAX_ITEMS) {
        const item = this.item(text); item.waiting = true; this.items.push(item); used.add(item);
      } else omitted++;
    }
    // Reconciliation may run after handoff has cleared pendingSteers while an
    // earlier async input handler still blocks later originals. Keep those UI
    // admissions until their delivery promise resolves or terminal freeze marks them.
    this.items = this.items.filter(item => item.original !== undefined || !item.waiting || used.has(item));
    this.omitted = omitted;
  }
  bind(session: AgentSession): void {
    this.off(); this.session = session;
    const off = session.subscribe?.(event => {
      if (this.closed) return;
      if (event.type === "queue_update") { this.sync(event.steering, event.followUp); this.changed(); }
      // SDK removes queue entries before User history is published. Publish again at the
      // actual history boundary so the conversation catches up without duplicate rows.
      if (event.type === "message_end" && event.message.role === "user") queueMicrotask(() => { if (!this.closed) this.changed(); });
    }) ?? (() => {});
    // A synchronous subscription callback can freeze the run before subscribe returns.
    if (this.closed) { off(); return; }
    this.off = off;
    this.sync(session.getSteeringMessages?.() ?? [], session.getFollowUpMessages?.() ?? []);
  }
  private sync(steering: readonly string[], followUp: readonly string[]): void {
    this.omitted = 0;
    for (const [kind, texts] of [["steering", steering], ["followUp", followUp]] as const) {
      const previous = this.queues[kind];
      const previousLength = this.queueLengths[kind];
      const removed = Math.max(0, previousLength - texts.length);
      // Public SDK drains from the head. Ignore the removed occurrences even
      // while the actual queue remains larger than our bounded projection.
      const remaining = previous.slice(removed);
      const used = new Set<Item>();
      const next: Item[] = [];
      // Match from the tail: SDK consumes the FIRST identical occurrence. The remaining
      // duplicate keeps its identity and manual browse anchor instead of inheriting the first.
      for (let index = Math.min(texts.length, MAX_ITEMS) - 1; index >= 0; index--) {
        const text = texts[index]!;
        const aligned = remaining[index];
        let item = index >= previousLength ? undefined
          : aligned && !used.has(aligned) && aligned.text === bounded(text).text ? aligned
          : index >= remaining.length ? undefined
          : [...remaining].reverse().find(candidate => !used.has(candidate) && candidate.text === bounded(text).text);
        if (!item) {
          // Public queue events have no submission identity: never attribute an
          // external/ transformed occurrence to an in-flight UI original.
          item = this.item(text); this.items.push(item);
          item.queue = kind;
        }
        used.add(item); next.unshift(item);
      }
      this.items = this.items.filter(item => item.queue !== kind || used.has(item));
      this.queues[kind] = next;
      this.queueLengths[kind] = texts.length;
      this.omitted += Math.max(0, texts.length - MAX_ITEMS);
    }
    // Reconciliation walks backward for duplicate identity, but display order
    // must remain SDK FIFO (including the initial external snapshot).
    this.items = [...this.items.filter(item => !item.queue), ...this.queues.steering, ...this.queues.followUp];
  }
  async deliver(text: string, current: () => boolean, explicit?: Item): Promise<void> {
    const item = explicit ?? this.items.find(candidate => candidate.waiting && (candidate.original === undefined ? candidate.text === bounded(text).text : candidate.original === text));
    if (!current() || this.closed || !this.session) return;
    if (item) { item.waiting = false; item.state = "submitting"; }
    this.inFlight++;
    try {
      const result = await this.session.steer(text);
      if (!current() || this.closed) {
        // Resume cannot start while an input handler is outstanding. Clear only this old
        // session's public queue; no old completion can withdraw a new run's messages.
        this.session.clearQueue?.();
        return;
      }
      if (item && this.items.includes(item)) {
        if (result === "handled") item.state = "handled";
        else if (result === "queued") {
          // Only this promise's actual admission can replace a failed original.
          // Queued text/identity thereafter belongs solely to the public SDK snapshot.
          this.items = this.items.filter(candidate => candidate !== item && candidate.id !== item.replaceId);
        }
      }
    } catch (error) {
      if (item && current() && !this.closed) { item.state = "failed"; item.error = String(error instanceof Error ? error.message : error).slice(0, 2000); }
    } finally {
      this.inFlight--; this.changed();
    }
  }
  snapshot(): PendingMessages {
    const retained = this.items.filter(item => item.original !== undefined);
    const external = this.items.filter(item => item.original === undefined).slice(0, MAX_ITEMS);
    const shown = new Set([...retained, ...external]);
    const entries = this.items.filter(item => shown.has(item)).map(item => Object.freeze({ id: item.id, text: item.original ?? item.text, state: item.state,
      ...(item.error ? { error: item.error } : {}), ...(item.original === undefined && item.truncated ? { truncated: true } : {}),
      restorable: item.original !== undefined && (item.state === "failed" || item.state === "handled") }));
    return Object.freeze({ entries: Object.freeze(entries), omitted: this.omitted + Math.max(0, this.items.length - shown.size) });
  }
  freeze(reason = "Execution ended before delivery"): void {
    if (this.closed) return;
    this.closed = true; this.off(); this.off = () => {};
    for (const item of this.items) if (item.state === "pending" || item.state === "submitting") { item.state = "notDelivered"; item.error = reason; }
  }
}
