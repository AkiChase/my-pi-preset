import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { TuiMainScreen } from "@earendil-works/pi-tui";
import { ToolExecutionComponent, themeSdk } from "./renderer-host.mjs";
import { createToolCardRenderers, withToolCardTiming } from "../tool-card.ts";

const screen = new TuiMainScreen({ columns: 120, rows: 40, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
screen.requestRender = () => {};
const visibleRows = (component: InstanceType<typeof ToolExecutionComponent>, width = 100) => component.render(width).map((row: string) => plain(row).trimEnd()).filter((row: string) => row.trim());

test("self-shell fallback owns a generic title/body card without changing host image ownership", () => {
  const renderer = withToolCardTiming(createToolCardRenderers("foreign_tool"), ctx => ctx.durationMs === undefined
    ? { kind: "elapsed", durationMs: 1250 }
    : { kind: "execution", durationMs: ctx.durationMs })!;
  assert.equal(renderer.renderShell, "self");

  const component = new ToolExecutionComponent("foreign_tool", "foreign", { target: "very-long-target", retries: 2 }, { outputPad: 2 }, renderer, screen, "/fixture");
  assert.match(visibleRows(component).join("\n"), /Pending/);
  component.markExecutionStarted();
  assert.match(visibleRows(component).join("\n"), /Running/);
  assert.match(visibleRows(component).join("\n"), /elapsed 1\.3s/);

  const output = Array.from({ length: 15 }, (_, index) => `line ${index}`).join("\n");
  component.updateResult({ content: [{ type: "text", text: output }], isError: false, durationMs: 1250 });
  const collapsed = visibleRows(component).join("\n");
  assert.match(collapsed, /Completed/);
  assert.match(collapsed, /execution 1\.3s/);
  assert.match(collapsed, /line 0/);
  assert.match(collapsed, /line 2/);
  assert.doesNotMatch(collapsed, /line 3/);
  assert.match(collapsed, /12 more lines/);

  const rendered = component.render(100);
  const bodyY = rendered.findIndex((row: string) => plain(row).includes("line 0"));
  assert.ok(bodyY > 0);
  component.handleMouse({ type: "click", button: "left", x: 3, y: bodyY, width: 100, height: rendered.length });
  assert.match(visibleRows(component).join("\n"), /line 14/);
  component.setExpanded(false);
  component.handleMouse({ type: "click", button: "left", x: 0, y: 1, width: 100, height: component.render(100).length });
  assert.doesNotMatch(visibleRows(component).join("\n"), /line 14/);

  component.setExpanded(true);
  assert.match(visibleRows(component).join("\n"), /line 14/);

  component.updateResult({ content: [{ type: "text", text: "Read image file [image/png]" }, { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=" }], isError: false, durationMs: 0 });
  assert.equal((component as unknown as { imageComponents: unknown[] }).imageComponents.length, 1);
  assert.ok(component.render(100).some((row: string) => row.includes(themeSdk.theme.getBgAnsi("toolSuccessBg"))));
});

test.after(() => screen.stop());
