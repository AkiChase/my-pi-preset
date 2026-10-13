import { describe, it, before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundRegistry } from "../state.ts";
import { registerMonitorTool } from "../tools/monitor.ts";
import { spawnWithFileOutput } from "../spawn.ts";
import { openWsSource, isWsSupported } from "../monitor-ws.ts";
import { DEFAULTS } from "../config.ts";
import { terminateJobSilently } from "../lifecycle.ts";
import { EVENT } from "../types.ts";

const dir = join(tmpdir(), `pi-bg-monitor-${process.pid}`);
mkdirSync(dir, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CapturedTool {
    parameters?: { properties: Record<string, unknown> };
    execute: (
        toolCallId: string,
        params: unknown,
        signal: unknown,
        onUpdate: unknown,
        ctx: unknown
    ) => Promise<{ content: { type: "text"; text: string }[] }>;
}

function makeHarness() {
    const messages: { customType: string; details?: Record<string, unknown> }[] = [];
    let tool: CapturedTool | undefined;
    const pi = {
        registerTool(def: CapturedTool) {
            tool = def;
        },
        sendMessage(msg: { customType: string; details?: Record<string, unknown> }) {
            messages.push(msg);
        },
    };
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir });
    registerMonitorTool(pi as never, reg);
    const ctx = {
        cwd: process.cwd(),
        ui: {
            notify() {},
            setWidget() {},
            setStatus() {},
            theme: { fg: (_c: string, t: string) => t },
        },
    };
    return { tool: tool!, reg, ctx, messages, pi };
}

