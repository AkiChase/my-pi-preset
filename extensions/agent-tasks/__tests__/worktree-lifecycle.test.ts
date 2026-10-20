import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import "./source-loader.mjs";
const { AgentManager } = await import("../src/agent-manager.ts");
const { createWorktree, cleanupWorktree } = await import("../src/worktree.ts");
import type { WorktreeInfo } from "../src/worktree.ts";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "worktree-lifecycle-"));
  const rootSessionFile = join(root, "root.jsonl");
  writeFileSync(rootSessionFile, "");
  const calls: { args: string[]; options: Parameters<ExtensionAPI["exec"]>[2] }[] = [];
  const gate = deferred(), reached = deferred();
  let partial: WorktreeInfo | undefined;
  const exec: ExtensionAPI["exec"] = async (_cmd, args, options) => {
    calls.push({ args, options });
    if (args[0] === "worktree" && args[1] === "add") {
      const path = args[3]!;
      mkdirSync(path); writeFileSync(join(path, "unsaved.txt"), "keep");
      partial = { path, workPath: path, baseSha: "base", branch: "saved" };
      reached.resolve(); await gate.promise;
    }
    return { stdout: args[1] === "--show-toplevel" ? root : args[1] === "HEAD" ? "base" : "true", stderr: "", code: 0, killed: false };
  };
  // SDK private fields are not involved: only its public exec surface is used.
  const pi = { exec } as ExtensionAPI;
  const ctx = { cwd: root, sessionManager: { getSessionFile: () => rootSessionFile } } as unknown as ExtensionContext;
  return { root, ctx, pi, calls, gate, reached, get partial() { return partial; },
    close() { gate.resolve(); if (partial) rmSync(partial.path, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); },
  };
}
void it("actual worktree add signal cancellation preserves partial paths and does not continue git", async () => {
  const f = fixture(), controller = new AbortController(); let captured: WorktreeInfo | undefined;
  try {
    const work = createWorktree(f.pi, f.root, "cancel-add", { signal: controller.signal, onCreated: wt => { captured = wt; } });
    const rejected = assert.rejects(work, /cancelled/);
    await f.reached.promise; controller.abort(); f.gate.resolve(); await rejected;
    assert.equal(f.calls.at(-1)?.options?.signal, controller.signal);
    assert.equal(f.calls.length, 4); assert.equal(captured?.path, f.partial?.path);
    assert.equal(readFileSync(join(captured!.path, "unsaved.txt"), "utf8"), "keep");
  } finally { f.close(); }
});
void it("actual manager worktree add cancelled at close never launches a runner or stale cleanup", async () => {
  const f = fixture(); let runs = 0;
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    worktreeEnabled: () => true, runAgent: async () => { runs++; throw new Error("must not run"); },
  });
  try {
    const id = manager.spawn(f.pi, f.ctx, "general-purpose", "no", { description: "cancel", isolation: "worktree", isBackground: true });
    await f.reached.promise;
    manager.freezeAdmission(); manager.abortAll(); assert.equal((await manager.getRun(id)!.terminal).status, "stopped");
    let drained = false; const drain = manager.drainExecution().then(() => { drained = true; });
    await Promise.resolve(); assert.equal(drained, false);
    const dispose = manager.dispose(); f.gate.resolve(); await dispose; await drain;
    assert.equal(runs, 0); assert.equal(f.calls.length, 4);
    assert.equal(existsSync(join(f.partial!.path, "unsaved.txt")), true);
    assert.equal(manager.executionCount, 0);
  } finally { f.gate.resolve(); await manager.dispose(); f.close(); }
});
void it("actual worktree cleanup failures preserve unsaved files and generated branches", async () => {
  for (const fail of ["commit", "branch", "remove"] as const) {
    const root = mkdtempSync(join(tmpdir(), "worktree-save-")), tree = join(root, "tree");
    mkdirSync(tree); writeFileSync(join(tree, "unsaved.txt"), "keep");
    const calls: string[][] = [];
    const exec: ExtensionAPI["exec"] = async (_cmd, args) => {
      calls.push(args);
      return { stdout: args[0] === "status" ? " M unsaved.txt" : "", stderr: "failed", code: args.includes(fail) ? 1 : 0, killed: false };
    };
    try {
      const result = await cleanupWorktree({ exec } as ExtensionAPI, root, { path: tree, workPath: tree, baseSha: "base", branch: "saved" }, "test");
      assert.equal(result.preserved, true); assert.equal(result.hasChanges, true); assert.equal(result.path, tree);
      assert.equal(result.branch, fail === "remove" ? "saved" : undefined);
      assert.ok(calls.every(args => !args.includes("--force") && !args.includes("prune")));
      if (fail !== "remove") assert.ok(calls.every(args => !args.includes("remove")));
      assert.equal(readFileSync(join(tree, "unsaved.txt"), "utf8"), "keep");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
void it("actual cleanup cancellation between awaits starts no subsequent git and keeps artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "worktree-cleanup-cancel-"));
  const controller = new AbortController(), calls: string[][] = [];
  const exec: ExtensionAPI["exec"] = async (_cmd, args) => { calls.push(args); controller.abort(); return { stdout: " M file", stderr: "", code: 0, killed: false }; };
  try {
    const result = await cleanupWorktree({ exec } as ExtensionAPI, root, { path: root, workPath: root, branch: "saved", baseSha: "base" }, "test", { signal: controller.signal });
    assert.equal(result.preserved, true); assert.equal(calls.length, 1); assert.equal(existsSync(root), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void it("actual runner cleanup waits for its output hook and in-flight git, stops after close boundary", async () => {
  const f = fixture(), cleanupGate = deferred(), cleanupReached = deferred();
  let finish!: () => void, output = 0, hooks = 0;
  const session = { messages: [], sessionManager: { getSessionFile: () => join(f.root, "cleanup-child.jsonl") }, abort: async () => {}, dispose() {} } as unknown as import("@earendil-works/pi-coding-agent").AgentSession;
  const exec: ExtensionAPI["exec"] = async (_cmd, args, options) => {
    f.calls.push({ args, options }); cleanupReached.resolve(); await cleanupGate.promise;
    return { stdout: " M unsaved.txt", stderr: "", code: 0, killed: false };
  };
  const tree = join(f.root, "ready-tree"); mkdirSync(tree); writeFileSync(join(tree, "unsaved.txt"), "keep");
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    worktreeEnabled: () => true,
    createWorktree: async () => ({ path: tree, workPath: tree, branch: "saved", baseSha: "base" }),
    runAgent: async (_ctx, _type, _prompt, options) => {
      options.onSessionCreated?.(session);
      await new Promise<void>(done => { finish = done; });
      return { session, responseText: "done", aborted: false, steered: false };
    },
  });
  try {
    const id = manager.spawn({ exec } as ExtensionAPI, f.ctx, "general-purpose", "work", { description: "cleanup", isolation: "worktree", isBackground: true,
      onBeforeWorktreeCleanup: async () => { hooks++; },
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    manager.getRecord(id)!.outputCleanup = () => { output++; };
    finish(); await cleanupReached.promise;
    assert.equal(output, 1); assert.equal(hooks, 1);
    let drained = false; const drain = manager.drainExecution().then(() => { drained = true; });
    manager.freezeAdmission(); manager.abortAll();
    const dispose = manager.dispose();
    await Promise.resolve(); assert.equal(drained, false);
    cleanupGate.resolve(); await dispose; await drain;
    assert.equal(f.calls.length, 1, "cancelled status await must not stage/commit/remove");
    assert.equal(f.calls[0]!.options?.signal?.aborted, true);
    assert.equal(readFileSync(join(tree, "unsaved.txt"), "utf8"), "keep");
    assert.equal(manager.executionCount, 0); assert.equal(output, 1);
  } finally { finish?.(); cleanupGate.resolve(); await manager.dispose(); f.close(); }
});

void it("noncooperative runner close preserves actively written worktree and retained late owner", async () => {
  const f = fixture(), gate = deferred(), ready = deferred(); let cleanup = 0, disposed = 0;
  const tree = join(f.root, "active-tree"); mkdirSync(tree); writeFileSync(join(tree, "writing.txt"), "keep");
  const session = { messages: [], sessionManager: { getSessionFile: () => join(f.root, "active-child.jsonl") }, abort: async () => {}, dispose() { disposed++; } } as unknown as import("@earendil-works/pi-coding-agent").AgentSession;
  const manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
    disposeTimeoutMs: 15, worktreeEnabled: () => true,
    createWorktree: async () => ({ path: tree, workPath: tree, branch: "saved", baseSha: "base" }),
    cleanupWorktree: async () => { cleanup++; rmSync(tree, { recursive: true }); return { hasChanges: false }; },
    runAgent: async (_ctx, _type, _prompt, options) => {
      options.onSessionCreated?.(session); ready.resolve(); await gate.promise;
      return { session, responseText: "late", aborted: false, steered: false };
    },
  });
  try {
    manager.spawn(f.pi, f.ctx, "general-purpose", "work", { description: "active", isolation: "worktree", isBackground: true });
    await ready.promise; await manager.dispose();
    assert.equal(cleanup, 0); assert.equal(disposed, 0); assert.ok(manager.executionCount > 0);
    assert.equal(readFileSync(join(tree, "writing.txt"), "utf8"), "keep");
    gate.resolve(); await manager.drainExecution();
    assert.equal(cleanup, 0); assert.equal(disposed, 1); assert.equal(manager.executionCount, 0);
    assert.equal(existsSync(tree), true); assert.equal(manager.listAgents().length, 0);
  } finally { gate.resolve(); await manager.drainExecution(); await manager.dispose(); f.close(); }
});
