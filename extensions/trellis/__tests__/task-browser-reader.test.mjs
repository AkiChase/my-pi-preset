import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readTasks, readDocument, readCurrentTaskIdentity, safeText, taskLabel } from "../lib/task-browser/reader.ts";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-trellis-browser-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  const record = (name, value = { title: name, status: "planning" }) => put(`.trellis/tasks/${name}/task.json`, JSON.stringify(value));
  mkdirSync(join(root, ".trellis/tasks"), { recursive: true });
  return { root, put, record, read: () => readTasks(root) };
}

test("reader lists all non-archived statuses, original titles and immediate directories only", t => {
  const f = fixture(t);
  f.record("z", { title: "中文任务", status: "completed", parent: "a" });
  f.record("a", { title: "Parent", status: "in_progress", children: ["z"] });
  f.record("archive/2026-10/old");
  f.put(".trellis/tasks/readme.md", "not a directory");
  const value = f.read();
  assert.equal(value.complete, true);
  assert.deepEqual(value.rows.map(row => [row.task.title, row.prefix]), [["Parent", ""], ["中文任务", "└─ "]]);
  assert.equal(value.tasks.find(task => task.title === "中文任务").status, "completed");
});

test("archived children and parents are recognized but never enter the visible tree", t => {
  const f = fixture(t);
  f.record("parent", { status: "in_progress", children: ["old-child", ".trellis/tasks/old-child", ".trellis/tasks/archive/2026-10/old-child", "old-alias"] });
  f.record("child", { status: "planning", parent: "old-parent" });
  f.record("archive/2026-10/old-child", { status: "completed", parent: "parent" });
  f.record("archive/2026-10/old-parent", { status: "completed", children: ["child"] });
  symlinkSync("archive/2026-10/old-child", join(f.root, ".trellis/tasks/old-alias"));
  const paths = ["parent", "child", "archive/2026-10/old-child", "archive/2026-10/old-parent"];
  const before = paths.map(path => readFileSync(join(f.root, ".trellis/tasks", path, "task.json")));
  const value = f.read();
  assert.equal(value.complete, true, value.diagnostics.join("\n"));
  assert.deepEqual(value.rows.map(row => [row.task.dir.split("/").at(-1), row.prefix]), [["parent", ""], ["child", ""]]);
  assert.deepEqual(paths.map(path => readFileSync(join(f.root, ".trellis/tasks", path, "task.json"))), before);
});

test("archive lookup is lazy, visible links take precedence, and canonical duplicates are not ambiguous", t => {
  const f = fixture(t);
  f.record("parent", { status: "planning", children: ["child", "old"] });
  f.record("child");
  f.record("archive/2026-10/child");
  f.record("archive/2026-09/child");
  f.record("archive/2026-10/old");
  f.put(".trellis/tasks/archive/2026-10/unrelated/task.json", "null");
  mkdirSync(join(f.root, ".trellis/tasks/archive/2026-09"), { recursive: true });
  symlinkSync("../2026-10/old", join(f.root, ".trellis/tasks/archive/2026-09/old"));
  const value = f.read();
  assert.equal(value.complete, true, value.diagnostics.join("\n"));
  assert.deepEqual(value.rows.map(row => row.prefix), ["", "└─ "]);
});

