import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS, type BgTasksConfig } from "../config.ts";
import { BackgroundRegistry } from "../state.ts";
import { add, createRunningJob } from "../registry.ts";
import { startMonitorSession } from "../monitor-session.ts";
import { terminateJobSilently } from "../lifecycle.ts";
import { MonitorBuffer } from "../monitor-buffer.ts";
import { spawnCommandSource, type MonitorSinks, type MonitorResult } from "../monitor-source.ts";
import { BgTaskPanel } from "../ui.ts";
import { registerJobsTool } from "../tools/jobs.ts";
import { DELIVER_STEER, EVENT } from "../types.ts";

function harness(t: TestContext, config: Partial<BgTasksConfig> = {},
    options: { timeoutMs?: number; wakeAbsentMs?: number; failSend?: boolean; sendError?: unknown; initial?: string } = {}) {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    const dir = mkdtempSync(join(tmpdir(), "monitor-session-"));
    const logPath = join(dir, "m.log");
    writeFileSync(logPath, "ALREADY SENT failure tail should not be reread");
    const reg = new BackgroundRegistry({ ...DEFAULTS, ...config });
    const job = add(reg, createRunningJob({ id: "m00000001", command: "watch", pid: 0,
        name: "test watch", logPath, kind: "monitor", toolCallId: "t" }));
    const sent: { content: string; customType: string; display: boolean; details: { monitor: { state: string } }; at: number; opts: unknown }[] = [];
    let sinks!: MonitorSinks;
    let resolve!: (result: MonitorResult) => void;
    const exit = new Promise<MonitorResult>(r => { resolve = r; });
    let stops = 0;
    const preview = (text: string) => {
        const b = new MonitorBuffer(reg.config.monitorMaxLinesPerEvent, reg.config.outputPreviewChars);
        b.addText(text); return b.take();
    };
    const attempted: string[] = [];
    const attemptedContents: string[] = [];
    startMonitorSession({ pi: { sendMessage(message: typeof sent[number], opts: unknown) {
        attempted.push(message.details.monitor.state);
        attemptedContents.push(message.content);
        if (options.failSend) throw ("sendError" in options ? options.sendError : new Error("sink unavailable"));
        sent.push({ ...message, at: Date.now(), opts });
    } } as never, reg, job, description: "test watch",
        ctx: { ui: { setWidget() {}, setStatus() {}, theme: { fg: (_: string, s: string) => s } } } as never,
        timeoutMs: options.timeoutMs, wakeAbsentMs: options.wakeAbsentMs,
        createSource(s) {
            sinks = s;
            if (options.initial !== undefined) s.event(preview(options.initial), Date.now());
            return { pid: 0, label: "watch", exit, stop() {
                stops++; s.finishing(); s.final(preview("drained final"));
                resolve({ code: null, signal: "SIGTERM" });
                return { code: null, signal: "SIGTERM", observationNote: "Later output may not have been recorded." };
            } };
        },
    });
    t.after(() => { terminateJobSilently(reg, job); t.mock.timers.reset(); rmSync(dir, { recursive: true, force: true }); });
    return { job, reg, sent, attempted, attemptedContents, logPath, tick: (ms: number) => t.mock.timers.tick(ms),
        emit: (text: string) => sinks.event(preview(text), Date.now()), stops: () => stops,
        async end(result: MonitorResult = { code: 0, signal: null }, text?: string) {
            sinks.finishing(); if (text !== undefined) sinks.final(preview(text)); resolve(result);
            await Promise.resolve(); await Promise.resolve();
        },
        finishing: () => sinks.finishing(),
    };
}

