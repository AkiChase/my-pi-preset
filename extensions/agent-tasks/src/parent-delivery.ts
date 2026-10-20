/**
 * parent-delivery.ts — how accepted child messages reach the main session.
 *
 * Two channels per message, so the user sees it at once and the model sees it
 * exactly once:
 *
 *   - a session entry (`appendEntry`) rendered as a card. Entries are written and
 *     drawn immediately even while the parent is busy, and never enter context;
 *   - a hidden custom message (`display: false`) for the model, steered in.
 *
 * While the parent is waiting on the sending execution (foreground launch,
 * `agent_manage wait`, `subagent_message` with reply "wait") the model-facing
 * part is held and handed to that wait's result via {@link ParentDelivery.take}.
 * A held message nobody takes is delivered normally once the wait is gone.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences } from "@earendil-works/pi-tui";
import type { TaskCoordinator } from "../../task-ui/coordinator.ts";
import type { TaskIdentity } from "../../task-ui/types.ts";
import type { AgentManager } from "./agent-manager.ts";
import type { ChildMessage } from "./parent-messaging.ts";
import type { AgentRecord } from "./types.ts";
import { escapeXml } from "./xml.ts";

export const SUBAGENT_MESSAGE_TYPE = "subagent-message";
/** Same hold as completion nudges: lets a finishing wait take its messages first. */
export const MESSAGE_HOLD_MS = 200;

/** Self-contained card data; persisted with the session and re-rendered on reload. */
export interface SubagentMessageEntryData {
  readonly agentId: string;
  readonly label: string;
  readonly requestId: string | null;
  readonly text: string;
  readonly at: number;
}

export interface SubagentMessageDetails {
  readonly agentId: string;
  readonly messages: readonly { readonly requestId: string | null; readonly seq: number }[];
}

/** Model-facing text for messages of one execution. */
export function formatSubagentMessages(agentId: string, messages: readonly ChildMessage[]): string {
  const body = messages.map(message => message.requestId
    ? `<reply request-id="${escapeXml(message.requestId)}">${escapeXml(message.text)}</reply>`
    : `<notice>${escapeXml(message.text)}</notice>`).join("\n");
  return `<subagent-message agent-id="${escapeXml(agentId)}">\n${body}\n</subagent-message>`;
}

/** Appended to a wait result that held messages of the waited execution. */
export function formatHeldMessages(messages: readonly ChildMessage[]): string {
  if (!messages.length) return "";
  return "\n\n--- Messages received during wait ---\n" + messages.map(message =>
    `${message.requestId ? `[reply ${message.requestId}]` : "[notice]"} ${message.text}`).join("\n");
}

const COLLAPSED_LINES = 3;

