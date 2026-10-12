import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { writeAll } from "../monitor-source.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnCommandSource, type MonitorSinks } from "../monitor-source.ts";
import { previewText } from "../monitor-buffer.ts";

function sinks() {
    const progress: string[] = [], final: string[] = [], order: string[] = [];
    const callbacks: MonitorSinks = {
        event(p) { progress.push(previewText(p)); order.push("event"); },
        finishing() { order.push("finishing"); }, final(p) { final.push(previewText(p)); order.push("final"); },
    };
    return { progress, final, order, callbacks };
}
for (const command of ["printf 'OUT\\n'; printf 'ERR\\n' >&2", "printf 'ERR\\n' >&2"]) {
    test(`AC12/19: raw merged log, stderr activity, exit zero completed: ${command}`, async t => {
        const dir = mkdtempSync(join(tmpdir(), "monitor-source-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
        const logPath = join(dir, "m.log"); const h = sinks();
        const src = spawnCommandSource({ command, cwd: dir, logPath, sinks: h.callbacks, limits: { maxLines: 50, maxChars: 12000 } });
        t.after(() => src.stop()); const result = await src.exit;
        assert.equal(result.code, 0); assert.equal(result.signal, null);
        const log = readFileSync(logPath, "utf8"); assert.match(log, /ERR\n/);
        assert.ok(h.progress.join("\n").includes("ERR")); assert.doesNotMatch(h.progress.join("\n"), /stderr|severity/);
        if (command.includes("OUT")) assert.match(log, /OUT\n/);
    });
}
for (const [command, expected, excluded] of [
    ["{ printf 'drop-out\\nkeep-out\\n'; printf 'drop-err\\nkeep-err\\n' >&2; } | grep keep", ["keep-out", "drop-err", "keep-err"], ["drop-out"]],
    ["{ printf 'drop-out\\nkeep-out\\n'; printf 'drop-err\\nkeep-err\\n' >&2; } 2>&1 | grep keep", ["keep-out", "keep-err"], ["drop-out", "drop-err"]],
] as const) {
    test(`AC19: user pipe semantics preserved: ${command}`, async t => {
        const dir = mkdtempSync(join(tmpdir(), "monitor-pipe-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
        const logPath = join(dir, "m.log");
        const src = spawnCommandSource({ command, cwd: dir, logPath, sinks: sinks().callbacks, limits: { maxLines: 50, maxChars: 12000 } });
        t.after(() => src.stop()); await src.exit; const log = readFileSync(logPath, "utf8");
        for (const value of expected) assert.ok(log.includes(value)); for (const value of excluded) assert.ok(!log.includes(value));
    });
}
test("AC19: explicit separate redirects remain separate", async t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-redirect-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const logPath = join(dir, "m.log");
    const src = spawnCommandSource({ command: "printf OUT >out; printf ERR >err", cwd: dir, logPath,
        sinks: sinks().callbacks, limits: { maxLines: 50, maxChars: 12000 } });
    await src.exit; assert.equal(readFileSync(logPath, "utf8"), "");
    assert.equal(readFileSync(join(dir, "out"), "utf8"), "OUT"); assert.equal(readFileSync(join(dir, "err"), "utf8"), "ERR");
});
for (const earlyEOF of [true, false]) {
    test(`AC9/12: exit boundary synchronously drains both pipes, EOF first=${earlyEOF}`, async t => {
        const dir = mkdtempSync(join(tmpdir(), "monitor-drain-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
        const out = new PassThrough(), err = new PassThrough(); const child = Object.assign(new EventEmitter(), { stdout: out, stderr: err, pid: 0 });
        const logPath = join(dir, "m.log"); const h = sinks();
        const src = spawnCommandSource({ command: "unchanged | grep x", cwd: dir, logPath, sinks: h.callbacks,
            limits: { maxLines: 50, maxChars: 12000 }, spawnProcess: ((...params: unknown[]) => {
                assert.deepEqual(params[1], ["-c", "unchanged | grep x"]); return child;
            }) as unknown as typeof spawn });
        if (earlyEOF) {
            out.end("out\n"); err.end("err\n");
            await new Promise<void>(resolve => setImmediate(resolve));
        } else {
            out.pause(); err.pause(); out.write("buffered-out\npartial"); err.write("buffered-err\ntail");
        }
        child.emit("exit", 0, null);
        assert.ok(out.destroyed && err.destroyed, "pipes destroyed before any future callback");
        const result = await src.exit;
        assert.equal(h.order.filter(v => v === "finishing").length, 1);
        if (!earlyEOF) {
            assert.equal(h.progress.length, 0, "final reads cannot manufacture progress");
            assert.match(h.final.join("\n"), /buffered-out/); assert.match(h.final.join("\n"), /buffered-err/);
            assert.equal(readFileSync(logPath, "utf8"), "buffered-out\npartialbuffered-err\ntail");
            assert.match(result.observationNote!, /later output may not have been recorded/);
            assert.doesNotMatch(result.observationNote!, /\d+ (bytes|lines)/);
        } else assert.equal(result.observationNote, undefined);
        const count = h.order.length; child.emit("exit", 1, null); src.stop(); assert.equal(h.order.length, count);
    });
}
test("AC12: descendant-held pipes do not keep the monitor alive after main shell exit", async t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-descendant-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const logPath = join(dir, "m.log"), h = sinks();
    const src = spawnCommandSource({ command: "sleep 5 & printf 'main\\n'; exit 0", cwd: dir, logPath,
        sinks: h.callbacks, limits: { maxLines: 50, maxChars: 12000 } });
    t.after(() => { try { process.kill(-src.pid, "SIGTERM"); } catch { /* already gone */ } });
    const result = await src.exit; assert.equal(result.code, 0); assert.match(result.observationNote!, /later output/);
    assert.match(readFileSync(logPath, "utf8"), /main/);
});
test("AC9: pipe error fails once and destroys both streams", async t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-error-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = new PassThrough(), err = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout: out, stderr: err, pid: 0 });
    const h = sinks(); const src = spawnCommandSource({ command: "x", cwd: dir, logPath: join(dir, "m.log"), sinks: h.callbacks,
        limits: { maxLines: 2, maxChars: 10 }, spawnProcess: (() => child) as unknown as typeof spawn });
    err.emit("error", new Error("broken pipe")); const result = await src.exit;
    assert.equal(result.code, 1); assert.match(result.reason!, /broken pipe/); assert.ok(out.destroyed && err.destroyed);
});

test("AC12: incomplete UTF-8 is logged as raw bytes and explicitly noted at exit boundary", async t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-utf8-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = new PassThrough(), err = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout: out, stderr: err, pid: 0 });
    const h = sinks(), logPath = join(dir, "m.log");
    const src = spawnCommandSource({ command: "x", cwd: dir, logPath, sinks: h.callbacks,
        limits: { maxLines: 2, maxChars: 10 }, spawnProcess: (() => child) as unknown as typeof spawn });
    const raw = Buffer.from([0xf0, 0x9f]); out.write(raw); child.emit("exit", 0, null);
    const result = await src.exit; assert.deepEqual(readFileSync(logPath), raw);
    assert.match(result.observationNote!, /Incomplete UTF-8/); assert.equal(h.progress.length, 0);
});

