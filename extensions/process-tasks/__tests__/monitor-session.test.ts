import { processInput } from "../../runtime-tasks/__tests__/process-input.ts";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { DEFAULTS, type ProcessTasksConfig } from "../config.ts";
import { BackgroundRegistry } from "../state.ts";
import { add, createRunningJob } from "../registry.ts";
import { startMonitorSession } from "../monitor-session.ts";
import { markKilledSilently, startBackgroundJob, terminateJobSilently } from "../lifecycle.ts";
import { MonitorBuffer } from "../monitor-buffer.ts";
import { openWsMonitorSource, spawnCommandSource, type MonitorSinks, type MonitorResult } from "../monitor-source.ts";
import { TaskPanel } from "../../task-ui/panel.ts";
import { DEFAULTS as UI_DEFAULTS } from "../../task-ui/config.ts";
import { createProcessTaskSource } from "../source.ts";
import { registerManagementFixture } from "./management-fixture.ts";
import { DELIVER_STEER, EVENT } from "../types.ts";
import { processActivation } from "./process-harness.ts";

function harness(t: TestContext, config: Partial<ProcessTasksConfig> = {},
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
        attempted.push(message.details.monitor?.state ?? "batch");
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

test("AC2/3/10: bounded first window, shared 30s, quiet arrival short window, no passive/empty messages", t => {
    const h = harness(t, {}, { initial: "startup" });
    assert.equal(h.sent.length, 0, "factory already has connected sinks; delivery has a short window");
    h.tick(200); assert.equal(h.sent.length, 1);
    h.tick(100); h.emit("second"); h.tick(29_899); assert.equal(h.sent.length, 1);
    h.tick(1); assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1]!.at - h.sent[0]!.at, 30_000);
    h.tick(60_000); assert.equal(h.sent.length, 2); h.emit("quiet arrival"); assert.equal(h.sent.length, 2); h.tick(200); assert.equal(h.sent.length, 3);
    for (const m of h.sent) {
        assert.equal(m.display, true); assert.deepEqual(m.opts, DELIVER_STEER);
        assert.match(m.content, /m00000001/); assert.match(m.content, /test watch/); assert.ok(m.content.includes(h.logPath));
    }
});
test("AC3/13: no silence wake or implicit old deadline", t => {
    const h = harness(t); for (let i = 0; i < 10; i++) h.tick(3_600_000);
    assert.equal(h.sent.length, 0); assert.equal(h.job.status, "running"); assert.equal(h.stops(), 0);
});
test("AC4/5/6/7/18: startup silence once, two timely recoveries, arrival resets silence not status/latch", t => {
    const h = harness(t, {}, { wakeAbsentMs: 10_000 });
    h.tick(10_000); h.tick(200); assert.equal(h.sent[0]!.details.monitor.state, "absent");
    assert.match(h.sent[0]!.content, /10000ms; monitor is still running/);
    h.tick(50_000); assert.equal(h.sent.length, 1);
    h.emit("recover"); h.tick(200); assert.equal(h.sent[1]!.details.monitor.state, "resumed");
    h.tick(9_000); h.emit("buffered"); h.tick(9_999); assert.equal(h.sent.length, 2);
    h.tick(1); h.tick(200); assert.equal(h.sent[2]!.details.monitor.state, "absent");
    assert.match(h.sent[2]!.content, /buffered/);
    h.emit("recover again"); h.tick(200); assert.equal(h.sent[3]!.details.monitor.state, "resumed");
    assert.equal(h.job.status, "running"); assert.equal(h.job.outcomeSurfaced, undefined);
});
test("AC8: same-point absent consumes pending instead of ordinary progress", t => {
    const h = harness(t, { monitorFlushMs: 30_000 }, { wakeAbsentMs: 20_000 });
    h.emit("first"); h.tick(200); h.tick(10_000); h.emit("pending"); h.tick(20_000); h.tick(200);
    assert.equal(h.sent.length, 2); assert.equal(h.sent[1]!.details.monitor.state, "absent");
    assert.match(h.sent[1]!.content, /pending/); h.tick(100_000); assert.equal(h.sent.length, 2);
});
test("AC6: ordinary interval restarts at recovery submission", t => {
    const h = harness(t, { monitorFlushMs: 5_000 }, { wakeAbsentMs: 10_000 });
    h.tick(10_000); h.tick(200); h.emit("recovery"); h.tick(200); h.tick(1_000); h.emit("pending");
    h.tick(3_999); assert.equal(h.sent.length, 2); h.tick(1);
    assert.equal(h.sent[2]!.details.monitor.state, "progress");
    assert.equal(h.sent[2]!.at - h.sent[1]!.at, 5_000);
});
for (const [status, result] of [["completed", { code: 0, signal: null }], ["failed", { code: 7, signal: null }],
    ["killed", { code: null, signal: "SIGTERM" }]] as const) {
    test(`AC9/10: ${status} combines pending/final once with no repeated failure tail or late timers`, async t => {
        const h = harness(t, {}, { wakeAbsentMs: 10_000 });
        h.emit("first"); h.tick(200); h.emit("pending"); await h.end(result, "partial tail"); h.tick(200);
        assert.equal(h.sent.length, 2); const final = h.sent[1]!;
        assert.equal(final.customType, EVENT.taskNotification); assert.equal(final.details.monitor.state, status);
        assert.match(final.content, /pending\npartial tail/); assert.doesNotMatch(final.content, /ALREADY SENT|first/);
        assert.deepEqual(final.opts, DELIVER_STEER); assert.equal(final.display, true);
        assert.equal(h.job.status, status); assert.equal(h.reg.completedCount + h.reg.failedCount + h.reg.killedCount, 1);
        h.emit("late"); h.tick(100_000); assert.equal(h.sent.length, 2);
    });
}
test("AC9/18: shared panel/jobs stop and session abort suppress pending/final and clean resources", async t => {
    const h = harness(t, {}, { wakeAbsentMs: 10_000 }); h.emit("first"); h.tick(200); h.emit("pending");
    terminateJobSilently(h.reg, h.job); terminateJobSilently(h.reg, h.job);
    h.tick(100_000); h.emit("late"); await Promise.resolve();
    assert.equal(h.sent.length, 1); assert.equal(h.stops(), 1, "session closes the source once");
    assert.equal(h.reg.jobAborts.size, 0); assert.equal(h.job.status, "killed");
});
test("AC14: total deadline wins over silence/progress, drains into one reason terminal", async t => {
    const h = harness(t, {}, { timeoutMs: 30_000, wakeAbsentMs: 30_000 });
    h.emit("first"); h.tick(200); h.emit("pending"); h.tick(30_000); h.tick(200); await Promise.resolve();
    assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.content, /timeout after 30000ms/);
    assert.match(h.sent[1]!.content, /pending\ndrained final/); assert.match(h.sent[1]!.content, /Later output/);
    assert.equal(h.job.status, "killed"); h.tick(100_000); assert.equal(h.sent.length, 2);
});
test("AC11/14: huge finite deadlines/silence are chunked, not Node 1ms overflow", t => {
    const huge = 2_147_483_647 + 1000;
    const h = harness(t, {}, { timeoutMs: huge, wakeAbsentMs: huge });
    h.tick(1); assert.equal(h.sent.length, 0); h.tick(2_147_483_646); assert.equal(h.job.status, "running");
    h.tick(999); assert.equal(h.sent.length, 0); h.tick(1); h.tick(200);
    assert.equal(h.sent.length, 1); assert.equal(h.job.status, "killed");
});
test("AC15/4: firehose never rate-kills, bounded previews, omitted activity resets silence", t => {
    const h = harness(t, { monitorMaxLinesPerEvent: 2, outputPreviewChars: 8 }, { wakeAbsentMs: 1000 });
    h.emit("first"); h.tick(200); for (let i = 0; i < 100; i++) { h.tick(900); h.emit("long content\nmore\nextra"); }
    assert.equal(h.stops(), 0); assert.equal(h.job.status, "running");
    assert.ok(h.sent.every(m => m.details.monitor.state !== "absent"));
    h.tick(1000); h.tick(200); assert.equal(h.sent.at(-1)!.details.monitor.state, "absent");
    assert.match(h.sent.at(-1)!.content, /notification omitted/);
});
test("AC17: shared maxLogBytes check owns one combined wake, no adjacent passive warning", async t => {
    const h = harness(t, { maxLogBytes: 100, stallCheckIntervalMs: 5000 });
    h.emit("first"); h.tick(200); h.emit("pending"); writeFileSync(h.logPath, "stderr only".repeat(100));
    h.tick(5000); h.tick(200); await Promise.resolve(); assert.equal(h.sent.length, 2);
    assert.match(h.sent[1]!.content, /log size exceeded 100 bytes/); assert.match(h.sent[1]!.content, /pending\ndrained final/);
    assert.equal(h.sent[1]!.customType, EVENT.taskNotification); assert.equal(h.job.status, "killed");
});
test("AC9/17: attach/outcome suppression keeps terminal output from being re-sent", async t => {
    const h = harness(t); h.emit("first"); h.tick(200); h.emit("pending"); h.job.attachCount = 1;
    await h.end(); assert.equal(h.sent.length, 1); assert.equal(h.job.outcomeSurfaced, undefined);
});
test("send failure never kills source or marks outcome surfaced", async t => {
    const h = harness(t, {}, { failSend: true }); h.emit("first"); h.tick(200);
    assert.equal(h.job.status, "running"); assert.equal(h.stops(), 0); assert.equal(h.job.outcomeSurfaced, undefined);
    assert.match(h.job.notifyError!, /sink unavailable/); await h.end({ code: 1, signal: null }); h.tick(200);
    assert.equal(h.job.status, "failed"); assert.equal(h.job.outcomeSurfaced, undefined); assert.match(h.job.notifyError!, /sink unavailable/);
});
test("AC9: known finishing prevents same-point timer/final-read leading-edge emission", async t => {
    const h = harness(t, {}, { wakeAbsentMs: 1000 }); h.finishing(); h.tick(1000);
    await h.end({ code: 0, signal: null }, "final only"); h.tick(200); assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0]!.customType, EVENT.taskNotification); assert.match(h.sent[0]!.content, /final only/);
});
test("AC2: zero interval still sends a whole source callback batch, not individual lines", t => {
    const h = harness(t, { monitorFlushMs: 0 }); h.emit("a\nb\nc");
    assert.equal(h.sent.length, 1); assert.match(h.sent[0]!.content, /a\nb\nc/);
});

