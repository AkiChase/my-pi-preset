import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProgramStatus, Terminal } from "@earendil-works/pi-tui";
import { interpose } from "../editor-handoff/index.ts";

type StatusTerminal = Pick<Terminal, "setProgramStatus">;
type QuestionLabel = (payload: unknown) => string | undefined;
type Wait = { id?: string; label?: string };

export interface CoreAttention {
  prompt(payload: unknown): void;
  blocked(payload: unknown): void;
  close(): void;
}

export function herdrCorePresent(env = process.env): boolean {
  return !!env.HC_TERMINAL_ID && !!env.HC_TERMINAL_SOCKET;
}

function eventData(payload: unknown): { data: Record<string, unknown>; id?: string } | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const data = payload as Record<string, unknown>;
  const id = data.toolCallId;
  if (id === undefined) return { data };
  if (typeof id !== "string" || !id.trim()) return undefined;
  return { data, id };
}

function sameStatus(a: ProgramStatus | undefined, b: ProgramStatus): boolean {
  return !!a && a.state === b.state && a.app === b.app && a.kind === b.kind && a.message === b.message;
}

/** Supplement a public receiver; native computation and terminal negotiation remain with Pi. */
export function attachCoreAttention(terminal: StatusTerminal, questionLabel: QuestionLabel): CoreAttention {
  const original = terminal.setProgramStatus;
  if (typeof original !== "function") throw new Error("Program status receiver is unavailable");
  let closed = false;
  let native: ProgramStatus | undefined;
  let published: ProgramStatus | undefined;
  let overridden = false;
  let anonymousLabel: string | undefined;
  let anonymousCount = 0;
  const labels = new Map<string, string>();
  const waits = new Map<string, Wait>();
  // The anonymous peer owns one ordered slot, independent of named wait IDs.
  const order: Wait[] = [];
  const anonymous: Wait = {};

  const merge = (status: ProgramStatus): ProgramStatus => {
    if (status.state === "clear" || status.state === "blocked" || order.length === 0) return status;
    return { ...status, state: "blocked", kind: "question", message: order[0]?.label ?? "Waiting for input" };
  };
  const forward = (receiver: StatusTerminal, status: ProgramStatus, isOverride: boolean) => {
    published = { ...status };
    overridden = isOverride;
    original.call(receiver, status);
  };
  const refresh = () => {
    if (closed || !native) return;
    const snapshot = native;
    const status = merge(snapshot);
    if (sameStatus(published, status)) return;
    try {
      forward(terminal, status, status !== snapshot);
    } catch {
      // Publishing may synchronously retire this lease or install a newer native value.
      if (!ownsReceiver() || native !== snapshot) return;
      try { forward(terminal, snapshot, false); } catch { /* Preserve fail-open behavior. */ }
    }
  };
  const wrapped = function (this: StatusTerminal, status: ProgramStatus): void {
    if (closed) { original.call(this, status); return; }
    const snapshot = status.state === "clear" ? undefined : { ...status };
    native = snapshot;
    const merged = merge(status);
    try {
      forward(this, merged, merged !== status);
    } catch (error) {
      if (merged === status) throw error;
      if (!ownsReceiver() || native !== snapshot) return;
      forward(this, status, false);
    }
  };
  const ownsReceiver = () => {
    if (closed) return false;
    try { return Object.getOwnPropertyDescriptor(terminal, "setProgramStatus")?.value === wrapped; }
    catch { return false; }
  };
  const restore = interpose(terminal, "setProgramStatus", { writable: true, value: wrapped });
  const remove = (wait: Wait) => {
    const index = order.indexOf(wait);
    if (index >= 0) order.splice(index, 1);
  };

  return {
    prompt(payload) {
      if (closed) return;
      try {
        const event = eventData(payload);
        if (!event) return;
        const label = questionLabel(payload);
        if (event.id === undefined) { anonymousLabel = label; return; }
        const wait = waits.get(event.id);
        if (wait) {
          wait.label = label;
          refresh();
        } else if (label) {
          // Unmatched prompt labels are bounded; active waits retain their own labels.
          labels.delete(event.id);
          labels.set(event.id, label);
          if (labels.size > 128) labels.delete(labels.keys().next().value!);
        } else labels.delete(event.id);
      } catch { /* Malformed optional peer payloads are ignored. */ }
    },
    blocked(payload) {
      if (closed) return;
      try {
        const event = eventData(payload);
        if (!event || typeof event.data.active !== "boolean") return;
        if (event.id !== undefined) {
          if (event.data.active) {
            if (waits.has(event.id)) return;
            const wait = { id: event.id, label: labels.get(event.id) };
            labels.delete(event.id);
            waits.set(event.id, wait);
            order.push(wait);
          } else {
            labels.delete(event.id);
            const wait = waits.get(event.id);
            if (!wait) return;
            waits.delete(event.id);
            remove(wait);
          }
        } else if (event.data.active) {
          if (anonymousCount === 0) {
            anonymous.label = anonymousLabel;
            order.push(anonymous);
          }
          anonymousCount = Math.min(Number.MAX_SAFE_INTEGER, anonymousCount + 1);
          anonymousLabel = undefined;
        } else {
          if (anonymousCount === 0) return;
          anonymousCount -= 1;
          if (anonymousCount === 0) {
            remove(anonymous);
            anonymous.label = anonymousLabel = undefined;
          }
        }
        refresh();
      } catch { /* The peer cannot fail Pi's normal UI/tool lifecycle. */ }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        if (overridden && native && Object.getOwnPropertyDescriptor(terminal, "setProgramStatus")?.value === wrapped) {
          original.call(terminal, native);
        }
      } catch { /* Restoration is optional; still retire the receiver and resources. */ }
      native = published = undefined;
      overridden = false;
      anonymous.label = anonymousLabel = undefined;
      anonymousCount = 0;
      labels.clear();
      waits.clear();
      order.length = 0;
      try { restore(); } catch { /* Do not overwrite a later descriptor owner. */ }
    },
  };
}

