import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import { taskKey, type TaskView } from "../../task-ui/types.ts";
import type { RuntimeTaskCapability } from "../facade.ts";
import { REMINDER_SYSTEM_RULE } from "../reminder.ts";
import { REMINDER_SECTION, registerBackgroundReminder } from "../reminder-owner.ts";

type Handler = (event: Record<string, unknown>) => unknown;
function harness(interval: number) {
    const handlers = new Map<string, Handler[]>();
    const pi = { on(name: string, handler: Handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list);
        return () => { handlers.set(name, (handlers.get(name) ?? []).filter(h => h !== handler)); }; } } as unknown as ExtensionAPI;
    const identity = { sourceId: "process", taskId: "b1", runId: "b1" };
    const view = { ...identity, key: taskKey(identity), kind: "shell", title: "x", status: "running", executionMode: "background", waitCount: 0,
        stats: {}, artifacts: [], capabilities: { stop: true, details: true } } as TaskView;
    let lists = 0;
    const capability: RuntimeTaskCapability = { list: () => { lists++; return [{ view, manageable: true, rawStatus: "running" }]; }, execute: async () => { throw new Error("no execute"); } };
    const lifecycle = new TaskLifecycle(new TaskCoordinator());
    registerBackgroundReminder(pi, { capabilities: () => [capability], lifecycle, interval });
    const emit = (name: string, event: Record<string, unknown> = {}) => (handlers.get(name) ?? []).map(h => h({ type: name, ...event }))[0];
    const request = () => emit("context", { messages: [] });
    const turnEnd = () => emit("turn_end", { entries: [{ type: "custom", customType: "other" }] }) as { entries: { customType: string }[] } | undefined;
    const start = () => { const sections: Record<string, string> = {}; const result = emit("before_agent_start", { systemPromptOptions: { sections } }) as { message?: unknown } | undefined; return { sections, result }; };
    return { handlers, lifecycle, request, turnEnd, start, emit, lists: () => lists };
}

void it("turn_end writes once for the due request, preserves other drafts, and context never modifies messages", () => {
    const h = harness(3);
    const { sections, result } = h.start();
    assert.equal(sections[REMINDER_SECTION], REMINDER_SYSTEM_RULE);
    assert.equal(result, undefined);
    assert.equal(h.request(), undefined); assert.equal(h.turnEnd(), undefined); // next=2
    h.request();
    const due = h.turnEnd()!; // next=3
    assert.deepEqual(due.entries.map(e => e.customType), ["other", "background-task-reminder"]);
    assert.equal(h.start().result, undefined, "already written for request 3");
    h.request(); assert.equal(h.turnEnd(), undefined);
});

void it("failed compaction does not remind; mid-run compaction reminds at the next boundary (known one-request delay)", () => {
    const h = harness(0);
    h.request();
    h.emit("session_compact_failed", { reason: "threshold" });
    assert.equal(h.turnEnd(), undefined);
    h.emit("session_compact", { reason: "threshold" }); // between turn_end and the next request
    h.request(); // that request has no fresh reminder
    assert.ok(h.turnEnd(), "fresh reminder lands before the following request");
    h.request(); assert.equal(h.turnEnd(), undefined, "sent once");
});

void it("session_start resets cadence; closed activation stops reading tasks and unsubscribes", async () => {
    const h = harness(2);
    h.request(); assert.ok(h.turnEnd());
    h.emit("session_start");
    assert.equal(h.turnEnd(), undefined, "counter restarted: next request is 1");
    const reads = h.lists();
    await h.lifecycle.shutdown();
    for (const list of h.handlers.values()) assert.equal(list.length, 0);
    assert.equal(h.lists(), reads);
});
