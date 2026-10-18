import assert from "node:assert/strict";
import { it } from "node:test";
import { createEventBus, SessionManager, type ExtensionAPI, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import statusBar from "../../status-bar.ts";
import { TaskCoordinator } from "../coordinator.ts";
import { TaskLifecycle } from "../lifecycle.ts";
import { DEFAULTS } from "../config.ts";
import { createTaskUIOwner } from "../owner.ts";
import { taskKey, type TaskSource, type TaskView } from "../types.ts";

// Distinct real SGR sequences make wrong semantic tokens and whole-chip wrappers observable.
const colors: Partial<Record<ThemeColor, number>> = { accent: 36, text: 97, success: 32, warning: 33, dim: 90, muted: 37, borderMuted: 90, error: 31 };
const fg = (color: ThemeColor, text: string) => `\u001b[${colors[color] ?? 35}m${text}\u001b[39m`;
const theme = { fg, style: (text: string, style: { fg: ThemeColor }) => fg(style.fg, text) } as unknown as Theme;
function view(id: string, patch: Partial<TaskView> = {}): TaskView {
    const identity = { sourceId: "summary", taskId: id, runId: "1" };
    return { ...identity, key: taskKey(identity), kind: "monitor", title: id, status: "running", executionMode: "background", waitCount: 0,
        stats: {}, artifacts: [], capabilities: { stop: true, details: true }, ...patch };
}
function fixture(shortcuts = DEFAULTS.shortcutTaskPanel) {
    const handlers = new Map<string, ((event: never, ctx: ExtensionContext) => unknown)[]>();
    const statuses = new Map<string, string>();
    let views: readonly TaskView[] = [], revision = 0;
    const listeners = new Set<() => void>();
    const source: TaskSource = { sourceId: "summary", get revision() { return revision; }, list: () => views, detail: () => undefined, stop: () => false,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, dispose() { listeners.clear(); } };
    const coordinator = new TaskCoordinator(); coordinator.registerSource(source);
    const lifecycle = new TaskLifecycle(coordinator);
    let footer: ReturnType<NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]>> | undefined;
    const ctx = { sessionManager: SessionManager.inMemory("/tmp"), hasUI: true, mode: "tui", cwd: "/tmp/summary", getContextUsage: () => undefined, ui: { theme,
        setStatus(key: string, text: string | undefined) { if (text === undefined) statuses.delete(key); else statuses.set(key, text); },
        setFooter(factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0]) {
            footer?.dispose?.();
            footer = factory?.({ requestRender() {} } as never, theme, {
                getExtensionStatuses: () => statuses, onBranchChange: () => () => {}, getAvailableProviderCount: () => 1,
            } as never);
        },
    } } as unknown as ExtensionContext;
    const pi = { events: createEventBus(), on(event: string, handler: (event: never, ctx: ExtensionContext) => unknown) {
        const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list);
        return () => { const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); };
    }, registerCommand() {}, getSettings: () => ({}), exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as unknown as ExtensionAPI;
    const owner = createTaskUIOwner(pi, coordinator, lifecycle, { ...DEFAULTS, shortcutTaskPanel: shortcuts });
    statusBar(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({} as never, ctx);
    return { statuses,
        publish(next: readonly TaskView[]) { views = next; revision++; for (const listener of listeners) listener(); },
        render(width: number) { return footer!.render(width); },
        dispose() { owner.dispose(); footer?.dispose?.(); coordinator.dispose(); },
    };
}
const count = (n: number, state: "active" | "queued") => `${fg("text", String(n))} ${fg(state === "active" ? "success" : "warning", state)}`;
const group = (kind: string, active: number, queued = 0) => `${fg("accent", kind)}${fg("dim", ":")} ${count(active, "active")}${queued ? fg("dim", " / ") + count(queued, "queued") : ""}`;
const separator = fg("dim", " · ");

void it("owner publishes semantic monitor fields and configured shortcut; actual footer preserves ANSI and widths", () => {
    const f = fixture(["ctrl+alt+t"]);
    try {
        f.publish([view("one"), view("two")]);
        const expected = group("monitor", 2) + separator + fg("accent", "ctrl+alt+t");
        assert.equal(f.statuses.get("task-ui"), expected);
        f.statuses.set("foreign", "  external\n status  ");
        f.statuses.set("pi-cache-stats", "Cache Optimizer disabled");
        const line = f.render(240)[2]!;
        assert.ok(line.includes(expected), "footer must preserve task-ui fields");
        assert.ok(!line.includes(fg("muted", expected)), "footer must not wrap task-ui in muted");
        assert.ok(line.includes(fg("muted", "external status")), "other status keys retain their generic styling/sanitization");
        assert.ok(line.includes(fg("dim", "⛁ off")), "cache-specific styling remains intact");
        assert.equal(visibleWidth(expected), visibleWidth("monitor: 2 active · ctrl+alt+t"));
        for (const width of [0, 1, 7, 19, 35, 50, 100, 240]) {
            for (const rendered of f.render(width)) assert.ok(visibleWidth(rendered) <= width);
            assert.equal(stripTerminalSequences(f.render(width)[2]!), stripTerminalSequences(line).slice(0, Math.max(0, width - 1)) + (visibleWidth(line) > width && width > 0 ? "…" : ""));
        }
    } finally { f.dispose(); }
});

void it("owner uses the same colors/order for every type, ignores descendants/terminal tasks and hides empty state", () => {
    const f = fixture([]);
    try {
        assert.equal(f.statuses.has("task-ui"), false);
        const parent = view("workflow", { kind: "workflow", status: "paused" });
        f.publish([parent, view("child", { kind: "agent", parentKey: parent.key }), view("shell", { kind: "shell" }), view("monitor"),
            view("agent", { kind: "agent" }), view("queued", { kind: "agent", status: "queued" }), view("starting", { kind: "agent", status: "starting" }),
            view("done", { status: "completed" }), view("failed", { status: "failed" }), view("stopped", { status: "stopped" })]);
        const expected = [group("shell", 1), group("monitor", 1), group("agent", 1, 2), group("workflow", 1), fg("accent", "/tasks")].join(separator);
        assert.equal(f.statuses.get("task-ui"), expected);
        assert.equal(stripTerminalSequences(expected), "shell: 1 active · monitor: 1 active · agent: 1 active / 2 queued · workflow: 1 active · /tasks");
        assert.ok(f.render(240)[2]!.includes(expected));
        f.publish([view("queued-only", { kind: "agent", status: "queued" })]);
        assert.equal(f.statuses.get("task-ui"), group("agent", 0, 1) + separator + fg("accent", "/tasks"));
        f.publish([view("done", { status: "completed" })]);
        assert.equal(f.statuses.has("task-ui"), false);
        assert.doesNotMatch(stripTerminalSequences(f.render(240)[2]!), /active|queued|\/tasks/);
    } finally { f.dispose(); }
});
