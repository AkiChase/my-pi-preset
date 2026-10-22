import { loadNativeLayout } from "../../shared/scroll-panel/native-layout.ts";
const layout = await loadNativeLayout();
import assert from "node:assert/strict";
import { it } from "node:test";
import { createEventBus, SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import "../../agent-tasks/__tests__/source-loader.mjs";
import type { AgentManager } from "../../agent-tasks/src/agent-manager.ts";
import type { AgentRecord } from "../../agent-tasks/src/types.ts";
const { createAgentTaskSource } = await import("../../agent-tasks/src/source.ts");
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
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal: { rows: 40 }, requestRender() { renders++; } } as never,
        done() { closed++; }, ...options });
    return { panel, closed: () => closed, renders: () => renders };
}

void it("shared panel shows all modes, bounded details, list/detail scroll, safe widths and path-only copy", async () => {
    const a = view("前台🦊\u001b[31m\u0007"), b = view("queued", { status: "queued", executionMode: "background", waitCount: 2, stats: { tokens: 12, toolUses: 3 } });
    const f = sourceFixture([a, b]);
    f.details.set(b.key, { text: Array.from({ length: 90 }, (_, i) => `line ${i} 中文😀\u001b]0;title\u0007\u0000`).join("\n"), omittedBefore: 8, omittedAfter: 9 });
    const copied: string[] = []; const h = component(f, { copy: async path => { copied.push(path); } });
    try {
        assert.match(h.panel.render(150).join("\n"), /Agents/);
        h.panel.handleInput("\r");
        assert.match(h.panel.render(150).join("\n"), /agent · foreground/);
        h.panel.handleInput("\u001b");
        assert.ok(f.reads.some(identity => identity.taskId === a.taskId));
        h.panel.handleInput("j");
        assert.equal(h.panel.model.selected?.key, b.key);
        h.panel.handleInput("\r");
        const rendered = h.panel.render(180).join("\n");
        assert.match(rendered, /agent · background/); assert.match(rendered, /queued/); assert.match(rendered, /omitted before 8, after 9/);
        assert.match(rendered, /Tokens\s+12/); assert.match(rendered, /Activity\s+3 tool uses/); assert.doesNotMatch(rendered, /tokens: |toolUses|\{"/);
        h.panel.handleInput("\u001b[H");
        const first = h.panel.render(180).join("\n"); assert.match(first, /line 0/);
        h.panel.handleInput("j"); assert.notEqual(h.panel.render(180).join("\n"), first);
        h.panel.handleInput("c"); await Promise.resolve(); assert.deepEqual(copied, ["/tmp/queued.output"]);
        for (const width of [0, 1, 7, 19, 20, 32, 50, 100]) for (const line of h.panel.render(width)) {
            // ScrollView/wrapping may add SDK-owned SGR resets. External OSC,
            // bells and controls are still forbidden after removing those styles.
            assert.ok(visibleWidth(line) <= width);
            assert.equal(cleanTaskText(line), stripTerminalSequences(line));
            // Native layout adds its own hyperlink-close sequence beside the scrollbar.
            // External OSC payloads were sanitized before that host-owned boundary.
            assert.doesNotMatch(stripTerminalSequences(line), /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
            assert.doesNotMatch(line, /title\u0007/);
        }
        assert.equal(f.stops.length, 0); h.panel.handleInput("\u001b"); assert.equal(h.closed(), 0); h.panel.handleInput("\u001b"); assert.equal(h.closed(), 1); assert.equal(f.coordinator.waitCount, 0);
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
        h.panel.handleInput("\r");
        assert.match(h.panel.render(150).join("\n"), /FINAL bounded answer/);
        h.panel.handleInput("\u001b");
        now += 3999; assert.match(h.panel.render(150).join("\n"), /workflow wf/);
        f.publish([other]); // sweep before UI window expires must not split a completed group
        assert.match(h.panel.render(150).join("\n"), /workflow wf/);
        now++; f.publish([other]); h.panel.handleInput("\r"); const expired = h.panel.render(150).join("\n"); assert.doesNotMatch(expired, /workflow wf/); assert.match(expired, /FINAL bounded answer/);
        h.panel.handleInput("x"); assert.equal(f.stops.length, 0, "removed identity cannot stop a different resumed run");
        h.panel.handleInput("\u001b"); h.panel.handleInput("k"); assert.equal(h.panel.model.selected?.key, other.key); assert.doesNotMatch(h.panel.render(150).join("\n"), /FINAL bounded answer/);
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
    const lifecycle = new TaskLifecycle(f.coordinator), handlers = new Map<string, Set<(event: unknown, ctx: ExtensionContext) => unknown>>();
    let opens = 0, panel: TaskPanel | undefined, completes = 0;
    const statuses: (string | undefined)[] = [];
    const ctx = { sessionManager: SessionManager.inMemory("/tmp"), mode: "tui", hasUI: true, ui: { theme: { fg: (_color: string, text: string) => text }, notify() {},
        setStatus(key: string, text: string | undefined) { assert.equal(key, "task-ui"); statuses.push(text); if (reenter === "status" && text) void lifecycle.shutdown(); },
        custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0], options: Parameters<ExtensionContext["ui"]["custom"]>[1]) {
            opens++;
            if (reenter === "custom") void lifecycle.shutdown();
            return new Promise<void>(resolve => {
                panel = factory({ terminal: { rows: 40 }, requestRender() {} } as never, { fg: (_: string, text: string) => text } as never, { matches: () => false } as never, () => { completes++; resolve(); }) as TaskPanel;
                if (reenter === "factory") void lifecycle.shutdown();
                options?.onHandle?.({} as never);
            });
        },
    } } as unknown as ExtensionContext;
    const pi = { events: createEventBus(), on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) { const set = handlers.get(event) ?? new Set(); set.add(handler); handlers.set(event, set); return () => { set.delete(handler); }; } } as unknown as ExtensionAPI;
    const owner = createTaskUIOwner(pi, f.coordinator, lifecycle, DEFAULTS, { loadLayout: async () => layout });
    return { lifecycle, owner, ctx, statuses, start() { for (const handler of [...handlers.get("session_start") ?? []]) handler({}, ctx); }, opens: () => opens, panel: () => panel, handlers: () => [...handlers.values()].reduce((n, set) => n + set.size, 0), completes: () => completes };
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

void it("native list/detail wheel containment, fixed frames, keyboard ensure and clock refresh without detail I/O in render", t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const f = sourceFixture(Array.from({ length: 80 }, (_, i) => view(`row-${i}`, { kind: i > 59 ? "shell" : "agent" })));
    const h = component(f);
    const terminal = { rows: 12, columns: 60 };
    // Use the actual component geometry with a resizeable terminal surface.
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    try {
        const beforeReads = f.reads.length;
        const first = panel.render(60);
        assert.equal(first.length, 12); assert.match(first[0], /Task Panel/); assert.match(first.join("\n"), /Esc Close/);
        assert.ok(first.some(line => line.includes("┃")));
        panel.render(60); assert.equal(f.reads.length, beforeReads, "render must not invoke bounded detail");
        const key = panel.model.selected?.key;
        const wheel = (x: number, y: number, wheelDelta: number) => panel.handleMouse({ type: "wheel", x, y, wheelDelta } as never);
        assert.deepEqual(wheel(2, 3, 30), { handled: true });
        assert.equal(panel.getState().listScrollTop, 30); assert.equal(panel.model.selected?.key, key);
        for (const [x, y] of [[0, 0], [0, 10], [0, 11], [-1, 3], [60, 3]]) assert.deepEqual(wheel(x, y, 9), { handled: true });
        assert.equal(panel.getState().listScrollTop, 30, "fixed rows/outside boundary consume without scrolling");
        t.mock.timers.tick(1000); panel.render(60); assert.equal(panel.getState().listScrollTop, 30, "clock must not ensure the old selection");
        terminal.rows = 8; panel.render(60); assert.equal(panel.getState().listScrollTop, 30, "resize does not recall a wheeled-away selection");
        panel.handleInput("j"); panel.render(60); assert.ok(panel.getState().listScrollTop <= 2, "keyboard selection ensures visibility");
        panel.handleInput("\u001b[F"); panel.render(60); assert.equal(panel.model.selected?.taskId, "row-79"); assert.ok(panel.getState().listScrollTop > 60);
        const listTop = panel.getState().listScrollTop;
        panel.handleInput("\r"); panel.render(60); assert.equal(panel.getState().page, "detail");
        panel.handleInput("\u001b"); panel.render(60); assert.equal(panel.getState().listScrollTop, listTop);
        panel.handleInput("\t"); panel.handleInput("\u001b[5~"); assert.equal(panel.getState().page, "list"); assert.equal(panel.model.selected?.taskId, "row-79");
        for (const rows of [1, 2, 3, 20]) for (const width of [1, 2, 8, 60]) {
            terminal.rows = rows; terminal.columns = width; panel.invalidate(); const frame = panel.render(width);
            assert.equal(frame.length, rows); assert.ok(frame.every(line => visibleWidth(line) === width));
        }
    } finally { panel.dispose(); h.panel.dispose(); f.coordinator.dispose(); }
});

void it("detail truncates fixed metadata and keeps body/status/actions visible while scrolling only output", () => {
    const command = "TRELLIS_CONTEXT_ID=source_123 " + "完整命令中文 ".repeat(30) + "COMMAND_END";
    const row = view("long", { kind: "shell", title: "原始标题 ".repeat(20) + "TITLE_END", description: command,
        stats: { phases: Array.from({ length: 12 }, (_, index) => ({ index, title: `Phase-${index}`, detail: "阶段 ".repeat(10) + `PHASE_END_${index}` })) } });
    const f = sourceFixture([row]);
    f.details.set(row.key, { text: Array.from({ length: 60 }, (_, i) => `log-${i}`).join("\n"), start: 200, end: 600, size: 2000, omittedBefore: 200, omittedAfter: 1400 });
    const terminal = { rows: 8, columns: 40 };
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    try {
        panel.handleInput("\r");
        const latest = panel.render(40).map(stripTerminalSequences);
        assert.match(latest.join("\n"), /log-59/);
        assert.match(latest.join("\n"), /●/);
        assert.doesNotMatch(latest.join("\n"), /TITLE_END|COMMAND_END|PHASE_END/);
        panel.handleInput("\u001b[H");
        assert.match(panel.render(40).join("\n"), /log-0/);
        panel.handleInput("j");
        const fixed = panel.render(40).map(stripTerminalSequences);
        assert.deepEqual(fixed.slice(0, 2), latest.slice(0, 2));
        panel.handleInput("\u001b[F");
        const top = panel.getState().detailScrollTop; f.publish([row]); panel.render(40); assert.equal(panel.getState().detailScrollTop, top);
        panel.handleMouse({ type: "wheel", x: 1, y: 4, wheelDelta: 100 } as never); assert.equal(panel.model.selected?.key, row.key);
        panel.handleInput("\u001b"); panel.handleInput("\r"); assert.equal(panel.getState().detailScrollTop, top, "same selected detail retains its independent viewport");
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("owner fences pending native load and never calls done until its own onHandle installation", async () => {
    const f = sourceFixture([view("row")]), lifecycle = new TaskLifecycle(f.coordinator);
    let resolveLayout!: (native: typeof layout) => void, opens = 0;
    const pi = { on() { return () => {}; } } as unknown as ExtensionAPI;
    const ctx = { mode: "tui", ui: { custom() { opens++; }, notify() {} } } as unknown as ExtensionContext;
    const pending = createTaskUIOwner(pi, f.coordinator, lifecycle, DEFAULTS, { loadLayout: () => new Promise(resolve => { resolveLayout = resolve; }) });
    const opening = pending.openPanel(ctx); await lifecycle.shutdown(); resolveLayout(layout); await opening; assert.equal(opens, 0); pending.dispose();

    const next = sourceFixture([view("row")]), life = new TaskLifecycle(next.coordinator);
    let onHandle!: () => void, doneCount = 0, panel!: TaskPanel;
    const delayedCtx = { mode: "tui", ui: { theme: { fg: (_: string, text: string) => text }, notify() {},
        custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0], options: Parameters<ExtensionContext["ui"]["custom"]>[1]) {
            return new Promise<void>(resolve => {
                panel = factory({ terminal: { rows: 10, columns: 60 }, requestRender() {} } as never, {} as never, { matches: () => false } as never, () => { doneCount++; resolve(); }) as TaskPanel;
                onHandle = () => options?.onHandle?.({} as never);
                assert.deepEqual(options?.overlayOptions, { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 });
            });
        },
    } } as unknown as ExtensionContext;
    const owner = createTaskUIOwner(pi, next.coordinator, life, DEFAULTS, { loadLayout: async () => layout });
    const installed = owner.openPanel(delayedCtx); await Promise.resolve();
    await life.shutdown(); assert.equal(doneCount, 0, "a different topmost interaction cannot be popped during setup"); assert.deepEqual(panel.render(60), []);
    onHandle(); onHandle(); await installed; assert.equal(doneCount, 1); owner.dispose();
});

void it("Agents precede Processes with one tree selection; detail return preserves collapse and source reparent reconciles", () => {
    const process = view("process", { kind: "shell" }), root = view("root", { kind: "workflow" }), child = view("child", { parentKey: root.key });
    const f = sourceFixture([process, root, child]), h = component(f);
    try {
        assert.equal(h.panel.model.selected?.key, root.key);
        const frame = h.panel.render(120).join("\n"); assert.ok(frame.indexOf("Agents") < frame.indexOf("Processes"));
        h.panel.handleInput("\u001b[D"); assert.equal(h.panel.model.isCollapsed(root.key), true);
        h.panel.handleInput("\r"); h.panel.handleInput("\u001b"); assert.equal(h.panel.model.isCollapsed(root.key), true);
        h.panel.handleInput("j"); assert.equal(h.panel.model.selected?.key, process.key);
        f.publish([root, child, { ...process, kind: "agent", parentKey: root.key }]);
        assert.equal(h.panel.model.selected?.key, root.key, "hidden selection reconciles to the real collapsed ancestor");
        assert.doesNotMatch(h.panel.render(120).join("\n"), /agent process/);
    } finally { h.panel.dispose(); f.coordinator.dispose(); }
});

void it("native incompatibility refuses open/frame without manual fallback and releases interaction resources", async () => {
    const f = sourceFixture([view("row")]), lifecycle = new TaskLifecycle(f.coordinator);
    const notices: string[] = []; let opens = 0;
    const pi = { on() { return () => {}; } } as unknown as ExtensionAPI;
    const ctx = { mode: "tui", ui: { notify(message: string) { notices.push(message); }, custom() { opens++; } } } as unknown as ExtensionContext;
    const owner = createTaskUIOwner(pi, f.coordinator, lifecycle, DEFAULTS, { loadLayout: async () => { throw new Error("incompatible"); } });
    await owner.openPanel(ctx); assert.equal(opens, 0); assert.match(notices[0], /Task Panel unavailable/); assert.equal(owner.canOpen(), true);
    let done = 0;
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout: { ...layout, render() { throw new Error("bad frame"); } }, ctx,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal: { rows: 4, columns: 30 }, requestRender() {} } as never, done() { done++; } });
    assert.equal(panel.render(30).length, 4); assert.equal(done, 1); assert.deepEqual(panel.render(30), []); panel.dispose(); assert.equal(done, 1);
    owner.dispose(); await lifecycle.shutdown();
});

