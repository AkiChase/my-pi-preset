import { test } from "node:test";
import assert from "node:assert/strict";
import "../../agent-tasks/__tests__/source-loader.mjs";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import type { TaskSource } from "../../task-ui/types.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
const { createWorkflowTask, completeWorkflowTask, failWorkflowTask, resolveResumeTarget } = await import("../../agent-tasks/src/workflow/task.ts");
const { createWorkflowManagement } = await import("../../agent-tasks/src/workflow/management.ts");
const { AgentManager } = await import("../../agent-tasks/src/agent-manager.ts");
const { createAgentTaskSource } = await import("../../agent-tasks/src/source.ts");
const ctx = {} as ExtensionContext;

test("workflow terminal captures full script return and rejects paused replay", async () => {
  const task = createWorkflowTask({ id: "wf-test", script: "", meta: { name: "test", description: "test" } });
  task.status = "paused";
  assert.equal(resolveResumeTarget(task.id, new Map([[task.id, task]]))?.ok, false);
  const answer = "full-answer".repeat(6000);
  completeWorkflowTask(task, { status: "completed", value: answer, meta: { name: "test", description: "test" }, agentCount: 0, replayedCount: 0, progress: [] });
  assert.equal((await task.terminal).text, answer);
  failWorkflowTask(task, "late error");
  assert.equal(task.status, "completed");
});

test("workflow multiple retrieval leases consume before suppression drops; release leaves execution", async () => {
  const coordinator = new TaskCoordinator();
  const manager = new AgentManager();
  const task = createWorkflowTask({ id: "wf-waits", script: "", meta: { name: "test", description: "test" } });
  const tasks = new Map([[task.id, task]]);
  const source: TaskSource = createAgentTaskSource(manager, coordinator, tasks);
  let notices = 0;
  const capability = createWorkflowManagement({ tasks, source, coordinator, manager, active: () => true, cancelNotice() {}, reconsider: () => { if (!task.resultConsumed) notices++; } });
  const identity = { sourceId: "agent", taskId: task.id, runId: task.id };
  try {
    const first = capability.execute(identity, { action: "wait", task_id: task.id }, undefined, undefined, ctx);
    assert.equal(coordinator.detachAll(), 1);
    assert.equal((await first).details.runtimeTask.wait_outcome, "released");
    assert.equal(task.resultConsumed, false); assert.equal(task.abortController.signal.aborted, false);
    const second = capability.execute(identity, { action: "wait", task_id: task.id }, undefined, undefined, ctx);
    const third = capability.execute(identity, { action: "wait", task_id: task.id }, undefined, undefined, ctx);
    completeWorkflowTask(task, { status: "completed", value: "final", meta: { name: "test", description: "test" }, agentCount: 0, replayedCount: 0, progress: [] });
    const results = await Promise.all([second, third]);
    assert.ok(results.every(result => result.details.runtimeTask.wait_outcome === "completed"));
    assert.equal(task.resultConsumed, true); assert.equal(coordinator.countWaits(identity), 0);
    assert.equal(notices, 1, "only released pre-terminal wait reconsiders an unconsumed result");
  } finally { source.dispose(); coordinator.dispose(); await manager.dispose(); }
});

test("startup cancellation and unserializable return both settle terminal", async () => {
  const cancelled = createWorkflowTask({ id: "wf-cancelled", script: "" });
  cancelled.abortController.abort(); failWorkflowTask(cancelled, "cancelled before startup");
  assert.equal((await cancelled.terminal).status, "killed");
  const broken = createWorkflowTask({ id: "wf-broken", script: "" });
  completeWorkflowTask(broken, { status: "completed", value: 1n, meta: { name: "test", description: "test" }, agentCount: 0, replayedCount: 0, progress: [] });
  assert.equal((await broken.terminal).status, "failed");
  assert.match((await broken.terminal).text, /serialize workflow return/);
});

test("workflow output uses frozen terminal text and progress, not late mutation", async () => {
  const coordinator = new TaskCoordinator(), manager = new AgentManager();
  const task = createWorkflowTask({ id: "wf-frozen", script: "" });
  const tasks = new Map([[task.id, task]]), source = createAgentTaskSource(manager, coordinator, tasks);
  const capability = createWorkflowManagement({ tasks, source, coordinator, manager, active: () => true, cancelNotice() {}, reconsider() {} });
  try {
    task.logs = ["original progress"];
    completeWorkflowTask(task, { status: "completed", value: { answer: "original" }, meta: { name: "test", description: "test" }, agentCount: 0, replayedCount: 0, progress: [] });
    task.value = "late replacement"; task.logs.push("late log");
    const result = await capability.execute({ sourceId: "agent", taskId: task.id, runId: task.id }, { action: "output" }, undefined, undefined, ctx);
    const text = result.content.map(block => block.type === "text" ? block.text : "").join("");
    assert.match(text, /original/); assert.doesNotMatch(text, /late replacement|late log/);
  } finally { source.dispose(); coordinator.dispose(); await manager.dispose(); }
});

test("stop settles an actually paused runtime and preserves wait consumption ordering", async () => {
  const { runWorkflow } = await import("../../agent-tasks/src/workflow/runtime.ts");
  const coordinator = new TaskCoordinator(), manager = new AgentManager();
  const task = createWorkflowTask({ id: "wf-paused-stop", script: 'export const meta = {name:"test",description:"test"}; export default async function(agent) { return await agent("blocked"); }' });
  const tasks = new Map([[task.id, task]]), source = createAgentTaskSource(manager, coordinator, tasks);
  const capability = createWorkflowManagement({ tasks, source, coordinator, manager, active: () => true, cancelNotice() {}, reconsider() {} });
  let controlsReady!: () => void;
  const ready = new Promise<void>(resolve => { controlsReady = resolve; });
  const host = {
    spawnAgent: async () => { throw new Error("paused agent must not start"); }, resumeAgent: async () => { throw new Error("unexpected resume"); },
    abortAgent() {},
  };
  try {
    const runtime = runWorkflow({ script: task.script, signal: task.abortController.signal, host,
      onControl: control => { task.control = control; control.pause(); task.status = "paused"; controlsReady(); },
    }).then(result => completeWorkflowTask(task, result), error => failWorkflowTask(task, String(error)));
    await ready;
    const identity = { sourceId: "agent", taskId: task.id, runId: task.id };
    const waiting = capability.execute(identity, { action: "wait" }, undefined, undefined, ctx);
    const stop = await capability.execute(identity, { action: "stop" }, undefined, undefined, ctx);
    assert.match(stop.content.map(block => block.type === "text" ? block.text : "").join(""), /Stop requested/);
    await runtime;
    assert.equal((await waiting).details.runtimeTask.status, "stopped");
    assert.equal(task.resultConsumed, true); assert.equal(task.notificationDelivered, true);
    assert.equal(coordinator.countWaits(identity), 0);
  } finally { task.abortController.abort(); source.dispose(); coordinator.dispose(); await manager.dispose(); }
});
