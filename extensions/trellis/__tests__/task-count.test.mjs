import "./host-env.mjs";
// Logic-only port of the unfinished-task count rules (display rendering is intentionally not tested).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { __internals as ui } from "../index.ts";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "trellis-count-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), value); };
  const record = (name, value = { status: "planning" }) => put(`.trellis/tasks/${name}/task.json`, JSON.stringify(value));
  mkdirSync(join(root, ".trellis/tasks"), { recursive: true });
  return { root, put, record };
}

test("count enumerates valid immediate records independent of children, pointers and assignees", t => {
  const f = setup(t);
  f.record("parent", { status: "planning", children: ["child", "child"], assignee: "someone" });
  f.record("child", { status: "in_progress", parent: "parent" });
  f.record("other-session", { status: "review", assignee: "another" });
  f.record("completed", { status: "completed" });
  f.record("archive/2026-10/old", { status: "in_progress" });
  f.put(".trellis/tasks/nested/group/task.json", JSON.stringify({ status: "planning" }));
  f.put(".trellis/tasks/readme.md", "not a task");
  f.put(".trellis/.runtime/sessions/foreign.json", JSON.stringify({ current_task: ".trellis/tasks/other-session" }));
  const before = readFileSync(join(f.root, ".trellis/tasks/parent/task.json"), "utf8");
  assert.equal(ui.readUnfinishedTaskCount(f.root), 3);
  assert.equal(readFileSync(join(f.root, ".trellis/tasks/parent/task.json"), "utf8"), before);
  f.record("other-session", { status: "completed" });
  assert.equal(ui.readUnfinishedTaskCount(f.root), 2);
  f.record("parent", { status: "completed" });
  f.record("child", { status: "completed" });
  assert.equal(ui.readUnfinishedTaskCount(f.root), 0);
});

test("count supports top-level external task store and counts internal directory aliases once, not archives", t => {
  const f = setup(t);
  const external = mkdtempSync(join(tmpdir(), "trellis-count-store-"));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  rmSync(join(f.root, ".trellis/tasks"), { recursive: true });
  symlinkSync(external, join(f.root, ".trellis/tasks"));
  f.record("a");
  f.record("b");
  f.record("archive/old", { status: "planning" });
  symlinkSync("a", join(external, "alias"));
  symlinkSync("archive/old", join(external, "old-alias"));
  assert.equal(ui.readUnfinishedTaskCount(f.root), 2);
  mkdirSync(join(f.root, "foreign"));
  symlinkSync(join(f.root, "foreign"), join(external, "escape"));
  assert.equal(ui.readUnfinishedTaskCount(f.root), undefined);
});

test("count excludes aliases into a symlinked archive; dangling archive is unknown", t => {
  const f = setup(t);
  f.record("active");
  f.record("retired/old", { status: "in_progress" });
  symlinkSync("retired", join(f.root, ".trellis/tasks/archive"));
  symlinkSync("archive/old", join(f.root, ".trellis/tasks/old-alias"));
  assert.equal(ui.readUnfinishedTaskCount(f.root), 1);
  rmSync(join(f.root, ".trellis/tasks/retired"), { recursive: true });
  assert.equal(ui.readUnfinishedTaskCount(f.root), undefined);
});

for (const bad of ["{broken", "null", "[]", JSON.stringify({ status: 42 }), JSON.stringify({ status: "" })]) {
  test(`invalid count record degrades to unknown, not a verified partial count (${bad})`, t => {
    const f = setup(t);
    f.record("good");
    f.put(".trellis/tasks/bad/task.json", bad);
    assert.equal(ui.readUnfinishedTaskCount(f.root), undefined);
  });
}

test("empty store is zero; missing, non-directory, oversized and dangling record/store are unknown", t => {
  const f = setup(t);
  assert.equal(ui.readUnfinishedTaskCount(f.root), 0);
  rmSync(join(f.root, ".trellis/tasks"), { recursive: true });
  assert.equal(ui.readUnfinishedTaskCount(f.root), undefined);
  f.put(".trellis/tasks", "not a directory");
  assert.equal(ui.readUnfinishedTaskCount(f.root), undefined);
  rmSync(join(f.root, ".trellis/tasks"));
  f.put(".trellis/tasks/huge/task.json", " ".repeat(1024 * 1024 + 1));
  assert.equal(ui.readUnfinishedTaskCount(f.root), undefined);
  rmSync(join(f.root, ".trellis/tasks/huge"), { recursive: true });
  mkdirSync(join(f.root, ".trellis/tasks/dangling"));
  symlinkSync("missing.json", join(f.root, ".trellis/tasks/dangling/task.json"));
  assert.equal(ui.readUnfinishedTaskCount(f.root), undefined);
});

test("unreadable task record is unknown", t => {
  if (process.getuid?.() === 0) { t.skip("root can read chmod-000 fixtures"); return; }
  const f = setup(t);
  f.record("locked");
  const file = join(f.root, ".trellis/tasks/locked/task.json");
  chmodSync(file, 0);
  t.after(() => { try { chmodSync(file, 0o600); } catch {} });
  assert.equal(ui.readUnfinishedTaskCount(f.root), undefined);
});
