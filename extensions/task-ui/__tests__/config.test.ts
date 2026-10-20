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

void it("backgroundReminderInterval defaults to 8, accepts 0 and positive integers, warns and falls back otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "task-ui-config-"));
    const path = join(dir, CONFIG_FILENAME);
    try {
        assert.equal(loadConfig(dir).config.backgroundReminderInterval, 8);
        for (const value of [0, 1, 5, 120]) {
            writeFileSync(path, JSON.stringify({ backgroundReminderInterval: value }));
            const result = loadConfig(dir);
            assert.equal(result.config.backgroundReminderInterval, value);
            assert.deepEqual(result.warnings, []);
        }
        for (const value of [-1, 1.5, "8", null, true, 1e300]) {
            writeFileSync(path, JSON.stringify({ backgroundReminderInterval: value }));
            const result = loadConfig(dir);
            assert.equal(result.config.backgroundReminderInterval, 8);
            assert.equal(result.warnings.length, 1, JSON.stringify(value));
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

void it("animations defaults on, accepts explicit static fallback and rejects non-booleans", () => {
    const dir = mkdtempSync(join(tmpdir(), "task-ui-config-"));
    try {
        assert.equal(loadConfig(dir).config.animations, true);
        for (const value of [false, true]) {
            writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify({ animations: value }));
            assert.equal(loadConfig(dir).config.animations, value); assert.deepEqual(loadConfig(dir).warnings, []);
        }
        for (const value of [0, "false", null]) {
            writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify({ animations: value }));
            assert.equal(loadConfig(dir).config.animations, true); assert.equal(loadConfig(dir).warnings.length, 1);
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