test("AC2/3/10: immediate first, minimum 30s, quiet arrival immediate, no passive/empty messages", t => {
    const h = harness(t, {}, { initial: "startup" });
    assert.equal(h.sent.length, 1, "factory already has connected sinks");
    h.tick(100); h.emit("second"); h.tick(29_899); assert.equal(h.sent.length, 1);
    h.tick(1); assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1]!.at - h.sent[0]!.at, 30_000);
    h.tick(60_000); assert.equal(h.sent.length, 2); h.emit("quiet arrival"); assert.equal(h.sent.length, 3);
    for (const m of h.sent) {
        assert.equal(m.display, true); assert.deepEqual(m.opts, DELIVER_STEER);
        assert.match(m.content, /m00000001/); assert.match(m.content, /test watch/); assert.ok(m.content.includes(h.logPath));
    }
});
test("AC3/13: no silence wake or implicit old deadline", t => {
    const h = harness(t); for (let i = 0; i < 10; i++) h.tick(3_600_000);
    assert.equal(h.sent.length, 0); assert.equal(h.job.status, "running"); assert.equal(h.stops(), 0);
});
test("AC4/5/6/7/18: startup silence once, two immediate recoveries, arrival resets silence not status/latch", t => {
    const h = harness(t, {}, { wakeAbsentMs: 10_000 });
    h.tick(10_000); assert.equal(h.sent[0]!.details.monitor.state, "absent");
    assert.match(h.sent[0]!.content, /10000ms; monitor is still running/);
    h.tick(50_000); assert.equal(h.sent.length, 1);
    h.emit("recover"); assert.equal(h.sent[1]!.details.monitor.state, "resumed");
    h.tick(9_000); h.emit("buffered"); h.tick(9_999); assert.equal(h.sent.length, 2);
    h.tick(1); assert.equal(h.sent[2]!.details.monitor.state, "absent");
    assert.match(h.sent[2]!.content, /buffered/);
    h.emit("recover again"); assert.equal(h.sent[3]!.details.monitor.state, "resumed");
    assert.equal(h.job.status, "running"); assert.equal(h.job.outcomeSurfaced, undefined);
});
test("AC8: same-point absent consumes pending instead of ordinary progress", t => {
    const h = harness(t, { monitorFlushMs: 30_000 }, { wakeAbsentMs: 20_000 });
    h.emit("first"); h.tick(10_000); h.emit("pending"); h.tick(20_000);
    assert.equal(h.sent.length, 2); assert.equal(h.sent[1]!.details.monitor.state, "absent");
    assert.match(h.sent[1]!.content, /pending/); h.tick(100_000); assert.equal(h.sent.length, 2);
});
test("AC6: ordinary interval restarts at recovery submission", t => {
    const h = harness(t, { monitorFlushMs: 5_000 }, { wakeAbsentMs: 10_000 });
    h.tick(10_000); h.emit("recovery"); h.tick(1_000); h.emit("pending");
    h.tick(3_999); assert.equal(h.sent.length, 2); h.tick(1);
    assert.equal(h.sent[2]!.details.monitor.state, "progress");
    assert.equal(h.sent[2]!.at - h.sent[1]!.at, 5_000);
});
for (const [status, result] of [["completed", { code: 0, signal: null }], ["failed", { code: 7, signal: null }],
    ["killed", { code: null, signal: "SIGTERM" }]] as const) {
    test(`AC9/10: ${status} combines pending/final once with no repeated failure tail or late timers`, async t => {
        const h = harness(t, {}, { wakeAbsentMs: 10_000 });
        h.emit("first"); h.emit("pending"); await h.end(result, "partial tail");
        assert.equal(h.sent.length, 2); const final = h.sent[1]!;
        assert.equal(final.customType, EVENT.taskNotification); assert.equal(final.details.monitor.state, status);
        assert.match(final.content, /pending\npartial tail/); assert.doesNotMatch(final.content, /ALREADY SENT|first/);
        assert.deepEqual(final.opts, DELIVER_STEER); assert.equal(final.display, true);
        assert.equal(h.job.status, status); assert.equal(h.reg.completedCount + h.reg.failedCount + h.reg.killedCount, 1);
        h.emit("late"); h.tick(100_000); assert.equal(h.sent.length, 2);
    });
}
test("AC9/18: shared panel/jobs stop and session abort suppress pending/final and clean resources", async t => {
    const h = harness(t, {}, { wakeAbsentMs: 10_000 }); h.emit("first"); h.emit("pending");
    terminateJobSilently(h.reg, h.job); terminateJobSilently(h.reg, h.job);
    h.tick(100_000); h.emit("late"); await Promise.resolve();
    assert.equal(h.sent.length, 1); assert.equal(h.stops(), 1, "session closes the source once");
    assert.equal(h.reg.jobAborts.size, 0); assert.equal(h.job.status, "killed");
});
test("AC14: total deadline wins over silence/progress, drains into one reason terminal", async t => {
    const h = harness(t, {}, { timeoutMs: 30_000, wakeAbsentMs: 30_000 });
    h.emit("first"); h.emit("pending"); h.tick(30_000); await Promise.resolve();
    assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.content, /timeout after 30000ms/);
    assert.match(h.sent[1]!.content, /pending\ndrained final/); assert.match(h.sent[1]!.content, /Later output/);
    assert.equal(h.job.status, "killed"); h.tick(100_000); assert.equal(h.sent.length, 2);
});
test("AC11/14: huge finite deadlines/silence are chunked, not Node 1ms overflow", t => {
    const huge = 2_147_483_647 + 1000;
    const h = harness(t, {}, { timeoutMs: huge, wakeAbsentMs: huge });
    h.tick(1); assert.equal(h.sent.length, 0); h.tick(2_147_483_646); assert.equal(h.job.status, "running");
    h.tick(999); assert.equal(h.sent.length, 0); h.tick(1);
    assert.equal(h.sent.length, 1); assert.equal(h.job.status, "killed");
});
test("AC15/4: firehose never rate-kills, bounded previews, omitted activity resets silence", t => {
    const h = harness(t, { monitorMaxLinesPerEvent: 2, outputPreviewChars: 8 }, { wakeAbsentMs: 1000 });
    h.emit("first"); for (let i = 0; i < 100; i++) { h.tick(900); h.emit("long content\nmore\nextra"); }
    assert.equal(h.stops(), 0); assert.equal(h.job.status, "running");
    assert.ok(h.sent.every(m => m.details.monitor.state !== "absent"));
    h.tick(1000); assert.equal(h.sent.at(-1)!.details.monitor.state, "absent");
    assert.match(h.sent.at(-1)!.content, /notification omitted/);
});
test("AC17: shared maxLogBytes check owns one combined wake, no adjacent passive warning", async t => {
    const h = harness(t, { maxLogBytes: 100, stallCheckIntervalMs: 5000 });
    h.emit("first"); h.emit("pending"); writeFileSync(h.logPath, "stderr only".repeat(100));
    h.tick(5000); await Promise.resolve(); assert.equal(h.sent.length, 2);
    assert.match(h.sent[1]!.content, /log size exceeded 100 bytes/); assert.match(h.sent[1]!.content, /pending\ndrained final/);
    assert.equal(h.sent[1]!.customType, EVENT.taskNotification); assert.equal(h.job.status, "killed");
});
test("AC9/17: attach/outcome suppression keeps terminal output from being re-sent", async t => {
    const h = harness(t); h.emit("first"); h.emit("pending"); h.job.attachCount = 1;
    await h.end(); assert.equal(h.sent.length, 1); assert.equal(h.job.outcomeSurfaced, undefined);
});
test("send failure never kills source or marks outcome surfaced", async t => {
    const h = harness(t, {}, { failSend: true }); h.emit("first");
    assert.equal(h.job.status, "running"); assert.equal(h.stops(), 0); assert.equal(h.job.outcomeSurfaced, undefined);
    assert.match(h.job.notifyError!, /sink unavailable/); await h.end({ code: 1, signal: null });
    assert.equal(h.job.status, "failed"); assert.equal(h.job.outcomeSurfaced, undefined); assert.match(h.job.notifyError!, /sink unavailable/);
});
test("AC9: known finishing prevents same-point timer/final-read leading-edge emission", async t => {
    const h = harness(t, {}, { wakeAbsentMs: 1000 }); h.finishing(); h.tick(1000);
    await h.end({ code: 0, signal: null }, "final only"); assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0]!.customType, EVENT.taskNotification); assert.match(h.sent[0]!.content, /final only/);
});
test("AC2: zero interval still sends a whole source callback batch, not individual lines", t => {
    const h = harness(t, { monitorFlushMs: 0 }); h.emit("a\nb\nc");
    assert.equal(h.sent.length, 1); assert.match(h.sent[0]!.content, /a\nb\nc/);
});

