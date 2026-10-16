import assert from "node:assert/strict";
import { it } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { add, createRunningJob } from "../registry.ts";
import { ensureCompletionPromise, startBackgroundJob } from "../lifecycle.ts";
import { processExists } from "../spawn.ts";

import { processActivation, until } from "./process-harness.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ignoring = "trap '' TERM; printf READY; while true; do sleep 0.1; done";

void it("actual foreground abort escalates ignored TERM before host shutdown can be reached, preserving logs", { timeout: 10_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "process-actual-abort-"));
    const h = processActivation(dir);
    try {
        const ac = new AbortController();
        const pending = h.execute("bash", { command: ignoring }, ac.signal);
        const job = [...h.reg.jobs.values()][0]!;
        await until(() => readFileSync(job.logPath, "utf8").includes("READY"));
        const started = Date.now(); ac.abort();
        assert.equal(job.status, "killed");
        assert.equal(h.reg.executions.size, 1, "terminal result is NOT actual exit");
        await pending;
        assert.ok(Date.now() - started < 1_500);
        assert.equal(processExists(job.pid), false);
        await until(() => h.reg.executions.size === 0);
        assert.match(readFileSync(job.logPath, "utf8"), /READY/);
        assert.equal(h.messages.length, 0);
    } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

void it("shutdown stops fg/bg/command monitor/pending/attach and owned timers despite throwing UI; old tools reject", { timeout: 10_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "process-actual-close-"));
    const h = processActivation(dir);
    try {
        const foreground = h.execute("bash", { command: ignoring });
        await h.execute("bash", { run_in_background: true, command: ignoring });
        await h.execute("monitor", { command: "trap '' TERM; printf 'first\n'; printf 'pending\n'; while true; do sleep 0.1; done", description: "watch" });
        const jobs = [...h.reg.jobs.values()];
        await until(() => jobs.every((job) => readFileSync(job.logPath, "utf8").length > 0));
        const retrieval = h.execute("process_manage", { action: "wait", task_id: jobs[1]!.id });
        const pending = createRunningJob({ id: "pending", command: "pending", pid: 0, logPath: join(dir, "pending.log"), toolCallId: "pending" });
        pending.status = "pending"; ensureCompletionPromise(pending); add(h.reg, pending);
        const terminal = pending.donePromise!;
        const beforeMessages = h.messages.length;
        h.lifecycle.onClose(() => { throw new Error("optional panel sink failed"); });
        const closed = h.lifecycle.shutdown();
        assert.equal(h.lifecycle.shutdown(), closed);
        await Promise.all([closed, foreground, retrieval, terminal]);
        assert.ok(jobs.every((job) => job.status === "killed" && !processExists(job.pid)));
        assert.equal(pending.status, "killed");
        assert.equal(h.reg.executions.size, 0); assert.equal(h.reg.jobAborts.size, 0);
        assert.equal(h.reg.foreground.size, 0); assert.equal(h.coordinator.waitCount, 0);
        assert.equal(h.reg.sweepTimer, undefined); assert.equal(h.reg.sidebarTimer, undefined);
        assert.equal(h.reg.notificationRetries.size, 0); assert.equal(h.source.list().length, 0);
        await sleep(40); assert.equal(h.messages.length, beforeMessages, "silent stop must not flush monitor pending");
        for (const name of ["bash", "bash", "monitor", "process_manage"]) {
            const params = name === "monitor" ? { command: "echo late", description: "late" } : name === "process_manage" ? { action: "list" } : { command: "echo late" };
            if (name === "process_manage") assert.match((await h.execute(name, params)).content[0].text!, /closed/);
            else await assert.rejects(h.execute(name, params), /closed/);
        }
        for (const job of jobs) assert.ok(readFileSync(job.logPath, "utf8").length > 0);
    } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