test("AC12/19: huge raw dual-stream output stays on disk even when source previews omit it", async t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-huge-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = new PassThrough(), err = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout: out, stderr: err, pid: 0 });
    const h = sinks(), logPath = join(dir, "m.log");
    const src = spawnCommandSource({ command: "x", cwd: dir, logPath, sinks: h.callbacks,
        limits: { maxLines: 2, maxChars: 10 }, spawnProcess: (() => child) as unknown as typeof spawn });
    const a = Buffer.from("A".repeat(100000) + "\n"), b = Buffer.from("B".repeat(100000) + "\n");
    out.write(a); err.write(b); child.emit("exit", 0, null); await src.exit;
    assert.deepEqual(readFileSync(logPath), Buffer.concat([a, b]));
    assert.equal(h.progress.length, 2); assert.ok(h.progress.every(p => /99990 characters/.test(p)));
});

test("raw log writer handles short writes; write failure is contained and closes both pipes", async t => {
    let written = "";
    t.mock.method(fs, "writeSync", (_fd: number, bytes: Buffer, offset: number, count: number) => {
        const take = Math.min(2, count); written += bytes.subarray(offset, offset + take).toString(); return take;
    });
    syncBuiltinESMExports();
    writeAll(12345, Buffer.from("abcdef")); assert.equal(written, "abcdef");
    t.mock.restoreAll(); syncBuiltinESMExports();
    const dir = mkdtempSync(join(tmpdir(), "monitor-write-error-"));
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); });
    const out = new PassThrough(), err = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout: out, stderr: err, pid: 0 });
    const h = sinks(); const src = spawnCommandSource({ command: "x", cwd: dir, logPath: join(dir, "m.log"), sinks: h.callbacks,
        limits: { maxLines: 2, maxChars: 10 }, spawnProcess: (() => child) as unknown as typeof spawn });
    t.mock.method(fs, "writeSync", () => { throw new Error("disk full"); }); syncBuiltinESMExports();
    assert.doesNotThrow(() => err.write("event\n")); const result = await src.exit;
    assert.equal(result.code, 1); assert.match(result.reason!, /disk full/); assert.equal(h.progress.length, 0);
    assert.ok(out.destroyed && err.destroyed);
});
