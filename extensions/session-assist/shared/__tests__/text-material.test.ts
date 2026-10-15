import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateText } from "../request.ts";
import { reply as response } from "../../session-name/__tests__/harness.ts";

it("explicit literal text material preserves bytes and all naming JSON/options defaults", async () => {
    const literal = 'User: 修复工具\nAssistant: "quoted" \\ newline\nTool result: 😀';
    const data = { currentTitle: null, conversation: [{ role: "user", text: literal }] };
    const seen: string[] = [];
    const registry = { streamSimple(_model, context, options) {
        seen.push(String(context.messages[0].content));
        assert.equal(context.systemPrompt, "prompt");
        assert.equal(options?.reasoning, "high");
        assert.equal(options?.timeoutMs, 120_000);
        assert.equal(options?.cacheRetention, undefined);
        assert.equal(options?.maxTokens, undefined);
        return { result: async () => response() };
    } } as ExtensionContext["modelRegistry"];
    const args = { registry, model: { provider: "fake", id: "fake", api: "openai-responses" } as NonNullable<ExtensionContext["model"]>,
        thinking: "high" as const, sessionId: "session", systemPrompt: "prompt", data, signal: new AbortController().signal };
    await generateText(args);
    await generateText({ ...args, textMaterial: literal });
    await generateText({ ...args, textMaterial: "" });
    assert.deepEqual(seen, [JSON.stringify(data), literal, ""]);
});
