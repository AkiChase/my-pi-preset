import type { CustomEditor, ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, okhslColor, truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { interpose } from "../../editor-handoff/index.ts";
import { elapsedSeconds, phaseEnhancement, PhaseState, type Phase } from "./phase-state.ts";
type Indicator = NonNullable<Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]>;
export type PhaseDecorator = (editor: CustomEditor, ctx: ExtensionContext, tui: TUI) => () => void;

function color(theme: Theme, phase: Phase, seconds: number, text: string): string {
  const hue = phase === "Loading" ? 235 : phase === "Brewing" ? 285 : phase === "Tooling" ? 190 : 45;
  const base = phase === "Compacting" ? theme.colors.muted : okhslColor(hue, 0.65, theme.appearance === "dark" ? 0.72 : 0.4);
  const amount = phase === "Asking" ? 0 : phaseEnhancement(seconds) * 0.25;
  return theme.style(text, { fg: mixColors(base, theme.colors.text, amount) });
}

interface MethodCell<F> { value?: F }
// Opaque later wrappers retain only this empty cell and the original public method.
// Keep this function outside the controller's resource-bearing lexical environment.
function forwardMethod<A extends unknown[], R>(cell: MethodCell<(this: object, ...args: A) => R>, original: (this: object, ...args: A) => R) {
  return function (this: object, ...args: A): R { return (cell.value ?? original).apply(this, args); };
}
function restoreAll(restores: (() => void)[]): void {
  for (const restore of restores.reverse()) {
    try { restore(); } catch { console.error("[beautify] Phase method locked; retaining inactive forwarder."); }
  }
}

