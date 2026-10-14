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
import { agentContract } from "../tools/get-subagent-result.ts";
import { jobsContract } from "../tools/jobs.ts";
import { optionalRenderers } from "../tools/optional.ts";
import type { RenderContext, Result } from "../types.ts";
import { loadExtensions, resolver, ToolExecutionComponent, KeybindingsManager, themeSdk } from "./renderer-host.mjs";
import { processActivation, until } from "../../process-tasks/__tests__/process-harness.ts";
import { createRunningJob, add } from "../../process-tasks/registry.ts";
import { registerJobsTool } from "../../process-tasks/tools/jobs.ts";
const theme = themeSdk.theme as Theme;
const raw = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
const context = (args: Record<string, unknown>, extra = {}): RenderContext => ({ args, toolCallId: "test", invalidate() {}, lastComponent: undefined, state: {}, cwd: "/fixture", executionStarted: true, argsComplete: true, isPartial: false, expanded: false, showImages: true, isError: false, durationMs: 0, outputPad: 2, ...extra });
const screen = new TuiMainScreen({ columns: 120, rows: 40, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
screen.requestRender = () => {};
const rows = (component: InstanceType<typeof ToolExecutionComponent>, width = 120): string[] => component.render(width).map((row: string) => plain(row).trimEnd()).filter((row: string) => row.trim());
const agentHeader = (status = "completed", body = "answer", description = "Review source") => `Agent: a1\nType: General Purpose | Status: ${status} | Tool uses: 2 | 1.2k token | Cost: ~$0.01 | Context: 10% | Duration: 2.0s\nDescription: ${description}\n\n${body}`;

test("agent header snapshots, verbose body and exact wait/not-found envelopes are conservative", () => {
  const args = { agent_id: "a1", wait: true, verbose: true };
  const ctx = context(args);
  assert.equal(agentContract(args, undefined, ctx)?.stats, "waiting");
  for (const status of ["completed", "running", "queued", "error"]) {
    const result = raw(agentHeader(status, "Status: stopped\nTool uses: 90000\nDescription: SPOOF\n\n--- Agent Conversation ---\nall body"));
    const metadata = agentContract(args, result, ctx)!;
    assert.equal(metadata.title, "Review source"); assert.equal(metadata.stats, status);
    assert.doesNotMatch(metadata.secondary!, /90000|SPOOF/);
    assert.match(metadata.secondary!, /1.2k token/);
  }
  for (const [status, note] of [
    ["stopped", " (STOPPED BY THE USER before completion — output is partial; the task was NOT finished)"],
    ["aborted", " (aborted — hit the turn limit before completion; output may be incomplete)"],
    ["steered", " (wrapped up at the turn limit — output may be partial)"],
  ]) {
    assert.equal(agentContract(args, raw(agentHeader(status).replace(`Status: ${status}`, `Status: ${status}${note}`)), ctx)?.stats, status);
    assert.equal(agentContract(args, raw(agentHeader(status)), ctx), undefined);
  }
  for (const status of ["released", "cancelled"]) assert.equal(agentContract(args, raw(`Result wait ${status}. Agent a1 continues unchanged; completion notification remains eligible.`), ctx)?.stats, `wait ${status} · agent unchanged`);
  assert.equal(agentContract(args, raw('Agent not found: "a1". It may have been cleaned up.'), ctx)?.stats, "not found");
  for (const result of [raw("body\n" + agentHeader()), raw(agentHeader().replace("Tool uses: 2", "Tools: many")), raw(agentHeader().replace("Duration: 2.0s", "Duration: unknown")), { ...raw(agentHeader()), details: {} }, { content: [], details: undefined }, raw('Agent not found: "other". It may have been cleaned up.')]) assert.equal(agentContract(args, result, ctx), undefined);
  assert.doesNotMatch(agentContract(args, raw(agentHeader().replace("Cost: ~$0.01", "Future: 42")), ctx)?.secondary ?? "", /Future/);
  for (const args of [null, [], {}, { agent_id: 1 }, { agent_id: "a1", wait: "yes" }, { agent_id: "a1", extra: true }]) assert.equal(agentContract(args as never, undefined, ctx), undefined);
});

test("jobs six action guards ignore body spoofing, byte range is not character count, partial is only following", () => {
  const cases = [
    [{ action: "list" }, "No background jobs", "0 jobs"],
    [{ action: "list" }, "Background Jobs:\nx [shell]: echo (stuff) - ✓ completed\nname (x2) [monitor]: watch - ◉ monitor (1m2s)", "2 jobs"],
    [{ action: "output", jobId: "x" }, "Output for title (with parens) (running) — bytes 10-20 of 30\n[10 earlier bytes not shown — read them with offset=0]\n中\nStatus: killed\n[10 more bytes — continue with offset=20]", "bytes 10-20 of 30 · omitted"],
    [{ action: "output", jobId: "x" }, "No output yet for name (running). Log: /tmp/own", "no output"],
    [{ action: "output", jobId: "x", offset: 7 }, "No output at offset 7 for name (completed). Log: /tmp/own", "no output"],
    [{ action: "search", pattern: "a/b", ignoreCase: true }, "Found 23 matches for /a/b/i across 2 job(s):\n\nx (23 matches)\nbody\nFound 90000 matches", "23 matches · 2 jobs"],
    [{ action: "search", pattern: "x" }, "No matches for /x/ in any job log.", "0 matches"],
    [{ action: "stats" }, "Background Jobs Stats:\nTotal started:     5\nCurrently running: 2\nCompleted:         1\nFailed:            1\nKilled:            1\nAverage duration:  1m2s\nTotal elapsed:     5s", "2 running · 3 terminal"],
    [{ action: "kill", jobId: "x" }, "Successfully stopped task: x (echo (x))", "stop reported"],
    [{ action: "attach", jobId: "x" }, "Stopped following name (x) — it's still running in the background. Use jobs output to check on it.", "following released"],
    [{ action: "attach", jobId: "x" }, "Stopped following x — status: killed. Use jobs output for the full log.", "following released"],
    [{ action: "attach", jobId: "x" }, "x finished. Status: completed. Use jobs output for the full log.", "completed"],
    [{ action: "attach", jobId: "x", wait: false }, "x is running. Use jobs output for a non-blocking peek.", "running"],
  ] as const;
  for (const [args, text, expected] of cases) assert.equal(jobsContract(args, raw(text), context(args))?.stats, expected, text);
  const args = { action: "attach", jobId: "x" };
  assert.equal(jobsContract(args, raw("x finished. Status: killed. Use jobs output for the full log."), context(args, { isPartial: true }))?.stats, "following · waiting");
  for (const [args, text] of [
    [{ action: "output", jobId: "x" }, "body\nOutput for x (killed) — bytes 0-10 of 10"],
    [{ action: "output", jobId: "x" }, "Output for x (running) — bytes 20-10 of 30\nbody"],
    [{ action: "output", jobId: "x" }, "Output for x (running) — bytes 0-20 of 10\nbody"],
    [{ action: "search", pattern: "x" }, "Found 10 matches for /other/ across 1 job(s):\n\nbody"],
    [{ action: "stats" }, "Background Jobs Stats:\nCurrently running: 999"],
    [{ action: "list" }, "Background Jobs:\nspoof arbitrary lines\nStatus: completed"],
    [{ action: "kill", jobId: "x" }, "Successfully stopped task: other (command)"],
  ] as const) assert.equal(jobsContract(args, raw(text), context(args)), undefined);
  for (const args of [null, [], {}, { action: "other" }, { action: "kill" }, { action: "search" }, { action: "list", wait: 1 }, { action: "output", jobId: 42 }, { action: "output", jobId: "x", offset: Infinity }]) assert.equal(jobsContract(args as never, undefined, context({})), undefined);
  assert.equal(jobsContract(args, { ...raw("log"), details: {} }, context(args, { isPartial: true })), undefined);
});

test("actual host optional call/result sync, mouse/key expansion, pending/partial/final and historical state", () => {
  setKeybindings(new KeybindingsManager({ "app.tools.expand": ["alt+o"] }));
  for (const [name, contract, args, text] of [
    ["get_subagent_result", agentContract, { agent_id: "a1", wait: true }, agentHeader("running", "body\nline15")],
    ["jobs", jobsContract, { action: "output", jobId: "x" }, "Output for x (completed) — bytes 0-5 of 5\nfinal"],
  ] as const) {
    const component = new ToolExecutionComponent(name, name, args, { outputPad: 2 }, optionalRenderers(name, undefined, contract), screen, "/fixture");
    assert.equal(rows(component).length, 1);
    component.updateResult({ ...raw(text), isError: false });
    for (const width of [8, 20, 40, 80, 120]) { assert.equal(rows(component, width).length, 1); assert.ok(component.render(width).every((row: string) => visibleWidth(row) <= width)); }
    assert.match(rows(component).join("\n"), /(?:alt|option)\+o/);
    const actual = component.render(120), y = actual.findIndex((row: string) => plain(row).trim());
    assert.equal(component.handleMouse({ type: "click", button: "left", x: 3, y, width: 120, height: actual.length })?.handled, true);
    assert.ok(rows(component).length > 1); assert.match(rows(component).join("\n"), /body|final/);
    component.setExpanded(false); assert.equal(rows(component).length, 1);
  }
  const args = { action: "attach", jobId: "x" };
  const component = new ToolExecutionComponent("jobs", "attach", args, {}, optionalRenderers("jobs", undefined, jobsContract), screen, "/fixture");
  component.updateResult({ ...raw("Status: killed\nold chunk"), isError: false }, true);
  assert.match(rows(component).join("\n"), /following.*waiting/);
  component.setExpanded(true); assert.match(rows(component).join("\n"), /old chunk/);
  const final = "Stopped following x — it's still running in the foreground. Use jobs output to check on it.";
  component.updateResult({ ...raw(final), isError: false });
  assert.doesNotMatch(rows(component).join("\n"), /old chunk/);
  component.setExpanded(false); assert.match(rows(component).join("\n"), /following released/); assert.doesNotMatch(rows(component).join("\n"), /killed/);
});

test("optional identities stay complete before long details in pending, terminal and expanded titles", () => {
  for (const [name, contract, args, output] of [
    ["get_subagent_result", agentContract, { agent_id: "a1", wait: true }, agentHeader("completed", "answer", "非常长描述/".repeat(60))],
    ["jobs", jobsContract, { action: "search", pattern: "very-long-pattern/".repeat(60) }, undefined],
    ["jobs", jobsContract, { action: "list" }, "No background jobs"],
    ["jobs", jobsContract, { action: "output", jobId: "a1" }, "No task found with ID: a1"],
  ] as const) {
    const c = new ToolExecutionComponent(name, "identity", args, { outputPad: 2 }, optionalRenderers(name, undefined, contract), screen, "/fixture");
    for (const stage of ["pending", "result"]) {
      if (stage === "result" && output !== undefined) c.updateResult({ ...raw(output), isError: output.startsWith("No task") });
      for (const expanded of [false, true]) {
        c.setExpanded(expanded);
        for (const width of [8, 20, name.length + 4, 40, 80, 120]) {
          const rendered = c.render(width);
          assert.ok(rendered.every((line: string) => visibleWidth(line) <= width));
          const heading = rows(c, width)[0]!.trim();
          if (width >= name.length + 4) assert.ok(heading.startsWith(name), `${name}/${stage}/${expanded}/${width}: ${heading}`);
          assert.doesNotMatch(heading, /^jobs\s+jobs\b/);
        }
      }
    }
  }
  const c = new ToolExecutionComponent("get_subagent_result", "detail", { agent_id: "a1" }, {}, optionalRenderers("get_subagent_result", undefined, agentContract), screen, "/fixture");
  c.updateResult({ ...raw(agentHeader()), isError: false });
  assert.match(rows(c).join("\n"), /get_subagent_result  Review source/);
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
  const component = new ToolExecutionComponent("jobs", "delegate", { action: "list" }, {}, optionalRenderers("jobs", original, jobsContract), screen, "/fixture");
  component.updateResult({ ...raw("unknown new format"), isError: false });
  assert.deepEqual(rows(component), ["ORIGINAL CALL", "ORIGINAL RESULT"]);
  assert.doesNotMatch(component.render(120).join("\n"), /\x1b\[48/);
  component.updateResult({ ...raw("No background jobs"), isError: false }); assert.equal(rows(component).length, 1);
  component.updateResult({ ...raw("future format"), isError: false }); assert.deepEqual(rows(component), ["ORIGINAL CALL", "ORIGINAL RESULT"]);
  component.invalidate(); assert.deepEqual(rows(component), ["ORIGINAL CALL", "ORIGINAL RESULT"]);
  const fallback = new ToolExecutionComponent("jobs", "generic", {}, {}, optionalRenderers("jobs", undefined, jobsContract), screen, "/fixture");
  const text = Array.from({ length: 15 }, (_, i) => `line${i}`).join("\n");
  fallback.updateResult({ ...raw(text), isError: false });
  assert.match(rows(fallback).join("\n"), /5 more lines/); assert.doesNotMatch(rows(fallback).join("\n"), /line14/);
  fallback.setExpanded(true); assert.match(rows(fallback).join("\n"), /line14/);
});

test("unknown default renderer shell preserves host-style Box, full original context and details", () => {
  const args = { foreign: true }, details = { alien: 1 };
  let callArgs: unknown, resultSeen: unknown;
  const original: ToolRenderers = { renderShell: "default", renderCall(input, _theme, ctx) { callArgs = input; assert.equal(ctx.outputPad, 2); assert.equal(ctx.cwd, "/fixture"); return new Text("original", 0, 0); }, renderResult(result, options) { resultSeen = result; return new Text(options.expanded ? "expanded alien" : "alien", 0, 0); } };
  const c = new ToolExecutionComponent("jobs", "foreign", args, { outputPad: 2 }, optionalRenderers("jobs", original, jobsContract), screen, "/fixture");
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
    for (const name of ["write", "Agent", "bash_bg", "monitor", "ls", "ask_user_question"]) { const original = { renderShell: "self" }; assert.equal(runner.resolveToolRenderers(name, () => original), original); }
    for (const original of [undefined, { renderShell: "self", renderCall: () => new Text("DYNAMIC", 0, 0), renderResult: () => new Text("RESULT", 0, 0) }]) {
      const renderer = runner.resolveToolRenderers("jobs", () => original);
      const component = new ToolExecutionComponent("jobs", "history", { foreign: true }, {}, renderer, screen, dir);
      component.updateResult({ ...raw("old history format"), isError: false });
      assert.match(rows(component).join("\n"), original ? /DYNAMIC/ : /old history/);
    }
  } finally { for (const handler of loaded.extensions[0].handlers.get("session_shutdown") ?? []) await handler({}, {}); rmSync(dir, { recursive: true, force: true }); }
});

test("actual registered jobs produces list/stats/output/search/attach/kill envelopes without display-side reads or consumption", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-jobs-contract-")), f = processActivation(dir);
  const captured = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  registerJobsTool({ registerTool(tool) { captured.set(tool.name, tool as unknown as Parameters<ExtensionAPI["registerTool"]>[0]); } } as ExtensionAPI, f.reg);
  const execute = (args: Record<string, unknown>) => captured.get("jobs")!.execute("jobs-test", args, undefined, undefined, f.context);
  const validate = async (args: Record<string, unknown>) => {
    const result = await execute(args), copy = structuredClone(result);
    assert.ok(jobsContract(args, result, context(args)), JSON.stringify(result));
    const c = new ToolExecutionComponent("jobs", "real", args, {}, optionalRenderers("jobs", undefined, jobsContract), screen, dir);
    c.updateResult({ ...result, isError: false }); c.render(120); c.setExpanded(true); c.render(120);
    assert.deepEqual(result, copy);
  };
  try {
    await validate({ action: "list" }); await validate({ action: "stats" });
    const path = join(dir, "log"); writeFileSync(path, "needle 中文\nsecond needle\n");
    const job = createRunningJob({ id: "testjob", command: "echo (x)", pid: 0, logPath: path, toolCallId: "fake-log" }); add(f.reg, job);
    await validate({ action: "list" }); await validate({ action: "output", jobId: job.id, offset: 1, limit: 8 });
    await validate({ action: "search", pattern: "needle", jobId: job.id }); await validate({ action: "attach", jobId: job.id, wait: false });
    const launched = await f.execute("bash", { command: "while true; do sleep 1; done", run_in_background: true });
    const id = launched.content[0]!.text!.match(/ID: ([^.]+)\./)![1]!;
    let partial: Result | undefined;
    const controller = new AbortController();
    const following = captured.get("jobs")!.execute("follow", { action: "attach", jobId: id }, controller.signal, result => { partial = result; }, f.context);
    await until(() => !!partial);
    assert.equal(jobsContract({ action: "attach", jobId: id }, partial, context({ action: "attach", jobId: id }, { isPartial: true }))?.stats, "following · waiting");
    f.coordinator.detachAll();
    const final = await following;
    assert.equal(jobsContract({ action: "attach", jobId: id }, final, context({ action: "attach", jobId: id }))?.stats, "following released");
    assert.equal(f.reg.jobs.get(id)?.status, "running");
    await validate({ action: "kill", jobId: id });
    await validate({ action: "attach", jobId: id });
  } finally { await f.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
test.after(() => screen.stop());

test("empty/multiline descriptions keep header status and unsafe terminal sums delegate", () => {
  const args = { agent_id: "a1" }, ctx = context(args);
  assert.equal(agentContract(args, raw(agentHeader("running", "answer", "")), ctx)?.title, "Agent a1");
  assert.equal(agentContract(args, raw(agentHeader("queued", "Description: spoof", "First\nSecond")), ctx)?.title, "First\nSecond");
  const stats = "Background Jobs Stats:\nTotal started:     9007199254740991\nCurrently running: 0\nCompleted:         9007199254740991\nFailed:            1\nKilled:            1\nAverage duration:  0s\nTotal elapsed:     0s";
  assert.equal(jobsContract({ action: "stats" }, raw(stats), context({ action: "stats" })), undefined);
});

test("self compatibility shell has exactly the default host padding hit bounds and backgrounds", () => {
  const args = { action: "list" };
  for (const original of [undefined, { renderShell: "self" as const }]) {
    const c = new ToolExecutionComponent("jobs", "hits", args, { outputPad: 2 }, optionalRenderers("jobs", original, jobsContract), screen, "/fixture");
    for (const [result, partial, color] of [[undefined, true, "toolPendingBg"], [raw("No background jobs"), false, "toolSuccessBg"], [raw("No task found with ID: x"), false, "toolErrorBg"]] as const) {
      c.setExpanded(false);
      if (color === "toolErrorBg") c.updateArgs({ action: "output", jobId: "x" });
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
    const c = new ToolExecutionComponent("jobs", "fallback", args, {}, optionalRenderers("jobs", original, jobsContract), screen, "/fixture");
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
    const c = new ToolExecutionComponent("jobs", "invalid", args, {}, optionalRenderers("jobs", undefined, jobsContract), screen, "/fixture");
    c.updateResult({ ...raw("readable unknown"), isError: false }); c.setExpanded(true);
    assert.match(rows(c).join("\n"), /readable unknown/);
  }
});

test("partial→final contracts never delegate using the previous result with new context", () => {
  let calls = 0, results = 0;
  const original: ToolRenderers = { renderShell: "self", renderCall() { calls++; return new Text("foreign call", 0, 0); }, renderResult() { results++; return new Text("foreign result", 0, 0); } };
  const args = { action: "attach", jobId: "x" };
  const c = new ToolExecutionComponent("jobs", "round", args, {}, optionalRenderers("jobs", original, jobsContract), screen, "/fixture");
  c.updateResult({ ...raw("raw partial with no envelope"), isError: false }, true);
  c.updateResult({ ...raw("x finished. Status: completed. Use jobs output for the full log."), isError: false });
  assert.equal(calls, 0); assert.equal(results, 0);
  assert.equal(rows(c).length, 1); assert.match(rows(c).join("\n"), /completed/);
  c.setExpanded(true); assert.match(rows(c).join("\n"), /full log/);
  c.setExpanded(false); assert.equal(calls, 0); assert.equal(results, 0);
});

test("actual SDK thrown jobs errors carry details object and safely delegate without changing output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "beautify-error-contract-")), f = processActivation(dir);
  let definition: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
  registerJobsTool({ registerTool(tool) { definition = tool as unknown as Parameters<ExtensionAPI["registerTool"]>[0]; } } as ExtensionAPI, f.reg);
  const args = { action: "output", jobId: "missing" };
  const assistantMessage: AssistantMessage = { role: "assistant", content: [], api: "anthropic-messages", provider: "anthropic", model: "offline", stopReason: "toolUse", timestamp: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  try {
    const tool: AgentTool = { name: "jobs", label: "jobs", description: "offline", parameters: definition!.parameters,
      execute: (id, args, signal, update) => definition!.execute(id, args, signal, update, f.context) };
    const outcome = await runToolCall({ type: "toolCall", id: "error", name: "jobs", arguments: args }, { tools: [tool], assistantMessage, context: { messages: [] } });
    assert.equal(outcome.isError, true); assert.deepEqual(outcome.result.details, {});
    assert.equal(jobsContract(args, outcome.result, context(args, { isError: true })), undefined);
    const c = new ToolExecutionComponent("jobs", "error", args, {}, optionalRenderers("jobs", undefined, jobsContract), screen, dir);
    c.updateResult({ ...outcome.result, isError: true });
    assert.match(rows(c).join("\n"), /No task found with ID: missing/);
    assert.ok(c.render(80).some((line: string) => line.includes(themeSdk.theme.getBgAnsi("toolErrorBg"))));
    c.setExpanded(true); assert.match(rows(c).join("\n"), /No task found with ID: missing/);
  } finally { await f.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
