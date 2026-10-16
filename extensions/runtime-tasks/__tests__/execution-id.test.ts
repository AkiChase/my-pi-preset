import { test } from "node:test";
import assert from "node:assert/strict";
import { executionId, parseExecutionId } from "../execution-id.ts";
import { managementTool } from "../tools.ts";
import { taskResult } from "../contracts.ts";
import type { TaskView } from "../../task-ui/types.ts";

test("execution handles are canonical identities, not authority or current-run aliases", () => {
  const id = executionId({ taskId: "agent-A", runId: "1" }, "subagent");
  assert.deepEqual(parseExecutionId(id), { sourceId: "agent", taskId: "agent-A", runId: "1" });
  for (const malformed of [id + "=", "exec_%%%", "agent-A", "", "exec_" + Buffer.from('["a","1","extra"]').toString("base64url")]) assert.equal(parseExecutionId(malformed), undefined);
  assert.deepEqual(parseExecutionId("wf_abcdef"), { sourceId: "agent", taskId: "wf_abcdef", runId: "wf_abcdef" });
});
test("old handles fail before backend calls and admitted waits retain exact identity", async () => {
  let run = "1", calls = 0, finish!: () => void;
  const pending = new Promise<void>(r => { finish = r; });
  const view = (): TaskView => ({ sourceId: "agent", taskId: "a", runId: run, key: run, kind: "agent", title: "agent", status: "running", executionMode: "background", waitCount: 0, stats: {}, artifacts: [], capabilities: { stop: true, details: true } });
  const { tool } = managementTool("agent", [{ list: () => [{ view: view(), manageable: true, rawStatus: "running" }], execute: async identity => {
    calls++; await pending; return taskResult("original result", { action: "wait", task_type: "subagent", task_id: identity.taskId, run_id: identity.runId });
  } }]);
  const old = executionId({ taskId: "a", runId: "1" }, "subagent");
  const waiting = tool.execute("wait", { action: "wait", execution_id: old }, undefined, undefined, {} as never);
  run = "2";
  const stale = await tool.execute("stop", { action: "stop", execution_id: old }, undefined, undefined, {} as never);
  assert.equal(stale.isError, true); assert.equal(calls, 1);
  finish(); const result = await waiting;
  assert.ok("execution_id" in result.details.runtimeManagement);
  assert.equal(result.details.runtimeManagement.execution_id, old);
  assert.match(JSON.stringify(result.content), /original result/);
});
