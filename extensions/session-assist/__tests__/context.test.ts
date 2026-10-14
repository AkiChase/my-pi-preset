import assert from "node:assert/strict";
import { it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { branchIdentity, prepareConversation } from "../context.ts";

const assistant = (text: string): AssistantMessage => ({ role: "assistant", api: "openai-responses", provider: "fake", model: "fake",
    content: [{ type: "text", text }, { type: "thinking", thinking: "private" }, { type: "toolCall", id: "t", name: "bash", arguments: {} }],
    stopReason: "stop", timestamp: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

it("actual SDK projection preserves full visible context and excludes system/tool/thinking/custom/bash", () => {
    const sm = SessionManager.inMemory();
    sm.appendMessage({ role: "user", content: "用户目标", timestamp: 1 });
    sm.appendMessage(assistant("可见回复"));
    sm.appendMessage({ role: "toolResult", toolCallId: "t", toolName: "bash", content: [{ type: "text", text: "tool secret" }], isError: false, timestamp: 1 });
    sm.appendCustomMessageEntry("notice", "plugin secret", true);
    sm.appendMessage({ role: "bashExecution", command: "ls", output: "shell secret", exitCode: 0, cancelled: false, truncated: false, timestamp: 1 });
    assert.deepEqual(prepareConversation(sm), [{ role: "user", text: "用户目标" }, { role: "assistant", text: "可见回复" }]);
    const identity = branchIdentity(sm);
    sm.appendCustomEntry("metadata", { count: 1 });
    sm.appendSessionInfo("title");
    assert.equal(branchIdentity(sm), identity);
});

it("actual SDK honors replacement, omission, compaction and active branch summaries", () => {
    const sm = SessionManager.inMemory();
    const old = sm.appendMessage({ role: "user", content: "old raw", timestamp: 1 });
    const kept = sm.appendMessage({ role: "user", content: "kept raw", timestamp: 2 });
    sm.appendContextEdit(kept, { content: "edited visible" });
    assert.deepEqual(prepareConversation(sm).map(p => p.text), ["old raw", "edited visible"]);
    sm.appendContextEdit(old, null);
    assert.deepEqual(prepareConversation(sm).map(p => p.text), ["edited visible"]);
    sm.appendCompaction("existing summary", kept, 5000);
    assert.deepEqual(prepareConversation(sm).map(p => p.text), ["existing summary", "edited visible"]);
    const current = sm.getLeafId();
    sm.appendMessage({ role: "user", content: "abandoned", timestamp: 3 });
    sm.branch(current!);
    sm.branchWithSummary(current!, "branch summary", "from");
    assert.equal(prepareConversation(sm).some(p => p.text === "abandoned"), false);
    assert.equal(prepareConversation(sm).some(p => p.text === "branch summary"), true);
});

it("long context is neither skipped nor truncated and image-only data is not uploaded", () => {
    const sm = SessionManager.inMemory();
    const text = "very long ".repeat(100_000);
    sm.appendMessage({ role: "user", content: [{ type: "text", text }, { type: "image", data: "private image", mimeType: "image/png" }], timestamp: 1 });
    assert.equal(prepareConversation(sm)[0].text, text);
    assert.equal(JSON.stringify(prepareConversation(sm)).includes("private image"), false);
});
