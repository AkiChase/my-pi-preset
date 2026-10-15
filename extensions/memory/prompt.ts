import { MemoryError } from "./policy.ts";
import { buildIndex } from "./store.ts";
import type { MemoryStore } from "./store.ts";

export const MEMORY_SECTION = "project_memory";
export const MEMORY_RULES = `# Project memory
Use project memory for durable information across sessions. The four types are:
- user: project-scoped user preferences and working style.
- feedback: corrections and lessons; explain why and how to apply them.
- project: non-obvious durable constraints; explain why and how to apply them.
- reference: pointers to external resources and where to find information.
When the user explicitly asks you to remember something, save it promptly with memory_write. You may proactively save important durable preferences or corrections, but do not claim to capture everything.
Do not save daily logs, current tasks or task status, facts derivable from code or Git, rules already in AGENTS.md, or credentials and secrets.
Read relevant bodies on demand with memory_read; the index below contains metadata only. Before updating or forgetting, read the current entry and use its exact revision. Update an existing entry rather than appending duplicates; expectedRevision=null is only for creation. Use memory_forget for irreversible deletion, never an empty body.
Memories are dated observations, not live state. Verify relevant files, behavior and facts before acting. Use memory_list with offset/query to discover entries omitted from the bounded index.`;

// Only fixed diagnostics are exposed: OS/parser messages and paths are untrusted.
const DIAGNOSTICS: Record<string, string> = {
  path: "Unsafe memory path or symlink; inspect the private agent directory.",
  config: "Invalid memory configuration; inspect memory.json.",
  capacity: "Memory scan capacity exceeded; manual cleanup is required. No partial index is used.",
  metadata: "Invalid or oversized memory metadata; inspect the topic frontmatter.",
  secret: "Memory metadata rejected by credential checks; values are not displayed.",
  encoding: "Memory metadata is not valid UTF-8.",
  name: "Invalid memory filename; inspect the topic names.",
  type: "Invalid memory type in topic metadata.",
};
export function memoryDiagnostic(error: unknown): string {
  const code = error instanceof MemoryError && Object.hasOwn(DIAGNOSTICS, error.code) ? error.code : "unavailable";
  return `Memory index unavailable (${code}). ${DIAGNOSTICS[code] ?? "Project initialization or filesystem access failed; inspect the project and private agent directory."} No cached index is used.`;
}
export function unavailableMemoryPrompt(diagnostic: string): string {
  return `${MEMORY_RULES}\n\n${diagnostic}`;
}
export function buildMemoryPrompt(store: MemoryStore): string {
  try {
    const index = buildIndex(store.scan().entries);
    return `${MEMORY_RULES}\n\n${index.total === 0 ? "No memories yet. Save durable information using the rules above.\n" : ""}${index.text}`;
  } catch (error) { return unavailableMemoryPrompt(memoryDiagnostic(error)); }
}
