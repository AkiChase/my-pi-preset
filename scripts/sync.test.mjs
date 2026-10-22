import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildConfigPlan, buildExtensionPlan, buildPackagePlan, leafEntries, normalizeKeybinding } from "./sync.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/sync.mjs");
const SELF = "git:github.com/akichase/my-pi-preset";
const FAKE_PI = `#!/bin/sh
printf '%s\\n' "$*" >> "$PI_CALLS_FILE"
[ "$1" = list ] && printf '%s\\n' "$PI_LIST_OUTPUT"
exit 0
`;

function cli(t, { manifest = { packages: {} }, args = [], list = "User packages:", files = {}, prepareAgent } = {}) {
 const box = mkdtempSync(join(tmpdir(), "sync-smoke-")); t.after(() => rmSync(box, { recursive: true, force: true }));
 const bin = join(box, "bin"), agent = join(box, "agent"), manifestPath = join(box, "preset.json"), calls = join(box, "calls");
 mkdirSync(bin); mkdirSync(agent); writeFileSync(join(bin, "pi"), FAKE_PI, { mode: 0o755 }); chmodSync(join(bin, "pi"), 0o755);
 writeFileSync(manifestPath, JSON.stringify(manifest)); writeFileSync(calls, "");
 for (const [name, value] of Object.entries(files)) {
  const target = join(agent, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value);
 }
 prepareAgent?.(agent);
 const result = spawnSync(process.execPath, [script, "--manifest", manifestPath, ...args], { encoding: "utf8", env: { ...process.env, PI_BIN: join(bin, "pi"), PI_CODING_AGENT_DIR: agent, PI_CALLS_FILE: calls, PI_LIST_OUTPUT: list } });
 return { ...result, calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean), agent };
}

test("package planning covers merge, prune, conflicts, pinned versions and local source switching", () => {
 const installed = [
  { source: "npm:one", installedPath: "/one" }, { source: "npm:old", installedPath: "/old" },
  { source: "npm:bundled", installedPath: "/bundled" }, { source: SELF, installedPath: "/remote" },
 ];
 const normal = buildPackagePlan(["npm:one", "npm:two@1.2.3"], installed, true, ["npm:bundled"], undefined);
 assert.deepEqual(normal.map(step => [step.action, step.target]), [["remove", "npm:bundled"], ["update", "npm:one"], ["install", "npm:two@1.2.3"], ["remove", "npm:old"], ["remove", SELF]]);
 const local = buildPackagePlan(["/checkout"], installed, false, [], { root: "/checkout", dev: true });
 assert.deepEqual(local[0], { domain: "packages", action: "remove", target: SELF, beforeInstall: true, reason: "switch this repo between remote and dev sources" });
 assert.ok(local.some(step => step.action === "install" && step.target === "/checkout"));
});

test("configuration planning covers nested merge, null, prune, preserve and flat bindings", () => {
 const declared = leafEntries({ retry: { maxRetries: 5 }, markdown: { mermaid: null } }, { emptyObjectsAreLeaves: false });
 const steps = buildConfigPlan({ domain: "settings", declared, current: { retry: { maxRetries: 3, delay: 1 }, markdown: { mermaid: "on" }, theme: "dark" }, preserve: [["theme"]], prune: true });
 assert.deepEqual(steps.filter(step => step.action !== "keep").map(step => [step.action, step.target]), [["set", "retry.maxRetries"], ["unset", "markdown.mermaid"], ["unset", "retry.delay"], ["preserve", "theme"]]);
 const bindings = buildConfigPlan({ domain: "keybindings", declared: [{ path: ["app.rename"], value: [] }], current: { "app.rename": "ctrl+r", old: "x" }, preserve: [["old"]], prune: true, flat: true, equals: (a, b) => JSON.stringify(normalizeKeybinding(a)) === JSON.stringify(normalizeKeybinding(b)) });
 assert.deepEqual(bindings.map(step => [step.action, step.target]), [["set", "app.rename"], ["preserve", "old"]]);
});

test("direct extension planning preserves explicit roots and prunes the rest", () => {
 const entries = [
  { path: "/agent/extensions/one.ts", target: "one.ts", directory: false, root: false },
  { path: "/agent/extensions/two", target: "two", directory: true, root: false },
 ];
 const plan = buildExtensionPlan(entries, ["two"], true);
 assert.deepEqual(plan.map(step => [step.action, step.target]), [["remove", "one.ts"], ["preserve", "two"]]);
 assert.deepEqual(buildExtensionPlan(entries, [], false).map(step => step.action), ["keep", "keep"]);
});

