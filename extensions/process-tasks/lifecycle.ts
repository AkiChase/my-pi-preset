/**
 * Lifecycle helpers for background jobs.
 *
 * Collects the cross-cutting concerns — completion notification, timeout
 * scheduling, terminal-state marking, and cleanup (kill) — in one place.
 * Monitoring (progress polling, stall detection) lives in monitoring.ts.
 */

import { statSync as fsStatSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    isTerminalStatus,
    type Job,
    type JobStatus,
    type UiContext,
} from "./types.ts";
import type { TaskLifecycleParticipant } from "../task-ui/lifecycle.ts";
import { stopRegistrySweep, stopSidebarTicker } from "./registry.ts";
import type { BackgroundRegistry } from "./state.ts";
import { killProcessTree, ownProcessExecution, type OwnedExecution, type SpawnExit } from "./spawn.ts";
import { atConcurrencyLimit, renderSidebar } from "./registry.ts";
import { watchStalls } from "./monitoring.ts";
import { markOutcomeSurfaced, sendTaskNotification } from "./notify.ts";

/** Backend-scoped ownership also usable by isolated factory fixtures. */
export function createProcessLifecycleParticipant(reg: BackgroundRegistry, disposeSource: () => void): TaskLifecycleParticipant {
    const safely = (callback: () => void) => {
        try { callback(); } catch (error) { console.error("[process-tasks] cleanup failed:", error); }
    };
    return {
        name: "process-tasks",
        freeze() {
            reg.closed = true;
            for (const job of reg.jobs.values()) markOutcomeSurfaced(job);
            reg.notificationRetries.clear();
        },
        stop() {
            safely(() => stopSidebarTicker(reg));
            safely(() => stopRegistrySweep(reg));
            for (const job of reg.jobs.values()) safely(() => terminateJobSilently(reg, job));
            for (const execution of reg.executions.values()) safely(() => execution.stop());
            for (const ac of reg.jobAborts.values()) safely(() => ac.abort());
            reg.jobAborts.clear();
            reg.foreground.clear();
        },
        async drain() {
            await Promise.all([...reg.executions.values()].map((execution) => execution.done));
        },
        dispose() { safely(disposeSource); },
    };
}

// --- Background-job orchestration ----------------------------------------

/** Throw a standard error when no concurrency slot is free. */
export function assertJobSlot(reg: BackgroundRegistry): void {
    if (reg.closed) throw new Error("Process task activation is closed");
    if (atConcurrencyLimit(reg)) {
        throw new Error(
            `Max concurrent background jobs (${reg.config.maxConcurrentJobs}) reached. ` +
                `Kill or wait for existing jobs before starting new ones.`
        );
    }
}

/**
 * Wire a background job's lifecycle: completion promise, abort controller,
 * stall watcher, and the exit→completeJob hand-off. The job must already be in
 * the registry. Returns the job's AbortController so callers can attach extra
 * monitors (e.g. a progress poller).
 */
