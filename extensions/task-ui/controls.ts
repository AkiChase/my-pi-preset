import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskCoordinator } from "./coordinator.ts";
import type { TaskUIConfig } from "./config.ts";

/** Shared controls are registered by the composition only; a backend never owns /task-detach or /tasks. */
export function registerTaskControls(
    pi: ExtensionAPI,
    coordinator: TaskCoordinator,
    config: TaskUIConfig,
    openPanel: (ctx: ExtensionContext) => Promise<void>,
): string[] {
    const warnings: string[] = [];
    const detach = (ctx: ExtensionContext) => {
        const count = coordinator.detachAll();
        ctx.ui.notify(count > 0 ? `▶ Released ${count} task wait(s) — continuing.` : "No current task waits to release.", count > 0 ? "info" : "warning");
    };
    pi.registerCommand("task-detach", { description: "Release all current task waits without stopping execution", handler: async (_args, ctx) => { detach(ctx); } });
    pi.registerCommand("tasks", { description: "Open Task Panel", handler: async (_args, ctx) => { await openPanel(ctx); } });
    const bind = (keys: readonly string[], name: string, description: string, handler: Parameters<ExtensionAPI["registerShortcut"]>[1]["handler"]) => {
        for (const key of keys) {
            try {
                // SDK validates configured chords; do not duplicate its key table.
                pi.registerShortcut(key as Parameters<ExtensionAPI["registerShortcut"]>[0], { description, handler });
            } catch (error) { warnings.push(`${name}: could not bind "${key}" (${String(error)})`); }
        }
    };
    bind(config.shortcutBackground, "shortcutBackground", "Release all current task waits", async (ctx) => { detach(ctx); });
    bind(config.shortcutTaskPanel, "shortcutTaskPanel", "Open Task Panel", openPanel);
    return warnings;
}
