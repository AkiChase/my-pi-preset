import assert from "node:assert/strict";
import { it } from "node:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { fixture, input } from "./helpers.ts";
import { readEnabled, setEnabled } from "../config.ts";
import { buildIndex } from "../store.ts";
import { header, TOPIC_BYTES, INDEX_BYTES, LIST_BYTES } from "../policy.ts";
import { withLock } from "../lock.ts";
import { spawn } from "node:child_process";

it("create, exact update, created preservation, conflict and irreversible forget", async t => {
  const { store } = fixture(t);
  const saved = await store.write(input());
  const first = store.read("preference"); assert.equal(first.revision, saved.revision);
  await assert.rejects(store.write(input()), /conflict/);
  await assert.rejects(store.write({ ...input(), body: " " }), /nonblank/);
  assert.equal(store.read("preference").revision, first.revision);
  const changed = await store.write({ ...input(), body: "Use short explanations.", expectedRevision: first.revision });
  assert.equal(store.read("preference").metadata.created, first.metadata.created);
  await assert.rejects(store.forget("preference", first.revision), /conflict/);
  await store.forget("preference", changed.revision);
  assert.deepEqual(fs.readdirSync(store.directory), ["MEMORY.md"]);
  assert.match(fs.readFileSync(join(store.directory, "MEMORY.md"), "utf8"), /Memories: 0/);
});
it("disabled remains readable but blocks both mutations; malformed config preserved", async t => {
  const { store, agentDir } = fixture(t); await store.write(input());
  await setEnabled(agentDir, false); assert.equal(readEnabled(agentDir), false);
  assert.equal(store.list().total, 1); const record = store.read("preference");
  await assert.rejects(store.write({ ...input(), expectedRevision: record.revision }), /disabled/);
  await assert.rejects(store.forget("preference", record.revision), /disabled/);
  fs.writeFileSync(join(agentDir, "memory.json"), '{"directory":"secret"}');
  await assert.rejects(setEnabled(agentDir, true), /boolean/);
  assert.equal(fs.readFileSync(join(agentDir, "memory.json"), "utf8"), '{"directory":"secret"}');
});
it("metadata scan reads no bodies with >200 near-16KiB files; overflow entries stay discoverable", async t => {
  const { store } = fixture(t);
  for (let n = 0; n < 201; n++) {
    const name = `memory-${String(n).padStart(3, "0")}`;
    const meta = { name, description: "四".repeat(160), type: "project" as const, created: "2026-10-15T00:00:00.000Z", updated: "2026-10-15T00:00:00.000Z" };
    const front = header(meta);
    fs.writeFileSync(join(store.directory, `${name}.md`), front + "a".repeat(TOPIC_BYTES - Buffer.byteLength(front)), { mode: 0o600 });
  }
  const scan = store.scan(); assert.equal(scan.entries.length, 201); assert.ok(scan.scannedBytes < 201 * 1024);
  const index = await store.refresh(); assert.ok(Buffer.byteLength(index.text) <= INDEX_BYTES); assert.ok(index.text.split("\n").length - 1 <= 200);
  assert.ok(index.text.endsWith("\n")); assert.match(index.text, /Omitted/); assert.ok(index.shown < 201);
  let offset = 0; let count = 0;
  do { const page = store.list("", offset, 50); assert.ok(Buffer.byteLength(page.text) <= LIST_BYTES); count += page.entries.length; offset = page.nextOffset ?? -1; } while (offset >= 0);
  assert.equal(count, 201); assert.equal(store.list("memory-200").entries[0].name, "memory-200");
  assert.equal(store.read("memory-200").body.length + Buffer.byteLength(header(store.read("memory-200").metadata)), TOPIC_BYTES);
});
it("malformed/frontmatter-overflow/entry-overflow fail closed without replacing index or topic", async t => {
  const { store } = fixture(t); await store.write(input());
  const path = join(store.directory, "MEMORY.md"); const index = fs.readFileSync(path);
  fs.writeFileSync(join(store.directory, "broken.md"), "---\nname: \"broken\"\ndescription: \"" + "a".repeat(1200));
  assert.throws(() => store.list(), /frontmatter/); await assert.rejects(store.refresh(), /frontmatter/); await assert.rejects(store.write(input("new")), /frontmatter/);
  assert.deepEqual(fs.readFileSync(path), index); assert.equal(fs.existsSync(join(store.directory, "new.md")), false);
  fs.unlinkSync(join(store.directory, "broken.md"));
  for (let n = 0; n < 2000; n++) fs.writeFileSync(join(store.directory, `unknown-${n}`), "");
  await assert.rejects(store.refresh(), /2000/); await assert.rejects(store.write(input("new")), /2000/); assert.deepEqual(fs.readFileSync(path), index);
});
it("unicode limits, reserved names, invalid types and secrets reject without leaking values", async t => {
  const { store } = fixture(t);
  await store.write({ ...input(), description: "😀".repeat(160) });
  await assert.rejects(store.write({ ...input("long"), description: "😀".repeat(161) }), /codepoints/);
  await assert.rejects(store.write(input("index")), /reserved/);
  await assert.rejects(store.write(input("../escape")), /slug/);
  await assert.rejects(store.write({ ...input("oversized"), body: "四".repeat(6000) }), /16KiB/);
  const secret = "sk-" + "A".repeat(30);
  await assert.rejects(store.write(input("secret", secret)), error => error instanceof Error && /api-token/.test(error.message) && !error.message.includes(secret));
  await assert.rejects(store.write(input("private", "-----BEGIN PRIVATE KEY-----\nabc")), /private-key/);
  assert.equal(store.list().total, 1);
});
it("oversized, invalid UTF8 and unknown topics provide no complete revision and are never overwritten", async t => {
  const { store } = fixture(t); await store.write(input());
  const path = join(store.directory, "preference.md"); const first = store.read("preference");
  fs.appendFileSync(path, "x".repeat(TOPIC_BYTES));
  assert.throws(() => store.read("preference"), /budget/);
  await assert.rejects(store.write({ ...input(), expectedRevision: first.revision }), /budget/);
  assert.ok(fs.statSync(path).size > TOPIC_BYTES);
  fs.writeFileSync(path, Buffer.from([255])); assert.throws(() => store.read("preference"), /UTF-8/);
  await assert.rejects(store.refresh(), /frontmatter/);
});
it("symlink topics/index/lock/ancestors and hardlinks reject without modifying outside data", async t => {
  const { store, root, agentDir, project } = fixture(t);
  const outside = join(root, "outside"); fs.writeFileSync(outside, "do not change");
  for (const name of ["preference.md", "MEMORY.md", ".memory-lock"]) {
    fs.symlinkSync(outside, join(store.directory, name));
    await assert.rejects(store.write(input()), /private regular/);
    fs.unlinkSync(join(store.directory, name));
  }
  fs.linkSync(outside, join(store.directory, "preference.md")); assert.throws(() => store.read("preference"), /private regular/); fs.unlinkSync(join(store.directory, "preference.md"));
  fs.rmSync(join(agentDir, "memory"), { recursive: true }); fs.symlinkSync(root, join(agentDir, "memory"));
  assert.throws(() => store.initialize(), /symlink/);
  assert.equal(fs.readFileSync(outside, "utf8"), "do not change"); assert.equal(fs.existsSync(join(root, "projects", project.id)), false);
});
it("atomic topic failure cleans temp; index failure reports partial save and refresh repairs", async t => {
  let failKind: string | undefined = "topic";
  const { store } = fixture(t, kind => { if (kind === failKind) throw new Error("injected fs failure"); });
  await assert.rejects(store.write(input()), /injected/); assert.deepEqual(fs.readdirSync(store.directory), []);
  failKind = "index"; const saved = await store.write(input()); assert.equal(saved.indexNeedsRepair, true); assert.equal(store.read("preference").revision, saved.revision);
  failKind = undefined; await store.refresh(); assert.match(fs.readFileSync(join(store.directory, "MEMORY.md"), "utf8"), /preference/);
  assert.ok(fs.readdirSync(store.directory).every(name => !name.startsWith(".memory-")));
  fs.writeFileSync(join(store.directory, "MEMORY.md"), "unknown user file");
  await assert.rejects(store.refresh(), /Unknown/); await assert.rejects(store.write(input("new")), /Unknown/);
});
it("manual edit during publication is detected, not silently overwritten", async t => {
  let change = false;
  const { store } = fixture(t, (kind, _temp, target) => { if (change && kind === "topic") fs.appendFileSync(target, "\nExternal update"); });
  await store.write(input()); const record = store.read("preference"); change = true;
  await assert.rejects(store.write({ ...input(), expectedRevision: record.revision }), /changed/);
  assert.match(store.read("preference").body, /External update/);
});
it("live and unknown locks are not stolen; cancellation releases ownership and operation timers", async t => {
  const { store } = fixture(t); const path = join(store.directory, ".memory-lock");
  fs.writeFileSync(path, "unknown"); await assert.rejects(withLock(store.directory, () => {}, () => {}, 10), /Unknown/); assert.equal(fs.readFileSync(path, "utf8"), "unknown");
  fs.writeFileSync(path, JSON.stringify({ version: 1, token: "11111111-1111-1111-1111-111111111111", pid: process.pid }));
  await assert.rejects(withLock(store.directory, () => {}, () => {}, 30), /timed out/); assert.ok(fs.existsSync(path)); fs.unlinkSync(path);
  await assert.rejects(withLock(store.directory, () => { throw new Error("cancelled"); }), /cancelled/); assert.equal(fs.existsSync(path), false);
});
it("two independent processes compete: exactly one conditional update, no lost update; crashed dead owner recoverable", async t => {
  const { store, agentDir, project } = fixture(t); await store.write(input()); const record = store.read("preference");
  const source = `import { MemoryStore } from ${JSON.stringify(new URL("../store.ts", import.meta.url).href)};
const store = new MemoryStore(${JSON.stringify(agentDir)}, ${JSON.stringify(project)});
process.stdout.write('READY\\n');
process.stdin.once('data', async () => { try { const result = await store.write(${JSON.stringify({ ...input(), expectedRevision: record.revision })}); process.stdout.write(JSON.stringify(result)+'\\n'); } catch { process.stdout.write('CONFLICT\\n'); } process.stdin.destroy(); });`;
  const children = [0, 1].map(() => spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["pipe", "pipe", "pipe"] }));
  t.after(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); });
  const ready = children.map(child => new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); }));
  const outputs = children.map(child => new Promise<string>((resolve, reject) => { let output = ""; let errors = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { errors += chunk; }); child.once("exit", code => code === 0 ? resolve(output) : reject(new Error(`Child ${code}: ${errors}`))); }));
  await Promise.all(ready); for (const child of children) child.stdin.end("go");
  const results = await Promise.all(outputs); assert.equal(results.filter(output => output.includes('"saved":true')).length, 1); assert.equal(results.filter(output => output.includes("CONFLICT")).length, 1);
  assert.equal(fs.existsSync(join(store.directory, ".memory-lock")), false);
  const crash = spawn(process.execPath, ["--input-type=module", "-e", `import { withLock } from ${JSON.stringify(new URL("../lock.ts", import.meta.url).href)}; const timer = setInterval(()=>{},1000); await withLock(${JSON.stringify(store.directory)}, () => { process.stdout.write('LOCKED\\n'); return new Promise(() => {}); }); clearInterval(timer);`], { stdio: ["ignore", "pipe", "pipe"] });
  // Keep the crash fixture alive with an operation-owned pipe; kill only after lock publication.
  t.after(() => { if (crash.exitCode === null) crash.kill("SIGKILL"); });
  const exited = new Promise<void>(resolve => crash.once("exit", () => resolve()));
  await new Promise<void>(resolve => crash.stdout.once("data", () => resolve())); crash.kill("SIGKILL"); await exited;
  assert.ok(fs.existsSync(join(store.directory, ".memory-lock"))); await store.refresh(); assert.equal(fs.existsSync(join(store.directory, ".memory-lock")), false);
});
it("deterministic index stays within complete UTF8 lines and reserved overflow accounting", t => {
  const { store } = fixture(t); const entries = Array.from({ length: 500 }, (_, n) => ({ name: `entry-${n}`, description: "😀".repeat(160), type: "reference" as const, created: "2026-10-15T00:00:00.000Z", updated: "2026-10-15T00:00:00.000Z" }));
  assert.deepEqual(buildIndex(entries), buildIndex(entries)); assert.ok(Buffer.byteLength(buildIndex(entries).text) <= INDEX_BYTES);
  assert.throws(() => store.list("", -1), /Invalid/); assert.throws(() => store.list("", 0, 51), /Invalid/);
});