export function startBackgroundJob(args: {
    reg: BackgroundRegistry;
    pi: ExtensionAPI;
    ctx: UiContext;
    job: Job;
    exit: Promise<SpawnExit>;
    execution?: OwnedExecution;
    notification?: NotificationOwner;
    /** Suppress the interactive-prompt stall heuristic (monitors stream their
     *  own output, so a quiet tail is normal, not a stuck prompt). */
    disablePromptStall?: boolean;
    /** Monitor-specific oversize owner; shell keeps the default warning path. */
    handleOversize?: () => void;
    onExit?: (result: SpawnExit) => void;
}): AbortController {
    const execution = args.execution ?? ownProcessExecution(args.job.pid, args.exit);
    args.reg.executions.set(args.job, execution);
    if (!args.job.stop) args.job.stop = () => execution.stop();
    void execution.done.then(() => {
        if (args.reg.executions.get(args.job) === execution) args.reg.executions.delete(args.job);
    });
    const cancelled = () => args.reg.closed || args.reg.jobs.get(args.job.id) !== args.job || isTerminalStatus(args.job.status);
    const stopSetup = () => {
        // A terminal Job may still own a newly constructed monitor source. Its
        // stop hook closes observation/fd; pid 0 execution.stop alone cannot.
        try { args.job.stop?.(); } catch (error) { console.error("[process-tasks] setup stop failed:", error); }
        finally {
            execution.stop();
            args.reg.notificationRetries.delete(args.job.id);
            abortJob(args.reg, args.job.id);
            if (args.reg.jobs.get(args.job.id) === args.job) markKilledSilently(args.reg, args.job);
            args.job.resolveDone?.();
            delete args.job.resolveDone;
            delete args.job.donePromise;
            delete args.job.stop;
            delete args.job.proc;
        }
    };
    if (cancelled()) {
        stopSetup();
        const settled = new AbortController();
        settled.abort();
        return settled;
    }
    ensureCompletionPromise(args.job);
    if ((args.notification ?? "auto") === "auto") {
        args.reg.notificationRetries.set(args.job.id, () => {
            if (args.reg.jobs.get(args.job.id) === args.job && isTerminalStatus(args.job.status) && args.job.isBackgrounded) {
                sendTaskNotification({ reg: args.reg, pi: args.pi, job: args.job });
            }
        });
    }
    const jobAc = createJobAbort(args.reg, args.job.id);
    const cancelStall = watchStalls({
        jobId: args.job.id,
        command: args.job.command,
        name: args.job.name,
        logPath: args.job.logPath,
        pi: args.pi,
        disablePromptStall: args.disablePromptStall,
        handleOversize: args.handleOversize,
        onOversize: () => terminateJobSilently(args.reg, args.job),
        config: args.reg.config,
    });
    jobAc.signal.addEventListener("abort", cancelStall, { once: true });
    void args.exit.then((result) => {
        // Session replacement clears the map; an old process's late exit must
        // not notify or mutate counters belonging to the new session.
        if (args.reg.closed || args.reg.jobs.get(args.job.id) !== args.job) return;
        if (isTerminalStatus(args.job.status)) return;
        try { args.onExit?.(result); } catch (error) { console.error("[process-tasks] exit hook failed:", error); }
        try { completeJob({
            job: args.job,
            code: result.code,
            signal: result.signal,
            reg: args.reg,
            pi: args.pi,
            ctx: args.ctx,
            notification: args.notification,
        }); } catch (error) {
            stopSidebarTicker(args.reg);
            console.error("[process-tasks] completion display failed:", error);
        }
    });
    renderSidebar(args.reg, args.ctx);
    // Registry subscribers and UI hooks are synchronous and can close this
    // activation during rendering, even before a caller attaches abort wiring.
    if (cancelled() || jobAc.signal.aborted) {
        cancelStall();
        stopSidebarTicker(args.reg);
        stopSetup();
        jobAc.abort();
    }
    return jobAc;
}

// --- Terminal-state marking ----------------------------------------------

/**
 * Who is responsible for a job's terminal <task-notification>.
 *
 *   - "auto" (default): completeJob sends it on exit.
 *   - "self": the caller sends its own stream-specific summary.
 *   - "suppressed": `bash_bg notify: false` — never sent.
 *
 * Notification ownership does not affect retention: all terminal records stay
 * for ten minutes, whether or not their outcome reached the agent.
 */
export type NotificationOwner = "auto" | "self" | "suppressed";

/**
 * Standard completion flow after a job exits — abortJob → markTerminal →
 * notify → renderSidebar. Shared by every tool's exit callback (bash,
 * bash_bg, monitor) as the canonical termination protocol.
 *
 * Notifications never evict metadata; the session sweep owns retention.
 */
export function completeJob(args: {
    job: Job;
    code: number | null | undefined;
    /** The signal that killed the job, when it died by signal. */
    signal?: NodeJS.Signals | null;
    reg: BackgroundRegistry;
    pi: ExtensionAPI;
    ctx: UiContext;
    notification?: NotificationOwner;
}): void {
    if (isTerminalStatus(args.job.status)) return;
    // The caller passes the authoritative Job (the object held in the registry),
    // so no lookup is needed.
    const finished = args.job;
    abortJob(args.reg, finished.id);
    markTerminal(args.reg, finished, statusFromExit(args.code, args.signal), args.code ?? undefined);
    if ((args.notification ?? "auto") === "auto" && finished.isBackgrounded) {
        sendTaskNotification({ reg: args.reg, pi: args.pi, job: finished });
    }
    renderSidebar(args.reg, args.ctx);
}

