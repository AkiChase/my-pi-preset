import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const probe = fileURLToPath(new URL("./log-error-probe.mjs", import.meta.url));
for (const scenario of ["missing", "directory", "unreadable", "partial", "setup", "readline"]) {
  test(`registered search ${scenario} log has owned cleanup and a usable subsequent tool`, () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-log-error-"));
    try {
      const result = spawnSync(process.execPath, [probe, scenario], {
        env: { ...process.env, PI_CODING_AGENT_DIR: dir }, encoding: "utf8", timeout: 10_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const report = JSON.parse(result.stdout.trim());
      assert.equal(report.subsequent, "ok");
      assert.equal(report.retained, true);
      assert.equal(report.error_code, ["missing", "directory", "unreadable"].includes(scenario) ? "log_error" : null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
for (const target of ["target", "global"]) for (const change of ["close", "replace"]) {
  test(`registered missing-log search preserves ${change} fence (${target})`, () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-log-error-fence-"));
    try {
      const result = spawnSync(process.execPath, [probe, "missing", change, target], {
        env: { ...process.env, PI_CODING_AGENT_DIR: dir }, encoding: "utf8", timeout: 10_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.equal(JSON.parse(result.stdout.trim()).error_code, "closed");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