test("CLI extension sync keeps merge entries and prunes only direct Pi roots", t => {
 const manifest = { packages: {}, preserve: { extensions: ["saved.ts"] } };
 const files = {
  "extensions/remove.ts": "export default () => {}\n",
  "extensions/remove.ts.metadata": "keep",
  "extensions/saved.ts": "export default () => {}\n",
  "extensions/config.json": "{\"keep\":true}",
  "extensions/.hidden.ts": "export default () => {}\n",
  "extensions/directory/index.ts": "export default () => {}\n",
  "extensions/manifest/package.json": JSON.stringify({ pi: { extensions: ["src/entry.ts"] } }),
  "extensions/manifest/src/entry.ts": "export default () => {}\n",
  "extensions/support/nested.ts": "export default () => {}\n",
 };
 const merged = cli(t, { manifest, args: ["--sync", "extensions"], files });
 assert.equal(merged.status, 0, merged.stderr); assert.deepEqual(merged.calls, []);
 assert.ok(existsSync(join(merged.agent, "extensions/remove.ts")));
 assert.match(merged.stderr, /keep\s+extensions\s+remove\.ts/);

 const pruned = cli(t, { manifest, args: ["--sync", "extensions", "--prune", "extensions"], files });
 assert.equal(pruned.status, 0, pruned.stderr); assert.deepEqual(pruned.calls, []);
 assert.equal(existsSync(join(pruned.agent, "extensions/remove.ts")), false);
 assert.ok(existsSync(join(pruned.agent, "extensions/.hidden.ts")));
 assert.ok(existsSync(join(pruned.agent, "extensions/remove.ts.metadata")));
 assert.ok(existsSync(join(pruned.agent, "extensions/saved.ts")));
 assert.equal(existsSync(join(pruned.agent, "extensions/directory")), false);
 assert.equal(existsSync(join(pruned.agent, "extensions/manifest")), false);
 assert.ok(existsSync(join(pruned.agent, "extensions/config.json")));
 assert.ok(existsSync(join(pruned.agent, "extensions/support/nested.ts")));
});

test("extension dry-run is non-mutating and bare prune includes the extensions domain", t => {
 const files = { "extensions/remove.js": "export default () => {}\n" };
 const scoped = cli(t, { manifest: { packages: {} }, args: ["--sync", "extensions", "--prune", "extensions", "--dry-run"], files });
 assert.equal(scoped.status, 0, scoped.stderr); assert.deepEqual(scoped.calls, []);
 assert.ok(existsSync(join(scoped.agent, "extensions/remove.js")));
 assert.match(scoped.stderr, /remove\s+extensions\s+remove\.js/);

 const bare = cli(t, { manifest: { packages: {} }, args: ["--prune", "--dry-run"], files });
 assert.equal(bare.status, 0, bare.stderr); assert.deepEqual(bare.calls, ["list"]);
 assert.match(bare.stderr, /extensions prune/);
 assert.ok(existsSync(join(bare.agent, "extensions/remove.js")));
});

test("extension prune removes directory symlinks without following their targets", t => {
 const box = mkdtempSync(join(tmpdir(), "sync-extension-link-"));
 t.after(() => rmSync(box, { recursive: true, force: true }));
 const agent = join(box, "agent"), extensions = join(agent, "extensions"), bin = join(box, "bin");
 const outside = join(box, "outside"), manifestPath = join(box, "preset.json"), calls = join(box, "calls");
 mkdirSync(extensions, { recursive: true }); mkdirSync(bin); mkdirSync(outside);
 writeFileSync(join(bin, "pi"), FAKE_PI, { mode: 0o755 }); chmodSync(join(bin, "pi"), 0o755);
 writeFileSync(join(outside, "index.ts"), "export default () => {}\n");
 symlinkSync(outside, join(extensions, "linked"));
 writeFileSync(manifestPath, JSON.stringify({ packages: {} })); writeFileSync(calls, "");
 const result = spawnSync(process.execPath, [script, "--manifest", manifestPath, "--sync", "extensions", "--prune", "extensions"], {
  encoding: "utf8", env: { ...process.env, PI_BIN: join(bin, "pi"), PI_CODING_AGENT_DIR: agent, PI_CALLS_FILE: calls, PI_LIST_OUTPUT: "User packages:" },
 });
 assert.equal(result.status, 0, result.stderr);
 assert.equal(existsSync(join(extensions, "linked")), false);
 assert.ok(existsSync(join(outside, "index.ts")));
});

