import "./source-loader.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { CONFIG_FILENAME, DEFAULTS, loadConfig } from "../../process-tasks/config.ts";

void it("foundation config ignores old names; real agent discovery retains project precedence", async () => {
  const box = mkdtempSync(join(tmpdir(), "agent-tasks-foundation-"));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(box, "agent");
  const cwd = join(box, "project");
  mkdirSync(agentDir);
  mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
  mkdirSync(join(cwd, ".agents", "agents"), { recursive: true });
  mkdirSync(join(agentDir, "agents"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const { loadSettings, saveSettings } = await import("../src/settings.ts");
    const { loadCustomAgents } = await import("../src/custom-agents.ts");
    writeFileSync(join(agentDir, "subagents.json"), '{"maxConcurrent":99}');
    writeFileSync(join(cwd, ".pi", "subagents.json"), '{"maxConcurrent":88}');
    assert.deepEqual(loadSettings(cwd), {});
    writeFileSync(join(agentDir, "agent-tasks.json"), '{"maxConcurrent":3,"backgroundByDefault":true,"toolDescriptionMode":"custom"}');
    writeFileSync(join(cwd, ".pi", "agent-tasks.json"), '{"maxConcurrent":2}');
    assert.deepEqual(loadSettings(cwd), { maxConcurrent: 2, backgroundByDefault: true });
    assert.equal(saveSettings({ maxConcurrent: 4 }, cwd), true);
    assert.equal(JSON.parse(readFileSync(join(cwd, ".pi", "agent-tasks.json"), "utf8")).maxConcurrent, 4);
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(join(cwd, ".pi", "agent-tasks.json"), "utf8")), "toolDescriptionMode"), false);
    assert.equal(readFileSync(join(cwd, ".pi", "subagents.json"), "utf8"), '{"maxConcurrent":88}');

    writeFileSync(join(agentDir, "bg-tasks.json"), '{"timeoutMs":60000}');
    assert.equal(CONFIG_FILENAME, "process-tasks.json");
    assert.deepEqual(loadConfig(agentDir, { BG_TASKS_TIMEOUT_MS: "70000" }).config, DEFAULTS);
    writeFileSync(join(agentDir, CONFIG_FILENAME), '{"timeoutMs":80000}');
    assert.equal(loadConfig(agentDir, { BG_TASKS_TIMEOUT_MS: "70000" }).config.timeoutMs, 80000);
    assert.equal(loadConfig(agentDir, { PROCESS_TASKS_TIMEOUT_MS: "90000" }).config.timeoutMs, 90000);

    const definition = (description: string) => `---\nname: offline-reviewer\ndescription: ${description}\ntools: read, grep\n---\nReview without spawning.\n`;
    writeFileSync(join(agentDir, "agents", "global.md"), definition("global"));
    writeFileSync(join(cwd, ".agents", "agents", "workspace.md"), definition("workspace"));
    writeFileSync(join(cwd, ".pi", "agents", "project.md"), definition("project"));
    const discovered = loadCustomAgents(cwd);
    assert.equal(discovered.size, 1);
    assert.equal(discovered.get("offline-reviewer")?.description, "project");
    assert.deepEqual(discovered.get("offline-reviewer")?.builtinToolNames, ["read", "grep"]);
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    rmSync(box, { recursive: true, force: true });
  }
});
