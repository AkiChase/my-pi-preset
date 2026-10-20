import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMonitorTool } from "../../process-tasks/tools/monitor.ts";
import type { BackgroundRegistry } from "../../process-tasks/state.ts";
import { KeybindingsManager, loadExtensions, resolver, ToolExecutionComponent } from "./renderer-host.mjs";
import { withToolCardTiming } from "../tool-card.ts";

const screen = new TuiMainScreen({
  columns: 160,
  rows: 60,
  kittyProtocolActive: false,
  start() {},
  stop() {},
  async drainInput() {},
  write() {},
  moveBy() {},
  hideCursor() {},
  showCursor() {},
  clearLine() {},
  clearFromCursor() {},
  clearScreen() {},
  setTitle() {},
  setProgress() {},
  setProgramStatus() {},
});
screen.requestRender = () => {};

function rows(component: InstanceType<typeof ToolExecutionComponent>, width = 160): string[] {
  return component.render(width).map((row: string) => plain(row).trim()).filter(Boolean);
}

test("actual monitor tool adopts the public card while preserving monitor output", async () => {
  const root = mkdtempSync(join(tmpdir(), "beautify-monitor-card-"));
  try {
    const loaded = await loadExtensions([fileURLToPath(new URL("../../beautify.ts", import.meta.url))], root);
    assert.deepEqual(loaded.errors, []);
    const beauty = resolver(loaded, root);
    setKeybindings(new KeybindingsManager({ "app.tools.expand": ["alt+o"] }));
    const registered = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
    registerMonitorTool({ registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { registered.set(tool.name, tool); } } as ExtensionAPI, {} as BackgroundRegistry);
    const source = registered.get("monitor")!;
    assert.ok(withToolCardTiming(source, () => ({ kind: "elapsed", durationMs: 0 })), "monitor renderer exposes the cooperative timing seam");
    const renderers = beauty.resolveToolRenderers("monitor", () => source);
    const card = new ToolExecutionComponent(
      "monitor",
      "monitor-run",
      { command: "tail -f service.log", ws: null, description: "Service readiness events", timeout_ms: 600000, wake_absent_ms: 60000 },
      { outputPad: 2 },
      renderers,
      screen,
      root,
    );
    const fire = async (name: string, event: object) => {
      for (const handler of loaded.extensions[0].handlers.get(name) ?? []) await handler(event, {});
    };
    await fire("tool_execution_start", { toolName: "monitor", toolCallId: "monitor-run" });
    card.markExecutionStarted();
    assert.match(rows(card).join("\n"), /Service readiness events/);
    assert.match(rows(card).join("\n"), /Running.*elapsed \d+\.\ds/);
    await fire("tool_execution_end", { toolName: "monitor", toolCallId: "monitor-run" });
    card.updateResult({
      content: Array.from({ length: 6 }, (_, index) => ({ type: "text" as const, text: `monitor result ${index + 1}` })),
      durationMs: 1500,
      isError: false,
    });
    const collapsed = rows(card).join("\n");
    assert.equal((collapsed.match(/monitor\s+Service readiness events/g) ?? []).length, 1, "one public title only");
    assert.match(collapsed, /Completed.*execution 1\.5s/);
    assert.match(collapsed, /monitor result 1/);
    assert.doesNotMatch(collapsed, /monitor result 6/);
    assert.match(collapsed, /expand/);
    card.setExpanded(true);
    assert.match(rows(card).join("\n"), /monitor result 6/);

    card.updateResult({ content: [{ type: "text" as const, text: "Monitor setup cancelled: offline source failure" }], isError: true });
    card.setExpanded(false);
    assert.match(rows(card).join("\n"), /Failed/);
    assert.match(rows(card).join("\n"), /offline source failure/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
