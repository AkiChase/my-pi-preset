import assert from "node:assert/strict";
import { it } from "node:test";
import { TaskCoordinator } from "../coordinator.ts";
import { TaskLifecycle } from "../lifecycle.ts";

void it("all synchronous freeze/disarm runs before waits/stop; drains precede disposal; close is stable", async () => {
    const coordinator = new TaskCoordinator();
    const lifecycle = new TaskLifecycle(coordinator);
    const order: string[] = [];
    let release!: () => void;
    const actual = new Promise<void>((resolve) => { release = resolve; });
    coordinator.registerWait({ identity: { sourceId: "test", taskId: "t", runId: "r" }, label: "wait", kind: "launch",
        onDispose() { order.push("wait"); assert.equal(lifecycle.active, false); } });
    for (const name of ["first", "second"]) lifecycle.register({ name,
        freeze() { order.push(`${name}:freeze`); },
        stop() { order.push(`${name}:stop`); },
        async drain() { order.push(`${name}:drain`); await actual; },
        dispose() { order.push(`${name}:dispose`); },
    });
    lifecycle.onClose(() => { order.push("UI"); throw new Error("optional UI failure"); });
    const shutdown = lifecycle.shutdown();
    assert.equal(lifecycle.shutdown(), shutdown);
    assert.deepEqual(order, ["first:freeze", "second:freeze", "UI", "wait", "first:stop", "second:stop"]);
    assert.equal(coordinator.waitCount, 0);
    assert.throws(() => coordinator.registerWait({ identity: { sourceId: "t", taskId: "t", runId: "r" }, label: "late", kind: "launch" }), /disposed/);
    await Promise.resolve();
    assert.equal(lifecycle.phase, "closing");
    release(); await shutdown;
    assert.deepEqual(order.slice(-2), ["first:dispose", "second:dispose"]);
    assert.equal(lifecycle.phase, "closed");
});

void it("throwing hooks and a never-resolving actual cleanup cannot block other participant disposal", async () => {
    const coordinator = new TaskCoordinator();
    const lifecycle = new TaskLifecycle(coordinator, 20);
    let disposed = 0;
    lifecycle.register({ name: "broken", freeze() { throw new Error("freeze"); }, stop() { throw new Error("stop"); },
        async drain() { throw new Error("drain"); }, dispose() { throw new Error("dispose"); } });
    lifecycle.register({ name: "pending", freeze() {}, stop() {}, drain: () => new Promise<void>(() => {}), dispose() { disposed++; } });
    await lifecycle.shutdown();
    assert.equal(disposed, 1);
    assert.equal(lifecycle.phase, "closed");
});
