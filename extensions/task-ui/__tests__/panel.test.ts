import { loadNativeLayout } from "../../shared/scroll-panel/native-layout.ts";
const layout = await loadNativeLayout();
import assert from "node:assert/strict";
import { it } from "node:test";
import { createEventBus, SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
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
        assert.match(h.panel.render(150).join("\n"), /foreground · waits 0/);
        h.panel.handleInput("\u001b");
        assert.ok(f.reads.some(identity => identity.taskId === a.taskId));
        h.panel.handleInput("j");
        assert.equal(h.panel.model.selected?.key, b.key);
        h.panel.handleInput("\r");
        const rendered = h.panel.render(180).join("\n");
        assert.match(rendered, /background · waits 2/); assert.match(rendered, /omitted before 8, after 9/); assert.match(rendered, /tokens: 12/);
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

void it("detail preserves full wrapped metadata, command, phases and bounded range while scrolling only the preview", () => {
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
        let all = "";
        for (let i = 0; i < 400; i++) { all += stripTerminalSequences(panel.render(40).join("\n")) + "\n"; panel.handleInput("j"); }
        for (const text of ["TITLE_END", "COMMAND_END", "TRELLIS_CONTEXT_ID=source_123", "PHASE_END_11", "log-59", "200–600 / 2000", "after 1400"]) assert.ok(all.includes(text), text);
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
