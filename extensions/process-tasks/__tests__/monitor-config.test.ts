import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { monitorInput } from "./monitor-input.ts";
import { processInput } from "../../runtime-tasks/__tests__/process-input.ts";
import { processActivation, until } from "./process-harness.ts";
import { registerManagementTool, isManagementDetails, type ManagementDetails } from "../../runtime-tasks/tools.ts";
import { createProcessManagement } from "../management.ts";
import type { MonitorExecutionConfig } from "../../runtime-tasks/execution-config.ts";
const meta = (result: unknown) => (result as { details: ManagementDetails }).details.runtimeManagement;
const snapshot = (result: unknown) => (result as { details: { executionConfig: MonitorExecutionConfig } }).details.executionConfig;

for (const times of [{ timeout_ms: null, wake_absent_ms: null }, { timeout_ms: 10000.5, wake_absent_ms: 5000.5 }]) {
  test(`registered command snapshot persists across status/output/partial/final/error/release: ${JSON.stringify(times)}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-config-")), h = processActivation(dir, { monitorFlushMs: 3456 });
    let management!: Parameters<ExtensionAPI["registerTool"]>[0];
    registerManagementTool({ registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { management = tool; } } as ExtensionAPI, "process", [createProcessManagement(h.reg, h.source)]);
    const execute = (action: string, id: string, update?: Parameters<typeof management.execute>[3], signal?: AbortSignal) => management.execute("manage", processInput({ action, task_id: id }) as never, signal, update, h.context);
    try {
      const launch = await h.execute("monitor", monitorInput({ command: "printf '中文🧠\\n'; tail -f /dev/null", description: "snapshot", ...times }));
      const config = snapshot(launch), historical = structuredClone(launch);
      assert.deepEqual(config, { kind: "monitor", mode: "background", ...times, batch_interval_ms: 3456 });
      assert.ok(Object.isFrozen(config));
      const job = [...h.reg.jobs.values()][0]!;
      assert.deepEqual(job.executionConfig, config); assert.notEqual(job.executionConfig, config);
      const view = h.source.list()[0]!; assert.deepEqual(view.executionConfig, config); assert.notEqual(view.executionConfig, job.executionConfig);
      // Display stays historical even if an embedding mutates activation config.
      h.reg.config.monitorFlushMs = 0;
      for (const action of ["status", "output"]) {
        const result = await execute(action, job.id);
        assert.ok(isManagementDetails(result.details)); assert.deepEqual(meta(result).executionConfig, config);
        assert.match(result.content.map(b => b.type === "text" ? b.text : "").join("\n"), /startup batch configuration=3456ms/);
        assert.notEqual(job.outcomeSurfaced, true);
      }
      const partials: unknown[] = [];
      const waiting = execute("wait", job.id, result => partials.push(result));
      await until(() => partials.length > 0);
      assert.deepEqual(meta(partials[0]).executionConfig, config); assert.equal(meta(partials[0]).wait_outcome, "waiting");
      h.coordinator.detachAll(); const released = await waiting;
      assert.deepEqual(meta(released).executionConfig, config); assert.equal(meta(released).wait_outcome, "released");
      assert.equal(job.status, "running");
      const ac = new AbortController(), cancelled = execute("wait", job.id, undefined, ac.signal);
      ac.abort(); assert.equal(meta(await cancelled).wait_outcome, "cancelled");
      await execute("stop", job.id); await until(() => h.reg.executions.size === 0);
      const terminal = await execute("wait", job.id);
      assert.deepEqual(meta(terminal).executionConfig, config); assert.equal(meta(terminal).wait_outcome, "completed");
      assert.ok(meta(terminal).range); assert.equal(job.outcomeSurfaced, true);
      unlinkSync(job.logPath);
      const error = await execute("output", job.id);
      assert.equal(meta(error).error_code, "log_error"); assert.deepEqual(meta(error).executionConfig, config);
      assert.deepEqual(launch, historical); assert.equal(h.reg.jobAborts.size, 0); assert.equal(h.coordinator.waitCount, 0);
      const sourceConfig = h.source.list()[0]!.executionConfig;
      const closing = execute("wait", job.id); await closing;
      assert.deepEqual(sourceConfig, config);
    } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
  });
}

test("registered WS snapshot contains no URL/protocols and survives activation closure in an admitted wait", async t => {
  class Socket {
    static instance: Socket;
    closes = 0;
    constructor() { Socket.instance = this; }
    addEventListener() {}
    close() { this.closes++; }
  }
  const original = globalThis.WebSocket; globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  t.after(() => { globalThis.WebSocket = original; });
  const dir = mkdtempSync(join(tmpdir(), "monitor-ws-config-")), h = processActivation(dir, { monitorFlushMs: 0 });
  let management!: Parameters<ExtensionAPI["registerTool"]>[0];
  registerManagementTool({ registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { management = tool; } } as ExtensionAPI, "process", [createProcessManagement(h.reg, h.source)]);
  try {
    const launch = await h.execute("monitor", monitorInput({ ws: { url: "ws://offline.invalid/?token=secret", protocols: ["private"] }, description: "WS snapshot" }));
    const config = snapshot(launch), job = [...h.reg.jobs.values()][0]!;
    assert.doesNotMatch(JSON.stringify(config), /token|secret|protocol|url|command|private/);
    const waiting = management.execute("wait", processInput({ action: "wait", task_id: job.id }) as never, undefined, undefined, h.context);
    await h.lifecycle.shutdown(); const closed = await waiting;
    assert.equal(meta(closed).error_code, "closed"); assert.equal(meta(closed).task_type, "monitor");
    assert.deepEqual(meta(closed).executionConfig, config); assert.equal(Socket.instance.closes, 1);
    assert.equal(h.reg.executions.size, 0); assert.equal(h.reg.jobAborts.size, 0);
  } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

for (const command of ["printf 'natural output\\n'", "printf 'failure output\\n'; exit 7"]) {
  test(`registered natural terminal preserves monitor launch and final wait snapshot: ${command}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-natural-config-")), h = processActivation(dir, { monitorFlushMs: 0 });
    let management!: Parameters<ExtensionAPI["registerTool"]>[0];
    registerManagementTool({ registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { management = tool; } } as ExtensionAPI, "process", [createProcessManagement(h.reg, h.source)]);
    try {
      const launch = await h.execute("monitor", monitorInput({ command, description: "natural terminal" }));
      const config = snapshot(launch), job = [...h.reg.jobs.values()][0]!;
      const final = await management.execute("wait", processInput({ action: "wait", task_id: job.id }) as never, undefined, undefined, h.context);
      assert.equal(meta(final).status, command.includes("exit 7") ? "failed" : "completed");
      assert.equal(meta(final).wait_outcome, "completed"); assert.deepEqual(meta(final).executionConfig, config);
      assert.match(final.content.map(b => b.type === "text" ? b.text : "").join("\n"), /startup batch configuration=0ms/);
      await until(() => h.reg.executions.size === 0);
      assert.equal(h.reg.jobAborts.size, 0); assert.equal(job.outcomeSurfaced, true);
      assert.ok(meta(final).range); assert.deepEqual(snapshot(launch), config);
    } finally { await h.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
  });
}
