import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flush, harness, reply } from "./harness.ts";

it("empty config defaults to follow for automatic and manual requests, capturing main model/thinking per request", async t => {
    const h = harness(t, { config: {}, initial: true }); h.setThinking("low"); await h.start(); await h.clock.tick(0);
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].model, h.model); assert.equal(h.requests[0].options.reasoning, "low");
    const next = { ...h.model, id: "next" }; Object.assign(h.ctx, { model: next }); h.setThinking("off");
    assert.equal(h.requests[0].model, h.model); assert.equal(h.requests[0].options.reasoning, "low");
    h.requests[0].resolve(reply()); await flush();
    const manual = h.command(); await flush(); assert.equal(h.requests[1].model, next); assert.equal(h.requests[1].options.reasoning, undefined);
    h.requests[1].resolve(reply()); await manual; assert.equal(h.ctx.model, next);
});
it("missing main model errors without selecting a retained custom fallback", async t => {
    const h = harness(t, { config: { modelMode: "follow", model: "fixture/model", thinking: "high" } });
    Object.assign(h.ctx, { model: undefined }); await h.start(); await h.user(); await h.command();
    assert.equal(h.requests.length, 0); assert.match(h.notices.at(-1)!, /No model selected in the main session/);
});
it("existing custom config is independent of main model; mode switches preserve custom settings and active snapshots", async t => {
    const h = harness(t); Object.assign(h.ctx, { model: undefined }); await h.start(); await h.user();
    const manual = h.command(); await flush(); assert.equal(h.requests[0].model, h.model); assert.equal(h.requests[0].options.reasoning, "high");
    Object.assign(h.ctx, { model: h.model }); h.setThinking("off");
    h.selections.push("Follow main session"); await h.command("config");
    assert.equal(h.requests[0].options.signal?.aborted, false); assert.equal(h.requests[0].options.reasoning, "high");
    h.requests[0].resolve(reply()); await manual;
    const path = join(h.directory, "recap.json"); assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { modelMode: "follow", model: "fixture/model", thinking: "high" });
    const follow = h.command(); await flush(); assert.equal(h.requests[1].options.reasoning, undefined); h.requests[1].resolve(reply()); await follow;
    h.selections.push("Set model", "1. fixture/model"); await h.command("config");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).modelMode, "custom"); assert.equal(h.menus.at(-1)!.options.includes("off"), false, "compatible custom thinking does not reopen the level picker");
    const custom = h.command(); await flush(); assert.equal(h.requests[2].options.reasoning, "high"); h.requests[2].resolve(reply()); await custom;
});
it("explicit follow ignores retained invalid custom values; invalid mode does not request or fall back", async t => {
    const h = harness(t, { config: { modelMode: "follow", model: "broken", thinking: "invalid" } }); await h.start(); await h.user();
    const manual = h.command(); await flush(); assert.equal(h.requests.length, 1); h.requests[0].resolve(reply()); await manual;
    h.selections.push("Follow main session"); await h.command("config");
    assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "recap.json"), "utf8")), { modelMode: "follow", model: "broken", thinking: "invalid" });
    writeFileSync(join(h.directory, "recap.json"), '{"modelMode":"invalid"}'); await h.emit("session_tree"); await h.command();
    assert.equal(h.requests.length, 1); assert.match(h.notices.at(-1)!, /modelMode must/);
});
it("default follow config menu shows current main selection and selecting custom links thinking without changing main", async t => {
    const h = harness(t, { config: {} }); h.setThinking("low"); await h.start();
    h.selections.push("Set model", "1. fixture/model", "off"); await h.command("config");
    assert.match(h.menus[0].title, /mode follow main session, model fixture\/model, thinking low/);
    assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "recap.json"), "utf8")), { modelMode: "custom", model: "fixture/model", thinking: "off" });
    assert.equal(h.ctx.model, h.model);
});

it("a missing recap file follows the main session without configuration writes", async t => {
    const h = harness(t); const path = join(h.directory, "recap.json"); rmSync(path); h.setThinking("medium");
    await h.start(); await h.user(); const command = h.command(); await flush();
    assert.equal(h.requests[0].options.reasoning, "medium"); assert.equal(h.requests[0].model, h.model);
    h.requests[0].resolve(reply()); await command; assert.throws(() => readFileSync(path), /ENOENT/);
});

it("thinking selection saves the accepted model/thinking pair over concurrent model-field edits", async t => {
    const h = harness(t); await h.start(); const path = join(h.directory, "recap.json");
    let resolve!: (value: string) => void; const gate = new Promise<string>(yes => { resolve = yes; });
    h.selections.push("Set thinking", gate); const command = h.command("config"); await flush();
    writeFileSync(path, '{"model":"other/changed","thinking":"invalid","external":true}'); resolve("low"); await command;
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { modelMode: "custom", model: "fixture/model", thinking: "low", external: true });
});
