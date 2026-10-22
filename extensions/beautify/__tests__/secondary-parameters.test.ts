import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { bashRenderers } from "../tools/bash.ts";
import { findRenderers } from "../tools/find.ts";
import { grepRenderers } from "../tools/grep.ts";
import { readRenderers } from "../tools/read.ts";
import { withSecondaryParameters } from "../tools/shared.ts";
import { Highlighter } from "../highlight.ts";
import type { Args, RenderContext } from "../types.ts";
import { ToolExecutionComponent, themeSdk } from "./renderer-host.mjs";

const screen = new TuiMainScreen({ columns: 400, rows: 40, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
screen.requestRender = () => {};
const highlighter = new Highlighter();
const fixtures: Array<{ name: string; renderer: ToolRenderers; stages: Args[]; fields: string[] }> = [
  { name: "bash", renderer: bashRenderers, stages: [{}, { description: "Check tests" }, { description: "Check tests", command: "npm test" }, { description: "Check tests", command: "npm test", background_after_seconds: 5 }], fields: ["command npm test"] },
  { name: "read", renderer: readRenderers(highlighter), stages: [{}, { path: "a.ts" }, { path: "a.ts", offset: 65 }, { path: "a.ts", offset: 65, limit: 40 }], fields: ["limit 40"] },
  { name: "find", renderer: findRenderers, stages: [{}, { pattern: "*.ts" }, { pattern: "*.ts", path: "src" }, { pattern: "*.ts", path: "src", limit: 50 }], fields: ["limit 50"] },
  { name: "grep", renderer: grepRenderers, stages: [{}, { pattern: "needle", path: "src" }, { pattern: "needle", path: "src", glob: "*.ts" }, { pattern: "needle", path: "src", glob: "*.ts", ignoreCase: true }, { pattern: "needle", path: "src", glob: "*.ts", ignoreCase: true, literal: false }, { pattern: "needle", path: "src", glob: "*.ts", ignoreCase: true, literal: false, context: 0 }, { pattern: "needle", path: "src", glob: "*.ts", ignoreCase: true, literal: false, context: 0, limit: 60 }], fields: ["glob *.ts", "ignoreCase", "literal false", "context 0", "limit 60"] },
];
const visible = (component: InstanceType<typeof ToolExecutionComponent>, width = 400): string[] => component.render(width).map((row: string) => plain(row).trim()).filter(Boolean);

for (const fixture of fixtures) {
  test(`actual SDK ${fixture.name} secondary parameters arrive incrementally and remain visible while running`, () => {
    const observed: RenderContext[] = [];
    const renderer: ToolRenderers = { ...fixture.renderer, renderCall(args, theme, ctx) {
      observed.push(ctx as RenderContext);
      return fixture.renderer.renderCall!(args, theme, ctx);
    } };
    const component = new ToolExecutionComponent(fixture.name, `stream-${fixture.name}`, {}, {}, renderer, screen, "/fixture");
    for (const args of fixture.stages) {
      const copy = structuredClone(args);
      component.updateArgs(args);
      const ctx = observed.at(-1)!;
      assert.equal(ctx.isPartial, true);
      assert.equal(ctx.executionStarted, false);
      assert.equal(ctx.argsComplete, false);
      assert.equal(ctx.durationMs, undefined);
      const rows = visible(component), output = rows.join("\n");
      assert.equal(rows.length, 1);
      for (const field of fixture.fields) {
        if (Object.hasOwn(args, field.split(" ")[0]!)) assert.ok(output.includes(field), output);
        else assert.ok(!output.includes(field), output);
      }
      assert.doesNotMatch(output, /undefined|elapsed|execution \d/);
      assert.deepEqual(args, copy);
    }
    component.setArgsComplete(); component.markExecutionStarted();
    assert.equal(observed.at(-1)!.executionStarted, true);
    assert.equal(observed.at(-1)!.argsComplete, true);
    const running = visible(component).join("\n");
    for (const field of fixture.fields) assert.ok(running.includes(field), running);
    assert.match(running, /expand/);
    if (fixture.name === "read") {
      assert.equal((running.match(/:65/g) ?? []).length, 1);
      assert.doesNotMatch(running, /offset/);
    }
    if (fixture.name === "bash") assert.equal((running.match(/background after 5s/g) ?? []).length, 1);
  });
}

function context(args: Args): RenderContext {
  return { args, toolCallId: "secondary", invalidate() {}, lastComponent: undefined, state: {}, cwd: "/fixture", executionStarted: false, argsComplete: false, isPartial: true, expanded: false, showImages: true, isError: false, durationMs: undefined, outputPad: 0 };
}

test("secondary derivation preserves existing metadata, explicit false/zero, and skips absent/empty parameters", () => {
  const describe = withSecondaryParameters("grep", () => ({ title: "kept", suffix: ":1", stats: "running", secondary: "125ms call", expandedRows: ["kept row"] }));
  const meta = describe(undefined, context({ glob: "", ignoreCase: false, literal: true, context: 0, limit: undefined }));
  assert.deepEqual(meta, { title: "kept", suffix: ":1", stats: "running", secondary: "125ms call · ignoreCase false · literal · context 0", expandedRows: ["kept row"] });
  assert.equal(withSecondaryParameters("read", () => ({ stats: "" }))(undefined, context(Object.create({ limit: 40 }))).secondary, "");
  for (const description of [undefined, "", "  "]) {
    const call = bashRenderers.renderCall!({ description, command: "npm test", run_in_background: false }, themeSdk.theme, context({ description, command: "npm test", run_in_background: false }));
    const output = plain(call.render(400).join("\n"));
    assert.equal((output.match(/npm test/g) ?? []).length, 1);
    assert.doesNotMatch(output, /command npm test|background/);
  }
  const ctx = { ...context({ description: "Check", command: "npm test" }), isPartial: false, durationMs: 125 };
  const call = bashRenderers.renderCall!(ctx.args, themeSdk.theme, ctx);
  bashRenderers.renderResult!({ content: [{ type: "text", text: "done" }], details: undefined }, { expanded: false, isPartial: false }, themeSdk.theme, ctx);
  assert.match(plain(call.render(400).join("\n")), /125ms call · command npm test/);
});

test("partial/running hostile secondary text is sanitized and width-safe without changing compact row contracts", () => {
  const hostile = "中😀e\u0301\nnext\t\x00\x01\x07\x1b]52;c;unfinished";
  for (const fixture of fixtures) {
    const args = { ...fixture.stages.at(-1)!, description: hostile, command: hostile, pattern: hostile, path: hostile, glob: hostile };
    const component = new ToolExecutionComponent(fixture.name, "hostile", args, {}, fixture.renderer, screen, "/fixture");
    for (const running of [false, true]) {
      if (running) { component.setArgsComplete(); component.markExecutionStarted(); }
      for (const expanded of [false, true]) {
        component.setExpanded(expanded);
        for (const width of [1, 2, 8, 20, 40, 80, 120]) {
          const rows = component.render(width);
          for (const row of rows) {
            assert.ok(visibleWidth(row) <= Math.max(width, 5), `${fixture.name}/${running}/${expanded}/${width}`);
            assert.equal(row.includes("\n"), false);
            assert.doesNotMatch(plain(row), /[\x00-\x08\x0b-\x1f\x7f]/);
            assert.doesNotMatch(row, /\x1b\]/);
          }
        }
      }
      component.setExpanded(false);
      for (let width = 10; width <= 400; width++) {
        const rows = visible(component, width);
        assert.equal(rows.length, 1, `${fixture.name}/${running}/${width}`);
        assert.ok(rows.every(row => visibleWidth(row) <= width));
      }
    }
  }
  const ctx = { ...context({ description: hostile, command: hostile }), executionStarted: true };
  const call = bashRenderers.renderCall!(ctx.args, themeSdk.theme, ctx);
  bashRenderers.renderResult!({ content: [{ type: "text", text: "one\ntwo" }], details: undefined }, { expanded: false, isPartial: false }, themeSdk.theme, ctx);
  const narrow = call.render(20).map(plain);
  assert.ok(narrow.length > 1);
  assert.match(narrow.join("\n").replace(/\s/g, ""), /2outputlines/);
  assert.ok(narrow.every(row => visibleWidth(row) <= 20));
});

test.after(() => { highlighter.dispose(); screen.stop(); });
