import assert from "node:assert/strict";
import { it } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { themeSdk } from "../../beautify/__tests__/renderer-host.mjs";
import { ConversationRenderer } from "../conversation.ts";
import type { Highlighter } from "../../beautify/highlight.ts";
import type { ConversationEntry } from "../types.ts";

it("actual shared SDK cards pair stable IDs, compact default and full native loaded expansion", async () => {
    const renderer = new ConversationRenderer();
    const text = Array.from({ length: 65 }, (_, n) => `line-${n}`).join("\n");
    const call: ConversationEntry = { id: "assistant", kind: "assistant", text: "", tools: [{ name: "read", toolCallId: "r", detail: "中文😀.ts", parameters: { status: "complete", json: '{"path":"中文😀.ts","offset":7}' } }] };
    const result: ConversationEntry = { id: "result", kind: "toolResult", toolCallId: "r", name: "read", text, elided: 9, display: { status: "truncated" } };
    try {
        const before = renderer.renderModel([call], 100, themeSdk.theme, { toolCalls: [{ name: "read", toolCallId: "r", status: "running", elapsedMs: 1000 }] });
        assert.equal(before.ranges[0].id, "tool:r");
        assert.match(stripTerminalSequences(before.lines.join("\n")), /Running|elapsed 1\.0s/);
        const compact = renderer.renderModel([call, result], 100, themeSdk.theme);
        assert.equal(compact.ranges.length, 1);
        assert.equal(compact.ranges[0].id, before.ranges[0].id);
        assert.doesNotMatch(stripTerminalSequences(compact.lines.join("\n")), /line-0/);
        const full = renderer.renderModel([call, result], 100, themeSdk.theme, { expanded: new Set(["tool:r"]) });
        const plain = stripTerminalSequences(full.lines.join("\n"));
        assert.match(plain, /71 │ line-64/); // Native read numbering, not a copied layout.
        assert.match(plain, /source truncated/);
        assert.doesNotMatch(plain, /Arguments|Output/);
        for (const width of [1, 12, 36, 120]) assert.ok(renderer.renderModel([call, result], width, themeSdk.theme).lines.every(line => visibleWidth(line) <= width));
    } finally { renderer.dispose(); }
    await new Promise(resolve => setImmediate(resolve));
});

it("shared generic/bash errors keep three visual body rows and native edit uses returned diff only", () => {
    const renderer = new ConversationRenderer();
    try {
        const tool: ConversationEntry = { id: "g", kind: "toolResult", name: "foreign_tool", text: "ROW0\nROW1\nROW2\nROW3\nROW4", elided: 0, error: true };
        const compact = stripTerminalSequences(renderer.render([tool], 100, themeSdk.theme).join("\n"));
        assert.match(compact, /ROW2/); assert.doesNotMatch(compact, /ROW3/);
        const edit: ConversationEntry = { id: "edit", kind: "toolResult", name: "edit", text: "success", elided: 0,
            call: { name: "edit", parameters: { status: "complete", json: '{"path":"/must/not/read","edits":[{"oldText":"a","newText":"b"}]}' } },
            display: { status: "complete", diff: "-1 a\n+1 b", firstChangedLine: 1 } };
        const expanded = stripTerminalSequences(renderer.render([edit], 100, themeSdk.theme, { expanded: new Set(["edit"]) }).join("\n"));
        assert.match(expanded, /-1 a|−1 a/); assert.match(expanded, /\+1 b/);
        assert.doesNotMatch(expanded, /Could not edit|Arguments/);
    } finally { renderer.dispose(); }
});

it("native write expansion survives repeated renders/args replacement and keeps default summary", () => {
    const renderer = new ConversationRenderer();
    const entry = (content: string): ConversationEntry => ({ id: "write", kind: "toolResult", name: "write", text: "success", elided: 0,
        call: { name: "write", parameters: { status: "complete", json: JSON.stringify({ path: "a.ts", content }) } } });
    try {
        assert.doesNotMatch(stripTerminalSequences(renderer.render([entry("SECRET")], 100, themeSdk.theme).join("\n")), /SECRET/);
        for (const content of ["FIRST\nBODY", "SECOND\nBODY"]) for (let n = 0; n < 2; n++) {
            const plain = stripTerminalSequences(renderer.render([entry(content)], 100, themeSdk.theme, { expanded: new Set(["write"]) }).join("\n"));
            assert.match(plain, new RegExp(content.split("\n")[0]));
            assert.doesNotMatch(plain, /setText|Arguments/);
        }
        renderer.render([], 100, themeSdk.theme);
        assert.equal((renderer as unknown as { cards: Map<string, unknown> }).cards.size, 0);
    } finally { renderer.dispose(); }
});

