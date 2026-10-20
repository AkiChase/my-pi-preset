import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createNestedSubagentTools, type NestedAgentManager } from "../../agent-tasks/src/nested-tools.ts";
import "../../agent-tasks/__tests__/source-loader.mjs";
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

test("actual nested agent tools adopt the public card without changing nested delivery", async () => {
  const root = mkdtempSync(join(tmpdir(), "beautify-nested-card-"));
  try {
    const loaded = await loadExtensions([fileURLToPath(new URL("../../beautify.ts", import.meta.url))], root);
    assert.deepEqual(loaded.errors, []);
    const beauty = resolver(loaded, root);
    setKeybindings(new KeybindingsManager({ "app.tools.expand": ["alt+o"] }));
    const tools = createNestedSubagentTools({
      manager: {} as NestedAgentManager,
      pi: {} as ExtensionAPI,
      parentAgentId: "parent",
      depth: 1,
      maxSubagentDepth: 2,
      allowedSubagents: "all",
      configCwd: root,
    });
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    const source = byName.get("subagent_run")!;
    assert.ok(withToolCardTiming(source, () => ({ kind: "elapsed", durationMs: 0 })), "nested renderer exposes the cooperative timing seam");
    const renderers = beauty.resolveToolRenderers("subagent_run", () => source);
    const card = new ToolExecutionComponent(
      "subagent_run",
      "nested-run",
      { subagent_type: "general-purpose", description: "Inspect narrow output" },
      { outputPad: 2 },
      renderers,
      screen,
      root,
    );
    const fire = async (name: string, event: object) => {
      for (const handler of loaded.extensions[0].handlers.get(name) ?? []) await handler(event, {});
    };
    await fire("tool_execution_start", { toolName: "subagent_run", toolCallId: "nested-run" });
    card.markExecutionStarted();
    assert.match(rows(card).join("\n"), /Running.*elapsed \d+\.\ds/);
    await fire("tool_execution_end", { toolName: "subagent_run", toolCallId: "nested-run" });
    card.updateResult({
      content: Array.from({ length: 6 }, (_, index) => ({ type: "text" as const, text: `nested output ${index + 1}` })),
      durationMs: 800,
      isError: false,
    });
    const collapsed = rows(card);
    assert.equal((collapsed.join("\n").match(/subagent_run/g) ?? []).length, 1, "one public title only");
    assert.match(collapsed.join("\n"), /Completed.*execution 0\.8s/);
    assert.match(collapsed.join("\n"), /nested output 1/);
    assert.doesNotMatch(collapsed.join("\n"), /nested output 6/);
    assert.match(collapsed.join("\n"), /expand/);
    card.setExpanded(true);
    assert.match(rows(card).join("\n"), /nested output 6/);

    const messageSource = byName.get("subagent_message")!;
    const messageRenderers = beauty.resolveToolRenderers("subagent_message", () => messageSource);
    const message = new ToolExecutionComponent(
      "subagent_message",
      "nested-message",
      { agent_id: "child-1", message: "Where is the schema?", reply: "wait" },
      { outputPad: 2 },
      messageRenderers,
      screen,
      root,
    );
    message.updateResult({
      content: [
        { type: "text" as const, text: "Question sent for nested agent child-1." },
        { type: "text" as const, text: "Reply:\nThe schema lives in config.ts." },
      ],
      isError: false,
    });
    assert.match(rows(message)[0]!, /Where is the schema\?/);
    assert.doesNotMatch(rows(message)[0]!, /\bwait\b/);
    message.setExpanded(true);
    assert.match(rows(message).join("\n"), /schema lives in config\.ts/);
    message.updateResult({ content: [{ type: "text" as const, text: "Failed to send the question: offline provider failure" }], isError: true });
    message.setExpanded(false);
    assert.match(rows(message).join("\n"), /Failed/);
    assert.match(rows(message).join("\n"), /offline provider failure/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