/**
 * Mark a job terminal and resolve its donePromise. Idempotent — already-
 * terminal jobs are ignored. The proc reference is dropped explicitly for GC.
 */
export function markTerminal(
    reg: BackgroundRegistry,
    job: Job,
    status: JobStatus,
    exitCode?: number
): void {
    if (isTerminalStatus(job.status) || !isTerminalStatus(status)) return;
    job.status = status;
    job.exitCode = exitCode;
    job.endedAt = Date.now();
    if (status === "completed") reg.completedCount++;
    else if (status === "failed") reg.failedCount++;
    else reg.killedCount++;
    // Preserve the existing average's success/failure denominator.
    if (status !== "killed") reg.totalDurationMs += job.endedAt - job.startTime;
    abortJob(reg, job.id);
    delete job.proc;
    delete job.stop;
    if (job.resolveDone) {
        job.resolveDone();
        delete job.resolveDone;
    }
    delete job.donePromise;
    reg.changed();
}

/** Map an exit result to a JobStatus: a signal death (external kill, OOM) is
 *  "killed" (CC marks these killed), exit code 0 is "completed", anything else
 *  is "failed". */
export function statusFromExit(
    code: number | null | undefined,
    signal?: NodeJS.Signals | null
): JobStatus {
    if (signal) return "killed";
    return code === 0 ? "completed" : "failed";
}

/**
 * Create a job's donePromise. This is the entry point that attach/log-wait
 * flows await for a result. Idempotent — does not recreate an existing promise.
 */
export function ensureCompletionPromise(job: Job): void {
    if (job.donePromise) return;
    let resolveDone: (() => void) | undefined;
    job.donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve;
    });
    job.resolveDone = resolveDone;
}

/**
 * Mark a job "killed" and record its outcome as already surfaced, so the exit
 * callback does not emit a spurious completion notification on any
 * termination path. `markTerminal` flips status to "killed" first;
 * `markOutcomeSurfaced` then records that no <task-notification> is needed
 * (Claude Code parity — a deliberate kill is intentional cleanup the agent
 * already knows about).
 */
export function markKilledSilently(reg: BackgroundRegistry, job: Job): void {
    markTerminal(reg, job, "killed");
    markOutcomeSurfaced(job);
}

/** Kill a job quietly and abort its registered monitors/timers. The outcome is
 *  marked surfaced BEFORE the kill so the exit handler's notification is
 *  suppressed (panel x, jobs kill, session quit). */
export function terminateJobSilently(reg: BackgroundRegistry, job: Job): void {
    if (isTerminalStatus(job.status)) return;
    markOutcomeSurfaced(job);
    reg.notificationRetries.delete(job.id);
    try { terminateJob(job); } catch (error) { console.error("[process-tasks] stop hook failed:", error); }
    finally {
        reg.executions.get(job)?.stop();
        markKilledSilently(reg, job);
        abortJob(reg, job.id);
    }
}

// --- Per-job abort (cleanup) ---------------------------------------------

/** Create an AbortController for a job. Aborting it cancels all monitors. */
export function createJobAbort(
    reg: BackgroundRegistry,
    jobId: string
): AbortController {
    const existing = reg.jobAborts.get(jobId);
    if (existing) return existing;
    const ac = new AbortController();
    reg.jobAborts.set(jobId, ac);
    return ac;
}

/** Abort all monitors for a job and remove the controller. */
export function abortJob(reg: BackgroundRegistry, jobId: string): void {
    const ac = reg.jobAborts.get(jobId);
    if (ac) {
        ac.abort();
        reg.jobAborts.delete(jobId);
    }
}

/**
 * Kill a job — SIGTERM the live process group if the proc handle is present,
 * otherwise signal the recorded PID directly (covers jobs whose proc handle
 * was already dropped).
 */
export function terminateJob(job: Job): void {
    // Monitors carry a transient teardown hook (follower + ws socket). A ws
    // monitor has pid 0, so the process-tree kill below is a no-op for it and
    // job.stop does the real work; a command monitor needs both.
    if (job.stop) job.stop();
    else killProcessTree(job.proc?.pid ?? job.pid, "SIGTERM");
}

// --- Helpers -------------------------------------------------------------

/** Verify the cwd actually exists. Throws a clear error if not. */
export function requireExistingCwd(cwd: string): void {
    try {
        fsStatSync(cwd);
    } catch {
        throw new Error(`Working directory does not exist: ${cwd}`);
    }
}

