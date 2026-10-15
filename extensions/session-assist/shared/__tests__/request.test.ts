import assert from "node:assert/strict";
import { it } from "node:test";
import { getEventListeners } from "node:events";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateText, RequestCancelled, RequestFailed } from "../request.ts";
import { readTitle } from "../../session-name/title.ts";

export function response(text = "实现会话命名"): AssistantMessage {
    return { role: "assistant", api: "openai-responses", provider: "fake", model: "fake", content: [{ type: "text", text }],
        stopReason: "stop", timestamp: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function setup(implementation: ExtensionContext["modelRegistry"]["streamSimple"]) {
    // Typed partial host seam: only the public streamSimple method is used by this helper.
    const registry = { streamSimple: implementation } as ExtensionContext["modelRegistry"];
    const model = { provider: "fake", id: "fake", api: "openai-responses" } as NonNullable<ExtensionContext["model"]>;
    const controller = new AbortController();
    return { registry, model, thinking: "high" as const, sessionId: "session", systemPrompt: "separate prompt", data: { conversation: "data" }, signal: controller.signal, controller };
}
function stream(result: Promise<AssistantMessage>) {
    return { result: () => result } as ReturnType<ExtensionContext["modelRegistry"]["streamSimple"]>;
}
it("request captures model/thinking/system/data and does not set a small output budget", async () => {
    const args = setup((model, context, options) => {
        assert.equal(model, args.model);
        assert.equal(context.systemPrompt, "separate prompt");
        assert.equal(context.messages.length, 1);
        assert.equal(options?.reasoning, "high");
        assert.equal(options?.sessionId, "session");
        assert.equal(options?.maxTokens, undefined);
        assert.equal(options?.onPayload, undefined);
        return stream(Promise.resolve(response()));
    });
    assert.equal(readTitle(await generateText(args)), "实现会话命名");
    assert.equal(getEventListeners(args.signal, "abort").length, 0);
});
it("current off is represented by the public API's undefined reasoning without payload patches", async () => {
    const args = setup((_model, _context, options) => {
        assert.equal(options?.reasoning, undefined);
        return stream(Promise.resolve(response()));
    });
    await generateText({ ...args, thinking: "off" });
});
it("cancels noncooperative provider waits and detaches listeners", async () => {
    let captured: AbortSignal | undefined;
    const args = setup((_model, _context, options) => { captured = options?.signal; return stream(new Promise(() => {})); });
    const pending = generateText(args);
    args.controller.abort();
    await assert.rejects(pending, RequestCancelled);
    assert.equal(captured?.aborted, true);
    assert.equal(getEventListeners(args.signal, "abort").length, 0);
});
it("total deadline is bounded even if the provider ignores cancellation", async () => {
    const args = setup(() => stream(new Promise(() => {})));
    await assert.rejects(generateText({ ...args, timeoutMs: 5 }), RequestFailed);
    assert.equal(getEventListeners(args.signal, "abort").length, 0);
});
it("preserves SDK errorMessage, exception and deadline details with explicit fallback", async () => {
    const returned = setup(() => stream(Promise.resolve({ ...response(), stopReason: "error", errorMessage: "Unsupported reasoning level" })));
    await assert.rejects(generateText(returned), { name: "Error", message: "Unsupported reasoning level" });
    const empty = setup(() => stream(Promise.resolve({ ...response(), stopReason: "length", errorMessage: "  " })));
    await assert.rejects(generateText(empty), /Provider response ended with length/);
    const exception = new Error("Provider unavailable");
    const thrown = setup(() => { throw exception; });
    await assert.rejects(generateText(thrown), error => error === exception);
    const timed = setup(() => stream(new Promise(() => {})));
    await assert.rejects(generateText({ ...timed, timeoutMs: 5 }), /Request timed out/);
});
it("rejects provider errors and malformed title bodies", async () => {
    const args = setup(() => stream(Promise.resolve({ ...response(), stopReason: "error" })));
    await assert.rejects(generateText(args), RequestFailed);
    for (const text of ["", "title: something", "two\nlines", "\u001b[31mred", "x".repeat(101), "a\u202eb"]) {
        assert.throws(() => readTitle(response(text)), RequestFailed);
    }
    assert.equal(readTitle(response('“短标题”')), "短标题");
});
