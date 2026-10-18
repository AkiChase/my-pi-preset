import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import type { ExtensionAPI, MessageEndEvent, MessageUpdateEvent } from "@earendil-works/pi-coding-agent";
import { PhaseState, elapsedSeconds, phaseEnhancement } from "../editor/phase-state.ts";
import { registerPhaseStatus } from "../editor/phase-status.ts";
import { registerAppearance } from "../editor/owner.ts";
import { cleanup, makeHost, StatusIndicator, tuiSdk, themeSdk } from "./harness.mjs";
after(cleanup);
const message = (content: unknown[] = []) => ({ role: "assistant", content, stopReason: "stop" });
const end = (content: unknown[] = []) => ({ type: "message_end", message: message(content) }) as MessageEndEvent;
const update = (delta: string, type = "text_delta") => ({ type: "message_update", message: message([{ type: "text", text: delta }]), assistantMessageEvent: { type, delta } }) as MessageUpdateEvent;

test("pure main phases, nonempty evidence, expected serial batch and nested isolation", () => {
  let time = 100; const state = new PhaseState(() => time);
  state.turn(); assert.deepEqual(state.snapshot(), { phase: "Loading", startedAt: 100 });
  time = 200; state.update(update("")); assert.equal(state.snapshot()?.phase, "Loading");
  state.update(update("reason", "thinking_delta")); assert.deepEqual(state.snapshot(), { phase: "Brewing", startedAt: 200 });
  time = 300; state.update(update("more")); assert.equal(state.snapshot()?.startedAt, 200);
  state.messageEnd(end([{ type: "toolCall", id: "a", name: "one", arguments: {} }, { type: "toolCall", id: "b", name: "two", arguments: {} }]));
  assert.equal(state.snapshot(), undefined);
  state.toolStart("a"); state.toolStart("a/1", "a"); state.toolEnd("a/1", "a");
  time = 400; state.toolEnd("a"); assert.equal(state.snapshot()?.phase, "Tooling");
  state.toolStart("b"); assert.equal(state.snapshot()?.startedAt, 300);
  state.toolEnd("b"); assert.equal(state.snapshot(), undefined);
  state.turn(); assert.equal(state.snapshot()?.phase, "Loading"); state.messageEnd(end()); assert.equal(state.snapshot(), undefined);
  state.end(); state.update(update("late")); state.toolStart("late"); assert.equal(state.snapshot(), undefined);
});
test("question identities, anonymous fallback, latest facts and independent compaction time", () => {
  let time = 0; const state = new PhaseState(() => time); state.turn();
  state.prompt("custom", true); assert.equal(state.snapshot()?.phase, "Loading");
  state.question({ active: true, toolCallId: "q" }); state.question({ active: true, toolCallId: "q" });
  state.question({ active: true, toolCallId: "other" }); assert.deepEqual(state.snapshot(), { phase: "Asking" });
  state.question({ active: false, toolCallId: "q" }); assert.equal(state.snapshot()?.phase, "Asking");
  state.question({ active: false, toolCallId: "other" }); assert.equal(state.snapshot()?.phase, "Loading");
  time = 10; state.compact(); state.end(); state.update(update("nested summary"));
  time = 20; state.compact(); assert.deepEqual(state.snapshot(), { phase: "Compacting", startedAt: 10 });
  state.prompt("confirm", true); assert.equal(state.snapshot()?.phase, "Asking");
  state.prompt("confirm", false); assert.equal(state.snapshot()?.startedAt, 10);
  state.compactEnd(); assert.equal(state.snapshot(), undefined);
  state.question(null); state.question({ active: "yes" }); state.question({ active: false });
  state.reset(); assert.equal(state.snapshot(), undefined);
  assert.equal(elapsedSeconds({ phase: "Loading", startedAt: 1000 }, 0), 0);
  assert.deepEqual([0, 10, 20, 30, 999].map(phaseEnhancement), [0, 0, 0.5, 1, 1]);
});
function fixture(name: string) {
  const h = makeHost(name) as ReturnType<typeof makeHost> & { host: {
    showWorkingStatusIndicator(): void;
    setEditorWorkingStatusIndicator(indicator: InstanceType<typeof StatusIndicator> | undefined): boolean;
    showStatusIndicator(indicator: InstanceType<typeof StatusIndicator>): void;
    clearStatusIndicator(): void;
  } };
  const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
  const original = h.pi.on;
  h.pi.on = (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
    const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list);
    return original(name, handler);
  };
  const phase = registerPhaseStatus(h.pi as unknown as ExtensionAPI);
  registerAppearance(h.pi as unknown as ExtensionAPI, phase);
  return { ...h, h, async emit(name: string, event: object = {}) { for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, h.ctx); },
    row(width = 80) { return plain(h.editor.render(width)[0]!); } };
}
test("actual public receiver preserves spinner continuity, static Asking and native editor", async () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] }); const f = fixture("phase-real"); const h = f.h; const editor = h.editor;
  let renders = 0; h.tui.requestRender = () => { renders++; };
  try {
    await f.emit("session_start"); assert.equal(h.editor, editor);
    await f.emit("turn_start"); h.host.showWorkingStatusIndicator(); assert.match(f.row(), /⠋ Loading · 0s/);
    mock.timers.tick(80); assert.match(f.row(), /⠙ Loading/);
    await f.emit("message_update", update("hello")); mock.timers.tick(80); assert.match(f.row(), /⠹ Brewing/);
    h.pi.events.emit("rpiv:ask-user:blocked", { active: true, toolCallId: "q" }); assert.match(f.row(), /◇ Asking/);
    const before = renders; mock.timers.tick(800); assert.equal(renders, before); assert.doesNotMatch(f.row(), /\d+s/);
    h.pi.events.emit("rpiv:ask-user:blocked", { active: false, toolCallId: "q" }); mock.timers.tick(80); assert.match(f.row(), /⠙ Brewing/);
    await f.emit("message_end", end()); assert.doesNotMatch(f.row(), /Loading|Brewing/);
    await f.emit("agent_end"); h.host.clearStatusIndicator(); const stopped = renders; mock.timers.tick(5000); assert.equal(renders, stopped);
    editor.setText("draft"); editor.insertTextAtCursor("!"); editor.handleInput("\x1f"); assert.equal(editor.getText(), "draft");
  } finally { await f.emit("session_shutdown"); h.dispose(); mock.timers.reset(); }
});
test("compaction delivery, retry replacement, success-before-clear, failure, widths and themes", async () => {
  mock.timers.enable({ apis: ["setInterval"] }); const f = fixture("phase-compact"); const h = f.h;
  const indicator = (kind: "compaction" | "retry" | "branchSummary", label: string) => new StatusIndicator(kind, h.tui, (s: string) => s, (s: string) => s, label);
  try {
    await f.emit("session_start");
    h.host.showStatusIndicator(indicator("compaction", "Compacting context... (escape to cancel)"));
    assert.match(f.row(120), /Compacting · 0s.*escape to cancel/);
    const native = h.host.activeStatusIndicator!;
    for (const theme of ["dark", "light"]) {
      themeSdk.initTheme(theme, false);
      for (const width of [0, 1, 2, 8, 10, 20, 120]) for (const render of [native.renderInBorder, native.renderSpinnerInBorder]) assert.ok(tuiSdk.visibleWidth(render.call(native, width)) <= width);
    }
    h.host.showStatusIndicator(indicator("retry", "Retrying (escape to cancel)")); assert.match(f.row(), /Retrying/);
    h.host.showStatusIndicator(indicator("compaction", "Auto-compacting... (escape to cancel)")); assert.match(f.row(), /Compacting/);
    await f.emit("session_compact"); assert.match(f.row(), /Compacting/); h.host.clearStatusIndicator(); assert.doesNotMatch(f.row(), /Compacting/);
    await f.emit("turn_start"); h.host.showWorkingStatusIndicator(); assert.match(f.row(), /Loading/);
    h.host.showStatusIndicator(indicator("compaction", "Compacting context... (escape to cancel)")); h.host.clearStatusIndicator();
    await f.emit("session_compact_failed"); await f.emit("agent_end"); assert.doesNotMatch(f.row(), /Compacting|Loading/);
    h.host.showStatusIndicator(indicator("branchSummary", "Summarizing branch")); assert.match(f.row(), /Summarizing branch/);
  } finally { await f.emit("session_shutdown"); h.dispose(); mock.timers.reset(); themeSdk.initTheme("dark", false); }
});
test("reload reset, late events, later setter wrapper and unsupported indicator fail closed", async () => {
  const f = fixture("phase-cleanup"); const h = f.h;
  try {
    await f.emit("session_start"); await f.emit("turn_start"); h.host.showWorkingStatusIndicator();
    const setter = h.editor.setWorkingStatusIndicator;
    const later = function (this: typeof h.editor, value: Parameters<typeof setter>[0]) { setter.call(this, value); }; h.editor.setWorkingStatusIndicator = later;
    h.resetExtensionUI(); await f.emit("session_shutdown");
    assert.equal(h.editor.setWorkingStatusIndicator, later);
    await f.emit("message_update", update("late")); h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
    assert.doesNotMatch(f.row(), /Asking|Loading|Brewing/);
  } finally { h.dispose(); }
});

