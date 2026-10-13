import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { createReadToolDefinition, type ToolRenderers, type Theme, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { setKeybindings, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { Highlighter, language } from "../highlight.ts";
import { readRenderers } from "../tools/read.ts";
import { bashRenderers } from "../tools/bash.ts";
import { findRenderers } from "../tools/find.ts";
import { grepRenderers } from "../tools/grep.ts";
import { parseMatch, highlightMatch } from "../tools/grep.ts";
import { middlePath, readNotice, searchNotice, splitView } from "../layout.ts";
import type { RenderContext } from "../types.ts";
import { loadExtensions, resolver, ToolExecutionComponent, KeybindingsManager, themeSdk } from "./renderer-host.mjs";
const theme = themeSdk.theme as Theme;
const entry = fileURLToPath(new URL("../../beautify.ts", import.meta.url));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function context(args = {}, overrides = {}): RenderContext { return { args, toolCallId: "test", invalidate() {}, lastComponent: undefined, state: {}, cwd: "/fixture", executionStarted: true, argsComplete: true, isPartial: false, expanded: true, showImages: true, isError: false, durationMs: 0, outputPad: 0, ...overrides }; }
function tui() {
  const screen = new TuiMainScreen({ columns: 120, rows: 40, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} }); screen.requestRender = () => {}; return screen;
}
function result(renderer: ToolRenderers, raw: string, args = {}, overrides = {}) {
  const ctx = context(args, overrides);
  const call = renderer.renderCall!(ctx.args, theme, ctx);
  const body = renderer.renderResult!({ content: [{ type: "text", text: raw }], details: undefined }, { expanded: ctx.expanded, isPartial: false }, theme, ctx);
  return { render: (width: number) => [...call.render(width), ...body.render(width)] };
}

test("actual loader/resolver owns six display adapters, original tool execution/structured output and host images stay untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-loader-")); mkdirSync(join(dir, "cwd"));
  const screen = tui();
  const loaded = await loadExtensions([entry], join(dir, "cwd"));
  try {
    assert.deepEqual(loaded.errors, []); assert.equal(loaded.extensions.length, 1);
    const extension = loaded.extensions[0]; assert.equal(extension.tools.size, 0); assert.equal(extension.toolRenderers.length, 1);
    assert.equal(extension.handlers.has("tool_result"), false);
    const runner = resolver(loaded, dir);
    const base = { renderShell: "default" };
    for (const name of ["edit", "write", "ls", "codemode", "Agent"]) assert.equal(runner.resolveToolRenderers(name, () => base), base);
    for (const name of ["read", "bash", "find", "grep"]) assert.equal(runner.resolveToolRenderers(name, () => base).renderShell, "default");
    let reads = 0;
    const definition = createReadToolDefinition(dir, { operations: { async access() {}, async readFile() { reads++; return Buffer.from("const x = 1;\nlast"); }, async detectImageMimeType() { return undefined; } } });
    const execute = definition.execute, params = definition.parameters, guidelines = definition.promptGuidelines;
    // This public operations seam does not use model/session services; keep only a
    // typed host boundary instead of constructing a real session or changing execution.
    const executionContext = { cwd: dir } as unknown as ExtensionToolContext;
    const actual = await definition.execute("read-test", { path: "missing.ts", offset: 1, limit: 1 }, undefined, undefined, executionContext);
    const snapshot = structuredClone(actual);
    const combined = { ...definition, ...runner.resolveToolRenderers("read", () => definition) };
    assert.equal(combined.execute, execute); assert.equal(combined.parameters, params); assert.equal(combined.promptGuidelines, guidelines);
    const component = new ToolExecutionComponent("read", "read-test", { path: "missing.ts", offset: 1 }, {}, combined, screen, dir);
    component.setExpanded(true); component.updateResult({ ...actual, isError: false, durationMs: 0 });
    component.render(80); await new Promise(resolve => setTimeout(resolve, 150));
    const drawing = component.render(80).join("\n"); assert.match(plain(drawing), /1 │ const x/); assert.match(drawing, /\x1b\[38;2;/);
    assert.equal(reads, 1); assert.deepEqual(actual, snapshot);
    const image = { content: [{ type: "text", text: "Read image file [image/png]" }, { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=" }], details: { original: true }, structuredContent: { type: "image" } };
    const imageCopy = structuredClone(image);
    component.updateResult({ ...image, isError: false });
    const images = (component as unknown as { imageComponents: unknown[] }).imageComponents;
    assert.equal(images.length, 1); assert.match(plain(component.render(80).join("\n")), /Read image file/); assert.deepEqual(image, imageCopy);
    for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({}, { mode: "rpc" });
  } finally { screen.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("four actual host components obey widths/padding/expansion and native metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-components-")), screen = tui();
  const loaded = await loadExtensions([entry], dir), runner = resolver(loaded, dir);
  setKeybindings(new KeybindingsManager({ "app.tools.expand": ["alt+o"] }));
  const path = "源目录/非常长的中间目录/another/really-long-directory/filename.ts";
  const fixtures = [
    { name: "read", args: { path, offset: 65 }, text: "const 中文 = 1;\nsecond line\n\n[2 more lines in file. Use offset=67 to continue.]" },
    { name: "bash", args: { command: "printf 中文", timeout: 5 }, text: "one\ntwo" },
    { name: "find", args: { pattern: "*.ts" }, text: "目录/a.ts\n目录/b.ts\nelse/c.ts\n\n[3 results limit reached. Use limit=6 for more, or refine pattern]" },
    { name: "grep", args: { pattern: "a.b", literal: true, ignoreCase: true }, text: "目录/a.ts:65: A.B match\n目录/a.ts-66- context\nelse/b.ts:2: a.b\n\n[2 matches limit reached. Use limit=4 for more, or refine pattern]" },
  ];
  try {
    for (const fixture of fixtures) {
      const renderer = runner.resolveToolRenderers(fixture.name, () => undefined);
      const component = new ToolExecutionComponent(fixture.name, fixture.name, fixture.args, { outputPad: 2 }, renderer, screen, dir);
      component.updateResult({ content: [{ type: "text", text: fixture.text }], isError: false, durationMs: 0 });
      for (const expanded of [false, true]) {
        component.setExpanded(expanded);
        for (const width of [1, 2, 8, 20, 40, 80, 120]) {
          const rows = component.render(width);
          // Pi Box reserves at least one content cell plus two-sided padding, even below five columns.
          assert.ok(rows.every((line: string) => visibleWidth(line) <= Math.max(width, 5)), `${fixture.name}/${expanded}/${width}`);
          if (fixture.name === "read" && !expanded && width >= 8) assert.ok(rows.some((line: string) => plain(line).includes(":65")));
        }
      }
      component.setExpanded(false); const compact = plain(component.render(120).join("\n"));
      assert.match(compact, /(?:alt|option)\+o/);
      if (fixture.name === "read") { assert.match(compact, /2 lines/); assert.match(compact, /limited/); }
      if (fixture.name === "bash") { assert.match(compact, /0ms call/); assert.match(compact, /timeout 5s/); }
      if (fixture.name === "grep") assert.match(compact, /2 matching lines shown/);
      if (fixture.name === "find") assert.match(compact, /3 files shown/);
      component.setExpanded(true); const expanded = plain(component.render(120).join("\n"));
      if (fixture.name === "read") { assert.match(expanded, /65 │ const/); assert.doesNotMatch(expanded, /67 │.*more lines/); }
      if (fixture.name === "grep") { assert.match(expanded, /65 │ A.B/); assert.match(expanded, /66 ┊ context/); }
    }
    const bash = runner.resolveToolRenderers("bash", () => undefined);
    const handle = "Command running in background with ID: abc. Output is being written to: /fixture/log";
    assert.match(plain(result(bash, handle, {}, { expanded: false }).render(120).join("\n")), /ID: abc/);
    assert.match(plain(result(bash, "failed", {}, { isError: true, expanded: false }).render(80).join("\n")), /failed/);
    assert.match(plain(result(bash, "", {}, { expanded: false, durationMs: undefined }).render(80).join("\n")), /no output/);
    for (const [name, output] of [["find", "No files found matching pattern"], ["grep", "No matches found"]]) assert.match(plain(result(runner.resolveToolRenderers(name, () => undefined), output).render(80).join("\n")), /No /);
  } finally { for (const handler of loaded.extensions[0].handlers.get("session_shutdown") ?? []) await handler({}, {}); screen.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("notice parsing is exact, unknown text/control data is retained safely and path offset stays atomic", () => {
  assert.equal(splitView("a\n\n[1 more lines in file. Use offset=66 to continue.]", readNotice).lines.length, 1);
  assert.equal(splitView("[unknown notice]\n", readNotice).lines.length, 2);
  for (const width of [1, 2, 8, 20, 40, 80]) {
    const path = middlePath("根/long/middle/filename.ts", width, ":65");
    assert.ok(visibleWidth(path) <= width);
    if (width >= 3) assert.ok(path.endsWith(":65"));
    assert.ok(!path.includes(":") || path.endsWith(":65"));
  }
  assert.equal(parseMatch("a-12- name.ts:9: data")?.path, undefined);
  assert.equal(parseMatch("a:b.ts:9: data"), undefined);
  const colored = highlightMatch("A.B axb a.b", { pattern: "a.b", literal: true, ignoreCase: true }, theme);
  assert.match(colored, /\x1b\[/); assert.equal(plain(colored), "A.B axb a.b");
  const markedTheme = { bold: (value: string) => value, fg: (_color: string, value: string) => `[${value}]` } as Theme;
  assert.equal(highlightMatch("A.B axb a.b", { pattern: "a.b", literal: true, ignoreCase: true }, markedTheme), "[A.B] axb [a.b]");
  assert.equal(highlightMatch("A.B a.b", { pattern: "a.b", literal: true }, markedTheme), "A.B [a.b]");
  for (const pattern of ["[", "^", "(a+)+$"]) assert.equal(highlightMatch("aaa", { pattern }, theme), "aaa");
});

test("Shiki ANSI, unknown/80k fallback, finite LRU and once-only redacted diagnostics", async () => {
  const real = new Highlighter();
  try { assert.match((await real.highlight("const x: number = 1", "typescript"))!, /\x1b\[38;2;/); } finally { real.dispose(); }
  let calls = 0, warnings = 0;
  const highlighter = new Highlighter(async text => { calls++; if (text === "SECRET") throw new Error("SECRET path"); return `ansi:${text}`; }, () => { warnings++; });
  assert.equal(await highlighter.highlight("plain", undefined), undefined); assert.equal(await highlighter.highlight("x".repeat(80_001), "typescript"), undefined); assert.equal(calls, 0);
  await highlighter.highlight("SECRET", "typescript"); await highlighter.highlight("SECRET", "typescript"); assert.equal(warnings, 1);
  for (let index = 0; index < 140; index++) await highlighter.highlight(String(index), "typescript"); assert.equal(highlighter.size, 128);
  for (let index = 0; index < 40; index++) await highlighter.highlight(String(index) + "x".repeat(79_000), "typescript"); assert.ok(highlighter.size < 20);
  highlighter.dispose(); assert.equal(highlighter.size, 0); assert.equal(await highlighter.highlight("late", "typescript"), undefined);
});

test("async read redraw rejects changed content, width, collapse, close and preserves successful ANSI on real invalidation", async () => {
  const pending: Array<(text: string) => void> = [];
  const highlighter = new Highlighter(() => new Promise(resolve => { pending.push(resolve); }));
  const renderer = readRenderers(highlighter);
  let invalidations = 0;
  const raw = { content: [{ type: "text" as const, text: "const first = 1" }], details: undefined };
  let ctx = context({ path: "sample.ts" }, { invalidate: () => { invalidations++; } });
  let drawing = renderer.renderResult!(raw, { expanded: true, isPartial: false }, theme, ctx);
  drawing.render(80); drawing.render(40); pending.shift()!("old width"); await tick(); assert.equal(invalidations, 0);
  ctx = { ...ctx, lastComponent: drawing, expanded: false };
  drawing = renderer.renderResult!(raw, { expanded: false, isPartial: false }, theme, ctx); pending.shift()!("old expanded"); await tick(); assert.equal(invalidations, 0);
  ctx = { ...ctx, lastComponent: drawing, expanded: true };
  drawing = renderer.renderResult!({ content: [{ type: "text", text: "const new = 2" }], details: undefined }, { expanded: true, isPartial: false }, theme, ctx); drawing.render(80);
  pending.shift()!("\x1b[38;2;1;2;3mconst new = 2\x1b[0m"); await tick(); assert.equal(invalidations, 1);
  ctx = { ...ctx, lastComponent: drawing };
  drawing = renderer.renderResult!({ content: [{ type: "text", text: "const new = 2" }], details: undefined }, { expanded: true, isPartial: false }, theme, ctx);
  assert.match(drawing.render(80).join("\n"), /\x1b\[38;2;/);
  drawing = renderer.renderResult!({ content: [{ type: "text", text: "late" }], details: undefined }, { expanded: true, isPartial: false }, theme, ctx); drawing.render(80); highlighter.dispose(); pending.shift()!("late"); await tick(); assert.equal(invalidations, 1);
});

test("Read notice separation preserves blank source lines and refuses embedded or unknown lookalikes", () => {
  const notice = "[1 more lines in file. Use offset=66 to continue.]";
  assert.deepEqual(splitView(`a\n\n\n\n${notice}`, readNotice).lines, ["a", "", ""]);
  for (const raw of [`code${notice}`, `code\n${notice}`, "[Showing lines 1-2 of 3 (arbitrary limit). Use offset=3 to continue.]", "[Line 1 is huge, exceeds imaginary limit. Use bash: arbitrary]"]) {
    assert.equal(splitView(raw, readNotice).body, raw);
  }
});

test("exact search notices preserve unknown suffixes and native Read byte-limit notices", () => {
  const raw = "a.ts:1: body\n\n[2 matches limit reached. Unknown extra data]";
  assert.equal(splitView(raw, searchNotice).body, raw);
  for (const notice of [
    "[Showing lines 65-66 of 100 (50.0KB limit). Use offset=67 to continue.]",
    "[Line 65 is 80.0KB, exceeds 50.0KB limit. Use bash: sed -n '65p' src/file.ts | head -c 51200]",
  ]) {
    const view = splitView(notice.startsWith("[Line") ? notice : `code\n\n${notice}`, readNotice);
    assert.deepEqual(view.notice, [notice]);
    assert.equal(view.lines.length, notice.startsWith("[Line") ? 0 : 1);
  }
  for (const notice of ["[3 results limit reached]", "[2 matches limit reached. Use limit=4 for more, or refine pattern. 50.0KB limit reached. Some lines truncated to 500 chars. Use read tool to see full lines]"]) {
    assert.deepEqual(splitView(`body\n\n${notice}`, searchNotice).notice, [notice]);
  }
});

test("language detection preserves the approved Pretty extension/basename map only", () => {
  for (const [path, expected] of [["a.TS", "typescript"], ["file.less", "css"], ["Dockerfile", "dockerfile"], ["GNUmakefile", "make"], ["a.zig", "zig"], ["a.nim", "nim"], ["a.elixir", "elixir"]]) assert.equal(language(path!), expected);
  for (const path of ["python", "typescript", "file.ex", "file.exs", "file.scala", "file.diff", "file.conf", "file.gnumakefile", "file.unknown"]) assert.equal(language(path), undefined);
});

test("multiline/control/Unicode tool titles always return physical width-bounded rows", () => {
  const rawTheme = theme;
  for (const renderer of [bashRenderers, findRenderers, grepRenderers]) {
    const ctx = context({ command: "echo first\necho 第二行", pattern: "first\nsecond", path: "目录\npath" }, { expanded: false });
    const drawing = renderer.renderCall!(ctx.args, rawTheme, ctx);
    for (const width of [1, 2, 8, 20, 40, 80, 120]) {
      for (const row of drawing.render(width)) { assert.equal(row.includes("\n"), false); assert.ok(visibleWidth(row) <= width); }
    }
  }
});

test("external terminal controls are stripped before styling all four tool outputs", () => {
  const highlighter = new Highlighter(async () => { throw new Error("plain fallback"); }, () => {});
  try {
    const evil = "中e\u0301\x1b[31mred\x1b[0m\x1b]52;c;ZXZpbA==\x07\x1b[2J\x00\x08";
    for (const renderer of [readRenderers(highlighter), bashRenderers, findRenderers, grepRenderers]) {
      const raw = renderer === grepRenderers ? `a.ts:65: ${evil}\na.ts-66- context` : evil;
      for (const width of [1, 2, 8, 20, 40, 80, 120]) {
        const rows = result(renderer, raw, { path: "file.unknown", offset: 65 }).render(width);
        for (const row of rows) { assert.ok(visibleWidth(row) <= width); assert.doesNotMatch(row, /\x1b\]|\x1b\[2J|[\x00-\x08\x0b-\x1f](?!\[)/); }
      }
    }
  } finally { highlighter.dispose(); }
});

test("Find unknown notice and partial blank records use readable fallback rather than fabricated counts", () => {
  for (const raw of ["a.ts\n\n[2 results limit reached. Unknown extra data]", "a.ts\n"]) {
    const rows = plain(result(findRenderers, raw, {}, { expanded: false }).render(120).join("\n"));
    assert.match(rows, /output lines/); assert.doesNotMatch(rows, /files shown/);
  }
});
