import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Metadata only: never authority, and never a second copy of startup content. */
export interface StartupRecord {
  version: 1;
  owner: string;
  origin: string;
  parts: string[];
  outcome: "provided" | "skipped" | "unavailable";
}
export interface StartupDetails { startup: StartupRecord }

/** May be spread into composite message details alongside owner-specific state. */
export function startupDetails(owner: string, origin: string, parts: string[], outcome: StartupRecord["outcome"] = "provided"): StartupDetails {
  return { startup: { version: 1, owner, origin, parts: [...parts], outcome } };
}

/** Read the complete current branch, not the compacted model window or all branches.
 * Returned drafts are not confirmation: only a subsequently visible branch entry counts.
 * origin is a stable project/source key so inherited fork history remains recognized.
 */
export function hasStartup(branch: readonly SessionEntry[], customType: string, owner: string, origin: string, part: string,
  legacy?: (entry: SessionEntry) => boolean): boolean {
  return branch.some(entry => {
    if (legacy?.(entry)) return true;
    if ((entry.type !== "custom_message" && entry.type !== "custom") || entry.customType !== customType) return false;
    const data: unknown = entry.type === "custom_message" ? entry.details : entry.data;
    if (!data || typeof data !== "object" || !("startup" in data)) return false;
    const record = data.startup;
    return !!record && typeof record === "object" && "version" in record && record.version === 1
      && "owner" in record && record.owner === owner && "origin" in record && record.origin === origin
      && "parts" in record && Array.isArray(record.parts) && record.parts.every(item => typeof item === "string") && record.parts.includes(part)
      && "outcome" in record && (record.outcome === "provided" || record.outcome === "skipped" || record.outcome === "unavailable");
  });
}
