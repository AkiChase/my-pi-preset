/**
 * Shortcut registration is config-driven: these keys cannot be remapped via
 * pi's keybindings.json (registerShortcut takes a raw chord, not an action id),
 * so the config file is the only way to move or release one.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { registerShortcuts } from "../shortcuts.ts";

function harness(opts?: { rejectKey?: string }) {
    const bound: { key: string; description: string }[] = [];
    const pi = {
        registerShortcut(key: string, def: { description: string }) {
            if (opts?.rejectKey === key) throw new Error(`unknown key: ${key}`);
            bound.push({ key, description: def.description });
        },
    };
    return { pi, bound };
}

void describe("registerShortcuts", () => {
    void it("binds the four default chords", () => {
        const { pi, bound } = harness();
        const warnings = registerShortcuts(pi as never, new BackgroundRegistry());
        assert.deepEqual(
            bound.map((b) => b.key),
            ["ctrl+shift+b", "ctrl+shift+j", "shift+down", "ctrl+shift+x"]
        );
        assert.deepEqual(warnings, []);
    });

    void it("never binds ctrl+b — pi owns it for cursor-left", () => {
        const { pi, bound } = harness();
        registerShortcuts(pi as never, new BackgroundRegistry());
        assert.ok(!bound.some((b) => b.key === "ctrl+b"));
    });

    void it("honours a remapped chord", () => {
        const { pi, bound } = harness();
        const reg = new BackgroundRegistry({
            ...DEFAULTS,
            shortcutBackground: ["alt+b"],
        });
        registerShortcuts(pi as never, reg);
        assert.ok(bound.some((b) => b.key === "alt+b"));
        assert.ok(!bound.some((b) => b.key === "ctrl+shift+b"));
    });

    void it("binds nothing for an unbound ([]) action", () => {
        const { pi, bound } = harness();
        const reg = new BackgroundRegistry({ ...DEFAULTS, shortcutTaskPanel: [] });
        registerShortcuts(pi as never, reg);
        assert.deepEqual(
            bound.map((b) => b.key),
            ["ctrl+shift+b", "ctrl+shift+x"]
        );
    });

    void it("reports a rejected chord but still binds the rest", () => {
        // One bad key in the config must not cost the other shortcuts.
        const { pi, bound } = harness({ rejectKey: "shift+down" });
        const warnings = registerShortcuts(pi as never, new BackgroundRegistry());
        assert.deepEqual(
            bound.map((b) => b.key),
            ["ctrl+shift+b", "ctrl+shift+j", "ctrl+shift+x"]
        );
        assert.equal(warnings.length, 1);
        assert.match(warnings[0]!, /shortcutTaskPanel: could not bind "shift\+down"/);
    });
});
