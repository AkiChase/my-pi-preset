import assert from "node:assert/strict";
import { it } from "node:test";
import { visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";
import { taskKey, type TaskView } from "../types.ts";
import { TaskPanelModel } from "../model.ts";
import { cleanTaskText, taskDot, taskDuration, taskLine, taskTokens, taskTitle } from "../presentation.ts";

const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => `\u001b[44m${text}\u001b[0m` };
function view(id: string, patch: Partial<TaskView> = {}): TaskView {
    const identity = { sourceId: "fixture", taskId: id, runId: "1" };
    return { ...identity, key: taskKey(identity), kind: "agent", title: id, status: "running", executionMode: "background", waitCount: 0,
        stats: {}, artifacts: [], capabilities: { stop: true, details: true }, ...patch };
}
void it("kind-aware titles preserve process prose and fallback without changing original text", () => {
    const command = "TRELLIS_CONTEXT_ID=original echo '完整命令'";
    const agent = view("a", { title: "reviewer", description: "审查\n实现\u001b]0;bad\u0007\u001b[31m" });
    assert.equal(taskTitle(agent), "审查 实现");
    assert.equal(agent.description?.includes("\n"), true);
    assert.equal(taskTitle(view("wf", { kind: "workflow", title: "Pipeline", description: "Review changes" })), "Review changes");
    assert.equal(taskTitle(view("b", { kind: "shell", title: "Run checks", description: command })), "Run checks");
    assert.equal(taskTitle(view("m", { kind: "monitor", title: "Watch events", description: "tail -f events" })), "Watch events");
    assert.equal(taskTitle(view("b", { kind: "shell", title: " \n\t", description: command })), command);
    assert.equal(taskTitle(view("fallback", { title: "", description: "\u001b[0m" })), "fallback");
});
void it("status dots are execution-state based and selected styling does not change them", () => {
    for (const status of ["starting", "queued", "running", "paused", "completed", "failed", "stopped"] as const) {
        const row = view(status, { status, waitCount: 2, stats: { tokens: 1234, durationMs: 61200 } });
        const dot = status === "running" ? "●" : "○";
        assert.equal(taskDot(row), dot);
        const selected = taskLine(row, 100, theme, { selected: true });
        assert.equal(stripTerminalSequences(selected), taskLine(row, 100, theme));
        assert.ok(selected.startsWith("\u001b[44m"));
        assert.match(selected, /waiting 2/);
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
        if (width >= 20) assert.match(line, /running/);
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
