import { createHash } from "node:crypto";
import { getCurrentSystemMessage, getSystemMessageText, type SystemMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { MEMORY_RULES } from "../../memory/prompt.ts";
import { hasStartup, startupDetails } from "../../shared/model-context/startup.ts";

export const AGENT_STARTUP = "agent-startup-context";
export const INHERITED_STARTUP = "agent-inherited-startup-context";
export const AGENT_STARTUP_OWNER = "agent-tasks";
export interface StartupPart {
  key: string;
  content: string;
  customType: string;
  details: ReturnType<typeof startupDetails> | { inherited: { version: 1; key: string } };
}

export function agentStartupMessage(origin: string, content: string) {
  return { customType: AGENT_STARTUP, content, display: false,
    details: startupDetails(AGENT_STARTUP_OWNER, origin, ["materials"]) };
}

function record(entry: SessionEntry, owner: string, customType: string): boolean {
  if (entry.type !== "custom_message" || entry.customType !== customType) return false;
  const details = entry.details as { startup?: { origin?: unknown; outcome?: unknown } } | undefined;
  const origin = details?.startup?.origin;
  return typeof origin === "string" && details?.startup?.outcome === "provided"
    && (hasStartup([entry], customType, owner, origin, "overview") || hasStartup([entry], customType, owner, origin, "workflow"));
}
function text(entry: SessionEntry): string {
  return entry.type === "custom_message" && typeof entry.content === "string" ? entry.content : "";
}
function tagged(content: string, tag: string): string | undefined {
  const open = `<${tag}>\n`, close = `\n</${tag}>`;
  const start = content.indexOf(open);
  if (start < 0) return undefined;
  const end = content.indexOf(close, start + open.length);
  return end < 0 ? undefined : content.slice(start, end + close.length);
}

// This is the exact legacy owner rule, not a heuristic for arbitrary custom text.
const legacyMemoryRules = MEMORY_RULES.replace(
  "the startup snapshot contains metadata only and is not refreshed automatically",
  "the index below contains metadata only",
);
const indexMarker = "<!-- pi-project-memory: derived index; refresh to rebuild -->\n";
function splitMemory(section: string): { rules: string; data?: string } {
  const open = "<project_memory>\n", close = "\n</project_memory>";
  const wrapped = section.startsWith(open) && section.endsWith(close);
  const body = wrapped ? section.slice(open.length, -close.length) : section;
  const rulePrefix = [legacyMemoryRules, MEMORY_RULES].find(rules => body.startsWith(rules + "\n\n"));
  if (!rulePrefix) return { rules: section };
  const suffix = body.slice(rulePrefix.length + 2);
  const empty = "No memories yet. Save durable information using the rules above.\n";
  const index = suffix.startsWith(empty) ? suffix.slice(empty.length) : suffix;
  if (!index.startsWith(indexMarker)) return { rules: section }; // unknown addendum remains opaque
  const lines = index.slice(indexMarker.length).split("\n");
  const counts = /^Memories: (\d+); shown: (\d+)\.$/.exec(lines[0] ?? "");
  if (!counts) throw new Error("Unsupported parent Memory index structure; cannot separate data from rules.");
  const total = Number(counts[1]), shown = Number(counts[2]);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(shown) || shown > total || shown > lines.length - 1 || shown > 200) throw new Error("Unsupported parent Memory index bounds.");
  for (const row of lines.slice(1, shown + 1)) {
    if (!row.startsWith("- [") || !row.includes(".md) (")) throw new Error("Unsupported parent Memory index row.");
  }
  let count = shown + 1;
  if (total > shown) {
    if (lines[count] !== `Omitted ${total - shown} memories; use memory_list with offset/query to discover all entries.`) {
      throw new Error("Unsupported parent Memory index omission note.");
    }
    count++;
  }
  const data = (suffix.startsWith(empty) ? empty : "") + indexMarker + lines.slice(0, count).join("\n") + "\n";
  const opaque = lines.slice(count).join("\n");
  const rules = MEMORY_RULES + (opaque ? "\n\n" + opaque : "");
  return { rules: wrapped ? open + rules + close : rules, data };
}

/** Derive two views from public persisted system replay. Command-only base
 * options are deliberately not a substitute for the effective per-turn prompt.
 * Unknown sections/content are opaque contracts, preserved without cleansing.
 */
