import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS, loadConfig, parseConfig, saveConfig } from "../config.ts";

it("explicit required config never falls back; validates behavioral bounds", () => {
    const empty = parseConfig({}); assert.deepEqual(empty.config, DEFAULTS); assert.equal(empty.issues.length, 2);
    for (const bad of [{ model: "no-provider", thinking: "off" }, { model: "p/id", thinking: "unknown" }, { model: "p/id", thinking: "off", automatic: null }, { model: "p/id", thinking: "off", idleMinutes: Infinity }, { model: "p/id", thinking: "off", maxContextChars: 256.5 }]) assert.ok(parseConfig(bad).issues.length);
    assert.deepEqual(parseConfig({ model: "p/path/id", thinking: "off" }).issues, []);
});
it("fresh atomic patch preserves unknown fields, refuses malformed JSON, and fences cancellation", t => {
    const dir = mkdtempSync(join(tmpdir(), "recap-config-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "recap.json");
    writeFileSync(join(dir, "pi-recap.json"), '{"model":"legacy","thinking":"high"}');
    assert.equal(loadConfig(dir).config.model, undefined);
    writeFileSync(path, '{"unknown":{"keep":true},"model":"p/id","thinking":"off"}');
    saveConfig({ automatic: false }, dir); assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).unknown, { keep: true });
    assert.equal(loadConfig(dir).config.automatic, false);
    const before = readFileSync(path, "utf8"); let checks = 0;
    assert.throws(() => saveConfig({ idleMinutes: 10 }, dir, () => ++checks < 3), /cancelled/);
    assert.equal(readFileSync(path, "utf8"), before); assert.equal(readdirSync(dir).some(name => name.endsWith(".tmp")), false);
    for (const text of ["{broken", "[]", "null"]) { writeFileSync(path, text); assert.throws(() => saveConfig({ automatic: true }, dir)); assert.equal(readFileSync(path, "utf8"), text); }
});
it("model identifiers reject controls/bidi without normalizing to another model and rejected edits preserve file", t => {
    const dir = mkdtempSync(join(tmpdir(), "recap-invalid-model-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "recap.json"); writeFileSync(path, '{"model":"p/id","thinking":"off"}');
    const before = readFileSync(path, "utf8");
    for (const marker of ["\x00", "\x07", "\x1b", "\x85", "\n", "\t", "\u061c", "\u200e", "\u202e", "\u2066"]) {
        const model = `p/${marker}id`;
        assert.equal(parseConfig({ model, thinking: "off" }).config.model, undefined);
        assert.throws(() => saveConfig({ model }, dir), /model must be explicitly/);
        assert.equal(readFileSync(path, "utf8"), before);
    }
});
