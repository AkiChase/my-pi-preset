import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, realpathSync, mkdirSync, renameSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { hasStartup, startupDetails } from "../startup.ts";

it("installed persistent SessionManager recognizes branch startup across open, fork and compaction, not abandoned paths", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "startup-sdk-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const customType = "fixture-startup", owner = "fixture", origin = "stable-source";
  const has = (sm: SessionManager) => hasStartup(sm.getBranch(), customType, owner, origin, "overview");
  const before = manager.appendMessage({ role: "user", content: "before startup", timestamp: Date.now() });
  const draft = startupDetails(owner, origin, ["overview", "workflow"]);
  assert.equal(has(manager), false);
  const startup = manager.appendCustomMessageEntry(customType, "Full startup snapshot", false, { ...draft, state: "initial" });
  const assistant = manager.appendMessage({ role: "user", content: "after startup", timestamp: Date.now() });
  assert.equal(has(manager), true);
  manager.appendCompaction("summary", assistant, 1);
  assert.equal(manager.buildContextEntries().some(entry => entry.id === startup), false);
  assert.equal(has(manager), true, "full getBranch retains record outside model window");
  const file = manager.getSessionFile()!;
  const resumed = SessionManager.open(file, join(root, "sessions")); assert.equal(has(resumed), true);
  const forkFile = resumed.createBranchedSession(resumed.getLeafId()!)!;
  const fork = SessionManager.open(forkFile, join(root, "sessions"));
  assert.notEqual(fork.getSessionId(), manager.getSessionId()); assert.equal(has(fork), true);
  fork.branch(before); assert.equal(has(fork), false);
  fork.appendCustomEntry(customType, startupDetails(owner, origin, ["overview"], "skipped")); assert.equal(has(fork), true);
  fork.resetLeaf(); assert.equal(has(fork), false);
});

it("installed SDK atomic EISDIR append rollback never confirms startup, and later persistence succeeds", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "startup-failure-sdk-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "seed", timestamp: Date.now() });
  // SessionManager waits for an assistant before flushing its initial file.
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "seed reply" }], api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const file = manager.getSessionFile()!, preserved = `${file}.preserved`;
  const bytes = readFileSync(file), entries = manager.getEntries(), leaf = manager.getLeafId();
  renameSync(file, preserved); mkdirSync(file);
  const details = startupDetails("fixture", "stable-source", ["index"]);
  for (const append of [() => manager.appendCustomMessageEntry("startup", "snapshot", false, details), () => manager.appendCustomEntry("startup", { ...startupDetails("fixture", "stable-source", ["index"], "skipped") })]) {
    assert.throws(append, /EISDIR/);
    assert.deepEqual(manager.getEntries(), entries); assert.equal(manager.getLeafId(), leaf);
    assert.equal(hasStartup(manager.getBranch(), "startup", "fixture", "stable-source", "index"), false);
  }
  rmSync(file, { recursive: true }); renameSync(preserved, file);
  assert.deepEqual(readFileSync(file), bytes);
  manager.appendCustomMessageEntry("startup", "snapshot", false, details);
  assert.equal(hasStartup(SessionManager.open(file).getBranch(), "startup", "fixture", "stable-source", "index"), true);
});
