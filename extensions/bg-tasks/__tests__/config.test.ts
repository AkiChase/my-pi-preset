/**
 * Config loading. Every case here is a "the user's file is wrong" case — the
 * loader must be total: no throw, no partial load, a default in place of every
 * bad value, and a warning naming the key.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_FILENAME, DEFAULTS, envNameFor, loadConfig } from "../config.ts";

let dir: string;
before(() => {
    dir = mkdtempSync(join(tmpdir(), "bg-tasks-config-"));
});
after(() => {
    rmSync(dir, { recursive: true, force: true });
});

/** Write a config file into a fresh subdirectory and load it. */
function load(contents: string | undefined, env: NodeJS.ProcessEnv = {}) {
    // A fresh dir per case so one test's file cannot leak into another.
    const agentDir = mkdtempSync(join(dir, "agent-"));
    if (contents !== undefined) {
        writeFileSync(join(agentDir, CONFIG_FILENAME), contents);
    }
    return loadConfig(agentDir, env);
}

void describe("loadConfig — no file", () => {
    void it("returns the defaults with no warnings", () => {
        const { config, warnings, path } = load(undefined);
        assert.deepEqual(config, DEFAULTS);
        assert.deepEqual(warnings, []);
        // A missing config is the normal state, not a problem to report.
        assert.equal(path, undefined);
    });
});

void describe("loadConfig — valid file", () => {
    void it("overrides only the keys present", () => {
        const { config, warnings, path } = load('{"timeoutMs": 600000}');
        assert.equal(config.timeoutMs, 600_000);
        assert.equal(config.maxConcurrentJobs, DEFAULTS.maxConcurrentJobs);
        assert.deepEqual(warnings, []);
        assert.ok(path?.endsWith(CONFIG_FILENAME));
    });
    void it("accepts a single shortcut key as a string", () => {
        const { config } = load('{"shortcutTaskPanel": "ctrl+shift+p"}');
        assert.deepEqual(config.shortcutTaskPanel, ["ctrl+shift+p"]);
    });
    void it("accepts a list of shortcut keys", () => {
        const { config } = load('{"shortcutTaskPanel": ["f5", "ctrl+shift+j"]}');
        assert.deepEqual(config.shortcutTaskPanel, ["f5", "ctrl+shift+j"]);
    });
    void it('treats "off" as an explicit unbind', () => {
        // The point of the whole exercise: shift+down cannot be released
        // through keybindings.json, so it has to be releasable here.
        const { config, warnings } = load('{"shortcutTaskPanel": "off"}');
        assert.deepEqual(config.shortcutTaskPanel, []);
        assert.deepEqual(warnings, []);
    });
    void it("expands a leading ~ in logDir", () => {
        const { config } = load('{"logDir": "~/pi-logs"}');
        assert.ok(!config.logDir.startsWith("~"));
        assert.ok(config.logDir.endsWith("/pi-logs"));
    });
    void it("rounds a fractional number rather than passing it downstream", () => {
        const { config } = load('{"failureTailLines": 12.6}');
        assert.equal(config.failureTailLines, 13);
    });
});

