import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import "./source-loader.mjs";
const { entryFromMessage, fromMessages, fromJsonl, readTranscriptTail, MAX_ENTRIES, MAX_RESULT, MAX_TEXT } = await import("../src/conversation-entries.ts");

const line = (message: unknown) => JSON.stringify({ isSidechain: true, agentId: "a", type: "x", message, timestamp: "t", cwd: "/" });

void it("maps each message role to bounded structured entries and skips unknown shapes", () => {
    assert.deepEqual(entryFromMessage({ role: "user", content: "  hello  " }), { kind: "user", text: "hello" });
    assert.deepEqual(entryFromMessage({ role: "user", content: [{ type: "image", data: "x" }, { type: "text", text: "a" }] }), { kind: "user", text: "a" });
    assert.deepEqual(entryFromMessage({ role: "assistant", content: [
        { type: "thinking", thinking: "secret" }, { type: "text", text: "**Done**" },
        { type: "toolCall", id: "1", name: "bash", arguments: { command: "npm\n test", description: "run" } },
        { type: "toolCall", id: "2", name: "read", arguments: {} },
    ] }), { kind: "assistant", text: "**Done**", tools: [{ name: "bash", detail: "npm test" }, { name: "read" }] });
    assert.deepEqual(entryFromMessage({ role: "assistant", content: [], errorMessage: "rate limited" }), { kind: "notice", text: "Error: rate limited" });
    const big = entryFromMessage({ role: "toolResult", toolName: "read", content: [{ type: "text", text: "r".repeat(MAX_RESULT + 5) }], isError: true });
    assert.equal(big?.kind, "toolResult"); assert.ok(big?.kind === "toolResult" && big.elided === 5 && big.error === true && big.text.length === MAX_RESULT);
    assert.deepEqual(entryFromMessage({ role: "bashExecution", command: "ls", output: "a\n", exitCode: 2 }), { kind: "bash", command: "ls", output: "a", elided: 0, exitCode: 2 });
    assert.equal(entryFromMessage({ role: "user", content: "x".repeat(MAX_TEXT * 2) })?.kind === "user" ? (entryFromMessage({ role: "user", content: "x".repeat(MAX_TEXT * 2) }) as { text: string }).text.length : 0, MAX_TEXT);
    for (const bad of [null, "s", [], { role: "system", content: "s" }, { role: "assistant", content: "not array" }, { role: "toolResult", content: [] }, { role: "custom", content: "c" }])
        assert.equal(entryFromMessage(bad), undefined);
});

void it("bounds the window to the newest entries and marks truncation", () => {
    const messages = Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => ({ role: "user", content: `m${i}` }));
    const slice = fromMessages(messages);
    assert.equal(slice.entries.length, MAX_ENTRIES); assert.equal(slice.truncated, true);
    assert.deepEqual(slice.entries.at(-1), { kind: "user", text: `m${MAX_ENTRIES + 9}` });
    assert.ok(Object.isFrozen(slice.entries) && Object.isFrozen(slice.entries[0]));
    assert.equal(fromMessages([{ role: "user", content: "a" }]).truncated, false);
});

void it("parses JSONL, drops a partial first line only mid-file, and skips malformed lines", () => {
    const text = [line({ role: "user", content: "first" }), "{not json", line({ role: "assistant", content: [{ type: "text", text: "ok" }] }), ""].join("\n");
    assert.deepEqual(fromJsonl(text, false).entries.map(e => e.kind), ["user", "assistant"]);
    const mid = fromJsonl(text.slice(5), true);
    assert.deepEqual(mid.entries.map(e => e.kind), ["assistant"]); assert.equal(mid.truncated, true);
});

void it("reads only a bounded transcript tail and tolerates missing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "conv-entries-"));
    try {
        const path = join(dir, "a.output");
        writeFileSync(path, Array.from({ length: 200 }, (_, i) => line({ role: "user", content: `u${i}` })).join("\n") + "\n");
        const tail = readTranscriptTail(path, 2_000)!;
        assert.equal(tail.truncated, true); assert.ok(tail.entries.length > 0 && tail.entries.length < 200);
        assert.deepEqual(tail.entries.at(-1), { kind: "user", text: "u199" });
        assert.equal(readTranscriptTail(join(dir, "missing")), undefined);
        assert.equal(readTranscriptTail(dir), undefined);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("retains only bounded immutable bash launch metadata without getters or arbitrary details", () => {
    const launch = { version: 2, task_type: "bash", task_id: "bash_1", mode: "foreground" };
    const result = (runtimeLaunch: unknown, toolName = "bash") => entryFromMessage({ role: "toolResult", toolName, content: "ok", details: { runtimeLaunch, private: "SECRET" } }, true);
    const retained = result(launch); assert.ok(retained?.kind === "toolResult");
    assert.deepEqual(retained.display?.runtimeLaunch, launch); assert.ok(Object.isFrozen(retained.display?.runtimeLaunch));
    launch.task_id = "changed"; assert.equal(retained.display?.runtimeLaunch?.task_id, "bash_1");
    for (const bad of [{ ...launch, extra: "SECRET" }, { ...launch, task_id: "x".repeat(201) }, { ...launch, task_id: "a\x1b" },
        { ...launch, get task_id() { throw new Error("must not invoke getter"); } },
        { ...launch, mode: { toString() { throw new Error("must not stringify metadata objects"); } } },
        { version: 2, kind: "subagent", agent_id: "a", mode: "foreground" }]) {
        const entry = result(bad); assert.ok(entry?.kind === "toolResult"); assert.equal(entry.display?.runtimeLaunch, undefined);
    }
    const other = result(launch, "foreign"); assert.ok(other?.kind === "toolResult"); assert.equal(other.display?.runtimeLaunch, undefined);
    assert.doesNotMatch(JSON.stringify(retained), /SECRET/);
});
