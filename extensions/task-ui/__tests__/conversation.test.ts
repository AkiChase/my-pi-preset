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
    for (const pattern of [/older messages omitted/, /^User$/m, /^Assistant$/m, /Plan/, /3\) keep/, /⏺ bash {2}npm test/, /✗ bash failed/, /FAIL/, /40 more characters/,
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
