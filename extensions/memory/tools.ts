import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseControlArguments } from "../shared/tool-arguments.ts";
import { MemoryError, TYPES, fail } from "./policy.ts";
import type { MemoryStore } from "./store.ts";

export interface ToolOrigin { store: MemoryStore; assertActive: () => void }
export type GetOrigin = (cwd: string, signal?: AbortSignal) => ToolOrigin;
// Match the 160-codepoint limits enforced by policy.ts and store.ts.
const Name = Type.String({ maxLength: 80, pattern: "^[a-z0-9][a-z0-9_-]*$" });
const Revision = Type.String({ pattern: "^[a-f0-9]{64}$" });
const Description = Type.String({ maxLength: 160 });
// Only the length bound is declared here. A character-set rule needs `pattern`, and a regex in the
// schema is compiled by every consumer, including provider-side validators that reject lookaround.
// The control-free rule is enforced at execute instead, and named in this description.
const Query = Type.String({ maxLength: 160, description: "Filter memory names and descriptions; empty string lists all. Case-insensitive literal substring, not a regex. At most 160 Unicode codepoints; queries containing control characters are rejected." });
function listArguments(value: unknown): { query: string; offset: number; limit: number } {
  const invalid = (): never => fail("list", "Invalid memory_list arguments: provide only query (control-free string, at most 160 Unicode codepoints), offset (non-negative safe integer), and limit (safe integer 1–50). Use query=\"\", offset=0, limit=20 for the first page.");
  let params: Record<string, unknown>;
  // Shape errors can include untrusted field names; expose only a fixed safe MemoryError.
  try { params = parseControlArguments(value, ["query", "offset", "limit"], []); }
  catch { return invalid(); }
  const { query, offset, limit } = params;
  if (typeof query !== "string" || [...query].length > 160 || /[\x00-\x1f\x7f-\x9f]/u.test(query)
    || typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0
    || typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return invalid();
  return { query, offset, limit };
}
const result = (text: string, details: unknown, isError = false) => ({ content: [{ type: "text" as const, text }], details, ...(isError ? { isError: true } : {}) });
async function boundary(operation: () => Promise<ReturnType<typeof result>>): Promise<ReturnType<typeof result>> {
  try { return await operation(); }
  catch (error) {
    const code = error instanceof MemoryError ? error.code : "io";
    // Raw OS / parser errors may contain credentials or untrusted paths. Do not echo them.
    const message = error instanceof MemoryError ? error.message : "Memory operation failed due to a filesystem or permission error.";
    return result(message, { error: code }, true);
  }
}
export function registerMemoryTools(pi: ExtensionAPI, getOrigin: GetOrigin): void {
  pi.registerTool({
    name: "memory_read", label: "memory_read", description: "Read a project memory by name, including its complete SHA256 revision. Memories are observations, not live state; verify relevant facts before acting.",
    parameters: Type.Object({ name: Name }, { additionalProperties: false }),
    execute: async (_id, params, signal, _update, ctx) => boundary(async () => {
      const origin = getOrigin(ctx.cwd, signal); origin.assertActive();
      const record = origin.store.read(params.name);
      origin.assertActive();
      return result(JSON.stringify({ ...record.metadata, revision: record.revision }) + "\n\n" + record.body, record);
    }),
  });
  pi.registerTool({
    name: "memory_list", label: "memory_list", description: "List project memory metadata (no bodies). Provide query, offset and limit explicitly; maximum 50 per page and 8KiB. Continue using nextOffset; query filters name/description only.",
    promptSnippet: "List project memory metadata with explicit query, offset and limit.",
    promptGuidelines: [`memory_list usage:
  - Always provide query, offset and limit. Use query=\"\" for all metadata, offset=0 for the first page, and limit=20 for an ordinary page.
  - query filters names/descriptions only (at most 160 Unicode codepoints, no controls); offset is a non-negative safe integer; limit is a safe integer from 1 to 50.
  - Results contain metadata only and fit 8KiB. Continue with nextOffset until it is null; use memory_read for bodies and revisions.
  Examples:
  - First page: {"query":"","offset":0,"limit":20}`],
    parameters: Type.Object({ query: Query, offset: Type.Number({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1, description: "Non-negative safe integer page offset. Use 0 for the first page." }), limit: Type.Number({ minimum: 1, maximum: 50, multipleOf: 1, description: "Safe integer page size, 1–50. Use 20 for an ordinary page." }) }, { additionalProperties: false }),
    execute: async (_id, params, signal, _update, ctx) => boundary(async () => {
      const { query, offset, limit } = listArguments(params);
      const origin = getOrigin(ctx.cwd, signal); origin.assertActive();
      const page = origin.store.list(query, offset, limit);
      origin.assertActive();
      return result(page.text, { entries: page.entries, total: page.total, offset: page.offset, nextOffset: page.nextOffset });
    }),
  });
  pi.registerTool({
    name: "memory_write", label: "memory_write", description: "Create or conditionally update project memory. Explicit requests to remember should be saved promptly. Save durable preferences, corrections, non-obvious constraints or resource pointers; not daily logs, task status, code/Git/AGENTS facts or credentials. Read before updating; use expectedRevision=null only for creation. Nonblank body required. Feedback/project memories should explain why and how to apply.",
    parameters: Type.Object({ name: Name, type: Type.Union(TYPES.map(value => Type.Literal(value))), description: Description, body: Type.String({ minLength: 1, maxLength: 16384 }), expectedRevision: Type.Union([Revision, Type.Null()]) }, { additionalProperties: false }),
    execute: async (_id, params, signal, _update, ctx) => boundary(async () => {
      const origin = getOrigin(ctx.cwd, signal);
      const saved = await origin.store.write(params, origin.assertActive);
      if (saved.indexNeedsRepair) return result("Memory body saved, but the derived index needs repair. Refresh safely before retrying; do not repeat creation.", saved, true);
      origin.assertActive();
      return result(`Memory saved. Revision: ${saved.revision}`, saved);
    }),
  });
  pi.registerTool({
    name: "memory_forget", label: "memory_forget", description: "Permanently forget a project memory using the exact revision from memory_read. Irreversible: no recovery backup is created.",
    parameters: Type.Object({ name: Name, expectedRevision: Revision }, { additionalProperties: false }),
    execute: async (_id, params, signal, _update, ctx) => boundary(async () => {
      const origin = getOrigin(ctx.cwd, signal);
      const deleted = await origin.store.forget(params.name, params.expectedRevision, origin.assertActive);
      if (deleted.indexNeedsRepair) return result("Memory deleted permanently, but the derived index needs repair. Refresh safely; no recovery backup exists.", deleted, true);
      origin.assertActive();
      return result("Memory permanently forgotten. No recovery backup was created.", deleted);
    }),
  });
}
export function closed(): never { return fail("closed", "Memory session is closed, uninitialized or has changed; no operation is allowed."); }