test("archived links honor an external task store and canonical symlinked archive", t => {
  const f = fixture(t), store = mkdtempSync(join(tmpdir(), "pi-browser-archive-store-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  rmSync(join(f.root, ".trellis/tasks"), { recursive: true });
  symlinkSync(store, join(f.root, ".trellis/tasks"));
  f.record("retired/2026-10/old");
  symlinkSync("retired", join(store, "archive"));
  symlinkSync("archive/2026-10/old", join(store, "old-alias"));
  f.record("parent", { status: "planning", children: ["old", "old-alias", ".trellis/tasks/archive/2026-10/old"] });
  // The archive's canonical root is also an immediate directory: exclude it too.
  const value = f.read();
  assert.equal(value.complete, true, value.diagnostics.join("\n"));
  assert.equal(value.rows.length, 1);
});

test("different archived identities with the same name remain ambiguous, exact archive paths do not", t => {
  const f = fixture(t);
  f.record("parent", { status: "planning", children: ["old"] });
  f.record("archive/2026-09/old"); f.record("archive/2026-10/old");
  assert.match(f.read().diagnostics.join("\n"), /Ambiguous archived hierarchy link/);
  f.record("parent", { status: "planning", children: [".trellis/tasks/archive/2026-10/old"] });
  assert.equal(f.read().complete, true);
});

for (const kind of ["missing", "invalid", "fifo", "record-escape", "task-escape", "month-escape", "invalid-path"]) {
  test(`archived hierarchy lookup retains diagnostics for ${kind}`, t => {
    const f = fixture(t);
    const ref = kind === "invalid-path" ? "../old" : "old";
    f.record("parent", { status: "planning", children: [ref] });
    const dir = ".trellis/tasks/archive/2026-10/old";
    if (kind === "invalid") f.put(`${dir}/task.json`, "null");
    if (kind === "fifo") { mkdirSync(join(f.root, dir), { recursive: true }); execFileSync("mkfifo", [join(f.root, dir, "task.json")]); }
    if (kind === "record-escape") {
      f.record("archive/2026-10/other"); mkdirSync(join(f.root, dir));
      symlinkSync("../other/task.json", join(f.root, dir, "task.json"));
    }
    if (kind === "task-escape" || kind === "month-escape") {
      f.put("secret/old/task.json", '{"status":"completed"}');
      mkdirSync(join(f.root, ".trellis/tasks/archive/2026-10"), { recursive: true });
      if (kind === "task-escape") symlinkSync(join(f.root, "secret/old"), join(f.root, dir));
      else {
        rmSync(join(f.root, ".trellis/tasks/archive/2026-10"), { recursive: true });
        symlinkSync(join(f.root, "secret"), join(f.root, ".trellis/tasks/archive/2026-10"));
      }
    }
    const value = f.read();
    assert.equal(value.complete, false);
    assert.equal(value.rows.length, 1);
    assert.ok(value.diagnostics.length > 0);
    if (!["missing", "invalid-path"].includes(kind)) assert.match(value.diagnostics.join("\n"), /Invalid archived hierarchy link/);
    if (kind.endsWith("escape")) assert.match(value.diagnostics.join("\n"), /escapes/);
  });
}

test("external top-level task store, canonical aliases and symlinked archive are supported", t => {
  const f = fixture(t), store = mkdtempSync(join(tmpdir(), "pi-browser-store-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  rmSync(join(f.root, ".trellis/tasks"), { recursive: true });
  symlinkSync(store, join(f.root, ".trellis/tasks"));
  f.record("a", { status: "planning", children: ["child-alias"] }); f.record("b", { status: "review" });
  f.record("retired/old");
  symlinkSync("a", join(store, "alias"));
  symlinkSync("b", join(store, "child-alias"));
  symlinkSync("retired", join(store, "archive"));
  symlinkSync("archive/old", join(store, "old-alias"));
  const value = f.read();
  assert.equal(value.complete, true);
  assert.equal(value.tasks.length, 2);
  assert.equal(value.rows[1].prefix, "└─ ");
});

test("escaping task/record symlinks are rejected even inside the project or another task", t => {
  const f = fixture(t);
  f.record("safe"); f.record("foreign");
  f.put("secret/task.json", '{"status":"planning"}');
  symlinkSync(join(f.root, "secret"), join(f.root, ".trellis/tasks/escape"));
  mkdirSync(join(f.root, ".trellis/tasks/record-escape"));
  symlinkSync("../safe/task.json", join(f.root, ".trellis/tasks/record-escape/task.json"));
  const value = f.read();
  assert.equal(value.tasks.length, 2);
  assert.equal(value.complete, false);
  assert.match(value.diagnostics.join("\n"), /escapes/);
});

for (const bad of ["{bad", "null", "[]", "{}", '{"status":42}', '{"title":" ","status":"planning"}', '"text"']) {
  test(`invalid record remains a bounded diagnostic, not an empty project: ${bad}`, t => {
    const f = fixture(t); f.put(".trellis/tasks/bad/task.json", bad);
    const value = f.read();
    assert.equal(value.complete, false);
    assert.equal(value.tasks.length, 0);
    assert.equal(value.diagnostics.length, 1);
    assert.ok(value.diagnostics[0].length <= 320);
  });
}

test("missing/oversized/special/dangling records and missing stores stay diagnostic", t => {
  const f = fixture(t);
  assert.equal(f.read().complete, true);
  mkdirSync(join(f.root, ".trellis/tasks/no-record"));
  f.put(".trellis/tasks/large/task.json", " ".repeat(1024 * 1024 + 1));
  mkdirSync(join(f.root, ".trellis/tasks/directory/task.json"), { recursive: true });
  mkdirSync(join(f.root, ".trellis/tasks/dangling"));
  symlinkSync("gone", join(f.root, ".trellis/tasks/dangling/task.json"));
  // A FIFO must be rejected before readFileSync/readTaskRecord can block.
  mkdirSync(join(f.root, ".trellis/tasks/fifo"));
  execFileSync("mkfifo", [join(f.root, ".trellis/tasks/fifo/task.json")]);
  assert.equal(f.read().diagnostics.length, 5);
  rmSync(join(f.root, ".trellis/tasks"), { recursive: true });
  assert.match(f.read().diagnostics[0], /Unable to read task store/);
});

test("dangling archive produces incomplete data and diagnostics are capped", t => {
  const f = fixture(t);
  symlinkSync("gone", join(f.root, ".trellis/tasks/archive"));
  assert.equal(f.read().complete, false);
  rmSync(join(f.root, ".trellis/tasks/archive"));
  for (let i = 0; i < 50; i++) f.put(`.trellis/tasks/${i}/task.json`, "null");
  assert.equal(f.read().diagnostics.length, 33);
  assert.match(f.read().diagnostics.at(-1), /omitted/);
});

test("cycles, missing links, conflicting owners and orphans retain every task exactly once", t => {
  const f = fixture(t);
  f.record("a", { status: "planning", parent: "b", children: ["b", "free", "missing"] });
  f.record("b", { status: "planning", parent: "a", children: ["a", "free", "orphan"] });
  f.record("free");
  f.record("orphan", { status: "planning", parent: "gone" });
  f.record("self", { status: "planning", parent: "self", children: [42, { toString: null }] });
  const value = f.read();
  assert.equal(value.rows.length, 5);
  assert.equal(new Set(value.rows.map(row => row.task.identity)).size, 5);
  assert.equal(value.rows.find(row => row.task.dir.endsWith("/orphan")).prefix, "");
  assert.equal(value.rows.find(row => row.task.dir.endsWith("/free")).prefix, "");
  assert.match(value.diagnostics.join("\n"), /cycle/);
  assert.match(value.diagnostics.join("\n"), /Conflicting/);
  assert.match(value.diagnostics.join("\n"), /Missing/);
});

test("nested tree ordering is deterministic and source records are never changed", t => {
  const f = fixture(t);
  f.record("a", { status: "planning", children: ["c", "b", "c"] });
  f.record("b", { status: "planning", children: ["d"] });
  f.record("c"); f.record("d");
  const before = readFileSync(join(f.root, ".trellis/tasks/a/task.json"));
  const value = f.read();
  assert.deepEqual(value.rows.map(row => [row.task.dir.split("/").at(-1), row.prefix]), [["a", ""], ["c", "├─ "], ["b", "└─ "], ["d", "   └─ "]]);
  assert.deepEqual(readFileSync(join(f.root, ".trellis/tasks/a/task.json")), before);
});

test("dated directories descend at every tree level with deterministic same-day ties", t => {
  const f = fixture(t);
  f.record("10-13-parent", { title: "父任务", status: "planning", children: ["10-14-a", "10-14-z", "10-12-child"] });
  for (const name of ["10-14-a", "10-14-z", "10-12-child", "10-15-new", "10-11-old"]) f.record(name);
  assert.deepEqual(f.read().rows.map(row => [row.task.dir.split("/").at(-1), row.prefix]), [
    ["10-15-new", ""], ["10-13-parent", ""], ["10-14-z", "├─ "], ["10-14-a", "├─ "], ["10-12-child", "└─ "], ["10-11-old", ""],
  ]);
});

test("labels include directory identity plus original title and avoid identical fallback duplication", t => {
  const f = fixture(t);
  f.record("10-14-english", { name: "english", title: "中文标题", status: "planning" });
  f.record("fallback", { status: "planning" });
  f.record("same", { title: "same", status: "planning" });
  const labels = f.read().tasks.map(taskLabel);
  assert.deepEqual(labels, ["same", "fallback", "10-14-english · 中文标题"]);
});

test("documents distinguish missing, empty, ready, removed and invalid data on fresh reads", t => {
  const f = fixture(t); f.record("a");
  const task = f.read().tasks[0];
  assert.equal(readDocument(f.root, task, "prd").state, "missing");
  f.put(".trellis/tasks/a/prd.md", "\n  \n");
  assert.equal(readDocument(f.root, task, "prd").state, "empty");
  f.put(".trellis/tasks/a/prd.md", "# 中文\nBody\tline");
  assert.deepEqual(readDocument(f.root, task, "prd"), { state: "ready", text: "# 中文\nBody    line" });
  f.put(".trellis/tasks/a/prd.md", Buffer.from([0xff]));
  assert.match(readDocument(f.root, task, "prd").diagnostic, /UTF-8/);
  f.put(".trellis/tasks/a/prd.md", Buffer.from([0]));
  assert.equal(readDocument(f.root, task, "prd").state, "error");
  f.put(".trellis/tasks/a/prd.md", "x".repeat(2 * 1024 * 1024 + 1));
  assert.match(readDocument(f.root, task, "prd").diagnostic, /2 MiB/);
  rmSync(join(f.root, ".trellis/tasks/a"), { recursive: true });
  assert.equal(readDocument(f.root, task, "prd").state, "removed");
});

test("artifact escaping/dangling symlinks and special files are rejected; safe local symlink is read", t => {
  const f = fixture(t); f.record("a"); f.record("b");
  f.put(".trellis/tasks/b/prd.md", "Secret outside a");
  const task = f.read().tasks.find(task => task.dir.endsWith("/a")), file = join(f.root, ".trellis/tasks/a/prd.md");
  symlinkSync("../b/prd.md", file);
  assert.match(readDocument(f.root, task, "prd").diagnostic, /escapes/);
  rmSync(file); symlinkSync("missing", file);
  assert.equal(readDocument(f.root, task, "prd").state, "error");
  rmSync(file); mkdirSync(file);
  assert.match(readDocument(f.root, task, "prd").diagnostic, /regular file/);
  rmSync(file, { recursive: true }); execFileSync("mkfifo", [file]);
  assert.match(readDocument(f.root, task, "prd").diagnostic, /regular file/);
  rmSync(file); f.put(".trellis/tasks/a/source.md", "Local text"); symlinkSync("source.md", file);
  assert.equal(readDocument(f.root, task, "prd").text, "Local text");
});

test("unreadable records/documents are errors, not empty data", t => {
  if (process.getuid?.() === 0) { t.skip("root can read chmod-000 files"); return; }
  const f = fixture(t); f.record("a"); f.put(".trellis/tasks/a/prd.md", "Text");
  const task = f.read().tasks[0], record = join(f.root, task.dir, "task.json"), document = join(f.root, task.dir, "prd.md");
  t.after(() => { try { chmodSync(record, 0o600); chmodSync(document, 0o600); } catch {} });
  chmodSync(document, 0);
  assert.equal(readDocument(f.root, task, "prd").state, "error");
  chmodSync(record, 0);
  assert.equal(f.read().complete, false);
});

test("document reads never follow a replaced task alias into a different identity", t => {
  const f = fixture(t); f.record("a"); f.record("b");
  f.put(".trellis/tasks/b/prd.md", "Different task");
  const task = f.read().tasks.find(task => task.dir.endsWith("/a"));
  rmSync(join(f.root, task.dir), { recursive: true });
  symlinkSync("b", join(f.root, task.dir));
  assert.equal(readDocument(f.root, task, "prd").state, "removed");
});

test("task records reject invalid UTF-8 rather than silently replacing source-language data", t => {
  const f = fixture(t);
  f.put(".trellis/tasks/bad/task.json", Buffer.concat([Buffer.from('{"title":"'), Buffer.from([0xff]), Buffer.from('","status":"planning"}') ]));
  const value = f.read();
  assert.equal(value.tasks.length, 0);
  assert.equal(value.complete, false);
  assert.match(value.diagnostics[0], /UTF-8/);
  f.put(".trellis/tasks/bad/task.json", '{"status":"planning","description":"\u0000"}');
  assert.equal(f.read().tasks.length, 0);
});

test("current identity is disk-only and never opens the pointed-to task record", t => {
  const f = fixture(t);
  const path = ".trellis/.runtime/sessions/browser.json";
  f.record("a");
  f.put(path, '{"current_task":".trellis/tasks/a"}');
  const task = f.read().tasks[0];
  assert.equal(readCurrentTaskIdentity(f.root, "browser"), task.identity);
  rmSync(join(f.root, task.dir, "task.json"));
  execFileSync("mkfifo", [join(f.root, task.dir, "task.json")]);
  assert.equal(readCurrentTaskIdentity(f.root, "browser"), task.identity);
  assert.equal(f.read().tasks.length, 0);
  rmSync(join(f.root, path)); execFileSync("mkfifo", [join(f.root, path)]);
  assert.equal(readCurrentTaskIdentity(f.root, "browser"), undefined);
  rmSync(join(f.root, path));
  f.put(path, Buffer.concat([Buffer.from('{"current_task":"'), Buffer.from([0xff]), Buffer.from('"}') ]));
  assert.equal(readCurrentTaskIdentity(f.root, "browser"), undefined);
});

test("terminal sanitization strips input controls without translating Unicode or Markdown", () => {
  const value = safeText("\x1b]0;bad\x07# 中文\r\n- [x] é🙂\t\x00\x1b[31mred\x1b[0m", true);
  assert.equal(value, "# 中文\n- [x] é🙂     red");
  assert.doesNotMatch(value.replace(/\n/g, ""), /[\x00-\x1f\x7f-\x9f]/);
});

test("archive ranges discover descending months and expose a flat month snapshot", t => {
  const f = fixture(t);
  f.record("active", { title: "Active", status: "planning" });
  f.record("archive/2026-09/old", { title: "September", status: "completed", parent: "outside" });
  f.record("archive/2026-10/new", { title: "October", status: "completed", children: ["old"] });
  f.record("archive/2026-10/other", { title: "Other", status: "completed" });
  assert.deepEqual(readTasks(f.root).tasks.map(task => task.title), ["Active"]);
  assert.deepEqual(readTasks(f.root, "archive-months").months, ["2026-10", "2026-09"]);
  const october = readTasks(f.root, { kind: "archive-month", month: "2026-10" });
  assert.equal(october.complete, true, october.diagnostics.join("\n"));
  assert.deepEqual(october.rows.map(row => [row.task.title, row.prefix]), [["Other", ""], ["October", ""]]);
  assert.equal(readDocument(f.root, october.tasks.find(task => task.title === "October"), "prd").state, "missing");
});

test("archive range rejects escaped months and reports malformed month input safely", t => {
  const f = fixture(t);
  f.put("secret/old/task.json", '{"status":"completed"}');
  mkdirSync(join(f.root, ".trellis/tasks/archive"), { recursive: true });
  symlinkSync(join(f.root, "secret"), join(f.root, ".trellis/tasks/archive/2026-10"));
  const months = readTasks(f.root, "archive-months");
  assert.equal(months.complete, false);
  assert.match(months.diagnostics.join("\n"), /escapes/);
  const invalid = readTasks(f.root, { kind: "archive-month", month: "../secret" });
  assert.equal(invalid.complete, false);
  assert.match(invalid.diagnostics.join("\n"), /Invalid archive month/);
});

test("archive month snapshots reject task aliases escaping the selected month", t => {
  const f = fixture(t);
  f.record("archive/2026-09/old", { status: "completed" });
  mkdirSync(join(f.root, ".trellis/tasks/archive/2026-10"), { recursive: true });
  symlinkSync("../2026-09/old", join(f.root, ".trellis/tasks/archive/2026-10/old-alias"));
  const value = readTasks(f.root, { kind: "archive-month", month: "2026-10" });
  assert.equal(value.tasks.length, 0);
  assert.equal(value.complete, false);
  assert.match(value.diagnostics.join("\n"), /selected archive month/);
});
