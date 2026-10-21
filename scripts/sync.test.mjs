import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildConfigPlan, buildPackagePlan, leafEntries, normalizeKeybinding } from "./sync.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/sync.mjs");
const SELF = "git:github.com/akichase/my-pi-preset";
const FAKE_PI = `#!/bin/sh
printf '%s\\n' "$*" >> "$PI_CALLS_FILE"
[ "$1" = list ] && printf '%s\\n' "$PI_LIST_OUTPUT"
exit 0
`;

function cli(t, { manifest = { packages: {} }, args = [], list = "User packages:", files = {} } = {}) {
 const box = mkdtempSync(join(tmpdir(), "sync-smoke-")); t.after(() => rmSync(box, { recursive: true, force: true }));
 const bin = join(box, "bin"), agent = join(box, "agent"), manifestPath = join(box, "preset.json"), calls = join(box, "calls");
 mkdirSync(bin); mkdirSync(agent); writeFileSync(join(bin, "pi"), FAKE_PI, { mode: 0o755 }); chmodSync(join(bin, "pi"), 0o755);
 writeFileSync(manifestPath, JSON.stringify(manifest)); writeFileSync(calls, "");
 for (const [name, value] of Object.entries(files)) writeFileSync(join(agent, name), value);
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

test("CLI smoke applies package/config plan through the configured pi binary", t => {
 const result = cli(t, { manifest: { packages: { "npm:one": "latest" }, settings: { retry: { maxRetries: 5 } } }, list: "User packages:\n  npm:one\n    /installed", files: { "settings.json": JSON.stringify({ retry: { maxRetries: 1 }, theme: "dark" }) } });
 assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.calls, ["list", "update npm:one"]);
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