test("turn identity is idempotent but a new Loading turn resets elapsed time", () => {
  let time = 0; const state = new PhaseState(() => time);
  state.turn("0:100"); time = 5000; state.turn("0:100");
  assert.equal(state.snapshot()?.startedAt, 0);
  state.turn("1:200"); assert.equal(state.snapshot()?.startedAt, 5000);
});
test("actual initial active indicator, elapsed time, retry and cancelled switch", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  let time = 1000; const clock = mock.method(performance, "now", () => time);
  const f = fixture("phase-elapsed"), h = f.h;
  try {
    h.host.showStatusIndicator(new StatusIndicator("compaction", h.tui, (s: string) => s, (s: string) => s, "Compacting context (escape to cancel)"));
    await f.emit("session_start"); assert.match(f.row(120), /Compacting · 0s/);
    time += 17000; assert.match(f.row(120), /Compacting · 17s/);
    await f.emit("session_before_switch", { reason: "new" }); assert.match(f.row(120), /Compacting · 17s/);
    h.host.showStatusIndicator(new StatusIndicator("retry", h.tui, (s: string) => s, (s: string) => s, "Retrying"));
    time += 5000;
    h.host.showStatusIndicator(new StatusIndicator("compaction", h.tui, (s: string) => s, (s: string) => s, "Compacting (escape to cancel)"));
    assert.match(f.row(120), /Compacting · 22s/);
    await f.emit("session_compact");
    const active = h.host.activeStatusIndicator!;
    h.host.setEditorWorkingStatusIndicator(active); // Actual host clear/set redelivery, without disposal.
    await Promise.resolve(); assert.match(f.row(120), /Compacting · 22s/);
    h.host.clearStatusIndicator(); await Promise.resolve();
    await f.emit("turn_start", { turnIndex: 0, timestamp: 1 }); h.host.showWorkingStatusIndicator(); assert.match(f.row(), /Loading · 0s/);
  } finally { await f.emit("session_shutdown"); h.dispose(); clock.mock.restore(); mock.timers.reset(); }
});
test("Asking compaction reset-before-shutdown restores native animation without reviving disposed loaders", async () => {
  mock.timers.enable({ apis: ["setInterval"] }); const f = fixture("phase-static-reset"), h = f.h;
  let renders = 0; h.tui.requestRender = () => { renders++; };
  try {
    await f.emit("session_start");
    h.host.showStatusIndicator(new StatusIndicator("compaction", h.tui, (s: string) => s, (s: string) => s, "Compacting context (escape to cancel)"));
    h.pi.events.emit("rpiv:ask-user:blocked", { active: true, toolCallId: "q" }); assert.match(f.row(), /◇ Asking/);
    h.resetExtensionUI(); await f.emit("session_shutdown");
    const before = renders; mock.timers.tick(80); assert.ok(renders > before); assert.doesNotMatch(f.row(), /Asking/);
    h.host.clearStatusIndicator(); const afterClear = renders; mock.timers.tick(5000); assert.equal(renders, afterClear);
  } finally { await f.emit("session_shutdown"); h.dispose(); mock.timers.reset(); }
});
test("unsupported indicator decoration rolls back and locked later delegates remain native after retirement", async () => {
  mock.timers.enable({ apis: ["setInterval"] }); const f = fixture("phase-partial"), h = f.h;
  try {
    await f.emit("session_start"); await f.emit("turn_start");
    const bad = new StatusIndicator("compaction", h.tui, (s: string) => s, (s: string) => s, "Native compact");
    const border = bad.renderInBorder;
    Object.defineProperty(bad, "renderSpinnerInBorder", { value: bad.renderSpinnerInBorder, configurable: false });
    h.host.showStatusIndicator(bad); assert.equal(bad.renderInBorder, border); assert.match(f.row(), /Native compact/);
    h.host.clearStatusIndicator(); await f.emit("session_compact_failed");
    h.host.showWorkingStatusIndicator(); const active = h.host.activeStatusIndicator!;
    const captured = active.renderInBorder;
    const later = (width: number) => captured.call(active, width);
    Object.defineProperty(active, "renderInBorder", { value: later, configurable: false });
    const setter = h.editor.setWorkingStatusIndicator;
    const laterSetter = function (this: typeof h.editor, value: Parameters<typeof setter>[0]) { setter.call(this, value); };
    Object.defineProperty(h.editor, "setWorkingStatusIndicator", { value: laterSetter, configurable: false });
    await f.emit("session_shutdown"); assert.equal(active.renderInBorder, later); assert.match(plain(later(80)), /Working/);
    await f.emit("message_update", update("late")); assert.doesNotMatch(plain(later(80)), /Brewing/);
  } finally { await f.emit("session_shutdown"); h.dispose(); mock.timers.reset(); }
});
