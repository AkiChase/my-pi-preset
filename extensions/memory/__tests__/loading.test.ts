import assert from "node:assert/strict";
import { it } from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
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
  assert.equal(existsSync(join(agentDir, "unused-agent")), false);
});
