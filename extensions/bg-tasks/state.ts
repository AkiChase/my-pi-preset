/**
 * Shared mutable state for the background-tasks extension.
 *
 * One instance per session, threaded through every tool and helper.
 */

import type { Job, ForegroundSlot } from "./types.ts";
import { DEFAULTS, type BgTasksConfig } from "./config.ts";

export class BackgroundRegistry {
    /** Resolved configuration for this session. Threaded with the registry
     *  because `reg` already reaches every tool and helper; the alternative —
     *  a module-level singleton read at import time — would make tests share
     *  one config and could not be injected. Defaults when unspecified so a
     *  test can `new BackgroundRegistry()` without loading a file. */
    readonly config: BgTasksConfig;

    constructor(config: BgTasksConfig = DEFAULTS) {
        this.config = config;
    }

    jobs = new Map<string, Job>();
    foreground = new Map<string, ForegroundSlot>();

    /** Per-job AbortController — abort() cancels all monitors/pollers for that job. */
    jobAborts = new Map<string, AbortController>();

    nonInteractive = false;

    completedCount = 0;
    failedCount = 0;
    killedCount = 0;
    totalStarted = 0;
    totalDurationMs = 0;
    /** Age-based metadata sweep; logs are not removed. */
    sweepTimer: NodeJS.Timeout | undefined = undefined;
    /** Closes the one active panel on shutdown/session replacement. */
    closePanel: (() => void) | undefined = undefined;
    panelOpen = false;

    /** Live-duration ticker for the foreground hand-off hint. */
    sidebarTimer: NodeJS.Timeout | undefined = undefined;
    /** Last rendered sidebar content — used to skip redundant widget updates. */
    lastSidebarContent: string | undefined = undefined;
    /** Last rendered background-hint content, for the same diff-before-write
     *  reason as the sidebar: the 1 Hz ticker redraws both. */
    lastHintContent: string | undefined = undefined;
}
