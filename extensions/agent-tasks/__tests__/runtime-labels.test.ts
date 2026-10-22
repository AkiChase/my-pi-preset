import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import "./source-loader.mjs";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { resumeKey } from "../src/mention.ts";
import { registryLocatorForRootSession } from "../src/subagent-registry.ts";
import type { AgentManagerDependencies } from "../src/agent-manager.ts";
import type { RunResult } from "../src/agent-runner.ts";

const { createAgentTaskSource } = await import("../src/source.ts");
const { AgentManager } = await import("../src/agent-manager.ts");
const { registerAgents } = await import("../src/agent-types.ts");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
// SDK objects carry private runtime fields; only the offline session boundary is cast.
function fakeSession(sessionFile: string): AgentSession {
  return { messages: [], sessionManager: { getSessionFile: () => sessionFile },
    dispose() {}, steer: async () => {}, subscribe: () => () => {}, getContextUsage: () => undefined,
  } as unknown as AgentSession;
}
const pi = {} as ExtensionAPI;

/**
 * Real spawn over a real on-disk subagent registry, with only the runner
 * boundary stubbed. Every agent here takes the production record-construction
 * path, which is where the runtime label originates.
 */
function fixture() {
  // Built-in defaults only: both spawned types must resolve to a real config.
  registerAgents(new Map());
  const sessionDir = mkdtempSync(join(tmpdir(), "agent-runtime-labels-"));
  const rootSessionFile = join(sessionDir, "root.jsonl");
  writeFileSync(rootSessionFile, "");
  const ctx = { cwd: tmpdir(), sessionManager: { getSessionFile: () => rootSessionFile } } as unknown as ExtensionContext;
  const calls: { id: string; session: AgentSession; options: Parameters<NonNullable<AgentManagerDependencies["runAgent"]>>[3]; finish: (text?: string) => void }[] = [];
  const deps: AgentManagerDependencies = {
    runAgent: async (_ctx, _type, _prompt, options) => {
      const result = deferred<RunResult>();
      const session = fakeSession(join(sessionDir, `child-${calls.length}.jsonl`));
      writeFileSync(session.sessionManager.getSessionFile()!, "");
      const call = { id: options.agentId!, session, options, finish: (text = "answer") => result.resolve({ responseText: text, session, aborted: false, steered: false }) };
      calls.push(call);
      queueMicrotask(() => options.onSessionCreated?.(session));
      options.signal?.addEventListener("abort", () => call.finish("stopped"), { once: true });
      return result.promise;
    },
    resumeAgent: async (session, _prompt) => ({ text: "resumed", session }),
  };
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, deps);
  manager.setMaxConcurrentForeground(1);
  const coordinator = new TaskCoordinator();
  const source = createAgentTaskSource(manager, coordinator, new Map());
  const off = coordinator.registerSource(source);
  const locator = registryLocatorForRootSession(rootSessionFile);
  return {
    ctx, manager, coordinator, source, calls, locator, sessionDir,
    spawn(type: string, background = false) {
      return manager.spawn(pi, ctx, type, "work", { description: "work", isBackground: background, blocking: !background });
    },
    /** Rows as the panel and the overview widget read them. */
    rows() { return coordinator.list().filter(row => row.kind === "agent"); },
    titleOf(taskId: string) { return this.rows().find(row => row.taskId === taskId)?.title; },
    async close() {
      manager.freezeAdmission(); manager.abortAll(); await tick();
      off(); source.dispose(); coordinator.dispose(); await manager.dispose();
      rmSync(sessionDir, { recursive: true, force: true });
    },
  };
}

void it("real spawn labels every runtime agent with its resume key instead of the raw agent id", async () => {
  const f = fixture();
  try {
    const first = f.spawn("general-purpose");
    const second = f.spawn("Explore");
    await tick();
    const records = f.manager.listAgents();
    const byId = new Map(records.map(record => [record.id, record]));
    // The persistent registry index must reach the live record, not only the
    // hydrated projection; that gap is what made the panel print agent IDs.
    assert.equal(byId.get(first)!.registryIndex, 0);
    assert.equal(byId.get(second)!.registryIndex, 1);
    // Row order follows the coordinator's own ordering; identity is by task id.
    assert.equal(f.titleOf(first), resumeKey("general-purpose", 0));
    assert.equal(f.titleOf(second), resumeKey("Explore", 1));
    // Titles must never fall back to the opaque `agent_<type>_<index>_<uuid>` form.
    for (const row of f.rows()) assert.doesNotMatch(row.title, /^agent_/);
  } finally { await f.close(); }
});

void it("resume and rehydrated agents keep the same short runtime label", async () => {
  const f = fixture();
  try {
    const id = f.spawn("general-purpose");
    await tick();
    f.calls[0]!.finish("done");
    await tick();
    // A fresh manager sees only the persisted registry, exactly like a Pi restart.
    const restored = new AgentManager(undefined, 1, undefined, undefined, undefined, {
      runAgent: async () => { throw new Error("resume must not spawn a new agent"); },
    } as unknown as AgentManagerDependencies);
    const restoredSource = createAgentTaskSource(restored, f.coordinator, new Map(), { observe: false });
    const [hydrated] = restored.hydratePersistentAgents(f.locator, null);
    assert.ok(hydrated, "registry entry must hydrate");
    assert.equal(hydrated.registryIndex, 0);
    assert.equal(restoredSource.list()[0]!.title, resumeKey("general-purpose", 0));
    const resumed = restored.resumePersistent(pi, f.ctx, id, "again");
    assert.ok(resumed, "resume must reuse the persistent identity");
    assert.equal(resumed.registryIndex, 0);
    const resumedTitle = restoredSource.list().find(row => row.taskId === id)!.title;
    assert.equal(resumedTitle, resumeKey("general-purpose", 0));
    assert.doesNotMatch(resumedTitle, /^agent_/);
    restoredSource.dispose();
  } finally { await f.close(); }
});
