import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RenderContext } from "./types.ts";

/** Activation-owned display clock. Never observes jobs or changes execution. */
export function createToolClock(pi: ExtensionAPI) {
  const calls = new Map<string, { start: number; elapsed?: number; redraw?: () => void }>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stopTimer = () => { if (timer) clearInterval(timer); timer = undefined; };
  const refresh = () => {
    for (const call of calls.values()) if (call.elapsed === undefined) {
      try { call.redraw?.(); } catch { /* A retired display does not own execution. */ }
    }
  };
  const clear = () => { stopTimer(); calls.clear(); };
  pi.on("tool_execution_start", event => {
    if (closed || event.toolName !== "bash" || event.parentToolCallId || calls.has(event.toolCallId)) return;
    calls.set(event.toolCallId, { start: performance.now() });
    // Retain bounded completed displays, never evict active calls.
    if (calls.size > 256) for (const [id, call] of calls) {
      if (call.elapsed !== undefined) calls.delete(id);
      if (calls.size <= 256) break;
    }
    timer ??= setInterval(refresh, 1000);
    timer.unref();
  });
  pi.on("tool_execution_end", event => {
    const call = calls.get(event.toolCallId);
    if (!call || call.elapsed !== undefined) return;
    call.elapsed = Math.max(0, performance.now() - call.start);
    try { call.redraw?.(); } catch { /* Preserve terminal delivery. */ }
    call.redraw = undefined;
    if (![...calls.values()].some(value => value.elapsed === undefined)) stopTimer();
  });
  pi.on("session_start", () => { clear(); closed = false; });
  pi.on("session_shutdown", () => { closed = true; clear(); });
  return {
    display(ctx: RenderContext): string | undefined {
      const call = calls.get(ctx.toolCallId);
      if (!call) return undefined;
      if (call.elapsed === undefined) call.redraw = ctx.invalidate;
      const elapsed = call.elapsed ?? Math.max(0, performance.now() - call.start);
      return `${(elapsed / 1000).toFixed(1)}s handling`;
    },
  };
}