/** One session owns capture, receiver and peer subscriptions, including late setup cleanup. */
export function watchHerdrCoreState(pi: ExtensionAPI, questionLabel: QuestionLabel): void {
  let stopped = false;
  let activation: { close(): void } | undefined;
  const registrations: (() => void)[] = [];
  const unsubscribe = (release: () => void) => { try { release(); } catch { /* Keep disposing other owners. */ } };
  const shutdown = () => {
    if (stopped) return;
    stopped = true;
    activation?.close();
    activation = undefined;
    for (const release of registrations.splice(0)) unsubscribe(release);
  };
  registrations.push(pi.on("session_start", async (_event, ctx) => {
    if (stopped || ctx.mode !== "tui") return;
    activation?.close();
    let closed = false;
    let attention: CoreAttention | undefined;
    const subscriptions: (() => void)[] = [];
    const owner = {
      close() {
        if (closed) return;
        closed = true;
        attention?.close();
        attention = undefined;
        for (const release of subscriptions.splice(0)) unsubscribe(release);
      },
    };
    activation = owner;
    try {
      let terminal: StatusTerminal | undefined;
      await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
        terminal = tui.terminal;
        done();
        return { render: () => [], invalidate() {} };
      }, { overlay: true });
      if (closed || stopped || activation !== owner || !terminal) return;
      attention = attachCoreAttention(terminal, questionLabel);
      // Descriptor proxies and subscription callbacks can reenter shutdown synchronously.
      if (closed || stopped || activation !== owner) { attention.close(); attention = undefined; return; }
      const subscribe = (channel: string, handler: (payload: unknown) => void) => {
        const release = pi.events.on(channel, handler);
        if (closed) unsubscribe(release); else subscriptions.push(release);
      };
      subscribe("rpiv:ask-user:prompt", (payload) => { if (!closed) attention?.prompt(payload); });
      if (closed) return;
      subscribe("rpiv:ask-user:blocked", (payload) => { if (!closed) attention?.blocked(payload); });
    } catch {
      owner.close();
      // No raw OSC fallback, private cache access or visible UI on capture/setup failure.
    }
  }));
  registrations.push(pi.on("session_shutdown", shutdown));
}
