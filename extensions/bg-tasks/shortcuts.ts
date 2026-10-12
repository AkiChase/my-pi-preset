/**
 * Keyboard shortcut registration.
 *
 * Defaults:
 *   - Ctrl+Shift+B: move the foreground bash to background
 *   - Shift+Down: open the background task manager
 *
 * Both are configurable (`shortcutBackground`, `shortcutTaskPanel`),
 * including `"off"`, because `registerShortcut` takes a
 * raw chord rather than an action id — pi's `keybindings.json` cannot reach
 * these, so the config file is the only way to change or release a key.
 *
 * Note: Ctrl+B is reserved by pi for `tui.editor.cursorLeft` (built-in
 * keybinding), so the background shortcut defaults to Ctrl+Shift+B. Binding
 * Ctrl+B anyway triggers pi's startup "extension shortcut conflict" diagnostic
 * and breaks cursor-left in the editor.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundRegistry } from "./state.ts";
import { takeControl, type ControlContext } from "./lifecycle.ts";
import { openBgListPanel } from "./ui.ts";
import type { ShortcutBinding } from "./config.ts";

/**
 * Register all shortcuts. Returns the problems encountered, for the same
 * reporting path as config warnings — a key pi rejects (an unknown chord, or
 * one another extension already took) must not abort the rest of the
 * registration, or one typo would cost every shortcut.
 */
export function registerShortcuts(
    pi: ExtensionAPI,
    reg: BackgroundRegistry
): string[] {
    const warnings: string[] = [];

    const bind = (
        keys: ShortcutBinding,
        configKey: string,
        description: string,
        handler: Parameters<ExtensionAPI["registerShortcut"]>[1]["handler"]
    ): void => {
        for (const key of keys) {
            try {
                // A configured chord is an arbitrary string, while registerShortcut
                // takes pi's KeyId union. Validating the union here would mean
                // duplicating pi's key table and letting it drift; instead the
                // cast hands the string to pi, which rejects an invalid chord —
                // and that rejection is exactly what the catch below reports.
                pi.registerShortcut(
                    key as Parameters<ExtensionAPI["registerShortcut"]>[0],
                    { description, handler }
                );
            } catch (err) {
                warnings.push(
                    `${configKey}: could not bind "${key}" (${(err as Error).message})`
                );
            }
        }
    };

    bind(
        reg.config.shortcutBackground,
        "shortcutBackground",
        "Background the current foreground process",
        async (ctx) => handleCtrlB(reg, ctx)
    );
    bind(
        reg.config.shortcutTaskPanel,
        "shortcutTaskPanel",
        "Open background task manager",
        async (ctx) => openBgListPanel(reg, ctx)
    );

    return warnings;
}

/**
 * Ctrl+Shift+B / `/bg` handler — background ALL running foreground commands
 * (Claude Code's `backgroundAll`). takeControl deliberately never aborts the
 * turn: the bash tool returns its "backgrounded" result, the turn ends, and a
 * queued user message drains at the natural turn boundary. See
 * lifecycle.takeControl.
 */
async function handleCtrlB(
    reg: BackgroundRegistry,
    ctx: Parameters<NonNullable<Parameters<ExtensionAPI["registerShortcut"]>[1]["handler"]>>[0]
): Promise<void> {
    takeControl(reg, ctx as ControlContext);
}
