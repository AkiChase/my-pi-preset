import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundRegistry } from "../state.ts";
import { add, createRunningJob } from "../registry.ts";
import { startMonitorSession } from "../monitor-session.ts";
import { terminateJobSilently } from "../lifecycle.ts";
import type { MonitorSource } from "../monitor-source.ts";
import type { SpawnExit } from "../spawn.ts";
import { EVENT, type UiContext } from "../types.ts";
import { DEFAULTS, type BgTasksConfig } from "../config.ts";

const dir = join(tmpdir(), `pi-bg-session-${process.pid}`);
mkdirSync(dir, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Msg {
    customType: string;
    content: string;
    details?: { terminal?: boolean };
}

function harness(logPath: string, config: BgTasksConfig = DEFAULTS) {
    const messages: Msg[] = [];
    const pi = { sendMessage: (m: Msg) => messages.push(m) };
    const ctx = {
        ui: { notify() {}, setWidget() {}, setStatus() {}, theme: { fg: (_c: string, t: string) => t } },
    } as unknown as UiContext;
    const reg = new BackgroundRegistry(config);

    let resolveExit!: (result: SpawnExit) => void;
    const exit = new Promise<SpawnExit>((res) => {
        resolveExit = res;
    });
    let stopped = false;
    const source: MonitorSource = {
        logPath,
        pid: 0,
        label: "fake",
        exit,
        stop: () => {
            stopped = true;
        },
    };

    const job = createRunningJob({
        id: `job-${process.pid}-1`,
        name: "watch", // production sets name: description (see tools/monitor.ts)
        command: source.label,
        pid: source.pid,
        logPath,
        toolCallId: "t",
        kind: "monitor",
    });
    add(reg, job);

    const start = (over?: { persistent?: boolean; timeoutMs?: number }) =>
        startMonitorSession({
            pi: pi as never,
            reg,
            ctx,
            job,
            source,
            description: "watch",
            persistent: over?.persistent ?? false,
            timeoutMs: over?.timeoutMs ?? 60_000,
        });

    // The terminal notice is its own <task-notification>, sent the moment the
    // source ends — no coalescing window, no flush to force.
    const terminals = () => messages.filter((m) => m.customType === EVENT.taskNotification);
    const allText = () => messages.map((m) => m.content).join("\n");

    return { messages, reg, job, start, resolveExit, isStopped: () => stopped, terminals, allText };
}

void describe("monitor-session — lifecycle via a fake source", () => {
    void it("streams lines and emits exactly one 'stream ended' terminal on clean exit", async () => {
        const logPath = join(dir, "ok.log");
        writeFileSync(logPath, "");
        const h = harness(logPath);
        h.start();
        appendFileSync(logPath, "line-A\nline-B\n");
        await sleep(40);
        h.resolveExit({ code: 0, signal: null });
        await sleep(60);

        assert.match(h.allText(), /line-A/);
        assert.match(h.allText(), /line-B/);
        assert.equal(h.terminals().length, 1);
        const xml = h.terminals()[0].content;
        assert.ok(xml.includes("· completed]"));
        assert.ok(xml.includes(`Monitor "watch" stream ended`));
        // Completion notification does not evict metadata before retention.
        assert.equal(h.reg.jobs.has(h.job.id), true);
        assert.equal(h.reg.completedCount, 1);
        assert.ok(h.job.endedAt);
    });

    void it("metadata reset aborts a persistent monitor without leaving a follower or buffered emit", async () => {
        const logPath = join(dir, "reset.log");
        writeFileSync(logPath, "");
        const h = harness(logPath, { ...DEFAULTS, monitorPollMs: 20, monitorFlushMs: 50 });
        h.start({ persistent: true });
        appendFileSync(logPath, "before-reset\n");
        await sleep(30);
        terminateJobSilently(h.reg, h.job);
        h.reg.jobs.clear();
        const messages = h.messages.length;
        appendFileSync(logPath, "after-reset\n");
        await sleep(70);
        h.resolveExit({ code: 1, signal: "SIGTERM" });
        await sleep(20);
        assert.equal(h.messages.length, messages);
        assert.equal(h.terminals().length, 0);
        assert.equal(h.reg.jobAborts.size, 0);
        assert.equal(h.isStopped(), true);
    });

    void it("maps a non-zero exit to a failure terminal", async () => {
        const logPath = join(dir, "fail.log");
        writeFileSync(logPath, "");
        const h = harness(logPath);
        h.start();
        h.resolveExit({ code: 1, signal: null });
        await sleep(60);
        assert.equal(h.terminals().length, 1);
        assert.ok(h.terminals()[0].content.includes("· failed]"));
        assert.ok(h.terminals()[0].content.includes(`Monitor "watch" failed (exit 1)`));
    });

    void it("maps a signal death to a 'stopped' terminal", async () => {
        const logPath = join(dir, "signal.log");
        writeFileSync(logPath, "");
        const h = harness(logPath);
        h.start();
        h.resolveExit({ code: null, signal: "SIGKILL" });
        await sleep(60);
        assert.equal(h.terminals().length, 1);
        assert.ok(h.terminals()[0].content.includes("· killed]"));
        assert.ok(h.terminals()[0].content.includes(`Monitor "watch" stopped`));
    });

    void it("emits the first lines at once, then coalesces the rest", async () => {
        // The leading edge is what keeps a slow watch readable live; the
        // trailing window is what stops a 1-line-per-second stream from
        // becoming one message per second for the whole watch.
        const logPath = join(dir, "throttle.log");
        writeFileSync(logPath, "");
        const h = harness(logPath, { ...DEFAULTS, monitorFlushMs: 300, monitorPollMs: 20 });
        h.start();

        appendFileSync(logPath, "first\n");
        await sleep(80); // well inside the flush window
        let stream = h.messages.filter((m) => m.customType === EVENT.monitorEvent);
        assert.equal(stream.length, 1, "leading edge went out without waiting");
        assert.match(stream[0]!.content, /first/);

        // Three more lines arrive spread across the window — upstream would
        // have sent three separate messages.
        appendFileSync(logPath, "second\n");
        await sleep(60);
        appendFileSync(logPath, "third\n");
        await sleep(60);
        appendFileSync(logPath, "fourth\n");
        stream = h.messages.filter((m) => m.customType === EVENT.monitorEvent);
        assert.equal(stream.length, 1, "nothing extra emitted inside the window");

        await sleep(400);
        stream = h.messages.filter((m) => m.customType === EVENT.monitorEvent);
        assert.equal(stream.length, 2, "one coalesced event for the window");
        assert.match(stream[1]!.content, /second\nthird\nfourth/);
    });

    void it("flushes buffered lines BEFORE the terminal notification", async () => {
        // The ordering trap: the buffer must be drained explicitly on the exit
        // path. Waiting for the throttle would put the last lines after
        // "stream ended", and the terminalEmitted guard would drop them.
        const logPath = join(dir, "flush-order.log");
        writeFileSync(logPath, "");
        const h = harness(logPath, { ...DEFAULTS, monitorFlushMs: 5_000, monitorPollMs: 20 });
        h.start();
        appendFileSync(logPath, "lead\n");
        await sleep(60);
        appendFileSync(logPath, "buffered-1\nbuffered-2\n");
        await sleep(60);
        h.resolveExit({ code: 0, signal: null });
        await sleep(120);

        const types = h.messages.map((m) => m.customType);
        const lastStream = types.lastIndexOf(EVENT.monitorEvent);
        const terminal = types.indexOf(EVENT.taskNotification);
        assert.ok(lastStream < terminal, "stream events precede the terminal");
        assert.match(h.allText(), /buffered-1\nbuffered-2/);
    });

    void it("suppresses a burst instead of killing the watch", async () => {
        // Upstream killed the monitor here — and killed it AFTER emitting the
        // whole overflowing batch, so one burst cost the full context AND the
        // watch. A burst is a burst; the output is on disk either way.
        const logPath = join(dir, "flood.log");
        writeFileSync(logPath, "");
        const h = harness(logPath, { ...DEFAULTS, monitorMaxLinesPerWindow: 100, monitorFlushMs: 20 });
        h.start();
        appendFileSync(logPath, Array.from({ length: 600 }, (_, i) => `e${i}`).join("\n") + "\n");
        await sleep(300);

        assert.equal(h.terminals().length, 0, "still running");
        assert.equal(h.job.status, "running");
        assert.ok(!h.isStopped(), "source untouched");
        assert.match(h.allText(), /more lines not shown — full output in/);
    });

    void it("caps one event's line count and folds the rest into the note", async () => {
        const logPath = join(dir, "cap.log");
        writeFileSync(logPath, "");
        const h = harness(logPath, { ...DEFAULTS, monitorMaxLinesPerEvent: 3, monitorFlushMs: 20 });
        h.start();
        appendFileSync(logPath, "a\nb\nc\nd\ne\n");
        await sleep(200);

        const stream = h.messages.filter((m) => m.customType === EVENT.monitorEvent);
        assert.equal(stream.length, 1, "one coalesced event, not one per line");
        assert.match(stream[0]!.content, /a\nb\nc\n\[2 more lines not shown/);
    });

    void it("kills only after sustained overflow", async () => {
        const logPath = join(dir, "sustained.log");
        writeFileSync(logPath, "");
        const h = harness(logPath, {
            ...DEFAULTS,
            monitorRateWindowMs: 30,
            monitorMaxLinesPerWindow: 5,
            monitorMaxOverflowWindows: 2,
            monitorFlushMs: 10,
            monitorPollMs: 20,
        });
        h.start();
        // Keep flooding across several rate windows — a filter that does not
        // work, which is the only case that deserves losing the watch.
        for (let i = 0; i < 8; i++) {
            appendFileSync(logPath, Array.from({ length: 20 }, (_, n) => `x${i}-${n}`).join("\n") + "\n");
            await sleep(40);
        }
        await sleep(60);

        assert.equal(h.terminals().length, 1, "exactly one terminal");
        assert.match(h.terminals()[0]!.content, /for \d+ windows — restart with a tighter filter/);
        assert.ok(h.isStopped(), "source.stop was called via the kill path");
        assert.equal(h.job.status, "killed");
    });

    void it("does not emit a second terminal after the source exits", async () => {
        const logPath = join(dir, "once.log");
        writeFileSync(logPath, "");
        const h = harness(logPath);
        h.start();
        h.resolveExit({ code: 0, signal: null });
        await sleep(60);
        h.resolveExit({ code: 1, signal: null }); // ignored — promise already settled
        await sleep(40);
        assert.equal(h.terminals().length, 1);
    });
});

process.on("exit", () => {
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch {
        /* best-effort */
    }
});
