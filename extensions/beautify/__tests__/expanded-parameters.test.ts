import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters as plain } from "node:util";
import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { setKeybindings, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { bashRenderers } from "../tools/bash.ts";
import { findRenderers } from "../tools/find.ts";
import { grepRenderers } from "../tools/grep.ts";
import { readRenderers } from "../tools/read.ts";
import { Highlighter } from "../highlight.ts";
import type { Args, RenderContext } from "../types.ts";
import { KeybindingsManager, ToolExecutionComponent, loadExtensions, resolver } from "./renderer-host.mjs";

const screen = new TuiMainScreen({ columns: 400, rows: 80, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
screen.requestRender = () => {};
const highlighter = new Highlighter(async text => text);
setKeybindings(new KeybindingsManager());
const fixtures: Array<{ name: string; renderer: ToolRenderers; args: Args; fields: Array<[string, string]>; output: string; body: string }> = [
  { name: "bash", renderer: bashRenderers, args: { description: "Check tests", command: "printf first\nprintf second", run_in_background: false, background_after_seconds: 0 }, fields: [["description", "Check tests"], ["command", "printf first\\nprintf second"], ["background_after_seconds", "background after 0s"]], output: "first\nsecond", body: "first" },
  { name: "read", renderer: readRenderers(highlighter), args: { path: "a.ts", offset: 65, limit: 40 }, fields: [["path", "a.ts"], ["offset", ":65"], ["limit", "up to 40 lines"]], output: "const first = 1\nconst second = 2", body: "65 │ const first" },
  { name: "find", renderer: findRenderers, args: { pattern: "*.ts", path: "src", limit: 50 }, fields: [["pattern", "*.ts"], ["path", "in src"], ["limit", "up to 50 files"]], output: "src/a.ts\nsrc/b.ts", body: "a.ts" },
  { name: "grep", renderer: grepRenderers, args: { pattern: "needle", path: "src", glob: "*.ts", ignoreCase: true, literal: false, context: 0, limit: 60 }, fields: [["pattern", "needle"], ["path", "in src"], ["glob", "files *.ts"], ["ignoreCase", "case-insensitive"], ["literal", "regex"], ["context", "0 context lines"], ["limit", "up to 60 matches"]], output: "src/a.ts:65: needle\nsrc/a.ts-66- context", body: "65 │ needle" },
];
const rows = (component: InstanceType<typeof ToolExecutionComponent>, width = 400): string[] => component.render(width).map((row: string) => plain(row).trimEnd()).filter((row: string) => row.trim());
const rawDump = /(?:description|command|background_after_seconds|run_in_background|offset|path|pattern|limit|glob|ignoreCase|literal|context):/;

for (const fixture of fixtures) {
  test(`actual SDK ${fixture.name} shares semantic calls across incremental args, running and results`, () => {
    let observed: RenderContext | undefined;
    const renderer: ToolRenderers = { ...fixture.renderer, renderCall(args, theme, ctx) {
      observed = ctx as RenderContext;
      return fixture.renderer.renderCall!(args, theme, ctx);
    } };
    const component = new ToolExecutionComponent(fixture.name, `args-${fixture.name}`, {}, { outputPad: 2 }, renderer, screen, "/fixture");
    component.setExpanded(true);
    assert.match(rows(component)[0]!.trim(), new RegExp(`^${fixture.name}\\s+ctrl\\+o expand$`));
    const arrived: Args = {};
    const assertCall = () => {
      const output = rows(component).join("\n"), heading = rows(component)[0]!;
      for (const [key, field] of fixture.fields) assert.equal(heading.includes(field), Object.hasOwn(arrived, key), output);
      assert.doesNotMatch(output, rawDump);
      assert.doesNotMatch(output, /undefined|more lines, expand/);
      if (fixture.name === "bash") {
        assert.equal((output.match(/Command:/g) ?? []).length, Object.hasOwn(arrived, "command") ? 1 : 0);
        if (Object.hasOwn(arrived, "command")) assert.match(output, /Command: printf first\n {2}printf second/);
      }
      if (fixture.name === "read" && Object.hasOwn(arrived, "limit")) assert.match(output, /Lines 65–104/);
    };
    for (const [key, value] of Object.entries(fixture.args)) {
      arrived[key] = value; component.updateArgs({ ...arrived });
      assert.equal(observed!.isPartial, true); assert.equal(observed!.executionStarted, false); assert.equal(observed!.argsComplete, false);
      assertCall();
    }
    const callRows = rows(component);
    const snapshot = structuredClone(arrived);
    component.setArgsComplete(); component.markExecutionStarted();
    assert.equal(observed!.executionStarted, true); assert.equal(observed!.argsComplete, true);
    assert.deepEqual(rows(component), callRows);
    for (const partial of [true, false]) {
      const result = { content: [{ type: "text" as const, text: fixture.output }], details: undefined, isError: false, durationMs: 10 };
      const copy = structuredClone(result);
      component.updateResult(result, partial);
      assert.equal(observed!.isPartial, partial); assertCall();
      // Only measurements/results are added; call detail retains its style and order.
      const rendered = rows(component);
      const stats = fixture.name === "bash" ? `2 output lines${partial ? "" : " · 10ms call"}` : fixture.name === "read" ? "2 lines" : fixture.name === "find" ? "2 files shown" : "1 matching lines shown";
      assert.equal(rendered[0]!.replace(`${stats} · `, ""), callRows[0]);
      for (const row of callRows.slice(1)) assert.ok(rendered.includes(row), rendered.join("\n"));
      assert.ok(rendered.slice(callRows.length).join("\n").includes(fixture.body));
      assert.deepEqual(result, copy);
    }
    component.setExpanded(false);
    assert.match(rows(component).join("\n"), /ctrl\+o expand/);
    assert.doesNotMatch(rows(component).join("\n"), /Command:|Lines 65–104/);
    component.setExpanded(true); assertCall();
    component.updateResult({ content: [{ type: "text", text: "failure body" }], details: undefined, isError: true });
    assertCall(); assert.match(rows(component).join("\n"), /failure body/);
    for (const width of [1, 2, 8, 20, 40, 80, 120]) assert.ok(component.render(width).every((row: string) => visibleWidth(row) <= Math.max(width, 5)));
    assert.deepEqual(arrived, snapshot);
  });
}

test("registered boundary preserves shared call information and controls at every phase", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-call-boundary-"));
  const loaded = await loadExtensions([fileURLToPath(new URL("../../beautify.ts", import.meta.url))], dir);
  try {
    assert.deepEqual(loaded.errors, []);
    const runner = resolver(loaded, dir);
    for (const fixture of fixtures) {
      const component = new ToolExecutionComponent(fixture.name, "registered-call", fixture.args, { outputPad: 2 }, runner.resolveToolRenderers(fixture.name, () => undefined), screen, dir);
      component.setExpanded(true);
      const heading = rows(component)[0]!;
      const stats = fixture.name === "bash" ? "2 output lines" : fixture.name === "read" ? "2 lines" : fixture.name === "find" ? "2 files shown" : "1 matching lines shown";
      for (const phase of ["streaming", "running", "completed"] as const) {
        if (phase === "running") { component.setArgsComplete(); component.markExecutionStarted(); }
        if (phase === "completed") component.updateResult({ content: [{ type: "text", text: fixture.output }], isError: false, durationMs: 0 });
        assert.equal(rows(component)[0]!.replace(`${stats} · execution 0.0s · `, ""), heading);
        assert.doesNotMatch(rows(component).join("\n"), rawDump);
        if (fixture.name === "bash") assert.equal((rows(component).join("\n").match(/Command:/g) ?? []).length, 1);
        for (const expanded of [true, false]) {
          component.setExpanded(expanded);
          for (const width of [1, 2, 8, 20, 40, 80, 120]) assert.ok(component.render(width).every((row: string) => visibleWidth(row) <= Math.max(width, 5)));
        }
        component.setExpanded(true);
      }
    }
  } finally {
    for (const handler of loaded.extensions[0]?.handlers.get("session_shutdown") ?? []) await handler({}, {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tool-specific expanded calls sanitize controls and do not dump unknown fields", () => {
  const hostile = "中😀e\u0301\nnext\t\x00\x01\x07\x1b]52;c;unfinished";
  for (const fixture of fixtures) {
    const args = { ...fixture.args, description: hostile, command: hostile, path: hostile, pattern: hostile, glob: hostile, unknown: { nested: true } };
    const component = new ToolExecutionComponent(fixture.name, "controls", args, {}, fixture.renderer, screen, "/fixture");
    component.setExpanded(true);
    assert.doesNotMatch(rows(component).join("\n"), /unknown:|nested:|more lines, expand/);
    for (const width of [1, 2, 8, 20, 40, 80, 120]) for (const row of component.render(width)) {
      assert.ok(visibleWidth(row) <= Math.max(width, 5)); assert.equal(row.includes("\n"), false);
      assert.doesNotMatch(plain(row), /[\x00-\x08\x0b-\x1f\x7f]/); assert.doesNotMatch(row, /\x1b\]/);
    }
  }
});

test.after(() => { highlighter.dispose(); screen.stop(); });