test("AC18: viewing/closing panel leaves monitor scheduling alone; panel x and jobs kill are silent", async t => {
    const h = harness(t, { monitorFlushMs: 5000 }, { wakeAbsentMs: 10000 }); h.emit("first"); h.emit("pending");
    const theme = { fg: (_: string, s: string) => s };
    const ctx = { ui: { notify() {}, setWidget() {}, setStatus() {}, theme } } as never;
    const panel = () => new BgTaskPanel({ reg: h.reg, ctx, theme, keys: { matches: () => false },
        tui: { terminal: { rows: 30 }, requestRender() {} } as never, done() {} });
    const p = panel(); p.render(100); p.handleInput("\u001b"); p.dispose();
    h.tick(5000); assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.content, /pending/);
    h.emit("pending after close"); const killing = panel(); killing.render(100); killing.handleInput("x"); killing.dispose();
    h.tick(100000); await Promise.resolve(); assert.equal(h.sent.length, 2); assert.equal(h.reg.jobAborts.size, 0);
});
test("AC18: jobs kill of active monitor with pending/silence timer uses the same silent boundary", async t => {
    const h = harness(t, {}, { wakeAbsentMs: 10000 }); h.emit("first"); h.emit("pending");
    let execute!: (id: string, params: unknown, signal: unknown, update: unknown, ctx: unknown) => Promise<unknown>;
    registerJobsTool({ registerTool(def: { execute: typeof execute }) { execute = def.execute; } } as never, h.reg);
    await execute("kill", { action: "kill", jobId: h.job.id }, undefined, undefined,
        { ui: { setWidget() {}, setStatus() {}, theme: { fg: (_: string, s: string) => s } } });
    h.tick(100000); assert.equal(h.sent.length, 1); assert.equal(h.job.outcomeSurfaced, true);
});
test("AC18: replacement registry ignores old callbacks and abort releases source/timer", async t => {
    const h = harness(t, {}, { wakeAbsentMs: 1000 }); h.emit("first"); h.emit("pending");
    h.reg.jobs.clear(); h.reg.jobAborts.get(h.job.id)!.abort();
    h.tick(100000); await h.end({ code: 1, signal: null }, "old final");
    assert.equal(h.sent.length, 1); assert.equal(h.stops(), 1); assert.equal(h.reg.completedCount + h.reg.failedCount + h.reg.killedCount, 0);
});

