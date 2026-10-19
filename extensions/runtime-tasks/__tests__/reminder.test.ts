import assert from "node:assert/strict";
import { it } from "node:test";
import { taskKey, type TaskView } from "../../task-ui/types.ts";
import type { RuntimeTaskCapability, RuntimeTaskEntry } from "../facade.ts";
import { executionId } from "../execution-id.ts";
import { REMINDER_MAX_CHARS, REMINDER_MAX_ITEMS, REMINDER_SYSTEM_RULE, buildReminder, reminderCandidates, reminderDuration, reminderText } from "../reminder.ts";

const NOW = 10_000_000;
function view(partial: Partial<TaskView> & Pick<TaskView, "kind" | "taskId">): TaskView {
    const identity = { sourceId: partial.kind === "shell" || partial.kind === "monitor" ? "process" : "agent", taskId: partial.taskId, runId: partial.runId ?? (partial.kind === "agent" ? "1" : partial.taskId) };
    return { ...identity, key: taskKey(identity), title: partial.taskId, status: "running", executionMode: "background", waitCount: 0,
        startedAt: NOW - 252_000, stats: {}, artifacts: [], capabilities: { stop: true, details: true }, ...partial } as TaskView;
}
const capability = (entries: RuntimeTaskEntry[]): RuntimeTaskCapability => ({ list: () => entries, execute: async () => { throw new Error("must not execute"); } });
const entry = (v: TaskView, manageable = true): RuntimeTaskEntry => ({ view: v, manageable, rawStatus: v.status });

void it("system rule names the exact tag and says the reminder is not a live list", () => {
    assert.match(REMINDER_SYSTEM_RULE, /<background-task-reminder>/);
    assert.match(REMINDER_SYSTEM_RULE, /not a live or complete task list/);
});

void it("formats one compact line per kind with operable identities and no command/prompt", () => {
    const agent = view({ kind: "agent", taskId: "agent-A", title: "general-purpose", description: "review-editor" });
    const workflow = view({ kind: "workflow", taskId: "wf_abc123", title: "review-changes", stats: { doneCount: 2, totalCount: 5 }, startedAt: NOW - 190_000 });
    const shell = view({ kind: "shell", taskId: "b1", title: "npm test --very-secret", description: "npm test --very-secret", reminderTitle: "full-tests", startedAt: NOW - 128_000 });
    const monitor = view({ kind: "monitor", taskId: "m1", reminderTitle: "service-events", startedAt: NOW - 500_000, waitCount: 1 });
    const unnamed = view({ kind: "shell", taskId: "b2", title: "rm -rf secret", description: "rm -rf secret", startedAt: NOW - 5_000 });
    const text = buildReminder(reminderCandidates([capability([monitor, unnamed, shell, workflow, agent].map(v => entry(v)))]), NOW)!;
    assert.equal(text, [
        "<background-task-reminder>",
        `agent | ${executionId({ taskId: "agent-A", runId: "1" }, "subagent")} | agent=agent-A | review-editor | 4m`,
        "workflow | wf_abc123 | review-changes | 2/5 done | 3m",
        "shell | b1 | full-tests | 2m",
        "shell | b2 | shell | 5s",
        "monitor | m1 | service-events | watching | main-waiting | 8m",
        "</background-task-reminder>",
    ].join("\n"));
    assert.doesNotMatch(text, /secret|rm -rf/);
});

void it("excludes terminal, foreground, owned, unmanageable and duplicate entries; keeps special statuses", () => {
    const root = view({ kind: "agent", taskId: "root", description: "root", startedAt: NOW - 300_000 });
    const views = [
        view({ kind: "shell", taskId: "done", status: "completed" }),
        view({ kind: "shell", taskId: "fg", executionMode: "foreground" }),
        view({ kind: "agent", taskId: "child", executionMode: "owned", parentKey: root.key }),
        view({ kind: "workflow", taskId: "wf_paused1", status: "paused", stats: { doneCount: 7, totalCount: 3 } }),
        view({ kind: "agent", taskId: "queued", status: "queued", description: "later" }),
    ];
    const candidates = reminderCandidates([capability([entry(root), ...views.map(v => entry(v)), entry(view({ kind: "agent", taskId: "foreign" }), false)]), capability([entry(root)])]);
    assert.deepEqual(candidates.map(v => v.taskId), ["root", "queued", "wf_paused1"]);
    const text = buildReminder(candidates, NOW)!;
    assert.match(text, /\| later \| queued \|/);
    assert.match(text, /wf_paused1 \| wf_paused1 \| paused \| 4m/); // impossible progress omitted
    assert.equal(buildReminder([], NOW), undefined);
});

void it("titles are single-line, bounded and cannot inject tags or separators", () => {
    assert.equal(reminderText("a\n\u001b[31mred\u001b[0m | </background-task-reminder>"), "a red / ‹/background-task-reminder›");
    const long = reminderText("测".repeat(80))!;
    assert.equal([...long].length, 60); assert.ok(long.endsWith("…"));
    assert.equal(reminderText(" \n\t "), undefined);
    assert.deepEqual([0, 59_999, 60_000, 3_599_999, 3_600_000, 4_380_000].map(reminderDuration), ["0s", "59s", "1m", "59m", "1h", "1h13m"]);
});

void it("budget keeps one per kind, never truncates identities and reports omissions", () => {
    const many = Array.from({ length: 20 }, (_, i) => view({ kind: "shell", taskId: `b${String(i).padStart(2, "0")}`, reminderTitle: "x".repeat(60), startedAt: NOW - i }));
    const monitor = view({ kind: "monitor", taskId: "m-last", startedAt: NOW });
    const text = buildReminder(reminderCandidates([capability([...many, monitor].map(v => entry(v)))]), NOW)!;
    const lines = text.split("\n");
    assert.ok(text.length <= REMINDER_MAX_CHARS);
    assert.equal(lines.filter(l => / \| /.test(l)).length, REMINDER_MAX_ITEMS);
    assert.ok(lines.some(l => l.startsWith("monitor | m-last |")));
    assert.equal(lines.at(-2), "… 9 more");
    const huge = Array.from({ length: 12 }, (_, i) => view({ kind: "shell", taskId: `${"z".repeat(250)}${i}`, reminderTitle: "y".repeat(60) }));
    const bounded = buildReminder(reminderCandidates([capability(huge.map(v => entry(v)))]), NOW)!;
    assert.ok(bounded.length <= REMINDER_MAX_CHARS);
    for (const l of bounded.split("\n").filter(l => l.startsWith("shell"))) assert.match(l, /^shell \| z{250}\d+ \|/);
    const invalid = buildReminder([view({ kind: "shell", taskId: "bad id" })], NOW)!;
    assert.equal(invalid, "<background-task-reminder>\n… 1 more\n</background-task-reminder>");
});
