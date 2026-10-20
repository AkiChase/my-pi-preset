import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { completeToolCall } from "../../agent-tasks/__tests__/tool-inputs.ts";
import { observeWorkflowControl } from "../../agent-tasks/__tests__/source-loader.mjs";
import "../../agent-tasks/__tests__/source-loader.mjs";
import type { WorkflowTask } from "../../agent-tasks/src/workflow/task.ts";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import { KeybindingsManager, loadExtensions, resolver, ToolExecutionComponent } from "./renderer-host.mjs";
import { withToolCardTiming } from "../tool-card.ts";

const { default: agentTasks } = await import("../../agent-tasks/src/index.ts");

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

test("actual registered workflow tool uses the public card and retains its live body", async () => {
  const root = mkdtempSync(join(tmpdir(), "beautify-workflow-card-"));
  const config = join(root, "agent");
  mkdirSync(config);
  writeFileSync(join(config, "agent-tasks.json"), JSON.stringify({ workflowsEnabled: true }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = config;
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
  const tasks = new Map<string, WorkflowTask>();
  const unobserve = observeWorkflowControl((task: WorkflowTask) => tasks.set(task.id, task));
  const coordinator = new TaskCoordinator();
  const lifecycle = new TaskLifecycle(coordinator);
  try {
    const pi = {
      registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { tools.set(tool.name, tool); },
      registerMessageRenderer() {},
      registerEntryRenderer() {},
      registerFlag() {},
      registerCommand() {},
      on(name: string, handler: (...args: unknown[]) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
      events: { on() { return () => {}; }, emit() {} },
      appendEntry() {},
      sendMessage() {},
      getFlag() { return undefined; },
      getAllTools: () => [],
      getActiveTools: () => [],
    } as unknown as ExtensionAPI;
    agentTasks(pi, {
      coordinator,
      lifecycle,
      managerDependencies: { runAgent: async () => { throw new Error("workflow fixture does not launch agents"); } },
    });
    const ctx = {
      cwd: root,
      hasUI: false,
      mode: "print",
      ui: { setWidget() {}, setStatus() {}, notify() {} },
      sessionManager: { getSessionId: () => "workflow-card-test", getBranch: () => [] },
      modelRegistry: {},
    } as unknown as ExtensionToolContext;
    await handlers.get("session_start")![0]!(undefined, ctx);
    const loaded = await loadExtensions([fileURLToPath(new URL("../../beautify.ts", import.meta.url))], root);
    assert.deepEqual(loaded.errors, []);
    const beauty = resolver(loaded, root);
    setKeybindings(new KeybindingsManager({ "app.tools.expand": ["alt+o"] }));
    const source = tools.get("subagent_workflow")!;
    assert.ok(source, "workflows-enabled activation registers the workflow tool");
    assert.ok(withToolCardTiming(source, () => ({ kind: "elapsed", durationMs: 0 })), "workflow renderer exposes the cooperative timing seam");
    const renderers = beauty.resolveToolRenderers("subagent_workflow", () => source);
    const args = completeToolCall(source.parameters, {
      script: 'export const meta = { name: "Live workflow", description: "Inspect rendered workflow progress" }; phase("Review"); log("workflow live detail"); return null;',
      args: null,
    });
    const card = new ToolExecutionComponent("subagent_workflow", "workflow-card", args, { outputPad: 2 }, renderers, screen, root);
    const fire = async (name: string, event: object) => {
      for (const handler of loaded.extensions[0].handlers.get(name) ?? []) await handler(event, {});
    };
    await fire("tool_execution_start", { toolName: "subagent_workflow", toolCallId: "workflow-card" });
    card.markExecutionStarted();
    assert.match(rows(card).join("\n"), /Running.*elapsed \d+\.\ds/);
    const launch = await source.execute("workflow-card", args, undefined, undefined, ctx);
    const taskId = (launch.details as { taskId?: string }).taskId;
    const task = taskId === undefined ? undefined : tasks.get(taskId);
    assert.ok(task, "live workflow task is retained by the registered tool");
    await fire("tool_execution_end", { toolName: "subagent_workflow", toolCallId: "workflow-card" });
    card.updateResult({ ...launch, durationMs: 1100, isError: false });
    const collapsed = rows(card).join("\n");
    assert.equal((collapsed.match(/subagent_workflow/g) ?? []).length, 1, "one public title only");
    assert.match(collapsed, /Completed.*execution 1\.1s/);
    assert.match(collapsed, /Target state:/);
    await task!.terminal;
    assert.match(rows(card).join("\n"), /expand/);
    card.setExpanded(true);
    const expanded = rows(card).join("\n");
    assert.match(expanded, /workflow live detail/);

    const failed = new ToolExecutionComponent("subagent_workflow", "workflow-error", args, { outputPad: 2 }, renderers, screen, root);
    failed.updateResult({ content: [{ type: "text" as const, text: "Workflow authoring error: malformed meta" }], isError: true });
    assert.match(rows(failed).join("\n"), /Failed/);
    assert.match(rows(failed).join("\n"), /malformed meta/);
  } finally {
    try { await lifecycle.shutdown(); }
    finally {
      coordinator.dispose();
      unobserve();
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(root, { force: true, recursive: true });
    }
  }
});
