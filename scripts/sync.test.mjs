#!/usr/bin/env node
// Offline check for scripts/sync.mjs, using a fake `pi` that records calls and a
// throwaway agent directory. Nothing here touches the real ~/.pi.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function run({
  manifest,
  conflicts,
  settings,
  keybindings,
  preserve,
  settingsFile,
  keybindingsFile,
  listOutput = "User packages:",
  args = [],
}) {
  const box = mkdtempSync(join(tmpdir(), "sync-test-"));
  const binDir = join(box, "bin");
  const agentDir = join(box, "agent");
  const callsFile = join(box, "calls.txt");
  mkdirSync(binDir);
  mkdirSync(agentDir);

  writeFileSync(join(binDir, "pi"), FAKE_PI);
  chmodSync(join(binDir, "pi"), 0o755);
  writeFileSync(callsFile, "");
  writeFileSync(
    join(box, "pi-preset.json"),
    JSON.stringify(
      {
        packages: manifest,
        ...(conflicts ? { conflicts } : {}),
        ...(settings ? { settings } : {}),
        ...(keybindings ? { keybindings } : {}),
        ...(preserve ? { preserve } : {}),
      },
      null,
      2,
    ),
  );
  // Seeded as raw text so a deliberately broken file can be tested too.
  if (settingsFile !== undefined) writeFileSync(join(agentDir, "settings.json"), settingsFile);
  if (keybindingsFile !== undefined) writeFileSync(join(agentDir, "keybindings.json"), keybindingsFile);

  const result = spawnSync("node", [syncScript, "--manifest", join(box, "pi-preset.json"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      PI_BIN: join(binDir, "pi"),
      PI_CODING_AGENT_DIR: agentDir,
      PI_CALLS_FILE: callsFile,
      PI_LIST_OUTPUT: listOutput,
    },
  });

  const calls = readFileSync(callsFile, "utf8")
    .split("\n")
    .filter((line) => line && line !== "list");
  const readBack = (name) => {
    const path = join(agentDir, name);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  };
  const out = {
    stderr: result.stderr,
    stdout: result.stdout,
    calls,
    status: result.status,
    settingsText: readBack("settings.json"),
    keybindingsText: readBack("keybindings.json"),
  };
  rmSync(box, { recursive: true, force: true });
  return out;
}

const OTHER = "npm:other-tool";
const ONE = { "npm:pi-session-name": "latest" };

// ---------------------------------------------------------------------------
// packages
// ---------------------------------------------------------------------------

// 1. Default mode is a merge: an extra installed package is kept, not removed.
{
  const list = ["User packages:", "  git:github.com/AkiChase/my-pi-preset", "    /p/git", `  ${OTHER}`, "    /p/other"].join("\n");
  const { calls, stderr } = run({ manifest: { "git:github.com/AkiChase/my-pi-preset": "latest" }, listOutput: list });
  assert.deepEqual(calls, ["update git:github.com/AkiChase/my-pi-preset"]);
  assert.match(stderr, /packages merge/);
  assert.match(stderr, new RegExp(`${OTHER}.*merge mode`));
  assert.match(stderr, /\[1\/1\] update git:github\.com\/AkiChase\/my-pi-preset/);
  assert.match(stderr, /running: .*pi update git:github\.com\/AkiChase\/my-pi-preset/);
  console.log("PASS merge mode keeps unlisted packages");
}

// 2. --prune removes what the manifest does not declare.
{
  const list = ["User packages:", "  npm:pi-session-name", "    /p/session", `  ${OTHER}`, "    /p/other"].join("\n");
  const { calls } = run({ manifest: ONE, listOutput: list, args: ["--prune"] });
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
  const { calls } = run({ manifest: ONE, listOutput: list });
  assert.deepEqual(calls, ["install npm:pi-session-name"]);
  console.log("PASS missing install path triggers install");
}

// 6. ssh and https forms of one repository are treated as the same package.
{
  const list = ["User packages:", "  git:git@github.com:AkiChase/my-pi-preset.git", "    /p/git"].join("\n");
  const { calls } = run({ manifest: { "git:https://github.com/AkiChase/my-pi-preset": "latest" }, listOutput: list });
  assert.deepEqual(calls, ["install git:https://github.com/AkiChase/my-pi-preset"]);
  console.log("PASS ssh and https identities match");
}