test("AC18: viewing/closing panel leaves monitor scheduling alone; panel x and jobs kill are silent", async t => {
    const h = harness(t, { monitorFlushMs: 5000 }, { wakeAbsentMs: 10000 }); h.emit("first"); h.tick(200); h.emit("pending");
    const theme = { fg: (_: string, s: string) => s };
    const ctx = { ui: { notify() {}, setWidget() {}, setStatus() {}, theme } } as never;
    const source = createProcessTaskSource(h.reg);
    const offSource = h.reg.coordinator.registerSource(source);
    t.after(() => { offSource(); source.dispose(); });
    const panel = () => new TaskPanel({ coordinator: h.reg.coordinator, config: UI_DEFAULTS, ctx, theme, keys: { matches: () => false },
        tui: { terminal: { rows: 30 }, requestRender() {} } as never, done() {} });
    const p = panel(); p.render(100); p.handleInput("\u001b"); p.dispose();
    h.tick(5000); assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.content, /pending/);
    h.emit("pending after close"); const killing = panel(); killing.render(100); killing.handleInput("x"); killing.dispose();
    h.tick(100000); await Promise.resolve(); assert.equal(h.sent.length, 2); assert.equal(h.reg.jobAborts.size, 0);
});
test("AC18: jobs kill of active monitor with pending/silence timer uses the same silent boundary", async t => {
    const h = harness(t, {}, { wakeAbsentMs: 10000 }); h.emit("first"); h.tick(200); h.emit("pending");
    let execute!: (id: string, params: unknown, signal: unknown, update: unknown, ctx: unknown) => Promise<unknown>;
    registerManagementFixture({ registerTool(def: { execute: typeof execute }) { execute = def.execute; } } as never, h.reg);
    await execute("kill", processInput({ action: "stop", task_id: h.job.id }), undefined, undefined,
        { ui: { setWidget() {}, setStatus() {}, theme: { fg: (_: string, s: string) => s } } });
    h.tick(100000); assert.equal(h.sent.length, 1); assert.equal(h.job.outcomeSurfaced, true);
});
test("AC18: replacement registry ignores old callbacks and abort releases source/timer", async t => {
    const h = harness(t, {}, { wakeAbsentMs: 1000 }); h.emit("first"); h.tick(200); h.emit("pending");
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
        h.tick(1); assert.equal(h.job.status, "killed"); h.tick(200); assert.equal(h.job.outcomeSurfaced, undefined);
        assert.match(h.job.notifyError!, /sink unavailable/); assert.equal(h.reg.killedCount, 1);
        assert.equal(h.attemptedContents.length, 1); assert.match(h.attemptedContents[0]!, reason);
    });
    test(`AC9/14/17: ${forced} terminal obeys attach suppression without marking outcome`, t => {
        const h = harness(t, config, forced === "deadline" ? { timeoutMs: 1000 } : {});
        h.job.attachCount = 1; h.emit("first"); h.tick(200); h.emit("pending");
        h.tick(799); assert.equal(h.job.status, "running"); h.tick(1); h.tick(200);
        assert.equal(h.sent.length, 1); assert.equal(h.job.status, "killed"); assert.equal(h.job.outcomeSurfaced, undefined);
        assert.deepEqual(h.attempted, ["progress"]);
        assert.equal(h.stops(), 1); assert.equal(h.reg.jobAborts.size, 0);
    });
}

