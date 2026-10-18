/**
 * Config loading. Every case here is a "the user's file is wrong" case — the
 * loader must be total: no throw, no partial load, a default in place of every
 * bad value, and a warning naming the key.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
        const { config, warnings, path } = load('{"stallThresholdMs": 600000}');
        assert.equal(config.stallThresholdMs, 600_000);
        assert.equal(config.maxConcurrentJobs, DEFAULTS.maxConcurrentJobs);
        assert.deepEqual(warnings, []);
        assert.ok(path?.endsWith(CONFIG_FILENAME));
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
        const { config, warnings } = load('{"stallThresholdMs": "soon"}');
        assert.equal(config.stallThresholdMs, DEFAULTS.stallThresholdMs);
        assert.match(warnings.join("\n"), /stallThresholdMs: expected a number/);
    });
    void it("falls back and warns on an out-of-range number", () => {
        const { config, warnings } = load('{"monitorMaxLinesPerEvent": 0}');
        assert.equal(config.monitorMaxLinesPerEvent, DEFAULTS.monitorMaxLinesPerEvent);
        assert.match(warnings.join("\n"), /monitorMaxLinesPerEvent: 0 is outside/);
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
    void it("uses 30s by default, preserves explicit values/zero and environment precedence without writes", () => {
        assert.equal(load(undefined).config.monitorFlushMs, 30_000);
        assert.equal(load('{"monitorFlushMs": 2000}').config.monitorFlushMs, 2000);
        assert.equal(load('{"monitorFlushMs": 0}').config.monitorFlushMs, 0);
        const agentDir = mkdtempSync(join(dir, "unchanged-"));
        const path = join(agentDir, CONFIG_FILENAME);
        const contents = '{"monitorFlushMs": 2000, "monitorDefaultTimeoutMs": 1, "monitorMaxTimeoutMs": 2, "monitorPollMs": 3, "monitorRateWindowMs": 4, "monitorMaxLinesPerWindow": 5, "monitorMaxOverflowWindows": 6}';
        writeFileSync(path, contents);
        const result = loadConfig(agentDir, { PROCESS_TASKS_MONITOR_FLUSH_MS: "0" });
        assert.equal(result.config.monitorFlushMs, 0);
        assert.equal(result.warnings.length, 6, "ordinary unknown-key warnings only");
        assert.equal(readFileSync(path, "utf8"), contents);
        for (const key of Object.keys(JSON.parse(contents)).filter(k => k !== "monitorFlushMs")) {
            assert.ok(!(key in DEFAULTS));
            assert.ok(!(key in result.config));
        }
    });
});

void describe("loadConfig — environment overrides", () => {
    void it("derives the variable name from the key", () => {
        assert.equal(envNameFor("stallThresholdMs"), "PROCESS_TASKS_STALL_THRESHOLD_MS");
        assert.equal(envNameFor("logDir"), "PROCESS_TASKS_LOG_DIR");
        assert.equal(
            envNameFor("monitorMaxLinesPerEvent"),
            "PROCESS_TASKS_MONITOR_MAX_LINES_PER_EVENT"
        );
    });
    void it("takes precedence over the file", () => {
        const { config } = load('{"stallThresholdMs": 300000}', {
            PROCESS_TASKS_STALL_THRESHOLD_MS: "90000",
        });
        assert.equal(config.stallThresholdMs, 90_000);
    });
    void it("applies without a file", () => {
        const { config } = load(undefined, { PROCESS_TASKS_LOG_DIR: "/var/tmp/bg" });
        assert.equal(config.logDir, "/var/tmp/bg");
    });
    void it("warns and keeps the file value when the variable is invalid", () => {
        const { config, warnings } = load('{"stallThresholdMs": 300000}', {
            PROCESS_TASKS_STALL_THRESHOLD_MS: "nope",
        });
        assert.equal(config.stallThresholdMs, 300_000);
        assert.match(warnings.join("\n"), /PROCESS_TASKS_STALL_THRESHOLD_MS: stallThresholdMs: expected a number/);
    });
});

void describe("DEFAULTS", () => {
    void it("is frozen so a caller cannot change the fallbacks", () => {
        assert.ok(Object.isFrozen(DEFAULTS));
    });
});

void it("does not read legacy backend shortcut keys or environment overrides", () => {
    const { config, warnings } = load('{"shortcutBackground":"alt+b","shortcutTaskPanel":"f5"}', {
        PROCESS_TASKS_SHORTCUT_BACKGROUND: "alt+x", PROCESS_TASKS_SHORTCUT_TASK_PANEL: "f6",
    });
    assert.ok(!("shortcutBackground" in config));
    assert.ok(!("shortcutTaskPanel" in config));
    assert.equal(warnings.length, 2);
});

void it("retires timeoutMs file/env settings with warnings and never rewrites the user's file", () => {
    const agentDir = mkdtempSync(join(dir, "retired-"));
    const path = join(agentDir, CONFIG_FILENAME);
    const contents = '{"timeoutMs":600000,"monitorFlushMs":0}';
    writeFileSync(path, contents);
    const result = loadConfig(agentDir, { PROCESS_TASKS_TIMEOUT_MS: "0" });
    assert.equal("timeoutMs" in result.config, false);
    assert.equal("timeoutMs" in DEFAULTS, false);
    assert.equal(result.config.monitorFlushMs, 0);
    assert.match(result.warnings.join("\n"), /unknown key "timeoutMs"/);
    assert.match(result.warnings.join("\n"), /PROCESS_TASKS_TIMEOUT_MS is retired and unsupported/);
    assert.equal(readFileSync(path, "utf8"), contents);
});