for (const forced of ["deadline", "oversize"] as const) {
    // A deadline test must not be satisfied by the earlier shared log check.
    const config = { maxLogBytes: forced === "deadline" ? DEFAULTS.maxLogBytes : 1, stallCheckIntervalMs: 1000 };
    const reason = forced === "deadline" ? /timeout after 1000ms/ : /log size exceeded 1 bytes/;
    test(`AC9/14/17: ${forced} failure to submit never latches outcome surfaced`, t => {
        t.mock.method(console, "error", () => {});
        const h = harness(t, config,
            { failSend: true, ...(forced === "deadline" ? { timeoutMs: 1000 } : {}) });
        h.tick(999); assert.equal(h.job.status, "running"); assert.equal(h.attempted.length, 0);
        h.tick(1); assert.equal(h.job.status, "killed"); assert.equal(h.job.outcomeSurfaced, undefined);
        assert.match(h.job.notifyError!, /sink unavailable/); assert.equal(h.reg.killedCount, 1);
        assert.equal(h.attemptedContents.length, 1); assert.match(h.attemptedContents[0]!, reason);
    });
    test(`AC9/14/17: ${forced} terminal obeys attach suppression without marking outcome`, t => {
        const h = harness(t, config, forced === "deadline" ? { timeoutMs: 1000 } : {});
        h.job.attachCount = 1; h.emit("first"); h.emit("pending");
        h.tick(999); assert.equal(h.job.status, "running"); h.tick(1);
        assert.equal(h.sent.length, 1); assert.equal(h.job.status, "killed"); assert.equal(h.job.outcomeSurfaced, undefined);
        assert.deepEqual(h.attempted, ["progress"]);
        assert.equal(h.stops(), 1); assert.equal(h.reg.jobAborts.size, 0);
    });
}

