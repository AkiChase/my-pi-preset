import assert from "node:assert/strict";
import { it } from "node:test";
import { visibleWidth, stripTerminalSequences, mixColors } from "@earendil-works/pi-tui";
import { taskKey, type TaskView } from "../types.ts";
import { TaskPanelModel } from "../model.ts";
import { cleanTaskText, taskDot, taskDuration, taskLine, taskStatusColor, taskTokens, taskTitle } from "../presentation.ts";

const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => `\u001b[44m${text}\u001b[0m` };
function view(id: string, patch: Partial<TaskView> = {}): TaskView {
    const identity = { sourceId: "fixture", taskId: id, runId: "1" };
    return { ...identity, key: taskKey(identity), kind: "agent", title: id, status: "running", executionMode: "background", waitCount: 0,
        stats: {}, artifacts: [], capabilities: { stop: true, details: true }, ...patch };
}
void it("agent titles preserve the stable public identity while other kinds use prose", () => {
    const command = "TRELLIS_CONTEXT_ID=original echo '完整命令'";
    const agent = view("a", { title: "reviewer", description: "审查\n实现\u001b]0;bad\u0007\u001b[31m" });
    assert.equal(taskTitle(agent), "reviewer");
    assert.equal(agent.description?.includes("\n"), true);
    assert.equal(taskTitle(view("wf", { kind: "workflow", title: "Pipeline", description: "Review changes" })), "Pipeline");
    assert.equal(taskTitle(view("b", { kind: "shell", title: "Run checks", description: command })), "Run checks");
    assert.equal(taskTitle(view("m", { kind: "monitor", title: "Watch events", description: "tail -f events" })), "Watch events");
    assert.equal(taskTitle(view("b", { kind: "shell", title: " \n\t", description: command })), command);
    assert.equal(taskTitle(view("fallback", { title: "", description: "\u001b[0m" })), "fallback");
});
void it("status dots are execution-state based and selected styling does not change them", () => {
    for (const status of ["starting", "queued", "running", "paused", "completed", "failed", "stopped"] as const) {
        const row = view(status, { status, waitCount: 2, stats: { tokens: 1234, durationMs: 61200 } });
        const dot = { starting: "●", queued: "○", running: "●", paused: "Ⅱ", completed: "✓", failed: "✕", stopped: "■" }[status];
        assert.equal(taskDot(row), dot);
        assert.equal(taskStatusColor(row), ({ starting: "accent", running: "accent", queued: "muted", paused: "warning", completed: "success", failed: "error", stopped: "dim" }[status]));
        const selected = taskLine(row, 100, theme, { selected: true });
        assert.equal(stripTerminalSequences(selected), taskLine(row, 100, theme));
        assert.ok(selected.startsWith("\u001b[44m"));
        assert.doesNotMatch(selected, /\[(?:running|queued)\]/);
        assert.ok(selected.includes(dot));
        assert.match(selected, /1m1s · ↓ 1.2k/);
    }
});
void it("task lines bound Unicode/control input and retain state/statistics before long titles", () => {
    const row = view("row", { description: "中文😀\u001b[31m\u001b]0;bad\u0007".repeat(100), stats: { tokens: 1234567, durationMs: 99000 } });
    for (const width of [0, 1, 2, 3, 7, 12, 20, 32, 50, 100]) {
        const line = taskLine(row, width, theme, { prefix: "│  ".repeat(100) + "└─", selected: true });
        assert.equal(visibleWidth(line), width);
        assert.doesNotMatch(cleanTaskText(line), /[\u0000-\u001f\u007f-\u009f]/);
        if (width >= 20) assert.match(line, /●/);
        if (width >= 50) assert.match(line, /↓ 1.2M/);
    }
    assert.equal(taskDuration(view("x", { startedAt: 1000, endedAt: 4200 }), 99999), "3s");
    assert.equal(taskDuration(view("x", { stats: { durationMs: -3 } })), "0s");
    assert.equal(taskDuration(view("x")), undefined);
    assert.equal(taskTokens(undefined), undefined); assert.equal(taskTokens(NaN), undefined);
});
void it("tree prefixes and descendant counts follow actual sibling relationships", () => {
    const root = view("root"), a = view("a", { parentKey: root.key }), leaf = view("leaf", { parentKey: a.key });
    const b = view("b", { parentKey: root.key }), other = view("other"), nested = view("nested", { parentKey: other.key });
    const model = new TaskPanelModel();
    try {
        const rows = model.refresh([root, a, leaf, b, other, nested]);
        assert.deepEqual(rows.map(row => [row.view.taskId, row.prefix, row.descendantCount]), [
            ["root", "", 3], ["a", "├─", 1], ["leaf", "│  └─", 0], ["b", "└─", 0], ["other", "", 1], ["nested", "└─", 0],
        ]);
        model.select(leaf); model.collapse(root.key);
        assert.equal(model.selected?.key, root.key);
        assert.deepEqual(model.refresh([root, a, leaf, b, other, nested]).map(row => row.view.taskId), ["root", "other", "nested"]);
        model.expand(root.key); assert.equal(model.refresh([root, a, leaf, b]).length, 4);
    } finally { model.dispose(); }
});
void it("invalid hierarchy has bounded cycle/orphan fallback and no fabricated notification groups", () => {
    const a = view("a"), b = view("b", { parentKey: a.key });
    const cycleA = { ...a, parentKey: b.key }, orphan = view("orphan", { parentKey: "missing" });
    const model = new TaskPanelModel();
    try {
        const rows = model.refresh([cycleA, b, orphan]);
        assert.equal(new Set(rows.map(row => row.view.key)).size, 3);
        assert.equal(rows.find(row => row.view.key === orphan.key)?.depth, 0);
        assert.ok(rows.every(row => (row.descendantCount ?? 0) <= 1));
        model.select(b); model.collapse(a.key);
        assert.equal(model.selected?.key, a.key);
    } finally { model.dispose(); }
});

