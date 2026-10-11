#!/usr/bin/env node
// Offline check for scripts/sync.mjs, using a fake `pi` that records calls.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const syncScript = resolve(scriptDir, "..", "scripts", "sync.mjs");

const FAKE_PI = `#!/bin/sh
printf '%s\\n' "$*" >> "$PI_CALLS_FILE"
[ "$1" = "list" ] && printf '%s\\n' "$PI_LIST_OUTPUT"
exit 0
`;
function run({ manifest, conflicts, listOutput, args = [] }) {
  const box = mkdtempSync(join(tmpdir(), "sync-test-"));
  const binDir = join(box, "bin");
  const callsFile = join(box, "calls.txt");
  mkdirSync(binDir);

  writeFileSync(join(binDir, "pi"), FAKE_PI);
  chmodSync(join(binDir, "pi"), 0o755);
  writeFileSync(callsFile, "");
  writeFileSync(
    join(box, "pi-packages.json"),
    JSON.stringify(conflicts ? { packages: manifest, conflicts } : { packages: manifest }, null, 2),
  );

  const result = spawnSync("node", [syncScript, "--manifest", join(box, "pi-packages.json"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      PI_BIN: join(binDir, "pi"),
      PI_CALLS_FILE: callsFile,
      PI_LIST_OUTPUT: listOutput,
    },
  });

  const calls = readFileSync(callsFile, "utf8")
    .split("\n")
    .filter((line) => line && line !== "list");
  rmSync(box, { recursive: true, force: true });
  return { stderr: result.stderr, stdout: result.stdout, calls, status: result.status };
}

const OTHER = "npm:other-tool";

// 1. Default mode is a merge: an extra installed package is kept, not removed.
{
  const list = ["User packages:", "  git:github.com/AkiChase/my-pi-extensions", "    /p/git", `  ${OTHER}`, "    /p/other"].join("\n");
  const { calls, stderr } = run({ manifest: { "git:github.com/AkiChase/my-pi-extensions": "latest" }, listOutput: list });
  assert.deepEqual(calls, ["update git:github.com/AkiChase/my-pi-extensions"]);
  assert.match(stderr, /merge mode/);
  assert.match(stderr, new RegExp(`${OTHER}.*merge mode`));
  assert.match(stderr, /\[1\/1\] update git:github\.com\/AkiChase\/my-pi-extensions/);
  assert.match(stderr, /running: .*pi update git:github\.com\/AkiChase\/my-pi-extensions/);
  console.log("PASS merge mode keeps unlisted packages");
}

// 2. --prune removes what the manifest does not declare.
{
  const list = ["User packages:", "  npm:pi-session-name", "    /p/session", `  ${OTHER}`, "    /p/other"].join("\n");
  const { calls } = run({ manifest: { "npm:pi-session-name": "latest" }, listOutput: list, args: ["--prune"] });
  assert.deepEqual(calls, ["update npm:pi-session-name", `remove ${OTHER}`]);
  console.log("PASS --prune removes unlisted packages");
}

// 3. A changed version reinstalls instead of updating.
{
  const list = ["User packages:", "  npm:pi-session-name@0.1.7", "    /p/session"].join("\n");
  const { calls } = run({ manifest: { "npm:pi-session-name": "^0.2.0" }, listOutput: list });
  assert.deepEqual(calls, ["install npm:pi-session-name@^0.2.0"]);
  console.log("PASS version change reinstalls");
}

// 4. An exact npm version is left alone.
{
  const list = ["User packages:", "  npm:pi-session-name@0.1.7", "    /p/session"].join("\n");
  const { calls } = run({ manifest: { "npm:pi-session-name": "0.1.7" }, listOutput: list });
  assert.deepEqual(calls, []);
  console.log("PASS pinned version is not updated");
}

// 5. A package declared but missing on disk is installed.
{
  const list = ["User packages:", "  npm:pi-session-name"].join("\n");
  const { calls } = run({ manifest: { "npm:pi-session-name": "latest" }, listOutput: list });
  assert.deepEqual(calls, ["install npm:pi-session-name"]);
  console.log("PASS missing install path triggers install");
}

// 6. ssh and https forms of one repository are treated as the same package.
{
  const list = ["User packages:", "  git:git@github.com:AkiChase/my-pi-extensions.git", "    /p/git"].join("\n");
  const { calls } = run({ manifest: { "git:https://github.com/AkiChase/my-pi-extensions": "latest" }, listOutput: list });
  assert.deepEqual(calls, ["install git:https://github.com/AkiChase/my-pi-extensions"]);
  console.log("PASS ssh and https identities match");
}

// 7. --dry-run never calls pi.
{
  const list = ["User packages:", "  npm:pi-session-name", "    /p/session"].join("\n");
  const { calls, stderr } = run({ manifest: { "npm:pi-session-name": "latest", "npm:fresh": "latest" }, listOutput: list, args: ["--dry-run"] });
  assert.deepEqual(calls, []);
  assert.match(stderr, /Dry run/);
  console.log("PASS --dry-run makes no changes");
}

// 8. A bad manifest fails before touching anything.
{
  const { calls, status } = run({ manifest: { "./local-thing": "latest" }, listOutput: "User packages:" });
  assert.equal(status, 1);
  assert.deepEqual(calls, []);
  console.log("PASS unsupported source is rejected");
}

// 9. A conflicting package is removed even in merge mode, because this repo loads it itself.
{
  const list = ["User packages:", "  npm:pi-session-name", "    /p/session", "  npm:pi-patty-bg-tasks", "    /p/patty"].join("\n");
  const { calls, stderr } = run({
    manifest: { "npm:pi-session-name": "latest" },
    conflicts: ["npm:pi-patty-bg-tasks"],
    listOutput: list,
  });
  // Steps run grouped by action (install, then update, then remove), so the removal lands last.
  assert.deepEqual(calls, ["update npm:pi-session-name", "remove npm:pi-patty-bg-tasks"]);
  assert.match(stderr, /npm:pi-patty-bg-tasks.*bundled by this repo/);
  console.log("PASS conflicting package is removed in merge mode");
}

// 10. A conflict that is not installed is a no-op.
{
  const list = ["User packages:", "  npm:pi-session-name", "    /p/session"].join("\n");
  const { calls } = run({
    manifest: { "npm:pi-session-name": "latest" },
    conflicts: ["npm:@heyhuynhgiabuu/pi-pretty"],
    listOutput: list,
  });
  assert.deepEqual(calls, ["update npm:pi-session-name"]);
  console.log("PASS absent conflict is a no-op");
}

// 11. Declaring one source as both wanted and conflicting is a manifest error.
{
  const { calls, status } = run({
    manifest: { "npm:pi-patty-bg-tasks": "latest" },
    conflicts: ["npm:pi-patty-bg-tasks"],
    listOutput: "User packages:",
  });
  assert.equal(status, 1);
  assert.deepEqual(calls, []);
  console.log("PASS source in both packages and conflicts is rejected");
}

console.log("\nAll sync checks passed.");
