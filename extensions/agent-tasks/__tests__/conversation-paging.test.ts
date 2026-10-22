import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import "./source-loader.mjs";
const { ConversationPager, MAX_SCAN_BYTES, MAX_SCAN_MESSAGES } = await import("../src/conversation-paging.ts");
const user = (text: string) => ({ role: "user", content: text });
const jsonl = (messages: unknown[]) => messages.map(message => JSON.stringify({ message })).join("\n") + "\n";

void it("adapts latest sampling, skips hidden messages and progresses through strict scan budgets", () => {
    const pager = new ConversationPager(), owner = {};
    const messages = Array.from({ length: 400 }, (_, i) => i % 4 === 0 ? user(`m${i}`) : { role: "system", content: "hidden" });
    const page = pager.livePage("a", owner, messages, 0);
    assert.equal(page.entries.length, 64); assert.equal(page.scannedMessages, 256);
    assert.ok(page.hasOlder); assert.equal(page.hasNewer, false);
    const hidden = [...Array.from({ length: 2000 }, () => ({ role: "custom", content: "secret" }))];
    const first = pager.livePage("b", owner, hidden, 0);
    assert.equal(first.entries.length, 0); assert.equal(first.scannedMessages, MAX_SCAN_MESSAGES);
    assert.equal(first.budgetLimited, true); assert.equal(first.hasOlder, true);
    const older = pager.livePage("b", owner, hidden, 0, { direction: "before", cursor: first.before });
    assert.equal(older.hasOlder, false); assert.notEqual(older.before, first.before);
    pager.dispose();
    assert.equal(pager.livePage("a", owner, messages, 0, { direction: "before", cursor: page.before }).status, "reset");
});

void it("duplicate texts have distinct stable IDs across append and normal projection arrays; compaction resets", () => {
    const pager = new ConversationPager(), owner = {};
    let messages = Array.from({ length: 150 }, () => user("same"));
    const latest = pager.livePage("a", owner, messages, 0);
    assert.equal(new Set(latest.entries.map(e => e.id)).size, 64);
    messages = [...messages, user("new")];
    const older = pager.livePage("a", owner, messages, 0, { direction: "before", cursor: latest.before });
    assert.equal(older.status, "ok"); assert.equal(older.entries.length, 64);
    const newer = pager.livePage("a", owner, messages, 0, { direction: "after", cursor: older.after });
    assert.deepEqual(newer.entries.map(e => e.id), latest.entries.map(e => e.id));
    assert.equal(newer.hasNewer, true);
    assert.equal(pager.livePage("other", owner, messages, 0, { direction: "before", cursor: latest.before }).status, "reset");
    assert.equal(pager.livePage("a", owner, messages.slice(-50), 1, { direction: "before", cursor: latest.before }).status, "reset");
});

void it("tool association carries bounded read/write/edit/bash summaries, retains bounded parameters but excludes unaudited details", () => {
    const pager = new ConversationPager(), owner = {};
    const names = ["read", "write", "edit", "bash"];
    const call = { role: "assistant", content: names.map((name, i) => ({ type: "toolCall", id: `t${i}`, name, arguments: {
        path: "file.ts", offset: 2, limit: 4, content: "中文\nx", command: "echo ok", edits: [{ oldText: "a", newText: "b\nc" }], private: "SECRET_ARGS",
    } })) };
    const results = names.map((toolName, i) => ({ role: "toolResult", toolCallId: `t${i}`, toolName, content: "ok", details: { private: "SECRET_DETAILS" } }));
    const messages = [call, ...results];
    const calls = pager.livePage("a", owner, messages.slice(0, 1), 0);
    const page = pager.livePage("a", owner, messages, 0, { direction: "after", cursor: calls.after });
    assert.deepEqual(page.entries.map(e => e.kind === "toolResult" ? e.summary?.kind : undefined), names);
    assert.match(JSON.stringify(page), /SECRET_ARGS|oldText|newText/);
    assert.doesNotMatch(JSON.stringify(page), /SECRET_DETAILS/);
    const write = page.entries[1]; assert.ok(write?.kind === "toolResult");
    assert.equal(write.summary?.lines, 2); assert.equal(write.summary?.bytes, 8);
    const edit = page.entries[2]; assert.ok(edit?.kind === "toolResult");
    assert.equal(edit.summary?.addedLines, 2); assert.equal(edit.summary?.removedLines, 1);
});

