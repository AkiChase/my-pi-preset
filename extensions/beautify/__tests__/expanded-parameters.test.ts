import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { setKeybindings, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { bashRenderers } from "../tools/bash.ts";
import { findRenderers } from "../tools/find.ts";
import { grepRenderers } from "../tools/grep.ts";
import { readRenderers } from "../tools/read.ts";
import { Highlighter } from "../highlight.ts";
import type { Args, RenderContext } from "../types.ts";
import { KeybindingsManager, ToolExecutionComponent } from "./renderer-host.mjs";

const screen = new TuiMainScreen({ columns: 400, rows: 80, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
screen.requestRender = () => {};
const highlighter = new Highlighter(async text => text);
setKeybindings(new KeybindingsManager());
const fixtures: Array<{ name: string; renderer: ToolRenderers; args: Args; output: string }> = [
  { name: "bash", renderer: bashRenderers, args: { description: "Check tests", command: "printf first\nprintf second", run_in_background: false, background_after_seconds: -1 }, output: "first\nsecond" },
  { name: "read", renderer: readRenderers(highlighter), args: { path: "a.ts", offset: 65, limit: 40 }, output: "const first = 1\nconst second = 2" },
  { name: "find", renderer: findRenderers, args: { pattern: "*.ts", path: "src", limit: 50 }, output: "src/a.ts\nsrc/b.ts" },
  { name: "grep", renderer: grepRenderers, args: { pattern: "needle", path: "src", glob: "*.ts", ignoreCase: true, literal: false, context: 0, limit: 60 }, output: "src/a.ts:65: needle\nsrc/a.ts-66- context" },
];
const rows = (component: InstanceType<typeof ToolExecutionComponent>, width = 400): string[] => component.render(width).map((row: string) => plain(row).trimEnd()).filter((row: string) => row.trim());

for (const fixture of fixtures) {
  test(`actual SDK ${fixture.name} expanded call retains all arrived arguments across streaming/running/results`, () => {
    let observed: RenderContext | undefined;
    const renderer: ToolRenderers = { ...fixture.renderer, renderCall(args, theme, ctx) {
      observed = ctx as RenderContext;
      return fixture.renderer.renderCall!(args, theme, ctx);
    } };
    const component = new ToolExecutionComponent(fixture.name, `args-${fixture.name}`, {}, { outputPad: 2 }, renderer, screen, "/fixture");
    component.setExpanded(true);
    assert.deepEqual(rows(component).map(row => row.trim()), [fixture.name]);
    const arrived: Args = {};
    const assertTable = () => {
      const output = rows(component).join("\n");
      for (const [key, value] of Object.entries(fixture.args)) {
        const matches = rows(component).filter(row => row.trimStart().startsWith(`${key}: `));
        assert.equal(matches.length, Object.hasOwn(arrived, key) ? 1 : 0, `${key}: ${output}`);
        if (Object.hasOwn(arrived, key)) assert.equal(matches[0]!.trimStart(), `${key}: ${String(value).split("\n")[0]}`);
      }
      assert.doesNotMatch(output, /undefined|more lines, expand/);
      if (Object.hasOwn(arrived, "command")) assert.match(output, /command: printf first\n {4}printf second/);
    };
    for (const [key, value] of Object.entries(fixture.args)) {
      arrived[key] = value;
      component.updateArgs({ ...arrived });
      assert.equal(observed!.isPartial, true);
      assert.equal(observed!.executionStarted, false);
      assert.equal(observed!.argsComplete, false);
      assertTable();
    }
    const snapshot = structuredClone(arrived);
    component.setArgsComplete(); component.markExecutionStarted();
    assert.equal(observed!.executionStarted, true);
    assert.equal(observed!.argsComplete, true);
    assertTable();
    // Result arrival must append a body, never replace or duplicate the call table.
    for (const partial of [true, false]) {
      const result = { content: [{ type: "text" as const, text: fixture.output }], details: undefined, isError: false, durationMs: 10 };
      const copy = structuredClone(result);
      component.updateResult(result, partial);
      assert.equal(observed!.isPartial, partial);
      assertTable();
      const output = rows(component).join("\n");
      const lastKey = Object.keys(arrived).at(-1)!;
      const bodyMarker = fixture.name === "read" ? "65 │ const first" : fixture.name === "grep" ? "65 │ needle" : fixture.name === "find" ? "  a.ts" : "\n  first";
      assert.ok(output.indexOf(bodyMarker) > output.indexOf(`${lastKey}:`), output);
      assert.deepEqual(result, copy);
    }
    component.setExpanded(false);
    const compact = rows(component).join("\n");
    assert.match(compact, /ctrl\+o expand/);
    assert.doesNotMatch(compact, /command:|description:|path:|pattern:|limit:|glob:/);
    component.setExpanded(true); assertTable();
    component.updateResult({ content: [{ type: "text", text: "failure body" }], details: undefined, isError: true });
    assertTable(); assert.match(rows(component).join("\n"), /failure body/);
    for (const width of [1, 2, 8, 20, 40, 80, 120]) {
      assert.ok(component.render(width).every((row: string) => visibleWidth(row) <= Math.max(width, 5)));
    }
    assert.deepEqual(arrived, snapshot);
  });
}

test("expanded shared call uses the generic multiline/JSON formatter without a preview budget", () => {
  const args = { command: "quiet", description: "JSON values", data: { lines: ["first", "last"], enabled: false }, empty: "", nullable: null, hostile: "中😀e\u0301\nnext\t\x00\x01\x07\x1b]52;c;unfinished" };
  const component = new ToolExecutionComponent("bash", "format", args, {}, bashRenderers, screen, "/fixture");
  component.setExpanded(true);
  const output = rows(component).join("\n");
  assert.match(output, /data: \{\n {5}"lines": \[\n {7}"first",\n {7}"last"\n {5}\],\n {5}"enabled": false\n {3}\}/);
  assert.match(output, /empty:\s*\n/);
  assert.match(output, /nullable: null/);
  assert.doesNotMatch(output, /more lines, expand/);
  for (const width of [1, 2, 8, 20, 40, 80, 120]) for (const row of component.render(width)) {
    assert.ok(visibleWidth(row) <= Math.max(width, 5));
    assert.equal(row.includes("\n"), false);
    assert.doesNotMatch(plain(row), /[\x00-\x08\x0b-\x1f\x7f]/);
    assert.doesNotMatch(row, /\x1b\]/);
  }
});

test.after(() => { highlighter.dispose(); screen.stop(); });
