import { launchMetadata, launchText } from "../../runtime-tasks/launch.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { ToolExecutionComponent, themeSdk } from "./renderer-host.mjs";
import { TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { bashRenderers } from "../tools/bash.ts";
import { findRenderers } from "../tools/find.ts";
import { grepRenderers } from "../tools/grep.ts";
import { readRenderers } from "../tools/read.ts";
import { Highlighter } from "../highlight.ts";

const screen = new TuiMainScreen({ columns: 120, rows: 40, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
screen.requestRender = () => {};
const effective = (rows: string[]) => rows.filter(row => plain(row).trim());
const highlighter = new Highlighter();
const fixtures = [
  { name: "read", renderer: readRenderers(highlighter), args: { path: "file.ts", offset: 65 }, output: "one\ntwo" },
  { name: "bash", renderer: bashRenderers, args: { command: "printf test" }, output: "one\ntwo" },
  { name: "find", renderer: findRenderers, args: { pattern: "*.ts" }, output: "a.ts\nb.ts" },
  { name: "grep", renderer: grepRenderers, args: { pattern: "one" }, output: "a.ts:1: one\na.ts-2- two" },
];
for (const fixture of fixtures) {
  test(`actual host ${fixture.name} paints pending/success/error backgrounds and only host padding`, () => {
    const component = new ToolExecutionComponent(fixture.name, fixture.name, fixture.args, { outputPad: 2 }, fixture.renderer, screen, "/fixture");
    for (const status of ["pending", "success", "error"] as const) {
      if (status !== "pending") component.updateResult({ content: [{ type: "text", text: fixture.output }], details: undefined, isError: status === "error" });
      const rows = component.render(80), row = effective(rows)[0]!;
      assert.ok(row.includes(themeSdk.theme.getBgAnsi(`tool${status[0]!.toUpperCase()}${status.slice(1)}Bg`)), `${status}: missing host background`);
      assert.equal(visibleWidth(row), 80);
      assert.match(plain(row), /^ {2}\S/, "outputPad applied once");
    }
  });
  test(`actual host ${fixture.name} call/result compose synchronously to one collapsed row`, () => {
    const component = new ToolExecutionComponent(fixture.name, fixture.name, fixture.args, { outputPad: 2 }, fixture.renderer, screen, "/fixture");
    component.updateResult({ content: [{ type: "text", text: fixture.output }], details: undefined, isError: false });
    for (const width of [8, 20, 40, 80, 120]) {
      const rows = effective(component.render(width));
      if (fixture.name !== "bash" || width >= 40) assert.equal(rows.length, 1);
      else {
        assert.ok(rows.every(row => visibleWidth(row) <= Math.max(width, 5)));
        assert.match(rows.map(plain).join("\n").replace(/\s/g, ""), /2outputlines/);
      }
    }
    component.setExpanded(true);
    assert.ok(effective(component.render(120)).length > 1);
  });
}
test("actual host fallback errors and ordinary background words remain collapsed, expanded retains all text", () => {
  const raw = "ordinary Job ID /tmp/pi-bg/ running in background\n" + Array.from({ length: 15 }, (_, i) => `line ${i}`).join("\n");
  const component = new ToolExecutionComponent("bash", "fallback", { command: "printf log" }, {}, bashRenderers, screen, "/fixture");
  for (const isError of [false, true]) {
    component.setExpanded(false); component.updateResult({ content: [{ type: "text", text: raw }], isError });
    assert.equal(effective(component.render(120)).length, 1);
    assert.doesNotMatch(plain(component.render(120).join("\n")), /background ID:/);
    component.setExpanded(true); assert.match(plain(component.render(120).join("\n")), /line 14/);
  }
});
test("actual default shell mouse toggles body, partial/error/image/limited output remain one row", () => {
  for (const fixture of fixtures) {
    const component = new ToolExecutionComponent(fixture.name, "edge", fixture.args, { outputPad: 2 }, fixture.renderer, screen, "/fixture");
    const texts = [fixture.output, "failure\n".repeat(15), "Command running in background with ID: abc. Output is being written to: /fixture/log"];
    for (const output of texts) {
      for (const isPartial of [false, true]) {
        component.setExpanded(false); component.updateResult({ content: [{ type: "text", text: output }], isError: true }, isPartial);
        assert.equal(effective(component.render(120)).length, 1);
        const rendered = component.render(120), y = rendered.findIndex((line: string) => plain(line).trim());
        assert.equal(component.handleMouse({ type: "click", button: "left", x: 3, y, width: 120, height: rendered.length })?.handled, true);
        assert.match(plain(component.render(120).join("\n")), /failure|one|background|a\.ts/);
      }
    }
  }
  const read = new ToolExecutionComponent("read", "image", { path: "image.png" }, {}, readRenderers(highlighter), screen, "/fixture");
  read.updateResult({ content: [{ type: "text", text: "Read image file [image/png]" }], isError: false });
  assert.equal(effective(read.render(120)).length, 1); assert.match(plain(read.render(120).join("\n")), /image/);
  const bash = new ToolExecutionComponent("bash", "handle", { command: "run" }, {}, bashRenderers, screen, "/fixture");
  for (const preface of ["running in background", "was manually backgrounded by user"]) {
    bash.updateResult({ content: [{ type: "text", text: `${launchText(launchMetadata("bash", "abc", "abc", "background"))}\nCommand ${preface} with ID: abc. Output is being written to: /fixture/log` }], details: { runtimeLaunch: launchMetadata("bash", "abc", "abc", "background") }, isError: false });
    assert.equal(effective(bash.render(120)).length, 1); assert.match(plain(bash.render(120).join("\n")), /background ID: abc/);
    bash.setExpanded(true); assert.match(plain(bash.render(120).join("\n")), /fixture\/log/); bash.setExpanded(false);
  }
});
test.after(() => { highlighter.dispose(); screen.stop(); });
