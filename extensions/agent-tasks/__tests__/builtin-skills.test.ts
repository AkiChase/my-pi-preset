import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("real host discovers, binds and reads the plugin manual independently of ordinary skill filters", { timeout: 120_000 }, () => {
  const box = mkdtempSync(join(tmpdir(), "agent-builtin-skills-"));
  const agentDir = join(box, "agent");
  mkdirSync(agentDir);
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./builtin-skills-smoke.mjs", import.meta.url))], {
      cwd: box, env: { ...process.env, HOME: box, PI_CODING_AGENT_DIR: agentDir }, encoding: "utf8", timeout: 110_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    for (const key of ["startup", "reload", "noSkills", "packageFilter", "collision", "missing", "moved", "nativeRead"]) assert.equal(report[key], true, key);
    assert.equal(report.childPolicies, 7);
  } finally { rmSync(box, { recursive: true, force: true }); }
});