test("extension prune refuses a package at the shared extensions root", t => {
 const result = cli(t, {
  manifest: { packages: {} },
  args: ["--sync", "extensions", "--prune", "extensions"],
  files: {
   "extensions/package.json": JSON.stringify({ pi: { extensions: ["root.ts"] } }),
   "extensions/root.ts": "export default () => {}\n",
  },
 });
 assert.equal(result.status, 1); assert.deepEqual(result.calls, []);
 assert.ok(existsSync(join(result.agent, "extensions/package.json")));
 assert.match(result.stderr, /cannot prune extensions/);
});

test("extension manifest validation rejects path-like preserved roots", t => {
 const result = cli(t, { manifest: { packages: {}, preserve: { extensions: ["../outside.ts"] } }, args: ["--sync", "extensions"] });
 assert.equal(result.status, 1); assert.deepEqual(result.calls, []);
 assert.match(result.stderr, /preserve\.extensions\[0\]/);
});

test("an unreadable extensions root is ignored", t => {
 const result = cli(t, {
  manifest: { packages: {} }, args: ["--sync", "extensions"],
  prepareAgent: (agent) => {
   const extensions = join(agent, "extensions"); mkdirSync(extensions);
   chmodSync(extensions, 0o000);
  },
 });
 chmodSync(join(result.agent, "extensions"), 0o755);
 assert.equal(result.status, 0, result.stderr);
 assert.deepEqual(result.calls, []);
});

test("unselected extensions do not inspect an extension package at the shared root", t => {
 const result = cli(t, {
  manifest: { packages: {} },
  args: ["--sync", "settings"],
  files: {
   "extensions/package.json": JSON.stringify({ pi: { extensions: ["root.ts"] } }),
   "extensions/root.ts": "export default () => {}\n",
  },
 });
 assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.calls, []);
 assert.ok(existsSync(join(result.agent, "extensions/root.ts")));
});

test("CLI smoke applies package/config plan through the configured pi binary", t => {
 const result = cli(t, { manifest: { packages: { "npm:one": "latest" }, settings: { retry: { maxRetries: 5 } } }, list: "User packages:\n  npm:one\n    /installed", files: { "settings.json": JSON.stringify({ retry: { maxRetries: 1 }, theme: "dark" }) } });
 assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.calls, ["list", "update npm:one"]);
 assert.match(result.stderr, /reading Pi packages and configuration/);
 assert.deepEqual(JSON.parse(readFileSync(join(result.agent, "settings.json"), "utf8")), { retry: { maxRetries: 5 }, theme: "dark" });
});

test("preset pi-btw declaration is installed by a future package sync", t => {
 const manifest = JSON.parse(readFileSync(join(root, "pi-preset.json"), "utf8"));
 const result = cli(t, { manifest, args: ["--sync", "packages"], list: "User packages:" });
 assert.equal(result.status, 0, result.stderr);
 assert.ok(result.calls.includes("install npm:@narumitw/pi-btw"));
});

test("CLI dry-run plans without package calls or writes", t => {
 const result = cli(t, { manifest: { packages: { "npm:one": "latest" }, settings: { retry: { maxRetries: 5 } } }, args: ["--dry-run"], list: "User packages:", files: { "settings.json": '{"theme":"dark"}' } });
 assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.calls, ["list"]); assert.equal(readFileSync(join(result.agent, "settings.json"), "utf8"), '{"theme":"dark"}');
});

test("CLI rejects malformed manifest before invoking pi or writing configuration", t => {
 const result = cli(t, { manifest: { packages: { "./local": "latest" } }, files: { "settings.json": '{"safe":true}' } });
 assert.equal(result.status, 1); assert.deepEqual(result.calls, []); assert.equal(readFileSync(join(result.agent, "settings.json"), "utf8"), '{"safe":true}');
});

test("CLI dev source switch remains observable", t => {
 const switched = cli(t, { manifest: { packages: { [SELF]: "latest" } }, args: ["--dev", "--sync", "packages"], list: `User packages:\n  ${SELF}\n    /remote` });
 assert.equal(switched.status, 0, switched.stderr); assert.ok(switched.calls.includes(`remove ${SELF}`));
});
