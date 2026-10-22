import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import "./source-loader.mjs";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import type { RunOptions, RunResult } from "../src/agent-runner.ts";
const { AgentManager } = await import("../src/agent-manager.ts");
const { createAgentTaskSource } = await import("../src/source.ts");
const { PendingQueue } = await import("../src/pending-queue.ts");
it("UI originals enforce exact item/UTF8 byte admission and external projection discloses bounds", () => {
    const items = new PendingQueue(() => {});
    for (let index = 0; index < 128; index++) assert.ok(items.admit(`original-${index}`));
    assert.equal(items.admit("overflow"), undefined);
    assert.equal(items.snapshot().entries.length, 128);
    const bytes = new PendingQueue(() => {});
    assert.ok(bytes.admit("界".repeat(174_762) + "ab")); // Exactly 512 KiB UTF-8.
    assert.equal(bytes.admit("x"), undefined);
    assert.equal(Buffer.byteLength(bytes.snapshot().entries[0]!.text), 512 * 1024);
    const external = new PendingQueue(() => {});
    external.prepare(Array.from({ length: 130 }, (_, index) => `${index}:` + "界".repeat(2000)));
    const snapshot = external.snapshot();
    external.prepare(Array.from({ length: 130 }, (_, index) => `${index}:` + "界".repeat(2000)));
    assert.deepEqual(external.snapshot(), snapshot, "repeated reads preserve truncated external occurrence IDs and omissions");
    assert.equal(snapshot.entries.length, 128); assert.equal(snapshot.omitted, 2);
    assert.ok(snapshot.entries.every(item => item.truncated && !item.restorable && Buffer.byteLength(item.text) <= 4096 && !item.text.includes("�")));
    items.freeze(); bytes.freeze(); external.freeze();
});
const tick = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
it("bound queue omissions survive terminal reconciliation and reentrant bind releases subscription", () => {
    let listener!: (event: never) => void;
    const queue = new PendingQueue(() => {});
    const session = { subscribe: (value: typeof listener) => { listener = value; return () => {}; },
        getSteeringMessages: () => Array.from({ length: 130 }, (_, index) => `steer-${index}`),
        getFollowUpMessages: () => Array.from({ length: 129 }, (_, index) => `follow-${index}`),
    } as unknown as AgentSession;
    queue.bind(session);
    const before = queue.snapshot();
    assert.equal(before.entries.length, 128); assert.equal(before.omitted, 131);
    queue.prepare([]); queue.freeze();
    assert.equal(queue.snapshot().omitted, before.omitted);
    assert.ok(queue.snapshot().entries.every(item => item.state === "notDelivered"));
    const duplicates = new PendingQueue(() => {});
    duplicates.bind({ ...session, getSteeringMessages: () => Array(130).fill("same"), getFollowUpMessages: () => [] } as unknown as AgentSession);
    const ids = duplicates.snapshot().entries.map(item => item.id);
    listener({ type: "queue_update", steering: Array(129).fill("same"), followUp: [] } as never);
    assert.equal(duplicates.snapshot().entries[0]!.id, ids[1], "consumed first duplicate cannot retain its ID above projection bound");
    assert.equal(duplicates.snapshot().omitted, 1);
    duplicates.freeze();
    let offCount = 0;
    const reentrant = new PendingQueue(() => reentrant.freeze());
    reentrant.bind({ ...session, subscribe: (value: typeof listener) => {
        value({ type: "queue_update", steering: [], followUp: [] } as never);
        return () => { offCount++; };
    } } as unknown as AgentSession);
    assert.equal(offCount, 1, "subscribe cleanup acquired after synchronous freeze is still released");
});
it("manager projects async rejection, successful replacement, stop-before-ready and stale input completion fencing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pending-manager-"));
    const file = join(dir, "root.jsonl"); writeFileSync(file, "");
    let ready!: RunOptions, finish!: (result: RunResult) => void;
    let rejectInput = true, release!: () => void, slow = false;
    let clearCount = 0;
    const listeners = new Set<(event: never) => void>();
    let queue: string[] = [];
    const session = { sessionManager: { getSessionFile: () => file }, messages: [], abort: async () => {}, dispose() {},
        subscribe: (listener: (event: never) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
        getSteeringMessages: () => queue, getFollowUpMessages: () => [], clearQueue() { clearCount++; queue = []; },
        steer: async (text: string) => {
            if (slow) await new Promise<void>(done => { release = done; });
            if (rejectInput) throw new Error("async REFUSAL");
            queue.push(text); for (const listener of listeners) listener({ type: "queue_update", steering: queue, followUp: [] } as never);
            return "queued";
        } } as unknown as AgentSession;
    const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
        runAgent: async (_ctx, _type, _prompt, options) => { ready = options; return new Promise(done => { finish = done; }); },
        resumeAgent: async () => ({ text: "resumed" }),
    });
    const coordinator = new TaskCoordinator(), source = createAgentTaskSource(manager, coordinator, new Map()); coordinator.registerSource(source);
    const ctx = { cwd: dir, sessionManager: { getSessionFile: () => file } } as unknown as ExtensionContext;
    try {
        const id = manager.spawn({} as ExtensionAPI, ctx, "general-purpose", "prompt", { description: "test", isBackground: true });
        manager.steer(id, "original"); const early = manager.getPendingMessages(id)!; assert.equal(early.entries[0]!.state, "pending");
        ready.onSessionCreated!(session); await tick();
        const failed = manager.getPendingMessages(id)!.entries[0]!; assert.equal(failed.state, "failed"); assert.match(failed.error!, /REFUSAL/);
        assert.equal(failed.restorable, true); assert.equal(early.entries[0]!.state, "pending", "immutable old snapshot");
        rejectInput = false; assert.equal(manager.steer(id, "replacement", failed.id), true);
        assert.ok(manager.getPendingMessages(id)!.entries.some(item => item.id === failed.id), "optimistic send retains failed record");
        await tick(); assert.ok(!manager.getPendingMessages(id)!.entries.some(item => item.id === failed.id));
        slow = true; manager.steer(id, "late"); await tick();
        manager.getRecord(id)!.starting = true;
        manager.steer(id, "waiting behind handoff");
        // Handoff clears the preparation array before ordered delivery completes.
        manager.getRecord(id)!.pendingSteers = undefined;
        manager.abort(id);
        assert.ok(manager.getPendingMessages(id)!.entries.some(item => item.text === "waiting behind handoff" && item.state === "notDelivered"));
        assert.equal(listeners.size, 0); assert.ok(manager.getPendingMessages(id)!.entries.some(item => item.state === "notDelivered"));
        finish({ responseText: "", session, aborted: false, steered: false }); await tick();
        assert.equal(manager.resumeRun(id, "resume"), undefined, "resume fenced while old async input is outstanding");
        release(); await tick(); assert.ok(clearCount > 0); assert.deepEqual(queue, []);
        assert.ok(manager.resumeRun(id, "resume")); await manager.waitForAll(); assert.deepEqual(manager.getPendingMessages(id)!.entries, []);
        const queuedId = manager.spawn({} as ExtensionAPI, ctx, "general-purpose", "prompt", { description: "test", isBackground: true });
        manager.steer(queuedId, "not ready"); manager.abort(queuedId);
        assert.equal(manager.getPendingMessages(queuedId)!.entries[0]!.state, "notDelivered");
        finish({ responseText: "", session, aborted: false, steered: false }); await tick();
    } finally { release?.(); await manager.dispose(); coordinator.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

it("external enqueue/consumption cannot claim submitting originals, lose failures or replace them early", async () => {
    let listener!: (event: never) => void, release!: () => void;
    let outcome: "failed" | "handled" | "queued" = "failed";
    let steering: string[] = [];
    const publish = (texts: string[]) => { steering = texts; listener({ type: "queue_update", steering, followUp: [] } as never); };
    const queue = new PendingQueue(() => {});
    queue.bind({ subscribe(value: typeof listener) { listener = value; return () => {}; },
        getSteeringMessages: () => steering, getFollowUpMessages: () => [],
        async steer() {
            await new Promise<void>(done => { release = done; });
            if (outcome === "failed") throw new Error("real UI failure");
            if (outcome === "queued") publish(["ACTUAL_TRANSFORMED"]);
            return outcome;
        },
    } as unknown as AgentSession);
    const original = queue.admit("  UI_ORIGINAL  ")!;
    const first = queue.deliver(original.text, () => true, original);
    publish(["EXTERNAL"]);
    assert.equal(queue.snapshot().entries.find(item => item.id === original.id)!.state, "submitting");
    assert.ok(queue.snapshot().entries.some(item => item.text === "EXTERNAL"));
    publish([]); release(); await first;
    assert.equal(queue.snapshot().entries.find(item => item.id === original.id)!.state, "failed");
    assert.equal(queue.snapshot().entries[0]!.text, "  UI_ORIGINAL  ");
    for (const result of ["handled", "failed", "queued"] as const) {
        outcome = result;
        const retry = queue.admit("retry", original.id)!;
        const delivery = queue.deliver(retry.text, () => true, retry);
        publish(["EXTERNAL"]);
        assert.ok(queue.snapshot().entries.some(item => item.id === original.id), "unrelated admission cannot replace failure");
        publish([]); release(); await delivery;
        if (result !== "queued") assert.ok(queue.snapshot().entries.some(item => item.id === original.id), "handled/rejected submission retains failure");
        else {
            assert.ok(!queue.snapshot().entries.some(item => item.id === original.id || item.id === retry.id));
            assert.ok(queue.snapshot().entries.some(item => item.text === "ACTUAL_TRANSFORMED" && !item.restorable));
        }
    }
    queue.freeze();
});
