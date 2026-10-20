import "./source-loader.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "../src/agent-manager.ts";
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
void it("actual workflow host gate observes cancellation and drain waits for the real pi.exec promise", async () => {
  const { createWorkflowHost } = await import("../src/workflow/host.ts");
  const response = deferred<{ code: number; stdout: string; stderr: string; killed: boolean }>();
  const controller = new AbortController(), owned = new Set<Promise<unknown>>(); let calls = 0, signal: AbortSignal | undefined;
  const host = createWorkflowHost({ pi: { exec(_file: string, _args: string[], options: { signal: AbortSignal }) { calls++; signal = options.signal; return response.promise; } } as unknown as ExtensionAPI,
    ctx: { cwd: tmpdir() } as ExtensionContext, manager: {} as AgentManager, signal: controller.signal,
    own<T>(start: () => Promise<T>) { const promise = start(); owned.add(promise); void promise.then(() => owned.delete(promise), () => owned.delete(promise)); return promise; },
  });
  const gate = host.runGate!("verify", { agentId: "owned" });
  controller.abort(); assert.equal(signal?.aborted, true); assert.equal(owned.size, 1);
  response.resolve({ code: 0, stdout: "late", stderr: "", killed: false });
  await assert.rejects(gate, /closing/); assert.equal(owned.size, 0);
  await assert.rejects(host.runGate!("new", { agentId: "owned" }), /closing/); assert.equal(calls, 1);
});

void it("actual RPC retained callbacks and late spawn reply ignore closing activation", async () => {
  const { registerRpcHandlers } = await import("../src/cross-extension-rpc.ts");
  const callbacks = new Map<string, (value: unknown) => void>(); const replies: unknown[] = [], startup = deferred<void>(); let active = true, spawns = 0;
  const handle = registerRpcHandlers({ events: { on(name, callback) { callbacks.set(name, callback); return () => callbacks.delete(name); }, emit(_name, value) { replies.push(value); } },
    pi: {}, getCtx: () => ({}), isActive: () => active,
    manager: { spawn() { spawns++; return "old"; }, awaitStartup: () => startup.promise, abort: () => true, getRecord: () => ({}), consumeResult: () => true },
  });
  const spawn = callbacks.get("subagents:rpc:spawn")!;
  spawn({ requestId: "old", type: "general-purpose", prompt: "old" }); assert.equal(spawns, 1);
  active = false; Object.values(handle).forEach(off => off()); startup.resolve(); await tick();
  spawn({ requestId: "late", type: "general-purpose", prompt: "late" }); await tick();
  assert.equal(spawns, 1); assert.equal(replies.length, 0); assert.equal(callbacks.size, 0);
});

void it("RPC captures validated reply identity across delayed startup and request mutation", async () => {
  const { registerRpcHandlers } = await import("../src/cross-extension-rpc.ts");
  for (const fail of [false, true]) {
    const callbacks = new Map<string, (value: unknown) => void>(), replies: string[] = [];
    const startup = deferred<void>();
    const handle = registerRpcHandlers({ events: { on(name, callback) { callbacks.set(name, callback); return () => callbacks.delete(name); }, emit(name) { replies.push(name); } },
      pi: {}, getCtx: () => ({}), manager: { spawn: () => "agent", awaitStartup: async () => { await startup.promise; if (fail) throw new Error("startup failed"); },
        abort: () => true, getRecord: () => ({}), consumeResult: () => true },
    });
    try {
      const request: { requestId?: string; type: string; prompt: string } = { requestId: "original", type: "general-purpose", prompt: "offline" };
      callbacks.get("subagents:rpc:spawn")!(request); delete request.requestId;
      startup.resolve(); await tick();
      assert.deepEqual(replies, ["subagents:rpc:spawn:reply:original"]);
    } finally { Object.values(handle).forEach(off => off()); }
  }
});