for (const sendError of [null, undefined]) {
    test(`AC10: ${sendError} send failures isolate progress, reminder, recovery and terminal`, async t => {
        t.mock.method(console, "error", () => {});
        const h = harness(t, {}, { failSend: true, sendError, wakeAbsentMs: 1000 });
        assert.doesNotThrow(() => h.emit("first"));
        assert.equal(h.job.notifyError, String(sendError));
        assert.doesNotThrow(() => h.tick(1000)); // absent
        assert.doesNotThrow(() => h.emit("recovery"));
        assert.equal(h.job.status, "running"); assert.equal(h.stops(), 0);
        assert.equal(h.job.outcomeSurfaced, undefined);
        await h.end();
        assert.equal(h.job.status, "completed"); assert.equal(h.job.notifyError, String(sendError));
        assert.equal(h.job.outcomeSurfaced, undefined); assert.equal(h.reg.jobAborts.size, 0);
        assert.deepEqual(h.attempted, ["progress", "absent", "resumed", "completed"]);
        h.emit("late"); h.tick(100000); assert.equal(h.reg.completedCount, 1);
    });
    for (const forced of ["deadline", "oversize"] as const) {
        const config = { maxLogBytes: forced === "deadline" ? DEFAULTS.maxLogBytes : 1, stallCheckIntervalMs: 1000 };
        const reason = forced === "deadline" ? /timeout after 1000ms/ : /log size exceeded 1 bytes/;
        test(`AC9/10/14/17: ${forced} with ${sendError} sink failure still stops and cleans without latching success`, async t => {
            t.mock.method(console, "error", () => {});
            const h = harness(t, config,
                { failSend: true, sendError, ...(forced === "deadline" ? { timeoutMs: 1000 } : {}) });
            h.tick(999); assert.equal(h.job.status, "running"); assert.equal(h.attempted.length, 0);
            assert.doesNotThrow(() => h.tick(1)); await Promise.resolve();
            assert.equal(h.job.status, "killed"); assert.equal(h.reg.killedCount, 1);
            assert.equal(h.stops(), 1); assert.equal(h.reg.jobAborts.size, 0);
            assert.equal(h.job.notifyError, String(sendError)); assert.equal(h.job.outcomeSurfaced, undefined);
            assert.equal(h.attemptedContents.length, 1); assert.match(h.attemptedContents[0]!, reason);
            h.tick(100000); assert.equal(h.stops(), 1); assert.equal(h.attemptedContents.length, 1);
        });
    }
}

