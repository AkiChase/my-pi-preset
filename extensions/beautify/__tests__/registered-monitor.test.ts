import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters as plain } from "node:util";
import { setKeybindings, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadExtensions, resolver, ToolExecutionComponent, KeybindingsManager, themeSdk } from "./renderer-host.mjs";
import { processActivation, until } from "../../process-tasks/__tests__/process-harness.ts";
import { monitorInput } from "../../process-tasks/__tests__/monitor-input.ts";
import { processInput } from "../../runtime-tasks/__tests__/process-input.ts";
import { registerMonitorTool } from "../../process-tasks/tools/monitor.ts";
import { registerManagementTool, type ManagementDetails } from "../../runtime-tasks/tools.ts";
import { createProcessManagement } from "../../process-tasks/management.ts";
import { monitorContract } from "../tools/monitor.ts";
import type { RenderContext } from "../types.ts";

test("actual loader monitor and process host cards show snapshots/ranges/stats across narrow, partial/final and history fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-monitor-")), h = processActivation(dir, { monitorFlushMs: 3456 });
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const pi = { registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { tools.set(tool.name, tool); } } as ExtensionAPI;
  registerMonitorTool(pi, h.reg);
  registerManagementTool(pi, "process", [createProcessManagement(h.reg, h.source)]);
  const loaded = await loadExtensions([fileURLToPath(new URL("../../beautify.ts", import.meta.url))], dir);
  assert.deepEqual(loaded.errors, []); assert.equal(loaded.extensions[0].tools.size, 0);
  const runner = resolver(loaded, dir);
  setKeybindings(new KeybindingsManager({ "app.tools.expand": ["alt+o"] }));
  const screen = new TuiMainScreen({ columns: 160, rows: 60, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
  screen.requestRender = () => {};
  type Result = Awaited<ReturnType<NonNullable<ReturnType<typeof tools.get>>["execute"]>>;
  const body = (c: InstanceType<typeof ToolExecutionComponent>, width = 160) => c.render(width).map((row: string) => plain(row).trimEnd()).join("\n");
  const display = (name: string, args: Record<string, unknown>, result: Result, partial = false) => {
    const historical = structuredClone(result);
    const renderer = runner.resolveToolRenderers(name, () => tools.get(name));
    const c = new ToolExecutionComponent(name, "actual", args, { outputPad: 2 }, renderer, screen, dir);
    c.updateResult({ ...result, isError: "isError" in result && result.isError === true }, partial);
    for (const expanded of [false, true]) {
      c.setExpanded(expanded);
      for (const width of [8, 20, 40, 80, 160]) {
        const rows = c.render(width);
        assert.ok(rows.every((row: string) => visibleWidth(row) <= width), `${name}/${width}/${expanded}`);
        if (width >= 40) assert.ok(body(c, width).trimStart().startsWith(name));
      }
    }
    assert.deepEqual(result, historical); return c;
  };
  const execute = (args: Record<string, unknown>, update?: Parameters<NonNullable<ReturnType<typeof tools.get>>["execute"]>[3]) => tools.get("process_manage")!.execute("manage", args, undefined, update, h.context);
  try {
    const args = monitorInput({ command: "printf '中文🧠\\n'; tail -f /dev/null", description: "监控🧠".repeat(20) });
    const launch = await tools.get("monitor")!.execute("launch", args, undefined, undefined, h.context);
    const job = [...h.reg.jobs.values()][0]!;
    const noConsumption = job.outcomeSurfaced;
    for (const theme of ["dark", "light"]) {
      themeSdk.initTheme(theme, false);
      const c = display("monitor", args, launch);
      assert.match(body(c), /timeout: no deadline|timeout=no deadline/);
      assert.match(body(c), /silence reminder=disabled/);
      assert.match(body(c), /startup batch configuration=3456ms/);
      c.setExpanded(false); assert.doesNotMatch(body(c), /startup batch configuration/);
      assert.match(body(c), /expand/);
      assert.ok(c.render(160).some((row: string) => row.includes(themeSdk.theme.getBgAnsi("toolSuccessBg"))));
    }
    const originalCall = tools.get("monitor")!.renderCall!(args, themeSdk.theme, {
      args, toolCallId: "original-monitor-call", invalidate() {}, lastComponent: undefined, state: {}, cwd: dir,
      executionStarted: true, argsComplete: true, isPartial: false, expanded: true, showImages: true,
      isError: false, durationMs: undefined, outputPad: 0,
    } satisfies RenderContext);
    assert.match(plain(originalCall.render(40).join("\n")).trimStart(), /^monitor/);
    assert.equal(job.outcomeSurfaced, noConsumption);
    writeFileSync(job.logPath, "中文🧠\n".repeat(25));
    for (const action of ["status", "output"]) {
      const input = processInput({ action, task_id: job.id, ...(action === "output" ? { offset: 3, limit: 9 } : {}) });
      const result = await execute(input), c = display("process_manage", input, result);
      assert.match(body(c), /Monitor execution config/); assert.match(body(c), /Statistics/);
      if (action === "output") {
        const range = (result.details as ManagementDetails).runtimeManagement.range!;
        for (const [key, value] of Object.entries(range)) assert.match(body(c), new RegExp(`${key}: ${value}`));
        assert.doesNotMatch(body(c), /default budget|limit:/);
      }
      c.setExpanded(false); assert.doesNotMatch(body(c), /omitted_before|Statistics/);
      assert.equal(job.outcomeSurfaced, noConsumption);
    }
    const waitArgs = processInput({ action: "wait", task_id: job.id });
    let partial!: Result;
    const waiting = execute(waitArgs, result => { partial = result; });
    await until(() => !!partial);
    const transition = display("process_manage", waitArgs, partial, true);
    assert.match(body(transition), /Monitor execution config/);
    h.coordinator.detachAll(); const released = await waiting;
    transition.updateResult({ ...released, isError: false });
    assert.match(body(transition), /target unchanged/); assert.doesNotMatch(body(transition), /Waiting for entire/);
    await execute(processInput({ action: "stop", task_id: job.id }));
    await until(() => h.reg.executions.size === 0);
    const final = await execute(waitArgs), finalCard = display("process_manage", waitArgs, final);
    assert.match(body(finalCard), /Monitor execution config/); assert.match(body(finalCard), /Log range \(bytes\)/);
    const bashArgs = processInput({ action: "output", task_id: "existing-bash" });
    const bashResult = { content: [{ type: "text" as const, text: "Existing bash body 中文🧠" }], details: { runtimeManagement: {
      version: 2 as const, group: "process" as const, action: "output", task_type: "bash", task_id: "existing-bash", status: "completed",
      range: { start: 2, end: 5, size: 10, omitted_before: 2, omitted_after: 5 }, stats: { pid: 123, duration_ms: 1.5 },
    } } };
    const bashCard = display("process_manage", bashArgs, bashResult);
    assert.match(body(bashCard), /start: 2/); assert.match(body(bashCard), /omitted_after: 5/); assert.match(body(bashCard), /duration_ms: 1.5/);
    assert.doesNotMatch(body(bashCard), /Monitor execution config|default budget|limit:/);
    const errorCard = display("process_manage", waitArgs, { ...final, isError: true,
      content: [{ type: "text", text: "Cannot read monitor log" }], details: { runtimeManagement: { ...(final.details as ManagementDetails).runtimeManagement, error_code: "log_error", range: undefined } } });
    assert.match(body(errorCard), /Monitor execution config/); assert.match(body(errorCard), /Cannot read monitor log/);
    assert.ok(errorCard.render(160).some((row: string) => row.includes(themeSdk.theme.getBgAnsi("toolErrorBg"))));
    const outcome = job.outcomeSurfaced;
    finalCard.render(80); assert.equal(job.outcomeSurfaced, outcome);
    const config = (launch.details as { executionConfig: object }).executionConfig;
    for (const details of [undefined, { runtimeLaunch: { version: 1 } }, { ...(launch.details as object), executionConfig: { ...config, auth: "SECRET" } },
      { ...(launch.details as object), executionConfig: { kind: "agent", phase: "resolved" } },
      { ...(launch.details as object), runtimeLaunch: { version: 2, task_type: "bash", task_id: job.id, mode: "background" } }]) {
      const result = { ...launch, content: [{ type: "text" as const, text: "history fallback 中文🧠" }], details };
      const c = display("monitor", args, result); assert.match(body(c), /history fallback 中文🧠/);
      assert.doesNotMatch(body(c), /Monitor execution config|SECRET/);
    }
    const finalMeta = (final.details as ManagementDetails).runtimeManagement;
    for (const patch of [{ task_id: "foreign" }, { executionConfig: { ...config, command: "SECRET" } }, { stats: { pid: "wrong" } },
      { stats: { PRIVATE_METADATA_KEY: 123 } }, { stats: [] }, { stats: { pid: 1.5 } }, { range: { start: 0 } }]) {
      const result = { ...final, content: [{ type: "text" as const, text: "management fallback" }], details: { runtimeManagement: { ...finalMeta, ...patch } } };
      const c = display("process_manage", waitArgs, result); assert.match(body(c), /management fallback/);
      assert.doesNotMatch(body(c), /Monitor execution config|Statistics|SECRET|PRIVATE_METADATA_KEY/);
    }
    const legacy = { ...launch, details: { runtimeLaunch: (launch.details as { runtimeLaunch: object }).runtimeLaunch } };
    display("monitor", args, legacy);
    const ctx = { isPartial: false, isError: false } as RenderContext;
    assert.equal(monitorContract(monitorInput({ ...args, timeout_ms: 5 }), launch, ctx), undefined);
    assert.equal(h.reg.jobAborts.size, 0); assert.equal(h.coordinator.waitCount, 0);
  } finally {
    screen.stop();
    for (const ext of loaded.extensions) for (const handler of ext.handlers.get("session_shutdown") ?? []) await handler({}, h.context);
    await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true });
  }
});