/** True for whitespace-only commands. bash silently passes empty commands, so reject them explicitly. */
export function isBlankCommand(command: string): boolean {
    return command.trim().length === 0;
}

/**
 * True when the command is eligible for auto-backgrounding. Rejects commands
 * like `sleep` where backgrounding is pointless.
 */
const DISALLOWED_AUTO_BACKGROUND = new Set(["sleep"]);
export function isAutoBackgroundAllowed(command: string): boolean {
    const base = command.trim().split(/\s+/)[0] ?? "";
    return !DISALLOWED_AUTO_BACKGROUND.has(base);
}

/**
 * Actionable guidance shown when a naive `sleep N` wait is blocked. A fixed
 * sleep both wastes time and leaves a lingering background job; every bullet
 * points at a tool that ends as soon as the real work does.
 */
export const SLEEP_WAIT_GUIDANCE =
    "A fixed `sleep N` to wait wastes time and leaves a job lingering for the " +
    "full duration. Instead:\n" +
    "• Waiting on a background job you started? Use jobs action='attach' — it " +
    "returns as soon as that job finishes.\n" +
    "• Waiting for a condition? Use the monitor tool, or a poll loop that EXITS " +
    "when ready (e.g. `until grep -q READY log; do sleep 0.5; done`).\n" +
    "• Just pacing/rate-limiting? Keep it under 2 seconds.";

/** A bare `sleep N[unit]` that counts as a wait (>= 2s). Float durations
 *  (`sleep 0.5`) and sub-2s integer sleeps are deliberate pacing — allowed. */
function detectSleepClause(segment: string): string | null {
    // Allow a trailing `&` — a backgrounded `sleep 600 &` is itself a lingering job.
    const m = /^sleep\s+(\d+)([smhd]?)\s*&?\s*$/.exec(segment);
    if (!m) return null;
    const unit = m[2] || "s";
    if (unit === "s" && parseInt(m[1], 10) < 2) return null;
    return `sleep ${m[1]}${m[2]}`;
}

/**
 * Detect a `sleep N` used as a naive wait — `sleep 600`, `cd x; sleep 600;
 * check`, `build && sleep 5 && test`, `sleep 5m`. Catches it as a top-level
 * step in a flat command sequence (split on top-level `;`, `&&`, `||`).
 *
 * Deliberately conservative around control flow: a `sleep` inside a while/until/
 * for loop is the *correct* polling pattern, and subshells / command
 * substitution make flat splitting unsafe — there we check only the leading
 * command, so a legitimate `until ready; do sleep 1; done` is never flagged.
 *
 * Returns the offending `sleep` clause, or null.
 */
export function detectBlockedSleep(command: string): string | null {
    const trimmed = command.trim();
    // Only an actual loop body can leave a bare `sleep N` segment after a flat
    // split (`do work; sleep 5; done`); an if/case block keeps its `then`/`)`
    // prefix on the sleep, so those don't need special handling. We detect the
    // structural loop pairing (not loose keywords, so `echo done` is fine) and
    // grouping/command-substitution, and fall back to the leading command there.
    const unsafeToSplit =
        /\b(while|until|for)\b[\s\S]*?\bdo\b/.test(trimmed) ||
        /\bdo\b[\s\S]*?\bdone\b/.test(trimmed) ||
        /[(){}`]|\$\(/.test(trimmed);
    // Newline is bash's primary command separator, alongside ; && || — split on
    // all of them so `start-server\nsleep 5\ncurl` is caught like `…; sleep 5; …`.
    const SEPARATORS = /&&|\|\||;|\n/;
    const segments = unsafeToSplit
        ? [trimmed.split(SEPARATORS)[0] ?? ""]
        : trimmed.split(SEPARATORS);
    for (const segment of segments) {
        const clause = detectSleepClause(segment.trim());
        if (clause) return clause;
    }
    return null;
}

// --- Non-interactive mode detection --------------------------------------

/** Detect whether pi is running non-interactively (print / non-TTY). */
export function detectNonInteractive(
    argv: readonly string[],
    stdinIsTTY: boolean
): boolean {
    if (!stdinIsTTY) return true;
    return argv.includes("-p") || argv.includes("--print");
}
