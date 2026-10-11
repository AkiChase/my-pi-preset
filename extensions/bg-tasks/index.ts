/**
 * Background tasks for the pi agent — vendored fork of pi-patty-bg-tasks.
 * See PROVENANCE.md for the upstream commit this diverged from.
 *
 * Registers five tools:
 *   - bash (override)
 *   - bash_bg
 *   - jobs
 *   - agent_bg
 *   - monitor (streaming-event watch)
 *
 * Also registers keyboard shortcuts and slash commands.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { BackgroundRegistry } from "./state.ts";
import { detectNonInteractive, terminateJobSilently } from "./lifecycle.ts";
import { stopSidebarTicker } from "./registry.ts";
import { EVENT } from "./types.ts";
import { loadConfig } from "./config.ts";
import { registerBashTool } from "./tools/bash.ts";
import { registerBashBgTool } from "./tools/bash-bg.ts";
import { registerJobsTool } from "./tools/jobs.ts";
import { registerAgentBgTool } from "./tools/agent-bg.ts";
import { registerMonitorTool } from "./tools/monitor.ts";
import { registerShortcuts } from "./shortcuts.ts";
import { registerCommands } from "./commands.ts";
import { registerInputHandlers } from "./input.ts";

/** Extension entry point. */
export default function (pi: ExtensionAPI): void {
    // Read synchronously, before anything is registered: registerShortcut and
    // the tool descriptions below both need the resolved values, and there is
    // no await available at extension load.
    const { config, warnings, path: configPath } = loadConfig();
    const reg = new BackgroundRegistry(config);
    // Surface config problems where they will actually be seen. There is no UI
    // context yet at load time, so stderr now (pi's log) and `/bg-version`
    // later — a silently-ignored knob reads as "the extension is broken".
    for (const warning of warnings) {
        console.error(`[bg-tasks] config: ${warning}`);
    }

    // ── Tool registration ─────────────────────────────────────────
    // Use the unwrapped tool *definition* so the override inherits Pi's native
    // bash renderCall/renderResult (createBashTool returns a wrapped AgentTool
    // that drops them).
    const originalBash = createBashToolDefinition(process.cwd());
    registerBashTool(pi, reg, originalBash);
    registerBashBgTool(pi, reg);
    registerJobsTool(pi, reg);
    registerAgentBgTool(pi, reg);
    registerMonitorTool(pi, reg);

    // ── Shortcuts / commands ──────────────────────────────────────
    // A chord pi rejects is reported alongside the config warnings rather than
    // thrown — one bad key must not cost the other shortcuts.
    const shortcutWarnings = registerShortcuts(pi, reg);
    for (const warning of shortcutWarnings) {
        console.error(`[bg-tasks] shortcut: ${warning}`);
    }
    registerCommands(pi, reg, {
        configPath,
        warnings: [...warnings, ...shortcutWarnings],
    });
    registerInputHandlers(pi, reg);

    // ── Message rendering ─────────────────────────────────────────
    // <task-notification> messages render as one colored line: green for
    // completed, red for failed, yellow for killed and for the statusless
    // stall warning (CC's unread/attention color).
    const renderTaskNotification = (
        message: { content: unknown; details?: unknown },
        theme: { fg(colour: string, text: string): string }
    ) => {
        const details = message.details as
            | { status?: string; summary?: string; outputTail?: string }
            | undefined;
        const colour =
            details?.status === "completed"
                ? "success"
                : details?.status === "failed"
                  ? "error"
                  : "warning";
        const line = theme.fg(colour, `● ${details?.summary ?? String(message.content)}`);
        // A backgrounded job's output never appears anywhere else in the TUI, so
        // a failure summary alone leaves the user with nothing to look at. Show
        // the last few lines of the inlined tail (the model gets all of it in
        // the XML); the full log is at details.outputFile.
        // `slice(-0)` is `slice(0)` — the whole array — so 0 must be handled
        // explicitly or "show no tail" would show all of it.
        const tail =
            details?.outputTail && config.failureTailLinesShown > 0
                ? details.outputTail
                      .split("\n")
                      .slice(-config.failureTailLinesShown)
                      .map((l) => theme.fg("dim", `  │ ${l}`))
                : [];
        return { render: () => [line, ...tail], invalidate: () => {} };
    };
    pi.registerMessageRenderer(EVENT.taskNotification, (message, _options, theme) =>
        renderTaskNotification(message, theme)
    );
    pi.registerMessageRenderer(EVENT.stall, (message, _options, theme) =>
        renderTaskNotification(message, theme)
    );

    // ── Session start ─────────────────────────────────────────────
    // Claude Code parity: the registry is purely in-memory — no persistence,
    // no revival. Every session starts with an empty registry.
    pi.on("session_start", async (_event, _ctx) => {
        reg.nonInteractive = detectNonInteractive(
            process.argv,
            Boolean(process.stdin.isTTY)
        );
    });

    // ── Session shutdown ──────────────────────────────────────────
    pi.on("session_shutdown", async (_event, _ctx) => {
        // Stop the live-duration ticker so the interval doesn't outlive the session.
        stopSidebarTicker(reg);

        // Claude Code's gracefulShutdown: kill ALL running tasks on ANY
        // shutdown reason, so no orphans outlive the session. The silent-kill
        // path marks the outcome surfaced, so no <task-notification> fires on
        // the way out. Log files are left for the OS to clean.
        for (const job of reg.jobs.values()) {
            if (job.status === "running") {
                terminateJobSilently(reg, job);
            }
        }
    });
}
