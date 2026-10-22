import assert from "node:assert/strict";
import { it } from "node:test";
import { createEditToolDefinition, createWriteToolDefinition, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ToolExecutionComponent, themeSdk } from "../../beautify/__tests__/renderer-host.mjs";
import { Highlighter } from "../../beautify/highlight.ts";
import { readRenderers } from "../../beautify/tools/read.ts";
import { createBashRenderers } from "../../beautify/tools/bash.ts";
import { createGrepRenderers } from "../../beautify/tools/grep.ts";
import { createFindRenderers } from "../../beautify/tools/find.ts";
import { DetailToolCard, type DetailTool } from "../detail-tool-card.ts";
import { ConversationRenderer } from "../conversation.ts";
import type { ConversationEntry } from "../types.ts";
const plain = (rows: string[]) => stripTerminalSequences(rows.join("\n"));

it("detail equals actual main SDK renderer output, shell and padding at both expansion states and themes", () => {
    const highlighter = new Highlighter(); highlighter.dispose();
    const edit = createEditToolDefinition("") as ToolRenderers;
    const fixtures = [
        { name: "read", args: { path: "中文😀.txt", offset: 7 }, text: "first\nlast", renderer: readRenderers(highlighter) },
        { name: "bash", args: { command: "printf output", description: "测试 command", background_after_seconds: 2 }, text: "ROW0\nROW1\nROW2\nROW3", renderer: createBashRenderers() },
        { name: "grep", args: { pattern: "found", path: "src", literal: true }, text: "src/a.ts:2: found\nsrc/a.ts:3: found", renderer: createGrepRenderers() },
        { name: "find", args: { pattern: "*.ts", path: "src" }, text: "src/a.ts\nsrc/b.ts", renderer: createFindRenderers() },
        { name: "write", args: { path: "long/".repeat(20) + "a.txt", content: Array.from({ length: 13 }, (_, i) => `WRITE-${i}`).join("\n") }, text: "Successfully wrote", renderer: createWriteToolDefinition("") as ToolRenderers },
        { name: "edit", args: { path: "/must/not/read", edits: [{ oldText: "a", newText: "b" }] }, text: "Successfully replaced", diff: "-1 a\n+1 b", renderer: edit },
        { name: "foreign", args: { target: "中文😀", nested: { count: 3 } }, text: "ROW0\nROW1\nROW2\nROW3", renderer: {} },
    ];
    try {
        for (const theme of ["dark", "light"]) {
            themeSdk.initTheme(theme, false);
            for (const fixture of fixtures) for (const error of [false, true]) {
                const input: DetailTool = { id: fixture.name, call: { name: fixture.name, parameters: { status: "complete", json: JSON.stringify(fixture.args) } },
                    result: { kind: "toolResult", text: fixture.text, elided: 0, error, display: fixture.diff ? { status: "complete", diff: fixture.diff, firstChangedLine: 1 } : undefined } };
                const card = new DetailToolCard(input, () => {});
                const actual = new ToolExecutionComponent(fixture.name, fixture.name, fixture.args, { showImages: false }, fixture.renderer, { requestRender() {} }, "");
                // Real native edit without the unsafe pre-execution preview.
                if (fixture.name !== "edit") actual.setArgsComplete();
                actual.updateResult({ content: [{ type: "text", text: fixture.text }], isError: error, details: fixture.diff ? { diff: fixture.diff, firstChangedLine: 1 } : undefined });
                try {
                    for (const expanded of [false, true, false]) for (const width of [1, 12, 36, 100]) {
                        actual.setExpanded(expanded);
                        const rows = card.render(input, expanded, width, themeSdk.theme);
                        assert.deepEqual(rows, actual.render(width), `${theme}/${fixture.name}/${error}/${expanded}/${width}`);
                        // Native SDK padding may exceed a one-column viewport; the outer conversation clips it.
                        if (width > 2) assert.ok(rows.every(line => visibleWidth(line) <= width));
                    }
                } finally { card.dispose(); }
            }
        }
    } finally { highlighter.dispose(); themeSdk.initTheme("dark", false); }
});

