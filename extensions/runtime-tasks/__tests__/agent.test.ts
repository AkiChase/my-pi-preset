import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import "../../agent-tasks/__tests__/source-loader.mjs";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RunResult, RunOptions } from "../../agent-tasks/src/agent-runner.ts";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
const { AgentManager } = await import("../../agent-tasks/src/agent-manager.ts");
const { createAgentManagement } = await import("../../agent-tasks/src/management.ts");
const { createAgentTaskSource } = await import("../../agent-tasks/src/source.ts");
const { getAgentConversation } = await import("../../agent-tasks/src/agent-runner.ts");
const persistentRoot = join(tmpdir(), `runtime-tasks-agent-${process.pid}.jsonl`);
writeFileSync(persistentRoot, "{}\n");
const ctx = { cwd: "/tmp", sessionManager: { getSessionFile: () => persistentRoot } } as unknown as ExtensionContext;
const pi = {} as ExtensionAPI;
const tick = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function fixture(resumeOnComplete = false) {
  let finish!: (result: RunResult) => void;
  let finishResume!: () => void;
  let runnerOptions!: RunOptions;
  const sessionDir = mkdtempSync(join(tmpdir(), "runtime-tasks-agent-"));
  const rootSessionFile = join(sessionDir, "root.jsonl");
  writeFileSync(rootSessionFile, "{}\n");
  const session = { messages: [{ role: "user", content: "old conversation" }],
    sessionManager: { getSessionFile: () => rootSessionFile }, dispose() {}, steer: async () => {}, subscribe: () => () => {}, getContextUsage: () => undefined,
  } as unknown as AgentSession;
  const coordinator = new TaskCoordinator();
  const manager = new AgentManager(record => {
    if (resumeOnComplete && record.runId === "1" && record.status === "completed") manager.resumeRun(record.id, "new prompt");
  }, 2, undefined, undefined, undefined, {
    runAgent: async (_ctx, _type, _prompt, options) => {
      runnerOptions ??= options; options.onSessionCreated?.(session);
      return new Promise<RunResult>(resolve => {
        finish ??= resolve;
        options.signal?.addEventListener("abort", () => resolve({ session, responseText: "stopped", aborted: true, steered: false }), { once: true });
      });
    },
    resumeAgent: async () => {
      session.messages.push({ role: "user", content: "new conversation", timestamp: Date.now() });
      return new Promise<{ text: string }>(resolve => { finishResume = () => resolve({ text: "new answer" }); });
    },
  });
  const source = createAgentTaskSource(manager, coordinator, new Map());
  let cancelledNotices = 0;
  const capability = createAgentManagement({ manager, source, coordinator, active: () => true,
    owns: record => record.parentAgentId === undefined && record.workflowId === undefined,
    format: (record, verbose) => `${record.result}\n${verbose ? record.terminalConversation ?? (record.session ? getAgentConversation(record.session) : "") : ""}`,
    cancelNotice: () => { cancelledNotices++; }, reconsider() {},
  });
  const id = manager.spawn(pi, ctx, "general-purpose", "test", { description: "test", isBackground: true });
  return { manager, source, coordinator, capability, id, session, options: () => runnerOptions,
    finish: () => finish({ session, responseText: "old answer", aborted: false, steered: false }),
    cancelledNotices: () => cancelledNotices,
    async close() { finishResume?.(); manager.freezeAdmission(); manager.abortAll(); finish({ session, responseText: "cleanup", aborted: true, steered: false }); await tick(); source.dispose(); coordinator.dispose(); await manager.dispose(); rmSync(sessionDir, { recursive: true, force: true }); },
  };
}

test("terminal verbose answer survives synchronous completion resume without cancelling new-run notices", async () => {
  const f = fixture(true);
  try {
    const run = f.manager.getRun(f.id)!;
    const waiting = f.capability.execute(run.identity, { action: "wait", task_id: f.id, verbose: true }, undefined, undefined, ctx);
    f.finish();
    const result = await waiting;
    const text = result.content.map(block => block.type === "text" ? block.text : "").join("");
    assert.match(text, /old answer/); assert.match(text, /old conversation/); assert.doesNotMatch(text, /new conversation/);
    assert.equal(result.details.runtimeTask.run_id, "1");
    assert.equal(f.manager.getRun(f.id)?.identity.runId, "2");
    assert.equal(f.cancelledNotices(), 0);
    assert.equal(f.manager.getRecord(f.id)?.resultConsumed, false);
  } finally { await f.close(); }
});

test("terminal formatting errors reject the tool without an orphaned promise", async () => {
  const f = fixture();
  const capability = createAgentManagement({ manager: f.manager, source: f.source, coordinator: f.coordinator, active: () => true,
    owns: () => true, format: () => { throw new Error("formatter failed"); }, cancelNotice() {}, reconsider() {},
  });
  try {
    const waiting = capability.execute(f.manager.getRun(f.id)!.identity, { action: "wait", task_id: f.id }, undefined, undefined, ctx);
    f.finish(); await assert.rejects(waiting, /formatter failed/);
    assert.equal(f.coordinator.countWaits(f.manager.getRun(f.id)!.identity), 0);
  } finally { await f.close(); }
});

test("stop reports observed stopped metadata while actual execution is still independently owned", async () => {
  const f = fixture();
  try {
    const run = f.manager.getRun(f.id)!;
    const result = await f.capability.execute(run.identity, { action: "stop", task_id: f.id }, undefined, undefined, ctx);
    assert.equal(result.details.runtimeTask.status, "stopped");
    assert.equal(result.details.runtimeTask.raw_status, "stopped");
    assert.match(result.content.map(block => block.type === "text" ? block.text : "").join(""), /observed status=stopped/);
    assert.equal((await run.terminal).status, "stopped");
  } finally { await f.close(); }
});

test("branch management does not replace root retention and expires with its owner run", async () => {
  const f = fixture();
  try {
    const root = f.manager.getRecord(f.id)!;
    const retained = f.manager.spawn(pi, ctx, "general-purpose", "child", { parentAgentId: root.id, description: "child", isBackground: true });
    const child = f.manager.getRecord(retained)!;
    // The actual manager passes this finite builder to the runner.
    const branch = f.options().nestedRuntime!.management!(f.coordinator);
    assert.deepEqual(branch.list().map(entry => entry.view.taskId), [retained]);
    const outsider = f.manager.spawn(pi, ctx, "general-purpose", "sibling", { description: "sibling", isBackground: true });
    assert.ok(!branch.list().some(entry => entry.view.taskId === outsider));
    child.parentRunId = "0";
    assert.equal(branch.list().length, 0);
    child.parentRunId = root.runId;
    child.status = "completed"; child.resultConsumed = true; child.completedAt = 0;
    Reflect.get(f.manager, "cleanup").call(f.manager);
    assert.ok(f.manager.getRecord(retained), "root source's active-parent retention remains installed");
    f.manager.abort(root.id);
    assert.equal(branch.list().length, 0);
  } finally { await f.close(); }
});
