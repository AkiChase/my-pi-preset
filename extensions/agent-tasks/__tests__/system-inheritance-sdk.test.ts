import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("installed SDK and unmodified Pi loader preserve ordinary child startup, live/disk prefix and forced-source refusal", { timeout: 60_000 }, () => {
  const retainedRoot = process.env.CONTEXT_PREFIX_RUN_DIR;
  const box = mkdtempSync(join(retainedRoot ?? tmpdir(), "agent-inheritance-sdk-"));
  const agentDir = join(box, "agent");
  mkdirSync(agentDir);
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./system-inheritance-smoke.mjs", import.meta.url))], {
      cwd: box, env: { ...process.env, HOME: box, PI_CODING_AGENT_DIR: agentDir }, encoding: "utf8", timeout: 50_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\nRaw directory: ${box}`);
    const report = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    for (const flag of ["agreement", "forcedRefused", "startupFull", "resumePrefix", "baseIsNotEffective", "cancelledClosed", "saveFailureRollback"]) assert.equal(report[flag], true, flag);
    assert.equal(report.childRequests, 6);
  } finally {
    // Retain raw requests, report and isolated fixture files for an explicitly
    // owned verification invocation. Ordinary suite fixtures clean up normally.
    if (!retainedRoot) rmSync(box, { recursive: true, force: true });
  }
});
