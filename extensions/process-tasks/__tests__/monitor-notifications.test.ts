import { test, type TestContext } from "node:test";
import fs, { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { boundedMonitorBatch, monitorBatchPayload, monitorPayloadFits, MONITOR_NOTIFICATION_MAX_BYTES, newMonitorManifestPath, writeMonitorManifest, type MonitorBatchOverflow } from "../monitor-batch.ts";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { add, createRunningJob } from "../registry.ts";
import { MonitorBuffer } from "../monitor-buffer.ts";
import type { MonitorNotificationPayload } from "../notify.ts";
import type { MonitorBatchItem } from "../monitor-notifications.ts";
import { DELIVER_STEER } from "../types.ts";

function harness(t: TestContext, flush = 30_000, budget = 12000) {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    const dir = mkdtempSync(join(tmpdir(), "monitor-notifications-"));
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir, monitorFlushMs: flush, outputPreviewChars: budget });
    const jobs = ["one", "two", "three"].map(id => add(reg, createRunningJob({ id, command: id, kind: "monitor",
        pid: 0, logPath: `/tmp/${id}.log`, toolCallId: id })));
    const sent: { content: string; details: unknown; at: number; options: unknown; wireBytes: number }[] = [];
    let callback: (() => void) | undefined;
    const pi: Pick<ExtensionAPI, "sendMessage"> = { sendMessage(message, options) {
        sent.push({ content: String(message.content), details: message.details, at: Date.now(), options, wireBytes: Buffer.byteLength(JSON.stringify({ message, options })) }); callback?.();
    } };
    const enqueue = (index: number, text: string, state: MonitorNotificationPayload["state"] = "progress") => {
        const buffer = new MonitorBuffer(50, 12000); buffer.addText(text);
        reg.monitorNotifications.enqueue(pi, jobs[index]!, { state, description: jobs[index]!.id, preview: buffer.take() });
    };
    t.after(() => { reg.monitorNotifications.dispose(); t.mock.timers.reset(); rmSync(dir, { recursive: true, force: true }); });
    return { reg, jobs, sent, enqueue, tick: (ms: number) => t.mock.timers.tick(ms),
        callback: (fn?: () => void) => { callback = fn; } };
}
test("fixed first window, shared cadence, no trailing debounce or empty wake", t => {
    const h = harness(t); h.enqueue(0, "a"); h.tick(150); h.enqueue(1, "b"); h.tick(49);
    assert.equal(h.sent.length, 0); h.tick(1); assert.equal(h.sent.length, 1);
    assert.match(h.sent[0]!.content, /a/); assert.match(h.sent[0]!.content, /b/);
    assert.deepEqual(h.sent[0]!.options, DELIVER_STEER);
    h.enqueue(0, "next-a"); h.tick(29999); h.enqueue(1, "next-b"); h.tick(1);
    assert.equal(h.sent.length, 2); assert.equal(h.sent[1]!.at - h.sent[0]!.at, 30000);
    h.tick(60000); assert.equal(h.sent.length, 2);
    h.enqueue(2, "quiet"); h.tick(199); assert.equal(h.sent.length, 2); h.tick(1); assert.equal(h.sent.length, 3);
});
for (const f of [0, 1, 50, 199, 200]) test(`first window min(200,F), F=${f}`, t => {
    const h = harness(t, f); h.enqueue(0, "first");
    if (f > 0) { assert.equal(h.sent.length, 0); h.tick(f - 1); assert.equal(h.sent.length, 0); h.tick(1); }
    assert.equal(h.sent.length, 1); h.enqueue(1, "next"); h.tick(f); assert.equal(h.sent.length, 2);
});
test("timely refresh carries ordinary pending and restarts cadence; transitions preserved", t => {
    const h = harness(t); h.enqueue(0, "first"); h.tick(200);
    h.enqueue(0, "pending"); h.tick(1000); h.enqueue(1, "", "absent"); h.tick(100); h.enqueue(1, "back", "resumed");
    h.tick(99); assert.equal(h.sent.length, 1); h.tick(1); assert.equal(h.sent.length, 2);
    const items = (h.sent[1]!.details as { monitorBatch: MonitorBatchItem[] }).monitorBatch;
    assert.deepEqual(items[1]!.transitions, ["absent", "resumed"]);
    assert.match(h.sent[1]!.content, /pending/); assert.match(h.sent[1]!.content, /absent → resumed/);
    h.enqueue(0, "after timely"); h.tick(29999); assert.equal(h.sent.length, 2); h.tick(1); assert.equal(h.sent.length, 3);
});
test("terminal attach suppression does not block others; retry respects identity and consumption", t => {
    const h = harness(t); h.jobs[0]!.attachCount = 1;
    h.enqueue(0, "terminal", "completed"); h.enqueue(1, "active"); h.tick(200);
    assert.equal(h.sent.length, 1); assert.doesNotMatch(h.sent[0]!.content, /terminal/);
    assert.equal(h.jobs[0]!.outcomeSurfaced, undefined);
    h.jobs[0]!.status = "completed"; h.jobs[0]!.attachCount = 0;
    h.reg.notificationRetries.get("one")?.(); h.reg.notificationRetries.get("one")?.(); h.tick(200);
    assert.equal(h.sent.length, 2); assert.equal(h.jobs[0]!.outcomeSurfaced, true);
    h.reg.notificationRetries.get("one")?.(); h.tick(40000); assert.equal(h.sent.length, 2);
});
test("reentrant submission consumes only snapshot and commits shared next interval", t => {
    const h = harness(t); h.callback(() => { h.callback(); h.enqueue(0, "during send"); h.enqueue(1, "also new"); });
    h.enqueue(0, "snapshot"); h.tick(200); assert.equal(h.sent.length, 1);
    assert.doesNotMatch(h.sent[0]!.content, /during send/); h.tick(29999); assert.equal(h.sent.length, 1);
    h.tick(1); assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.content, /during send/);
    assert.doesNotMatch(h.sent[1]!.content, /snapshot/);
});
for (const action of ["cancel", "freeze", "reset"] as const) test(`${action} in send callback does not revive old pending`, t => {
    const h = harness(t); h.enqueue(0, "old"); h.enqueue(1, "old2");
    h.callback(() => { h.callback(); h.enqueue(2, "reentrant");
        if (action === "cancel") h.reg.monitorNotifications.cancel(h.jobs[2]!);
        else h.reg.monitorNotifications[action]();
    });
    h.tick(200); h.tick(100000); assert.equal(h.sent.length, 1);
    if (action === "reset") { h.enqueue(0, "fresh"); h.tick(200); assert.equal(h.sent.length, 2); }
});
test("unknown submission failures do not kill, replay progress or latch terminal; retry remains finite", t => {
    const h = harness(t); t.mock.method(console, "error", () => {});
    h.callback(() => { throw undefined; }); h.enqueue(0, "lost progress"); h.enqueue(1, "tail", "failed"); h.tick(200);
    assert.equal(h.jobs[0]!.status, "running"); assert.equal(h.jobs[1]!.outcomeSurfaced, undefined);
    assert.equal(h.jobs[1]!.notifyError, "undefined"); h.tick(100000); assert.equal(h.sent.length, 1);
    h.callback(); h.enqueue(0, "new event"); h.tick(200); assert.doesNotMatch(h.sent[1]!.content, /lost progress/);
    h.reg.notificationRetries.get("two")?.(); h.tick(200); assert.equal(h.sent.length, 3);
    assert.equal(h.jobs[1]!.outcomeSurfaced, true);
});
test("fair shared preview budget includes separators, same cropped payload in body/details and bounded metadata", t => {
    const h = harness(t, 30000, 12);
    h.enqueue(0, "ab"); h.enqueue(1, "12345678901234567890"); h.enqueue(2, "😀😀😀😀😀😀"); h.tick(200);
    const items = (h.sent[0]!.details as { monitorBatch: MonitorBatchItem[] }).monitorBatch;
    const total = items.reduce((n, item) => n + item.monitor.preview.lines.map(l => l.text).join("\n").length, 0);
    assert.ok(total <= 12); assert.equal(items[0]!.monitor.preview.lines[0]!.text, "ab");
    for (const item of items) {
        assert.ok(h.sent[0]!.content.includes(item.logPath)); assert.ok(h.sent[0]!.content.includes(item.jobId));
        assert.ok(h.sent[0]!.content.includes(item.monitor.preview.lines.map(l => l.text).join("\n")));
    }
    assert.match(h.sent[0]!.content, /notification omitted/);
    assert.ok(items[1]!.monitor.preview.omittedChars > 0); assert.ok(items[2]!.monitor.preview.omittedChars > 0);
});
test("huge flush delay chunks timers; terminal consumption/replacement cancel before delivery", t => {
    const h = harness(t, 2147483647 + 1000); h.enqueue(0, "first"); h.tick(200);
    h.enqueue(1, "pending"); h.tick(2147483647); assert.equal(h.sent.length, 1); h.tick(999); assert.equal(h.sent.length, 1);
    h.tick(1); assert.equal(h.sent.length, 2);
    h.enqueue(0, "consumed", "completed"); h.jobs[0]!.outcomeSurfaced = true;
    h.enqueue(1, "replaced", "failed"); h.reg.jobs.delete("two"); h.tick(200); assert.equal(h.sent.length, 2);
});
test("known finishing suspends pending until terminal rather than flushing ordinary preview", t => {
    const h = harness(t); h.enqueue(0, "pending"); h.reg.monitorNotifications.suspend(h.jobs[0]!); h.tick(1000);
    assert.equal(h.sent.length, 0); h.enqueue(0, "final", "completed"); h.tick(200);
    assert.equal(h.sent.length, 1); assert.match(h.sent[0]!.content, /pending\nfinal/);
});

