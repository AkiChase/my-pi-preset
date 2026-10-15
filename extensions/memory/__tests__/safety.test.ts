import assert from "node:assert/strict";
import { it } from "node:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { fixture, input } from "./helpers.ts";
import fsMutable from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { atomicReplace, PublishedError } from "../paths.ts";
import { withLock } from "../lock.ts";
import { readEnabled, setEnabled } from "../config.ts";
import { MemoryStore } from "../store.ts";
import type { MemoryType } from "../policy.ts";

it("private permissions and complete-file budgets are enforced; missing body and invalid type do not mutate", async t => {
  const { store, agentDir } = fixture(t); await store.write(input());
  assert.equal(fs.statSync(store.directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(join(store.directory, "preference.md")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(join(store.directory, "MEMORY.md")).mode & 0o777, 0o600);
  await assert.rejects(store.write({ ...input("missing"), body: undefined as unknown as string }), /nonblank/);
  await assert.rejects(store.write({ ...input("bad-type"), type: "daily" as MemoryType }), /type/);
  await assert.rejects(store.write({ ...input("bad-date"), description: "line\nbreak" }), /control/);
  fs.symlinkSync(join(agentDir, "settings.json"), join(agentDir, "memory.json"));
  assert.throws(() => readEnabled(agentDir), /regular/);
  fs.unlinkSync(join(agentDir, "memory.json"));
  const before = fs.readdirSync(store.directory);
  assert.throws(() => new MemoryStore(agentDir, { ...store.project, id: "../escape" }), /identity/);
  assert.deepEqual(fs.readdirSync(store.directory), before);
});
it("malformed complete metadata and secret descriptions stop scan; no unknown temp/file is overwritten", async t => {
  const { store } = fixture(t); await store.write(input());
  const path = join(store.directory, "preference.md"); const initial = fs.readFileSync(path, "utf8");
  fs.writeFileSync(path, initial.replace('type: "user"', 'type: "daily"'));
  assert.throws(() => store.list(), /type/); await assert.rejects(store.refresh(), /type/);
  fs.writeFileSync(path, initial.replace('description: "Communication preference"', 'description: "sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'));
  assert.throws(() => store.list(), error => error instanceof Error && /api-token/.test(error.message) && !error.message.includes("AAAAAAAA"));
  fs.writeFileSync(path, initial);
  const index = fs.readFileSync(join(store.directory, "MEMORY.md"));
  fs.writeFileSync(join(store.directory, ".memory-tmp-unknown"), "keep"); await store.refresh();
  assert.equal(fs.readFileSync(join(store.directory, ".memory-tmp-unknown"), "utf8"), "keep"); assert.deepEqual(fs.readFileSync(join(store.directory, "MEMORY.md")), index);
});
it("symlink substitution at atomic publication is refused and temp/lock released", async t => {
  let attack = false;
  const { store, root } = fixture(t, (kind, temp) => { if (attack && kind === "topic") { fs.unlinkSync(temp); fs.symlinkSync(join(root, "outside"), temp); } });
  fs.writeFileSync(join(root, "outside"), "preserve"); attack = true;
  await assert.rejects(store.write(input()), /regular/);
  assert.equal(fs.readFileSync(join(root, "outside"), "utf8"), "preserve");
  assert.equal(fs.existsSync(join(store.directory, "preference.md")), false);
  assert.equal(fs.existsSync(join(store.directory, ".memory-lock")), false);
  // Unsafe foreign substituted temp is intentionally preserved, never followed/removed as owned data.
});
it("regular-file substitution of an owned temporary file is refused and foreign file is preserved", async t => {
  const { store, root } = fixture(t, (kind, temp) => {
    if (kind !== "topic") return;
    // Rename, rather than unlink, keeps the old inode alive and avoids incidental inode reuse.
    fs.renameSync(temp, join(root, "owned-original"));
    fs.writeFileSync(temp, "foreign content", { mode: 0o600 });
  });
  await assert.rejects(store.write(input()), /temporary file changed/);
  assert.equal(fs.existsSync(join(store.directory, "preference.md")), false);
  assert.equal(fs.existsSync(join(store.directory, ".memory-lock")), false);
  const foreign = fs.readdirSync(store.directory).filter(name => name.startsWith(".memory-tmp-"));
  assert.equal(foreign.length, 1);
  assert.equal(fs.readFileSync(join(store.directory, foreign[0]), "utf8"), "foreign content");
});
it("in-place modification of an owned temporary file cannot publish a mismatched revision", async t => {
  const { store } = fixture(t, (kind, temp) => {
    if (kind === "topic") fs.writeFileSync(temp, "different content");
  });
  await assert.rejects(store.write(input()), /temporary file changed/);
  assert.deepEqual(fs.readdirSync(store.directory), []);
});
it("post-publication directory fsync failure is explicit for topic and configuration", async t => {
  const { store, agentDir, root } = fixture(t);
  const original = fsMutable.fsyncSync;
  fsMutable.fsyncSync = fd => {
    if (fs.fstatSync(fd).isDirectory()) throw new Error("injected directory fsync failure");
    original(fd);
  };
  syncBuiltinESMExports();
  try {
    const saved = await store.write(input());
    assert.equal(saved.saved, true);
    assert.equal(saved.indexNeedsRepair, true);
    assert.equal(store.read("preference").revision, saved.revision);
    await assert.rejects(setEnabled(agentDir, false), error => error instanceof PublishedError);
    assert.equal(readEnabled(agentDir), false); // Error says published, not that the old setting survived.
    assert.throws(() => atomicReplace(join(root, "published"), "new", "config"), PublishedError);
    assert.equal(fs.readFileSync(join(root, "published"), "utf8"), "new");
    assert.equal(fs.existsSync(join(agentDir, ".memory-lock")), false);
  } finally { fsMutable.fsyncSync = original; syncBuiltinESMExports(); }
});
it("public agentDir symlink ancestors are refused without changing the real private root", t => {
  const { root, agentDir, project } = fixture(t);
  const alias = join(root, "agent-alias");
  fs.symlinkSync(agentDir, alias);
  const before = fs.readdirSync(agentDir);
  assert.throws(() => new MemoryStore(alias, project).initialize(), /symlink/);
  assert.deepEqual(fs.readdirSync(agentDir), before);
});
it("an index changed in-place to an unknown format during publication is preserved", async t => {
  let attack = false;
  const { store } = fixture(t, (kind, _temp, target) => {
    if (attack && kind === "index") fs.writeFileSync(target, "unknown user content");
  });
  await store.write(input());
  attack = true;
  await assert.rejects(store.refresh(), /Unknown MEMORY/);
  assert.equal(fs.readFileSync(join(store.directory, "MEMORY.md"), "utf8"), "unknown user content");
  assert.equal(fs.existsSync(join(store.directory, ".memory-lock")), false);
});
it("Windows unknown PID liveness retains the lock without issuing a process signal", async t => {
  const { store } = fixture(t);
  const path = join(store.directory, ".memory-lock");
  const text = JSON.stringify({ version: 1, token: "11111111-1111-1111-1111-111111111111", pid: 99999999 });
  fs.writeFileSync(path, text);
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const kill = process.kill;
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  process.kill = () => { throw new Error("must not signal on Windows"); };
  try {
    await assert.rejects(withLock(store.directory, () => {}, () => {}, 10), /timed out/);
    assert.equal(fs.readFileSync(path, "utf8"), text);
  } finally { Object.defineProperty(process, "platform", platform); process.kill = kill; }
});
it("configuration is revalidated if an external edit changes its format before publication", async t => {
  const { agentDir } = fixture(t);
  const path = join(agentDir, "memory.json");
  await setEnabled(agentDir, true);
  const original = fsMutable.fsyncSync;
  let changed = false;
  fsMutable.fsyncSync = fd => {
    if (!changed && fs.fstatSync(fd).isFile() && fs.fstatSync(fd).size === Buffer.byteLength(JSON.stringify({ enabled: false }, null, 2))) {
      changed = true; fs.writeFileSync(path, '{"directory":"unknown"}');
    }
    original(fd);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(setEnabled(agentDir, false), /boolean/);
    assert.equal(fs.readFileSync(path, "utf8"), '{"directory":"unknown"}');
    assert.equal(fs.existsSync(join(agentDir, ".memory-lock")), false);
  } finally { fsMutable.fsyncSync = original; syncBuiltinESMExports(); }
});
it("external valid edits change revision and safe refresh repairs marked malformed index; partial deletion is explicit", async t => {
  let indexFail = false;
  const { store } = fixture(t, kind => { if (kind === "index" && indexFail) throw new Error("index failed"); });
  await store.write(input()); const old = store.read("preference"); fs.appendFileSync(old.path, "\nManual change");
  const edited = store.read("preference"); assert.notEqual(old.revision, edited.revision);
  await assert.rejects(store.write({ ...input(), expectedRevision: old.revision }), /conflict/);
  const indexPath = join(store.directory, "MEMORY.md");
  const marker = fs.readFileSync(indexPath, "utf8").split("\n")[0]; fs.writeFileSync(indexPath, marker + "\ncorrupt content");
  await store.refresh(); assert.match(fs.readFileSync(indexPath, "utf8"), /preference/);
  indexFail = true; assert.equal((await store.forget("preference", edited.revision)).indexNeedsRepair, true);
  assert.equal(fs.existsSync(edited.path), false); indexFail = false; await store.refresh(); assert.match(fs.readFileSync(indexPath, "utf8"), /Memories: 0/);
});
