import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createToolClock } from "../tool-clock.ts";
import type { RenderContext } from "../types.ts";

test("display clock tracks every top-level call, labels live elapsed time and uses final execution duration", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const handlers = new Map<string, (event: { toolCallId?: string; toolName?: string; parentToolCallId?: string }) => void>();
  const pi = { on(name: string, handler: (event: object) => void) { handlers.set(name, handler); return () => handlers.delete(name); } } as unknown as ExtensionAPI;
  const clock = createToolClock(pi);
  let redraws = 0;
  const ctx = { toolCallId: "a", invalidate: () => { redraws++; } } as RenderContext;

  assert.equal(clock.timing(ctx), undefined);
  handlers.get("tool_execution_start")!({ toolName: "read", toolCallId: "a" });
  assert.deepEqual(clock.timing(ctx), { kind: "elapsed", durationMs: 0 });
  assert.equal(clock.display(ctx), "elapsed 0.0s");

  now = 2500; t.mock.timers.tick(1000);
  assert.equal(redraws, 1);
  assert.deepEqual(clock.timing(ctx), { kind: "elapsed", durationMs: 2500 });

  handlers.get("tool_execution_start")!({ toolName: "read", toolCallId: "a" });
  now = 3000;
  handlers.get("tool_execution_end")!({ toolName: "read", toolCallId: "a" });
  assert.equal(clock.timing(ctx), undefined);
  assert.deepEqual(clock.timing({ ...ctx, durationMs: 2000 }), { kind: "execution", durationMs: 2000 });
  assert.equal(clock.display({ ...ctx, durationMs: 2000 }), "execution 2.0s");

  now = 9000; t.mock.timers.tick(1000);
  assert.equal(redraws, 2);
  handlers.get("session_start")!({});
  assert.equal(clock.timing(ctx), undefined);
  handlers.get("tool_execution_start")!({ toolName: "read", toolCallId: "a", parentToolCallId: "parent" });
  assert.equal(clock.timing(ctx), undefined);
  handlers.get("session_shutdown")!({});
  handlers.get("tool_execution_start")!({ toolName: "read", toolCallId: "late" });
  assert.equal(clock.timing({ ...ctx, toolCallId: "late" }), undefined);
});
