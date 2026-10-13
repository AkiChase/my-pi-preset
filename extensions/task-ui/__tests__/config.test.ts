import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULTS, CONFIG_FILENAME, loadConfig } from "../config.ts";

void it("task-ui owns canonical chords, supports remapping/off, never falls back to process config", () => {
    const dir = mkdtempSync(join(tmpdir(), "task-ui-config-"));
    try {
        writeFileSync(join(dir, "process-tasks.json"), '{"shortcutBackground":"alt+x","shortcutTaskPanel":"f4"}');
        assert.deepEqual(loadConfig(dir).config, DEFAULTS);
        const path = join(dir, CONFIG_FILENAME);
        const text = '{"shortcutBackground":"alt+b","shortcutTaskPanel":"off","downOpener":true}';
        writeFileSync(path, text);
        const result = loadConfig(dir);
        assert.deepEqual(result.config.shortcutBackground, ["alt+b"]);
        assert.deepEqual(result.config.shortcutTaskPanel, []);
        assert.equal(result.config.downOpener, true);
        assert.deepEqual(result.warnings, []);
        writeFileSync(path, '{"downOpener":false}');
        assert.equal(loadConfig(dir).config.downOpener, false);
        writeFileSync(path, text);
        assert.equal(readFileSync(path, "utf8"), text);
        assert.ok(Object.isFrozen(result.config.shortcutBackground));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

void it("invalid JSON/values warn without breaking defaults; array keys are bounded by valid strings", () => {
    const dir = mkdtempSync(join(tmpdir(), "task-ui-config-"));
    const path = join(dir, CONFIG_FILENAME);
    try {
        for (const text of ["oops", "[]", '{"shortcutBackground":42,"downOpener":"yes","unknown":1}']) {
            writeFileSync(path, text);
            const result = loadConfig(dir);
            assert.deepEqual(result.config, DEFAULTS);
            assert.ok(result.warnings.length > 0);
        }
        writeFileSync(path, '{"shortcutBackground":["f5",7,""],"shortcutTaskPanel":["f6","alt+p"]}');
        const result = loadConfig(dir);
        assert.deepEqual(result.config.shortcutBackground, ["f5"]);
        assert.deepEqual(result.config.shortcutTaskPanel, ["f6", "alt+p"]);
        assert.equal(result.warnings.length, 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