void describe("monitor tool — validation", () => {
    void it("rejects when neither command nor ws is given", async () => {
        const { tool, ctx } = makeHarness();
        await assert.rejects(
            () => tool.execute("t1", { description: "x" }, undefined, undefined, ctx),
            /needs a `command` or a `ws`/
        );
    });

    void it("rejects when both command and ws are given", async () => {
        const { tool, ctx } = makeHarness();
        await assert.rejects(
            () =>
                tool.execute(
                    "t2",
                    { command: "echo hi", ws: { url: "ws://x" }, description: "x" },
                    undefined,
                    undefined,
                    ctx
                ),
            /not both/
        );
    });

    void it("rejects a blank description", async () => {
        const { tool, ctx } = makeHarness();
        await assert.rejects(
            () => tool.execute("t3", { command: "echo hi", description: "   " }, undefined, undefined, ctx),
            /description` is required/
        );
    });
});

void describe("monitor tool — command lifecycle", () => {
    void it("short command folds live lines into one timely terminal notification", async () => {
        const { tool, ctx, messages } = makeHarness();
        const res = await tool.execute(
            "t4",
            { command: "printf 'line-A\\nline-B\\n'", description: "test stream" },
            undefined,
            undefined,
            ctx
        );
        assert.match(res.content[0].text, /Monitor m[0-9a-z]{8} started/);

        await sleep(300); // let the source exit + terminal notify

        // An exit inside the short window folds its lines into the terminal.
        assert.equal(messages.filter(m => m.customType === EVENT.monitorEvent).length, 0);
        const terminals = messages.filter((m) => m.customType === EVENT.taskNotification);
        assert.equal(terminals.length, 1, "exactly one terminal notification");
        const content = (terminals[0] as unknown as { content: string }).content;
        assert.match(content, /line-A\nline-B/);
        assert.ok(content.includes("· completed]"));
        assert.ok(content.includes(`Monitor "test stream" stream ended`));
    });
});

void describe("monitor — split spawn output", () => {
    void it("writes stdout and stderr to separate files when errPath is set", async () => {
        const logPath = join(dir, "split.log");
        const errPath = join(dir, "split.err");
        const r = spawnWithFileOutput({
            command: "echo OUT; echo ERR >&2",
            cwd: process.cwd(),
            logPath,
            errPath,
        });
        await r.exit;
        assert.match(readFileSync(logPath, "utf-8"), /OUT/);
        assert.doesNotMatch(readFileSync(logPath, "utf-8"), /ERR/);
        assert.match(readFileSync(errPath, "utf-8"), /ERR/);
    });
});

// --- WebSocket source (stubbed global WebSocket) -------------------------

class FakeWS {
    static instances: FakeWS[] = [];
    listeners: Record<string, ((ev: unknown) => void)[]> = {};
    url: string;
    protocols?: string[];
    constructor(url: string, protocols?: string[]) {
        this.url = url;
        this.protocols = protocols;
        FakeWS.instances.push(this);
    }
    addEventListener(type: string, cb: (ev: unknown) => void) {
        (this.listeners[type] ??= []).push(cb);
    }
    close() {
        this.dispatch("close", { code: 1000, reason: "" });
    }
    dispatch(type: string, ev: unknown) {
        for (const cb of this.listeners[type] ?? []) cb(ev);
    }
}

void describe("monitor — ws source mapping", () => {
    const original = (globalThis as { WebSocket?: unknown }).WebSocket;
    before(() => {
        (globalThis as { WebSocket?: unknown }).WebSocket = FakeWS as unknown;
    });
    after(() => {
        (globalThis as { WebSocket?: unknown }).WebSocket = original;
    });

    void it("appends text frames and a binary placeholder to the log", async () => {
        assert.ok(isWsSupported());
        const logPath = join(dir, "ws.log");
        const src = openWsSource({ url: "wss://example/feed" }, logPath, { event() {}, finishing() {}, final() {} }, { maxLines: 50, maxChars: 12000 });
        const ws = FakeWS.instances[FakeWS.instances.length - 1];

        ws.dispatch("message", { data: "hello" });
        ws.dispatch("message", { data: new ArrayBuffer(7) });
        ws.dispatch("message", { data: "world" });
        ws.dispatch("close", { code: 1000, reason: "" });

        await src.exit;
        const body = readFileSync(logPath, "utf-8");
        assert.match(body, /hello/);
        assert.match(body, /\[binary frame, 7 bytes\]/);
        assert.match(body, /world/);
        assert.match(body, /socket closed: code 1000/);
    });
});

after(() => {
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch {
        /* best-effort */
    }
});


for (const key of ["timeout_ms", "wake_absent_ms"] as const) {
    for (const value of [0, -1, NaN, Infinity]) {
        test(`AC11: ${key}=${value} rejected before WS construction or registry insertion`, async () => {
            const h = makeHarness(); const before = FakeWS.instances.length;
            await assert.rejects(() => h.tool.execute("invalid", { command: "echo must-not-run", description: "invalid", [key]: value },
                undefined, undefined, h.ctx), /finite positive/);
            assert.equal(h.reg.totalStarted, 0); assert.equal(h.reg.jobs.size, 0); assert.equal(FakeWS.instances.length, before);
        });
    }
}
test("AC16: tool schema has optional timeout/silence and no persistent", () => {
    const h = makeHarness(); const keys = h.tool.parameters!.properties;
    assert.ok("timeout_ms" in keys); assert.ok("wake_absent_ms" in keys); assert.ok(!("persistent" in keys));
});
test("source constructor failure rolls back started count and registry", async t => {
    const original = globalThis.WebSocket;
    globalThis.WebSocket = class { constructor() { throw new Error("constructor failed"); } } as unknown as typeof WebSocket;
    t.after(() => { globalThis.WebSocket = original; });
    const h = makeHarness();
    await assert.rejects(() => h.tool.execute("fail", { ws: { url: "ws://local.invalid" }, description: "x" }, undefined, undefined, h.ctx), /constructor failed/);
    assert.equal(h.reg.jobs.size, 0); assert.equal(h.reg.totalStarted, 0); assert.equal(h.reg.jobAborts.size, 0);
});
test("AC4/5/6/12/19: WS empty/multiline/omitted messages each reset activity; diagnostics and late messages don't recover", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
    const original = globalThis.WebSocket; globalThis.WebSocket = FakeWS as unknown as typeof WebSocket;
    t.after(() => { globalThis.WebSocket = original; t.mock.timers.reset(); });
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir, monitorMaxLinesPerEvent: 2, outputPreviewChars: 5 });
    const messages: { content: string; details: { monitor: { state: string } } }[] = [];
    let tool!: CapturedTool;
    registerMonitorTool({ registerTool(def: CapturedTool) { tool = def; }, sendMessage(m: typeof messages[number]) { messages.push(m); } } as never, reg);
    const ctx = makeHarness().ctx;
    await tool.execute("ws", { ws: { url: "ws://local.invalid" }, description: "ws activity", wake_absent_ms: 1000 }, undefined, undefined, ctx);
    const ws = FakeWS.instances.at(-1)!;
    ws.dispatch("message", { data: "" }); t.mock.timers.tick(200); assert.equal(messages.length, 1);
    for (let i = 0; i < 5; i++) { t.mock.timers.tick(i === 0 ? 700 : 900); ws.dispatch("message", { data: "abcdef\nmore\nlast" }); }
    assert.equal(messages.length, 1, "omitted and buffered events prevent silence");
    t.mock.timers.tick(1000); t.mock.timers.tick(200); assert.equal(messages[1]!.details.monitor.state, "absent");
    assert.match(messages[1]!.content, /notification omitted/);
    ws.dispatch("message", { data: "stderr is just text" }); t.mock.timers.tick(200); assert.equal(messages[2]!.details.monitor.state, "resumed");
    ws.dispatch("error", {}); ws.dispatch("message", { data: "late" }); ws.dispatch("close", { code: 1000, reason: "" });
    await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(200);
    assert.equal(messages.length, 4); assert.equal(messages[3]!.details.monitor.state, "failed");
    assert.match(messages[3]!.content, /WebSocket error/); assert.doesNotMatch(messages[3]!.content, /late/);
    t.mock.timers.tick(100000); assert.equal(messages.length, 4); assert.equal(reg.jobAborts.size, 0);
});

test("AC17/19: real stderr-only source exceeds shared log cap, stops with one combined terminal", async t => {
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir, maxLogBytes: 100, stallCheckIntervalMs: 20 });
    const sent: { customType: string; content: string }[] = [];
    let tool!: CapturedTool;
    registerMonitorTool({ registerTool(def: CapturedTool) { tool = def; }, sendMessage(m: typeof sent[number]) { sent.push(m); } } as never, reg);
    t.after(() => { for (const job of reg.jobs.values()) terminateJobSilently(reg, job); });
    await tool.execute("stderr-cap", { command: "while true; do printf 'stderr-output-0123456789\\n' >&2; sleep 0.01; done", description: "stderr cap" }, undefined, undefined, makeHarness().ctx);
    const job = [...reg.jobs.values()][0]!; await job.donePromise; await sleep(250);
    const terminals = sent.filter(m => m.customType === EVENT.taskNotification);
    assert.equal(terminals.length, 1); assert.match(terminals[0]!.content, /log size exceeded 100 bytes/);
    assert.ok(!sent.some(m => m.customType === EVENT.stall)); assert.equal(job.status, "killed");
    assert.match(readFileSync(job.logPath, "utf8"), /stderr-output/); assert.equal(reg.jobAborts.size, 0);
});

test("AC18: tool startup wiring failure closes WS/log fd and rolls back all runtime registration", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
    const original = globalThis.WebSocket;
    let closes = 0;
    globalThis.WebSocket = class extends FakeWS { override close() { closes++; super.close(); } } as unknown as typeof WebSocket;
    const closedFds: number[] = [], close = fs.closeSync;
    t.mock.method(fs, "closeSync", (fd: number) => { closedFds.push(fd); close(fd); }); syncBuiltinESMExports();
    t.after(() => { globalThis.WebSocket = original; t.mock.restoreAll(); syncBuiltinESMExports(); t.mock.timers.reset(); });
    const h = makeHarness();
    const publish = h.reg.changed.bind(h.reg);
    t.mock.method(h.reg, "changed", () => {
        publish();
        if ([...h.reg.jobs.values()].some(job => job.stop)) throw new Error("registry wiring failed");
    });
    await assert.rejects(() => h.tool.execute("ui-fail", { ws: { url: "ws://local.invalid" }, description: "ui failure",
        wake_absent_ms: 1000 }, undefined, undefined, h.ctx), /registry wiring failed/);
    assert.equal(closes, 1); assert.equal(closedFds.length, 1);
    assert.equal(h.reg.jobs.size, 0); assert.equal(h.reg.totalStarted, 0); assert.equal(h.reg.jobAborts.size, 0);
    const ws = FakeWS.instances.at(-1)!;
    ws.dispatch("message", { data: "late" }); ws.dispatch("error", {}); ws.dispatch("close", { code: 1000 });
    t.mock.timers.tick(100000); await Promise.resolve();
    assert.equal(h.messages.length, 0); assert.equal(closes, 1); assert.equal(closedFds.length, 1);
    assert.equal(h.reg.completedCount + h.reg.failedCount + h.reg.killedCount, 0);
});
