import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Input } from "@earendil-works/pi-tui";
import { InteractiveMode, KeybindingsManager } from "../../../task-ui/__tests__/editor-host.mjs";
import { runOverlay } from "../overlay.ts";
import type { OverlayInteraction } from "../overlay.ts";

it("installed SDK custom overlay preserves component focus/input and closes its own handle only", async () => {
    const events: string[] = [];
    let mounted!: Input & { dispose(): void };
    const host = {
        editor: { getText: () => "unchanged draft" },
        keybindings: KeybindingsManager.create(),
        ui: {
            showOverlay(component: typeof mounted) {
                mounted = component;
                events.push("install");
                return { hide() { events.push("hide own overlay"); } };
            },
            requestRender() {},
        },
    };
    const ctx = { mode: "tui", hasUI: true, ui: {
        custom: InteractiveMode.prototype.showExtensionCustom.bind(host) as ExtensionUIContext["custom"],
    } } as Pick<ExtensionContext, "mode" | "hasUI" | "ui">;
    let runtime!: OverlayInteraction<string>;
    let disposed = 0;
    const input = Object.assign(new Input(), { dispose() { disposed++; } });
    const pending = runOverlay(ctx, {
        isCurrent: () => true,
        create(_tui, _theme, _keys, interaction) { runtime = interaction; return input; },
    });
    await Promise.resolve();
    assert.ok(mounted instanceof Input);
    mounted.focused = true; mounted.handleInput("hello");
    assert.equal(input.focused, true); assert.equal(input.getValue(), "hello");
    // A different topmost overlay must never be hidden by our completion.
    host.ui.showOverlay(Object.assign(new Input(), { dispose() {} }));
    runtime.complete(input.getValue());
    assert.deepEqual(await pending, { kind: "completed", value: "hello" });
    assert.equal(disposed, 1);
    assert.deepEqual(events, ["install", "install", "hide own overlay"]);
});
