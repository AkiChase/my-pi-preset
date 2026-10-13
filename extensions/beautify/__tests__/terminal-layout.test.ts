import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { TuiAltScreen, setKeybindings, type Terminal } from "@earendil-works/pi-tui";
import { ToolExecutionComponent, themeSdk, KeybindingsManager } from "./renderer-host.mjs";
import { bashRenderers } from "../tools/bash.ts";
import { readRenderers } from "../tools/read.ts";
import { Highlighter } from "../highlight.ts";

// Interpret SGR at every printed cell, not just the presence of the opening background.
function cellBackgrounds(line: string): string[] {
  let bg = "default";
  const cells: string[] = [];
  for (const part of line.split(/(\x1b\[[\d;]*m)/)) {
    if (!part.startsWith("\x1b[")) { cells.push(...Array.from(part, () => bg)); continue; }
    const codes = part.slice(2, -1).split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0 || code === 49) bg = "default";
      else if (code === 48 || code === 38) {
        const size = codes[i + 1] === 2 ? 4 : 2;
        if (code === 48) bg = codes.slice(i, i + size + 1).join(";");
        i += size;
      } else if (code !== undefined && code >= 40 && code <= 47) bg = String(code);
    }
  }
  return cells;
}
function fullscreen() {
  let columns = 140, resize = () => {};
  const writes: string[] = [];
  const terminal: Terminal = {
    get columns() { return columns; }, rows: 60, kittyProtocolActive: false,
    start(_input, onResize) { resize = onResize; }, stop() {}, async drainInput() {},
    write(data) { writes.push(data); }, moveBy() {}, hideCursor() {}, showCursor() {},
    clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  };
  const screen = new TuiAltScreen(terminal);
  return { screen, writes, resize(width: number) { columns = width; resize(); screen.requestRender(true); } };
}
const highlighter = new Highlighter();
setKeybindings(new KeybindingsManager());
const command = "python3 -c \"print('\\\\n'.join('BASH_LINE_'+str(i) for i in range(30)));print('Job ID background job /tmp/pi-bg/example.log')\"";
for (const fixture of [
  { name: "bash", renderer: bashRenderers, args: { command }, output: "one\ntwo", isError: false },
  { name: "read", renderer: readRenderers(highlighter), args: { path: "missing-file.ts" }, output: "ENOENT: no such file or directory, access '/private/var/folders/fx/isolated-test/T/beautify-final-unique-test/cwd/missing-file.ts'", isError: true },
  { name: "bash", renderer: bashRenderers, args: { command: "run" }, output: "failure " + "long error metadata ".repeat(30), isError: true },
]) {
  test(`actual host terminal-effective background covers shortened ${fixture.name} title, metadata and right padding (${fixture.output.slice(0, 7)})`, () => {
    const { screen } = fullscreen();
    try {
      const tool = new ToolExecutionComponent(fixture.name, "bg", fixture.args, { outputPad: 1 }, fixture.renderer, screen, "/temporary/cwd");
      tool.updateResult({ content: [{ type: "text", text: fixture.output }], isError: fixture.isError });
      const rows = tool.render(140);
      const body = rows.find((row: string) => plain(row).trim())!;
      if (fixture.args.command === command || fixture.name === "read") assert.match(plain(body), /…/);
      const expected = themeSdk.theme.getBgAnsi(fixture.isError ? "toolErrorBg" : "toolSuccessBg").slice(2, -1);
      for (const row of rows.filter((row: string) => row !== "")) {
        const cells = cellBackgrounds(row);
        assert.equal(cells.length, 140);
        assert.ok(cells.every(bg => bg === expected), `background changed at column ${cells.findIndex(bg => bg !== expected)}: ${JSON.stringify(row)}`);
      }
    } finally { screen.stop(); }
  });
}
test("actual fullscreen 140→80→40→140 frames preserve complete-or-omitted hint and Ctrl+O-style expansion", async () => {
  setKeybindings(new KeybindingsManager());
  const host = fullscreen();
  const tool = new ToolExecutionComponent("read", "hint", { path: "sample.ts", offset: 3 }, { outputPad: 1 }, readRenderers(highlighter), host.screen, "/temporary/cwd");
  tool.updateResult({ content: [{ type: "text", text: Array.from({ length: 40 }, (_, i) => `MARK_${i + 3}`).join("\n") + "\n\n[6 more lines in file. Use offset=43 to continue.]" }], isError: false });
  host.screen.addChild(tool);
  try {
    host.screen.start();
    for (const width of [140, 80, 40, 140]) {
      host.writes.length = 0; host.resize(width);
      await new Promise<void>(resolve => setImmediate(resolve));
      const lastFrame = () => host.writes.join("").split("\x1b[?2026h").at(-1)!;
      const collapsed = plain(lastFrame());
      // Fullscreen output is the actual SDK layout + final width clamp, not direct summary().
      assert.match(collapsed, /sample\.ts:3/);
      if (width === 40) assert.doesNotMatch(collapsed, /ctrl/);
      else assert.match(collapsed, /ctrl\+o expand/);
      tool.setExpanded(true); host.screen.requestRender(true);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.match(plain(lastFrame()), /MARK_42/);
      tool.setExpanded(false); host.screen.requestRender(true);
      await new Promise<void>(resolve => setImmediate(resolve));
      const recollapsed = plain(lastFrame());
      assert.doesNotMatch(recollapsed, /MARK_42/);
      assert.match(recollapsed, /sample\.ts:3/);
      if (width === 40) assert.doesNotMatch(recollapsed, /ctrl/);
      else assert.match(recollapsed, /ctrl\+o expand/);
    }
  } finally { host.screen.stop(); }
});
test.after(() => highlighter.dispose());