void it("late actual exit changes neither next activation counts nor notices", async () => {
    const dir = mkdtempSync(join(tmpdir(), "process-late-exit-"));
    const old = processActivation(dir), fresh = processActivation(dir);
    let exit!: (result: { code: number; signal: null }) => void;
    const actual = new Promise<{ code: number; signal: null }>((resolve) => { exit = resolve; });
    const logPath = join(dir, "late.log"); writeFileSync(logPath, "saved");
    const job = add(old.reg, createRunningJob({ id: "late", command: "controlled", pid: 0, logPath, toolCallId: "late" }));
    startBackgroundJob({ reg: old.reg, pi: { sendMessage() { throw new Error("must not notify"); } } as unknown as ExtensionAPI,
        ctx: old.context, job, exit: actual });
    try {
        const closing = old.lifecycle.shutdown();
        await fresh.execute("bash", { command: "printf NEW" });
        const counts = [fresh.reg.totalStarted, fresh.reg.completedCount, fresh.messages.length];
        exit({ code: 0, signal: null }); await closing;
        assert.deepEqual([fresh.reg.totalStarted, fresh.reg.completedCount, fresh.messages.length], counts);
        assert.equal(old.reg.completedCount, 0); assert.equal(old.reg.killedCount, 1);
        assert.equal(readFileSync(logPath, "utf8"), "saved");
    } finally { exit({ code: 0, signal: null }); await old.lifecycle.shutdown(); await fresh.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

void it("TERM-killed group leader cannot strand its TERM-ignoring descendant", { timeout: 10_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "process-descendant-"));
    const h = processActivation(dir);
    try {
        // The leader accepts TERM, its descendant does not. Child writes its own PID.
        await h.execute("bash", { run_in_background: true, command: "bash -c 'trap \"\" TERM; echo $$ > child.pid; while true; do sleep 0.1; done' & wait" });
        const job = [...h.reg.jobs.values()][0]!;
        await until(() => {
            try { return Number(readFileSync(join(dir, "child.pid"), "utf8")) > 0; } catch { return false; }
        });
        const childPid = Number(readFileSync(join(dir, "child.pid"), "utf8"));
        assert.ok(processExists(childPid));
        await h.lifecycle.shutdown();
        await until(() => !processExists(childPid));
        assert.equal(processExists(job.pid), false);
    } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

void it("WS monitor silent shutdown closes its source and late socket frames cannot send or change next registry", async (t) => {
    class Socket {
        static instance: Socket;
        readonly listeners = new Map<string, ((event: unknown) => void)[]>();
        closes = 0;
        constructor() { Socket.instance = this; }
        addEventListener(name: string, callback: (event: unknown) => void) {
            const callbacks = this.listeners.get(name) ?? []; callbacks.push(callback); this.listeners.set(name, callbacks);
        }
        close() { this.closes++; }
        emit(name: string, event: unknown) { for (const callback of this.listeners.get(name) ?? []) callback(event); }
    }
    // Only the socket transport is fake; source/session/monitor tool are actual.
    const original = globalThis.WebSocket;
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    t.after(() => { globalThis.WebSocket = original; });
    const dir = mkdtempSync(join(tmpdir(), "process-ws-close-"));
    const h = processActivation(dir), fresh = processActivation(dir);
    try {
        await h.execute("monitor", { ws: { url: "ws://offline.test" }, description: "offline socket" });
        Socket.instance.emit("message", { data: "first" });
        Socket.instance.emit("message", { data: "pending" });
        const sent = h.messages.length;
        const logPath = [...h.reg.jobs.values()][0]!.logPath;
        await h.lifecycle.shutdown();
        assert.equal(Socket.instance.closes, 1);
        Socket.instance.emit("message", { data: "late" });
        Socket.instance.emit("close", { code: 1006, reason: "late" });
        assert.equal(h.messages.length, sent);
        assert.equal(h.reg.executions.size, 0);
        assert.equal(fresh.reg.totalStarted, 0); assert.equal(fresh.messages.length, 0);
        assert.doesNotMatch(readFileSync(logPath, "utf8"), /late/);
    } finally { await h.lifecycle.shutdown(); await fresh.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

void it("normal actual exit disarms escalation and a late stop cannot signal the released PID", async (t) => {
    const { spawnWithFileOutput } = await import("../spawn.ts");
    const dir = mkdtempSync(join(tmpdir(), "process-exit-identity-"));
    const child = spawnWithFileOutput({ command: "printf final", cwd: dir, logPath: join(dir, "out.log") });
    try {
        await child.execution.done;
        let signals = 0;
        t.mock.method(process, "kill", () => { signals++; return true; });
        child.execution.stop();
        await sleep(300);
        assert.equal(signals, 0, "released execution must never signal a potentially reused PID");
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

void it("throwing backend stop hook cannot prevent actual kill or sibling cleanup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "process-stop-throw-"));
    const h = processActivation(dir);
    try {
        await h.execute("bash", { run_in_background: true, command: "tail -f /dev/null" });
        await h.execute("bash", { run_in_background: true, command: "tail -f /dev/null" });
        const jobs = [...h.reg.jobs.values()];
        jobs[0]!.stop = () => { throw new Error("stop hook failure"); };
        await h.lifecycle.shutdown();
        assert.ok(jobs.every((job) => job.status === "killed" && !processExists(job.pid)));
        assert.equal(h.reg.executions.size, 0); assert.equal(h.reg.jobAborts.size, 0);
    } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

void it("reentrant add publication shutdown cancels monitor before opening a socket or log", async (t) => {
    class Socket {
        static opens = 0;
        constructor() { Socket.opens++; }
        addEventListener() {}
        close() {}
    }
    const original = globalThis.WebSocket;
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    t.after(() => { globalThis.WebSocket = original; });
    const errors: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => { errors.push(args); });
    const dir = mkdtempSync(join(tmpdir(), "monitor-reentrant-add-"));
    const h = processActivation(dir);
    let closing: Promise<void> | undefined;
    h.source.subscribe(() => { if (h.lifecycle.active) closing = h.lifecycle.shutdown(); });
    try {
        await assert.rejects(h.execute("monitor", { ws: { url: "ws://offline.test" }, description: "reentrant" }), /cancelled/);
        await closing;
        assert.equal(h.lifecycle.phase, "closed"); assert.equal(Socket.opens, 0);
        assert.equal(h.reg.totalStarted, 1); assert.equal(h.reg.killedCount, 1);
        const job = [...h.reg.jobs.values()][0]!;
        assert.equal(job.status, "killed"); assert.equal(job.stop, undefined);
        assert.equal(h.reg.executions.size, 0); assert.equal(h.reg.jobAborts.size, 0);
        assert.equal(h.reg.notificationRetries.size, 0); assert.equal(h.reg.foreground.size, 0);
        assert.equal(h.coordinator.waitCount, 0); assert.equal(h.coordinator.snapshot().length, 0);
        assert.equal(h.reg.sidebarTimer, undefined); assert.equal(h.reg.sweepTimer, undefined);
        assert.equal(h.messages.length, 0); assert.equal(errors.length, 0, "no cleanup timeout/errors");
        assert.equal(existsSync(job.logPath), false, "cancelled admission must not open a log");
    } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

for (const throws of [false, true]) {
    void it(`monitor tool setup publication shutdown${throws ? " then throw" : ""} preserves stopped metadata/counts and never reports started`, async t => {
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
        const dir = mkdtempSync(join(tmpdir(), "monitor-reentrant-tool-ui-"));
        const h = processActivation(dir);
        let closing: Promise<void> | undefined;
        const failure = new Error("UI failed after shutdown");
        const publish = h.reg.changed.bind(h.reg);
        t.mock.method(h.reg, "changed", () => {
            publish();
            // The backend no longer writes a footer. Reenter the actual wiring
            // publication after the source/stop owner exists, not initial add().
            if (closing || ![...h.reg.jobs.values()].some(job => job.stop)) return;
            closing = h.lifecycle.shutdown();
            if (throws) throw failure;
        });
        try {
            await assert.rejects(h.execute("monitor", { ws: { url: "ws://offline.test" }, description: "reentrant UI" }),
                throws ? failure : /cancelled/);
            await closing;
            const job = [...h.reg.jobs.values()][0]!;
            const saved = readFileSync(job.logPath);
            Socket.instance.emit("message", { data: "late" });
            assert.deepEqual(readFileSync(job.logPath), saved); assert.equal(Socket.instance.closes, 1);
            assert.equal(h.reg.totalStarted, 1); assert.equal(h.reg.killedCount, 1);
            assert.equal(h.reg.completedCount + h.reg.failedCount, 0); assert.equal(job.status, "killed");
            assert.equal(h.reg.executions.size, 0); assert.equal(h.reg.jobAborts.size, 0);
            assert.equal(h.coordinator.waitCount, 0); assert.equal(h.coordinator.snapshot().length, 0);
            assert.equal(h.reg.notificationRetries.size, 0); assert.equal(h.reg.foreground.size, 0);
            assert.equal(job.stop, undefined); assert.equal(job.donePromise, undefined); assert.equal(job.resolveDone, undefined);
            assert.equal(h.reg.sidebarTimer, undefined); assert.equal(h.reg.sweepTimer, undefined);
            assert.equal(h.messages.length, 0); assert.equal(errors.length, 0);
        } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
    });
}

void it("backend freeze retires its hint before stop hooks can reenter a late render", async () => {
    const { renderBackgroundHint, showBackgroundHint } = await import("../hint.ts");
    const dir = mkdtempSync(join(tmpdir(), "process-hint-freeze-"));
    const h = processActivation(dir);
    const writes: (readonly string[] | undefined)[] = [];
    let disposed = 0;
    h.reg.hintPublisher = { set(_ctx, lines) { writes.push(lines); return true; }, dispose() { disposed++; writes.push(undefined); } };
    const job = add(h.reg, createRunningJob({ id: "hint", command: "controlled", pid: 0, logPath: join(dir, "hint.log"), toolCallId: "hint", isBackgrounded: false }));
    h.reg.foreground.set("hint", { jobId: job.id, requestPause() {} });
    showBackgroundHint(h.reg, h.context, "hint");
    job.stop = () => { assert.equal(disposed, 1); renderBackgroundHint(h.reg, h.context); };
    try {
        await h.lifecycle.shutdown(); await h.lifecycle.shutdown();
        assert.equal(disposed, 1); assert.equal(writes.length, 2); assert.equal(writes.at(-1), undefined);
        assert.equal(h.reg.foreground.size, 0); assert.equal(h.reg.hintPublisher, undefined);
    } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
