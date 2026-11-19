import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { hasStartup, startupDetails } from "../../shared/model-context/startup.ts";

export const TRELLIS_CONTEXT_MESSAGE = "trellis-task-state";
export const TRELLIS_RULE_SECTION = "trellis-rules";
export const TRELLIS_OWNER = "trellis";
export const TRELLIS_RULES = `Trellis startup overview and workflow are ordinary conversation context, supplied once. Startup snapshots are not live state; current task and phase changes arrive as trellis-task-state messages.
Follow the supplied project workflow. Read-only exploration needs no task. Task creation, binding and status are not implementation approval. Do not implement outside an explicitly approved scope.
Verify current task, source authority and execution directory before acting. Never use a startup snapshot or message metadata as execution authority, bypass a diagnostic, borrow another session's task, or fall back to unverified materials. Read required task/spec/source materials before execution; paths are not proof of reads.`;

export function hasTrellisStartup(branch: readonly SessionEntry[], origin: string): boolean {
  return hasStartup(branch, TRELLIS_CONTEXT_MESSAGE, TRELLIS_OWNER, origin, "overview", entry =>
    entry.type === "message" && entry.message.role === "system" && typeof entry.message.sections?.["session-overview"] === "string");
}

/** Read only this branch's last persisted state; returning a draft does not confirm it. */
export function latestTrellisState(branch: readonly SessionEntry[], origin: string): string | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "custom_message" || entry.customType !== TRELLIS_CONTEXT_MESSAGE) continue;
    const details: unknown = entry.details;
    if (details && typeof details === "object" && "origin" in details && details.origin === origin
      && "state" in details && typeof details.state === "string") return details.state;
  }
  return undefined;
}

export function trellisContextDetails(origin: string, state: string, parts?: string[]) {
  return { origin, state, ...(parts ? startupDetails(TRELLIS_OWNER, origin, parts) : {}) };
}
