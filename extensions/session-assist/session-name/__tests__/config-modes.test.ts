import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, parseConfig, saveConfig } from "../config.ts";

it("mode fields default to follow, preserve custom intent, validate edits and allow explicit model repairs", t => {
    const directory = mkdtempSync(join(tmpdir(), "session-name-mode-config-")); const path = join(directory, "session-name.json");
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    assert.equal(parseConfig({ model: "p/id", thinking: "off" }).modelMode, "custom");
    for (const config of [{ modelMode: null }, { modelMode: "invalid" }, { modelMode: "custom" }, { model: "bad" }]) assert.throws(() => parseConfig(config));
    writeFileSync(path, '{"modelMode":"follow","model":"bad","thinking":"invalid","unknown":true}');
    assert.equal(loadConfig(directory).modelMode, "follow");
    const before = readFileSync(path, "utf8");
    for (const patch of [{ modelMode: "invalid" }, { model: "bad" }, { thinking: "invalid" }]) assert.throws(() => saveConfig(patch as unknown as Parameters<typeof saveConfig>[0], directory));
    assert.equal(readFileSync(path, "utf8"), before);
    writeFileSync(path, '{"modelMode":"custom","unknown":true}'); assert.throws(() => loadConfig(directory));
    saveConfig({ modelMode: "custom", model: "p/id", thinking: "off" }, directory);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { modelMode: "custom", model: "p/id", thinking: "off", unknown: true });
    saveConfig({ modelMode: "follow" }, directory); assert.equal(loadConfig(directory).model, "p/id");
});
