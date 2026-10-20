import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RenderContext } from "./types.ts";

export interface ToolTiming {
  kind: "elapsed" | "execution";
  durationMs: number;
}

function validDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * Activation-owned display timing. It observes only top-level tool lifecycle
 * events and never changes execution, delivery, or persisted history.
 */
export function createToolClock(pi: ExtensionAPI) {
  const calls = new Map<string, { start: number; redraw?: () => void }>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stopTimer = () => { if (timer) clearInterval(timer); timer = undefined; };
  const refresh = () => {
    for (const call of calls.values()) {
      try { call.redraw?.(); } catch { /* A retired display does not own execution. */ }
    }
  };
  const clear = () => { stopTimer(); calls.clear(); };

  pi.on("tool_execution_start", event => {
    if (closed || event.parentToolCallId || calls.has(event.toolCallId)) return;
    calls.set(event.toolCallId, { start: performance.now() });
    timer ??= setInterval(refresh, 1000);
    timer.unref();
  });
  pi.on("tool_execution_end", event => {
    const call = calls.get(event.toolCallId);
    if (!call) return;
    calls.delete(event.toolCallId);
    try { call.redraw?.(); } catch { /* Preserve terminal delivery. */ }
    if (!calls.size) stopTimer();
  });
  pi.on("session_start", () => { clear(); closed = false; });
  pi.on("session_shutdown", () => { closed = true; clear(); });

  const timing = (ctx: RenderContext): ToolTiming | undefined => {
    // durationMs is the host's final execute() duration. It wins over the
    // broader lifecycle elapsed window and is safe for history rendering.
    if (validDuration(ctx.durationMs)) return { kind: "execution", durationMs: ctx.durationMs };
    const call = calls.get(ctx.toolCallId);
    if (!call) return undefined;
    call.redraw = ctx.invalidate;
    return { kind: "elapsed", durationMs: Math.max(0, performance.now() - call.start) };
  };

  return {
    timing,
    display(ctx: RenderContext): string | undefined {
      const value = timing(ctx);
      return value ? `${value.kind} ${formatDuration(value.durationMs)}` : undefined;
    },
  };
}
