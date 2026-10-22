import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters as plain } from "node:util";
import { renderers } from "../tools/shared.ts";
import type { RenderContext } from "../types.ts";
import { setKeybindings, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { KeybindingsManager, ToolExecutionComponent, loadExtensions, resolver, themeSdk } from "./renderer-host.mjs";

// Track effective foreground per printed character, including host background
// restoration/reset sequences. An opening accent alone does not prove parity.
function foregrounds(row: string): string[] {
  let fg = "default";
  const cells: string[] = [];
  for (const part of row.split(/(\x1b\[[\d;]*m)/)) {
    if (!part.startsWith("\x1b[")) { cells.push(...Array.from(part, () => fg)); continue; }
    const codes = part.slice(2, -1).split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0 || code === 39) fg = "default";
      else if (code === 38 || code === 48) {
        const size = codes[i + 1] === 2 ? 4 : 2;
        if (code === 38) fg = codes.slice(i, i + size + 1).join(";");
        i += size;
      } else if (code !== undefined && code >= 30 && code <= 37) fg = String(code);
    }
  }
  return cells;
}
function tone(rows: string[], text: string, color: "accent" | "muted") {
  const row = rows.find(row => plain(row).includes(text));
  assert.ok(row, `missing ${text}: ${rows.map(plain).join("\n")}`);
  const start = Array.from(plain(row).slice(0, plain(row).indexOf(text))).length;
  const expected = foregrounds(themeSdk.theme.fg(color, "x"))[0];
  assert.ok(expected && expected !== "default");
  assert.deepEqual(foregrounds(row).slice(start, start + Array.from(text).length), Array.from(text, () => expected), `${text} should be ${color}`);
}
const description = "Review nested delegation change and temporary cleanup";
const output = Array.from({ length: 17 }, (_, i) => `fixture output ${i + 1}`).join("\n");
const screen = new TuiMainScreen({ columns: 400, rows: 80, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
screen.requestRender = () => {};
const rows = (component: InstanceType<typeof ToolExecutionComponent>, width = 400): string[] => component.render(width).filter((row: string) => plain(row).trim());

test("registered bash preserves original final title text/order/tones in folded and expanded calls", async t => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-title-tones-"));
  const loaded = await loadExtensions([fileURLToPath(new URL("../../beautify.ts", import.meta.url))], dir);
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const fire = async (event: string, toolCallId = "comparison") => {
    for (const handler of loaded.extensions[0].handlers.get(event) ?? []) await handler({ toolName: "bash", toolCallId }, {});
  };
  try {
    assert.deepEqual(loaded.errors, []);
    setKeybindings(new KeybindingsManager());
    const renderer = resolver(loaded, dir).resolveToolRenderers("bash", () => undefined);
    const component = new ToolExecutionComponent("bash", "comparison", {}, { outputPad: 2 }, renderer, screen, dir);
    for (const args of [{ description }, { description, background_after_seconds: -1 }]) {
      component.updateArgs(args);
      for (const expanded of [false, true]) {
        component.setExpanded(expanded);
        const rendered = rows(component);
        tone(rendered, "bash", "accent"); tone(rendered, description, "accent");
        tone(rendered, "ctrl+o expand", "muted");
        assert.doesNotMatch(rendered.map(plain).join("\n"), /elapsed|execution \d|undefined|description:/);
      }
    }
    component.setArgsComplete(); component.markExecutionStarted();
    await fire("tool_execution_start");
    now = 2500;
    for (const expanded of [false, true]) {
      component.setExpanded(expanded);
      tone(rows(component), "elapsed 2.5s", "muted");
      tone(rows(component), "background after -1s", "accent");
    }
    component.updateResult({ content: [{ type: "text", text: output }] }, true);
    tone(rows(component), "17 output lines · elapsed 2.5s", "muted");
    await fire("tool_execution_end");
    component.updateResult({ content: [{ type: "text", text: output }], isError: false, durationMs: 0 });
    now = 90000;
    const expected = `bash  ${description}  background after -1s  17 output lines · execution 0.0s · ctrl+o expand`;
    for (const expanded of [false, true]) {
      component.setExpanded(expanded);
      const rendered = rows(component);
      assert.equal(plain(rendered[0]!).trim(), expected);
      tone(rendered, description, "accent"); tone(rendered, "background after -1s", "accent");
      tone(rendered, "17 output lines · execution 0.0s · ctrl+o expand", "muted");
      assert.doesNotMatch(rendered.map(plain).join("\n"), /elapsed|0ms call|Completed/);
    }
    // New call options stay muted, after retained stats/timing and before hint.
    component.updateArgs({ description, command: "printf fixture", background_after_seconds: -1 });
    for (const expanded of [false, true]) {
      component.setExpanded(expanded);
      const rendered = rows(component);
      assert.match(plain(rendered[0]!), /17 output lines · execution 0\.0s · printf fixture · ctrl\+o expand/);
      tone(rendered, "printf fixture", "muted");
      assert.equal((rendered.map(plain).join("\n").match(/Command:/g) ?? []).length, expanded ? 1 : 0);
      for (const width of [1, 2, 8, 20, 40, 80, 120, 400]) {
        assert.ok(component.render(width).every((row: string) => visibleWidth(row) <= Math.max(width, 5)));
      }
    }
    component.setExpanded(false);
    assert.match(rows(component, 40).map(plain).join("\n").replace(/\s/g, ""), /17outputlines·execution0\.0s/);
    component.setExpanded(true);
    const narrow = rows(component, 80);
    tone(narrow, "17 output lines · execution 0.0s · printf fixture · ctrl+o expand", "muted");
    tone(narrow, "bash", "accent");
    // The same family composition keeps retrieval options muted too; result
    // statistics remain their existing tool-specific labels.
    const runner = resolver(loaded, dir);
    for (const fixture of [
      { name: "read", args: { path: "sample.unknown", offset: 2, limit: 3 }, title: "sample.unknown:2", option: "up to 3 lines", output: "first\nsecond", stats: "2 lines" },
      { name: "find", args: { pattern: "*.ts", path: "src", limit: 3 }, title: "*.ts in src", option: "up to 3 files", output: "src/a.ts\nsrc/b.ts", stats: "2 files shown" },
      { name: "grep", args: { pattern: "needle", path: "src", glob: "*.ts", literal: false, context: 0 }, title: "needle in src", option: "files *.ts · regex · 0 context lines", output: "src/a.ts:2: needle", stats: "1 matching lines shown" },
    ]) {
      const retrieval = new ToolExecutionComponent(fixture.name, `tones-${fixture.name}`, fixture.args, { outputPad: 2 }, runner.resolveToolRenderers(fixture.name, () => undefined), screen, dir);
      for (const phase of ["streaming", "running", "completed"]) {
        if (phase === "running") { retrieval.setArgsComplete(); retrieval.markExecutionStarted(); }
        if (phase === "completed") retrieval.updateResult({ content: [{ type: "text", text: fixture.output }], isError: false, durationMs: 0 });
        for (const expanded of [false, true]) {
          retrieval.setExpanded(expanded);
          tone(rows(retrieval), fixture.title, "accent"); tone(rows(retrieval), fixture.option, "muted");
          if (phase === "completed") tone(rows(retrieval), `${fixture.stats} · execution 0.0s`, "muted");
        }
      }
    }
    // Host keybinding text is retained, not replaced by a hard-coded hint.
    setKeybindings(new KeybindingsManager({ "app.tools.expand": ["alt+o"] }));
    assert.match(rows(component).map(plain).join("\n"), /(?:alt|option)\+o expand/);
    component.updateArgs({ description: "中😀\nnext\x00\x1b]52;c;unfinished", command: "printf\nfixture\x07", background_after_seconds: -1 });
    for (const expanded of [false, true]) {
      component.setExpanded(expanded);
      for (const width of [1, 2, 8, 20, 40, 80, 120]) for (const row of component.render(width)) {
        assert.ok(visibleWidth(row) <= Math.max(width, 5)); assert.equal(row.includes("\n"), false);
        assert.doesNotMatch(row, /\x1b\]/); assert.doesNotMatch(plain(row), /[\x00-\x08\x0b-\x1f]/);
      }
    }
  } finally { await fire("session_shutdown"); setKeybindings(new KeybindingsManager()); rmSync(dir, { recursive: true, force: true }); }
});
test("expanded empty calls restore the hint at the compact separator budget boundary", () => {
  setKeybindings(new KeybindingsManager());
  for (const name of ["bash", "read", "find", "grep"] as const) {
    const ctx: RenderContext = { args: {}, toolCallId: "empty-budget", invalidate() {}, lastComponent: undefined, state: {}, cwd: "/fixture", executionStarted: false, argsComplete: false, isPartial: true, expanded: true, showImages: true, isError: false, durationMs: undefined, outputPad: 0 };
    const call = renderers(name, () => []).renderCall!({}, themeSdk.theme, ctx);
    // With no detail, the compact helper uses two separators (four cells).
    for (const width of [name.length + 2 + "ctrl+o expand".length, name.length + 3 + "ctrl+o expand".length]) {
      const rendered = call.render(width);
      assert.match(rendered.map(plain).join("\n"), /ctrl\+o expand/);
      tone(rendered, "ctrl+o expand", "muted");
      assert.ok(rendered.every(row => visibleWidth(row) <= width));
    }
  }
});
test.after(() => screen.stop());
