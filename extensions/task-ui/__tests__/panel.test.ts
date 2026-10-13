import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { TaskCoordinator } from "../coordinator.ts";
import { TaskLifecycle } from "../lifecycle.ts";
import { DEFAULTS } from "../config.ts";
import { TaskPanel, cleanTaskText } from "../panel.ts";
import { TaskPanelModel, taskSummary } from "../model.ts";
import { createTaskUIOwner } from "../owner.ts";
import { registerTaskControls } from "../controls.ts";
import { taskKey, type TaskDetail, type TaskIdentity, type TaskSource, type TaskView } from "../types.ts";

function view(id: string, patch: Partial<TaskView> = {}): TaskView {
    const identity = { sourceId: "fixture", taskId: id, runId: "1" };
    return Object.freeze({ ...identity, key: taskKey(identity), kind: "agent", title: id, status: "running", executionMode: "foreground", waitCount: 0,
        stats: Object.freeze({}), artifacts: Object.freeze([{ kind: "conversation" as const, path: `/tmp/${id}.output` }]), capabilities: Object.freeze({ stop: true, details: true }), ...patch });
}
function sourceFixture(initial: readonly TaskView[]) {
    let views = initial, disposed = false, revision = 0;
    const listeners = new Set<() => void>(), reads: TaskIdentity[] = [], stops: TaskIdentity[] = [];
    const details = new Map(initial.map(row => [row.key, Object.freeze({ text: `detail ${row.title}`, path: row.artifacts[0]?.path, start: 20, end: 40, size: 100, omittedBefore: 20, omittedAfter: 60 }) as TaskDetail]));
    const source: TaskSource = {
        sourceId: "fixture", get revision() { return revision; }, list: () => disposed ? [] : views,
        detail(identity) { reads.push(identity); return details.get(taskKey(identity)); },
        stop(identity) { stops.push(identity); return views.some(view => view.key === taskKey(identity)); },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose() { disposed = true; listeners.clear(); },
    };
    const coordinator = new TaskCoordinator(); coordinator.registerSource(source);
    return { coordinator, source, details, reads, stops, subscribers: () => listeners.size,
        publish(next: readonly TaskView[]) { views = next; revision++; for (const listener of [...listeners]) listener(); },
    };
}
function component(f: ReturnType<typeof sourceFixture>, options: { now?: () => number; copy?: (path: string) => Promise<void> } = {}) {
    let closed = 0, renders = 0;
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal: { rows: 40 }, requestRender() { renders++; } } as never,
        done() { closed++; }, ...options });
    return { panel, closed: () => closed, renders: () => renders };
}

