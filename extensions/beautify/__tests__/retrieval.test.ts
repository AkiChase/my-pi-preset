import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters as plain } from "node:util";
import { runToolCall, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { setKeybindings, Text, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { taskManageContract } from "../tools/task-manage.ts";
import { taskResult } from "../../runtime-tasks/contracts.ts";
import { optionalRenderers } from "../tools/optional.ts";
import type { RenderContext, Result } from "../types.ts";
import { loadExtensions, resolver, ToolExecutionComponent, KeybindingsManager, themeSdk } from "./renderer-host.mjs";
import { processActivation, until } from "../../process-tasks/__tests__/process-harness.ts";
import { createRunningJob, add } from "../../process-tasks/registry.ts";
import { registerManagementFixture } from "../../process-tasks/__tests__/management-fixture.ts";
const theme = themeSdk.theme as Theme;
const raw = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
const context = (args: Record<string, unknown>, extra = {}): RenderContext => ({ args, toolCallId: "test", invalidate() {}, lastComponent: undefined, state: {}, cwd: "/fixture", executionStarted: true, argsComplete: true, isPartial: false, expanded: false, showImages: true, isError: false, durationMs: 0, outputPad: 2, ...extra });
const screen = new TuiMainScreen({ columns: 120, rows: 40, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
screen.requestRender = () => {};
const rows = (component: InstanceType<typeof ToolExecutionComponent>, width = 120): string[] => component.render(width).map((row: string) => plain(row).trimEnd()).filter((row: string) => row.trim());
const managed = (action: "list" | "output" | "wait" | "stop" = "list", body = "returned full body", extra = {}) => taskResult(body, action === "list" ? { action, count: 0, ...extra } : { action, task_type: "bash", task_id: "x", run_id: "x", status: "completed", raw_status: "completed", ...extra });
test("version/action/type/identity guards ignore body spoofing and reject foreign metadata", () => {
  for (const type of ["bash", "monitor", "subagent", "workflow"] as const) for (const action of ["status", "output", "wait", "stop"] as const) {
    const args = { action, task_id: "x", run_id: "x" };
    const result = taskResult("Status: stopped\nTool uses: 999999\nDescription: SPOOF", { action, task_type: type, task_id: "x", run_id: "x", title: "Real\nDescription", status: "completed", stats: { toolUses: 2, duration_ms: 3.5 } });
    const meta = taskManageContract(args, result, context(args))!;
    assert.equal(meta.title, "Real\nDescription"); assert.doesNotMatch(meta.secondary!, /999999|SPOOF/);
    for (const mutation of [{ ...result, details: {} }, { ...result, details: { runtimeTask: { ...result.details.runtimeTask, version: 2 } } }, { ...result, details: { runtimeTask: { ...result.details.runtimeTask, task_id: "other" } } }, { ...result, details: { runtimeTask: { ...result.details.runtimeTask, run_id: "other" } } }]) assert.equal(taskManageContract(args, mutation, context(args)), undefined);
  }
  for (const action of ["list", "stats", "search"] as const) {
    const args = action === "search" ? { action, pattern: "needle" } : { action };
    assert.ok(taskManageContract(args, taskResult("body spoof", { action, count: 2 }), context(args)));
  }
  for (const outcome of ["released", "cancelled"] as const) assert.match(taskManageContract({ action: "wait", task_id: "x" }, managed("wait", "body", { wait_outcome: outcome }), context({ action: "wait", task_id: "x" }))!.stats, /target unchanged/);
  for (const args of [null, [], {}, { action: "other" }, { action: "stop" }, { action: "search" }, { action: "list", wait: 1 }, { action: "output", task_id: 42 }]) assert.equal(taskManageContract(args as never, undefined, context({})), undefined);
});

test("actual backend stop summaries report observed status without inventing a request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-stop-truth-")), f = processActivation(dir);
  try {
    const finished = await f.execute("bash", { command: "printf complete" }) as unknown as { details: { runtimeLaunch: { task_id: string } } };
    const running = await f.execute("bash", { command: "tail -f /dev/null", run_in_background: true, notify: false }) as unknown as { details: { runtimeLaunch: { task_id: string } } };
    for (const [id, requested, observed] of [[finished.details.runtimeLaunch.task_id, false, "completed"], [running.details.runtimeLaunch.task_id, true, "killed"], [running.details.runtimeLaunch.task_id, false, "killed"]] as const) {
      const args = { action: "stop", task_id: id };
      const result = await f.execute("task_manage", args) as unknown as Result;
      assert.match(result.content[0]!.type === "text" ? result.content[0]!.text ?? "" : "", requested ? /Stop requested/ : /Stop not needed/);
      assert.equal(taskManageContract(args, result, context(args))!.stats, `stop · observed ${observed}`);
      const c = new ToolExecutionComponent("task_manage", "truth", args, {}, optionalRenderers("task_manage", undefined, taskManageContract), screen, dir);
      c.updateResult({ ...result, isError: false });
      assert.doesNotMatch(rows(c).join("\n"), /requested/);
    }
  } finally { await f.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("actual host optional call/result sync, mouse/key expansion, pending/partial/final and historical state", () => {
  setKeybindings(new KeybindingsManager({ "app.tools.expand": ["alt+o"] }));
  for (const [name, contract, args, answer] of [
    ["task_manage", taskManageContract, { action: "output", task_id: "x" }, managed("output", "body\nline15")],
  ] as const) {
    const component = new ToolExecutionComponent(name, "real", args, {}, optionalRenderers(name, undefined, contract), screen, "/fixture");
    component.updateResult({ ...answer, isError: false });
    assert.equal(rows(component).length, 1);
    component.setExpanded(true); assert.match(rows(component).join("\n"), /line15/);
    component.setExpanded(false); assert.equal(rows(component).length, 1);
  }
  const args = { action: "wait", task_id: "x" };
  const component = new ToolExecutionComponent("task_manage", "attach", args, {}, optionalRenderers("task_manage", undefined, taskManageContract), screen, "/fixture");
  component.updateResult({ ...managed("wait", "Status: killed\nold chunk", { wait_outcome: "waiting" }), isError: false }, true);
  assert.match(rows(component).join("\n"), /waiting/);
  component.setExpanded(true); assert.match(rows(component).join("\n"), /old chunk/);
  const final = "Wait released; target unchanged. Use task_manage action=output to check on it.";
  component.updateResult({ ...managed("wait", final, { wait_outcome: "released" }), isError: false });
  assert.doesNotMatch(rows(component).join("\n"), /old chunk/);
  component.setExpanded(false); assert.match(rows(component).join("\n"), /wait released/); assert.doesNotMatch(rows(component).join("\n"), /killed/);
});

test("optional tool identity precedes long details in pending, terminal and expanded titles", () => {
  for (const action of ["list", "status", "output", "wait", "stop", "search", "stats"] as const) {
    const args = action === "search" ? { action, pattern: "long-pattern/".repeat(60) } : ["list", "stats"].includes(action) ? { action } : { action, task_id: "x" };
    const output = taskResult("Already returned full body", ["list", "search", "stats"].includes(action)
      ? { action, count: 3 } : { action, task_type: "subagent", task_id: "x", run_id: "1", title: "非常长描述/".repeat(60), status: "completed" });
    const c = new ToolExecutionComponent("task_manage", "identity", args, { outputPad: 2 }, optionalRenderers("task_manage", undefined, taskManageContract), screen, "/fixture");
    for (const stage of ["pending", "result"]) {
      if (stage === "result") c.updateResult({ ...output, isError: false });
      for (const expanded of [false, true]) {
        c.setExpanded(expanded);
        for (const width of [8, 20, 40, 80, 120]) {
          const rendered = c.render(width);
          assert.ok(rendered.every((line: string) => visibleWidth(line) <= width));
          if (width >= 15) assert.ok(rows(c, width)[0]!.trim().startsWith("task_manage"), `${action}/${stage}/${expanded}/${width}`);
        }
      }
    }
  }
});

test("optional identities stay complete for managed detail results", () => {
  for (const action of ["list", "search", "output", "wait"] as const) {
    const args = action === "search" ? { action, pattern: "very-long-pattern/".repeat(60) } : action === "list" ? { action } : { action, task_id: "x" };
    const result = taskResult("Already returned answer", action === "list" || action === "search"
      ? { action, count: 0 } : { action, task_type: "subagent", task_id: "x", run_id: "1", title: "Review source", status: "completed" });
    const c = new ToolExecutionComponent("task_manage", "detail", args, {}, optionalRenderers("task_manage", undefined, taskManageContract), screen, "/fixture");
    c.updateResult({ ...result, isError: false });
    assert.ok(rows(c)[0]!.trim().startsWith("task_manage"));
    c.setExpanded(true); assert.match(rows(c).join("\n"), /Already returned answer/);
  }
});

test("unknown formats delegate original slots/state/shell, known→unknown switches synchronously and missing original has generic preview", () => {
  let previousCall: unknown, previousResult: unknown, originalState: unknown;
  const original: ToolRenderers = {
    renderShell: "self",
    renderCall(_args, _theme, ctx) {
      assert.equal(ctx.lastComponent, previousCall); assert.equal(ctx.state, originalState ?? ctx.state); originalState = ctx.state;
      assert.deepEqual(Object.keys(ctx.state), []);
      previousCall = new Text("ORIGINAL CALL", 0, 0); return previousCall as Text;
    },
    renderResult(_result, _options, _theme, ctx) {
      assert.equal(ctx.lastComponent, previousResult); assert.equal(ctx.state, originalState);
      previousResult = new Text("ORIGINAL RESULT", 0, 0); return previousResult as Text;
    },
  };
  const component = new ToolExecutionComponent("task_manage", "delegate", { action: "list" }, {}, optionalRenderers("task_manage", original, taskManageContract), screen, "/fixture");
  component.updateResult({ ...raw("unknown new format"), isError: false });
  assert.deepEqual(rows(component), ["ORIGINAL CALL", "ORIGINAL RESULT"]);
  assert.doesNotMatch(component.render(120).join("\n"), /\x1b\[48/);
  component.updateResult({ ...managed(), isError: false }); assert.equal(rows(component).length, 1);
  component.updateResult({ ...raw("future format"), isError: false }); assert.deepEqual(rows(component), ["ORIGINAL CALL", "ORIGINAL RESULT"]);
  component.invalidate(); assert.deepEqual(rows(component), ["ORIGINAL CALL", "ORIGINAL RESULT"]);
  const fallback = new ToolExecutionComponent("task_manage", "generic", {}, {}, optionalRenderers("task_manage", undefined, taskManageContract), screen, "/fixture");
  const text = Array.from({ length: 15 }, (_, i) => `line${i}`).join("\n");
  fallback.updateResult({ ...raw(text), isError: false });
  assert.match(rows(fallback).join("\n"), /5 more lines/); assert.doesNotMatch(rows(fallback).join("\n"), /line14/);
  fallback.setExpanded(true); assert.match(rows(fallback).join("\n"), /line14/);
});

test("unknown default renderer shell preserves host-style Box, full original context and details", () => {
  const args = { foreign: true }, details = { alien: 1 };
  let callArgs: unknown, resultSeen: unknown;
  const original: ToolRenderers = { renderShell: "default", renderCall(input, _theme, ctx) { callArgs = input; assert.equal(ctx.outputPad, 2); assert.equal(ctx.cwd, "/fixture"); return new Text("original", 0, 0); }, renderResult(result, options) { resultSeen = result; return new Text(options.expanded ? "expanded alien" : "alien", 0, 0); } };
  const c = new ToolExecutionComponent("task_manage", "foreign", args, { outputPad: 2 }, optionalRenderers("task_manage", original, taskManageContract), screen, "/fixture");
  const result = { ...raw("future"), details }; c.updateResult({ ...result, isError: true });
  assert.equal(callArgs, args); assert.deepEqual(resultSeen, result);
  assert.ok(c.render(80).some((line: string) => line.includes(themeSdk.theme.getBgAnsi("toolErrorBg"))));
  assert.match(rows(c).join("\n"), /alien/); c.setExpanded(true); assert.match(rows(c).join("\n"), /expanded alien/);
});

test("actual loader optional absence/dynamic next, no tools registered, unrelated renderer identity unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-optional-loader-"));
  const loaded = await loadExtensions([fileURLToPath(new URL("../../beautify.ts", import.meta.url))], dir);
  try {
    assert.deepEqual(loaded.errors, []); assert.equal(loaded.extensions[0].tools.size, 0);
    const runner = resolver(loaded, dir);
    for (const name of ["write", "subagent_run", "subagent_workflow", "subagent_message", "jobs", "get_subagent_result", "bash_bg", "monitor", "ls", "ask_user_question"]) { const original = { renderShell: "self" }; assert.equal(runner.resolveToolRenderers(name, () => original), original); }
    for (const original of [undefined, { renderShell: "self", renderCall: () => new Text("DYNAMIC", 0, 0), renderResult: () => new Text("RESULT", 0, 0) }]) {
      const renderer = runner.resolveToolRenderers("task_manage", () => original);
      const component = new ToolExecutionComponent("task_manage", "history", { foreign: true }, {}, renderer, screen, dir);
      component.updateResult({ ...raw("old history format"), isError: false });
      assert.match(rows(component).join("\n"), original ? /DYNAMIC/ : /old history/);
    }
  } finally { for (const handler of loaded.extensions[0].handlers.get("session_shutdown") ?? []) await handler({}, {}); rmSync(dir, { recursive: true, force: true }); }
});

test("actual registered process task_manage produces seven action envelopes without display-side reads or consumption", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-jobs-contract-")), f = processActivation(dir);
  const captured = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  registerManagementFixture({ registerTool(tool) { captured.set(tool.name, tool as unknown as Parameters<ExtensionAPI["registerTool"]>[0]); } } as ExtensionAPI, f.reg);
  const execute = (args: Record<string, unknown>) => captured.get("task_manage")!.execute("jobs-test", args, undefined, undefined, f.context);
  const validate = async (args: Record<string, unknown>) => {
    const result = await execute(args), copy = structuredClone(result);
    assert.ok(taskManageContract(args, result, context(args)), JSON.stringify(result));
    const c = new ToolExecutionComponent("task_manage", "real", args, {}, optionalRenderers("task_manage", undefined, taskManageContract), screen, dir);
    c.updateResult({ ...result, isError: false }); c.render(120); c.setExpanded(true); c.render(120);
    assert.deepEqual(result, copy);
  };
  try {
    await validate({ action: "list" }); await validate({ action: "stats" });
    const path = join(dir, "log"); writeFileSync(path, "needle 中文\nsecond needle\n");
    const job = createRunningJob({ id: "testjob", command: "echo (x)", pid: 0, logPath: path, toolCallId: "fake-log" }); add(f.reg, job);
    await validate({ action: "list" }); await validate({ action: "output", task_id: job.id, offset: 1, limit: 8 });
    await validate({ action: "search", pattern: "needle", task_id: job.id }); await validate({ action: "status", task_id: job.id });
    const launched = await f.execute("bash", { command: "while true; do sleep 1; done", run_in_background: true });
    const id = launched.content[0]!.text!.match(/ID: ([^.]+)\./)![1]!;
    let partial: Result | undefined;
    const controller = new AbortController();
    const following = captured.get("task_manage")!.execute("follow", { action: "wait", task_id: id }, controller.signal, result => { partial = result; }, f.context);
    await until(() => !!partial);
    assert.equal(taskManageContract({ action: "wait", task_id: id }, partial, context({ action: "wait", task_id: id }, { isPartial: true }))?.stats, "waiting");
    f.coordinator.detachAll();
    const final = await following;
    assert.equal(taskManageContract({ action: "wait", task_id: id }, final, context({ action: "wait", task_id: id }))?.stats, "wait released · target unchanged");
    assert.equal(f.reg.jobs.get(id)?.status, "running");
    await validate({ action: "stop", task_id: id });
    await validate({ action: "wait", task_id: id });
  } finally { await f.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
test.after(() => screen.stop());

test("self compatibility shell has exactly the default host padding hit bounds and backgrounds", () => {
  const args = { action: "list" };
  for (const original of [undefined, { renderShell: "self" as const }]) {
    const c = new ToolExecutionComponent("task_manage", "hits", args, { outputPad: 2 }, optionalRenderers("task_manage", original, taskManageContract), screen, "/fixture");
    for (const [result, partial, color] of [[undefined, true, "toolPendingBg"], [managed(), false, "toolSuccessBg"], [managed("output", "No task found with ID: x", { error_code: "not_found" }), false, "toolErrorBg"]] as const) {
      c.setExpanded(false);
      if (color === "toolErrorBg") c.updateArgs({ action: "output", task_id: "x" });
      if (result) c.updateResult({ ...result, isError: color === "toolErrorBg" }, partial);
      const rendered = c.render(80), y = rendered.findIndex((line: string) => plain(line).trim());
      assert.equal(y, 2); assert.equal(rendered.length, 4);
      for (const row of rendered.slice(1)) { assert.ok(row.includes(themeSdk.theme.getBgAnsi(color))); assert.equal(visibleWidth(row), 80); }
      if (!result) continue;
      for (const [x, row, handled] of [[0, y, false], [1, y, false], [78, y, false], [79, y, false], [3, 0, false], [3, 1, false], [3, 3, false], [2, y, true], [77, y, true]] as const) {
        c.setExpanded(false); c.render(80);
        c.handleMouse({ type: "click", button: "left", x, y: row, width: 80, height: 4 });
        assert.equal(rows(c).length > 1, handled, `${original?.renderShell ?? "default"} ${x},${row} expansion`);
      }
    }
  }
});

test("generic fallback renders raw expanded arguments, bounded collapsed args, and replaces throwing delegates without stale data", () => {
  const args = { foreign: "first\nlast", long: "x".repeat(300) };
  for (const original of [undefined, { renderShell: "self" as const, renderCall() { throw new Error("call failure"); }, renderResult() { throw new Error("result failure"); } }]) {
    const c = new ToolExecutionComponent("task_manage", "fallback", args, {}, optionalRenderers("task_manage", original, taskManageContract), screen, "/fixture");
    c.updateResult({ ...raw("old response"), isError: false });
    c.updateResult({ ...raw("new response"), isError: false });
    assert.doesNotMatch(rows(c).join("\n"), /old response/); assert.match(rows(c).join("\n"), /new response/);
    assert.ok(rows(c).length <= 4, "collapsed args preview must be bounded rather than full JSON");
    c.setExpanded(true);
    const full = rows(c).join("\n");
    assert.match(full, /first\n\s+last/); assert.doesNotMatch(full, /first\\nlast/);
    assert.equal((full.match(/x/g) ?? []).length, 300);
  }
  for (const args of [null, [], "invalid", { action: null }]) {
    const c = new ToolExecutionComponent("task_manage", "invalid", args, {}, optionalRenderers("task_manage", undefined, taskManageContract), screen, "/fixture");
    c.updateResult({ ...raw("readable unknown"), isError: false }); c.setExpanded(true);
    assert.match(rows(c).join("\n"), /readable unknown/);
  }
});

test("partial→final contracts never delegate using the previous result with new context", () => {
  let calls = 0, results = 0;
  const original: ToolRenderers = { renderShell: "self", renderCall() { calls++; return new Text("foreign call", 0, 0); }, renderResult() { results++; return new Text("foreign result", 0, 0); } };
  const args = { action: "wait", task_id: "x" };
  const c = new ToolExecutionComponent("task_manage", "round", args, {}, optionalRenderers("task_manage", original, taskManageContract), screen, "/fixture");
  c.updateResult({ ...managed("wait", "raw partial body", { wait_outcome: "waiting" }), isError: false }, true);
  c.updateResult({ ...managed("wait", "full log", { wait_outcome: "completed" }), isError: false });
  assert.equal(calls, 0); assert.equal(results, 0);
  assert.equal(rows(c).length, 1); assert.match(rows(c).join("\n"), /completed/);
  c.setExpanded(true); assert.match(rows(c).join("\n"), /full log/);
  c.setExpanded(false); assert.equal(calls, 0); assert.equal(results, 0);
});

test("actual SDK task_manage typed errors retain error flag and render without changing output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-error-contract-")), f = processActivation(dir);
  let definition: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
  registerManagementFixture({ registerTool(tool) { definition = tool as unknown as Parameters<ExtensionAPI["registerTool"]>[0]; } } as ExtensionAPI, f.reg);
  const args = { action: "output", task_id: "missing" };
  const assistantMessage: AssistantMessage = { role: "assistant", content: [], api: "anthropic-messages", provider: "anthropic", model: "offline", stopReason: "toolUse", timestamp: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  try {
    const tool: AgentTool = { name: "task_manage", label: "task_manage", description: "offline", parameters: definition!.parameters,
      execute: (id, args, signal, update) => definition!.execute(id, args, signal, update, f.context) };
    const outcome = await runToolCall({ type: "toolCall", id: "error", name: "task_manage", arguments: args }, { tools: [tool], assistantMessage, context: { messages: [] } });
    assert.equal(outcome.isError, true);
    assert.equal(taskManageContract(args, outcome.result, context(args, { isError: true }))?.stats, "not_found");
    const c = new ToolExecutionComponent("task_manage", "error", args, {}, optionalRenderers("task_manage", undefined, taskManageContract), screen, dir);
    c.updateResult({ ...outcome.result, isError: true });
    assert.match(rows(c).join("\n"), /not_found|not found/i);
    assert.ok(c.render(80).some((line: string) => line.includes(themeSdk.theme.getBgAnsi("toolErrorBg"))));
    c.setExpanded(true); assert.match(rows(c).join("\n"), /not_found|not found/i);
  } finally { await f.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