test("natural terminal arriving during progress submission is not lost or double-consumed", t => {
    const h = harness(t); h.callback(() => { h.callback(); h.enqueue(0, "late tail", "completed"); h.jobs[0]!.status = "completed"; });
    h.enqueue(0, "progress snapshot"); h.tick(200);
    assert.equal(h.jobs[0]!.outcomeSurfaced, undefined); h.tick(200);
    assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.content, /late tail/);
    assert.equal(h.jobs[0]!.outcomeSurfaced, true); h.tick(40000); assert.equal(h.sent.length, 2);
});

test("transition metadata caps noisy short windows without losing terminal; reset releases held retries", t => {
    const h = harness(t); h.jobs[0]!.attachCount = 1;
    for (let i = 0; i < 20; i++) h.enqueue(0, "", i % 2 ? "resumed" : "absent");
    h.enqueue(0, "final", "completed"); h.tick(200); assert.equal(h.sent.length, 0);
    h.jobs[0]!.attachCount = 0; h.reg.notificationRetries.get("one")?.(); h.tick(200);
    const detail = h.sent[0]!.details as { transitions: string[]; omittedTransitions: number; monitor: { state: string } };
    assert.equal(detail.transitions.length, 16); assert.equal(detail.omittedTransitions, 5);
    assert.equal(detail.monitor.state, "completed");
    h.jobs[1]!.attachCount = 1; h.enqueue(1, "held", "failed"); h.tick(200);
    assert.ok(h.reg.notificationRetries.has("two")); h.reg.monitorNotifications.reset();
    assert.equal(h.reg.notificationRetries.size, 0);
});