void describe("loadConfig — malformed input never throws", () => {
    void it("ignores a file that is not JSON", () => {
        const { config, warnings } = load("{not json");
        assert.deepEqual(config, DEFAULTS);
        assert.match(warnings.join("\n"), /invalid JSON/);
    });
    void it("ignores a JSON file that is not an object", () => {
        const { config, warnings } = load("[1, 2, 3]");
        assert.deepEqual(config, DEFAULTS);
        assert.match(warnings.join("\n"), /expected a JSON object/);
    });
    void it("reports a non-ENOENT read failure", () => {
        // A directory where the file should be: readFileSync fails with EISDIR.
        const agentDir = mkdtempSync(join(dir, "agent-dir-"));
        mkdirSync(join(agentDir, CONFIG_FILENAME));
        const { config, warnings } = loadConfig(agentDir, {});
        assert.deepEqual(config, DEFAULTS);
        assert.match(warnings.join("\n"), /could not read/);
    });
    void it("falls back and warns on a non-numeric number", () => {
        const { config, warnings } = load('{"timeoutMs": "soon"}');
        assert.equal(config.timeoutMs, DEFAULTS.timeoutMs);
        assert.match(warnings.join("\n"), /timeoutMs: expected a number/);
    });
    void it("falls back and warns on an out-of-range number", () => {
        const { config, warnings } = load('{"monitorPollMs": 0}');
        assert.equal(config.monitorPollMs, DEFAULTS.monitorPollMs);
        assert.match(warnings.join("\n"), /monitorPollMs: 0 is outside/);
    });
    void it("falls back and warns on a shortcut of the wrong type", () => {
        const { config, warnings } = load('{"shortcutBackground": 42}');
        assert.deepEqual(config.shortcutBackground, DEFAULTS.shortcutBackground);
        assert.match(warnings.join("\n"), /shortcutBackground: expected a key/);
    });
    void it("skips non-string entries inside a shortcut list", () => {
        const { config, warnings } = load('{"shortcutBackground": ["f5", 7, ""]}');
        assert.deepEqual(config.shortcutBackground, ["f5"]);
        assert.match(warnings.join("\n"), /ignoring non-string entry/);
    });
    void it("falls back and warns on an empty logDir", () => {
        const { config, warnings } = load('{"logDir": "   "}');
        assert.equal(config.logDir, DEFAULTS.logDir);
        assert.match(warnings.join("\n"), /logDir: expected a non-empty path/);
    });
    void it("warns about an unknown key — a typo is silence otherwise", () => {
        const { warnings } = load('{"timoutMs": 5000}');
        assert.match(warnings.join("\n"), /unknown key "timoutMs"/);
    });
    void it("raises the monitor ceiling when the default would exceed it", () => {
        const { config, warnings } = load(
            '{"monitorDefaultTimeoutMs": 600000, "monitorMaxTimeoutMs": 60000}'
        );
        // Otherwise every monitor is silently clamped and looks like a bug.
        assert.equal(config.monitorMaxTimeoutMs, 600_000);
        assert.match(warnings.join("\n"), /raising the ceiling/);
    });
});

void describe("loadConfig — environment overrides", () => {
    void it("derives the variable name from the key", () => {
        assert.equal(envNameFor("timeoutMs"), "BG_TASKS_TIMEOUT_MS");
        assert.equal(envNameFor("logDir"), "BG_TASKS_LOG_DIR");
        assert.equal(
            envNameFor("monitorMaxLinesPerWindow"),
            "BG_TASKS_MONITOR_MAX_LINES_PER_WINDOW"
        );
    });
    void it("takes precedence over the file", () => {
        const { config } = load('{"timeoutMs": 300000}', {
            BG_TASKS_TIMEOUT_MS: "90000",
        });
        assert.equal(config.timeoutMs, 90_000);
    });
    void it("applies without a file", () => {
        const { config } = load(undefined, { BG_TASKS_LOG_DIR: "/var/tmp/bg" });
        assert.equal(config.logDir, "/var/tmp/bg");
    });
    void it("warns and keeps the file value when the variable is invalid", () => {
        const { config, warnings } = load('{"timeoutMs": 300000}', {
            BG_TASKS_TIMEOUT_MS: "nope",
        });
        assert.equal(config.timeoutMs, 300_000);
        assert.match(warnings.join("\n"), /BG_TASKS_TIMEOUT_MS: timeoutMs: expected a number/);
    });
    void it("can unbind a shortcut", () => {
        const { config } = load(undefined, { BG_TASKS_SHORTCUT_TASK_PANEL: "off" });
        assert.deepEqual(config.shortcutTaskPanel, []);
    });
});

void describe("DEFAULTS", () => {
    void it("is frozen so a caller cannot change the fallbacks", () => {
        assert.ok(Object.isFrozen(DEFAULTS));
    });
});