it("read/bash running timing reuses actual factory metadata; cancellation freezes honestly", () => {
    const highlighter = new Highlighter(); highlighter.dispose();
    for (const name of ["read", "bash", "foreign", "write", "edit"]) {
        const args = name === "bash" ? { command: "printf x", description: "Work" } : name === "edit" ? { path: "/must/not/read", edits: [{ oldText: "a", newText: "b" }] } : { path: "a.txt", content: "WRITE_BODY" };
        const input: DetailTool = { id: name, call: { name, parameters: { status: "complete", json: JSON.stringify(args) } }, state: { toolCallId: name, name, status: "running", elapsedMs: 1200 } };
        const card = new DetailToolCard(input, () => {});
        try {
            const running = card.render(input, false, 120, themeSdk.theme);
            assert.match(plain(running), /elapsed 1\.2s/);
            if (name === "bash" || name === "read") {
                const renderer = name === "bash" ? createBashRenderers(() => "elapsed 1.2s") : readRenderers(highlighter, () => "elapsed 1.2s");
                const actual = new ToolExecutionComponent(name, name, args, { showImages: false }, renderer, { requestRender() {} }, "");
                actual.markExecutionStarted(); actual.setArgsComplete();
                assert.deepEqual(running, actual.render(120));
            }
            const interrupted = { ...input, state: { ...input.state!, status: "interrupted" as const } };
            for (const expanded of [false, true, false]) {
                const rows = plain(card.render(interrupted, expanded, 120, themeSdk.theme));
                assert.match(rows, /Interrupted/); assert.match(rows, /elapsed 1\.2s/);
                assert.doesNotMatch(rows, /Running|Completed/);
            }
            assert.doesNotMatch(plain(card.render(input, false, 120, themeSdk.theme)), /Interrupted/);
        } finally { card.dispose(); }
    }
    highlighter.dispose();
});

it("completed read/bash durations equal the actual main timing factory without extra completion labels", () => {
    const highlighter = new Highlighter(); highlighter.dispose();
    for (const name of ["read", "bash"]) {
        const args = name === "read" ? { path: "a.txt" } : { command: "printf x", description: "Work" };
        const input: DetailTool = { id: name, call: { name, parameters: { status: "complete", json: JSON.stringify(args) } },
            state: { name, toolCallId: name, status: "completed", durationMs: 1250, elapsedMs: 9000 },
            result: { kind: "toolResult", text: "x", elided: 0, durationMs: 1250 } };
        const renderer = name === "read" ? readRenderers(highlighter, () => "execution 1.3s") : createBashRenderers(() => "execution 1.3s");
        const actual = new ToolExecutionComponent(name, name, args, { showImages: false }, renderer, { requestRender() {} }, "");
        actual.markExecutionStarted(); actual.setArgsComplete();
        actual.updateResult({ content: [{ type: "text", text: "x" }], isError: false, durationMs: 1250 });
        const card = new DetailToolCard(input, () => {});
        try {
            for (const expanded of [false, true]) {
                actual.setExpanded(expanded);
                const rows = card.render(input, expanded, 100, themeSdk.theme);
                assert.deepEqual(rows, actual.render(100));
                assert.doesNotMatch(plain(rows), /Completed|elapsed 9/);
            }
        } finally { card.dispose(); }
    }
    highlighter.dispose();
});

it("paired SDK cards retain source warnings only, stable IDs and discard stale results", () => {
    const renderer = new ConversationRenderer();
    const call: ConversationEntry = { id: "assistant", kind: "assistant", text: "", tools: [{ name: "read", toolCallId: "r", parameters: { status: "complete", json: '{"path":"中文😀.txt","offset":7}' } }] };
    const result: ConversationEntry = { kind: "toolResult", toolCallId: "r", name: "read", text: Array.from({ length: 65 }, (_, n) => `line-${n}`).join("\n"), elided: 9, display: { status: "truncated" } };
    try {
        const compact = renderer.renderModel([result, call], 100, themeSdk.theme);
        assert.equal(compact.ranges.length, 1); assert.equal(compact.ranges[0].id, "tool:r");
        assert.doesNotMatch(plain(compact.lines), /line-0|View parameters|click to|complete|unavailable/i);
        const expanded = renderer.renderModel([result, call], 100, themeSdk.theme, { expanded: new Set(["tool:r"]) });
        assert.match(plain(expanded.lines), /71 │ line-64/); assert.match(plain(expanded.lines), /source truncated/);
        assert.doesNotMatch(plain(renderer.render([call], 100, themeSdk.theme, { expanded: new Set(["tool:r"]) })), /line-64/);
        const malformed = { ...call, tools: [{ name: "foreign", parameters: { status: "complete" as const, json: "{bad" } }] };
        assert.doesNotThrow(() => renderer.render([malformed], 100, themeSdk.theme));
        const warning = { ...call, tools: [{ name: "read", parameters: { status: "truncated" as const } }] };
        assert.match(plain(renderer.render([warning], 100, themeSdk.theme)), /source parameters truncated/);
    } finally { renderer.dispose(); }
});

