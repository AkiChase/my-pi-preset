import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flush, harness, reply } from "./harness.ts";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

it("default follow captures main model/thinking per request, without mutating the main session", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled();
    assert.equal(h.requests[0].model, h.model); assert.equal(h.requests[0].reasoning, "high");
    const next = { ...h.model, id: "next", reasoning: false }; Object.assign(h.ctx, { model: next }); h.setThinking("off");
    assert.equal(h.requests[0].model, h.model); assert.equal(h.requests[0].reasoning, "high");
    h.requests[0].resolve(reply()); await flush();
    const manual = h.command(); await flush();
    assert.equal(h.requests[1].model, next); assert.equal(h.requests[1].reasoning, undefined);
    h.requests[1].resolve(reply("Manual")); await manual; assert.equal(h.ctx.model, next);
});
it("custom mode handles automatic and manual requests without a main model and switching back retains custom settings", async t => {
    const h = harness(t); const path = join(h.directory, "session-name.json");
    writeFileSync(path, JSON.stringify({ modelMode: "custom", model: "fake/fake", thinking: "low", automatic: true, interval: 1 }));
    Object.assign(h.ctx, { model: undefined }); await h.start(); await h.user("first"); await h.settled();
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].model, h.model); assert.equal(h.requests[0].reasoning, "low");
    h.requests[0].resolve(reply()); await flush();
    h.choose("Follow main session"); await h.command("config");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { modelMode: "follow", model: "fake/fake", thinking: "low", automatic: true, interval: 1 });
    await h.user("second"); await h.settled(); assert.equal(h.requests.length, 1, "missing main model does not use retained custom values");
    Object.assign(h.ctx, { model: h.model }); h.setThinking("off"); await h.settled();
    assert.equal(h.requests.length, 2); assert.equal(h.requests[1].reasoning, undefined);
    h.requests[1].resolve(reply("Second")); await flush();
    h.selections.push("Set model", "1. fake/fake"); await h.command("config");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).modelMode, "custom");
    const manual = h.command(); await flush(); assert.equal(h.requests[2].reasoning, "low");
    h.requests[2].resolve(reply("Manual")); await manual; assert.equal(h.ctx.model, h.model);
});
it("model menu links missing thinking atomically and preserves fresh unrelated fields", async t => {
    const h = harness(t); await h.start(); const path = join(h.directory, "session-name.json");
    const gate = deferred<string | undefined>(); h.selections.push("Set model", "1. fake/fake", gate.promise);
    const command = h.command("config"); await flush();
    assert.deepEqual(h.menus[2].options, ["off", "low", "medium", "high"]); assert.throws(() => readFileSync(path), /ENOENT/);
    writeFileSync(path, '{"automatic":false,"interval":9,"unrelated":true}'); gate.resolve("off"); await command;
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { automatic: false, interval: 9, unrelated: true, modelMode: "custom", model: "fake/fake", thinking: "off" });
    assert.match(h.menus[0].title, /mode follow main session/);
});
it("linked menus cancel without saving at every step and navigation fences late choices", async t => {
    for (const steps of [[undefined], ["Set model", undefined], ["Set model", "1. fake/fake", undefined]]) {
        const h = harness(t); await h.start(); h.selections.push(...steps); await h.command("config");
        assert.throws(() => readFileSync(join(h.directory, "session-name.json")), /ENOENT/);
    }
    for (const step of ["model", "thinking"]) for (const event of ["session_before_switch", "session_before_tree", "session_before_fork", "session_shutdown"]) {
        const h = harness(t); await h.start(); const gate = deferred<string | undefined>();
        h.selections.push(...(step === "model" ? ["Set model", gate.promise] : ["Set model", "1. fake/fake", gate.promise]));
        const command = h.command("config"); await flush(); await h.emit(event); gate.resolve(step === "model" ? "1. fake/fake" : "off"); await command;
        assert.throws(() => readFileSync(join(h.directory, "session-name.json")), /ENOENT/); assert.deepEqual(h.notices, []);
    }
});
it("unavailable/auth/capability changes and forged model or thinking choices never save", async t => {
    for (const change of ["auth", "registry", "text", "thinking"]) {
        const h = harness(t); const path = join(h.directory, "session-name.json");
        writeFileSync(path, '{"modelMode":"custom","model":"fake/fake","thinking":"high"}'); await h.start();
        const before = readFileSync(path, "utf8"); const gate = deferred<string | undefined>(); h.selections.push("Set model", gate.promise);
        const command = h.command("config"); await flush();
        if (change === "auth") h.setAuth(false); else if (change === "registry") h.setAvailable(false);
        else if (change === "text") h.model.input = ["image"]; else h.model.thinkingLevelMap = { high: null };
        gate.resolve("1. fake/fake"); await command; assert.equal(readFileSync(path, "utf8"), before);
    }
    for (const steps of [["Set model", "invented/model"], ["Set model", "1. fake/fake", "invented thinking"], ["Set thinking"]]) {
        const h = harness(t); await h.start(); h.selections.push(...steps); await h.command("config");
        assert.throws(() => readFileSync(join(h.directory, "session-name.json")), /ENOENT/); assert.equal(h.notices.length, 1);
    }
});
it("invalid custom configuration never silently names through the main model", async t => {
    for (const config of [{ modelMode: "custom" }, { modelMode: "unknown" }, { model: "bad", thinking: "off" }, { model: "fake/fake", thinking: "unknown" }]) {
        const h = harness(t); writeFileSync(join(h.directory, "session-name.json"), JSON.stringify(config));
        await h.start(); await h.user("first"); await h.settled(); await h.command();
        assert.equal(h.requests.length, 0); assert.match(h.notices[0], /configuration/); assert.match(h.notices.at(-1)!, /Fix session-name.json/);
    }
});
it("custom runtime failures never fall back to a valid main model", async t => {
    for (const change of ["registry", "auth", "text", "thinking"]) {
        const h = harness(t); writeFileSync(join(h.directory, "session-name.json"), '{"modelMode":"custom","model":"fake/fake","thinking":"high"}'); await h.start();
        if (change === "registry") h.setAvailable(false); else if (change === "auth") h.setAuth(false);
        else if (change === "text") h.model.input = ["image"]; else h.model.thinkingLevelMap = { high: null };
        await h.user("data"); const command = h.command(); await command;
        assert.equal(h.requests.length, 0); assert.match(h.notices.at(-1)!, /refresh failed/);
    }
});