for (const sendError of [null, undefined]) {
    test(`AC10: ${sendError} send failures isolate progress, reminder, recovery and terminal`, async t => {
        t.mock.method(console, "error", () => {});
        const h = harness(t, {}, { failSend: true, sendError, wakeAbsentMs: 1000 });
        assert.doesNotThrow(() => h.emit("first")); h.tick(200);
        assert.equal(h.job.notifyError, String(sendError));
        assert.doesNotThrow(() => h.tick(1000)); h.tick(200); // absent
        assert.doesNotThrow(() => h.emit("recovery")); h.tick(200);
        assert.equal(h.job.status, "running"); assert.equal(h.stops(), 0);
        assert.equal(h.job.outcomeSurfaced, undefined);
        await h.end(); h.tick(200);
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
            assert.doesNotThrow(() => h.tick(1)); h.tick(200); await Promise.resolve();
            assert.equal(h.job.status, "killed"); assert.equal(h.reg.killedCount, 1);
            assert.equal(h.stops(), 1); assert.equal(h.reg.jobAborts.size, 0);
            assert.equal(h.job.notifyError, String(sendError)); assert.equal(h.job.outcomeSurfaced, undefined);
            assert.equal(h.attemptedContents.length, 1); assert.match(h.attemptedContents[0]!, reason);
            h.tick(100000); assert.equal(h.stops(), 1); assert.equal(h.attemptedContents.length, 1);
        });
    }
}