test("zero preview budget keeps identities and terminal state while long metadata stays bounded", t => {
    const h = harness(t, 30000, 0);
    const buffer = new MonitorBuffer(50, 12000); buffer.addText("😀 output\nsecond line");
    for (const job of h.jobs.slice(0, 2)) h.reg.monitorNotifications.enqueue({ sendMessage(message, options) {
        h.sent.push({ content: String(message.content), details: message.details, at: Date.now(), options, wireBytes: Buffer.byteLength(JSON.stringify({ message, options })) });
    } }, job, { state: "failed", description: "d".repeat(2000), note: "n".repeat(2000), preview: buffer.take() }, "s".repeat(2000));
    h.tick(200);
    const items = (h.sent[0]!.details as { monitorBatch: MonitorBatchItem[] }).monitorBatch;
    assert.equal(items.length, 2);
    for (const item of items) {
        assert.equal(item.monitor.description.length, 160); assert.equal(item.monitor.note!.length, 512);
        assert.equal(item.summary!.length, 512); assert.equal(item.monitor.state, "failed");
        assert.equal(item.monitor.preview.lines.map(l => l.text).join("\n").length, 0);
        assert.ok(h.sent[0]!.content.includes(item.jobId)); assert.ok(h.sent[0]!.content.includes(item.logPath));
    }
    assert.match(h.sent[0]!.content, /notification omitted/);
});

test("reset during decision callback schedules the new epoch without submitting the old snapshot", t => {
    const h = harness(t);
    h.reg.monitorNotifications.observe(h.jobs[0]!, () => {
        h.reg.monitorNotifications.reset();
        h.enqueue(1, "new epoch");
    });
    h.enqueue(0, "stale snapshot"); h.tick(200);
    assert.equal(h.sent.length, 0); h.tick(200);
    assert.equal(h.sent.length, 1); assert.match(h.sent[0]!.content, /new epoch/);
    assert.doesNotMatch(h.sent[0]!.content, /stale snapshot/);
});

