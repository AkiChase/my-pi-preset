import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { DEFAULTS, loadConfig, saveConfig } from "../config.ts";

it("config defaults to automatic on/N=8 and persists globally without destroying unknown fields", () => {
    const directory = mkdtempSync(join(tmpdir(), "session-name-config-"));
    try {
        assert.deepEqual(loadConfig(directory), DEFAULTS);
        writeFileSync(join(directory, "session-name.json"), '{"unrelated":42}');
        saveConfig({ automatic: false, interval: 3 }, directory);
        assert.deepEqual(loadConfig(directory), { automatic: false, interval: 3 });
        assert.equal(JSON.parse(readFileSync(join(directory, "session-name.json"), "utf8")).unrelated, 42);
        for (const value of [0, 1.5, 10001, "8"]) {
            writeFileSync(join(directory, "session-name.json"), JSON.stringify({ interval: value }));
            assert.throws(() => loadConfig(directory));
        }
        writeFileSync(join(directory, "session-name.json"), "broken");
        assert.throws(() => saveConfig({ automatic: true, interval: 8 }, directory));
        assert.equal(readFileSync(join(directory, "session-name.json"), "utf8"), "broken");
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
