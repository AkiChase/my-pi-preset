import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { canonicalPath } from "../lib/config.ts";
import { readBinding, markerFile, bindingFile, acquireBindingLock, parseBinding, sameIdentity } from "../lib/bindings.ts";
import { manageWorktree } from "./worktree-fixture.mjs";

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-w1-"));
  const root = canonicalPath(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  git("init", "-q");
  put(".gitignore", "/.worktree/\n/.trellis/.runtime/\n");
  put("code.txt", "committed code\n");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  const task = ".trellis/tasks/10-12-test";
  put(`${task}/task.json`, '{"status":"in_progress"}');
  const run = (extra = {}) => manageWorktree({ cwd: root, action: "create", task, confirm: true, ...extra });
  return { root, put, git, task, run };
}


test("preview has pinned full base and no mutations; create persists matching markers but not ready", async (t) => {
  const f = fixture(t);
  const preview = await f.run({ confirm: false });
  assert.equal(preview.preview, true);
  assert.match(preview.plan.baseCommit, /^[a-f0-9]{40}$/);
  assert.ok(!existsSync(join(f.root, ".worktree")));
  assert.ok(!existsSync(join(f.root, ".trellis/.runtime")));
  const created = await f.run();
  assert.equal(created.binding.preparationState, "unprepared");
  assert.equal(created.binding.worktreePath, join(f.root, ".worktree/10-12-test"));
  assert.equal(readFileSync(join(created.binding.worktreePath, "code.txt"), "utf8"), "committed code\n");
  assert.ok(!existsSync(join(created.binding.worktreePath, f.task, "task.json")), "W1 must not copy task materials");
  assert.deepEqual(JSON.parse(readFileSync(markerFile(created.binding.worktreePath))), readBinding(f.root, f.task));
  assert.equal(created.binding.repositoryIdentity, canonicalPath(join(f.root, ".git")));
});

test("creation preserves source staged/unstaged/untracked contents and index", async (t) => {
  const f = fixture(t);
  f.put("code.txt", "staged source\n"); f.git("add", "code.txt");
  f.put("code.txt", "unstaged source\n"); f.put("new.txt", "untracked source\n");
  const snapshot = () => JSON.stringify([f.git("diff", "--cached"), f.git("diff"), f.git("status", "--porcelain"), readFileSync(join(f.root, "new.txt"), "utf8")]);
  const before = snapshot(), indexBefore = readFileSync(join(f.root, ".git/index"));
  const created = await f.run();
  assert.equal(snapshot(), before);
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), indexBefore);
  assert.ok(!existsSync(join(created.binding.worktreePath, "new.txt")));
});

test("repeated create/status reuse absolute binding even after invalid configuration", async (t) => {
  const f = fixture(t), first = await f.run();
  f.put(".pi/pi-trellis.json", "not JSON");
  const reused = await f.run(); assert.equal(reused.reused, true); assert.deepEqual(reused.binding, first.binding);
  const status = await f.run({ action: "status" }); assert.deepEqual(status.problems, []);
  await assert.rejects(f.run({ branch: "different" }), /different branch/);
});

test("adopt accepts existing registered branch worktree and rejects ordinary directory", async (t) => {
  const f = fixture(t);
  const target = join(f.root, "../", `${f.root.split('/').at(-1)}-external`);
  t.after(() => rmSync(target, { recursive: true, force: true }));
  f.git("worktree", "add", "-b", "external", target, "HEAD");
  const bound = await f.run({ action: "bind", path: target }); assert.equal(bound.binding.branch, "external");
  assert.equal(bound.binding.worktreePath, canonicalPath(target));
  f.put(".trellis/tasks/other/task.json", '{}');
  await assert.rejects(f.run({ action: "bind", task: ".trellis/tasks/other", path: join(f.root, ".trellis") }), /metadata directories/);
});

test("unignored directory/runtime, existing path/branch and unsafe tasks fail without overwrite", async (t) => {
  const f = fixture(t);
  f.put(".gitignore", "/.trellis/.runtime/\n");
  await assert.rejects(f.run(), /must ignore/);
  assert.ok(!existsSync(join(f.root, ".worktree")));
  f.put(".gitignore", "/.worktree/\n/.trellis/.runtime/\n");
  f.put(".worktree/10-12-test/user.txt", "do not overwrite");
  await assert.rejects(f.run(), /already exists/);
  assert.equal(readFileSync(join(f.root, ".worktree/10-12-test/user.txt"), "utf8"), "do not overwrite");
  rmSync(join(f.root, ".worktree"), { recursive: true });
  f.git("branch", "trellis/10-12-test");
  await assert.rejects(f.run(), /Branch already exists/);
  await assert.rejects(f.run({ task: ".trellis/tasks/../bad" }), /safe full task slug/);
});

test("source calls from a bound target reuse instead of nesting", async (t) => {
  const f = fixture(t), first = await f.run();
  const again = await f.run({ cwd: first.binding.worktreePath });
  assert.equal(again.reused, true); assert.equal(again.binding.sourceRoot, f.root);
  assert.ok(!existsSync(join(first.binding.worktreePath, ".worktree")));
});

test("mismatched marker and missing target reported, never silently recreated", async (t) => {
  const f = fixture(t), created = await f.run();
  const marker = markerFile(created.binding.worktreePath);
  const record = JSON.parse(readFileSync(marker)); record.bindingId = "forged"; writeFileSync(marker, JSON.stringify(record));
  const status = await f.run({ action: "status" }); assert.match(status.problems.join(), /differ/);
  await assert.rejects(f.run(), /differ/);
  rmSync(created.binding.worktreePath, { recursive: true });
  const missing = await f.run({ action: "status" }); assert.ok(missing.problems.length > 0);
  await assert.rejects(f.run(), /failed|registered/);
});

