import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { processActivation } from "./process-harness.ts";

for (const boundary of ["silence shutdown", "immediate deadline"] as const) {
    void it(`initial monitor decision: ${boundary} reports the correct setup outcome`, async t => {
        class Socket {
            static instance: Socket;
            closes = 0;
            readonly listeners = new Map<string, ((event: unknown) => void)[]>();
            constructor() { Socket.instance = this; }
            addEventListener(name: string, callback: (event: unknown) => void) {
                const list = this.listeners.get(name) ?? [];
                list.push(callback); this.listeners.set(name, list);
            }
            close() { this.closes++; }
            emit(name: string, event: unknown) {
                for (const callback of this.listeners.get(name) ?? []) callback(event);
            }
        }
        // Only the transport and clock are fake; the registered monitor tool,
        // source, scheduling decision and lifecycle all run their actual code.
        const originalSocket = globalThis.WebSocket;
        globalThis.WebSocket = Socket as unknown as typeof WebSocket;
        t.after(() => { globalThis.WebSocket = originalSocket; });
        let now = 1_000;
        t.mock.method(Date, "now", () => now);
        const errors: unknown[][] = [];
        t.mock.method(console, "error", (...args: unknown[]) => { errors.push(args); });
        const dir = mkdtempSync(join(tmpdir(), "monitor-final-decision-"));
        const h = processActivation(dir, { monitorFlushMs: 0 });
        let closing: Promise<void> | undefined;
        // Startup consumes time without any source activity; the LAST decide()
        // therefore emits immediately, after the earlier setup guard already ran.
        const publish = h.reg.changed.bind(h.reg);
        t.mock.method(h.reg, "changed", () => {
            publish();
            if ([...h.reg.jobs.values()].some(job => job.stop)) now = 1_020;
        });
        const push = h.messages.push.bind(h.messages);
        h.messages.push = (...messages: unknown[]) => {
            const result = push(...messages);
            if (boundary === "silence shutdown" && h.lifecycle.active) closing = h.lifecycle.shutdown();
            return result;
        };
        try {
            const params = { ws: { url: "ws://offline.test" }, description: boundary,
                ...(boundary === "silence shutdown" ? { wake_absent_ms: 10 } : { timeout_ms: 10 }) };
            const pending = h.execute("monitor", params);
            if (boundary === "silence shutdown") {
                await assert.rejects(pending, /Monitor setup cancelled/);
                assert.ok(closing, "the initial silence notification must trigger shutdown");
                await closing;
                assert.equal(h.lifecycle.phase, "closed");
                assert.equal(h.coordinator.snapshot().length, 0);
            } else {
                const result = await pending;
                assert.match(result.content[0]?.text ?? "", /Monitor .* started/,
                    "normal immediate deadline completion is not failed admission");
                assert.equal(h.lifecycle.active, true);
            }
            const job = [...h.reg.jobs.values()][0]!;
            assert.equal(job.status, "killed");
            assert.equal(h.reg.totalStarted, 1); assert.equal(h.reg.killedCount, 1);
            assert.equal(Socket.instance.closes, 1);
            const saved = readFileSync(job.logPath);
            Socket.instance.emit("message", { data: "late bytes" });
            assert.deepEqual(readFileSync(job.logPath), saved);
            assert.equal(h.messages.length, 1, "no duplicate stop/final notification");
            const notice = h.messages[0] as { details: { monitor: { state: string } } };
            assert.equal(notice.details.monitor.state, boundary === "silence shutdown" ? "absent" : "killed");
            await Promise.resolve();
            assert.equal(h.reg.executions.size, 0); assert.equal(h.reg.jobAborts.size, 0);
            assert.equal(h.coordinator.waitCount, 0);
            assert.equal(job.stop, undefined);
            assert.equal(errors.length, 0);
        } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
    });
}

void it("default first window allows startup then submission-triggered shutdown clears sibling pending", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    class Socket {
        static instances: Socket[] = [];
        closes = 0;
        listeners = new Map<string, ((event: unknown) => void)[]>();
        constructor() { Socket.instances.push(this); }
        addEventListener(name: string, callback: (event: unknown) => void) {
            const list = this.listeners.get(name) ?? []; list.push(callback); this.listeners.set(name, list);
        }
        close() { this.closes++; }
        emit(data: string) { for (const cb of this.listeners.get("message") ?? []) cb({ data }); }
    }
    const original = globalThis.WebSocket; globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    const dir = mkdtempSync(join(tmpdir(), "monitor-delayed-shutdown-"));
    const h = processActivation(dir);
    let closing: Promise<void> | undefined;
    const push = h.messages.push.bind(h.messages);
    h.messages.push = (...messages: unknown[]) => {
        const result = push(...messages);
        Socket.instances[1]!.emit("inside send pending");
        closing = h.lifecycle.shutdown(); return result;
    };
    try {
        for (const description of ["one", "two"]) {
            const result = await h.execute("monitor", { ws: { url: "ws://offline.test" }, description });
            assert.match(result.content[0]!.text ?? "", /started/);
        }
        Socket.instances[0]!.emit("first"); Socket.instances[1]!.emit("second");
        assert.equal(h.messages.length, 0); t.mock.timers.tick(200); await closing;
        assert.equal(h.messages.length, 1); assert.equal(h.lifecycle.phase, "closed");
        t.mock.timers.tick(100000); assert.equal(h.messages.length, 1);
        assert.equal(h.reg.notificationRetries.size, 0); assert.equal(h.reg.jobAborts.size, 0);
        assert.ok(Socket.instances.every(socket => socket.closes === 1));
    } finally {
        await h.lifecycle.shutdown(); globalThis.WebSocket = original;
        t.mock.timers.reset(); rmSync(dir, { recursive: true, force: true });
    }
});