it("compact cards use one auxiliary row, preserve result-before-call data and discard stale SDK results", () => {
    const renderer = new ConversationRenderer();
    const call: ConversationEntry = { id: "call", kind: "assistant", text: "", tools: [{ name: "foreign", toolCallId: "x", parameters: { status: "complete", json: '{}' } }] };
    const result: ConversationEntry = { id: "result", kind: "toolResult", name: "foreign", toolCallId: "x", text: "RETAINED", elided: 0 };
    try {
        const model = renderer.renderModel([result, call], 100, themeSdk.theme);
        assert.equal(model.ranges.length, 1);
        const plain = stripTerminalSequences(model.lines.join("\n"));
        assert.match(plain, /RETAINED/);
        assert.equal(model.lines.filter(line => /View parameters|click to expand/.test(line)).length, 1);
        assert.ok(!model.lines.some(line => !stripTerminalSequences(line).trim()));
        assert.doesNotMatch(stripTerminalSequences(renderer.render([call], 100, themeSdk.theme, { expanded: new Set(["tool:x"]) }).join("\n")), /RETAINED/);
        const malformed = { ...call, tools: [{ name: "foreign", toolCallId: "x", parameters: { status: "complete" as const, json: '{bad' } }] };
        assert.doesNotThrow(() => renderer.render([malformed], 100, themeSdk.theme));
        const legacy = stripTerminalSequences(renderer.render([{ ...result, toolCallId: undefined }], 100, themeSdk.theme).join("\n"));
        assert.doesNotMatch(legacy, /View parameters.*unavailable/);
    } finally { renderer.dispose(); }
});

it("native write body removes logical heading before wrapping long paths and keeps first row", () => {
    const renderer = new ConversationRenderer();
    const result: ConversationEntry = { id: "write-long", kind: "toolResult", name: "write", text: "ok", elided: 0,
        call: { name: "write", parameters: { status: "complete", json: JSON.stringify({ path: "long/".repeat(40) + "a.ts", content: "FIRST_BODY\nLAST_BODY" }) } } };
    try {
        const plain = stripTerminalSequences(renderer.render([result], 24, themeSdk.theme, { expanded: new Set(["write-long"]) }).join("\n"));
        assert.match(plain, /FIRST_BODY/); assert.match(plain, /LAST_BODY/);
        assert.doesNotMatch(plain, /long\//);
    } finally { renderer.dispose(); }
});

it("native read keeps numbered reuse without resident async highlighting jobs or caches", async () => {
    const { DetailToolCard } = await import("../detail-tool-card.ts");
    const input = { id: "read-async", call: { name: "read", parameters: { status: "complete" as const, json: '{"path":"a.ts"}' } },
        result: { id: "result", kind: "toolResult" as const, text: "const x = 1", elided: 0 } };
    let redraws = 0;
    const card = new DetailToolCard(input, () => { redraws++; });
    const highlighter = (card as unknown as { highlighter: Highlighter }).highlighter;
    assert.equal(highlighter.active, false); assert.equal(highlighter.size, 0);
    const rows = stripTerminalSequences(card.render(input, true, 100, themeSdk.theme).join("\n"));
    assert.match(rows, /1 │ const x = 1/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(redraws, 0); assert.equal(highlighter.size, 0);
    card.render({ ...input, result: undefined }, true, 100, themeSdk.theme);
    assert.equal(highlighter.active, false);
    card.render(input, true, 100, themeSdk.theme);
    card.dispose();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(redraws, 0); assert.equal(highlighter.size, 0);
});

it("public SDK light/dark theme changes rebuild sanitized native cards", () => {
    const renderer = new ConversationRenderer();
    const entry: ConversationEntry = { id: "theme", kind: "toolResult", name: "foreign", text: "正文😀\x1b]0;EVIL\x07", elided: 0,
        call: { name: "foreign", detail: "中文\x1b]0;EVIL\x07", parameters: { status: "truncated", json: '{partial' } } };
    try {
        themeSdk.initTheme("dark", false);
        const dark = renderer.render([entry], 100, themeSdk.theme).join("\n");
        themeSdk.initTheme("light", false);
        const light = renderer.render([entry], 100, themeSdk.theme).join("\n");
        assert.notEqual(dark, light); assert.doesNotMatch(dark + light, /EVIL/);
        assert.match(stripTerminalSequences(light), /正文😀/);
    } finally { renderer.dispose(); themeSdk.initTheme("dark", false); }
});