for (const error of [Object.create(null), { toString() { throw new Error("unsafe conversion"); } }]) {
    test("unstringifiable submission error cannot escape notification isolation", t => {
        const h = harness(t, 0); t.mock.method(console, "error", () => {});
        h.callback(() => { throw error; });
        assert.doesNotThrow(() => h.enqueue(0, "first"));
        assert.equal(h.jobs[0]!.status, "running");
        assert.equal(h.jobs[0]!.notifyError, "Unknown notification error");
        h.callback(); h.enqueue(0, "new event");
        assert.equal(h.sent.length, 2); assert.doesNotMatch(h.sent[1]!.content, /first/);
    });
}

test("throwing error inspector cannot escape isolation or lose the next event", t => {
    const h = harness(t, 0);
    const error = { [inspect.custom]() { throw new Error("unsafe inspector"); } };
    h.callback(() => { throw error; });
    assert.doesNotThrow(() => h.enqueue(0, "first"));
    assert.equal(h.jobs[0]!.status, "running");
    assert.equal(h.jobs[0]!.notifyError, "[object Object]");
    h.callback(); h.enqueue(0, "next");
    assert.equal(h.sent.length, 2); assert.doesNotMatch(h.sent[1]!.content, /first/);
});

test("exactly fitting ordinary batch is not rejected by overflow preselection", () => {
    const items: MonitorBatchItem[] = ["a", "b"].map(jobId => ({ jobId, logPath: "x".repeat(15938),
        monitor: { state: "completed", description: "d", preview: { lines: [], omittedLines: 0, omittedChars: 0, truncatedLines: 0 } },
        transitions: ["completed"], omittedTransitions: 0 }));
    const ordinary = monitorBatchPayload(items);
    assert.ok(monitorPayloadFits(ordinary));
    const bounded = boundedMonitorBatch(items, items.length);
    assert.equal(bounded.items.length, items.length);
    assert.deepEqual(bounded.payload, ordinary);
});

test("reset and enqueue inside host send preserves fresh cadence and does not commit old terminal latch", t => {
    const h = harness(t);
    h.callback(() => {
        h.callback(); h.reg.monitorNotifications.reset();
        h.enqueue(1, "fresh inside send");
    });
    h.enqueue(0, "old terminal", "completed"); h.tick(200);
    assert.equal(h.sent.length, 1); assert.equal(h.jobs[0]!.outcomeSurfaced, undefined);
    h.tick(199); assert.equal(h.sent.length, 1); h.tick(1);
    assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.content, /fresh inside send/);
    assert.equal(h.reg.notificationRetries.size, 0); h.tick(100000); assert.equal(h.sent.length, 2);
});

