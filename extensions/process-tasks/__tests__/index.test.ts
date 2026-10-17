import { processInput } from "../../runtime-tasks/__tests__/process-input.ts";
import { registerManagementTool } from "../../runtime-tasks/tools.ts";
import { EventEmitter } from "node:events";
import registerWidgetDisplay from "../../shared/widget-display/owner.ts";
import { createRuntimeTaskFacade, type RuntimeTaskCapability } from "../../runtime-tasks/facade.ts";
/**
 * index.ts session lifecycle — Claude Code parity:
 *   - the registry is born empty on session_start (no persistence, no revival;
 *     a stale `background-tasks-state` entry is never consulted)
 *   - session_shutdown kills ALL running tasks on ANY reason, not just "quit",
 *     and appends no state snapshot
 */

import { describe, it, after, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import extension from "../index.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { EVENT } from "../types.ts";
import type { PathLike, OpenMode, Mode } from "node:fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A process marker unique to this test run, so pgrep can't hit strangers. */
const MARKER = `pi-bg-shutdown-test-${process.pid}`;
const WATCH_CMD = `while true; do sleep 1; done # ${MARKER}`;

/** Count live processes whose command line carries our marker. The `[w]hile`
 *  trick keeps the pgrep shell's own cmdline from matching itself. */
function liveMarkedProcesses(): number {
    try {
        const out = execSync(
            `pgrep -f "[w]hile true; do sleep 1; done # ${MARKER}" | wc -l`,
            { encoding: "utf-8" }
        );
        return Number.parseInt(out.trim(), 10);
    } catch {
        return 0;
    }
}

interface CapturedTool {
    name: string;
    execute: (
        toolCallId: string,
        params: unknown,
        signal: unknown,
        onUpdate: unknown,
        ctx: unknown
    ) => Promise<{ content: { type: "text"; text: string }[] }>;
}

type SessionHandler = (event: { reason?: string }, ctx: unknown) => Promise<void>;

function makePi() {
    const tools = new Map<string, CapturedTool>();
    const handlers = new Map<string, SessionHandler>();
    const messages: { customType: string }[] = [];
    const appendedEntries: unknown[] = [];
    const renderers = new Map<string, (message: unknown, options: unknown, theme: unknown) => { render: (width: number) => string[] }>();
    const bus = new EventEmitter();
    const pi = {
        events: { on(name: string, handler: (data: unknown) => void) { bus.on(name, handler); return () => { bus.off(name, handler); }; }, emit(name: string, data: unknown) { bus.emit(name, data); } },
        registerTool(def: CapturedTool) {
            tools.set(def.name, def);
        },
        registerShortcut() {},
        registerCommand() {},
        registerMessageRenderer(name: string, renderer: (message: unknown, options: unknown, theme: unknown) => { render: (width: number) => string[] }) { renderers.set(name, renderer); },
        on(event: string, handler: SessionHandler) {
            const previous = handlers.get(event);
            handlers.set(event, (value, ctx) => { const old = previous?.(value, ctx); const next = handler(value, ctx); return Promise.all([old, next]).then(() => {}); });
            return () => {};
        },
        sendMessage(msg: { customType: string }) {
            messages.push(msg);
        },
        appendEntry(_customType: string, data: unknown) {
            appendedEntries.push(data);
        },
    };
    return { pi, tools, handlers, messages, appendedEntries, renderers };
}

const uiCtx = {
    cwd: process.cwd(),
    hasUI: false, mode: "print", sessionManager: { getSessionId: () => "fixture" },
    ui: {
        notify() {},
        setWidget() {},
        setStatus() {},
        theme: { fg: (_c: string, t: string) => t },
    },
};

function startExtension() {
    const h = makePi();
    const capabilities: RuntimeTaskCapability[] = [];
    registerWidgetDisplay(h.pi as never);
    const backend = extension(h.pi as never, { onManagement: c => capabilities.push(c) });
    const facade = createRuntimeTaskFacade(capabilities);
    backend.lifecycle.onClose(facade.close);
    const registered = registerManagementTool(h.pi as never, "process", capabilities);
    backend.lifecycle.onClose(registered.close);
    return { ...h, backend };
}

void describe("session_start — registry is born empty (no revival)", () => {
    void it("ignores a stale persisted state entry entirely", async () => {
        const h = startExtension();
        // If session_start still tried to restore state, it would consult the
        // session manager — make that throw to prove it's never touched.
        const ctx = {
            hasUI: false, mode: "print",
            sessionManager: {
                getSessionId: () => "fixture",
                getEntries(): never {
                    throw new Error("session entries must not be consulted");
                },
            },
        };
        await h.handlers.get("session_start")!({}, ctx);

        const jobs = h.tools.get("process_manage")!;
        const res = await jobs.execute("t1", processInput({ action: "list" }), undefined, undefined, uiCtx);
        assert.equal(res.content[0].text, "No runtime tasks in this scope.");
        assert.equal(h.appendedEntries.length, 0, "no state snapshot is written");
    });
    void it("session replacement stops old tasks and starts an empty registry", async () => {
        const h = startExtension();
        await h.handlers.get("session_start")!({}, uiCtx);
        const bash = h.tools.get("bash")!;
        await bash.execute("switch-test", { command: WATCH_CMD, run_in_background: true }, undefined, undefined, uiCtx);
        assert.ok(liveMarkedProcesses() > 0);
        await h.handlers.get("session_start")!({ reason: "new" }, uiCtx);
        await sleep(200);
        const list = await h.tools.get("process_manage")!.execute("new-list", processInput({ action: "list" }), undefined, undefined, uiCtx);
        assert.equal(list.content[0].text, "No runtime tasks in this scope.");
        assert.equal(liveMarkedProcesses(), 0);
        assert.equal(h.messages.filter((m) => m.customType === EVENT.taskNotification).length, 0);
        await h.handlers.get("session_shutdown")!({}, uiCtx);
    });
});

void describe("session_shutdown — kills running tasks on ANY reason", () => {
    for (const reason of ["quit", "reload"]) {
        void it(`reason "${reason}" kills running tasks silently`, async () => {
            const h = startExtension();
            await h.handlers.get("session_start")!({}, uiCtx);

            // Start a real long-running background task.
            const bash = h.tools.get("bash")!;
            const started = await bash.execute(
                "t2",
                { command: WATCH_CMD, run_in_background: true },
                undefined,
                undefined,
                uiCtx
            );
            const id = /with ID: (\w+)\./.exec(started.content[0].text)?.[1];
            assert.ok(id && /^b[0-9a-z]{8}$/.test(id), `typed shell id, got: ${id}`);
            assert.ok(liveMarkedProcesses() > 0, "task process is running");

            await h.handlers.get("session_shutdown")!({ reason }, uiCtx);
            await sleep(200); // let the SIGTERM land

            const jobs = h.tools.get("process_manage")!;
            assert.match((await jobs.execute("t3", processInput({ action: "list" }), undefined, undefined, uiCtx)).content[0].text, /activation is closed/);
            assert.equal(h.backend.source.list().length, 0, "disposed source no longer exposes runtime rows");
            assert.equal(liveMarkedProcesses(), 0, "no orphaned process survives");
            assert.equal(
                h.messages.filter((m) => m.customType === EVENT.taskNotification).length,
                0,
                "silent kill — no <task-notification> on the way out"
            );
            assert.equal(h.appendedEntries.length, 0, "no state snapshot on shutdown");
        });
    }
});

after(() => {
    // Best-effort cleanup if a test failed mid-flight.
    try {
        execSync(`pkill -f "[w]hile true; do sleep 1; done # ${MARKER}" || true`);
    } catch {
        /* already gone */
    }
});

test("AC10: monitor progress and terminal renderer show identity/state/log/omissions, width/control safe", () => {
    const h = startExtension(); const theme = { fg: (_: string, text: string) => text };
    for (const type of [EVENT.monitorEvent, EVENT.taskNotification]) {
        const content = "[monitor m00000001 · absent] 中文 watch\nlog: /tmp/monitor.log\n\u001b[2Joutput\n[notification omitted: 2 whole lines]";
        const rendered = h.renderers.get(type)!({ content, details: { monitor: { state: "absent" } } }, {}, theme);
        const wide = rendered.render(100).join("\n");
        assert.match(wide, /m00000001.*absent/); assert.match(wide, /log: \/tmp\/monitor.log/); assert.match(wide, /omitted: 2/);
        assert.ok(!wide.includes("\u001b")); assert.ok(rendered.render(10).every(line => visibleWidth(line) <= 10));
    }
    const shell = h.renderers.get(EVENT.taskNotification)!({ content: "x", details: { status: "failed", summary: "shell failure", outputTail: "tail" } }, {}, theme);
    assert.deepEqual(shell.render(100), ["● shell failure", "  │ tail"]);
});

test("factory batches command and WS; session fallback cancels old windows; batch renderer remains safe", async t => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    class Socket {
        static instances: Socket[] = [];
        listeners = new Map<string, ((event: unknown) => void)[]>();
        closes = 0;
        constructor() { Socket.instances.push(this); }
        addEventListener(name: string, callback: (event: unknown) => void) {
            const list = this.listeners.get(name) ?? []; list.push(callback); this.listeners.set(name, list);
        }
        close() { this.closes++; }
        emit(text: string) { for (const callback of this.listeners.get("message") ?? []) callback({ data: text }); }
    }
    const original = globalThis.WebSocket;
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    const dir = mkdtempSync(join(tmpdir(), "monitor-factory-batch-"));
    const h = startExtension();
    const context = { ...uiCtx, cwd: dir };
    try {
        await h.handlers.get("session_start")!({}, context);
        await h.tools.get("monitor")!.execute("command", { command: "printf 'command event\\n'; sleep 1", description: "command source" }, undefined, undefined, context);
        await h.tools.get("monitor")!.execute("ws", { ws: { url: "ws://offline.test" }, description: "socket source" }, undefined, undefined, context);
        Socket.instances[0]!.emit("socket event\u001b]52;c;payload\u0007");
        await sleep(300);
        assert.equal(h.messages.length, 1, "one host delivery across command and WS");
        const batch = h.messages[0] as unknown as { content: string; details: { monitorBatch: { jobId: string; logPath: string }[] } };
        assert.match(batch.content, /command event/); assert.match(batch.content, /socket event/);
        assert.equal(batch.details.monitorBatch.length, 2);
        for (const item of batch.details.monitorBatch) { assert.ok(batch.content.includes(item.jobId)); assert.ok(batch.content.includes(item.logPath)); }
        const renderer = h.renderers.get(EVENT.monitorEvent)!(batch, {}, uiCtx.ui.theme);
        for (const width of [1, 12, 80]) for (const line of renderer.render(width)) {
            assert.ok(visibleWidth(line) <= width); assert.doesNotMatch(line.replace(/\u001b\[[0-9;]*m/g, ""), /\u001b|\u0007/);
        }
        Socket.instances[0]!.emit("old pending must vanish");
        await h.handlers.get("session_start")!({}, context);
        await h.tools.get("monitor")!.execute("new-ws", { ws: { url: "ws://offline.test" }, description: "new socket" }, undefined, undefined, context);
        Socket.instances[1]!.emit("new epoch event");
        await sleep(300);
        assert.equal(h.messages.length, 2);
        assert.match((h.messages[1] as unknown as { content: string }).content, /new epoch event/);
        assert.doesNotMatch((h.messages[1] as unknown as { content: string }).content, /old pending|command event/);
        assert.equal(Socket.instances[0]!.closes, 1);
    } finally {
        await h.handlers.get("session_shutdown")!({}, context);
        globalThis.WebSocket = original; rmSync(dir, { recursive: true, force: true });
    }
});

test("factory fallback reset inside deadline decision schedules new source and skips remaining old decisions", async t => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    class Socket {
        static instances: Socket[] = [];
        listeners = new Map<string, ((event: unknown) => void)[]>();
        closes = 0;
        constructor() { Socket.instances.push(this); }
        addEventListener(name: string, callback: (event: unknown) => void) {
            const list = this.listeners.get(name) ?? []; list.push(callback); this.listeners.set(name, list);
        }
        close() { this.closes++; }
        emit(data: string) { for (const cb of this.listeners.get("message") ?? []) cb({ data }); }
    }
    const original = globalThis.WebSocket; globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    const dir = mkdtempSync(join(tmpdir(), "monitor-factory-reentrant-reset-"));
    const h = startExtension(); const context = { ...uiCtx, cwd: dir };
    let reset: Promise<void> | undefined;
    let fresh: Promise<unknown> | undefined;
    let off = () => {};
    try {
        await h.handlers.get("session_start")!({}, context);
        for (const description of ["deadline one", "deadline two"]) {
            await h.tools.get("monitor")!.execute(description, { ws: { url: "ws://offline.test" }, description, timeout_ms: 200 }, undefined, undefined, context);
        }
        for (const socket of Socket.instances) socket.emit("old pending");
        off = h.backend.source.subscribe(() => {
            if (!h.backend.source.list().some(view => view.status === "stopped")) return;
            off();
            reset = h.handlers.get("session_start")!({}, context);
            fresh = h.tools.get("monitor")!.execute("fresh", { ws: { url: "ws://offline.test" }, description: "fresh epoch" }, undefined, undefined, context);
            Socket.instances[2]!.emit("fresh output");
        });
        t.mock.timers.tick(200); await reset; await fresh;
        assert.equal(h.messages.length, 0);
        t.mock.timers.tick(200);
        assert.equal(h.messages.length, 1);
        const message = h.messages[0] as unknown as { content: string };
        assert.match(message.content, /fresh output/); assert.doesNotMatch(message.content, /old pending|deadline/);
        assert.ok(Socket.instances.slice(0, 2).every(socket => socket.closes === 1));
        t.mock.timers.tick(100000); assert.equal(h.messages.length, 1);
    } finally {
        off(); await h.handlers.get("session_shutdown")!({}, context);
        globalThis.WebSocket = original; t.mock.timers.reset(); rmSync(dir, { recursive: true, force: true });
    }
});

