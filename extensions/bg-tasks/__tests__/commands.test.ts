import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BackgroundRegistry } from "../state.ts";
import { registerCommands } from "../commands.ts";

void describe("commands", () => {
    void it("/bg-version reports the loaded package version and path", async () => {
        const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
        const notices: string[] = [];
        const pi = {
            registerCommand(name: string, definition: { handler: (args: string, ctx: unknown) => Promise<void> }) {
                commands.set(name, definition);
            },
            sendMessage() {},
        };

        registerCommands(pi as never, new BackgroundRegistry());
        await commands.get("bg-version")?.handler("", {
            ui: {
                notify: (message: string) => notices.push(message),
            },
        });

        assert.ok(commands.has("bg"));
        assert.ok(commands.has("bg-list"));
        assert.ok(commands.has("bg-version"));
        // Reports the preset's version, not a bg-tasks package version: vendored in, there is
        // no separate manifest for it any more.
        assert.match(notices[0] ?? "", /^my-pi-preset@\d+\.\d+\.\d+ bg-tasks loaded from /);
        assert.match(notices[0] ?? "", /extensions\/bg-tasks$/);
    });
});
