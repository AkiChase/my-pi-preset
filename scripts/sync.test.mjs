#!/usr/bin/env node
// Offline check for scripts/sync.mjs, using a fake `pi` that records calls and a
// throwaway agent directory. Nothing here touches the real ~/.pi.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  files,
  preserve,
  settingsFile,
  keybindingsFile,
  seedFiles,
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
        ...(files ? { files } : {}),
        ...(preserve ? { preserve } : {}),
      },
      null,
      2,
    ),
  );
  // Seeded as raw text so a deliberately broken file can be tested too.
  if (settingsFile !== undefined) writeFileSync(join(agentDir, "settings.json"), settingsFile);
  if (keybindingsFile !== undefined) writeFileSync(join(agentDir, "keybindings.json"), keybindingsFile);
  for (const [name, text] of Object.entries(seedFiles ?? {})) writeFileSync(join(agentDir, name), text);

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
    // The box is removed below, so every file has to be captured up front.
    fileTexts: Object.fromEntries(readdirSync(agentDir).map((name) => [name, readBack(name)])),
  };
  rmSync(box, { recursive: true, force: true });
  return out;
}

// Session naming replacement must also remove the old package in ordinary merge mode.
{
  const preset = JSON.parse(readFileSync(resolve(scriptDir, "..", "pi-preset.json"), "utf8"));
  const titleConfig = '{"automatic":false,"interval":17}';
  const result = run({
    manifest: preset.packages, conflicts: preset.conflicts,
    listOutput: "User packages:\n  npm:pi-session-name@0.1.7\n    /p/session-name",
    seedFiles: { "session-name.json": titleConfig }, args: ["--sync", "packages"],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.includes("remove npm:pi-session-name@0.1.7") || result.calls.includes("remove npm:pi-session-name"));
  assert.equal(result.calls.some(call => /^(install|update) npm:pi-session-name/.test(call)), false);
  assert.equal(result.fileTexts["session-name.json"], titleConfig);
  console.log("PASS session-name conflict replacement preserves global naming configuration");
}

// Composition replacement is a real offline dry-run plan, not a comment-only guard.
{
  const preset = JSON.parse(readFileSync(resolve(scriptDir, "..", "pi-preset.json"), "utf8"));
  const result = run({
    manifest: preset.packages,
    conflicts: preset.conflicts,
    listOutput: ["User packages:", "  npm:@tintinweb/pi-subagents", "    /p/upstream"].join("\n"),
    settingsFile: '{"untouched":true}',
    args: ["--sync", "packages", "--dry-run"],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, []);
  assert.equal(result.settingsText, '{"untouched":true}');
  assert.match(result.stderr, /^\s*remove\s+packages\s+npm:@tintinweb\/pi-subagents\s/m);
  assert.match(result.stderr, /^\s*install\s+packages\s+git:github.com\/AkiChase\/my-pi-preset\s/m);
  // Scope the assertion to plan rows: "must not be installed" also contains
  // the word install, but is not an installation action.
  assert.doesNotMatch(result.stderr, /^\s*install\s+packages\s+npm:@tintinweb\/pi-subagents\s/m);
  console.log("PASS preset dry-run replaces standalone subagents without installing or writing state");
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
// files (extension config files in the agent directory)
// ---------------------------------------------------------------------------

// 25b. A declared key is written into an extension config file that does not
//      exist yet.
{
  const { fileTexts, stderr } = run({
    manifest: {},
    files: { "pi-input-history.json": { searchShortcut: "alt+r" } },
    args: ["--sync", "files"],
  });
  assert.deepEqual(JSON.parse(fileTexts["pi-input-history.json"]), { searchShortcut: "alt+r" });
  // The plan names the file, not just the key.
  assert.match(stderr, /set\s+files\s+pi-input-history\.json:searchShortcut/);
  console.log("PASS an extension config file is created with the declared key");
}

// 25c. Merge mode leaves the file's other keys alone, including keys the
//      extension itself may have written.
{
  const { fileTexts } = run({
    manifest: {},
    files: { "pi-input-history.json": { searchShortcut: "alt+r" } },
    seedFiles: { "pi-input-history.json": JSON.stringify({ searchShortcut: "ctrl+r", newerShortcut: "ctrl+s" }) },
    args: ["--sync", "files"],
  });
  assert.deepEqual(JSON.parse(fileTexts["pi-input-history.json"]), { searchShortcut: "alt+r", newerShortcut: "ctrl+s" });
  console.log("PASS merge mode keeps undeclared keys in an extension config file");
}

// Removed declarations must never read, rewrite or prune a personal legacy file.
{
  const preset = JSON.parse(readFileSync(resolve(scriptDir, "..", "pi-preset.json"), "utf8"));
  assert.equal(Object.hasOwn(preset.files, "pi-pretty.json"), false);
  for (const args of [["--sync", "files"], ["--sync", "files", "--prune"]]) {
    const legacy = "{invalid personal legacy config";
    const result = run({ manifest: {}, files: preset.files, seedFiles: { "pi-pretty.json": legacy }, args });
    assert.equal(result.status, 0);
    assert.equal(result.fileTexts["pi-pretty.json"], legacy);
    assert.doesNotMatch(result.stderr, /pi-pretty/);
  }
  console.log("PASS removed Pretty declaration leaves legacy file untouched");
}

// 25d. Prune mode reaches only declared files, and still respects preserve.
//      A file the manifest never mentions is not even read.
{
  const { fileTexts, stderr } = run({
    manifest: {},
    files: { "pi-input-history.json": { searchShortcut: "alt+r" } },
    preserve: { files: { "pi-input-history.json": ["scrollUpShortcut"] } },
    seedFiles: {
      "pi-input-history.json": JSON.stringify({ newerShortcut: "ctrl+s", scrollUpShortcut: "ctrl+k" }),
      "process-tasks.json": JSON.stringify({ timeoutMs: 60000 }),
    },
    args: ["--sync", "files", "--prune"],
  });
  assert.deepEqual(JSON.parse(fileTexts["pi-input-history.json"]), { scrollUpShortcut: "ctrl+k", searchShortcut: "alt+r" });
  assert.deepEqual(JSON.parse(fileTexts["process-tasks.json"]), { timeoutMs: 60000 });
  assert.doesNotMatch(stderr, /process-tasks\.json/);
  console.log("PASS prune mode reaches declared files only");
}

// 25e. A declared null removes a key from an extension config file.
{
  const { fileTexts } = run({
    manifest: {},
    files: { "pi-input-history.json": { searchShortcut: null } },
    seedFiles: { "pi-input-history.json": JSON.stringify({ searchShortcut: "alt+r", newerShortcut: "ctrl+s" }) },
    args: ["--sync", "files"],
  });
  assert.deepEqual(JSON.parse(fileTexts["pi-input-history.json"]), { newerShortcut: "ctrl+s" });
  console.log("PASS a declared null removes a key from an extension config file");
}

// 25f. A file with its own domain, or one holding pi's state, is rejected.
for (const [name, pattern] of [
  ["settings.json", /use the "settings" domain/],
  ["keybindings.json", /use the "keybindings" domain/],
  ["auth.json", /holds credentials/],
  ["models.json", /pi-cache-optimizer/],
]) {
  const { status, stderr } = run({ manifest: {}, files: { [name]: { a: 1 } }, args: ["--sync", "files"] });
  assert.equal(status, 1);
  assert.match(stderr, pattern);
  console.log(`PASS "files.${name}" is rejected`);
}

// 25g. A path, a traversal, or a non-JSON name is rejected: this domain writes
//      inside the agent directory only.
for (const name of ["sub/dir.json", "../escape.json", "notjson", ".hidden.json"]) {
  const { status, stderr } = run({ manifest: {}, files: { [name]: { a: 1 } }, args: ["--sync", "files"] });
  assert.equal(status, 1);
  assert.match(stderr, /must be a plain "<name>\.json" file name/);
  console.log(`PASS "files.${name}" is rejected`);
}

// 25h. Preserving a key in a file nobody declares protects nothing, so it is
//      an error rather than a silently useless entry.
{
  const { status, stderr } = run({
    manifest: {},
    files: { "pi-input-history.json": { searchShortcut: "alt+r" } },
    preserve: { files: { "process-tasks.json": ["timeoutMs"] } },
    args: ["--sync", "files"],
  });
  assert.equal(status, 1);
  assert.match(stderr, /names a file that "files" does not declare/);
  console.log("PASS preserving a key in an undeclared file is rejected");
}

// 25i. Declaring and preserving the same key in one file is contradictory.
{
  const { status, stderr } = run({
    manifest: {},
    files: { "pi-input-history.json": { searchShortcut: "alt+r" } },
    preserve: { files: { "pi-input-history.json": ["searchShortcut"] } },
    args: ["--sync", "files"],
  });
  assert.equal(status, 1);
  assert.match(stderr, /both declared and preserved/);
  console.log("PASS a declared-and-preserved key in a file is rejected");
}

// 25j. A broken extension config file is reported, not overwritten.
{
  const broken = "{ oops";
  const { fileTexts, status, stderr } = run({
    manifest: {},
    files: { "pi-input-history.json": { searchShortcut: "alt+r" } },
    seedFiles: { "pi-input-history.json": broken },
    args: ["--sync", "files"],
  });
  assert.equal(status, 1);
  assert.equal(fileTexts["pi-input-history.json"], broken);
  assert.match(stderr, /not valid JSON/);
  console.log("PASS a broken extension config file is not overwritten");
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
  assert.match(stderr, /skip\s+settings, keybindings, files/);
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

// ---------------------------------------------------------------------------
// Local development source switching (stateful mock, no real pi or network)
// ---------------------------------------------------------------------------

const SELF = "git:github.com/AkiChase/my-pi-preset";
const REMOTE_VARIANTS = [
  SELF,
  `${SELF}@v1.2.0`,
  "git:git@github.com:AkiChase/my-pi-preset.git@main",
  "https://github.com/AkiChase/my-pi-preset.git",
  "ssh://git@github.com/AkiChase/my-pi-preset.git@main",
];
const STATEFUL_PI = `#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.PI_CALLS_FILE, JSON.stringify(args) + "\\n");
const file = process.env.PI_STATE_FILE;
const settings = JSON.parse(readFileSync(file, "utf8"));
if (args[0] === "--version") console.log("test-pi");
else if (args[0] === "list") {
  console.log("User packages:");
  for (const source of settings.packages ?? []) {
    console.log("  " + source);
    console.log("    " + (source.startsWith("/") ? source : process.env.PI_REMOTE_PATH || "/mock/installed"));
  }
  console.log("Project packages:");
  console.log("  " + process.env.PI_PROJECT_SOURCE);
  console.log("    /mock/project");
} else {
  if (args[0] === "remove" && args[1] === process.env.PI_FAIL_REMOVE) process.exit(7);
  if (args[0] === "remove") settings.packages = settings.packages.filter(source => source !== args[1]);
  else if (args[0] === "install" && !settings.packages.includes(args[1])) settings.packages.push(args[1]);
  writeFileSync(file, JSON.stringify(settings));
}
`;

function withCheckout(check, { pkg, git = true, downloaded = false, manifest } = {}) {
  const box = realpathSync(mkdtempSync(join(tmpdir(), "sync-dev-test-")));
  const root = join(box, "checkout with spaces");
  const agentDir = join(box, "agent");
  const pi = join(box, "mock-pi.mjs");
  const callsFile = join(box, "calls.jsonl");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "extensions"));
  mkdirSync(agentDir);
  if (git) mkdirSync(join(root, ".git"));
  cpSync(syncScript, join(root, "scripts", "sync.mjs"));
  cpSync(resolve(scriptDir, "..", "install.sh"), join(root, "install.sh"));
  const manifestPath = join(root, "pi-preset.json");
  const manifestText = JSON.stringify(manifest ?? {
    packages: { [SELF]: "latest", "npm:pi-session-name": "latest", "git:github.com/example/third-party": "latest" },
    conflicts: ["npm:bundled"],
    settings: { retry: { maxRetries: 5 } },
    keybindings: { "tui.editor.jumpForward": [] },
    files: { "pi-input-history.json": { searchShortcut: "alt+r" } },
    preserve: { settings: ["theme"] },
  });
  writeFileSync(manifestPath, manifestText);
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg ?? { name: "my-pi-preset", pi: { extensions: ["extensions/*.ts"] } }));
  writeFileSync(pi, STATEFUL_PI);
  chmodSync(pi, 0o755);
  const settingsFile = join(agentDir, "settings.json");
  const seed = (packages) => writeFileSync(settingsFile, JSON.stringify({ packages, theme: "dark" }));
  seed([]);
  const execute = (args = [], { installer = false, stdin = false, cwd = box, extraEnv = {} } = {}) => {
    writeFileSync(callsFile, "");
    const script = downloaded ? join(box, "sync.mjs") : join(root, "scripts", "sync.mjs");
    if (downloaded) cpSync(syncScript, script);
    const command = installer ? "sh" : process.execPath;
    const commandArgs = installer
      ? stdin ? ["-s", "--", ...args] : [join(root, "install.sh"), ...args]
      : [script, "--manifest", manifestPath, ...args];
    const result = spawnSync(command, commandArgs, {
      encoding: "utf8",
      cwd, // By default cwd is outside the checkout; --dev must use the script's root.
      input: stdin ? readFileSync(join(root, "install.sh"), "utf8") : undefined,
      env: {
        ...process.env,
        PI_BIN: pi,
        PI_CODING_AGENT_DIR: agentDir,
        PI_CALLS_FILE: callsFile,
        PI_STATE_FILE: settingsFile,
        PI_PROJECT_SOURCE: root,
        ...extraEnv,
      },
    });
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    return { ...result, calls, actions: calls.filter(([action]) => action !== "list" && action !== "--version") };
  };
  try {
    check({ root, execute, seed, settingsFile, agentDir, manifestPath, manifestText });
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
}

// All installed git spellings/refs of this repo must be removed before install,
// but unrelated npm/git sources still use their original update behavior.
for (const remote of REMOTE_VARIANTS) {
  withCheckout(({ root, execute, seed, settingsFile, manifestPath, manifestText }) => {
    seed([remote, "npm:pi-session-name", "git:github.com/example/third-party", OTHER]);
    const result = execute(["--dev"], { installer: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.actions, [
      ["remove", remote], ["install", root], ["update", "npm:pi-session-name"], ["update", "git:github.com/example/third-party"],
    ]);
    assert.equal(readFileSync(manifestPath, "utf8"), manifestText);
    assert.deepEqual(JSON.parse(readFileSync(settingsFile, "utf8")), {
      packages: ["npm:pi-session-name", "git:github.com/example/third-party", OTHER, root], theme: "dark", retry: { maxRetries: 5 },
    });
    const repeated = execute(["--dev", "--sync", "packages"]);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(repeated.actions, [["update", "npm:pi-session-name"], ["update", "git:github.com/example/third-party"]]);
    assert.match(repeated.stderr, /local checkout; loaded in place/);
  });
}
console.log("PASS --dev switches git spellings/refs to a space-containing checkout and is repeatable");

// Switching back is also explicit in merge mode. Source-switch removals alone
// move earlier; bundled conflicts and prune removals keep their old order.
withCheckout(({ root, execute, seed }) => {
  seed([root, "npm:pi-session-name", "git:github.com/example/third-party", "npm:bundled", OTHER]);
  const result = execute(["--sync", "packages", "--prune", "packages"], { installer: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.actions, [
    ["remove", root], ["install", SELF], ["update", "npm:pi-session-name"], ["update", "git:github.com/example/third-party"],
    ["remove", "npm:bundled"], ["remove", OTHER],
  ]);
  assert.deepEqual(execute(["--sync", "packages"]).actions, [
    ["update", SELF], ["update", "npm:pi-session-name"], ["update", "git:github.com/example/third-party"],
  ]);
});
console.log("PASS normal install switches back to remote, repeats, and preserves third-party/prune order");

for (const dev of [true, false]) {
  withCheckout(({ root, execute, seed }) => {
    seed([root, ...REMOTE_VARIANTS]);
    const result = execute([...(dev ? ["--dev"] : []), "--sync", "packages"]);
    assert.equal(result.status, 0, result.stderr);
    const removals = result.actions.filter(([action]) => action === "remove");
    assert.deepEqual(removals, (dev ? REMOTE_VARIANTS : [root]).map(source => ["remove", source]));
    assert.equal(result.actions.some(([action, source]) => action === "install" && source === root), false);
    assert.equal(result.actions.some(([action, source]) => action === "update" && source === root), false);
  });
}
console.log("PASS both sources installed removes only the opposite source without updating local code");

for (const dev of [true, false]) {
  withCheckout(({ root, execute, seed, settingsFile, agentDir }) => {
    const opposite = dev ? SELF : root;
    seed([opposite]);
    const before = readFileSync(settingsFile, "utf8");
    const result = execute(dev ? ["--dev"] : [], { extraEnv: { PI_FAIL_REMOVE: opposite } });
    assert.equal(result.status, 1);
    assert.deepEqual(result.actions, [["remove", opposite]]);
    assert.match(result.stderr, /source switch aborted/);
    assert.equal(readFileSync(settingsFile, "utf8"), before);
    assert.deepEqual(readdirSync(agentDir), ["settings.json"]);
  });
}
console.log("PASS failed source removal aborts before installing packages or writing configs");

for (const dev of [true, false]) {
  withCheckout(({ root, execute, seed, settingsFile, agentDir, manifestPath, manifestText }) => {
    seed([dev ? SELF : root]);
    const before = readFileSync(settingsFile, "utf8");
    const result = execute([...(dev ? ["--dev"] : []), "--dry-run"], { installer: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.actions, []);
    assert.equal(readFileSync(settingsFile, "utf8"), before);
    assert.deepEqual(readdirSync(agentDir), ["settings.json"]);
    assert.equal(readFileSync(manifestPath, "utf8"), manifestText);
    assert.match(result.stderr, /switch this repo between remote and dev sources/);
  });
}
console.log("PASS source switching dry-run performs no package actions or writes");

for (const dev of [true, false]) {
  for (const domain of ["settings", "keybindings", "files", "none"]) {
    withCheckout(({ root, execute, seed, settingsFile }) => {
      seed([root, SELF]);
      const result = execute([...(dev ? ["--dev"] : []), "--sync", domain]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.calls, []);
      assert.deepEqual(JSON.parse(readFileSync(settingsFile, "utf8")).packages, [root, SELF]);
    });
  }
}
console.log("PASS unselected package domain never lists, installs, removes or switches sources");

// A different local checkout must stay untouched: local and git identities
// must not become global aliases merely because --dev knows this repository.
withCheckout(({ root, execute, seed }) => {
  const otherCheckout = `${root}-other`;
  seed([SELF, otherCheckout]);
  const result = execute(["--dev", "--sync", "packages"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.actions, [
    ["remove", SELF], ["install", root], ["install", "npm:pi-session-name"], ["install", "git:github.com/example/third-party"],
  ]);
  assert.match(result.stderr, /other.*merge mode/);
});
console.log("PASS dev override does not alias unrelated local checkouts");

withCheckout(({ root, execute, seed }) => {
  seed([SELF]);
  const result = execute(["--dev", "--sync", "packages"], { extraEnv: { PI_REMOTE_PATH: root } });
  assert.equal(result.status, 1);
  assert.deepEqual(result.actions, []);
  assert.match(result.stderr, /cannot use pi's managed git checkout/);
});
console.log("PASS --dev refuses to remove the checkout it would load as a local package");

for (const options of [
  { downloaded: true },
  { git: false },
  { pkg: { name: "other-package", pi: { extensions: ["extensions/*.ts"] } } },
  { pkg: { name: "my-pi-preset" } },
  { pkg: { name: "my-pi-preset", pi: { extensions: ["extensions"] } } },
  { manifest: { packages: ONE } },
  { manifest: { packages: { [SELF]: "latest", [`${SELF}.git`]: "main" } } },
  { manifest: { packages: { [SELF]: "latest", "./local-thing": "latest" } } },
]) {
  withCheckout(({ execute }) => {
    const result = execute(["--dev"]);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(result.calls, []);
    assert.match(result.stderr, /requires|unsupported source/);
  }, options);
}
console.log("PASS --dev rejects downloaded scripts, invalid checkouts/manifests and manifest local sources");

// stdin has no installer path even if the shell happens to start inside the
// checkout. Do not mistake dirname("sh") or dirname("-s") for a local script.
withCheckout(({ root, execute }) => {
  for (const cwd of [undefined, root]) {
    const result = execute(["--dev"], { installer: true, stdin: true, ...(cwd ? { cwd } : {}) });
    assert.equal(result.status, 1);
    assert.deepEqual(result.calls, []);
    assert.match(result.stderr, /--dev requires a local/);
    assert.doesNotMatch(result.stdout, /downloading/);
  }
});
console.log("PASS piped installer rejects --dev before downloading or running pi");

console.log("\nAll sync checks passed.");
