import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import "../../agent-tasks/__tests__/source-loader.mjs";
import type { AgentConfig } from "../../agent-tasks/src/types.ts";
import type { RunOptions } from "../../agent-tasks/src/agent-runner.ts";
const { runAgent, shutdownChildSession } = await import("../../agent-tasks/src/agent-runner.ts");
const { AgentManager } = await import("../../agent-tasks/src/agent-manager.ts");
const { registerAgents } = await import("../../agent-tasks/src/agent-types.ts");
const composition = fileURLToPath(new URL("../../task-composition.ts", import.meta.url));
const tick = () => new Promise<void>(done => setImmediate(done));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await tick(); }
  assert.ok(predicate(), "actual session boundary did not settle");
}
const text = (result: { content: { type: string; text?: string }[] }) => result.content.map(block => block.text ?? "").join("\n");
const meta = (result: unknown) => (result as { details: { runtimeTask: { error_code?: string; run_id?: string; count?: number; wait_outcome?: string } } }).details.runtimeTask;
const launch = (result: unknown) => (result as { details: { runtimeLaunch: { task_id: string; run_id: string } } }).details.runtimeLaunch;

// Actual SDK session factory, cached jiti resource loader, tool wrappers and
// manager/runner. Only environment inspection and model prompt are offline seams.
function fixture(configPatch: Partial<AgentConfig> = {}) {
  const root = mkdtempSync(join(tmpdir(), "runtime-child-loader-")), agent = join(root, "agent"), cwd = join(root, "cwd"), other = join(root, "other");
  mkdirSync(agent); mkdirSync(cwd); mkdirSync(other); mkdirSync(join(agent, "agents"));
  writeFileSync(join(agent, "settings.json"), JSON.stringify({ extensions: [composition], compaction: { enabled: false } }));
  writeFileSync(join(agent, "agent-tasks.json"), JSON.stringify({ schedulingEnabled: false, rememberAgents: false, outputTranscript: false }));
  writeFileSync(join(agent, "agents", "leaf.md"), "---\nname: leaf\ndescription: offline leaf\nextensions: false\ntools: none\npersist_session: false\n---\nReturn the answer.\n");
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  const parent: AgentConfig = { name: "parent", description: "parent", systemPrompt: "offline", builtinToolNames: ["bash"], extensions: true, skills: false, promptMode: "replace", allowedSubagents: "all", persistSession: false, ...configPatch };
  const leaf: AgentConfig = { ...parent, name: "leaf", allowedSubagents: undefined, extensions: false };
  registerAgents(new Map([[parent.name, parent], [leaf.name, leaf]]));
  const calls: { session: AgentSession; options: RunOptions; prompt: string; finish(text?: string): void }[] = [];
  const sessions = new Set<AgentSession>();
  const pi = {} as ExtensionAPI;
  const ctx = { cwd, getSystemPrompt: () => "", modelRegistry: { getAvailable: () => [] }, sessionManager: { getSessionFile: () => undefined } } as unknown as ExtensionContext;
  let owner: RunOptions;
  let completed: ((record: import("../../agent-tasks/src/types.ts").AgentRecord) => void) | undefined;
  const manager = new AgentManager(record => completed?.(record), 4, undefined, undefined, undefined, {
    runAgent: (context, type, prompt, options) => {
      if (type === "parent") owner = options;
      return runAgent(context, type, prompt, options, {
        detectEnv: async () => ({ isGitRepo: false, branch: "", platform: "test" }),
        createAgentSession: async opts => {
          const created = await createAgentSession(opts), session = created.session;
          sessions.add(session);
          session.prompt = async prompt => {
            await new Promise<void>(done => {
              let finished = false;
              const finish = (answer = "offline answer") => {
                if (finished) return; finished = true;
                session.agent.state.messages.push({ role: "assistant", content: [{ type: "text", text: answer }], stopReason: "stop", api: "anthropic-messages", provider: "offline", model: "offline", timestamp: 0,
                  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
                done();
              };
              calls.push({ session, options, prompt, finish });
              options.signal?.addEventListener("abort", () => finish("stopped"), { once: true });
            });
          };
          return created;
        },
      });
    },
  });
  const start = (targetCwd = cwd, isolated = false) => manager.spawn(pi, ctx, "parent", "initial", { description: "parent", cwd: targetCwd, isolated, isBackground: true });
  const call = (session: AgentSession, name: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    const tool = session.agent.state.tools.find(tool => tool.name === name);
    assert.ok(tool, `${name} must be present in actual active SDK tools: ${session.getActiveToolNames()}`);
    return tool.execute("offline-tool", args, signal);
  };
  return { root, cwd, other, ctx, manager, calls, start, call, owner: () => owner!, onComplete: (callback: typeof completed) => { completed = callback; },
    async close() {
      manager.freezeAdmission(); manager.abortAll(); for (const call of calls) call.finish();
      await manager.drainExecution(); await manager.dispose();
      for (const session of sessions) await shutdownChildSession(session);
      registerAgents(new Map());
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

for (const different of [false, true]) test(`actual retained child composite resume, owned branches and local process (${different ? "different" : "same"} cwd)`, { timeout: 30_000 }, async () => {
  const f = fixture();
  try {
    const parent = f.start(different ? f.other : f.cwd);
    await until(() => f.calls.length === 1);
    const session = f.calls[0]!.session, tool = session.getToolDefinition("task_manage");
    assert.ok(tool); assert.equal(session.getAllTools().filter(tool => tool.name === "task_manage").length, 1);
    f.calls[0]!.finish("initial answer"); await until(() => !f.manager.isRunActive(parent));
    assert.ok(f.manager.resumeRun(parent, "resumed")); await until(() => f.calls.length === 2);
    assert.equal(f.calls[1]!.session, session); assert.equal(session.getToolDefinition("task_manage"), tool, "same retained facade/tool");
    const a = launch(await f.call(session, "subagent_run", { subagent_type: "leaf", description: "owned", prompt: "child", run_in_background: true }));
    await until(() => f.calls.length === 3);
    assert.equal(f.manager.getRecord(a.task_id)?.parentRunId, "2");
    assert.match(text(await f.call(session, "task_manage", { action: "list" })), new RegExp(a.task_id));
    const sibling = f.start(different ? f.cwd : f.other); await until(() => f.calls.length === 4);
    const siblingSession = f.calls[3]!.session;
    const b = launch(await f.call(siblingSession, "subagent_run", { subagent_type: "leaf", description: "other owned", prompt: "sibling child", run_in_background: true }));
    await until(() => f.calls.length === 5);
    for (const forbidden of [parent, sibling, b.task_id]) assert.equal(meta(await f.call(session, "task_manage", { action: "output", task_id: forbidden })).error_code, "not_found");
    assert.equal(meta(await f.call(siblingSession, "task_manage", { action: "stop", task_id: a.task_id })).error_code, "not_found");
    const local = launch(await f.call(session, "bash", { command: "printf CHILD_LOCAL", run_in_background: true, notify: false }));
    assert.match(text(await f.call(session, "task_manage", { action: "wait", task_id: local.task_id })), /CHILD_LOCAL/);
    assert.equal(meta(await f.call(siblingSession, "task_manage", { action: "output", task_id: local.task_id })).error_code, "not_found");
    f.onComplete(record => { if (record.id === a.task_id && record.runId === "1") f.manager.resumeRun(a.task_id, "nested resumed"); });
    const waiting = f.call(session, "task_manage", { action: "wait", task_id: a.task_id });
    f.calls[2]!.finish("nested final answer");
    const oldAnswer = await waiting;
    assert.match(text(oldAnswer), /nested final answer/); assert.equal(meta(oldAnswer).run_id, "1");
    await until(() => f.calls.length === 6);
    assert.equal(f.manager.getRun(a.task_id)?.identity.runId, "2");
    assert.equal(f.manager.getRecord(a.task_id)?.resultConsumed, false, "old waiter cannot consume new child run");
    f.onComplete(undefined); f.calls[5]!.finish("nested second answer"); await until(() => !f.manager.isRunActive(a.task_id));
    assert.match(text(await f.call(session, "task_manage", { action: "output", task_id: a.task_id })), /nested second answer/);
    const stopped = await f.call(siblingSession, "task_manage", { action: "stop", task_id: b.task_id });
    assert.match(text(stopped), /Stop requested/);
    assert.equal(f.manager.getRecord(parent)?.status, "running");
    assert.equal(f.manager.getRecord(sibling)?.status, "running");
    // Freeze owner run 2 before asynchronous completion. New owner run 3 may
    // admit children through the same tool but cannot be consumed by this wait.
    const oldChild = launch(await f.call(session, "subagent_run", { subagent_type: "leaf", description: "old waiter", prompt: "old waiter", run_in_background: true }));
    await until(() => f.calls.length === 7);
    const oldWait = f.call(session, "task_manage", { action: "wait", task_id: oldChild.task_id });
    f.onComplete(record => { if (record.id === parent && record.runId === "2") f.manager.resumeRun(parent, "third"); });
    f.calls[1]!.finish("resume complete"); await until(() => f.calls.length === 8);
    f.onComplete(undefined);
    const newer = launch(await f.call(session, "subagent_run", { subagent_type: "leaf", description: "new owner", prompt: "new child", run_in_background: true }));
    await until(() => f.calls.length === 9);
    const stale = await oldWait;
    assert.equal(meta(stale).error_code, "closed", "operation captured owner run 2, not the resumed owner");
    assert.equal(meta(stale).run_id, oldChild.run_id);
    assert.equal(f.manager.getRecord(newer.task_id)?.resultConsumed, false);
    assert.match(text(await f.call(session, "task_manage", { action: "list" })), new RegExp(newer.task_id));
    assert.match(text(await f.call(session, "task_manage", { action: "stop", task_id: newer.task_id })), /Stop requested/);
    assert.equal(f.manager.getRecord(sibling)?.status, "running", "resumed owner's stop cannot stop sibling parent");
    await shutdownChildSession(session);
    assert.equal(f.calls[0]!.options.nestedRuntime?.management!(new (await import("../../task-ui/coordinator.ts")).TaskCoordinator()).list().length, 0, "closed retained session cannot revive branch");
  } finally { await f.close(); }
});

for (const mode of ["noExtensions", "excluded", "deny", "isolated", "nestedOff", "narrow", "narrowAllow"] as const) test(`actual runner loader nested admission matrix: ${mode}`, { timeout: 30_000 }, async () => {
  const patch: Partial<AgentConfig> = mode === "noExtensions" ? { extensions: false, builtinToolNames: [] }
    : mode === "excluded" ? { extensions: [], builtinToolNames: [] }
    : mode === "deny" ? { extensions: false, builtinToolNames: [], disallowedTools: ["task_manage"] }
    : mode === "isolated" ? { builtinToolNames: [] }
    : mode === "nestedOff" ? { allowedSubagents: undefined }
    : mode === "narrow" ? { extSelectors: ["ext:task-composition/bash"] }
    : mode === "narrowAllow" ? { extSelectors: ["ext:task-composition/task_manage"] } : {};
  const f = fixture(patch);
  try {
    f.start(f.cwd, mode === "isolated"); await until(() => f.calls.length === 1);
    const session = f.calls[0]!.session, names = session.getActiveToolNames();
    const nested = mode !== "isolated" && mode !== "nestedOff";
    const manageable = !["deny", "isolated", "narrow"].includes(mode);
    assert.equal(names.includes("subagent_run"), nested);
    assert.equal(names.includes("task_manage"), manageable);
    assert.equal(session.getAllTools().filter(tool => tool.name === "task_manage").length, manageable || mode === "narrow" ? 1 : 0);
    if (["noExtensions", "excluded", "deny", "isolated"].includes(mode)) assert.equal(names.includes("bash"), false, "no local process capability revival");
    if (!nested) {
      if (mode === "nestedOff") {
        const local = launch(await f.call(session, "bash", { command: "printf NESTED_OFF", run_in_background: true, notify: false }));
        assert.match(text(await f.call(session, "task_manage", { action: "wait", task_id: local.task_id })), /NESTED_OFF/);
      }
      return;
    }
    const result = await f.call(session, "subagent_run", { subagent_type: "leaf", description: "nested", prompt: "nested", run_in_background: true });
    if (!manageable) {
      assert.equal(result.isError, true); assert.match(text(result), /requires.*task_manage/); assert.equal(f.manager.listAgents().length, 1);
      const foreground = f.call(session, "subagent_run", { subagent_type: "leaf", description: "inline allowed", prompt: "inline allowed" });
      await until(() => f.calls.length === 2); f.calls[1]!.finish("inline answer");
      assert.match(text(await foreground), /inline answer/, "denied manager does not orphan or forbid foreground answers");
      return;
    }
    const child = launch(result); await until(() => f.calls.length === 2);
    assert.equal(meta(await f.call(session, "task_manage", { action: "output", task_id: "root-or-sibling" })).error_code, "not_found");
    f.calls[1]!.finish("owned only final");
    assert.match(text(await f.call(session, "task_manage", { action: "wait", task_id: child.task_id })), /owned only final/);
    const localList = text(await f.call(session, "task_manage", { action: "list" }));
    assert.doesNotMatch(localList, /task_type=bash|task_type=monitor/);
    if (mode === "noExtensions" || mode === "excluded") {
      const next = launch(await f.call(session, "subagent_run", { subagent_type: "leaf", description: "stop owned only", prompt: "stop owned only", run_in_background: true }));
      assert.match(text(await f.call(session, "task_manage", { action: "stop", task_id: next.task_id })), /Stop requested/);
      const retainedTool = session.agent.state.tools.find(tool => tool.name === "task_manage")!;
      await shutdownChildSession(session);
      assert.equal(meta(await retainedTool.execute("late", { action: "list" }, undefined)).error_code, "closed", "closed owned-only facade cannot revive");
    }
  } finally { await f.close(); }
});
