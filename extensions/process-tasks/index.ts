/**
 * Background tasks for the pi agent — vendored fork of pi-patty-bg-tasks.
 * See PROVENANCE.md for the upstream commit this diverged from.
 *
 * Registers bash (override) and monitor (streaming-event watch).
 * Returns a finite management capability to composition's unique process_manage.
 * Also registers process diagnostic commands; shared controls belong to composition.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { BackgroundRegistry } from "./state.ts";
import { createProcessLifecycleParticipant, detectNonInteractive, terminateJobSilently } from "./lifecycle.ts";
import { startRegistrySweep, stopRegistrySweep, stopSidebarTicker } from "./registry.ts";
import { EVENT } from "./types.ts";
import { loadConfig } from "./config.ts";
import { registerBashTool } from "./tools/bash.ts";
import { registerMonitorTool } from "./tools/monitor.ts";
import { registerCommands } from "./commands.ts";
import { TaskLifecycle } from "../task-ui/lifecycle.ts";
import { TaskCoordinator } from "../task-ui/coordinator.ts";
import { loadConfig as loadUIConfig, type TaskUIConfig } from "../task-ui/config.ts";
import { registerTaskControls } from "../task-ui/controls.ts";
import { createProcessTaskSource } from "./source.ts";
import { createTaskUIOwner } from "../task-ui/owner.ts";
import { renderProcessNotification } from "./notification-renderer.ts";

import { createProcessManagement } from "./management.ts";
import type { RuntimeTaskCapability } from "../runtime-tasks/facade.ts";

export interface ProcessTasksOptions {
    readonly onManagement?: (capability: RuntimeTaskCapability) => void;
    readonly coordinator?: TaskCoordinator;
    readonly lifecycle?: TaskLifecycle;
    readonly uiConfig?: TaskUIConfig;
}

/** Extension entry point. */
export default function (pi: ExtensionAPI, options: ProcessTasksOptions = {}) {
    // Read synchronously, before anything is registered: registerShortcut and
    // the tool descriptions below both need the resolved values, and there is
    // no await available at extension load.
    const { config, warnings, path: configPath } = loadConfig();
    const ownsCoordinator = options.coordinator === undefined;
    const uiLoad = options.uiConfig ? { config: options.uiConfig, warnings: [] } : loadUIConfig();
    const coordinator = options.coordinator ?? new TaskCoordinator();
    const lifecycle = options.lifecycle ?? new TaskLifecycle(coordinator);
    const reg = new BackgroundRegistry(config, coordinator, uiLoad.config);
    const source = createProcessTaskSource(reg);
    options.onManagement?.(createProcessManagement(reg, source));
    const unregisterSource = coordinator.registerSource(source);
    // Surface config problems where they will actually be seen. There is no UI
    // context yet at load time, so stderr now (pi's log) and `/process-tasks-version`
    // later — a silently-ignored knob reads as "the extension is broken".
    for (const warning of warnings) {
        console.error(`[process-tasks] config: ${warning}`);
    }

    // ── Tool registration ─────────────────────────────────────────
    // Use the unwrapped tool *definition* so the override inherits Pi's native
    // bash renderCall/renderResult (createBashTool returns a wrapped AgentTool
    // that drops them).
    const originalBash = createBashToolDefinition(process.cwd());
    registerBashTool(pi, reg, originalBash);
    registerMonitorTool(pi, reg);

    // Direct factory fixtures get scoped shared controls; production composition registers them once.
    const uiOwner = ownsCoordinator ? createTaskUIOwner(pi, coordinator, lifecycle, uiLoad.config) : undefined;
    const shortcutWarnings = uiOwner
        ? registerTaskControls(pi, coordinator, uiLoad.config, uiOwner.openPanel) : [];
    for (const warning of [...uiLoad.warnings, ...shortcutWarnings]) console.error(`[task-ui] config: ${warning}`);
    registerCommands(pi, reg, { configPath, warnings });

    // ── Message rendering ─────────────────────────────────────────
    // Delivery, batching, and terminal-outcome ownership remain in notify.ts
    // and monitor-notifications.ts. This is only the custom-message view.
    const renderTaskNotification = (message: { content: unknown; details?: unknown }, options: { expanded: boolean; outputPad: number }, theme: Parameters<typeof renderProcessNotification>[2]) =>
        renderProcessNotification(message, options, theme, config);
    pi.registerMessageRenderer(EVENT.taskNotification, (message, options, theme) =>
        renderTaskNotification(message, options, theme)
    );
    pi.registerMessageRenderer(EVENT.monitorEvent, (message, options, theme) =>
        renderTaskNotification(message, options, theme)
    );
    pi.registerMessageRenderer(EVENT.stall, (message, options, theme) =>
        renderTaskNotification(message, options, theme)
    );

    // ── Session start ─────────────────────────────────────────────
    // Claude Code parity: the registry is purely in-memory — no persistence,
    // no revival. Every session starts with an empty registry.
    pi.on("session_start", async (_event, ctx) => {
        if (reg.closed) return;
        // A fresh context cannot reuse a panel/ticker captured from the prior
        // session. Shutdown normally runs first; this is the switch fallback.
        reg.monitorNotifications.reset();
        stopSidebarTicker(reg);
        stopRegistrySweep(reg);
        for (const job of reg.jobs.values()) {
            if (job.status === "running") terminateJobSilently(reg, job);
        }
        reg.jobs.clear();
        reg.notificationRetries.clear();
        reg.foreground.clear();
        reg.changed();
        if (reg.closed) return;
        reg.completedCount = reg.failedCount = reg.killedCount = 0;
        reg.totalStarted = reg.totalDurationMs = 0;
        startRegistrySweep(reg);
        reg.nonInteractive = detectNonInteractive(
            process.argv,
            Boolean(process.stdin.isTTY)
        );
    });

    lifecycle.register(createProcessLifecycleParticipant(reg, () => {
        try { unregisterSource(); } finally { source.dispose(); }
    }));
    // Production composition registers the sole protocol handler after backend setup.
    if (!options.lifecycle) pi.on("session_shutdown", async () => { await lifecycle.shutdown(); });
    return { coordinator, lifecycle, source };
}
