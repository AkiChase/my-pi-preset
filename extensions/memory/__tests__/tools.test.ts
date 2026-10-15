import assert from "node:assert/strict";
import { it } from "node:test";
import * as fs from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import memory from "../../memory.ts";
import { fixture } from "./helpers.ts";
import { setEnabled } from "../config.ts";

it("actual registration exposes four TypeBox tools, errors are isError, lifecycle fences startup and old operations", async t => {
  const { agentDir, project, root } = fixture(t);
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  // Typed partial public registration seam, not a copied tool implementation or private registry.
  const pi = {
    registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); },
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) { handlers.set(name, handler); return () => { handlers.delete(name); }; },
  } as unknown as ExtensionAPI;
  const ctx = { cwd: project.root } as ExtensionToolContext;
  const emit = async (name: string) => { await handlers.get(name)?.({}, ctx); };
  memory(pi);
  assert.deepEqual([...tools.keys()], ["memory_read", "memory_list", "memory_write", "memory_forget"]);
  assert.deepEqual([...handlers.keys()], ["session_start", "session_shutdown"]);
  assert.equal(fs.existsSync(join(agentDir, "memory", "projects")), true); // fixture initialized a separate store only
  const call = (name: string, params: Record<string, unknown>, signal?: AbortSignal) => tools.get(name)!.execute("test", params, signal, undefined, ctx);
  assert.equal((await call("memory_list", {})).isError, true);
  await emit("session_start");
  assert.equal((await call("memory_list", {})).isError, undefined);
  assert.equal((await call("memory_write", { name: "item", type: "user", description: "Preference", body: " " , expectedRevision: null })).isError, true);
  const args = { name: "item", type: "user", description: "Preference", body: "Use concise explanations.", expectedRevision: null };
  const saved = await call("memory_write", args); assert.equal(saved.isError, undefined);
  const read = await call("memory_read", { name: "item" }); const detail = read.details as { revision: string };
  assert.match(detail.revision, /^[a-f0-9]{64}$/); assert.equal((await call("memory_write", args)).isError, true);
  const secret = "sk-" + "X".repeat(30); const error = await call("memory_write", { ...args, name: "secret", body: secret });
  assert.equal(error.isError, true); assert.equal(JSON.stringify(error).includes(secret), false);
  await setEnabled(agentDir, false); assert.equal((await call("memory_list", {})).isError, undefined); assert.equal((await call("memory_forget", { name: "item", expectedRevision: detail.revision })).isError, true);
  await setEnabled(agentDir, true);
  const controller = new AbortController(); controller.abort(); assert.equal((await call("memory_read", { name: "item" }, controller.signal)).isError, true);
  const dirs = fs.readdirSync(join(agentDir, "memory", "projects")); const actual = dirs.find(name => name !== project.id)!;
  const lock = join(agentDir, "memory", "projects", actual, ".memory-lock");
  fs.writeFileSync(lock, JSON.stringify({ version: 1, token: "11111111-1111-1111-1111-111111111111", pid: process.pid }));
  const pending = call("memory_write", { ...args, expectedRevision: detail.revision, body: "Late update" });
  await new Promise<void>(resolve => setTimeout(resolve, 30)); await emit("session_shutdown");
  const result = await pending; assert.equal(result.isError, true); fs.unlinkSync(lock);
  assert.match(fs.readFileSync(join(agentDir, "memory", "projects", actual, "item.md"), "utf8"), /concise/);
  await emit("session_start"); assert.equal((await call("memory_list", {})).isError, true);
  // Shutdown during asynchronous Git initialization never creates the new project directory.
  const lateHandlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const latePi = { registerTool() {}, on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) { lateHandlers.set(name, handler); return () => {}; } } as unknown as ExtensionAPI;
  memory(latePi); const newCwd = join(root, "new-cwd"); fs.mkdirSync(newCwd);
  const start = lateHandlers.get("session_start")!({}, { cwd: newCwd } as ExtensionContext);
  lateHandlers.get("session_shutdown")!({}, ctx); await assert.rejects(Promise.resolve(start), /closed/);
  assert.deepEqual(fs.readdirSync(join(agentDir, "memory", "projects")), dirs);
});
