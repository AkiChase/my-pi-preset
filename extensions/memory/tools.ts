import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MemoryError, TYPES, fail } from "./policy.ts";
import type { MemoryStore } from "./store.ts";

export interface ToolOrigin { store: MemoryStore; assertActive: () => void }
export type GetOrigin = (cwd: string, signal?: AbortSignal) => ToolOrigin;
const Name = Type.String({ maxLength: 80, pattern: "^[a-z0-9][a-z0-9_-]*$" });
const Revision = Type.String({ pattern: "^[a-f0-9]{64}$" });
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
    name: "memory_read", label: "Memory Read", description: "Read a project memory by name, including its complete SHA256 revision. Memories are observations, not live state; verify relevant facts before acting.",
    parameters: Type.Object({ name: Name }),
    execute: async (_id, params, signal, _update, ctx) => boundary(async () => {
      const origin = getOrigin(ctx.cwd, signal); origin.assertActive();
      const record = origin.store.read(params.name);
      origin.assertActive();
      return result(JSON.stringify({ ...record.metadata, revision: record.revision }) + "\n\n" + record.body, record);
    }),
  });
  pi.registerTool({
    name: "memory_list", label: "Memory List", description: "List project memory metadata (no bodies). Default 20, maximum 50 per page and 8KiB. Continue using nextOffset; query filters name/description only.",
    parameters: Type.Object({ query: Type.Optional(Type.String({ maxLength: 320 })), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }),
    execute: async (_id, params, signal, _update, ctx) => boundary(async () => {
      const origin = getOrigin(ctx.cwd, signal); origin.assertActive();
      const page = origin.store.list(params.query, params.offset, params.limit);
      origin.assertActive();
      return result(page.text, { entries: page.entries, total: page.total, offset: page.offset, nextOffset: page.nextOffset });
    }),
  });
  pi.registerTool({
    name: "memory_write", label: "Memory Write", description: "Create or conditionally update project memory. Explicit requests to remember should be saved promptly. Save durable preferences, corrections, non-obvious constraints or resource pointers; not daily logs, task status, code/Git/AGENTS facts or credentials. Read before updating; use expectedRevision=null only for creation. Nonblank body required. Feedback/project memories should explain why and how to apply.",
    parameters: Type.Object({ name: Name, type: Type.Union(TYPES.map(value => Type.Literal(value))), description: Type.String({ maxLength: 320 }), body: Type.String({ minLength: 1, maxLength: 16384 }), expectedRevision: Type.Union([Revision, Type.Null()]) }),
    execute: async (_id, params, signal, _update, ctx) => boundary(async () => {
      const origin = getOrigin(ctx.cwd, signal);
      const saved = await origin.store.write(params, origin.assertActive);
      if (saved.indexNeedsRepair) return result("Memory body saved, but the derived index needs repair. Refresh safely before retrying; do not repeat creation.", saved, true);
      origin.assertActive();
      return result(`Memory saved. Revision: ${saved.revision}`, saved);
    }),
  });
  pi.registerTool({
    name: "memory_forget", label: "Memory Forget", description: "Permanently forget a project memory using the exact revision from memory_read. Irreversible: no recovery backup is created.",
    parameters: Type.Object({ name: Name, expectedRevision: Revision }),
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
