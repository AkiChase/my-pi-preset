import { test } from "node:test";
import assert from "node:assert/strict";
import { executionId, parseExecutionId } from "../execution-id.ts";
import { isLaunchMetadata, launchMetadata, launchText } from "../launch.ts";
import { managementTool } from "../tools.ts";
import { taskResult } from "../contracts.ts";
import type { TaskView } from "../../task-ui/types.ts";

test("execution handles are canonical identities, not authority or current-run aliases", () => {
  const id = executionId({ taskId: "agent-A", runId: "1" }, "subagent");
  assert.deepEqual(parseExecutionId(id), { sourceId: "agent", taskId: "agent-A", runId: "1" });
  for (const malformed of [id + "=", "exec_%%%", "agent-A", "", "exec_" + Buffer.from('["a","1","extra"]').toString("base64url")]) assert.equal(parseExecutionId(malformed), undefined);
  assert.deepEqual(parseExecutionId("wf_abcdef"), { sourceId: "agent", taskId: "wf_abcdef", runId: "wf_abcdef" });
});

test("subagent launch metadata exposes only its persistent agent ID", () => {
  const agentId = "agent_general_purpose_0_12345678";
  const launch = launchMetadata("subagent", agentId, "1", "background");
  assert.deepEqual(launch, { version: 2, kind: "subagent", agent_id: agentId, mode: "background" });
  assert.equal(launchText(launch), `kind=subagent agent_id=${agentId}`);
  assert.ok(isLaunchMetadata(launch));
  assert.equal(isLaunchMetadata({ ...launch, execution_id: executionId({ taskId: agentId, runId: "1" }, "subagent") }), false);
});

test("subagent agent IDs bind admitted waits to their internal execution while rejecting execution handles", async () => {
  let run = "1", calls = 0, finish!: () => void;
  const pending = new Promise<void>(r => { finish = r; });
  const view = (): TaskView => ({ sourceId: "agent", taskId: "agent_general_purpose_0_12345678", runId: run, key: run, kind: "agent", title: "agent", status: "running", executionMode: "background", waitCount: 0, stats: {}, artifacts: [], capabilities: { stop: true, details: true } });
  const { tool } = managementTool("agent", [{ list: () => [{ view: view(), manageable: true, rawStatus: "running" }], execute: async identity => {
    calls++; await pending; return taskResult("original result", { action: "wait", task_type: "subagent", task_id: identity.taskId, run_id: identity.runId });
  } }]);
  const agentId = "agent_general_purpose_0_12345678";
  const old = executionId({ taskId: agentId, runId: "1" }, "subagent");
  const rejected = await tool.execute("old", { action: "wait", agent_id: null, execution_id: old, kind: null, verbose: null }, undefined, undefined, {} as never);
  assert.equal(rejected.isError, true); assert.equal(calls, 0);
  assert.match(rejected.content[0]?.type === "text" ? rejected.content[0].text : "", /wf_ execution_id.*Subagents require agent_id/);
  const waiting = tool.execute("wait", { action: "wait", agent_id: agentId, execution_id: null, kind: null, verbose: null }, undefined, undefined, {} as never);
  run = "2";
  finish(); const result = await waiting;
  assert.equal(calls, 1);
  const management = result.details.runtimeManagement;
  assert.ok("agent_id" in management);
  assert.equal(management.agent_id, agentId);
  assert.ok(!("execution_id" in management));
  assert.match(JSON.stringify(result.content), /original result/);
});