test("actual factory retains hundreds of terminals beyond admission: bounded single delivery, manifest queries, isolation and fd cleanup", async t => {
    const fs = await import("node:fs");
    const { syncBuiltinESMExports } = await import("node:module");
    const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const { MONITOR_NOTIFICATION_MAX_BYTES } = await import("../monitor-batch.ts");
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    class Socket {
        static instances: Socket[] = [];
        listeners = new Map<string, ((event: unknown) => void)[]>(); closes = 0;
        constructor() { Socket.instances.push(this); }
        addEventListener(name: string, callback: (event: unknown) => void) {
            const list = this.listeners.get(name) ?? []; list.push(callback); this.listeners.set(name, list);
        }
        close() { this.closes++; }
        emit(name: string, event: unknown) { for (const cb of this.listeners.get(name) ?? []) cb(event); }
    }
    const dir = fs.mkdtempSync(join(tmpdir(), "monitor-cap-factory-"));
    const original = globalThis.WebSocket; globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    const keys = ["PROCESS_TASKS_LOG_DIR", "PROCESS_TASKS_MAX_CONCURRENT_JOBS", "PROCESS_TASKS_MONITOR_FLUSH_MS"];
    const old = keys.map(key => process.env[key]);
    process.env[keys[0]!] = dir; process.env[keys[1]!] = "1"; process.env[keys[2]!] = "30000";
    const realOpen = fs.default.openSync; const realClose = fs.default.closeSync;
    const descriptors = new Set<number>(); let manifestFail = false;
    const open = t.mock.method(fs.default, "openSync", (path: PathLike, flags: OpenMode, mode?: Mode) => {
        if (manifestFail && String(path).includes("monitor-batch-")) throw new Error("manifest disk failure");
        const fd = realOpen(path, flags, mode); descriptors.add(fd); return fd;
    });
    const close = t.mock.method(fs.default, "closeSync", (fd: number) => { realClose(fd); descriptors.delete(fd); });
    syncBuiltinESMExports(); t.mock.method(console, "error", () => {});
    const h = startExtension(); const other = startExtension(); const context = { ...uiCtx, cwd: dir };
    type Message = { content: string; details: { monitorBatch: { jobId: string; logPath: string }[];
        monitorBatchOverflow: { sourceCount: number; omittedSources: number; manifestPath?: string } } };
    const run = async (factory: ReturnType<typeof startExtension>, label: string, count = 350) => {
        for (let i = 0; i < count; i++) {
            const result = await factory.tools.get("monitor")!.execute(`${label}-${i}`, {
                ws: { url: "ws://offline.test" }, description: `${label} ${i} ` + "中文".repeat(400),
            }, undefined, undefined, context);
            assert.match(result.content[0]!.text, /Monitor .* started/);
            const socket = Socket.instances.at(-1)!;
            socket.emit("message", { data: `original ${label} ${i}\u001b]52;c;unsafe\u0007` });
            socket.emit("close", { code: 1000, reason: "done" });
            await Promise.resolve(); await Promise.resolve();
        }
        assert.equal(descriptors.size, 0, "each real WS log fd closes before next source");
    };
    try {
        await h.handlers.get("session_start")!({}, context); await other.handlers.get("session_start")!({}, context);
        await run(h, "first"); await run(other, "second");
        assert.equal(h.backend.source.list().length, 350); assert.equal(other.backend.source.list().length, 350);
        t.mock.timers.tick(200);
        assert.equal(h.messages.length, 1); assert.equal(other.messages.length, 1);
        const message = h.messages[0] as unknown as Message; const second = other.messages[0] as unknown as Message;
        for (const item of [message, second]) {
            assert.ok(Buffer.byteLength(JSON.stringify({ content: item.content, details: item.details }), "utf8") <= MONITOR_NOTIFICATION_MAX_BYTES - 1024);
            assert.ok(Buffer.byteLength(JSON.stringify({ message: item, options: { deliverAs: "steer", triggerTurn: true } }), "utf8") <= MONITOR_NOTIFICATION_MAX_BYTES);
            const overflow = item.details.monitorBatchOverflow;
            assert.equal(overflow.sourceCount, 350); assert.ok(overflow.omittedSources > 0);
            const rows = fs.readFileSync(overflow.manifestPath!, "utf8").trim().split("\n").slice(1).map(line => JSON.parse(line));
            assert.equal(rows.length, 350); assert.equal(new Set(rows.map(row => row.jobId)).size, 350);
            for (const row of rows) {
                assert.equal(row.state, "completed"); assert.deepEqual(row.transitions, ["completed"]);
                assert.match(row.summary, /stream ended/); assert.match(fs.readFileSync(row.logPath, "utf8"), /original/);
            }
        }
        assert.notEqual(message.details.monitorBatchOverflow.manifestPath, second.details.monitorBatchOverflow.manifestPath);
        const renderer = h.renderers.get(EVENT.taskNotification)!(message, {}, uiCtx.ui.theme);
        assert.match(renderer.render(100).join("\n"), /sources omitted inline/);
        for (const width of [1, 16, 100]) for (const line of renderer.render(width)) {
            assert.ok(visibleWidth(line) <= width); assert.doesNotMatch(line.replace(/\u001b\[[0-9;]*m/g, ""), /\u001b|\u0007/);
        }
        t.mock.timers.tick(60000); assert.equal(h.messages.length, 1); assert.equal(other.messages.length, 1);
        await h.handlers.get("session_start")!({}, context); manifestFail = true;
        await run(h, "failed");
        await h.tools.get("monitor")!.execute("live", { ws: { url: "ws://offline.test" }, description: "listener survives manifest failure" }, undefined, undefined, context);
        const live = Socket.instances.at(-1)!; live.emit("message", { data: "pending live activity" });
        t.mock.timers.tick(200); assert.equal(h.messages.length, 2); assert.equal(live.closes, 0);
        const failed = h.messages[1] as unknown as Message;
        assert.equal(failed.details.monitorBatchOverflow.manifestPath, undefined); assert.match(failed.content, /manifest unavailable/);
        // Existing jobs list exposes unsurfaced terminal notifyError, without
        // consuming outcomes or requiring another unsolicited wakeup.
        const list = await h.tools.get("process_manage")!.execute("list", processInput({ action: "list" }), undefined, undefined, context);
        assert.match(list.content[0]!.text, /notification.*failed|notify.*failed/i);
        t.mock.timers.tick(100000); assert.equal(h.messages.length, 2);
        live.emit("message", { data: "fresh live activity" }); t.mock.timers.tick(200);
        assert.equal(h.messages.length, 3); assert.equal(live.closes, 0);
        assert.match((h.messages[2] as unknown as Message).content, /fresh live activity/);
        assert.doesNotMatch((h.messages[2] as unknown as Message).content, /pending live activity/);
        await h.handlers.get("session_start")!({}, context);
        assert.ok(fs.existsSync(message.details.monitorBatchOverflow.manifestPath!));
        assert.ok(fs.existsSync(second.details.monitorBatchOverflow.manifestPath!));
    } finally {
        await h.handlers.get("session_shutdown")!({}, context); await other.handlers.get("session_shutdown")!({}, context);
        assert.equal(descriptors.size, 0); assert.ok(Socket.instances.every(socket => socket.closes === 1));
        open.mock.restore(); close.mock.restore(); syncBuiltinESMExports(); globalThis.WebSocket = original;
        keys.forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; });
        t.mock.timers.reset(); fs.rmSync(dir, { recursive: true, force: true });
    }
});