void it("long titles preserve collapsed counts and structural tree whitespace", () => {
    const row = view("row", { description: "长标题".repeat(100) });
    assert.match(taskLine(row, 34, theme, { children: 123 }), /\(123\)/);
    assert.match(taskLine(row, 80, theme, { prefix: "   │  └─" }), /   │  └─/);
    assert.match(taskLine(row, 34, theme, { prefix: "│  ".repeat(30) + "└─" }), /…└─/);
});
void it("selected background remains active through host foreground reset sequences", () => {
    const resettingTheme = { ...theme, fg: (_: string, text: string) => `\u001b[31m${text}\u001b[0m` };
    const line = taskLine(view("row"), 34, resettingTheme, { selected: true });
    let background = false, columns = 0;
    for (const token of line.match(/\u001b\[[0-9;]*m|[^\u001b]+/g) ?? []) {
        if (token.startsWith("\u001b")) {
            const codes = token.slice(2, -1).split(";");
            if (codes.some(code => code === "0" || code === "49" || code === "")) background = false;
            if (codes.includes("44")) background = true;
        } else {
            assert.equal(background, true, `unpainted content: ${JSON.stringify(token)}`);
            columns += visibleWidth(token);
        }
    }
    assert.equal(columns, 34);
    assert.equal(background, false, "selection background must end at the row boundary");
});
void it("reparenting beneath a collapsed ancestor reconciles selection without a hidden pin", () => {
    const root = view("root"), other = view("other");
    const model = new TaskPanelModel();
    try {
        model.refresh([root, other]); model.collapse(root.key); model.select(other);
        const rows = model.refresh([root, { ...other, parentKey: root.key }]);
        assert.deepEqual(rows.map(row => row.view.key), [root.key]);
        assert.equal(model.selected?.key, root.key);
        model.expand(root.key); assert.equal(model.refresh([root, { ...other, parentKey: root.key }]).length, 2);
    } finally { model.dispose(); }
});
void it("collapsed cyclic trees do not resurrect indirect hidden descendants as roots", () => {
    const a = view("a"), b = view("b", { parentKey: a.key }), c = view("c", { parentKey: b.key });
    const cyclicA = { ...a, parentKey: c.key }, model = new TaskPanelModel();
    try {
        model.refresh([cyclicA, b, c]); model.select(cyclicA); model.collapse(a.key);
        assert.deepEqual(model.refresh([cyclicA, b, c]).map(row => row.view.key), [a.key]);
    } finally { model.dispose(); }
});

void it("all lifecycle symbols/colors remain readable without animation", () => {
    const seen: string[] = [];
    const themed = { fg: (color: string, text: string) => { seen.push(color); return text; } } as never;
    for (const status of ["queued", "starting", "running", "paused", "completed", "failed", "stopped"] as const) {
        const row = view(status, { status });
        const plain = taskLine(row, 80, themed);
        assert.doesNotMatch(plain, /\[(?:queued|starting|running|paused|completed|failed|stopped)\]|waiting/);
        assert.equal(taskDot(row), status === "starting" || status === "running" ? "●" : ({ queued: "○", paused: "Ⅱ", completed: "✓", failed: "✕", stopped: "■" }[status] ?? ""));
    }
    assert.ok(seen.includes("muted")); assert.ok(seen.includes("accent"));
    assert.ok(seen.includes("success")); assert.ok(seen.includes("error")); assert.ok(seen.includes("dim"));
});

void it("terminal detail headers use public theme colors as soft full-width backgrounds in light/dark themes", async () => {
    // Test-only installed theme loader introspection; production uses the injected public Theme.
    const { pathToFileURL } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const host = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "modes/interactive/theme/theme.js")).href);
    const getThemeByName = host.getThemeByName as (name: string) => import("@earendil-works/pi-coding-agent").Theme | undefined;
    const { taskDetailTopLine } = await import("../presentation.ts");
    for (const name of ["dark", "light"]) {
        const actual = getThemeByName(name)!; assert.ok(actual);
        const seen = new Set<string>();
        const luminance = (color: typeof actual.colors.text) => {
            assert.equal(color.kind, "rgb");
            if (color.kind !== "rgb") throw new Error("Expected public RGB palette");
            return [color.r, color.g, color.b].map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
                .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
        };
        for (const status of ["completed", "failed", "stopped", "interrupted"] as const) {
            const semantic = status === "completed" ? "success" : status === "failed" ? "error" : "warning";
            const surface = mixColors(actual.colors.toolPendingBg, actual.colors[semantic], 0.22, "srgb");
            const fg = luminance(actual.colors.text), bg = luminance(surface);
            assert.ok((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) >= 4.5, `${name}/${status}: readable normal text`);
            const line = taskDetailTopLine(view("Agent中文😀", { status }), 60, actual);
            assert.ok(line.includes(actual.fg("text", `${taskDot(view(status, { status }))} ${status[0].toUpperCase() + status.slice(1)}`)), "status uses the contrasting text foreground");
            assert.equal(visibleWidth(line), 60);
            assert.match(stripTerminalSequences(line), new RegExp(status[0].toUpperCase() + status.slice(1)));
            let active = false, columns = 0;
            for (const part of line.match(/\u001b\[[0-9;]*m|[^\u001b]+/g) ?? []) {
                if (part.startsWith("\u001b")) {
                    const codes = part.slice(2, -1).split(";");
                    if (codes.some(c => c === "" || c === "0" || c === "49")) active = false;
                    if (codes.includes("48")) { active = true; seen.add(part); }
                } else { assert.equal(active, true); columns += visibleWidth(part); }
            }
            assert.equal(columns, 60); assert.equal(active, false);
        }
        assert.ok(seen.size >= 3, "success/warning/error have distinct surfaces");
        assert.doesNotMatch(taskDetailTopLine(view("live"), 60, actual), /\u001b\[48/);
    }
});

void it("agent runtime keeps pending cleanup visible before counters and sanitizes synthetic activity", async () => {
    const { taskStatusLine } = await import("../presentation.ts");
    const pending = view("pending", { status: "stopped", stats: { settling: true, durationMs: 999999999 } });
    assert.match(taskStatusLine(pending, 20, theme), /^cleanup pending/);
    const running = view("live", { stats: { activity: "setup\u001b]0;unsafe\u0007\nactivity" } });
    const out = taskStatusLine(running, 80, theme);
    assert.doesNotMatch(out, /\u001b|\u0007|\n|unsafe/);
    assert.match(out, /setup activity/);
});
