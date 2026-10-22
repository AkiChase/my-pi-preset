import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createState, handleKey, syncArgs, renderFrame, runSync, cleanText, runInstaller, localCheckout } from "./install.mjs";

const key = (state, name, text = "") => handleKey(state, text, { name });

test("default selections, keyboard toggles and cleanup intersection", () => {
  const state = createState();
  assert.equal(state.selected.size, 5); assert.equal(state.cleanup.size, 0);
  key(state, "return"); assert.equal(state.page, "sync");
  key(state, "space"); assert.equal(state.selected.has("packages"), false);
  key(state, "return"); assert.equal(state.page, "cleanup");
  key(state, "space"); assert.ok(state.cleanup.has("settings"));
  assert.deepEqual(syncArgs(state, "/preset.json"), ["--manifest", "/preset.json", "--sync", "settings,keybindings,files,extensions", "--prune", "settings"]);
  key(state, "escape"); key(state, "down"); key(state, "space");
  assert.equal(state.cleanup.has("settings"), false);
  key(state, "a"); key(state, "a");
  assert.equal(state.selected.size, 0);
  key(state, "return"); assert.equal(state.page, "sync"); assert.match(state.notice, /at least one/);
});

test("source and review execution gates; failure cannot apply", () => {
  const state = createState();
  key(state, "down"); key(state, "return"); assert.equal(state.page, "source"); assert.equal(state.dev, false);
  state.page = "error"; assert.equal(key(state, "return"), undefined); assert.equal(state.page, "error");
  state.page = "loading"; assert.equal(key(state, "return"), undefined);
  state.page = "review"; assert.equal(key(state, "return"), "apply");
  assert.equal(handleKey(state, "", { ctrl: true, name: "c" }), "quit");
  const local = createState("/checkout"); key(local, "down"); key(local, "return");
  assert.ok(syncArgs(local, "/preset").includes("--dev"));
});

test("pointer column, no borders, sanitized output and narrow layouts", () => {
  const state = createState(); state.page = "sync";
  const text = renderFrame(state, { columns: 80, rows: 30 });
  const lines = text.split("\n").filter(line => /Packages|Settings/.test(line));
  assert.equal(lines[0].indexOf("Packages"), lines[1].indexOf("Settings"));
  assert.doesNotMatch(text, /[│╭╮╯╰]/);
  assert.equal(cleanText("\x1b[31mred\x1b[0m\x07"), "red");
  state.page = "review";
  assert.match(renderFrame(state, { columns: 35, rows: 20 }), /Enter Apply/);
  assert.match(renderFrame(state, { columns: 20, rows: 10 }), /Terminal too small/);
  for (const page of ["source", "sync", "cleanup", "loading", "review", "error"]) {
    state.page = page; state.plan = ["x".repeat(1000)];
    const narrow = renderFrame(state, { columns: 35, rows: 20, unicode: false });
    assert.ok(narrow.split("\n").every(line => line.length <= 35));
    assert.ok(narrow.split("\n").length <= 19);
  }
});

test("no TTY is refused before children are started", async () => {
  await assert.rejects(runInstaller({ input: { isTTY: false }, output: { isTTY: false } }), /needs a terminal/);
  assert.equal(localCheckout("/nonexistent/install.mjs"), undefined);
});

test("shell rejects arguments and a missing controlling terminal before bootstrap", () => {
  const shell = new URL("../install.sh", import.meta.url);
  const oldArgs = spawnSync("sh", [shell.pathname, "--prune"], { encoding: "utf8" });
  assert.equal(oldArgs.status, 1); assert.match(oldArgs.stderr, /takes no arguments/);
  const noTty = spawnSync("sh", [shell.pathname], { encoding: "utf8", detached: true });
  assert.equal(noTty.status, 1); assert.match(noTty.stderr, /needs a terminal/);
});

test("offline PTY drives the real installer and piped shell", { skip: process.platform === "win32", timeout: 60000 }, () => {
  const fixture = new URL("./install-pty.py", import.meta.url);
  const result = spawnSync("python3", [fixture.pathname], { encoding: "utf8", timeout: 55000 });
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS:/);
});

test("real child argv, preview failure, cancellation, limits and natural exit", async t => {
  const dir = mkdtempSync(join(tmpdir(), "install-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "fake.mjs");
  writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = process.argv.includes("fail") ? 2 : 0;');
  const result = await runSync(script, ["--sync", "settings"], { preview: true });
  assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.output), ["--sync", "settings", "--dry-run"]);
  assert.equal((await runSync(script, ["fail"], { preview: true })).code, 2);
  writeFileSync(script, 'process.stdout.write("x".repeat(10000)); setInterval(() => {}, 1000);');
  const limited = await runSync(script, [], { preview: true, maxBytes: 100 });
  assert.match(limited.error, /display limit/);
  writeFileSync(script, 'setInterval(() => {}, 1000);');
  const cancelled = await runSync(script, [], { preview: true, onStart: job => job.cancel() });
  assert.equal(cancelled.error, "Cancelled");
  const timeout = await runSync(script, [], { preview: true, timeoutMs: 50 });
  assert.match(timeout.error, /timed out/);
});
