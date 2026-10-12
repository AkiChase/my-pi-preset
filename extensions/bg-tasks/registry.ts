/** Session-local jobs, footer counts and age-based metadata retention. */
import { randomInt } from "node:crypto";
import { resolve } from "node:path";
import { JOB_ID_PREFIX, REGISTRY_SWEEP_MS, TERMINAL_RETENTION_MS, isTerminalStatus, type Job, type JobKind, type UiContext } from "./types.ts";
import type { BackgroundRegistry } from "./state.ts";
import { readBoundedTail } from "./output.ts";
import { renderBackgroundHint } from "./hint.ts";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Random typed IDs avoid collisions between sessions sharing a log directory. */
export function newJobId(kind: JobKind, reg?: BackgroundRegistry): string {
    let id: string;
    do {
        let suffix = "";
        for (let i = 0; i < 8; i++) suffix += ID_ALPHABET[randomInt(0, ID_ALPHABET.length)];
        id = `${JOB_ID_PREFIX[kind]}${suffix}`;
    } while (reg?.jobs.has(id));
    return id;
}

export function logPathFor(reg: BackgroundRegistry, jobId: string): string {
    return resolve(reg.config.logDir, `${jobId}.log`);
}
export function errPathFor(reg: BackgroundRegistry, jobId: string): string {
    return resolve(reg.config.logDir, `${jobId}.err`);
}

export function createRunningJob(args: {
    id: string; command: string; pid: number; logPath: string; toolCallId: string;
    name?: string; kind?: JobKind; isBackgrounded?: boolean;
}): Job {
    return {
        ...args,
        startTime: Date.now(),
        status: "running",
        isBackgrounded: args.isBackgrounded ?? true,
    };
}

export function markStarted(reg: BackgroundRegistry): void { reg.totalStarted++; }
export function add(reg: BackgroundRegistry, job: Job): Job {
    reg.jobs.set(job.id, job);
    markStarted(reg);
    return job;
}
export function atConcurrencyLimit(reg: BackgroundRegistry): boolean {
    let n = 0;
    for (const job of reg.jobs.values()) {
        if (job.status === "running" && ++n >= reg.config.maxConcurrentJobs) return true;
    }
    return false;
}
export function findJob(reg: BackgroundRegistry, jobId: string): Job | undefined {
    return reg.jobs.get(jobId);
}

/** Reclaim metadata only. The transcript's absolute log paths remain usable. */
export function sweepTerminal(reg: BackgroundRegistry, now = Date.now()): number {
    let removed = 0;
    for (const [id, job] of reg.jobs) {
        if (isTerminalStatus(job.status) && job.endedAt !== undefined && now - job.endedAt >= TERMINAL_RETENTION_MS) {
            reg.jobs.delete(id);
            removed++;
        }
    }
    return removed;
}

/** Started by session events, never by the extension factory. */
export function startRegistrySweep(reg: BackgroundRegistry): void {
    stopRegistrySweep(reg);
    reg.sweepTimer = setInterval(() => sweepTerminal(reg), REGISTRY_SWEEP_MS);
    reg.sweepTimer.unref();
}
export function stopRegistrySweep(reg: BackgroundRegistry): void {
    if (reg.sweepTimer) clearInterval(reg.sweepTimer);
    reg.sweepTimer = undefined;
}

/** Historical name retained for callers; no aboveEditor task widget remains. */
export function renderSidebar(reg: BackgroundRegistry, ctx: UiContext): void {
    let tasks = 0;
    let monitors = 0;
    let live = false;
    for (const job of reg.jobs.values()) {
        if (job.status !== "running") continue;
        live = true;
        if (!job.isBackgrounded) continue;
        if (job.kind === "monitor") monitors++;
        else tasks++;
    }
    const key = reg.config.shortcutTaskPanel[0] ?? "/bg-list";
    const status = tasks + monitors > 0
        ? ctx.ui.theme.fg("accent", `▶ ${tasks} tasks · ◉ ${monitors} monitors · ${key}`)
        : undefined;
    if (status !== reg.lastSidebarContent) {
        reg.lastSidebarContent = status;
        ctx.ui.setStatus("background-jobs", status);
    }
    // Foreground durations still need their existing belowEditor hand-off hint.
    if (live) ensureSidebarTicker(reg, ctx);
    else stopSidebarTicker(reg);
}
function ensureSidebarTicker(reg: BackgroundRegistry, ctx: UiContext): void {
    if (reg.sidebarTimer) return;
    reg.sidebarTimer = setInterval(() => {
        try {
            renderSidebar(reg, ctx);
            renderBackgroundHint(reg, ctx);
        } catch {
            stopSidebarTicker(reg);
        }
    }, 1000);
    reg.sidebarTimer.unref();
}
export function stopSidebarTicker(reg: BackgroundRegistry): void {
    if (reg.sidebarTimer) clearInterval(reg.sidebarTimer);
    reg.sidebarTimer = undefined;
}

export interface JobStats {
    totalStarted: number; running: number; completed: number; failed: number;
    killed: number; averageDurationMs: number; totalDurationMs: number;
}
export function getStats(reg: BackgroundRegistry): JobStats {
    const terminalCount = reg.completedCount + reg.failedCount;
    return {
        totalStarted: reg.totalStarted,
        running: [...reg.jobs.values()].filter((job) => job.status === "running").length,
        completed: reg.completedCount,
        failed: reg.failedCount,
        killed: reg.killedCount,
        averageDurationMs: terminalCount > 0 ? Math.round(reg.totalDurationMs / terminalCount) : 0,
        totalDurationMs: reg.totalDurationMs,
    };
}
export function isRunning(job: Job): boolean { return job.status === "running"; }
export function readLogTail(job: Job, maxChars: number): string {
    return readBoundedTail(job.logPath, maxChars);
}
