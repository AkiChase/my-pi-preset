import assert from "node:assert/strict";
import { it } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager } from "../../beautify/__tests__/renderer-host.mjs";
import { TaskPanel } from "../panel.ts";
import { TaskCoordinator } from "../coordinator.ts";
import { DEFAULTS } from "../config.ts";
import { loadNativeLayout } from "../../shared/scroll-panel/native-layout.ts";
import { taskKey, type PendingMessage, type TaskSource, type TaskView } from "../types.ts";
const layout = await loadNativeLayout();

it("pending region has independent focus/anchors, overlay containment, readonly full text and manual failed restoration", () => {
    const identity = { sourceId: "queue", taskId: "agent", runId: "1" };
    let entries: PendingMessage[] = Array.from({ length: 8 }, (_, i) => ({ id: String(i), text: `queued-${i}`, state: "pending" }));
    entries[0] = { id: "0", state: "pending", text: "FIRST\n" + "中文😀".repeat(150) + "\nFULL_END\u001b]0;unsafe\u0007" };
    let row: TaskView = { ...identity, key: taskKey(identity), title: "agent", kind: "agent", status: "running", executionMode: "background",
        stats: { pendingMessages: { entries, omitted: 0 } }, capabilities: { stop: true, details: true, steer: true }, waitCount: 0, artifacts: [] };
    const listeners = new Set<() => void>();
    let accepted = false;
    const sends: [string, string | undefined][] = [];
    const source: TaskSource = { sourceId: "queue", revision: 0, list: () => [row], detail: () => ({ text: Array.from({ length: 60 }, (_, n) => `CONVERSATION-${n}`).join("\n") }),
        stop: () => true, steer: (_id, text, replacement) => { sends.push([text, replacement]); return accepted; },
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, dispose() {} };
    const coordinator = new TaskCoordinator(); coordinator.registerSource(source);
    const terminal = { columns: 80, rows: 24 };
    const colors: string[] = [];
    const panel = new TaskPanel({ coordinator, layout, config: DEFAULTS, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (color, text) => { if (/Conversation|Output|Pending/.test(text)) colors.push(`${color}:${text}`); return text; } },
        keys: { matches: () => false }, tui: { terminal, requestRender() {} } as never, done() {} });
    const plain = () => panel.render(terminal.columns).map(stripTerminalSequences);
    const publish = () => { row = { ...row, stats: { pendingMessages: { entries, omitted: 0 } } }; for (const listener of listeners) listener(); };
    const click = (y: number) => panel.handleMouse({ type: "click", button: "left", x: 1, y } as never);
    try {
        panel.handleInput("\r");
        let lines = plain(); assert.equal(lines.filter(line => /queued-[0-9]/.test(line)).length, 3);
        const conversationTop = panel.getState().detailScrollTop;
        panel.handleInput("\t"); panel.handleInput("\u001b[H"); lines = plain();
        assert.equal(panel.getState().pendingFocus, true); assert.equal(panel.getState().pendingScrollTop, 0);
        assert.equal(panel.getState().detailScrollTop, conversationTop);
        assert.ok(colors.some(color => color.startsWith("accent:Pending"))); assert.ok(colors.some(color => color.startsWith("muted:Conversation")) || colors.some(color => color.startsWith("muted:Output")));
        entries.push({ id: "8", text: "queued-8", state: "pending" }); publish(); plain(); assert.equal(panel.getState().pendingScrollTop, 0);
        click(lines.findIndex(line => /FIRST/.test(line))); lines = plain();
        assert.match(lines.join("\n"), /Pending · Esc Back/);
        const before = panel.getState();
        panel.handleInput("x"); panel.handleInput("\r"); panel.handleInput("\t"); assert.equal(sends.length, 0);
        panel.handleInput("\u001b[F"); lines = plain(); assert.match(lines.join("\n"), /FULL_END/); assert.doesNotMatch(lines.join("\n"), /unsafe\u0007/);
        assert.deepEqual(panel.handleMouse({ type: "wheel", x: 1, y: 0, wheelDelta: 10 } as never), { handled: true });
        assert.equal(panel.getState().detailScrollTop, before.detailScrollTop);
        panel.handleInput("\u001b"); assert.equal(panel.getState().page, "detail");
        entries = entries.slice(1); publish(); lines = plain(); assert.equal(panel.getState().pendingScrollTop, 0); assert.match(lines.join("\n"), /queued-1/);
        panel.handleInput("\u001b[F"); plain(); assert.equal(panel.getState().pendingFollowingEnd, true);
        entries.push({ id: "failed", text: "  ORIGINAL_FAILURE  ", state: "failed", error: "refused", restorable: true }); publish(); lines = plain();
        click(lines.findIndex(line => /Failed · ORIGINAL_FAILURE/.test(line))); assert.match(plain().join("\n"), /›   ORIGINAL_FAILURE/);
        const top = panel.getState().pendingScrollTop;
        panel.handleMouse({ type: "wheel", x: 1, y: 12, wheelDelta: -100 } as never); assert.equal(panel.getState().pendingScrollTop, top);
        panel.handleInput("\r"); assert.deepEqual(sends[0], ["  ORIGINAL_FAILURE  ", "failed"]); assert.match(plain().join("\n"), /›   ORIGINAL_FAILURE/, "refusal retains composer and failed original");
        accepted = true; panel.handleInput("\r"); assert.doesNotMatch(plain().join("\n"), /›   ORIGINAL_FAILURE/);
        assert.ok(entries.some(item => item.id === "failed"), "restoring alone never withdraws failed record");
        terminal.rows = 9; lines = plain(); assert.equal(lines.filter(line => /queued-|Failed ·/.test(line)).length, 1);
        for (const width of [1, 12, 40, 80]) { terminal.columns = width; assert.ok(panel.render(width).every(line => visibleWidth(line) === width)); }
        entries = []; publish(); terminal.columns = 80; assert.doesNotMatch(plain().join("\n"), /Pending [0-9]/); assert.equal(panel.getState().pendingFocus, false);
    } finally { panel.dispose(); coordinator.dispose(); }
});