test("AC18: startup wiring failure cleans source, abort/timers and completion hooks; late callbacks are inert", async t => {
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
    const failure = new Error("registry wiring failed");
    const publish = reg.changed.bind(reg);
    t.mock.method(reg, "changed", () => { publish(); done = job.donePromise; throw failure; });
    assert.throws(() => startMonitorSession({ pi: { sendMessage(m: unknown) { sent.push(m); } } as never,
        reg, job, description: "startup failure", wakeAbsentMs: 1000,
        ctx: { ui: { setStatus() {}, setWidget() {},
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

test("shared retrieval detach on the terminal tick re-delivers the bounded monitor final, not a failure tail", async t => {
    const h = harness(t);
    let jobs!: { execute(id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown): Promise<{ content: { text: string }[] }> };
    registerManagementFixture({ registerTool: (tool: typeof jobs) => { jobs = tool; } } as never, h.reg);
    const ctx = { ui: { notify() {} } };
    const a = jobs.execute("a", processInput({ action: "wait", task_id: h.job.id }), undefined, undefined, ctx);
    const b = jobs.execute("b", processInput({ action: "wait", task_id: h.job.id }), undefined, undefined, ctx);
    h.emit("first"); h.tick(200); h.emit("pending");
    // end() awaits two microtasks; detach after onExit suppresses final but before result completion.
    const ending = h.end({ code: 0, signal: null }, "final fragment");
    await Promise.resolve();
    assert.equal(h.reg.coordinator.detachAll(), 2);
    await Promise.all([a, b, ending]); h.tick(200);
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1]!.details.monitor.state, "completed");
    assert.match(h.sent[1]!.content, /pending\nfinal fragment/);
    assert.doesNotMatch(h.sent[1]!.content, /ALREADY SENT/);
    assert.equal(h.job.attachCount, 0);
    h.tick(100_000); assert.equal(h.sent.length, 2);
});

for (const boundary of ["source factory", "registry publication return", "registry wire publish"] as const) {
    test(`reentrant shutdown inside ${boundary} closes actual WS source exactly once without a final batch`, async t => {
        class Socket {
            static instance: Socket;
            readonly listeners = new Map<string, ((event: unknown) => void)[]>();
            closes = 0;
            constructor() { Socket.instance = this; }
            addEventListener(name: string, callback: (event: unknown) => void) {
                const list = this.listeners.get(name) ?? []; list.push(callback); this.listeners.set(name, list);
            }
            close() { this.closes++; }
            emit(name: string, event: unknown) { for (const callback of this.listeners.get(name) ?? []) callback(event); }
        }
        const original = globalThis.WebSocket;
        globalThis.WebSocket = Socket as unknown as typeof WebSocket;
        t.after(() => { globalThis.WebSocket = original; });
        const errors: unknown[][] = [];
        t.mock.method(console, "error", (...args: unknown[]) => { errors.push(args); });
        const dir = mkdtempSync(join(tmpdir(), "monitor-reentrant-session-"));
        const h = processActivation(dir);
        const job = add(h.reg, createRunningJob({ id: "reentrant", command: "watch", pid: 0,
            logPath: join(dir, "ws.log"), toolCallId: "reentrant", kind: "monitor" }));
        let closing: Promise<void> | undefined;
        const shutdown = () => { if (h.lifecycle.active) closing = h.lifecycle.shutdown(); };
        if (boundary === "registry publication return") {
            const publish = h.reg.changed.bind(h.reg);
            t.mock.method(h.reg, "changed", () => { publish(); shutdown(); });
        }
        if (boundary === "registry wire publish") h.source.subscribe(shutdown);
        try {
            const outcome = startMonitorSession({ reg: h.reg, job, ctx: h.context, description: "reentrant",
                pi: { sendMessage(m: unknown) { h.messages.push(m); } } as never,
                timeoutMs: 60_000, wakeAbsentMs: 30_000,
                createSource(sinks) {
                    const source = openWsMonitorSource({ url: "ws://offline.test" }, job.logPath, sinks,
                        { maxLines: 50, maxChars: 200 });
                    if (boundary === "source factory") shutdown();
                    return source;
                },
            });
            await closing;
            assert.equal(outcome, "cancelled"); assert.equal(h.lifecycle.phase, "closed");
            assert.equal(Socket.instance.closes, 1);
            const before = readFileSync(job.logPath);
            Socket.instance.emit("message", { data: "late frame after close" });
            Socket.instance.emit("close", { code: 1006, reason: "late" });
            Socket.instance.emit("error", {});
            assert.deepEqual(readFileSync(job.logPath), before, "closed fd cannot append late frames; file is retained");
            assert.equal(h.reg.executions.size, 0); assert.equal(h.reg.jobAborts.size, 0);
            assert.equal(h.reg.notificationRetries.size, 0); assert.equal(h.reg.foreground.size, 0);
            assert.equal(h.coordinator.waitCount, 0); assert.equal(h.coordinator.snapshot().length, 0);
            assert.equal(h.reg.sidebarTimer, undefined); assert.equal(h.reg.sweepTimer, undefined);
            assert.equal(job.stop, undefined); assert.equal(job.donePromise, undefined); assert.equal(job.resolveDone, undefined);
            assert.equal(h.reg.totalStarted, 1); assert.equal(h.reg.killedCount, 1);
            assert.equal(h.reg.completedCount + h.reg.failedCount, 0);
            assert.equal(h.messages.length, 0); assert.equal(errors.length, 0, "no cleanup timeout/errors");
        } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
    });
}

for (const boundary of ["closed", "terminal", "replaced"] as const) {
    test(`direct monitor session rejects ${boundary} admission without calling its source factory`, async t => {
        const dir = mkdtempSync(join(tmpdir(), "monitor-guard-"));
        const h = processActivation(dir);
        const job = add(h.reg, createRunningJob({ id: "guard", command: "watch", pid: 0,
            logPath: join(dir, "guard.log"), toolCallId: "guard", kind: "monitor" }));
        if (boundary === "closed") await h.lifecycle.shutdown();
        else if (boundary === "terminal") markKilledSilently(h.reg, job);
        else h.reg.jobs.delete(job.id);
        let calls = 0;
        try {
            assert.equal(startMonitorSession({ reg: h.reg, job, ctx: h.context, description: "guard",
                pi: {} as never, createSource() { calls++; throw new Error("must not open"); } }), "cancelled");
            assert.equal(calls, 0); assert.equal(h.reg.executions.size, 0);
        } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
    });
}

test("already-terminal background setup invokes a throwing source stop but still stops and releases actual execution", async t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-terminal-stop-"));
    const h = processActivation(dir);
    const job = add(h.reg, createRunningJob({ id: "terminal", command: "watch", pid: 0,
        logPath: join(dir, "saved.log"), toolCallId: "terminal", kind: "monitor" }));
    writeFileSync(job.logPath, "saved"); markKilledSilently(h.reg, job);
    let stopped = 0, actualStopped = 0;
    let resolve!: (result: MonitorResult) => void;
    const done = new Promise<MonitorResult>(r => { resolve = r; });
    job.stop = () => { stopped++; throw new Error("source stop failed"); };
    t.mock.method(console, "error", () => {});
    try {
        const ac = startBackgroundJob({ reg: h.reg, job, ctx: h.context, pi: {} as never, exit: done,
            execution: { done, stop() { actualStopped++; resolve({ code: null, signal: "SIGTERM" }); } } });
        assert.equal(ac.signal.aborted, true); await done; await Promise.resolve();
        assert.equal(stopped, 1); assert.equal(actualStopped, 1); assert.equal(h.reg.executions.size, 0);
        assert.equal(job.stop, undefined); assert.equal(h.reg.jobAborts.size, 0);
        assert.equal(h.reg.totalStarted, 1); assert.equal(h.reg.killedCount, 1);
        assert.equal(readFileSync(job.logPath, "utf8"), "saved");
    } finally { resolve({ code: null, signal: "SIGTERM" }); await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("session batch: two actual sessions share one fixed first window", async t => {
    const h = harness(t);
    const second = add(h.reg, createRunningJob({ id: "m00000002", command: "second", pid: 0,
        logPath: h.logPath, kind: "monitor", toolCallId: "second" }));
    let sinks!: MonitorSinks;
    startMonitorSession({ reg: h.reg, job: second, description: "second watch",
        pi: { sendMessage(message: typeof h.sent[number]) { h.sent.push({ ...message, at: Date.now() }); } } as never,
        ctx: { ui: { setStatus() {}, setWidget() {}, theme: { fg: (_: string, text: string) => text } } } as never,
        createSource(s) { sinks = s; return { pid: 0, label: "second", exit: new Promise(() => {}), stop() {} }; },
    });
    t.after(() => terminateJobSilently(h.reg, second));
    h.emit("first source"); h.tick(100);
    const b = new MonitorBuffer(50, 200); b.addText("second source"); sinks.event(b.take(), Date.now());
    assert.equal(h.sent.length, 0, "first activity opens a bounded shared window");
    h.tick(99); assert.equal(h.sent.length, 0);
    h.tick(1); assert.equal(h.sent.length, 1);
    assert.match(h.sent[0]!.content, /first source/); assert.match(h.sent[0]!.content, /second source/);
});

test("actual session keeps absent/resumed order inside one short window and does not reset event silence on send", t => {
    const h = harness(t, {}, { wakeAbsentMs: 1000 });
    h.tick(1000); assert.equal(h.sent.length, 0);
    h.tick(100); h.emit("resumed event"); h.emit("more progress");
    h.tick(99); assert.equal(h.sent.length, 0); h.tick(1);
    assert.equal(h.sent.length, 1); assert.match(h.sent[0]!.content, /absent → resumed/);
    assert.equal(h.sent[0]!.details.monitor.state, "resumed");
    h.tick(899); assert.equal(h.sent.length, 1); h.tick(1); // lastActivity + 1000, not lastSubmission + 1000
    h.tick(200); assert.equal(h.sent.length, 2); assert.equal(h.sent[1]!.details.monitor.state, "absent");
});

test("inline attach completion consumes delayed terminal without notification or retry owner", async t => {
    const h = harness(t); h.emit("first"); h.tick(200); h.emit("pending");
    let jobs!: { execute(id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown): Promise<{ content: { text: string }[] }> };
    registerManagementFixture({ registerTool: (tool: typeof jobs) => { jobs = tool; } } as never, h.reg);
    const result = jobs.execute("attach", processInput({ action: "wait", task_id: h.job.id }), undefined, undefined, { ui: { notify() {} } });
    await h.end({ code: 0, signal: null }, "tail"); await result;
    assert.equal(h.job.outcomeSurfaced, true); assert.equal(h.reg.notificationRetries.size, 0);
    h.tick(200); h.tick(100000); assert.equal(h.sent.length, 1);
});

for (const error of [Object.create(null), { [inspect.custom]() { throw new Error("unsafe inspector"); }, toString() { throw new Error("unsafe conversion"); } }]) {
test("actual command session does not turn unstringifiable notification failure into source failure", async t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-unstringifiable-"));
    const reg = new BackgroundRegistry({ ...DEFAULTS, monitorFlushMs: 0 });
    const logPath = join(dir, "m.log");
    const job = add(reg, createRunningJob({ id: "m00000001", command: "watch", pid: 0, logPath, kind: "monitor", toolCallId: "sink" }));
    const out = new PassThrough(), err = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout: out, stderr: err, pid: 0 });
    const sent: string[] = [];
    let fail = true;
    try {
        startMonitorSession({ reg, job, description: "hostile sink error",
            pi: { sendMessage(message: { content: string }) { sent.push(message.content); if (fail) throw error; } } as never,
            ctx: { ui: { setStatus() {}, setWidget() {}, theme: { fg: (_: string, s: string) => s } } } as never,
            createSource(sinks) { return spawnCommandSource({ command: "watch", cwd: dir, logPath, sinks,
                limits: { maxLines: 50, maxChars: 200 }, spawnProcess: (() => child) as unknown as typeof spawn }); },
        });
        out.write("first stdout\n"); await Promise.resolve();
        assert.equal(job.status, "running"); assert.equal(job.notifyError, "Unknown notification error");
        assert.ok(!out.destroyed && !err.destroyed);
        fail = false; err.write("new stderr\n"); await Promise.resolve();
        assert.equal(job.status, "running"); assert.doesNotMatch(sent[1]!, /first stdout/);
        assert.equal(readFileSync(logPath, "utf8"), "first stdout\nnew stderr\n");
        child.emit("exit", 0, null); await Promise.resolve(); await Promise.resolve();
        assert.equal(job.status, "completed"); assert.equal(job.outcomeSurfaced, true);
        assert.equal(sent.length, 3); assert.equal(reg.jobAborts.size, 0);
        assert.ok(out.destroyed && err.destroyed);
    } finally {
        terminateJobSilently(reg, job); reg.monitorNotifications.dispose(); rmSync(dir, { recursive: true, force: true });
    }
});
}
