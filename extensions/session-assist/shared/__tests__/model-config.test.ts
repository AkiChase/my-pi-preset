import assert from "node:assert/strict";
import { it } from "node:test";
import { parseModelConfig, resolveModelConfig } from "../model-config.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

it("mode inference preserves explicit settings, while follow ignores dormant custom errors", () => {
    assert.deepEqual(parseModelConfig({}), { config: { modelMode: "follow" }, issues: [] });
    for (const value of [{ model: "p/id" }, { thinking: "off" }, { model: null }, { thinking: null }]) {
        assert.equal(parseModelConfig(value).config.modelMode, "custom");
        assert.ok(parseModelConfig(value).issues.length);
    }
    assert.equal(parseModelConfig({ model: "p/id", thinking: "off" }).config.modelMode, "custom");
    assert.deepEqual(parseModelConfig({ modelMode: "follow", model: "bad", thinking: "unknown" }), { config: { modelMode: "follow" }, issues: [] });
    for (const mode of [null, "", "inherit", 1, false]) assert.match(parseModelConfig({ modelMode: mode }).issues.join(";"), /modelMode must/);
    assert.equal(parseModelConfig({ modelMode: "custom" }).issues.length, 2);
});
it("custom selection is strict and independent; follow returns the exact main model and thinking", () => {
    const model: Model<"openai-responses"> = { provider: "p", id: "path/id", api: "openai-responses", name: "Fixture", baseUrl: "http://offline.invalid", reasoning: true,
        input: ["text"], contextWindow: 100000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, thinkingLevelMap: { minimal: null } };
    let available = true, auth = true;
    const registry = { find: (provider: string, id: string) => available && provider === "p" && id === "path/id" ? model : undefined,
        hasConfiguredAuth: () => auth } as unknown as ExtensionContext["modelRegistry"];
    const custom = parseModelConfig({ model: "p/path/id", thinking: "high" });
    assert.deepEqual(resolveModelConfig(custom, registry, { model: undefined }, "off", "Fixture"), { model, thinking: "high" });
    const main = { ...model, id: "main" };
    assert.deepEqual(resolveModelConfig(parseModelConfig({}), registry, { model: main }, "low", "Fixture"), { model: main, thinking: "low" });
    assert.throws(() => resolveModelConfig(parseModelConfig({}), registry, { model: undefined }, "off", "Fixture"), /No model selected/);
    available = false; assert.throws(() => resolveModelConfig(custom, registry, { model: main }, "off", "Fixture"), /unavailable/);
    available = true; auth = false; assert.throws(() => resolveModelConfig(custom, registry, { model: main }, "off", "Fixture"), /no configured authentication/);
    auth = true; model.input = ["image"]; assert.throws(() => resolveModelConfig(custom, registry, { model: main }, "off", "Fixture"), /text input/);
    model.input = ["text"]; model.thinkingLevelMap = { high: null };
    assert.throws(() => resolveModelConfig(custom, registry, { model: main }, "off", "Fixture"), /does not support thinking/);
    assert.throws(() => resolveModelConfig(parseModelConfig({ modelMode: "wrong", model: "p/path/id", thinking: "off" }), registry, { model: main }, "off", "Fixture"), /modelMode must/);
});