it("card clicks and global tools key preserve queue focus, arrivals and exclusive input ownership", () => {
    const identity = { sourceId: "expansion", taskId: "agent", runId: "1" };
    const row: TaskView = { ...identity, key: taskKey(identity), title: "agent", kind: "agent", status: "running", executionMode: "background", waitCount: 0, artifacts: [],
        stats: { pendingMessages: { entries: [{ id: "pending", text: "keep queued", state: "pending" }], omitted: 0 } }, capabilities: { stop: true, details: true, steer: true } };
    const makeTool = (id: string): import("../types.ts").ConversationEntry => ({ id, kind: "toolResult", name: "read", text: `BODY-${id}`, elided: 0 });
    let entries = [makeTool("first"), makeTool("second")];
    const listeners = new Set<() => void>();
    let revision = 0, sends = 0;
    const source: TaskSource = { sourceId: identity.sourceId, get revision() { return revision; }, list: () => [row], detail: () => ({ text: "", conversation: entries }),
        stop: () => true, steer: () => { sends++; return true; }, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, dispose() {} };
    const coordinator = new TaskCoordinator(); coordinator.registerSource(source);
    const terminal = { columns: 80, rows: 24 };
    const panel = new TaskPanel({ coordinator, layout, config: DEFAULTS, ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
        theme: { fg: (_color, text) => text }, keys: new KeybindingsManager(), tui: { terminal, requestRender() {} } as never, done() {} });
    const text = () => stripTerminalSequences(panel.render(terminal.columns).join("\n"));
    const expandState = () => (panel as unknown as { toolsExpanded: boolean }).toolsExpanded;
    try {
        panel.handleInput("\r"); panel.handleInput("\t");
        const before = panel.getState();
        assert.doesNotMatch(text(), /BODY-first|View parameters|click to/);
        panel.handleInput("\x0f"); assert.match(text(), /BODY-first/); assert.match(text(), /BODY-second/);
        assert.equal(panel.getState().pendingFocus, before.pendingFocus); assert.equal(panel.getState().pendingScrollTop, before.pendingScrollTop);
        entries.push(makeTool("arrival")); revision++; for (const listener of listeners) listener();
        assert.match(text(), /BODY-arrival/);
        const lines = panel.render(80).map(stripTerminalSequences);
        const y = lines.findIndex(line => /BODY-second/.test(line)); assert.ok(y >= 0);
        assert.deepEqual(panel.handleMouse({ type: "click", button: "left", x: 1, y } as never), { handled: true });
        assert.doesNotMatch(text(), /BODY-second/); assert.match(text(), /BODY-first/);
        panel.handleInput("\x0f"); assert.equal(expandState(), false); assert.doesNotMatch(text(), /BODY-/);
        const pendingY = panel.render(80).map(stripTerminalSequences).findIndex(line => /keep queued/.test(line));
        panel.handleMouse({ type: "click", button: "left", x: 1, y: pendingY } as never);
        assert.match(text(), /Pending · Esc Back/);
        panel.handleInput("\x0f"); assert.equal(expandState(), false); assert.equal(sends, 0);
        panel.handleInput("\x1b"); panel.handleInput("\r");
        panel.handleInput("\x0f"); assert.equal(expandState(), false); assert.equal(sends, 0);
        panel.handleInput("\x1b"); panel.handleInput("\x0f"); assert.equal(expandState(), true);
        for (const width of [1, 12, 40, 80]) { terminal.columns = width; assert.ok(panel.render(width).every(line => visibleWidth(line) === width)); }
        terminal.columns = 80;
        panel.handleInput("\x1b"); panel.handleInput("\r"); assert.equal(expandState(), true, "same detail retains global mode");
    } finally { panel.dispose(); coordinator.dispose(); }
});
