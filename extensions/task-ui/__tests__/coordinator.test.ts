import { it } from "node:test";
import assert from "node:assert/strict";
import { TaskCoordinator } from "../coordinator.ts";
import { taskKey } from "../types.ts";

const identity = { sourceId: "process", taskId: "job", runId: "run" };

void it("namespaces IDs and run revisions without separator collisions", () => {
    assert.notEqual(taskKey(identity), taskKey({ ...identity, sourceId: "agent" }));
    assert.notEqual(taskKey(identity), taskKey({ ...identity, runId: "resumed" }));
    assert.notEqual(taskKey({ sourceId: "a:b", taskId: "c", runId: "d" }), taskKey({ sourceId: "a", taskId: "b:c", runId: "d" }));
});

void it("detaches all launch/retrieval leases exactly once and removes parent signals synchronously", async () => {
    const coordinator = new TaskCoordinator();
    const signal = new AbortController();
    let detach = 0;
    let stop = 0;
    let cleanup = 0;
    let notifications = 0;
    const unsubscribe = coordinator.subscribeWaits(() => { notifications++; });
    const launch = coordinator.registerWait<number>({ identity, label: "shell", kind: "launch", signal: signal.signal,
        onDetach: () => { detach++; }, onInterrupt: () => { stop++; }, cleanup: () => { cleanup++; } });
    const retrieval = coordinator.registerWait({ identity, label: "result", kind: "retrieval", signal: signal.signal,
        onDetach: () => { detach++; }, onInterrupt: () => { stop++; }, cleanup: () => { cleanup++; } });
    assert.equal(coordinator.countWaits(identity), 2);
    assert.equal(coordinator.detachAll(), 2);
    signal.abort();
    assert.equal(coordinator.detachAll(), 0);
    assert.equal(launch.complete(42), false);
    assert.equal(retrieval.interrupt(), false);
    assert.equal((await launch.result).kind, "detached");
    assert.equal((await retrieval.result).kind, "detached");
    assert.equal(detach, 1, "retrieval must never promote the execution");
    assert.equal(stop, 0);
    assert.equal(cleanup, 2);
    assert.equal(coordinator.waitCount, 0);
    assert.equal(notifications, 4);
    unsubscribe();
    coordinator.dispose();
});

for (const winner of ["completion", "detach"] as const) {
    void it(`${winner} wins the same-tick race with one result and one cleanup`, async () => {
        const coordinator = new TaskCoordinator();
        let consumed = 0;
        let detached = 0;
        let cleanups = 0;
        const lease = coordinator.registerWait<number>({ identity, label: "shell", kind: "launch",
            onComplete: () => { consumed++; }, onDetach: () => { detached++; }, cleanup: () => { cleanups++; } });
        if (winner === "completion") { assert.equal(lease.complete(7), true); assert.equal(lease.detach(), false); }
        else { assert.equal(lease.detach(), true); assert.equal(lease.complete(7), false); }
        const outcome = await lease.result;
        assert.equal(outcome.kind, winner === "completion" ? "completed" : "detached");
        assert.equal(consumed + detached, 1);
        assert.equal(cleanups, 1);
        assert.equal(lease.dispose(), false);
        assert.equal(coordinator.waitCount, 0);
    });
}

void it("already-aborted signals interrupt launch only; retrieval never stops execution", async () => {
    const coordinator = new TaskCoordinator();
    const signal = new AbortController();
    signal.abort();
    let stopped = 0;
    for (const kind of ["launch", "retrieval"] as const) {
        const lease = coordinator.registerWait({ identity, label: kind, kind, signal: signal.signal, onInterrupt: () => { stopped++; } });
        assert.equal(lease.settled, true);
        assert.equal((await lease.result).kind, "interrupted");
    }
    assert.equal(stopped, 1);
    assert.equal(coordinator.waitCount, 0);
});