void it("shared panel shows all modes, immediate bounded details, focus/scroll, safe widths and path-only copy", async () => {
    const a = view("前台🦊\u001b[31m\u0007"), b = view("queued", { status: "queued", executionMode: "background", waitCount: 2, stats: { tokens: 12, toolUses: 3 } });
    const f = sourceFixture([a, b]);
    f.details.set(b.key, { text: Array.from({ length: 90 }, (_, i) => `line ${i} 中文😀\u001b]0;title\u0007\u0000`).join("\n"), omittedBefore: 8, omittedAfter: 9 });
    const copied: string[] = []; const h = component(f, { copy: async path => { copied.push(path); } });
    try {
        assert.match(h.panel.render(150).join("\n"), /foreground · waits 0/);
        assert.ok(f.reads.some(identity => identity.taskId === a.taskId));
        h.panel.handleInput("j");
        assert.equal(h.panel.model.selected?.key, b.key);
        const rendered = h.panel.render(180).join("\n");
        assert.match(rendered, /background · waits 2/); assert.match(rendered, /omitted before 8, after 9/); assert.match(rendered, /tokens: 12/);
        h.panel.handleInput("\t"); h.panel.handleInput("\u001b[H");
        const first = h.panel.render(180).join("\n"); assert.match(first, /line 0/);
        h.panel.handleInput("j"); assert.notEqual(h.panel.render(180).join("\n"), first);
        h.panel.handleInput("c"); await Promise.resolve(); assert.deepEqual(copied, ["/tmp/queued.output"]);
        for (const width of [0, 1, 7, 19, 20, 32, 50, 100]) for (const line of h.panel.render(width)) {
            // ScrollView/wrapping may add SDK-owned SGR resets. External OSC,
            // bells and controls are still forbidden after removing those styles.
            assert.ok(visibleWidth(line) <= width);
            assert.equal(cleanTaskText(line), stripTerminalSequences(line));
            assert.doesNotMatch(line.replace(/\u001b\[[0-9;]*m/g, ""), /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
        }
        assert.equal(f.stops.length, 0); h.panel.handleInput("\u001b"); assert.equal(h.closed(), 1); assert.equal(f.coordinator.waitCount, 0);
    } finally { h.panel.dispose(); f.coordinator.dispose(); }
});

void it("workflow and real ordinary parent tree default open; stable collapse survives refresh and new groups open", () => {
    const wf = view("wf", { kind: "workflow", stats: { doneCount: 1, totalCount: 2, phases: [{ index: 0, title: "Real phase" }] } });
    const child = view("child", { parentKey: wf.key, executionMode: "owned", status: "completed", endedAt: 0 });
    const parent = view("parent"), nested = view("nested", { parentKey: parent.key, executionMode: "owned" });
    const model = new TaskPanelModel();
    assert.deepEqual(model.refresh([wf, child, parent, nested], 100_000).map(row => [row.view.taskId, row.depth]), [["wf", 0], ["child", 1], ["parent", 0], ["nested", 1]]);
    model.collapse(wf.key);
    const next = view("new", { kind: "workflow" }), nextChild = view("new-child", { parentKey: next.key });
    assert.deepEqual(model.refresh([wf, child, parent, nested, next, nextChild], 101_000).map(row => row.view.taskId), ["wf", "parent", "nested", "new", "new-child"]);
    model.expand(wf.key); assert.equal(model.refresh([wf, child, parent, nested], 102_000).filter(row => row.view.taskId === "child").length, 1);
    model.dispose();
});

void it("whole-root terminal window and final selected detail survive source sweep until switching, never stale run stop", () => {
    let now = 100_000;
    const parent = view("wf", { kind: "workflow" }), child = view("child", { parentKey: parent.key, status: "completed", endedAt: 0 }), other = view("other");
    const f = sourceFixture([parent, child, other]), h = component(f, { now: () => now });
    try {
        h.panel.handleInput("j"); assert.equal(h.panel.model.selected?.key, child.key);
        f.details.set(child.key, { text: "FINAL bounded answer", omittedBefore: 100 });
        f.publish([view("wf", { ...parent, status: "completed", endedAt: now }), child, other]);
        assert.match(h.panel.render(150).join("\n"), /FINAL bounded answer/);
        now += 3999; assert.match(h.panel.render(150).join("\n"), /workflow wf/);
        f.publish([other]); // sweep before UI window expires must not split a completed group
        assert.match(h.panel.render(150).join("\n"), /workflow wf/);
        now++; const expired = h.panel.render(150).join("\n"); assert.doesNotMatch(expired, /workflow wf/); assert.match(expired, /FINAL bounded answer/);
        h.panel.handleInput("x"); assert.equal(f.stops.length, 0, "removed identity cannot stop a different resumed run");
        h.panel.handleInput("k"); assert.equal(h.panel.model.selected?.key, other.key); assert.doesNotMatch(h.panel.render(150).join("\n"), /FINAL bounded answer/);
        const resumed = view("child", { runId: "2", key: taskKey({ sourceId: "fixture", taskId: "child", runId: "2" }) });
        f.publish([other, resumed]); assert.equal(h.panel.model.selected?.key, other.key);
    } finally { h.panel.dispose(); f.coordinator.dispose(); }
});

void it("panel x routes queued/starting/paused capabilities, background chord detaches all; Esc never detaches", async () => {
    for (const status of ["queued", "starting", "paused"] as const) {
        const row = view(status, { status, kind: status === "paused" ? "workflow" : "agent" });
        const f = sourceFixture([row, view("sibling")]), h = component(f);
        const lease = f.coordinator.registerWait({ identity: row, kind: "retrieval", label: row.title });
        try {
            h.panel.handleInput("x"); assert.deepEqual(f.stops.map(identity => identity.taskId), [status]); assert.equal(f.coordinator.waitCount, 1);
            h.panel.handleInput("\u001b"); assert.equal(f.coordinator.waitCount, 1);
            const next = component(f); next.panel.handleInput("\u001b[98;6u"); assert.equal((await lease.result).kind, "detached"); next.panel.dispose();
        } finally { h.panel.dispose(); f.coordinator.dispose(); }
    }
});

void it("coordinator finite facade rejects unknown/stale/closed identities and limits preview reads", () => {
    const row = view("row"), f = sourceFixture([row]);
    f.details.set(row.key, { text: "a".repeat(20_000) });
    assert.equal(f.coordinator.detail(row, { limit: Infinity })?.text.length, 16_000);
    assert.equal(f.coordinator.detail({ ...row, runId: "stale" }), undefined);
    assert.equal(f.coordinator.stop({ ...row, sourceId: "unknown" }), false);
    f.coordinator.freezeAdmission(); assert.equal(f.coordinator.stop(row), false); assert.equal(f.coordinator.detail(row), undefined);
    f.coordinator.dispose(); assert.deepEqual(f.coordinator.list(), []); assert.equal(f.subscribers(), 0);
});

void it("footer counts only independent real work, including foreground-only and queue", () => {
    const wf = view("wf", { kind: "workflow" }), parent = view("parent"), shell = view("fg", { kind: "shell" });
    const views = [wf, view("child", { parentKey: wf.key }), parent, view("nested", { parentKey: parent.key }), shell, view("q", { status: "queued" }), view("monitor", { kind: "monitor" })];
    assert.equal(taskSummary(views), "shell: 1 active · monitor: 1 active · agent: 1 active / 1 queued · workflow: 1 active");
    assert.equal(taskSummary([view("done", { status: "completed" })]), undefined);
});

function uiFixture(f: ReturnType<typeof sourceFixture>, reenter: "status" | "custom" | "factory" | undefined = undefined) {
    const lifecycle = new TaskLifecycle(f.coordinator), handlers = new Set<(event: unknown, ctx: ExtensionContext) => unknown>();
    let opens = 0, panel: TaskPanel | undefined, completes = 0;
    const statuses: (string | undefined)[] = [];
    const ctx = { mode: "tui", hasUI: true, ui: { notify() {},
        setStatus(key: string, text: string | undefined) { assert.equal(key, "task-ui"); statuses.push(text); if (reenter === "status" && text) void lifecycle.shutdown(); },
        custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) {
            opens++;
            if (reenter === "custom") void lifecycle.shutdown();
            return new Promise<void>(resolve => {
                panel = factory({ terminal: { rows: 40 }, requestRender() {} } as never, { fg: (_: string, text: string) => text } as never, { matches: () => false } as never, () => { completes++; resolve(); }) as TaskPanel;
                if (reenter === "factory") void lifecycle.shutdown();
            });
        },
    } } as unknown as ExtensionContext;
    const pi = { on(_event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) { handlers.add(handler); return () => { handlers.delete(handler); }; } } as unknown as ExtensionAPI;
    const owner = createTaskUIOwner(pi, f.coordinator, lifecycle, DEFAULTS);
    return { lifecycle, owner, ctx, statuses, start() { for (const handler of [...handlers]) handler({}, ctx); }, opens: () => opens, panel: () => panel, handlers: () => handlers.size, completes: () => completes };
}
void it("one shared owner/explicit controls/overlay, lifecycle closes before wait disposal and unsubscribes", async () => {
    const f = sourceFixture([view("fg", { kind: "shell" })]), h = uiFixture(f);
    h.start(); h.start(); assert.equal(f.subscribers(), 1); assert.match(h.statuses[0]!, /shell: 1 active/);
    const commands = new Map<string, { handler(args: string, ctx: ExtensionContext): Promise<void> }>();
    const shortcuts = new Map<string, Parameters<ExtensionAPI["registerShortcut"]>[1]>();
    const controls: Pick<ExtensionAPI, "registerCommand" | "registerShortcut"> = { registerCommand(name, command) { commands.set(name, command); }, registerShortcut(key, shortcut) { shortcuts.set(key, shortcut); } };
    registerTaskControls(controls as ExtensionAPI, f.coordinator, DEFAULTS, h.owner.openPanel);
    const opening = commands.get("tasks")!.handler("", h.ctx); await shortcuts.get("shift+down")!.handler(h.ctx); assert.equal(h.opens(), 1);
    f.coordinator.registerWait({ identity: view("fg"), kind: "launch", label: "fg", onDispose() { assert.equal(h.panel()?.render(100).length, 0); } });
    await h.lifecycle.shutdown(); await opening;
    assert.equal(h.completes(), 1); assert.equal(h.handlers(), 0); assert.equal(f.subscribers(), 0); assert.equal(h.statuses.at(-1), undefined);
    await h.owner.openPanel(h.ctx); assert.equal(h.opens(), 1); h.owner.dispose();
});
for (const reenter of ["status", "custom", "factory"] as const) void it(`shared UI ${reenter} shutdown reentry cannot resurrect subscribers/timers/overlay`, async () => {
    const f = sourceFixture([view("row")]), h = uiFixture(f, reenter);
    h.start(); await h.owner.openPanel(h.ctx); await h.lifecycle.shutdown();
    assert.equal(h.handlers(), 0); assert.equal(f.subscribers(), 0); assert.equal(h.panel()?.render(80).length ?? 0, 0);
    const before = h.statuses.length; f.publish([view("late")]); h.start(); await h.owner.openPanel(h.ctx); assert.equal(h.statuses.length, before);
    h.owner.dispose();
});