function manyTerminals(h: ReturnType<typeof harness>, count = 1500, onSend?: () => void) {
    const jobs = [];
    for (let i = 0; i < count; i++) {
        const job = add(h.reg, createRunningJob({ id: `terminal-${i}`, toolCallId: `terminal-${i}`, kind: "monitor", pid: 0,
            command: `source ${i}`, logPath: join(h.reg.config.logDir, `${i}.log`) }));
        writeFileSync(job.logPath, `original output ${i}`);
        const preview = new MonitorBuffer(50, 12000); preview.addText("😀\u0001".repeat(800));
        const enqueue = (state: MonitorNotificationPayload["state"]) => h.reg.monitorNotifications.enqueue({ sendMessage(m, options) {
            h.sent.push({ content: String(m.content), details: m.details, at: Date.now(), options, wireBytes: Buffer.byteLength(JSON.stringify({ message: m, options })) }); onSend?.();
        } }, job, { state, description: `original description ${i} ` + "d".repeat(2000), preview: preview.take() }, `complete summary ${i} ` + "s".repeat(800));
        enqueue("absent"); enqueue("resumed"); enqueue("completed"); job.status = "completed";
        jobs.push(job);
    }
    return jobs;
}
test("thousands of retained terminal sources: one hard-bounded wire payload, complete original manifest, consumption and log retention", t => {
    const h = harness(t, 30000, 12000); const jobs = manyTerminals(h);
    h.tick(200); assert.equal(h.sent.length, 1);
    const message = h.sent[0]!;
    assert.ok(Buffer.byteLength(JSON.stringify({ content: message.content, details: message.details }), "utf8") <= MONITOR_NOTIFICATION_MAX_BYTES - 1024);
    assert.ok(message.wireBytes <= MONITOR_NOTIFICATION_MAX_BYTES);
    const details = message.details as { monitorBatch: MonitorBatchItem[]; monitorBatchOverflow: MonitorBatchOverflow };
    const overflow = details.monitorBatchOverflow;
    assert.equal(overflow.sourceCount, 1500); assert.equal(overflow.omittedSources, 1500 - details.monitorBatch.length);
    assert.ok(overflow.omittedSources > 1400); assert.match(message.content, /sources omitted inline/);
    assert.ok(message.content.includes(overflow.manifestPath!));
    const rows = readFileSync(overflow.manifestPath!, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(rows.length, 1501);
    for (const [i, job] of jobs.entries()) {
        const row = rows[i + 1]; assert.equal(row.jobId, job.id); assert.equal(row.logPath, job.logPath);
        assert.equal(row.state, "completed"); assert.deepEqual(row.transitions, ["absent", "resumed", "completed"]);
        assert.equal(row.description, `original description ${i} ` + "d".repeat(2000));
        assert.equal(row.summary, `complete summary ${i} ` + "s".repeat(800)); assert.equal(row.preview, undefined);
        assert.equal(readFileSync(row.logPath, "utf8"), `original output ${i}`); assert.equal(job.outcomeSurfaced, true);
    }
    assert.equal(h.reg.notificationRetries.size, 0); h.tick(100000); assert.equal(h.sent.length, 1);
    h.reg.monitorNotifications.dispose(); assert.equal(readFileSync(overflow.manifestPath!, "utf8").trim().split("\n").length, 1501);
});

test("exclusive chunked manifest writes handle partial writes, failure cleanup and close ownership without fd leaks", t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-manifest-io-"));
    const path = newMonitorManifestPath(dir);
    const row = { jobId: "one", logPath: "/tmp/one", state: "failed", description: "😀\n".repeat(10000), transitions: ["failed"], omittedTransitions: 0 };
    const realWrite = fs.writeSync; const realClose = fs.closeSync;
    const sizes: number[] = []; const closes: number[] = [];
    try {
        const write = t.mock.method(fs, "writeSync", (fd: number, bytes: Uint8Array, offset: number, length: number) => {
            sizes.push(length); return realWrite(fd, bytes, offset, Math.min(length, 43));
        });
        const close = t.mock.method(fs, "closeSync", (fd: number) => { closes.push(fd); realClose(fd); });
        syncBuiltinESMExports(); writeMonitorManifest(path, [row], 1, 0);
        assert.equal(closes.length, 1); assert.ok(Math.max(...sizes) < 20000);
        assert.equal(JSON.parse(readFileSync(path, "utf8").trim().split("\n")[1]!).description, row.description);
        const before = readFileSync(path, "utf8");
        assert.throws(() => writeMonitorManifest(path, [row], 1, 0), /EEXIST/); assert.equal(readFileSync(path, "utf8"), before);
        write.mock.restore(); close.mock.restore(); syncBuiltinESMExports();
        const failed = newMonitorManifestPath(dir); let ownedFd = -1;
        const failing = t.mock.method(fs, "writeSync", (fd: number) => { ownedFd = fd; throw new Error("disk failure"); });
        syncBuiltinESMExports(); assert.throws(() => writeMonitorManifest(failed, [row], 1, 0), /disk failure/);
        failing.mock.restore(); syncBuiltinESMExports();
        assert.deepEqual(readdirSync(dir), [path.split("/").at(-1)]);
        assert.throws(() => fs.fstatSync(ownedFd), /EBADF/);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); }
});

