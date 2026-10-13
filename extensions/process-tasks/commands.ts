/**
 * Slash command registration.
 *
 *   - /process-tasks-version: show the loaded extension version/path
 *   - /process-tasks-config: show the resolved configuration and any load warnings
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
    ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { BackgroundRegistry } from "./state.ts";
import { CONFIG_FILENAME, DEFAULTS, getConfigDir } from "./config.ts";
import type { UiContext } from "./types.ts";

// Upstream shipped this directory as the package root's `src/`, so `../package.json` was
// the extension's own manifest. Here it is vendored two levels down, and the version that
// matters is the preset's — there is no separate process-tasks package to report.
const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));

/**
 * Render the resolved config as a diff against the defaults. Showing only the
 * overrides answers the question actually being asked ("did my file take
 * effect?"); a full dump buries it among 16 unchanged lines.
 */
export function formatConfigReport(args: {
    reg: BackgroundRegistry;
    configPath: string | undefined;
    warnings: readonly string[];
}): string {
    const { config } = args.reg;
    const lines: string[] = [];
    lines.push(
        args.configPath
            ? `Config file: ${args.configPath}`
            : `Config file: none (would be read from ${join(getConfigDir(), CONFIG_FILENAME)})`
    );
    lines.push("");

    const overridden: string[] = [];
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
        const current = JSON.stringify(config[key]);
        const fallback = JSON.stringify(DEFAULTS[key]);
        if (current !== fallback) overridden.push(`  ${key}: ${current}  (default ${fallback})`);
    }
    if (overridden.length > 0) {
        lines.push("Overridden:", ...overridden);
    } else {
        lines.push("Overridden: nothing — every value is the default.");
    }

    if (args.warnings.length > 0) {
        lines.push("", "Warnings:", ...args.warnings.map((w) => `  • ${w}`));
    }

    lines.push(
        "",
        "Every key can also be set as an environment variable — timeoutMs → PROCESS_TASKS_TIMEOUT_MS —",
        "which takes precedence over the file."
    );
    return lines.join("\n");
}

/** Register all slash commands. */
export function registerCommands(
    pi: ExtensionAPI,
    reg: BackgroundRegistry,
    load: { configPath: string | undefined; warnings: readonly string[] }
): void {
    pi.registerCommand("process-tasks-version", {
        description: "Show the loaded process tasks extension version",
        handler: async (_args, ctx) => {
            const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
                name?: string;
                version?: string;
            };
            ctx.ui.notify(
                `${pkg.name ?? "my-pi-preset"}@${pkg.version ?? "unknown"} process-tasks loaded from ${extensionDir}`,
                "info"
            );
        },
    });

    pi.registerCommand("process-tasks-config", {
        description: "Show the resolved process-tasks configuration",
        handler: async (_args, ctx) => {
            // An editor pane, not a toast: a toast truncates, and config
            // warnings are exactly the thing one needs to read in full.
            await (ctx as unknown as UiContext).ui.editor(
                "process-tasks configuration",
                formatConfigReport({ reg, configPath: load.configPath, warnings: load.warnings })
            );
        },
    });
}