test("source-wide exclusive lock rejects overlap, release permits retry", async (t) => {
  const f = fixture(t);
  const release = acquireBindingLock(f.root);
  try { await assert.rejects(f.run(), /locked/); } finally { release(); }
  assert.equal((await f.run()).binding.preparationState, "unprepared");
});

test("cancellation before transaction is read-only", async (t) => {
  const f = fixture(t), controller = new AbortController();controller.abort();
  await assert.rejects(f.run({ signal: controller.signal }));
  assert.ok(!existsSync(bindingFile(f.root, f.task)));
});

test("custom source-relative directory and parent symlink resolve without shell expansion", async (t) => {
  const f = fixture(t);
  f.put(".gitignore", "/custom/\n/.trellis/.runtime/\n");
  f.put(".pi/pi-trellis.json", JSON.stringify({ worktree: { directory: "custom" } }));
  const first = await f.run();
  assert.equal(first.binding.worktreePath, join(f.root, "custom/10-12-test"));
  f.put(".trellis/tasks/second/task.json", '{}');
  symlinkSync(join(f.root, "custom"), join(f.root, "link"));
  f.put(".pi/pi-trellis.json", JSON.stringify({ worktree: { directory: "link" } }));
  const next = await f.run({ task: ".trellis/tasks/second" });
  assert.equal(next.binding.worktreePath, join(f.root, "custom/second"));
  f.put(".pi/pi-trellis.json", JSON.stringify({ worktree: { directory: ".." } }));
  await assert.rejects(f.run({ task: ".trellis/tasks/third" }), /task|directory/i);

});

test("branch switch and unbound linked source calls fail explicitly", async (t) => {
  const f = fixture(t), created = await f.run();
  execFileSync("git", ["-C", created.binding.worktreePath, "checkout", "-b", "manual-change"], { stdio: "pipe" });
  const status = await f.run({ action: "status" }); assert.match(status.problems.join(), /branch differs/);
  await assert.rejects(f.run(), /branch differs/);
  const other = join(f.root, ".worktree/other"); f.git("worktree", "add", "-b", "other", other, "HEAD");
  await assert.rejects(f.run({ cwd: other }), /Unbound linked worktree/);
});

test("adopt rejects foreign repositories and detached registered worktrees", async (t) => {
  const f = fixture(t), foreign = fixture(t);
  await assert.rejects(f.run({ action: "bind", path: foreign.root }), /registered Git worktree/);
  const detached = join(f.root, ".worktree/detached"); f.git("worktree", "add", "--detach", detached, "HEAD");
  await assert.rejects(f.run({ action: "bind", path: detached }), /branch-backed/);
});

test("failed target runtime check retains worktree, branch and error record", async (t) => {
  const f = fixture(t);
  f.put(".gitignore", "/.worktree/\n/.trellis/.runtime/\n"); // source ignore differs from committed base
  f.git("show", "HEAD:.gitignore");
  // Make a second base whose tracked ignore rules do not ignore runtime.
  f.put(".gitignore", "/.worktree/\n"); f.git("add", ".gitignore");
  f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "base lacks runtime ignore");
  f.put(".gitignore", "/.worktree/\n/.trellis/.runtime/\n");
  await assert.rejects(f.run(), /retained/);
  const record = readBinding(f.root, f.task);
  assert.equal(record.preparationState, "error");
  assert.ok(existsSync(join(record.worktreePath, "code.txt")));
  assert.equal(f.git("rev-parse", `refs/heads/${record.branch}`), record.baseCommit);
  assert.ok(!existsSync(join(f.root, ".trellis/.runtime/pi-trellis/worktrees.lock")));
});

test("binding storage symlink is not a trusted external task store", async (t) => {
  const f = fixture(t), outside = fixture(t);
  mkdirSync(join(f.root, ".trellis/.runtime/pi-trellis"), { recursive: true });
  symlinkSync(outside.root, join(f.root, ".trellis/.runtime/pi-trellis/bindings"));
  await assert.rejects(f.run(), /symlink outside/);
});

function bindingRecord() {
 const root=canonicalPath(tmpdir());
 return {version:2,bindingId:'fixture-id',taskDir:'.trellis/tasks/test',sourceRoot:root,
  worktreePath:join(root,'binding-target'),repositoryIdentity:join(root,'binding-git'),
  branch:'trellis/test',baseCommit:'a'.repeat(40),contextId:'fixture-context',
  preparationState:'ready',createdAt:'2026-10-16T00:00:00Z'};
}

test('host strict v2 binding schema rejects old descriptors and unknown combinations',()=>{
 const b=bindingRecord();assert.deepEqual(parseBinding(b),b);
 for(const bad of [{...b,version:1},{...b,preparedFiles:{}},{...b,materials:{}},{...b,unknown:true},{...b,branch:'bad\tbranch'}])assert.throws(()=>parseBinding(bad));
});

test('binding identity compares every immutable field, ignoring mutable preparation and error state',()=>{
 const b=bindingRecord();assert.equal(sameIdentity(b,{...b}),true);
 for(const field of ['version','bindingId','taskDir','sourceRoot','worktreePath','repositoryIdentity','branch','baseCommit','contextId','createdAt']) {
  const changed={...b,[field]:field==='version'?3:b[field]+'-changed'};
  assert.equal(sameIdentity(b,changed),false,field);
  assert.equal(sameIdentity(changed,b),false,field);
 }
 assert.equal(sameIdentity(b,{...b,preparationState:'error',lastError:'failed publication'}),true);
});