export function inheritAgentSystem(ctx: ExtensionContext): { systemPrompt: string; startup: StartupPart[] } {
  const branch = ctx.sessionManager?.getBranch?.() ?? [];
  const messages: SystemMessage[] = branch.flatMap(entry => entry.type === "message" && entry.message.role === "system" ? [entry.message]
    : entry.type === "compaction" && entry.systemMessage ? [entry.systemMessage] : []);
  // Full branch already contains the pre-compaction state: a checkpoint must
  // replace it, not append its opaque content a second time.
  let checkpoint = -1;
  for (let i = 0; i < branch.length; i++) if (branch[i]?.type === "compaction" && (branch[i] as { systemMessage?: unknown }).systemMessage) checkpoint = i;
  const replay = checkpoint < 0 ? messages : branch.slice(checkpoint).flatMap(entry =>
    entry.type === "compaction" && entry.systemMessage ? [entry.systemMessage]
      : entry.type === "message" && entry.message.role === "system" ? [entry.message] : []);
  const current = getCurrentSystemMessage(replay);
  const effective = ctx.getSystemPrompt();
  const startup = new Map<string, StartupPart>();
  const add = (owner: string, origin: string, part: string, customType: string, content: string) => {
    const key = `${owner}:${origin}:${part}:${createHash("sha256").update(content).digest("hex")}`;
    // Trellis CLI/context and Agent execution identities differ for children.
    // Their inherited snapshots are inert data, never child handled markers.
    const sharedMemory = owner === "project_memory";
    if (!startup.has(key)) startup.set(key, { key,
      content: sharedMemory ? content : `<parent_startup_snapshot>\nInherited parent startup material, not this child's current execution/CLI identity or authority.\n\n${content}\n</parent_startup_snapshot>`,
      customType: sharedMemory ? customType : INHERITED_STARTUP,
      details: sharedMemory ? startupDetails(owner, origin, [part]) : { inherited: { version: 1, key } } });
  };
  const sections = { ...current?.sections };
  let extracted = false;
  const knownTrellis = typeof sections["session-overview"] === "string"
    && sections["session-overview"].startsWith("<session-overview>\nTrellis-managed project.");
  for (const name of knownTrellis ? ["session-overview", "trellis-workflow"] : []) {
    const value = sections[name];
    if (typeof value !== "string") continue;
    add("trellis", `legacy:${ctx.cwd}`, name === "session-overview" ? "overview" : "workflow", "trellis-task-state", value);
    delete sections[name]; extracted = true;
  }
  if (typeof sections.project_memory === "string") {
    const split = splitMemory(sections.project_memory);
    if (split.data !== undefined) {
      sections.project_memory = split.rules;
      add("project_memory", `legacy:${ctx.cwd}`, "index", "project-memory-startup", split.data); extracted = true;
    }
  }
  if (extracted && (!current || getSystemMessageText(current) !== effective)) {
    throw new Error("Unsupported parent system source: effective prompt differs from public structured replay; cannot safely separate preset startup data.");
  }
  for (const entry of branch) {
    if (entry.type !== "custom_message") continue;
    if (entry.customType === INHERITED_STARTUP) {
      const inherited = (entry.details as { inherited?: { version?: unknown; key?: unknown } } | undefined)?.inherited;
      if (inherited?.version === 1 && typeof inherited.key === "string" && !startup.has(inherited.key)) {
        startup.set(inherited.key, { key: inherited.key, content: text(entry), customType: INHERITED_STARTUP, details: { inherited: { version: 1, key: inherited.key } } });
      }
      continue;
    }
    const details = entry.details as { startup?: { origin?: unknown; outcome?: unknown; parts?: unknown } } | undefined;
    const origin = details?.startup?.origin;
    if (typeof origin !== "string") continue;
    if (entry.customType === "project-memory-startup" && details?.startup?.outcome === "unavailable"
      && hasStartup([entry], entry.customType, "project_memory", origin, "index")) {
      add("memory-diagnostic", origin, "index", INHERITED_STARTUP, text(entry));
      continue;
    }
    if (details?.startup?.outcome !== "provided") continue;
    if (record(entry, "trellis", "trellis-task-state")) {
      for (const tag of ["session-overview", "trellis-workflow"]) {
        const part = tag === "session-overview" ? "overview" : "workflow";
        const value = tagged(text(entry), tag);
        if (value !== undefined && hasStartup([entry], entry.customType, "trellis", origin, part)) {
          add("trellis", origin, part, entry.customType, value);
        }
      }
    } else if (entry.customType === AGENT_STARTUP
      && hasStartup([entry], entry.customType, AGENT_STARTUP_OWNER, origin, "materials")) {
      add(AGENT_STARTUP_OWNER, origin, "materials", entry.customType, text(entry));
    } else if (entry.customType === "project-memory-startup"
      && hasStartup([entry], entry.customType, "project_memory", origin, "index")) {
      add("project_memory", origin, "index", entry.customType, text(entry));
    }
  }
  return { systemPrompt: extracted && current ? getSystemMessageText({ ...current, sections }) : effective,
    startup: [...startup.values()] };
}