/** Card payload is persisted/external text; never let it supply terminal controls. */
function cleanCardText(text: string): string {
  return stripTerminalSequences(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}

export function renderSubagentMessageCard(data: SubagentMessageEntryData | undefined, expanded: boolean, theme: { fg(color: never, text: string): string; bold?(text: string): string }): Text | undefined {
  if (!data || typeof data.text !== "string") return undefined;
  const fg = (color: string, text: string) => theme.fg(color as never, text);
  const kind = data.requestId ? `reply ${cleanCardText(data.requestId)}` : "notice";
  const label = cleanCardText(data.label);
  const title = `${fg("accent", "↩")} ${theme.bold ? theme.bold(label) : label} ${fg("dim", "·")} ${fg("muted", kind)}`;
  const lines = cleanCardText(data.text).split(/\r\n|\n|\r/);
  const shown = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
  const body = shown.map(line => `  ${line}`);
  if (!expanded && lines.length > COLLAPSED_LINES) body.push(fg("dim", `  … ${lines.length - COLLAPSED_LINES} more line${lines.length - COLLAPSED_LINES === 1 ? "" : "s"}`));
  return new Text([title, ...body].join("\n"), 0, 0);
}

interface Pending { runId: string; messages: ChildMessage[]; timer?: ReturnType<typeof setTimeout> }

export interface ParentDelivery {
  /** Remove and return held messages of one execution, for a wait result. */
  take(identity: Pick<TaskIdentity, "taskId" | "runId">): readonly ChildMessage[];
  /** Deliver anything still pending for an agent now (before its completion notice). */
  flush(agentId: string): void;
  dispose(): void;
}

export function createParentDelivery(options: {
  manager: AgentManager;
  coordinator: TaskCoordinator;
  pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">;
  active: () => boolean;
  owns: (record: AgentRecord) => boolean;
  onFailure: () => void;
}): ParentDelivery {
  const { manager, coordinator, pi, active, owns } = options;
  const pending = new Map<string, Pending[]>();
  let disposed = false;

  const waiting = (agentId: string, runId: string) => coordinator.countWaits({ sourceId: "agent", taskId: agentId, runId }) > 0;

  function deliver(agentId: string, entry: Pending): void {
    if (!entry.messages.length || disposed || !active()) return;
    const messages = entry.messages.splice(0);
    try {
      pi.sendMessage<SubagentMessageDetails>({
        customType: SUBAGENT_MESSAGE_TYPE,
        content: formatSubagentMessages(agentId, messages),
        display: false,
        details: { agentId, messages: messages.map(message => ({ requestId: message.requestId, seq: message.seq })) },
      }, { triggerTurn: true, deliverAs: "steer" });
    } catch { options.onFailure(); }
  }

  function attempt(agentId: string): void {
    const entries = pending.get(agentId);
    if (!entries) return;
    for (const entry of entries) {
      if (entry.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined; }
      // Held for an active wait on that execution; the wait's end reschedules this.
      if (!entry.messages.length || waiting(agentId, entry.runId)) continue;
      deliver(agentId, entry);
    }
    const left = entries.filter(entry => entry.messages.length);
    if (left.length) pending.set(agentId, left); else pending.delete(agentId);
  }

  function schedule(agentId: string): void {
    if (disposed || !active()) return;
    for (const entry of pending.get(agentId) ?? []) {
      if (entry.timer !== undefined || !entry.messages.length) continue;
      entry.timer = setTimeout(() => { entry.timer = undefined; if (!disposed && active()) attempt(agentId); }, MESSAGE_HOLD_MS);
    }
  }

  const offMessages = manager.subscribeParentMessages((record, accepted) => {
    if (disposed || !active() || !owns(record)) return;
    // A reply a waiter already received is returned by that tool call only.
    if (accepted.deliveredToWaiter) return;
    const { message } = accepted;
    const data: SubagentMessageEntryData = {
      agentId: record.id, label: record.id,
      requestId: message.requestId, text: message.text, at: message.at,
    };
    try { pi.appendEntry(SUBAGENT_MESSAGE_TYPE, data); } catch { options.onFailure(); }
    const entries = pending.get(record.id) ?? [];
    let entry = entries.find(candidate => candidate.runId === message.runId);
    if (!entry) { entry = { runId: message.runId, messages: [] }; entries.push(entry); }
    entry.messages.push(message);
    pending.set(record.id, entries);
    schedule(record.id);
  });
  // A wait ending (completed, released or cancelled) may leave held messages.
  const offWaits = coordinator.subscribeWaits(() => { for (const agentId of pending.keys()) schedule(agentId); });

  return {
    take(identity) {
      const entries = pending.get(identity.taskId);
      const entry = entries?.find(candidate => candidate.runId === identity.runId);
      if (!entries || !entry) return [];
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      const messages = entry.messages.splice(0);
      const left = entries.filter(candidate => candidate !== entry && candidate.messages.length);
      if (left.length) pending.set(identity.taskId, left); else pending.delete(identity.taskId);
      return messages;
    },
    flush(agentId) { if (!disposed && active()) attempt(agentId); },
    dispose() {
      if (disposed) return;
      disposed = true;
      offMessages(); offWaits();
      for (const entries of pending.values()) for (const entry of entries) if (entry.timer !== undefined) clearTimeout(entry.timer);
      pending.clear();
    },
  };
}
