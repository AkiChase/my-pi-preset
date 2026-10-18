import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BackgroundRegistry } from "../state.ts";
import { formatConfigReport, registerCommands } from "../commands.ts";
import { DEFAULTS } from "../config.ts";

void describe("commands", () => {
    void it("/process-tasks-version reports the loaded package version and path", async () => {
        const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
        const notices: string[] = [];
        const pi = {
            registerCommand(name: string, definition: { handler: (args: string, ctx: unknown) => Promise<void> }) {
                commands.set(name, definition);
            },
            sendMessage() {},
        };

        registerCommands(pi as never, new BackgroundRegistry(), {
            configPath: undefined,
            warnings: [],
        });
        await commands.get("process-tasks-version")?.handler("", {
            ui: {
                notify: (message: string) => notices.push(message),
            },
        });

        assert.ok(!commands.has("task-detach"), "shared controls own /task-detach");
        assert.ok(!commands.has("bg-list"), "no legacy alias");
        assert.ok(commands.has("process-tasks-version"));
        assert.ok(commands.has("process-tasks-config"));
        // Reports the preset's version, not a process-tasks package version: vendored in, there is
        // no separate manifest for it any more.
        assert.match(notices[0] ?? "", /^my-pi-preset@\d+\.\d+\.\d+ process-tasks loaded from /);
        assert.match(notices[0] ?? "", /extensions\/process-tasks$/);
    });
});

void describe("formatConfigReport", () => {
    void it("says so plainly when nothing is overridden", () => {
        const out = formatConfigReport({
            reg: new BackgroundRegistry(),
            configPath: undefined,
            warnings: [],
        });
        assert.match(out, /Config file: none/);
        assert.match(out, /Overridden: nothing/);
        assert.doesNotMatch(out, /timeoutMs|PROCESS_TASKS_TIMEOUT_MS/);
        assert.match(out, /logDir → PROCESS_TASKS_LOG_DIR/);
    });

    void it("lists only the overridden keys, with their defaults", () => {
        // A full dump would bury the one line the user is looking for.
        const reg = new BackgroundRegistry({ ...DEFAULTS, stallThresholdMs: 600_000 });
        const out = formatConfigReport({
            reg,
            configPath: "/tmp/agent/process-tasks.json",
            warnings: [],
        });
        assert.match(out, /Config file: \/tmp\/agent\/process-tasks\.json/);
        assert.match(out, /stallThresholdMs: 600000 {2}\(default 45000\)/);
        assert.ok(!out.includes("maxConcurrentJobs"));
    });

    void it("surfaces load warnings", () => {
        const out = formatConfigReport({
            reg: new BackgroundRegistry(),
            configPath: undefined,
            warnings: ["stallThresholdMs: expected a number"],
        });
        assert.match(out, /Warnings:\n {2}• stallThresholdMs: expected a number/);
    });
});