test("manifest failure sends one bounded truthful hint; unsaved omitted terminal stays unconsumed with no automatic retry", t => {
    const h = harness(t); const jobs = manyTerminals(h, 400); t.mock.method(console, "error", () => {});
    const blocker = join(h.reg.config.logDir, "not-directory"); writeFileSync(blocker, "x"); h.reg.config.logDir = blocker;
    h.tick(200); assert.equal(h.sent.length, 1);
    const details = h.sent[0]!.details as { monitorBatch: MonitorBatchItem[]; monitorBatchOverflow: MonitorBatchOverflow };
    assert.equal(details.monitorBatchOverflow.manifestPath, undefined); assert.match(h.sent[0]!.content, /manifest unavailable/);
    assert.ok(Buffer.byteLength(JSON.stringify({ content: h.sent[0]!.content, details }), "utf8") <= MONITOR_NOTIFICATION_MAX_BYTES - 1024);
    assert.ok(h.sent[0]!.wireBytes <= MONITOR_NOTIFICATION_MAX_BYTES);
    for (const job of jobs.slice(details.monitorBatch.length)) { assert.equal(job.outcomeSurfaced, undefined); assert.match(job.notifyError!, /manifest failed/); }
    h.tick(100000); assert.equal(h.sent.length, 1);
    assert.ok(h.reg.notificationRetries.size > 0); h.reg.monitorNotifications.reset(); assert.equal(h.reg.notificationRetries.size, 0);
});

test("unrepresentable log/manifest paths never overflow the cap or advertise a truncated path", t => {
    const h = harness(t); t.mock.method(console, "error", () => {}); h.reg.config.logDir = "/" + "x".repeat(100000);
    h.jobs[0]!.logPath = h.reg.config.logDir + "/original.log";
    h.enqueue(0, "terminal", "failed"); h.tick(200);
    const message = h.sent[0]!; const details = message.details as { monitorBatch: MonitorBatchItem[]; monitorBatchOverflow: MonitorBatchOverflow };
    assert.equal(details.monitorBatch.length, 0); assert.equal(details.monitorBatchOverflow.manifestPath, undefined);
    assert.equal(h.jobs[0]!.outcomeSurfaced, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify({ content: message.content, details }), "utf8") <= MONITOR_NOTIFICATION_MAX_BYTES - 1024);
    assert.ok(message.wireBytes <= MONITOR_NOTIFICATION_MAX_BYTES);
    assert.doesNotMatch(message.content, /x{100}/);
    assert.throws(() => boundedMonitorBatch([], 1, { manifestPath: h.reg.config.logDir }), /path exceeds/);
});

test("manifest identity is registry and epoch independent; reset/dispose never deletes another batch", t => {
    const h = harness(t); manyTerminals(h, 400); h.tick(200);
    const first = (h.sent[0]!.details as { monitorBatchOverflow: MonitorBatchOverflow }).monitorBatchOverflow.manifestPath!;
    h.reg.monitorNotifications.reset(); h.reg.jobs.clear(); manyTerminals(h, 400); h.tick(200);
    const second = (h.sent[1]!.details as { monitorBatchOverflow: MonitorBatchOverflow }).monitorBatchOverflow.manifestPath!;
    assert.notEqual(first, second); assert.equal(readFileSync(first, "utf8").trim().split("\n").length, 401);
    assert.equal(readFileSync(second, "utf8").trim().split("\n").length, 401);
    const paths = new Set(Array.from({ length: 100 }, () => newMonitorManifestPath(h.reg.config.logDir)));
    assert.equal(paths.size, 100);
});

test("successful manifest but failed host submission preserves file and every terminal retrieval latch without auto replay", t => {
    const h = harness(t); t.mock.method(console, "error", () => {});
    manyTerminals(h, 400, () => { throw Object.create(null); });
    h.tick(200); assert.equal(h.sent.length, 1);
    const path = (h.sent[0]!.details as { monitorBatchOverflow: MonitorBatchOverflow }).monitorBatchOverflow.manifestPath!;
    assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 401);
    for (const job of h.reg.jobs.values()) if (job.id.startsWith("terminal-")) {
        assert.equal(job.outcomeSurfaced, undefined); assert.equal(job.notifyError, "Unknown notification error");
    }
    assert.equal(h.reg.notificationRetries.size, 400); h.tick(100000); assert.equal(h.sent.length, 1);
    h.reg.monitorNotifications.dispose(); assert.equal(h.reg.notificationRetries.size, 0);
    assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 401);
});