void it("JSONL pages round-trip stable byte IDs, append safely, and reject replaced files", () => {
    const dir = mkdtempSync(join(tmpdir(), "paging-"));
    try {
        const path = join(dir, "a.output"), pager = new ConversationPager();
        writeFileSync(path, jsonl(Array.from({ length: 180 }, (_, i) => user(`中文${i}`))));
        const latest = pager.transcriptPage("a", path);
        assert.equal(latest.entries.length, 64); assert.equal(latest.hasOlder, true);
        const older = pager.transcriptPage("a", path, { direction: "before", cursor: latest.before });
        assert.equal(older.entries.length, 64);
        const newer = pager.transcriptPage("a", path, { direction: "after", cursor: older.after });
        assert.deepEqual(newer.entries.map(e => e.id), latest.entries.map(e => e.id));
        appendFileSync(path, jsonl([user("new")]));
        assert.equal(pager.transcriptPage("a", path, { direction: "after", cursor: latest.after }).entries.length, 1);
        renameSync(path, path + ".old"); writeFileSync(path, jsonl([user("replacement")]));
        assert.equal(pager.transcriptPage("a", path, { direction: "before", cursor: latest.before }).status, "reset");
        assert.equal(pager.transcriptPage("a", path + ".missing").status, "unavailable");
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

void it("oversize and partial JSONL lines make bounded progress in both directions", () => {
    const dir = mkdtempSync(join(tmpdir(), "paging-large-"));
    try {
        const path = join(dir, "a.output"), pager = new ConversationPager();
        writeFileSync(path, jsonl([user("old")]) + jsonl([user("x".repeat(MAX_SCAN_BYTES * 3))]) + jsonl([user("new")]) + '{"partial":');
        let page = pager.transcriptPage("a", path);
        assert.ok(page.entries.some(e => e.kind === "user" && e.text === "new"));
        for (let i = 0; page.hasOlder && i < 10; i++) {
            assert.ok(page.scannedBytes <= MAX_SCAN_BYTES);
            page = pager.transcriptPage("a", path, { direction: "before", cursor: page.before });
        }
        assert.equal(page.hasOlder, false); assert.ok(page.entries.some(e => e.kind === "user" && e.text === "old"));
        let forward = pager.transcriptPage("a", path, { direction: "after", cursor: page.after });
        for (let i = 0; forward.hasNewer && i < 10; i++) {
            assert.ok(forward.scannedBytes <= MAX_SCAN_BYTES);
            forward = pager.transcriptPage("a", path, { direction: "after", cursor: forward.after });
        }
        assert.equal(forward.hasNewer, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

void it("disk tool results associate across separately loaded pages with bounded parameters for the separate reader", () => {
    const dir = mkdtempSync(join(tmpdir(), "paging-tools-"));
    try {
        const path = join(dir, "a.output"), pager = new ConversationPager();
        writeFileSync(path, jsonl([
            { role: "assistant", content: [{ type: "toolCall", id: "write1", name: "write", arguments: { path: "a.ts", content: "PRIVATE_BODY" } }] },
            ...Array.from({ length: 130 }, (_, i) => user(`m${i}`)),
            { role: "toolResult", toolName: "write", toolCallId: "write1", content: "success" },
        ]));
        const latest = pager.transcriptPage("a", path);
        const older = pager.transcriptPage("a", path, { direction: "before", cursor: latest.before });
        const oldest = pager.transcriptPage("a", path, { direction: "before", cursor: older.before });
        assert.equal(oldest.hasOlder, false);
        const refreshed = pager.transcriptPage("a", path);
        const result = refreshed.entries.at(-1); assert.ok(result?.kind === "toolResult");
        assert.equal(result.summary?.path, "a.ts"); assert.equal(result.summary?.bytes, 12);
        assert.match(JSON.stringify(refreshed), /PRIVATE_BODY/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

void it("cursor registry expires at a finite capacity without retaining session/message objects", () => {
    const pager = new ConversationPager(), owner = {}, messages = [user("a"), user("b")];
    const first = pager.livePage("a", owner, messages, 0);
    for (let i = 0; i < 1030; i++) pager.livePage("a", owner, messages, 0);
    assert.equal(pager.livePage("a", owner, messages, 0, { direction: "before", cursor: first.before }).status, "reset");
    pager.dispose();
});

void it("completed partial transcript tails remain readable from existing after cursors", () => {
    const dir = mkdtempSync(join(tmpdir(), "paging-partial-"));
    try {
        const path = join(dir, "a.output"), pager = new ConversationPager();
        writeFileSync(path, jsonl([user("old")]) + JSON.stringify({ message: user("partial") }));
        const latest = pager.transcriptPage("a", path);
        appendFileSync(path, "\n");
        const appended = pager.transcriptPage("a", path, { direction: "after", cursor: latest.after });
        assert.deepEqual(appended.entries.map(e => e.kind === "user" ? e.text : ""), ["partial"]);
        appendFileSync(path, JSON.stringify({ message: user("next") }));
        const pending = pager.transcriptPage("a", path, { direction: "after", cursor: appended.after });
        assert.equal(pending.entries.length, 0);
        appendFileSync(path, "\n");
        assert.deepEqual(pager.transcriptPage("a", path, { direction: "after", cursor: pending.after }).entries.map(e => e.kind === "user" ? e.text : ""), ["next"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

void it("both paging directions cover each visible entry exactly once under message and byte budgets", () => {
    const pager = new ConversationPager(), owner = {};
    const messages = Array.from({ length: 1400 }, (_, i) => i % 7 === 0 ? user(`v${i}`) : { role: "custom", content: "hidden" });
    const expected = messages.filter(m => m.role === "user").map(m => m.content);
    let page = pager.livePage("a", owner, messages, 0, { limit: 11 });
    const backwards = [...page.entries];
    for (let i = 0; page.hasOlder && i < 200; i++) {
        page = pager.livePage("a", owner, messages, 0, { direction: "before", cursor: page.before, limit: 11 });
        backwards.unshift(...page.entries);
    }
    assert.equal(page.hasOlder, false);
    assert.deepEqual(backwards.map(e => e.kind === "user" ? e.text : ""), expected);
    const forwards = [...page.entries];
    for (let i = 0; page.hasNewer && i < 200; i++) {
        page = pager.livePage("a", owner, messages, 0, { direction: "after", cursor: page.after, limit: 11 });
        forwards.push(...page.entries);
    }
    assert.equal(page.hasNewer, false);
    assert.deepEqual(forwards.map(e => e.kind === "user" ? e.text : ""), expected);
    assert.equal(new Set(forwards.map(e => e.id)).size, forwards.length);
});

void it("conversion marks uninspected blocks without reading them or inventing a total elision count", async () => {
    const { entryFromMessage, MAX_RESULT } = await import("../src/conversation-entries.ts");
    const blocks = Array.from({ length: 64 }, () => ({ type: "text", text: "x" }));
    const uninspected = { type: "text", get text(): string { throw new Error("must not inspect huge tail"); } };
    const result = entryFromMessage({ role: "toolResult", content: [...blocks, uninspected] });
    assert.ok(result?.kind === "toolResult"); assert.equal(result.sourceTruncated, true); assert.equal(result.elided, 0);
    const known = entryFromMessage({ role: "toolResult", content: [{ type: "text", text: "x".repeat(MAX_RESULT + 31) }] });
    assert.ok(known?.kind === "toolResult"); assert.equal(known.elided, 31); assert.equal(known.sourceTruncated, undefined);
    const bigTail = entryFromMessage({ role: "toolResult", content: [...blocks, { type: "text", text: "HUGE".repeat(1_000_000) }] });
    assert.ok(bigTail?.kind === "toolResult"); assert.equal(bigTail.elided, 0); assert.equal(bigTail.sourceTruncated, true);
    const tool = entryFromMessage({ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: " ".repeat(1001) + "PRIVATE_TAIL" } }] }, true);
    assert.ok(tool?.kind === "assistant"); assert.equal(tool.tools[0]?.detail, undefined);
});

it("parameters are complete immutable JSON or explicit bounded/unavailable, pair cache bytes stay capped", async () => {
    const { toolParameters } = await import("../src/conversation-entries.ts");
    const original = { path: "中文😀", nested: [null, false, { text: "  exact\nbody  " }] };
    const retained = toolParameters(original);
    assert.equal(retained.status, "complete");
    assert.deepEqual(JSON.parse(retained.json!), original);
    original.path = "changed"; assert.doesNotMatch(retained.json!, /changed/);
    assert.equal(toolParameters({ content: "x".repeat(100_000) }).status, "truncated");
    assert.equal(toolParameters({ get path() { throw new Error("no getter access"); } }).status, "unavailable");
    const circular: Record<string, unknown> = {}; circular.self = circular;
    assert.equal(toolParameters(circular).status, "unavailable");
    const pager = new ConversationPager(), owner = {};
    const messages = Array.from({ length: 200 }, (_, n) => ({ role: "assistant", content: [{ type: "toolCall", id: `t${n}`, name: "write", arguments: { content: "x".repeat(1000) } }] }));
    pager.livePage("bounded", owner, messages, 0);
    const cache = pager as unknown as { tools: Map<string, unknown>; toolBytes: number };
    assert.ok(cache.tools.size <= 128); assert.ok(cache.toolBytes <= 256 * 1024);
    pager.dispose(); assert.equal(cache.toolBytes, 0);
});

it("parameter arrays never reorder arbitrary keys and huge summary strings are not traversed", async () => {
    const { toolParameters, entryFromMessage } = await import("../src/conversation-entries.ts");
    const array = Object.assign(["zero"], { extra: "not JSON array data" });
    assert.equal(toolParameters({ array }).status, "unavailable");
    const huge = "x".repeat(1_000_000);
    const entry = entryFromMessage({ role: "assistant", content: [{ type: "toolCall", id: "huge", name: "write", arguments: { content: huge } }] }, true);
    assert.ok(entry?.kind === "assistant");
    assert.equal(entry.tools[0]?.parameters?.status, "truncated");
    assert.equal(entry.tools[0]?.summary?.lines, undefined);
    const pager = new ConversationPager();
    const broad = Array.from({ length: 3000 }, () => 0);
    const page = pager.livePage("huge", {}, [{ role: "assistant", content: [{ type: "toolCall", name: "foreign", arguments: { broad } }] }], 0);
    assert.equal(page.budgetLimited, true);
    assert.equal(page.entries.length, 0);
    pager.dispose();
});