test("AC18: startup UI failure cleans source, abort/timers and completion hooks; late callbacks are inert", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
    const dir = mkdtempSync(join(tmpdir(), "monitor-startup-"));
    t.after(() => { t.mock.timers.reset(); rmSync(dir, { recursive: true, force: true }); });
    const reg = new BackgroundRegistry({ ...DEFAULTS });
    const job = add(reg, createRunningJob({ id: "m00000001", command: "watch", pid: 0,
        logPath: join(dir, "m.log"), kind: "monitor", toolCallId: "startup" }));
    const killed: [number, unknown][] = [];
    t.mock.method(process, "kill", (pid: number, signal: unknown) => { killed.push([pid, signal]); return true; });
    const activeTimers = new Set<NodeJS.Timeout>();
    const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
    t.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => {
        const timer = set(callback, delay); activeTimers.add(timer); return timer;
    });
    t.mock.method(globalThis, "clearTimeout", (timer: NodeJS.Timeout) => { activeTimers.delete(timer); clear(timer); });
    const sent: unknown[] = [];
    let sinks!: MonitorSinks, stops = 0;
    let resolve!: (result: MonitorResult) => void;
    let done: Promise<void> | undefined;
    const exit = new Promise<MonitorResult>(r => { resolve = r; });
    const b = new MonitorBuffer(50, 200); b.addText("late output"); const preview = b.take();
    const failure = new Error("sidebar failed");
    assert.throws(() => startMonitorSession({ pi: { sendMessage(m: unknown) { sent.push(m); } } as never,
        reg, job, description: "startup failure", wakeAbsentMs: 1000,
        ctx: { ui: { setStatus() { done = job.donePromise; throw failure; }, setWidget() {},
            theme: { fg: (_: string, s: string) => s } } } as never,
        createSource(s) { sinks = s; return { pid: 12345, label: "watch", exit, stop() {
            stops++; s.finishing(); s.final(preview); resolve({ code: null, signal: "SIGTERM" });
        } }; },
    }), failure);
    // Mirror the tool-owned registry/count rollback before the exit microtask.
    reg.jobs.delete(job.id); reg.totalStarted--;
    assert.equal(stops, 1); assert.deepEqual(killed, [[-12345, "SIGTERM"]]);
    assert.equal(reg.jobAborts.size, 0); assert.equal(activeTimers.size, 0);
    assert.ok(done); await done;
    assert.equal(job.stop, undefined); assert.equal(job.donePromise, undefined); assert.equal(job.resolveDone, undefined);
    sinks.event(preview, Date.now()); sinks.finishing(); sinks.final(preview);
    t.mock.timers.tick(100000); await Promise.resolve();
    assert.equal(sent.length, 0); assert.equal(reg.jobs.size, 0); assert.equal(reg.totalStarted, 0);
    assert.equal(reg.completedCount + reg.failedCount + reg.killedCount, 0);
});

for (const sendError of [null, undefined]) {
    test(`AC10: command receive path stays alive across ${sendError} progress failure and preserves both raw streams`, async t => {
        t.mock.method(console, "error", () => {});
        const dir = mkdtempSync(join(tmpdir(), "monitor-sink-"));
        const reg = new BackgroundRegistry({ ...DEFAULTS, monitorFlushMs: 0 });
        const logPath = join(dir, "m.log");
        const job = add(reg, createRunningJob({ id: "m00000001", command: "watch", pid: 0, logPath, kind: "monitor", toolCallId: "sink" }));
        const out = new PassThrough(), err = new PassThrough();
        const child = Object.assign(new EventEmitter(), { stdout: out, stderr: err, pid: 0 });
        t.after(() => { terminateJobSilently(reg, job); rmSync(dir, { recursive: true, force: true }); });
        let exit!: Promise<MonitorResult>;
        startMonitorSession({ reg, job, description: "sink errors",
            pi: { sendMessage() { throw sendError; } } as never,
            ctx: { ui: { setStatus() {}, setWidget() {}, theme: { fg: (_: string, s: string) => s } } } as never,
            createSource(sinks) {
                const source = spawnCommandSource({ command: "watch", cwd: dir, logPath, sinks,
                    limits: { maxLines: 50, maxChars: 200 }, spawnProcess: (() => child) as unknown as typeof spawn });
                exit = source.exit; return source;
            },
        });
        out.write("stdout first\n"); await Promise.resolve();
        assert.equal(job.status, "running"); assert.ok(!out.destroyed && !err.destroyed);
        err.write("stderr second\n"); await Promise.resolve();
        assert.equal(job.status, "running"); assert.ok(!out.destroyed && !err.destroyed);
        assert.equal(job.notifyError, String(sendError)); assert.equal(job.outcomeSurfaced, undefined);
        assert.equal(readFileSync(logPath, "utf8"), "stdout first\nstderr second\n");
        child.emit("exit", 0, null); const result = await exit; await Promise.resolve();
        assert.equal(result.code, 0); assert.equal(result.reason, undefined); assert.equal(job.status, "completed");
        assert.equal(job.outcomeSurfaced, undefined); assert.equal(job.notifyError, String(sendError));
        assert.equal(reg.jobAborts.size, 0); assert.ok(out.destroyed && err.destroyed);
    });
}
