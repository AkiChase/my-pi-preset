// Node's native strip-only loader cannot erase vendor parameter properties.
// This local, in-memory transform is deliberately NOT a production loader.
import "./source-loader.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import type { WorkflowHost, WorkflowSpawnRequest } from "../src/workflow/runtime.ts";
const { runWorkflow } = await import("../src/workflow/runtime.ts");

const meta = 'export const meta = { name: "offline smoke", description: "worker handshake" };';
const noAgents: WorkflowHost = {
  spawnAgent() { throw new Error("no agent may start in this script"); },
  abortAgent() { throw new Error("no agent may be aborted in this script"); },
};

void it("real workflow worker executes a no-agent script and shuts down before resolving", { timeout: 10_000 }, async () => {
  const batches: unknown[] = [];
  const result = await runWorkflow({ script: `${meta}\nlog("ready"); return { answer: args.value + 1 };`, host: noAgents,
    args: { value: 41 },
    onProgress: entries => batches.push(...entries),
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.value, { answer: 42 });
  assert.equal(result.agentCount, 0);
  assert.deepEqual(result.progress, batches);
  assert.ok(result.progress.length > 0, "worker progress must cross the real message channel");
});

void it("real worker RPC invokes a stub host and returns its answer", { timeout: 10_000 }, async () => {
  const requests: WorkflowSpawnRequest[] = [];
  const host: WorkflowHost = {
    async spawnAgent(request) {
      requests.push(request);
      return { ok: true, text: "offline answer", tokens: 3, toolCalls: 0 };
    },
    abortAgent() { assert.fail("completed agent must not remain inflight"); },
  };
  const result = await runWorkflow({ script: `${meta}\nreturn await agent("stub only", { label: "probe" });`, host });
  assert.equal(result.status, "completed");
  assert.equal(result.value, "offline answer");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.prompt, "stub only");
  assert.equal(result.agentCount, 1);
});

void it("abort stops a live real worker without a forced test-process exit", { timeout: 10_000 }, async () => {
  const controller = new AbortController();
  let ready!: () => void;
  const handshake = new Promise<void>(resolve => { ready = resolve; });
  const running = runWorkflow({ script: `${meta}\nlog("ready"); await new Promise(() => {});`, host: noAgents,
    signal: controller.signal,
    onProgress: () => ready(),
  });
  try {
    await handshake;
    controller.abort();
    const result = await running;
    assert.equal(result.status, "killed");
    assert.equal(result.error, "Workflow aborted.");
    assert.equal(result.agentCount, 0);
  } finally {
    controller.abort();
    await running;
  }
});

void it("aborted real worker never starts a gate from a late host result", { timeout: 10_000 }, async () => {
  let resolve!: (value: import("../src/workflow/runtime.ts").WorkflowSpawnResult) => void;
  let ready!: () => void;
  const started = new Promise<void>(done => { ready = done; });
  const response = new Promise<import("../src/workflow/runtime.ts").WorkflowSpawnResult>(done => { resolve = done; });
  const controller = new AbortController();
  let gates = 0, journals = 0;
  const running = runWorkflow({ script: `${meta}\nawait agent("late", { gate: "verify" });`,
    signal: controller.signal,
    host: { async spawnAgent() { ready(); return response; }, abortAgent() {}, async runGate() { gates++; return { ok: true, output: "" }; } },
    journal: { append() { journals++; } },
  });
  try {
    await started; controller.abort(); await running;
    resolve({ ok: true, text: "late" });
    await new Promise(done => setTimeout(done, 30));
    assert.equal(gates, 0); assert.equal(journals, 0);
  } finally { controller.abort(); resolve({ ok: false }); await running; }
});

void it("paused real worker and a throwing host abort still terminate without new launch or retained control", { timeout: 10_000 }, async () => {
  let control!: import("../src/workflow/runtime.ts").WorkflowControl;
  const controller = new AbortController(); let calls = 0;
  const work = runWorkflow({ script: `${meta}\nreturn await agent("paused");`, host: { async spawnAgent() { calls++; return { ok: true, text: "unexpected" }; }, abortAgent() { throw new Error("optional abort hook"); } },
    signal: controller.signal, onControl(value) { control = value; control.pause(); },
  });
  await new Promise(done => setTimeout(done, 50)); assert.equal(calls, 0); controller.abort();
  assert.equal((await work).status, "killed"); control.resume(); assert.equal(control.retry(0), false); assert.equal(calls, 0);
});
