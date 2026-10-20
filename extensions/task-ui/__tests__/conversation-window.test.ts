import assert from "node:assert/strict";
import { it } from "node:test";
import { ConversationWindow, HISTORY_MAX_BYTES } from "../conversation-window.ts";
import type { ConversationPage } from "../types.ts";
const page = (n: number, patch: Partial<ConversationPage> = {}): ConversationPage => ({
    entries: [{ id: String(n), kind: "user", text: String(n) }], before: `b${n}`, after: `a${n}`,
    hasOlder: true, hasNewer: true, source: "live", status: "ok", budgetLimited: false, scannedMessages: 1, scannedBytes: 1, generation: "g", ...patch,
});
it("resident pages slide in both directions with stable IDs and explicit generation/reset boundaries", () => {
    const window = new ConversationWindow();
    window.accept(page(5), "latest", true);
    for (const n of [4, 3, 2, 1]) window.accept(page(n), "before", false);
    assert.equal(window.pageCount, 3); assert.deepEqual(window.entries.map(e => e.id), ["1", "2", "3"]);
    window.accept(page(4), "after", false); assert.deepEqual(window.entries.map(e => e.id), ["2", "3", "4"]);
    window.accept(page(9), "latest", false); assert.deepEqual(window.entries.map(e => e.id), ["2", "3", "4"]);
    window.accept(page(9, { generation: "changed" }), "before", false);
    assert.equal(window.blocked, true); assert.match(window.hint!, /History changed/);
    assert.deepEqual(window.entries.map(e => e.id), ["2", "3", "4"]);
    window.clear(); window.accept(page(9, { generation: "changed" }), "latest", true);
    assert.deepEqual(window.entries.map(e => e.id), ["9"]); assert.equal(window.blocked, false);
    window.accept(page(10, { status: "unavailable", hint: "Cannot read artifact" }), "after", false);
    assert.match(window.hint!, /Cannot read artifact/); assert.equal(window.entries.length, 1);
});
it("entry/byte bounds, overlapping IDs, source budget hints and empty pages stay bounded", () => {
    const window = new ConversationWindow(); window.accept(page(1), "latest", true);
    window.accept(page(1), "after", false); assert.equal(window.entries.length, 1);
    window.accept(page(2, { entries: [], budgetLimited: true }), "before", false);
    assert.match(window.hint!, /source budget/);
    window.accept(page(3, { entries: [{ id: "huge", kind: "user", text: "x".repeat(HISTORY_MAX_BYTES + 1) }] }), "before", false);
    assert.equal(window.blocked, true); assert.equal(window.entries.length, 1);
    window.clear();
    const entries = (n: number) => Array.from({ length: 100 }, (_, i) => ({ id: `${n}:${i}`, kind: "user" as const, text: "x" }));
    for (const n of [1, 2, 3, 4]) window.accept(page(n, { entries: entries(n) }), n === 1 ? "latest" : "after", n === 1);
    assert.ok(window.entries.length <= 256); assert.equal(window.pageCount, 2);
});
it("ordinary latest refreshes neither accumulate nor duplicate stable synthetic outcome IDs", () => {
    const window = new ConversationWindow();
    const outcome = { id: "outcome:run", kind: "assistant" as const, text: "final", tools: [] };
    for (let n = 0; n < 50; n++) {
        window.accept(page(n, { entries: [...page(n).entries, outcome], hasNewer: false }), "latest", true);
        assert.equal(window.pageCount, 1); assert.equal(window.entries.filter(e => e.id === outcome.id).length, 1);
    }
    window.accept(page(48, { entries: [outcome] }), "before", false);
    assert.equal(window.entries.filter(e => e.id === outcome.id).length, 1);
});
it("historical latest append is detected even when a stable terminal annotation remains last", () => {
    const window = new ConversationWindow();
    const outcome = { id: "outcome", kind: "assistant" as const, text: "final", tools: [] };
    window.accept(page(1, { entries: [...page(1).entries, outcome], hasNewer: false }), "latest", true);
    window.accept(page(2, { entries: [...page(1).entries, ...page(2).entries, outcome], hasNewer: false }), "latest", false);
    assert.equal(window.last?.hasNewer, true);
    assert.deepEqual(window.entries.map(entry => entry.id), ["1", "outcome"]);
});

it("historical stale tail stays non-followable after a latest append without replacing its pages", () => {
    const window = new ConversationWindow();
    window.accept(page(1, { hasNewer: false }), "latest", true);
    window.accept(page(2, { hasNewer: false }), "latest", false);
    assert.equal(window.last?.hasNewer, true); assert.deepEqual(window.entries.map(e => e.id), ["1"]);
});
