import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadExtensions } from "../beautify/__tests__/renderer-host.mjs";
import "../agent-tasks/__tests__/source-loader.mjs";
const { createNestedSubagentTools } = await import("../agent-tasks/src/nested-tools.ts");
const { createReplyToParentTool } = await import("../agent-tasks/src/parent-messaging.ts");
const { registerDispatchTool } = await import("../trellis/lib/subagent-rpc.ts");

/** Every JSON null type or null literal anywhere in a schema, with its path. */
function nullSites(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((item, index) => item === null ? [`${path}[${index}]`] : nullSites(item, `${path}[${index}]`));
  if (!node || typeof node !== "object") return [];
  const own = Reflect.get(node, "type");
  const sites = own === "null" || (Array.isArray(own) && own.includes("null")) ? [`${path}.type`] : [];
  for (const [key, value] of Object.entries(node)) {
    if (value === null) sites.push(`${path}.${key}`);
    else sites.push(...nullSites(value, `${path}.${key}`));
  }
  return sites;
}

test("no registered model tool schema uses JSON null, including nested and child-only tools", async () => {
  // The detector itself must see the old nullable-control shapes.
  assert.deepEqual(nullSites({ properties: { a: { anyOf: [{ type: "null" }, { type: "string" }] }, b: { enum: ["x", null] }, c: { type: ["number", "null"] } } }),
    ["$.properties.a.anyOf[0].type", "$.properties.b.enum[1]", "$.properties.c.type"]);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const entries = readdirSync(root).filter(name => name.endsWith(".ts")).map(name => join(root, name));
  const cwd = mkdtempSync(join(tmpdir(), "tool-schema-sentinels-"));
  try {
    const loaded = await loadExtensions(entries, cwd);
    assert.deepEqual(loaded.errors, []);
    const schemas = new Map<string, unknown>();
    for (const extension of loaded.extensions) {
      for (const [name, tool] of extension.tools as Map<string, { definition: { parameters: unknown } }>) schemas.set(name, tool.definition.parameters);
    }
    for (const name of ["subagent_run", "subagent_message", "agent_manage", "process_manage", "monitor", "memory_write"]) {
      assert.ok(schemas.has(name), `${name} is registered by the package entries`);
    }
    const nested = createNestedSubagentTools({ manager: {} as never, pi: {} as ExtensionAPI, parentAgentId: "parent", depth: 1, maxSubagentDepth: 2, allowedSubagents: "all", configCwd: cwd });
    for (const tool of nested) schemas.set(`nested:${tool.name}`, tool.parameters);
    const reply = createReplyToParentTool({ send: () => ({ ok: false, error: "offline" }) } as never);
    schemas.set(reply.name, reply.parameters);
    // trellis_dispatch registers only once a Trellis project is active; register it directly.
    registerDispatchTool({ events: { on: () => () => {}, emit: () => {} }, on: () => {}, registerTool: (tool: { name: string; parameters: unknown }) => schemas.set(tool.name, tool.parameters) } as never, async () => undefined);
    assert.ok(schemas.has("trellis_dispatch"));
    assert.ok(schemas.size >= 15, `collected ${schemas.size} tool schemas`);
    const offending = [...schemas].flatMap(([name, schema]) => nullSites(JSON.parse(JSON.stringify(schema))).map(site => `${name} ${site}`));
    assert.deepEqual(offending, []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
