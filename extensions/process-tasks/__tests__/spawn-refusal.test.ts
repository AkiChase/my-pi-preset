import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnWithFileOutput } from "../spawn.ts";

test("a synchronous no-PID spawn refusal identifies the executable and corrective checks", async t => {
  const root = mkdtempSync(join(tmpdir(), "spawn-refusal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logPath = join(root, "output.log");
  assert.throws(() => spawnWithFileOutput({ file: "pi-deliberately-missing-executable", cwd: root, logPath }),
    error => error instanceof Error && /pi-deliberately-missing-executable/.test(error.message) && /PATH/.test(error.message) && /no child process was started/.test(error.message));
  assert.equal(existsSync(logPath), false, "failed setup removes its output log");
  // Native errno arrives asynchronously; the listener must still absorb it.
  await new Promise<void>(resolve => setImmediate(resolve));
});