void it("synchronous source publication coalesces detail refresh and cannot recursively overwrite the selected preview", async () => {
    const a = view("a"), b = view("b"), f = sourceFixture([a, b]), h = component(f);
    let depth = 0, maxDepth = 0, once = true;
    const original = f.source.detail.bind(f.source);
    f.source.detail = identity => {
        depth++; maxDepth = Math.max(maxDepth, depth);
        try {
            if (once) {
                once = false;
                h.panel.handleInput("j");
                f.publish([a, b]);
                return { text: "STALE_A_PREVIEW" };
            }
            return original(identity);
        } finally { depth--; }
    };
    try {
        f.publish([a, b]);
        await Promise.resolve();
        h.panel.handleInput("\r");
        assert.equal(maxDepth, 1);
        assert.equal(h.panel.model.selected?.key, b.key);
        const frame = h.panel.render(120).join("\n");
        assert.match(frame, /detail b/); assert.doesNotMatch(frame, /STALE_A_PREVIEW/);
        f.publish([a, b]); h.panel.dispose(); await Promise.resolve();
        assert.deepEqual(h.panel.render(120), []);
    } finally { h.panel.dispose(); f.coordinator.dispose(); }
});

void it("wrapped fixed footer preserves selected and global actions on narrow screens and uses actual Processes row index", () => {
    const process = view("process", { kind: "shell" }), f = sourceFixture([process]);
    const terminal = { columns: 40, rows: 12 };
    const panel = new TaskPanel({ coordinator: f.coordinator, config: { ...DEFAULTS, shortcutBackground: [] }, layout,
        ctx: { ui: { notify() {} } } as unknown as ExtensionContext, theme: { fg: (_color, text) => text },
        keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    try {
        for (const width of [30, 40, 60, 80]) {
            terminal.columns = width;
            const frame = stripTerminalSequences(panel.render(width).join("\n"));
            for (const hint of ["Esc Close", "x Stop", "c Copy", "/task-detach", "All waits"]) {
                assert.match(frame.toLowerCase(), new RegExp(hint.toLowerCase()), `${width}: ${hint}`);
            }
        }
        terminal.columns = 40; panel.render(40);
        panel.handleMouse({ type: "wheel", x: 1, y: 3, wheelDelta: 100 } as never);
        panel.handleInput("\u001b[F");
        assert.match(panel.render(40).join("\n"), /shell process/, "empty Agents body counts as an actual row");
        panel.handleInput("\r");
        const detail = stripTerminalSequences(panel.render(40).join("\n"));
        assert.match(detail, /Esc Back/); assert.match(detail, /x Stop/); assert.match(detail, /c Copy/); assert.match(detail, /All waits/);
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("stop and detach-all keep the header height and scroll origin fixed (no feedback row)", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => view(`row-${i}`));
    const f = sourceFixture(rows), terminal = { rows: 12, columns: 60 };
    const lease = f.coordinator.registerWait({ identity: rows[0], kind: "retrieval", label: "row-0" });
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    try {
        for (const page of ["list", "detail"] as const) {
            if (page === "detail") panel.handleInput("\r");
            const before = panel.render(60).map(line => stripTerminalSequences(line));
            panel.handleInput("x");
            const afterStop = panel.render(60).map(line => stripTerminalSequences(line));
            assert.deepEqual(afterStop.slice(0, 3), before.slice(0, 3), `${page}: stop must not insert a row`);
            assert.doesNotMatch(afterStop.join("\n"), /Stop requested|no longer stoppable/);
        }
        panel.handleInput("\u001b[98;6u"); assert.equal((await lease.result).kind, "detached");
        assert.doesNotMatch(panel.render(60).join("\n"), /Released/);
        assert.equal(f.stops.length, 2);
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("detail renders kind-specific labelled sections without raw stats or JSON", () => {
    const agent = view("agent", { title: "Explore", description: "Inspect the login flow", stats: { model: "provider/model-x", thinking: "high", durationMs: 83_000,
        turnCount: 4, maxTurns: 20, toolUses: 1, tokens: 51_234, inputTokens: 40_100, outputTokens: 11_134, cost: 0.034, activity: "reading src/a.ts" },
        executionConfig: { kind: "agent", phase: "session-effective", model: "provider/model-x", inherit_context: true, differences: [{ field: "thinking", requested: "low", actual: "high", reason: "agent-configuration" }] } });
    const failed = view("sh", { kind: "shell", status: "failed", title: "tests", description: "npm test", stats: { pid: 42, exitCode: 2, durationMs: 1000 },
        artifacts: [{ kind: "log", path: "/tmp/sh.log" }] });
    const monitor = view("mon", { kind: "monitor", description: "tail -f x", stats: { pid: 7 }, artifacts: [],
        executionConfig: { kind: "monitor", mode: "background", timeout_ms: 600_000, wake_absent_ms: null, batch_interval_ms: 200 } });
    const f = sourceFixture([agent, failed, monitor]);
    const colors: string[] = [];
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (color, text) => { colors.push(`${color}:${text}`); return text; } }, keys: { matches: () => false }, tui: { terminal: { rows: 60, columns: 100 }, requestRender() {} } as never, done() {} });
    const detail = (key: string) => { panel.model.select(f.coordinator.list().find(row => row.key === key)!); panel.handleInput("\r"); const text = stripTerminalSequences(panel.render(100).join("\n")); panel.handleInput("\u001b"); return text; };
    try {
        const a = detail(agent.key);
        for (const pattern of [/Inspect the login flow/, /Model\s+provider\/model-x · thinking high/, /Context\s+inherits context/, /Override\s+thinking: low → high/,
            /1m23s/, /Activity\s+4\/20 turns · 1 tool use/, /Tokens\s+51\.2k \(in 40\.1k · out 11\.1k\)/, /\$0\.03/, /reading src\/a\.ts/, /conversation\s+\/tmp\/agent.output/, /── Output · 20–40 \/ 100/])
            assert.match(a, pattern);
        assert.doesNotMatch(a, /\{"|durationMs|inputTokens|Execution config/);
        const s = detail(failed.key);
        for (const pattern of [/shell · foreground/, /PID\s+42/, /Exit\s+2/, /\$ npm test/, /log\s+\/tmp\/sh\.log/]) assert.match(s, pattern);
        assert.ok(colors.includes("error:2"), "non-zero exit uses the error color");
        const m = detail(monitor.key);
        assert.match(m, /Monitor\s+deadline 10m · batch 200ms/);
        assert.doesNotMatch(m, /── Artifacts/);
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("structured conversation replaces the raw output body, with running activity", () => {
    const row = view("agent", { stats: { activity: "reading a.ts" } });
    const f = sourceFixture([row]);
    f.details.set(row.key, { text: '{"type":"user","message":{"role":"user"}}', conversationTruncated: true,
        conversation: [{ kind: "user", text: "do it" }, { kind: "assistant", text: "**done**", tools: [{ name: "read", detail: "a.ts" }] }] });
    const h = component(f);
    try {
        h.panel.handleInput("\r");
        const frame = stripTerminalSequences(h.panel.render(100).join("\n"));
        for (const pattern of [/── Conversation · 2 messages \(latest\)/, /older messages omitted/, /User/, /do it/, /Assistant/, /done/, /⏺ read {2}a\.ts/, /reading a\.ts/]) assert.match(frame, pattern);
        assert.doesNotMatch(frame, /"type":"user"|── Output|\*\*done\*\*/);
    } finally { h.panel.dispose(); f.coordinator.dispose(); }
});

void it("detail Enter opens a steering composer that owns input, keeps footer height and targets the opened identity", () => {
    const running = view("live", { capabilities: { stop: true, details: true, steer: true } }), done = view("done", { status: "completed", endedAt: Date.now() });
    const f = sourceFixture([running, done]);
    const sent: [string, string][] = [];
    f.source.steer = (identity, message) => { sent.push([identity.taskId, message]); return true; };
    const notices: string[] = [];
    const terminal = { rows: 16, columns: 80 };
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify(message: string) { notices.push(message); } } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    try {
        panel.handleInput("\r");
        const before = panel.render(80).map(stripTerminalSequences);
        assert.match(before.join("\n"), /Enter Message/);
        panel.handleInput("\r");
        const open = panel.render(80).map(stripTerminalSequences);
        assert.equal(open.length, before.length); assert.match(open.join("\n"), /› Message the agent/);
        assert.deepEqual(open.slice(0, 3), before.slice(0, 3), "body origin unchanged");
        for (const ch of "x focus") panel.handleInput(ch);
        assert.equal(f.stops.length, 0, "x is typed into the composer, not a stop");
        panel.handleInput("\r");
        assert.deepEqual(sent, [["live", "x focus"]]);
        assert.doesNotMatch(panel.render(80).join("\n"), /›/);
        panel.handleInput("\r"); panel.handleInput("a"); panel.handleInput("\u001b");
        assert.equal(sent.length, 1, "Esc cancels without sending"); assert.equal(panel.getState().page, "detail", "Esc closes only the composer");
        panel.handleInput("\u001b"); panel.handleInput("j"); panel.handleInput("\r");
        assert.doesNotMatch(panel.render(80).join("\n"), /Enter Message/);
        panel.handleInput("\r"); assert.doesNotMatch(panel.render(80).join("\n"), /›/, "non-steerable rows never open a composer");
        f.source.steer = () => false;
        panel.handleInput("\u001b"); panel.handleInput("k"); panel.handleInput("\r"); panel.handleInput("\r"); panel.handleInput("y"); panel.handleInput("\r");
        assert.match(notices.join("\n"), /not delivered/);
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("p/s/r route only advertised workflow controls and the footer lists exactly those", () => {
    const wf = view("wf", { kind: "workflow", capabilities: { stop: true, details: true, pause: true } });
    const child = view("child", { parentKey: wf.key, executionMode: "owned", capabilities: { stop: true, details: true, skip: true } });
    const f = sourceFixture([wf, child]);
    const controls: string[] = [];
    f.source.control = (identity, action) => { controls.push(`${identity.taskId}:${action}`); return true; };
    const h = component(f);
    try {
        let frame = stripTerminalSequences(h.panel.render(160).join("\n"));
        assert.match(frame, /p Pause/); assert.doesNotMatch(frame, /s Skip|r Retry|p Resume/);
        h.panel.handleInput("s"); h.panel.handleInput("r"); h.panel.handleInput("p");
        h.panel.handleInput("j");
        frame = stripTerminalSequences(h.panel.render(160).join("\n"));
        assert.match(frame, /s Skip/); assert.doesNotMatch(frame, /p Pause|r Retry/);
        h.panel.handleInput("r"); h.panel.handleInput("p"); h.panel.handleInput("s");
        assert.deepEqual(controls, ["wf:pause", "child:skip"]);
    } finally { h.panel.dispose(); f.coordinator.dispose(); }
});

void it("steering composer forwards focus for the IME cursor and keeps footer height when hints wrap", () => {
    const f = sourceFixture([view("live", { capabilities: { stop: true, details: true, steer: true } })]);
    const terminal = { rows: 16, columns: 18 };
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    try {
        panel.focused = true;
        panel.handleInput("\r");
        const before = panel.render(18).map(stripTerminalSequences);
        panel.handleInput("\r"); panel.handleInput("h");
        const raw = panel.render(18);
        assert.ok(raw.some(line => line.includes(CURSOR_MARKER)), "focused composer emits the hardware cursor marker");
        const open = raw.map(stripTerminalSequences);
        assert.equal(open.length, before.length);
        assert.equal(open.findIndex(line => line.startsWith("›")), before.findIndex(line => /Esc Back/.test(line)), "composer replaces the first hint row in place");
        assert.equal(open.filter(line => /waiting 0/.test(line)).length, 1);
        assert.equal(open.findIndex(line => /waiting 0/.test(line)), before.findIndex(line => /waiting 0/.test(line)), "action rows keep their position");
        panel.focused = false;
        assert.ok(!panel.render(18).some(line => line.includes(CURSOR_MARKER)), "blur propagates to the composer");
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("paged detail anchors prepend/eviction, preserves history on source events and End fetches actual latest", () => {
    const row = view("paged"), f = sourceFixture([row]);
    const requests: string[] = [];
    let latest = 5;
    let afterAnchor: string | undefined;
    let snapshotAtAfter: (() => string | undefined) | undefined;
    const make = (n: number) => ({ entries: Array.from({ length: 8 }, (_, i) => ({ id: `${n}:${i}`, kind: "user" as const, text: `PAGE-${n}-ENTRY-${i}` })),
        before: `before:${n}`, after: `after:${n}`, hasOlder: n > 0, hasNewer: n < latest, source: "live" as const,
        status: "ok" as const, budgetLimited: false, scannedBytes: 100, scannedMessages: 8, generation: "g" });
    f.source.detail = (_identity, request) => {
        const p = request?.conversationPage, direction = p?.direction ?? "latest";
        requests.push(direction);
        if (direction === "after") afterAnchor = snapshotAtAfter?.();
        const cursor = Number(p?.cursor?.split(":")[1]);
        const n = direction === "latest" ? latest : direction === "before" ? cursor - 1 : cursor + 1;
        const page = make(n);
        return { text: "", conversation: page.entries, conversationPage: page };
    };
    const terminal = { rows: 18, columns: 80 };
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    const plain = () => panel.render(80).map(stripTerminalSequences);
    const body = () => plain().filter(line => /PAGE-/.test(line)).map(line => line.trim());
    snapshotAtAfter = () => {
        const state = panel as unknown as { cachedDetail?: { lines: string[] } };
        return state.cachedDetail?.lines.slice(panel.getState().detailScrollTop).map(stripTerminalSequences).find(line => /PAGE-/.test(line))?.trim();
    };
    try {
        panel.handleInput("\r"); assert.match(plain().join("\n"), /PAGE-5-ENTRY-7/); assert.equal(panel.getState().followingEnd, true);
        panel.handleInput("\u001b[H"); plain();
        assert.equal(requests.at(-1), "before"); assert.equal(panel.getState().historyPages, 2);
        assert.match(body()[0], /PAGE-5-ENTRY-0/, "prepend keeps first visible stable entry and row offset");
        // Every Home is a user request, not an unbounded automatic empty-page loop.
        for (let n = 0; n < 3; n++) {
            panel.handleInput("\u001b[H"); plain();
            assert.match(body()[0], new RegExp(`PAGE-${4 - n}-ENTRY-0`), "prepend plus far-tail eviction preserve the anchor");
            assert.ok(panel.getState().historyPages <= 3);
        }
        assert.equal(panel.getState().historyPages, 3);
        const before = body(), top = panel.getState().detailScrollTop;
        latest = 6; f.publish([row]);
        assert.deepEqual(body(), before); assert.equal(panel.getState().detailScrollTop, top);
        assert.equal(panel.getState().followingEnd, false, "latest source updates cannot steal history position");
        // Scroll into the newer evicted edge; the source after cursor reloads it.
        panel.handleMouse({ type: "wheel", x: 1, y: 11, wheelDelta: 10000 } as never); plain();
        assert.equal(requests.at(-1), "after"); assert.ok(panel.getState().historyPages <= 3);
        assert.equal(body()[0]?.replace(/\s+[│┃]$/, ""), afterAnchor, "forward prepend eviction preserves the first visible entry and its nonzero page offset");
        panel.handleInput("\u001b[F");
        assert.equal(requests.at(-1), "latest"); assert.match(plain().join("\n"), /PAGE-6-ENTRY-7/);
        assert.equal(panel.getState().followingEnd, true); assert.equal(panel.getState().historyPages, 1);
        latest = 7; f.publish([row]); assert.match(plain().join("\n"), /PAGE-7-ENTRY-7/);
        assert.equal(panel.getState().historyPages, 1, "ordinary latest refresh cannot accumulate pages");
        terminal.columns = 24; terminal.rows = 9;
        assert.equal(panel.render(24).length, 9);
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("native clipped mouse clicks expand only one stable entry, after scrolling; other text/buttons pass through", () => {
    const row = view("click"), f = sourceFixture([row]);
    const entries = Array.from({ length: 5 }, (_, i) => ({ id: `tool-${i}`, kind: "toolResult" as const, name: "read", text: Array.from({ length: 20 }, (_, n) => `TOOL-${i}-LINE-${n}`).join("\n"), elided: 0 }));
    f.details.set(row.key, { text: "", conversation: entries });
    const terminal = { rows: 18, columns: 80 };
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    const click = (x: number, y: number, button = "left") => panel.handleMouse({ type: "click", button, x, y } as never);
    try {
        panel.handleInput("\r"); panel.render(80);
        panel.handleMouse({ type: "wheel", x: 1, y: 11, wheelDelta: -5 } as never);
        const before = panel.render(80).map(stripTerminalSequences);
        const hit = before.findIndex(line => /TOOL-4-LINE/.test(line)); assert.ok(hit >= 0);
        assert.equal(click(1, hit, "right"), undefined); assert.equal(click(1, 0), undefined); assert.equal(click(79, hit), undefined);
        assert.deepEqual(click(1, hit), { handled: true });
        let after = panel.render(80).map(stripTerminalSequences);
        assert.ok(after.some(line => /click to collapse/.test(line)), "scrollTop/native clip must map to the clicked tool ID");
        panel.handleInput("\u001b[F"); after = panel.render(80).map(stripTerminalSequences);
        // End re-reads same-task raw source without losing per-entry expansion.
        assert.ok(after.some(line => /TOOL-4-LINE-19/.test(line)));
        panel.handleInput("\u001b[H"); const first = panel.render(80).map(stripTerminalSequences);
        assert.ok(first.some(line => /click to expand/.test(line)), "other entries remain collapsed");
        f.publish([row]); panel.handleInput("\u001b[F"); assert.match(panel.render(80).join("\n"), /TOOL-4-LINE-19/);
        f.details.set(row.key, { text: "", conversation: [{ id: "text", kind: "user", text: "NORMAL TEXT" }] }); f.publish([row]); panel.handleInput("\u001b[F");
        const normal = panel.render(80).map(stripTerminalSequences).findIndex(line => /NORMAL TEXT/.test(line));
        assert.equal(click(1, normal), undefined);
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("clock refresh performs zero detail IO and dispose clears timers", t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    for (const animations of [true, false]) {
        const f = sourceFixture([view("clock", { startedAt: 0 })]);
        let renders = 0;
        const panel = new TaskPanel({ coordinator: f.coordinator, config: { ...DEFAULTS, animations }, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
            theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal: { rows: 18, columns: 80 }, requestRender() { renders++; } } as never, done() {} });
        try {
            panel.handleInput("\r"); const first = stripTerminalSequences(panel.render(80).join("\n")), reads = f.reads.length;
            t.mock.timers.tick(250); const second = stripTerminalSequences(panel.render(80).join("\n"));
            assert.equal(second, first);
            t.mock.timers.tick(2000); panel.render(80); assert.equal(f.reads.length, reads);
            panel.dispose(); const count = renders; t.mock.timers.tick(5000);
            assert.equal(renders, count); assert.equal(f.reads.length, reads);
        } finally { panel.dispose(); f.coordinator.dispose(); }
    }
});

void it("reset/unavailable retain a single-generation window, signal retry and never loop paging in render", () => {
    const row = view("reset"), f = sourceFixture([row]);
    let status: "ok" | "reset" | "unavailable" = "ok", generation = "g", reads = 0;
    f.source.detail = () => {
        reads++;
        const page = { entries: [{ id: generation, kind: "user" as const, text: `GENERATION-${generation}` }], before: "b", after: "a",
            hasOlder: true, hasNewer: false, source: "live" as const, status, hint: status === "ok" ? undefined : `${status}: Press End to retry`,
            budgetLimited: false, scannedMessages: 1, scannedBytes: 1, generation };
        return { text: "", conversation: page.entries, conversationPage: page };
    };
    const h = component(f);
    try {
        h.panel.handleInput("\r"); h.panel.render(100);
        status = "reset"; h.panel.handleInput("\u001b[H");
        const failed = h.panel.render(100).join("\n"); assert.match(failed, /GENERATION-g/); assert.match(failed, /reset: Press End/);
        const count = reads; for (let n = 0; n < 10; n++) { h.panel.handleInput("k"); h.panel.render(100); }
        assert.equal(reads, count, "failed edge cannot launch an unbounded reset retry loop");
        status = "unavailable"; h.panel.handleInput("\u001b[F"); assert.match(h.panel.render(100).join("\n"), /GENERATION-g/);
        assert.match(h.panel.render(100).join("\n"), /unavailable: Press End/);
        status = "ok"; generation = "new"; h.panel.handleInput("\u001b[F"); const restored = h.panel.render(100).join("\n");
        assert.match(restored, /GENERATION-new/); assert.doesNotMatch(restored, /GENERATION-g\b/); assert.equal(h.panel.getState().historyPages, 1);
    } finally { h.panel.dispose(); f.coordinator.dispose(); }
});

void it("tiny detail terminals prioritize body, selected status and actions over long metadata/navigation", () => {
    const row = view("tiny", { description: "metadata ".repeat(100) }), f = sourceFixture([row]);
    f.details.set(row.key, { text: "BODY" });
    const terminal = { rows: 3, columns: 40 };
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    try {
        panel.handleInput("\r");
        const frame = panel.render(40).map(stripTerminalSequences);
        assert.equal(frame.length, 3); assert.match(frame[0], /tiny · ● Running/); assert.match(frame[1], /BODY/); assert.match(frame[2], /x Stop · c Copy/); assert.match(frame[2], /ctrl\+shift\+b All waits/);
        assert.doesNotMatch(frame.join("\n"), /metadata/);
        terminal.rows = 8; assert.match(panel.render(40).join("\n"), /BODY/);
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("actual unavailable Agent source preserves bounded terminal answer/error on first open and retry", () => {
    for (const status of ["completed", "error"] as const) {
        const record: AgentRecord = { id: "no-transcript", runId: "run", type: "general-purpose", registryIndex: 2, description: "no history",
            status, result: "TERMINAL_ANSWER", error: status === "error" ? "TERMINAL_ERROR" : undefined,
            startedAt: Date.now() - 1000, completedAt: Date.now(), toolUses: 0, compactionCount: 0,
            lifetimeUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } };
        const manager = { listAgents: () => [record], getRecord: () => record } as unknown as AgentManager;
        const coordinator = new TaskCoordinator(), source = createAgentTaskSource(manager, coordinator, new Map(), { observe: false });
        coordinator.registerSource(source);
        const row = coordinator.list()[0]!;
        assert.equal(row.title, "general-purpose-2");
        assert.equal(row.taskId, "no-transcript");
        const sourceDetail = coordinator.detail(row, { conversationPage: { direction: "latest" } })!;
        assert.equal(sourceDetail.conversationPage?.status, "unavailable");
        assert.ok(sourceDetail.conversation?.some(entry => entry.kind === "assistant" && entry.text === "TERMINAL_ANSWER"));
        const panel = new TaskPanel({ coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
            theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal: { rows: 24, columns: 100 }, requestRender() {} } as never, done() {} });
        try {
            panel.handleInput("\r");
            for (let n = 0; n < 2; n++) {
                const frame = stripTerminalSequences(panel.render(100).join("\n"));
                assert.match(frame, /TERMINAL_ANSWER/);
                if (status === "error") assert.match(frame, /TERMINAL_ERROR/);
                assert.match(frame, /Conversation unavailable/);
                assert.doesNotMatch(frame, /waiting for first message/);
                assert.ok(panel.getState().historyPages <= 1);
                panel.handleInput("\u001b[F");
            }
        } finally { panel.dispose(); coordinator.dispose(); }
    }
});

void it("actual unavailable Agent source adds an outcome when initialization fails after an empty first preview", () => {
    const record: AgentRecord = { id: "starting", runId: "run", type: "general-purpose", description: "initializing", status: "queued",
        startedAt: Date.now(), toolUses: 0, compactionCount: 0, lifetimeUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } };
    const coordinator = new TaskCoordinator();
    const source = createAgentTaskSource({ listAgents: () => [record], getRecord: () => record } as unknown as AgentManager,
        coordinator, new Map(), { observe: false });
    coordinator.registerSource(source);
    const panel = new TaskPanel({ coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal: { rows: 24, columns: 100 }, requestRender() {} } as never, done() {} });
    try {
        panel.handleInput("\r"); panel.render(100);
        record.status = "error"; record.error = "INITIALIZATION_FAILED"; record.completedAt = Date.now();
        panel.handleInput("\u001b[F");
        assert.match(panel.render(100).join("\n"), /INITIALIZATION_FAILED/);
    } finally { panel.dispose(); coordinator.dispose(); }
});

void it("tight detail footer retains selected controls and global detach instead of truncating the action tail", () => {
    const row = view("tiny-actions", { capabilities: { stop: true, details: true, steer: true, pause: true, skip: true, retry: true } });
    const f = sourceFixture([row]); f.details.set(row.key, { text: "BODY" });
    const terminal = { rows: 3, columns: 40 };
    const panel = new TaskPanel({ coordinator: f.coordinator, config: DEFAULTS, layout, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    try {
        panel.handleInput("\r");
        for (const rows of [3, 8]) {
            terminal.rows = rows;
            const frame = stripTerminalSequences(panel.render(40).join("\n"));
            assert.match(frame, /BODY/); assert.match(frame, /●/);
            for (const key of ["x", "c", "Enter", "p", "s", "r", "ctrl\\+shift\\+b"]) assert.match(frame, new RegExp(key));
            assert.match(frame, /Detach|All waits/);
        }
    } finally { panel.dispose(); f.coordinator.dispose(); }
});

void it("fixed agent header changes terminal state in place, keeps history and repaints clocks without detail reads", t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    let elapsedMs = 1000;
    const row = view("timed", { startedAt: 0, stats: { toolCalls: [{ toolCallId: "t", name: "bash", status: "running", elapsedMs }] } });
    const f = sourceFixture([row]);
    f.details.set(row.key, { text: "", conversation: [{ id: "call", kind: "assistant", text: "", tools: [{ toolCallId: "t", name: "bash", detail: "sleep" }] },
        ...Array.from({ length: 30 }, (_, i) => ({ id: String(i), kind: "user" as const, text: `history-${i}` }))] });
    const list = f.source.list;
    f.source.list = () => list().map(v => ({ ...v, stats: { ...v.stats, toolCalls: v.stats.toolCalls?.map(c => ({ ...c, elapsedMs })) } }));
    const h = component(f);
    try {
        h.panel.handleInput("\r"); h.panel.handleInput("\u001b[H");
        const before = h.panel.render(100).map(stripTerminalSequences), reads = f.reads.length;
        assert.match(before[0]!, /timed · ● Running/); assert.match(before.join("\n"), /Running · elapsed 1\.0s/);
        elapsedMs = 3000; t.mock.timers.tick(1000);
        assert.match(h.panel.render(100).join("\n"), /Running · elapsed 3\.0s/); assert.equal(f.reads.length, reads);
        const top = h.panel.getState().detailScrollTop;
        for (const status of ["completed", "stopped", "interrupted", "failed"] as const) {
            f.publish([{ ...row, status, endedAt: 4000, stats: { settling: true, toolCalls: [{ toolCallId: "t", name: "bash", status: "interrupted", elapsedMs: 3000 }] } }]);
            const out = h.panel.render(100).map(stripTerminalSequences);
            assert.match(out[0]!, new RegExp(status[0].toUpperCase() + status.slice(1)));
            assert.doesNotMatch(out.join("\n"), /Task Panel · Detail|Running · elapsed/);
            assert.match(out.join("\n"), /cleanup pending/);
            assert.equal(h.panel.getState().detailScrollTop, top);
            assert.equal(h.panel.getState().followingEnd, false);
        }
    } finally { h.panel.dispose(); f.coordinator.dispose(); }
});
