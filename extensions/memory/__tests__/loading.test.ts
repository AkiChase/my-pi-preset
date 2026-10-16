import assert from "node:assert/strict";
import { it } from "node:test";
import * as fs from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { DefaultResourceLoader, ExtensionRunner, SettingsManager, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { fixture } from "./helpers.ts";

it("installed Pi jiti loader loads the real entry once without factory storage or background resources", async t => {
  const { agentDir, project } = fixture(t);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(agentDir, "unused-agent");
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const path = fileURLToPath(new URL("../../memory.ts", import.meta.url));
  const loaded = await discoverAndLoadExtensions([path], project.root, agentDir);
  assert.deepEqual(loaded.errors, []); assert.equal(loaded.extensions.length, 1);
  assert.deepEqual([...loaded.extensions[0].tools.keys()], ["memory_read", "memory_list", "memory_write", "memory_forget"]);
  assert.deepEqual([...loaded.extensions[0].commands.keys()], ["memory"]);
  assert.equal(existsSync(join(agentDir, "unused-agent")), false);
});

it("a leftover external memory package is reported as a tool conflict and shadowed by the first registration", async t => {
  // Pins the pi 1.3.0 behaviour this migration depends on, through the session resource loader
  // (discoverAndLoadExtensions alone skips conflict detection): both extensions stay loaded, the
  // later one gets a `Tool "..." conflicts with ...` load error that interactive startup displays,
  // and ExtensionRunner.getAllRegisteredTools() keeps the first registration per tool name.
  // pi-preset.json therefore lists npm:pi-memory under `conflicts` so sync removes it.
  const { agentDir, project } = fixture(t);
  const stale = join(agentDir, "stale-memory.ts");
  fs.writeFileSync(stale, `export default function (pi) {
    for (const name of ["memory_read", "memory_list", "memory_write", "memory_forget"]) {
      pi.registerTool({ name, label: "Stale", description: "STALE " + name, parameters: { type: "object", properties: {} }, async execute() { return { content: [{ type: "text", text: "stale" }] }; } });
    }
  }\n`);
  const ours = fileURLToPath(new URL("../../memory.ts", import.meta.url));
  const loader = new DefaultResourceLoader({ cwd: project.root, agentDir, settingsManager: SettingsManager.inMemory(), additionalExtensionPaths: [ours, stale] });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.extensions.map(extension => extension.path), [ours, stale], "duplicate tool names do not unload either extension");
  assert.deepEqual(loaded.errors, ["memory_read", "memory_list", "memory_write", "memory_forget"].map(name => ({ path: stale, error: `Tool "${name}" conflicts with ${ours}` })));
  // The runner only reads the loaded extensions here; session/model services are never touched.
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, project.root, {} as never, {} as never);
  const names = runner.getAllRegisteredTools().map(tool => tool.definition.name).filter(name => name.startsWith("memory"));
  assert.deepEqual(names, ["memory_read", "memory_list", "memory_write", "memory_forget"]);
  // Ours is loaded first, so ours is retained and the stale copy is shadowed.
  const write = runner.getAllRegisteredTools().find(tool => tool.definition.name === "memory_write")!;
  assert.match(write.definition.description, /^Create or conditionally update project memory\./);
});
