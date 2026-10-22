import assert from "node:assert/strict";
import { it } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ConversationRenderer } from "../conversation.ts";
import type { ConversationEntry } from "../types.ts";

const theme = { fg: (_color: string, text: string) => text } as never;
const entries: ConversationEntry[] = [
    { kind: "user", text: "Inspect 中文😀 login\u001b]0;evil\u0007" },
    { kind: "assistant", text: "# Plan\n\n3) keep\n- item `code`", tools: [{ name: "bash", detail: "npm test" }] },
    { kind: "toolResult", name: "bash", text: "FAIL\u001b[31m x", elided: 40, error: true },
    { kind: "bash", command: "ls -la", output: "a\nb", elided: 0, exitCode: 1 },
    { kind: "notice", text: "Error: boom" },
];

void it("renders role labels, Markdown, tool lines, dimmed results and activity within width", () => {
    const r = new ConversationRenderer();
    const plain = r.render(entries, 60, theme, { activity: "reading a.ts", truncated: true }).map(stripTerminalSequences).join("\n");
    for (const pattern of [/older messages omitted/, /^User$/m, /^Assistant$/m, /Plan/, /3\) keep/, /bash {2}npm test/, /Failed/, /FAIL/, /40 more characters/,
        /\$ ls -la \(exit 1\)/, /Error: boom/, /▍ reading a\.ts/]) assert.match(plain, pattern);
    assert.doesNotMatch(plain, /# Plan|evil|\u0007/);
    for (const width of [1, 5, 20, 80]) for (const line of r.render(entries, width, theme)) assert.ok(visibleWidth(line) <= width, `${width}`);
    assert.match(r.render([], 40, theme).join("\n"), /waiting for first message/);
    r.dispose();
});

void it("falls back to literal text when Markdown rendering throws and remembers the failure", () => {
    const r = new ConversationRenderer();
    const deep = ">".repeat(5000) + " text";
    const out = r.render([{ kind: "assistant", text: deep, tools: [] }], 80, theme);
    assert.ok(out.length > 0);
    assert.ok(r.render([{ kind: "assistant", text: deep, tools: [] }], 80, theme).length > 0);
    r.dispose();
});

void it("pre-init fallback uses bounded output and stable IDs without parameter click hints", () => {
    const r = new ConversationRenderer();
    const long = Array.from({ length: 100 }, (_, i) => `output-${i}`).join("\n");
    const tools: ConversationEntry[] = [
        { id: "read", kind: "toolResult", name: "read", text: long, elided: 30, sourceTruncated: true, summary: { kind: "read", path: "中文/a.ts", offset: 2, limit: 20, lines: 100 } },
        { id: "bash", kind: "bash", command: "npm test", output: long, elided: 0, exitCode: 0 },
        { id: "write", kind: "toolResult", name: "write", text: "SECRET WRITE CONTENT", elided: 0, summary: { kind: "write", path: "x.ts", lines: 10, bytes: 100 } },
        { id: "edit", kind: "toolResult", name: "edit", text: "diff", elided: 0, summary: { kind: "edit", path: "x.ts", addedLines: 3, removedLines: 2 } },
    ];
    try {
        const compact = r.renderModel(tools, 80, theme);
        const text = stripTerminalSequences(compact.lines.join("\n"));
        assert.doesNotMatch(text, /output-0\b/);
        assert.match(text, /output-99/); assert.doesNotMatch(text, /output-96\b/);
        assert.match(text, /97 more visual lines/); assert.match(text, /30 more characters/);
        assert.match(text, /additional content omitted/); assert.match(text, /SECRET WRITE CONTENT/);
        assert.doesNotMatch(text, /View parameters|click to expand loaded content/);
        assert.equal(compact.ranges.length, 4); assert.ok(compact.ranges.every(range => range.collapsible));
        const expanded = new Set(["read", "write"]);
        const model = r.renderModel([{ id: "older", kind: "user", text: "before" }, ...tools], 80, theme, { expanded });
        const open = stripTerminalSequences(model.lines.join("\n"));
        assert.match(open, /output-99/); assert.match(open, /output-40\b/);
        assert.match(open, /SECRET WRITE CONTENT/); assert.doesNotMatch(open, /60 more visual lines/);
        assert.ok(model.ranges.find(range => range.id === "read")!.start > compact.ranges[0].start);
        // A long single line must not bypass visual-line preview budgets at narrow widths.
        const wrapped = r.renderModel([{ id: "wide", kind: "toolResult", text: "中文😀".repeat(1000), elided: 0 }], 10, theme);
        assert.ok(wrapped.lines.length <= 8);
    } finally { r.dispose(); }
});

void it("call titles reserve state/duration before paths and never invent historical durations", () => {
    const r = new ConversationRenderer();
    const rows: ConversationEntry[] = [
        { kind: "assistant", text: "", tools: [{ toolCallId: "a", name: "read", detail: "中文😀/".repeat(100) }, { toolCallId: "b", name: "read", detail: "b.ts" }] },
        { kind: "toolResult", toolCallId: "historical", name: "read", text: "ok", elided: 0 },
    ];
    try {
        const calls = [{ toolCallId: "a", name: "read", status: "running" as const, elapsedMs: 1234 }, { toolCallId: "b", name: "read", status: "completed" as const, elapsedMs: 5000, durationMs: 37 }];
        const out = r.render(rows, 55, theme, { toolCalls: calls }).map(stripTerminalSequences).join("\n");
        assert.match(out, /elapsed 1\.2s/); assert.match(out, /execution 0\.0s/);
        assert.doesNotMatch(out, /execution 5\.0s|historical.*(?:elapsed|execution)/);
        const interrupted = r.render(rows, 55, theme, { toolCalls: [{ ...calls[0]!, status: "interrupted" }] }).join("\n");
        assert.match(interrupted, /Interrupted · elapsed 1\.2s/);
        const known = r.render([{ kind: "toolResult", name: "bash", durationMs: 1200, text: "ok", elided: 0 }], 55, theme).join("\n");
        assert.match(known, /execution 1\.2s/);
        for (const width of [1, 12, 36, 80]) for (const line of r.render(rows, width, theme, { toolCalls: calls })) assert.ok(visibleWidth(line) <= width);
    } finally { r.dispose(); }
});