it("detail read owns no async highlighting jobs, late redraws or caches", async () => {
    let redraws = 0;
    const input: DetailTool = { id: "read", call: { name: "read", parameters: { status: "complete", json: '{"path":"a.ts"}' } }, result: { kind: "toolResult", text: "const x = 1", elided: 0 } };
    const card = new DetailToolCard(input, () => { redraws++; });
    const highlighter = (card as unknown as { highlighter: Highlighter }).highlighter;
    assert.equal(highlighter.active, false);
    assert.match(plain(card.render(input, true, 100, themeSdk.theme)), /1 │ const x = 1/);
    const before = redraws;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(redraws, before); assert.equal(highlighter.size, 0);
    card.dispose(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(redraws, before); assert.equal(highlighter.size, 0);
});

it("edit never starts an asynchronous filesystem preview and keeps result diff in the native header", async () => {
    let redraws = 0;
    const input: DetailTool = { id: "edit-no-io", call: { name: "edit", parameters: { status: "complete", json: JSON.stringify({ path: "/must/not/read", edits: [{ oldText: "a", newText: "b" }] }) } },
        state: { name: "edit", toolCallId: "edit-no-io", status: "running", elapsedMs: 1000 } };
    const card = new DetailToolCard(input, () => { redraws++; });
    try {
        card.render(input, true, 100, themeSdk.theme);
        const before = redraws;
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(redraws, before, "native pre-execution computeEditsDiff must not start");
        const result: DetailTool = { ...input, state: { ...input.state!, status: "completed", durationMs: 1000 },
            result: { kind: "toolResult", text: "success", elided: 0, display: { status: "complete", diff: "-1 a\n+1 b", firstChangedLine: 1 } } };
        for (const expanded of [false, true, false]) {
            const rows = plain(card.render(result, expanded, 100, themeSdk.theme));
            assert.match(rows, /-1 a/); assert.match(rows, /\+1 b/); assert.match(rows, /execution 1\.0s/);
            assert.doesNotMatch(rows, /Could not edit|Completed/);
        }
    } finally { card.dispose(); }
});

it("theme rebuild and external controls stay sanitized", () => {
    const renderer = new ConversationRenderer();
    const entry: ConversationEntry = { id: "theme", kind: "toolResult", name: "foreign", text: "正文😀\x1b]0;EVIL\x07", elided: 0,
        call: { name: "foreign", parameters: { status: "complete", json: JSON.stringify({ target: "中文\x1b]0;EVIL\x07" }) } } };
    try {
        const dark = renderer.render([entry], 100, themeSdk.theme).join("\n");
        themeSdk.initTheme("light", false);
        const light = renderer.render([entry], 100, themeSdk.theme).join("\n");
        assert.notEqual(dark, light); assert.doesNotMatch(dark + light, /EVIL/); assert.match(stripTerminalSequences(light), /正文😀/);
    } finally { renderer.dispose(); themeSdk.initTheme("dark", false); }
});

it("native title timing uses secondary/status color without recoloring title or body", () => {
    try {
        for (const theme of ["dark", "light"]) {
            themeSdk.initTheme(theme, false);
            for (const name of ["write", "edit"]) {
                const input: DetailTool = { id: name, call: { name, parameters: { status: "complete", json: JSON.stringify({ path: "a.txt", content: "BODY", edits: [{ oldText: "a", newText: "b" }] }) } },
                    state: { toolCallId: name, name, status: "running", elapsedMs: 1200 } };
                const card = new DetailToolCard(input, () => {});
                try {
                    const rows = card.render(input, false, 120, themeSdk.theme).join("\n");
                    assert.ok(rows.includes(themeSdk.theme.fg("toolTitle", themeSdk.theme.bold(name))));
                    assert.ok(rows.includes(themeSdk.theme.fg("muted", " · elapsed 1.2s")));
                    const cancelled = card.render({ ...input, state: { ...input.state!, status: "interrupted" } }, true, 120, themeSdk.theme).join("\n");
                    assert.ok(cancelled.includes(themeSdk.theme.fg("warning", " · Interrupted · elapsed 1.2s")));
                    if (name === "write") assert.ok(rows.includes(themeSdk.theme.fg("toolOutput", "BODY")));
                } finally { card.dispose(); }
            }
        }
    } finally { themeSdk.initTheme("dark", false); }
});

it("paged live and persisted bash launch results equal main metadata and expanded content", async () => {
    const { ConversationPager } = await import("../../agent-tasks/src/conversation-paging.ts");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "detail-launch-parity-"));
    const pager = new ConversationPager();
    try {
        for (const background of [false, true]) {
            const runtimeLaunch = { version: 2 as const, task_type: "bash" as const, task_id: "bash_test", mode: background ? "background" as const : "foreground" as const };
            const args = { command: "printf output", description: "Run fixture" };
            const text = "task_type=bash task_id=bash_test\n" + (background ? "Command running in background with ID: bash_test. Output is being written to: /tmp/test.log" : "ROW1\nROW2\nROW3\nROW4\nROW5\nROW6\nROW7\nROW8\nROW9");
            const messages = [{ role: "assistant", content: [{ type: "toolCall", id: "b", name: "bash", arguments: args }] },
                { role: "toolResult", toolCallId: "b", toolName: "bash", content: [{ type: "text", text }], details: { runtimeLaunch, private: "NOT_RETAINED" } }];
            const path = join(dir, "output.jsonl"); writeFileSync(path, messages.map(message => JSON.stringify({ message })).join("\n") + "\n");
            for (const page of [pager.livePage(`live:${background}`, {}, messages, 0), pager.transcriptPage(`disk:${background}`, path)]) {
                const result = page.entries[1]; assert.ok(result?.kind === "toolResult"); assert.deepEqual(result.display?.runtimeLaunch, runtimeLaunch);
                const input: DetailTool = { id: "b", call: result.call!, result };
                const card = new DetailToolCard(input, () => {});
                const actual = new ToolExecutionComponent("bash", "b", args, { showImages: false }, createBashRenderers(), { requestRender() {} }, "");
                actual.setArgsComplete(); actual.updateResult({ content: [{ type: "text", text }], isError: false, details: { runtimeLaunch } });
                try {
                    for (const expanded of [false, true]) for (const width of [12, 40, 120]) {
                        actual.setExpanded(expanded); assert.deepEqual(card.render(input, expanded, width, themeSdk.theme), actual.render(width));
                    }
                } finally { card.dispose(); }
            }
        }
    } finally { pager.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

it("unknown registered no-renderer tools use actual main SDK fallback, not a shared Completed card", async () => {
    const { loadExtensions, resolver } = await import("../../beautify/__tests__/renderer-host.mjs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const sdkRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
    const { withBuiltInRenderers } = await import(join(sdkRoot, "dist/core/tools/renderers/index.js"));
    const loaded = await loadExtensions(["extensions/beautify.ts"], process.cwd());
    assert.deepEqual(loaded.errors, []);
    const host = resolver(loaded, process.cwd());
    const definition = { name: "fixture_generic", label: "fixture_generic" };
    const renderers = host.resolveToolRenderers("fixture_generic", () => withBuiltInRenderers("fixture_generic", definition));
    assert.equal(renderers, definition);
    const args = { description: "Generic exact argument fixture", value: "same full CLI and detail data" };
    const input: DetailTool = { id: "g", call: { name: "fixture_generic", parameters: { status: "complete", json: JSON.stringify(args) } },
        result: { kind: "toolResult", text: Array.from({ length: 14 }, (_, i) => `ROW${i}`).join("\n"), elided: 0 } };
    for (const theme of ["dark", "light"]) {
        themeSdk.initTheme(theme, false);
        const card = new DetailToolCard(input, () => {});
        const actual: InstanceType<typeof ToolExecutionComponent> = new ToolExecutionComponent("fixture_generic", "g", args, { showImages: false }, renderers, { requestRender() {} }, "");
        actual.setArgsComplete(); actual.updateResult({ content: [{ type: "text", text: input.result!.text }], isError: false });
        try {
            for (const expanded of [false, true, false]) for (const width of [12, 40, 120]) {
                actual.setExpanded(expanded); const rows = card.render(input, expanded, width, themeSdk.theme);
                assert.deepEqual(rows, actual.render(width)); assert.doesNotMatch(plain(rows), /Completed/);
            }
        } finally { card.dispose(); }
    }
    themeSdk.initTheme("dark", false);
});
