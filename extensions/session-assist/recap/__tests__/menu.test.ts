import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deferred, flush, harness } from "./harness.ts";

it("model menu lists authenticated text models; compatible thinking is preserved without input", async t => {
    const h = harness(t); await h.start();
    h.models.push({ ...h.model, provider: "other", id: "model", reasoning: false }, { ...h.model, id: "image-only", input: ["image"] });
    h.selections.push("Set model", "1. fixture/model"); await h.command("config");
    assert.deepEqual(h.menus[1].options, ["1. fixture/model", "2. other/model"]);
    assert.equal(h.menus.length, 2); assert.equal(h.inputs.length, 0);
    assert.equal(JSON.parse(readFileSync(join(h.directory, "recap.json"), "utf8")).thinking, "high");
});
it("missing or incompatible thinking chains supported selection and saves both fields together", async t => {
    for (const thinking of [undefined, "high"]) {
        const h = harness(t, { config: { thinking, unknown: { keep: true } } }); await h.start();
        h.models.push({ ...h.model, id: "plain", reasoning: false });
        const path = join(h.directory, "recap.json"); const before = readFileSync(path, "utf8");
        const gate = deferred<string | undefined>(); h.selections.push("Set model", "2. fixture/plain", gate.promise);
        const command = h.command("config"); await flush();
        assert.deepEqual(h.menus.at(-1)!.options, ["off"]); assert.equal(readFileSync(path, "utf8"), before);
        // Fresh save must retain unrelated fields changed while the menu was open.
        writeFileSync(path, JSON.stringify({ ...JSON.parse(before), external: true }));
        gate.resolve("off"); await command;
        assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { model: "fixture/plain", thinking: "off", unknown: { keep: true }, external: true });
    }
});
it("thinking menu filters capabilities and missing models guide selection without writing", async t => {
    const h = harness(t); await h.start(); h.selections.push("Set thinking", "low"); await h.command("config");
    assert.deepEqual(h.menus[1].options, ["off", "low", "medium", "high"]);
    const missing = harness(t, { config: {} }); await missing.start();
    const path = join(missing.directory, "recap.json"); const before = readFileSync(path, "utf8");
    missing.selections.push("Set thinking"); await missing.command("config");
    assert.equal(missing.menus.length, 1); assert.match(missing.notices.at(-1)!, /Set model/); assert.equal(readFileSync(path, "utf8"), before);
});
it("empty registry, unauthenticated models and arbitrary menu responses cannot write", async t => {
    for (const unavailable of ["registry", "auth"]) {
        const h = harness(t); await h.start(); if (unavailable === "auth") h.setAuth(false); else h.setAvailable(false);
        const path = join(h.directory, "recap.json"); const before = readFileSync(path, "utf8");
        h.selections.push("Set model"); await h.command("config");
        assert.match(h.notices.at(-1)!, /No authenticated text models/); assert.equal(h.menus.length, 1); assert.equal(readFileSync(path, "utf8"), before);
    }
    for (const response of [["Set model", "invented/model"], ["Set thinking", "minimal"], ["invalid choice"]]) {
        const h = harness(t); await h.start(); const path = join(h.directory, "recap.json"); const before = readFileSync(path, "utf8");
        h.selections.push(...response); await h.command("config"); assert.equal(readFileSync(path, "utf8"), before); assert.match(h.notices.at(-1)!, /Could not save/);
    }
});
it("cancel at each linked step or late model/thinking selection after navigation never writes", async t => {
    for (const step of ["top", "model", "thinking"]) {
        const h = harness(t, { config: {} }); await h.start(); const path = join(h.directory, "recap.json"); const before = readFileSync(path, "utf8");
        h.selections.push(...(step === "top" ? [undefined] : step === "model" ? ["Set model", undefined] : ["Set model", "1. fixture/model", undefined]));
        await h.command("config"); assert.equal(readFileSync(path, "utf8"), before);
    }
    for (const step of ["model", "thinking"]) for (const event of ["session_before_switch", "session_before_tree", "session_shutdown"]) {
        const h = harness(t, { config: {} }); await h.start(); const path = join(h.directory, "recap.json"); const before = readFileSync(path, "utf8");
        const gate = deferred<string | undefined>();
        h.selections.push(...(step === "model" ? ["Set model", gate.promise] : ["Set model", "1. fixture/model", gate.promise]));
        const command = h.command("config"); await flush(); await h.emit(event); gate.resolve(step === "model" ? "1. fixture/model" : "off"); await command;
        assert.equal(readFileSync(path, "utf8"), before);
    }
});
it("auth and model changes during selection are revalidated; controls and truncated labels cannot alias models", async t => {
    for (const change of ["auth", "registry", "capability", "text"]) {
        const h = harness(t); await h.start(); const path = join(h.directory, "recap.json"); const before = readFileSync(path, "utf8");
        const gate = deferred<string | undefined>(); h.selections.push("Set model", gate.promise); const command = h.command("config"); await flush();
        if (change === "auth") h.setAuth(false); else if (change === "registry") h.setAvailable(false); else if (change === "text") h.model.input = ["image"]; else h.model.thinkingLevelMap = { ...h.model.thinkingLevelMap, high: null };
        gate.resolve("1. fixture/model"); await command; assert.equal(readFileSync(path, "utf8"), before);
    }
    const h = harness(t); await h.start(); const prefix = "😀".repeat(900);
    h.models.push({ ...h.model, id: `${prefix}a` }, { ...h.model, id: `${prefix}b` }, { ...h.model, id: "unsafe\u202e" });
    const gate = deferred<string | undefined>(); h.selections.push("Set model", gate.promise); const command = h.command("config"); await flush();
    const labels = h.menus.at(-1)!.options; assert.equal(labels.length, 3); assert.equal(new Set(labels).size, 3);
    for (const label of labels) { assert.ok(Array.from(label).length < 800); assert.doesNotMatch(label, /\u202e/); }
    const targetIndex = h.models.filter(model => !model.id.includes("\u202e")).sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`)).findIndex(model => model.id === `${prefix}b`);
    gate.resolve(labels[targetIndex]); await command;
    assert.equal(JSON.parse(readFileSync(join(h.directory, "recap.json"), "utf8")).model, `fixture/${prefix}b`);
});