void it("epoch owner can cancel waits idempotently then admit new waits; final disposal prevents admission", async () => {
    const coordinator = new TaskCoordinator();
    let cleanup = 0;
    let stop = 0;
    const old = coordinator.registerWait({ identity, label: "old", kind: "launch", onDispose: () => { stop++; }, cleanup: () => { cleanup++; } });
    coordinator.cancelWaits();
    coordinator.cancelWaits();
    assert.equal((await old.result).kind, "disposed");
    const next = coordinator.registerWait({ identity, label: "new", kind: "retrieval", cleanup: () => { cleanup++; } });
    coordinator.dispose();
    coordinator.dispose();
    assert.equal((await next.result).kind, "disposed");
    assert.equal(stop, 1);
    assert.equal(cleanup, 2);
    assert.throws(() => coordinator.registerWait({ identity, label: "late", kind: "launch" }), /disposed/);
});

void it("callback/cleanup failures still settle the lease and cannot starve sibling detach or disposal", async t => {
    t.mock.method(console, "error", () => {});
    const coordinator = new TaskCoordinator();
    const failed = coordinator.registerWait({ identity, label: "failed", kind: "launch",
        onDetach: () => { throw new Error("detach callback"); }, cleanup: () => { throw new Error("cleanup"); } });
    const sibling = coordinator.registerWait({ identity, label: "sibling", kind: "retrieval" });
    assert.equal(coordinator.detachAll(), 2);
    assert.equal((await failed.result).kind, "detached");
    assert.equal((await sibling.result).kind, "detached");
    assert.equal(coordinator.waitCount, 0);
    assert.equal(failed.dispose(), false);
});

void it("forwards optional paging with bounded limits, preserves raw-only requests and rejects stale identities", () => {
    const coordinator = new TaskCoordinator();
    const requests: import("../types.ts").TaskDetailRequest[] = [];
    let current = true;
    const view = { ...identity, key: taskKey(identity), capabilities: { details: true, stop: false } } as import("../types.ts").TaskView;
    coordinator.registerSource({ sourceId: identity.sourceId, revision: 0, list: () => current ? [view] : [],
        detail: (_identity, request) => { requests.push(request!); return { text: "abcdef" }; }, stop: () => false, subscribe: () => () => {}, dispose() {} });
    assert.equal(coordinator.detail(identity, { limit: 2 })?.text, "ab");
    assert.equal("conversationPage" in requests[0]!, false);
    coordinator.detail(identity, { conversationPage: { direction: "before", cursor: "opaque", limit: 500 } });
    assert.deepEqual(requests[1]?.conversationPage, { direction: "before", cursor: "opaque", limit: 64 });
    assert.equal(coordinator.detail(identity, { conversationPage: { direction: "after" } }), undefined);
    assert.equal(coordinator.detail(identity, { conversationPage: { cursor: "x".repeat(257) } }), undefined);
    assert.equal(coordinator.detail({ ...identity, runId: "old" }, { conversationPage: {} }), undefined);
    assert.equal(requests.length, 2);
    current = false; assert.equal(coordinator.detail(identity), undefined);
    coordinator.dispose();
});

for (const phase of ["before", "after"] as const) void it(`detail fences source.list reentrancy ${phase} the read`, () => {
    const coordinator = new TaskCoordinator();
    let lists = 0, reads = 0;
    const view = { ...identity, key: taskKey(identity), capabilities: { details: true, stop: false } } as import("../types.ts").TaskView;
    coordinator.registerSource({ sourceId: identity.sourceId, revision: 0,
        list() { lists++; if (lists === (phase === "before" ? 1 : 2)) coordinator.freezeAdmission(); return [view]; },
        detail() { reads++; return { text: "stale" }; }, stop: () => false, subscribe: () => () => {}, dispose() {} });
    assert.equal(coordinator.detail(identity), undefined);
    assert.equal(reads, phase === "before" ? 0 : 1);
    coordinator.dispose();
});