it("menus repair partial custom setup or invalid mode without overriding behavioral fields", async t => {
    const h = harness(t); const path = join(h.directory, "session-name.json"); writeFileSync(path, '{"modelMode":"custom","unknown":true}'); await h.start();
    h.selections.push("Set model", "1. fake/fake", "off"); await h.command("config");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { modelMode: "custom", model: "fake/fake", thinking: "off", unknown: true });
    await h.user("goal"); const manual = h.command(); await flush(); assert.equal(h.requests[0].reasoning, undefined); h.requests[0].resolve(reply()); await manual;
    writeFileSync(path, '{"modelMode":"invalid","model":"bad","unknown":true}');
    h.choose("Follow main session"); await h.command("config");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { modelMode: "follow", model: "bad", unknown: true });
});
it("thinking selection saves its accepted model/thinking pair over concurrent model-field edits", async t => {
    const h = harness(t); const path = join(h.directory, "session-name.json"); writeFileSync(path, '{"model":"fake/fake","thinking":"high"}'); await h.start();
    const gate = deferred<string | undefined>(); h.selections.push("Set thinking", gate.promise); const command = h.command("config"); await flush();
    writeFileSync(path, '{"model":"other/changed","thinking":"invalid","external":true}'); gate.resolve("low"); await command;
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { modelMode: "custom", model: "fake/fake", thinking: "low", external: true });
});
