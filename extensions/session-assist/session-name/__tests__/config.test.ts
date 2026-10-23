import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

it("single-field saves merge fresh configuration and refuse cancelled writes without temporary leaks", () => {
    const directory = mkdtempSync(join(tmpdir(), "session-name-patch-"));
    const path = join(directory, "session-name.json");
    try {
        writeFileSync(path, '{"automatic":false,"interval":8,"external":42}');
        assert.deepEqual(saveConfig({ interval: 3 }, directory), { automatic: false, interval: 3 });
        assert.equal(JSON.parse(readFileSync(path, "utf8")).external, 42);
        const before = readFileSync(path, "utf8");
        for (const limit of [0, 1, 2]) {
            let calls = 0;
            assert.throws(() => saveConfig({ automatic: true }, directory, () => calls++ < limit), /cancelled/);
            assert.equal(readFileSync(path, "utf8"), before); assert.deepEqual(readdirSync(directory), ["session-name.json"]);
        }
        writeFileSync(path, '{"automatic":"invalid","interval":3}');
        assert.throws(() => saveConfig({ interval: 4 }, directory), /Invalid/);
        assert.throws(() => saveConfig({ automatic: true }, directory), /Invalid/);
        assert.equal(readFileSync(path, "utf8"), '{"automatic":"invalid","interval":3}');
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
