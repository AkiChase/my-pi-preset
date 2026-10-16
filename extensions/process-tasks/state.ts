/**
 * Shared mutable state for the process-tasks extension.
 *
 * One instance per session, threaded through every tool and helper.
 */

import { MonitorNotifications } from "./monitor-notifications.ts";
import { TaskCoordinator } from "../task-ui/coordinator.ts";
import { DEFAULTS as UI_DEFAULTS, type TaskUIConfig } from "../task-ui/config.ts";
import type { OwnedExecution } from "./spawn.ts";
import type { Job, ForegroundSlot, UiContext } from "./types.ts";
import { DEFAULTS, type ProcessTasksConfig } from "./config.ts";

export interface HintPublisher {
    set(ctx: UiContext, lines: readonly string[] | undefined): boolean;
    dispose(): void;
}

export class BackgroundRegistry {
    /** Finite activation publisher; isolated backend fixtures may omit display. */
    hintPublisher: HintPublisher | undefined;
    /** Resolved configuration for this session. Threaded with the registry
     *  because `reg` already reaches every tool and helper; the alternative —
     *  a module-level singleton read at import time — would make tests share
     *  one config and could not be injected. Defaults when unspecified so a
     *  test can `new BackgroundRegistry()` without loading a file. */
    readonly config: ProcessTasksConfig;

    readonly monitorNotifications: MonitorNotifications;
    readonly coordinator: TaskCoordinator;
    readonly uiConfig: TaskUIConfig;
    constructor(config: ProcessTasksConfig = DEFAULTS, coordinator = new TaskCoordinator(), uiConfig: TaskUIConfig = UI_DEFAULTS) {
        this.config = config;
        this.coordinator = coordinator;
        this.uiConfig = uiConfig;
        this.monitorNotifications = new MonitorNotifications(this);
    }

    private readonly listeners = new Set<() => void>();
    revision = 0;
    changed(): void {
        this.revision++;
        for (const listener of [...this.listeners]) {
            try { listener(); } catch (error) { console.error("[process-tasks] subscription failed:", error); }
        }
    }
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** Closed only by final shutdown, never by a cancellable before-switch event. */
    closed = false;
    /** Backend-only live execution ownership, independent of terminal metadata. */
    readonly executions = new Map<Job, OwnedExecution>();

    jobs = new Map<string, Job>();
    foreground = new Map<string, ForegroundSlot>();

    /** Per-job AbortController — abort() cancels all monitors/pollers for that job. */
    jobAborts = new Map<string, AbortController>();

    /** Terminal shell delivery recheck after the last retrieval wait is cancelled. */
    notificationRetries = new Map<string, () => void>();

    nonInteractive = false;

    completedCount = 0;
    failedCount = 0;
    killedCount = 0;
    totalStarted = 0;
    totalDurationMs = 0;
    /** Age-based metadata sweep; logs are not removed. */
    sweepTimer: NodeJS.Timeout | undefined = undefined;
    /** Live-duration ticker for the foreground hand-off hint. */
    sidebarTimer: NodeJS.Timeout | undefined = undefined;
    /** Last rendered foreground hint content, for diff-before-write. */
    lastHintContent: string | undefined = undefined;
}