test("hard wire cap remains independent of huge preview budgets and JSON-escaped multibyte content", t => {
    const h = harness(t, 30000, 2_000_000);
    const preview = new MonitorBuffer(50, 2_000_000); preview.addText("😀\u0001".repeat(200000));
    h.reg.monitorNotifications.enqueue({ sendMessage(m, options) {
        h.sent.push({ content: String(m.content), details: m.details, at: Date.now(), options, wireBytes: Buffer.byteLength(JSON.stringify({ message: m, options })) });
    } }, h.jobs[0]!, { state: "progress", description: "large preview", preview: preview.take() });
    h.tick(200); assert.equal(h.sent.length, 1);
    const message = h.sent[0]!;
    assert.ok(Buffer.byteLength(JSON.stringify({ content: message.content, details: message.details }), "utf8") <= MONITOR_NOTIFICATION_MAX_BYTES - 1024);
    assert.ok(message.wireBytes <= MONITOR_NOTIFICATION_MAX_BYTES);
    // A source can move wholly to the manifest instead of violating the hard cap;
    // the original log remains the output query path, never a hidden full preview.
    const details = message.details as { monitorBatch: MonitorBatchItem[]; monitorBatchOverflow: MonitorBatchOverflow };
    assert.equal(details.monitorBatchOverflow.sourceCount, 1);
    assert.ok(readFileSync(details.monitorBatchOverflow.manifestPath!, "utf8").includes(h.jobs[0]!.logPath));
});

test("manifest JSON chunks preserve lone surrogates, escapes and pairs across boundaries", t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-manifest-unicode-"));
    try {
        const description = "x".repeat(4095) + "😀" + "\ud800" + "\udc00" + "\ud800!\udc00" + "\\\"\n\u0000";
        const row = { jobId: "one", logPath: "/tmp/one", state: "failed", description,
            transitions: ["absent", "failed"], omittedTransitions: 0, note: description.repeat(3), silenceMs: 23, toolUseId: "call" };
        const path = newMonitorManifestPath(dir);
        writeMonitorManifest(path, [row], 1, 0);
        const text = readFileSync(path, "utf8").trim().split("\n")[1]!;
        assert.equal(text, JSON.stringify(row)); assert.deepEqual(JSON.parse(text), row);
        assert.equal(fs.statSync(path).mode & 0o777, 0o600);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const mode of ["zero write", "close before", "close after"] as const) test(`manifest ${mode} failure clears its partial file and closes the owned fd`, t => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-manifest-close-"));
    const path = newMonitorManifestPath(dir);
    const realClose = fs.closeSync; const realWrite = fs.writeSync;
    let ownedFd = -1; let failed = false;
    try {
        t.mock.method(fs, "writeSync", (fd: number, bytes: Uint8Array, offset: number, length: number) => {
            ownedFd = fd;
            return mode === "zero write" ? 0 : realWrite(fd, bytes, offset, length);
        });
        t.mock.method(fs, "closeSync", (fd: number) => {
            if (!failed && mode !== "zero write") {
                failed = true;
                if (mode === "close after") realClose(fd);
                throw new Error("close failed");
            }
            realClose(fd);
        });
        syncBuiltinESMExports();
        assert.throws(() => writeMonitorManifest(path, [], 0, 0), /Short monitor|close failed/);
        assert.equal(fs.existsSync(path), false);
        assert.throws(() => fs.fstatSync(ownedFd), /EBADF/);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); }
});

test("failed manifest omitted outcome remains available to explicit retrieval retry, with original metadata", t => {
    const h = harness(t); const jobs = manyTerminals(h, 400); t.mock.method(console, "error", () => {});
    const logDir = h.reg.config.logDir; h.reg.config.logDir += "\u0000malformed";
    h.tick(200); assert.equal(h.sent.length, 1);
    const failed = h.sent[0]!.details as { monitorBatch: MonitorBatchItem[]; monitorBatchOverflow: MonitorBatchOverflow };
    assert.equal(failed.monitorBatchOverflow.manifestPath, undefined);
    const job = jobs[failed.monitorBatch.length]!;
    assert.equal(job.outcomeSurfaced, undefined); assert.ok(h.reg.notificationRetries.has(job.id));
    h.tick(100000); assert.equal(h.sent.length, 1);
    h.reg.config.logDir = logDir;
    h.reg.notificationRetries.get(job.id)?.(); h.reg.notificationRetries.get(job.id)?.(); h.tick(200);
    assert.equal(h.sent.length, 2); assert.equal(job.outcomeSurfaced, true);
    assert.equal(job.notifyError, undefined); assert.ok(!h.reg.notificationRetries.has(job.id));
    assert.match(h.sent[1]!.content, new RegExp(job.id));
    assert.match(h.sent[1]!.content, /absent → resumed → completed/);
    assert.ok(h.sent[1]!.content.includes(job.logPath));
});
