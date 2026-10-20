import assert from "node:assert/strict";
import { it } from "node:test";
import { createEventBus, SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import widgetDisplay from "../../shared/widget-display/owner.ts";
import { TaskCoordinator } from "../coordinator.ts";
import { TaskLifecycle } from "../lifecycle.ts";
import { DEFAULTS } from "../config.ts";
import { createTaskUIOwner } from "../owner.ts";
import { overviewLines, TaskOverviewModel } from "../overview.ts";
import { taskKey, type TaskSource, type TaskView } from "../types.ts";
const theme = { fg: (_color: string, text: string) => text };
function view(id: string, patch: Partial<TaskView> = {}): TaskView {
    const identity = { sourceId: "overview", taskId: id, runId: "1" };
    return { ...identity, key: taskKey(identity), kind: "agent", title: `alias-${id}`, description: `Description ${id}`, status: "running", executionMode: "background", waitCount: 0,
        startedAt: 100_000, stats: { tokens: 12 }, artifacts: [], capabilities: { stop: true, details: true }, ...patch };
}
function fixture(display = true, shortcutBackground = DEFAULTS.shortcutBackground) {
    const handlers = new Map<string, Set<(event: never, ctx: ExtensionContext) => unknown>>();
    const pi = { events: createEventBus(), on(event: string, handler: (event: never, ctx: ExtensionContext) => unknown) {
        const set = handlers.get(event) ?? new Set(); set.add(handler); handlers.set(event, set); return () => { set.delete(handler); };
    } } as unknown as ExtensionAPI;
    const terminal = { columns: 100, rows: 24 }, widgets = new Map<string, Component>();
    let status: string | undefined, writes = 0, reenter: (() => void) | undefined;
    const ctx = { sessionManager: SessionManager.inMemory("/tmp"), hasUI: true, mode: "tui", ui: { theme,
        setStatus(_key: string, text: string | undefined) { status = text; },
        setWidget(key: string, content: unknown) {
            widgets.delete(key); writes++;
            if (typeof content === "function") widgets.set(key, content({ terminal, requestRender() {} }, theme));
            reenter?.();
        },
    } } as unknown as ExtensionContext;
    if (display) widgetDisplay(pi);
    const coordinator = new TaskCoordinator(), lifecycle = new TaskLifecycle(coordinator);
    let views: readonly TaskView[] = [], reads = 0;
    const listeners = new Set<() => void>();
    const source: TaskSource = { sourceId: "overview", revision: 0, list: () => views, detail() { reads++; throw new Error("overview may not read detail"); }, stop: () => false,
        subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }, dispose() { listeners.clear(); } };
    coordinator.registerSource(source);
    const owner = createTaskUIOwner(pi, coordinator, lifecycle, { ...DEFAULTS, shortcutBackground });
    function emit(event: string, fresh = ctx) { for (const handler of [...handlers.get(event) ?? []]) handler({} as never, fresh); }
    emit("session_start");
    return { ctx, terminal, coordinator, lifecycle, owner, widgets, emit, reads: () => reads, writes: () => writes, status: () => status,
        publish(next: readonly TaskView[]) { views = next; for (const fn of listeners) fn(); },
        render(width = terminal.columns) { return [...widgets.values()].flatMap(component => component.render(width)); },
        reenter(fn?: () => void) { reenter = fn; },
        dispose() { owner.dispose(); emit("session_shutdown"); coordinator.dispose(); },
    };
}
it("root metadata only, five rows plus hidden count, no child sums/input/detail, conservative small screens", () => {
    const roots = Array.from({ length: 7 }, (_, i) => view(String(i)));
    const child = view("child", { parentKey: roots[0].key, stats: { tokens: 99999 } });
    const model = new TaskOverviewModel();
    const selected = model.refresh([roots[0], child, ...roots.slice(1), view("process", { kind: "shell" })], 100_000);
    assert.equal(selected.length, 7);
    for (const rows of [1, 12, 13, 14, 16, 17, 18, 24]) {
        const lines = overviewLines(selected, 100, rows, theme, 103_000);
        assert.ok(lines.length <= Math.min(6, Math.max(1, rows - 12)));
        assert.match(lines.at(-1)!, /hidden/);
        assert.doesNotMatch(lines.join("\n"), /child|99/);
    }
    const lines = overviewLines(selected, 100, 24, theme, 103_000);
    assert.equal(lines.length, 6); assert.equal(lines[5], "+2 hidden");
    assert.match(lines[0], /^◌ Description 0 +\[running\] 3s · ↓ 12$/);
    const malicious = view("safe", { description: "中文🙂\u001b]0;BAD\u0007\n描述\u001b[31m", status: "paused" });
    for (const width of [0, 1, 2, 5, 20, 40, 80]) for (const line of overviewLines([malicious], width, 24, theme, 103_000)) {
        assert.ok(visibleWidth(line) <= width); assert.doesNotMatch(stripTerminalSequences(line), /BAD|[\u0000-\u001f]/);
    }
    assert.match(overviewLines([malicious], 80, 24, theme, 103_000)[0], /^Ⅱ 中文🙂 描述/);
});
it("retention is unpinned whole-root four seconds, orphan/cycle safe and new run does not resurrect old metadata", () => {
    const model = new TaskOverviewModel(), root = view("parent"), child = view("child", { parentKey: root.key, status: "completed", endedAt: 0 });
    assert.deepEqual(model.refresh([root, child], 100_000).map(v => v.taskId), ["parent"]);
    const terminal = { ...root, status: "completed" as const, endedAt: 100_000 };
    model.refresh([terminal, child], 100_000);
    assert.deepEqual(model.refresh([], 103_999), [terminal]);
    assert.deepEqual(model.refresh([], 104_000), []);
    const orphan = view("orphan", { parentKey: "missing" }), a = view("a"), b = view("b", { parentKey: a.key });
    assert.deepEqual(model.refresh([orphan, { ...a, parentKey: b.key }, b], 104_000).map(v => v.taskId), ["orphan", "a"]);
    const resumed = view("parent", { runId: "2", key: taskKey({ sourceId: "overview", taskId: "parent", runId: "2" }),
        startedAt: 104_000, stats: { tokens: 3210, durationMs: 2000 } });
    assert.deepEqual(model.refresh([resumed], 106_000), [resumed]);
    const line = overviewLines([resumed], 100, 24, theme, 999_000).join("\n");
    assert.match(line, /2s · ↓ 3\.2k/); assert.doesNotMatch(line, /completed/);
    model.clear(); assert.deepEqual(model.refresh([], 106_001), []);
});
it("actual widget owner/client hide at expiry without source events; clocks and late reset/shutdown callbacks are fenced", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
    const f = fixture();
    try {
        assert.equal(f.widgets.size, 0);
        f.publish([view("root", { kind: "workflow" })]);
        assert.equal(f.widgets.size, 1); assert.ok(f.widgets.has("preset.widgets.belowEditor"));
        assert.match(f.render().join("\n"), /0s/);
        t.mock.timers.tick(1000); assert.match(f.render().join("\n"), /1s/);
        const cached = [...f.widgets.values()][0];
        f.publish([view("root", { kind: "workflow", status: "completed", endedAt: 101_000 })]);
        f.publish([]); t.mock.timers.tick(3999); assert.match(f.render().join("\n"), /completed/);
        t.mock.timers.tick(1); assert.equal(f.widgets.size, 0);
        const writes = f.writes(); t.mock.timers.tick(10000); assert.equal(f.writes(), writes);
        f.publish([view("next")]);
        f.publish([]); f.emit("session_start", { ...f.ctx, sessionManager: SessionManager.inMemory("/tmp") });
        assert.deepEqual(cached.render(100), []); assert.equal(f.widgets.size, 0);
        f.publish([view("closing")]); await f.lifecycle.shutdown();
        const closedWrites = f.writes(); f.publish([view("late")]); f.emit("session_start"); t.mock.timers.tick(10000);
        assert.equal(f.writes(), closedWrites); assert.equal(f.widgets.size, 0); assert.equal(f.reads(), 0);
    } finally { f.dispose(); }
});
it("missing widget owner never bypasses display; actual waits appear independently of task mode and root visibility", async () => {
    const f = fixture(false, []);
    try {
        f.publish([view("owned", { executionMode: "owned" })]);
        assert.equal(f.writes(), 0); assert.equal(f.owner.canOpen(), true); assert.doesNotMatch(f.status()!, /waiting/);
        const a = f.coordinator.registerWait({ identity: view("retrieval"), label: "retrieval", kind: "retrieval" });
        const b = f.coordinator.registerWait({ identity: view("launch"), label: "launch", kind: "launch" });
        assert.match(stripTerminalSequences(f.status()!), /waiting 2 · \/task-detach Detach all waits/);
        f.publish([]); assert.match(f.status()!, /waiting 2/);
        assert.equal(f.coordinator.detachAll(), 2); assert.equal((await a.result).kind, "detached"); assert.equal((await b.result).kind, "detached");
        assert.equal(f.status(), undefined); assert.equal(f.writes(), 0);
    } finally { f.dispose(); }
});
it("failed central publication preserves finite metadata expiry without a visual clock or late revival", t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
    const f = fixture();
    const refresh = TaskOverviewModel.prototype.refresh;
    const snapshots: (readonly TaskView[])[] = [];
    t.mock.method(TaskOverviewModel.prototype, "refresh", function (this: TaskOverviewModel, views: readonly TaskView[], now: number) {
        const roots = refresh.call(this, views, now);
        snapshots.push(roots);
        return roots;
    });
    try {
        f.reenter(() => { throw new Error("host widget setter failed"); });
        f.publish([view("failed-sink", { status: "completed", endedAt: 100_000 })]);
        f.publish([]);
        const writes = f.writes(), reads = snapshots.length;
        t.mock.timers.tick(3999);
        assert.equal(snapshots.length, reads, "failed sink must not retain a per-second visual clock");
        t.mock.timers.tick(1);
        assert.deepEqual(snapshots.at(-1), [], "terminal metadata must expire without another source event");
        assert.equal(f.writes(), writes);
        t.mock.timers.tick(10_000); assert.equal(snapshots.length, reads + 1);
        t.mock.method(f.ctx.ui, "setStatus", () => { throw new Error("optional footer sink failed"); });
        f.reenter(); f.publish([view("fresh")]);
        assert.match(f.render().join("\n"), /Description fresh/);
        assert.doesNotMatch(f.render().join("\n"), /failed-sink/);
        assert.equal(f.reads(), 0);
    } finally { f.dispose(); }
});
it("same-activation session reset invalidates cached overview even with identical context/session identity", t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
    const f = fixture();
    try {
        f.publish([view("old", { status: "completed", endedAt: 100_000 })]);
        const cached = [...f.widgets.values()][0];
        f.publish([]); f.emit("session_start");
        assert.deepEqual(cached.render(100), []); assert.equal(f.widgets.size, 0);
        const writes = f.writes(); t.mock.timers.tick(10_000); assert.equal(f.writes(), writes);
    } finally { f.dispose(); }
});
it("widget setter shutdown reentry retires publication and timer without reviving UI", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
    const f = fixture();
    f.reenter(() => { f.reenter(); void f.lifecycle.shutdown(); });
    f.publish([view("reentrant")]); await f.lifecycle.shutdown();
    const writes = f.writes(); t.mock.timers.tick(10000); f.publish([view("late")]);
    assert.equal(f.widgets.size, 0); assert.equal(f.writes(), writes); assert.equal(f.status(), undefined);
    f.dispose();
});
it("theme/resize use current presentation; synchronous session reset during publication cannot leave old roots", async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
    const f = fixture();
    try {
        f.publish(Array.from({ length: 7 }, (_, i) => view(String(i))));
        f.terminal.rows = 14; assert.equal(f.render().length, 2); assert.match(f.render().at(-1)!, /\+6 hidden/);
        f.terminal.rows = 24;
        const currentTheme = f.ctx.ui.theme;
        Object.assign(f.ctx.ui, { theme: { ...currentTheme, fg: (_color: string, text: string) => `\u001b[36m${text}\u001b[39m` } });
        assert.match(f.render()[0], /\u001b\[36m/);
        const fresh = { ...f.ctx, sessionManager: SessionManager.inMemory("/tmp") };
        // An existing mount updates without a host setter, so withdraw before arming reentry.
        f.publish([]);
        f.reenter(() => { f.reenter(); f.publish([]); f.emit("session_start", fresh); });
        f.publish([view("obsolete")]);
        await Promise.resolve();
        assert.equal(f.widgets.size, 0); assert.equal(f.status(), undefined);
        const writes = f.writes(); t.mock.timers.tick(10000); assert.equal(f.writes(), writes);
        assert.equal(f.reads(), 0);
    } finally { f.dispose(); }
});