/** Receives host-owned indicators through the public editor method; never reads editor internals. */
export function registerPhaseStatus(pi: ExtensionAPI): PhaseDecorator {
  const state = new PhaseState();
  let closed = false;
  let refresh: (() => void) | undefined;
  const notify = () => { if (!closed) refresh?.(); };
  const subscriptions: (() => void)[] = [];
  subscriptions.push(pi.on("session_start", () => { if (!closed) { state.reset(); compactCompleted = false; notify(); } }));
  subscriptions.push(pi.on("turn_start", event => { if (!closed) {
    if (compactCompleted) { compactCompleted = false; state.compactEnd(); }
    state.turn(`${event.turnIndex}:${event.timestamp}`); notify();
  } }));
  subscriptions.push(pi.on("message_update", event => { if (!closed) { state.update(event); notify(); } }));
  subscriptions.push(pi.on("message_end", event => { if (!closed) { state.messageEnd(event); notify(); } }));
  subscriptions.push(pi.on("tool_execution_start", event => { if (!closed) { state.toolStart(event.toolCallId, event.parentToolCallId); notify(); } }));
  subscriptions.push(pi.on("tool_execution_end", event => { if (!closed) { state.toolEnd(event.toolCallId, event.parentToolCallId); notify(); } }));
  subscriptions.push(pi.on("turn_end", () => { if (!closed) { state.turnEnd(); notify(); } }));
  subscriptions.push(pi.on("agent_end", () => { if (!closed) { state.end(); notify(); } }));
  subscriptions.push(pi.on("agent_settled", () => { if (!closed) { state.end(); notify(); } }));
  // Success is before the host clears its indicator. Preserve its presentation until that clear.
  let compactCompleted = false;
  subscriptions.push(pi.on("session_compact", () => { if (!closed) compactCompleted = true; }));
  subscriptions.push(pi.on("session_compact_failed", () => { if (!closed) { compactCompleted = false; state.compactEnd(); notify(); } }));
  subscriptions.push(pi.on("ui_prompt_start", event => { if (!closed) { state.prompt(event.kind, true); notify(); } }));
  subscriptions.push(pi.on("ui_prompt_end", event => { if (!closed) { state.prompt(event.kind, false); notify(); } }));
  subscriptions.push(pi.events.on("rpiv:ask-user:blocked", payload => { if (!closed) { state.question(payload); notify(); } }));
  let disposeEditor: (() => void) | undefined;
  pi.on("session_shutdown", () => {
    closed = true; refresh = undefined; state.reset();
    disposeEditor?.(); disposeEditor = undefined;
    for (const unsubscribe of subscriptions) unsubscribe();
  });
  return (editor, ctx, tui) => {
    if (closed || ctx.mode !== "tui" || typeof editor.setWorkingStatusIndicator !== "function") return () => {};
    disposeEditor?.();
    let live = true;
    let current: Indicator | undefined;
    let releaseIndicator = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    let staticIndicator: Indicator | undefined;
    let clearedStatic: WeakRef<Indicator> | undefined;
    const nativeSetter = editor.setWorkingStatusIndicator;
    const stopTimer = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
    const renderSnapshot = () => current?.kind === "compaction" ? state.snapshot()
      : current?.kind === "working" && state.snapshot()?.phase !== "Compacting" ? state.snapshot() : undefined;
    const sync = () => {
      if (!live || closed) return;
      const snapshot = renderSnapshot();
      const asking = snapshot?.phase === "Asking" && current && (current.kind === "working" || current.kind === "compaction");
      if (staticIndicator && staticIndicator !== (asking ? current : undefined)) {
        staticIndicator.setIndicator(); staticIndicator = undefined;
      }
      if (asking && current && staticIndicator !== current) { current.setIndicator({ frames: ["◇"] }); staticIndicator = current; }
      if (snapshot?.startedAt !== undefined) {
        if (timer === undefined) timer = setInterval(() => { if (live && !closed) tui.requestRender(); }, 1000);
      } else stopTimer();
      tui.requestRender();
    };
    let delivery = 0;
    const receive = function (this: CustomEditor, indicator: Indicator | undefined): void {
      if (!live || closed) { nativeSetter.call(this, indicator); return; }
      const received = ++delivery;
      // A synchronous editor handoff clears then redelivers the same object. Wait
      // until that transaction completes before treating success + clear as final.
      if (!indicator && compactCompleted) queueMicrotask(() => {
        if (live && !closed && delivery === received && !current && compactCompleted) {
          compactCompleted = false; state.compactEnd(); sync();
        }
      });
      // Undefined is also used for same-object redelivery during editor handoff.
      // Never restart a cleared/disposed object, only one actually redelivered by the host.
      if (staticIndicator) clearedStatic = new WeakRef(staticIndicator);
      staticIndicator = undefined;
      if (indicator) {
        if (clearedStatic?.deref() === indicator) indicator.setIndicator();
        clearedStatic = undefined;
      }
      releaseIndicator(); releaseIndicator = () => {};
      current = indicator;
      const restoreCells: MethodCell<(this: object, width: number) => string>[] = [];
      if (indicator && (indicator.kind === "working" || indicator.kind === "compaction")) {
        const border = indicator.renderInBorder;
        const spinner = indicator.renderSpinnerInBorder;
        const cancellation = indicator.kind === "compaction"
          ? stripVTControlCharacters(border.call(indicator, 1000)).match(/\([^)]*to cancel\)/)?.[0] : undefined;
        const display = (width: number, onlySpinner = false): string => {
          if (!live || closed) return onlySpinner ? spinner.call(indicator, width) : border.call(indicator, width);
          const snapshot = renderSnapshot();
          if (!snapshot) return "";
          const seconds = elapsedSeconds(snapshot, performance.now());
          const mark = snapshot.phase === "Asking" ? "◇" : stripVTControlCharacters(spinner.call(indicator, width));
          const styledMark = color(ctx.ui.theme, snapshot.phase, seconds, mark);
          if (onlySpinner) return truncateToWidth(styledMark, width, "");
          const label = `${mark} ${snapshot.phase}`;
          const tail = snapshot.phase === "Asking" ? "" : ` · ${seconds}s`;
          const hint = cancellation ? ` ${cancellation}` : "";
          if (visibleWidth(label + tail + hint) <= width) return `${styledMark} ${color(ctx.ui.theme, snapshot.phase, seconds, snapshot.phase)}${ctx.ui.theme.fg("dim", tail + hint)}`;
          if (visibleWidth(label + hint) <= width) return `${styledMark} ${color(ctx.ui.theme, snapshot.phase, seconds, snapshot.phase)}${ctx.ui.theme.fg("dim", hint)}`;
          if (visibleWidth(label) <= width) return `${styledMark} ${color(ctx.ui.theme, snapshot.phase, seconds, snapshot.phase)}`;
          return truncateToWidth(styledMark, width, "");
        };
        const restores: (() => void)[] = [];
        try {
          const borderCell = { value: (width: number) => display(width) };
          const spinnerCell = { value: (width: number) => display(width, true) };
          restoreCells.push(borderCell, spinnerCell);
          restores.push(interpose(indicator, "renderInBorder", { writable: true, value: forwardMethod(borderCell, border) }));
          restores.push(interpose(indicator, "renderSpinnerInBorder", { writable: true, value: forwardMethod(spinnerCell, spinner) }));
          releaseIndicator = () => { for (const cell of restoreCells) cell.value = undefined; restoreAll(restores); };
          if (indicator.kind === "compaction") state.compact();
        } catch {
          for (const cell of restoreCells) cell.value = undefined;
          restoreAll(restores);
          current = undefined;
          console.error("[beautify] Phase indicator unavailable; keeping native status.");
        }
      }
      nativeSetter.call(this, indicator);
      sync();
    };
    const receiverCell: MethodCell<(this: object, indicator: Indicator | undefined) => void> = {
      value: function (indicator) { receive.call(this as CustomEditor, indicator); },
    };
    const receiver = forwardMethod(receiverCell, nativeSetter);
    const restoreSetter = interpose(editor, "setWorkingStatusIndicator", { writable: true, value: receiver });
    refresh = sync;
    const dispose = () => {
      if (!live) return;
      live = false; stopTimer();
      // A received undefined retires staticIndicator. If it remains current, the host
      // has not cleared it; restore native animation even after reset-before-shutdown.
      if (staticIndicator && current === staticIndicator) staticIndicator.setIndicator();
      staticIndicator = undefined; clearedStatic = undefined;
      receiverCell.value = undefined;
      releaseIndicator(); releaseIndicator = () => {}; restoreAll([restoreSetter]); current = undefined;
      if (refresh === sync) refresh = undefined;
      if (disposeEditor === dispose) disposeEditor = undefined;
    };
    disposeEditor = dispose;
    return dispose;
  };
}