// 7. --dry-run never calls pi and never writes a config file.
{
  const list = ["User packages:", "  npm:pi-session-name", "    /p/session"].join("\n");
  const { calls, stderr, settingsText, keybindingsText } = run({
    manifest: { "npm:pi-session-name": "latest", "npm:fresh": "latest" },
    settings: { retry: { maxRetries: 5 } },
    keybindings: { "app.session.rename": [] },
    listOutput: list,
    args: ["--dry-run"],
  });
  assert.deepEqual(calls, []);
  assert.match(stderr, /Dry run/);
  assert.equal(settingsText, undefined);
  assert.equal(keybindingsText, undefined);
  console.log("PASS --dry-run makes no changes");
}

// 8. A bad manifest fails before touching anything.
{
  const { calls, status } = run({ manifest: { "./local-thing": "latest" } });
  assert.equal(status, 1);
  assert.deepEqual(calls, []);
  console.log("PASS unsupported source is rejected");
}

// 9. A conflicting package is removed even in merge mode, because this repo loads it itself.
{
  const list = ["User packages:", "  npm:pi-session-name", "    /p/session", "  npm:pi-patty-bg-tasks", "    /p/patty"].join("\n");
  const { calls, stderr } = run({
    manifest: ONE,
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
    manifest: ONE,
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
  });
  assert.equal(status, 1);
  assert.deepEqual(calls, []);
  console.log("PASS source in both packages and conflicts is rejected");
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

// 12. Merge mode aligns declared leaves and leaves everything else alone.
{
  const { settingsText, status } = run({
    manifest: {},
    settings: { retry: { maxRetries: 5 }, markdown: { mermaid: "off" } },
    settingsFile: JSON.stringify({ theme: "dark", retry: { maxRetries: 3, baseDelayMs: 1000 }, steeringMode: "all" }, null, 2),
    args: ["--sync", "settings"],
  });
  assert.equal(status, 0);
  const result = JSON.parse(settingsText);
  assert.deepEqual(result, {
    theme: "dark",
    retry: { maxRetries: 5, baseDelayMs: 1000 },
    steeringMode: "all",
    markdown: { mermaid: "off" },
  });
  // Existing keys keep their position; new ones are appended.
  assert.deepEqual(Object.keys(result), ["theme", "retry", "steeringMode", "markdown"]);
  console.log("PASS merge mode aligns declared keys only");
}

// 13. A declared null removes the key; a null for an absent key does nothing.
{
  const { settingsText, stderr } = run({
    manifest: {},
    settings: { steeringMode: null, followUpMode: null },
    settingsFile: JSON.stringify({ theme: "dark", steeringMode: "all" }),
    args: ["--sync", "settings"],
  });
  assert.deepEqual(JSON.parse(settingsText), { theme: "dark" });
  assert.match(stderr, /unset.*steeringMode.*declared null/);
  assert.doesNotMatch(stderr, /followUpMode/);
  console.log("PASS declared null removes a key");
}

// 14. Prune mode removes undeclared keys, but not preserved or pi-owned ones,
//     and does not leave an emptied section behind.
{
  const { settingsText } = run({
    manifest: {},
    settings: { retry: { maxRetries: 5 } },
    preserve: { settings: ["theme", "defaultModel"] },
    settingsFile: JSON.stringify({
      theme: "dark",
      defaultModel: "claude-opus-5",
      steeringMode: "all",
      retry: { maxRetries: 3, baseDelayMs: 1000 },
      compaction: { enabled: true },
      packages: ["npm:pi-session-name"],
      lastChangelogVersion: "1.1.0",
    }),
    args: ["--sync", "settings", "--prune", "settings"],
  });
  assert.deepEqual(JSON.parse(settingsText), {
    theme: "dark",
    defaultModel: "claude-opus-5",
    retry: { maxRetries: 5 },
    packages: ["npm:pi-session-name"],
    lastChangelogVersion: "1.1.0",
  });
  console.log("PASS prune mode keeps preserved and pi-owned keys only");
}

// 15. A deep path is created even when its parents are missing.
{
  const { settingsText } = run({
    manifest: {},
    settings: { retry: { provider: { maxRetries: 2 } } },
    settingsFile: JSON.stringify({ theme: "dark" }),
    args: ["--sync", "settings"],
  });
  assert.deepEqual(JSON.parse(settingsText), { theme: "dark", retry: { provider: { maxRetries: 2 } } });
  console.log("PASS a deep path is created");
}

// 16. An array value is replaced whole, not merged element-wise.
{
  const { settingsText } = run({
    manifest: {},
    settings: { defaultTools: ["read", "bash"] },
    settingsFile: JSON.stringify({ defaultTools: ["read", "bash", "edit", "write"] }),
    args: ["--sync", "settings"],
  });
  assert.deepEqual(JSON.parse(settingsText), { defaultTools: ["read", "bash"] });
  console.log("PASS an array value is replaced whole");
}

// 17. Nothing is written when the machine already matches.
{
  const seeded = JSON.stringify({ retry: { maxRetries: 5 } }, null, 2);
  const { settingsText, stderr } = run({
    manifest: {},
    settings: { retry: { maxRetries: 5 } },
    settingsFile: seeded,
    args: ["--sync", "settings"],
  });
  assert.equal(settingsText, seeded);
  assert.match(stderr, /Already up to date/);
  console.log("PASS an already matching machine is left untouched");
}

// 18. A broken settings.json is reported, not overwritten.
{
  const broken = "{ oops";
  const { settingsText, status, stderr } = run({
    manifest: {},
    settings: { retry: { maxRetries: 5 } },
    settingsFile: broken,
    args: ["--sync", "settings"],
  });
  assert.equal(status, 1);
  assert.equal(settingsText, broken);
  assert.match(stderr, /not valid JSON/);
  console.log("PASS a broken settings.json is not overwritten");
}

// 19. Keys pi maintains itself cannot be declared.
{
  const { status, stderr } = run({ manifest: {}, settings: { packages: [] }, args: ["--sync", "settings"] });
  assert.equal(status, 1);
  assert.match(stderr, /maintained by pi itself/);
  console.log("PASS declaring a pi-owned settings key is rejected");
}

// 20. Declaring and preserving the same path is contradictory.
{
  const { status, stderr } = run({
    manifest: {},
    settings: { retry: { maxRetries: 5 } },
    preserve: { settings: ["retry"] },
    args: ["--sync", "settings"],
  });
  assert.equal(status, 1);
  assert.match(stderr, /both declared/);
  console.log("PASS a declared-and-preserved path is rejected");
}

// 21. A preserve entry can be written as explicit segments, for keys with dots.
{
  const { settingsText } = run({
    manifest: {},
    settings: {},
    preserve: { settings: [["modelThinkingLevels", "openai/gpt-4.1"]] },
    settingsFile: JSON.stringify({ modelThinkingLevels: { "openai/gpt-4.1": "high", "openai/gpt-5": "low" } }),
    args: ["--sync", "settings", "--prune"],
  });
  assert.deepEqual(JSON.parse(settingsText), { modelThinkingLevels: { "openai/gpt-4.1": "high" } });
  console.log("PASS a segment-array preserve path protects a dotted key");
}

// 21b. A dotted top-level settings key is a manifest error: it would create a
//      key pi ignores instead of nesting.
{
  const { status, stderr } = run({ manifest: {}, settings: { "markdown.mermaid": "off" }, args: ["--sync", "settings"] });
  assert.equal(status, 1);
  assert.match(stderr, /looks like a path; nest objects instead/);
  console.log("PASS a dotted settings key is rejected");
}

// ---------------------------------------------------------------------------
// keybindings
// ---------------------------------------------------------------------------

// 22. A single key and a one-element list mean the same thing, so neither is rewritten.
{
  const seeded = JSON.stringify({ "app.session.tree": "ctrl+shift+t" }, null, 2);
  const { keybindingsText, stderr } = run({
    manifest: {},
    keybindings: { "app.session.tree": ["ctrl+shift+t"] },
    keybindingsFile: seeded,
    args: ["--sync", "keybindings"],
  });
  assert.equal(keybindingsText, seeded);
  assert.match(stderr, /keep.*app\.session\.tree/);
  console.log("PASS a key and a one-element list compare equal");
}

// 23. Declared bindings are written, including [] to disable an action, and the
//     file is created when it does not exist yet.
{
  const { keybindingsText } = run({
    manifest: {},
    keybindings: { "app.session.rename": [], "tui.editor.jumpForward": [] },
    args: ["--sync", "keybindings"],
  });
  assert.deepEqual(JSON.parse(keybindingsText), { "app.session.rename": [], "tui.editor.jumpForward": [] });
  console.log("PASS keybindings.json is created with the declared bindings");
}

// 24. Prune mode drops action ids the manifest does not declare. An action id
//     contains dots, and must not be split into a path.
{
  const { keybindingsText } = run({
    manifest: {},
    keybindings: { "app.session.rename": [] },
    preserve: { keybindings: ["tui.editor.jumpForward"] },
    keybindingsFile: JSON.stringify({
      "app.session.rename": "ctrl+r",
      "tui.editor.jumpForward": "alt+]",
      "tui.altScreen.pageUp": [],
    }),
    args: ["--sync", "keybindings", "--prune"],
  });
  assert.deepEqual(JSON.parse(keybindingsText), { "app.session.rename": [], "tui.editor.jumpForward": "alt+]" });
  console.log("PASS prune mode drops undeclared action ids");
}

// 25. An unusable keybinding value is a manifest error.
{
  const { status, stderr } = run({ manifest: {}, keybindings: { "app.session.rename": 42 }, args: ["--sync", "keybindings"] });
  assert.equal(status, 1);
  assert.match(stderr, /must be a key, an array of keys/);
  console.log("PASS an invalid keybinding value is rejected");
}

// ---------------------------------------------------------------------------
// domain selection
// ---------------------------------------------------------------------------

// 26. --sync packages leaves the config files alone and does not even read them.
{
  const seeded = JSON.stringify({ theme: "dark" });
  const list = ["User packages:", "  npm:pi-session-name", "    /p/session"].join("\n");
  const { calls, settingsText, stderr } = run({
    manifest: ONE,
    settings: { retry: { maxRetries: 5 } },
    settingsFile: seeded,
    listOutput: list,
    args: ["--sync", "packages"],
  });
  assert.deepEqual(calls, ["update npm:pi-session-name"]);
  assert.equal(settingsText, seeded);
  assert.match(stderr, /skip\s+settings, keybindings/);
  console.log("PASS --sync packages touches nothing else");
}

// 27. --sync settings never runs pi at all.
{
  const { calls, status } = run({
    manifest: ONE,
    settings: { retry: { maxRetries: 5 } },
    args: ["--sync", "settings"],
  });
  assert.equal(status, 0);
  assert.deepEqual(calls, []);
  console.log("PASS --sync settings never runs pi");
}

// 28. A bare --prune prunes the synced domains, not the unselected ones.
{
  const { settingsText, calls, stderr } = run({
    manifest: ONE,
    settings: { retry: { maxRetries: 5 } },
    settingsFile: JSON.stringify({ theme: "dark", retry: { maxRetries: 3 } }),
    args: ["--sync", "settings", "--prune"],
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(JSON.parse(settingsText), { retry: { maxRetries: 5 } });
  assert.match(stderr, /mode\s+settings prune/);
  console.log("PASS bare --prune applies to the synced domains");
}

// 29. Pruning a domain that is not being synced is a usage error.
{
  const { status, stderr, calls } = run({ manifest: ONE, args: ["--sync", "settings", "--prune", "packages"] });
  assert.equal(status, 1);
  assert.deepEqual(calls, []);
  assert.match(stderr, /--prune packages needs --sync to include packages/);
  console.log("PASS --prune outside --sync is rejected");
}

// 30. An unknown domain name is a usage error.
{
  const { status, stderr } = run({ manifest: ONE, args: ["--sync", "setings"] });
  assert.equal(status, 1);
  assert.match(stderr, /unknown domain "setings"/);
  console.log("PASS an unknown domain is rejected");
}

// 31. --sync none does nothing and says so.
{
  const { status, calls, stderr } = run({ manifest: ONE, args: ["--sync", "none"] });
  assert.equal(status, 0);
  assert.deepEqual(calls, []);
  assert.match(stderr, /nothing selected/);
  console.log("PASS --sync none does nothing");
}

console.log("\nAll sync checks passed.");
