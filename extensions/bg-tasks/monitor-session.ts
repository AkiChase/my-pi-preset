/**
 * The monitor session lifecycle — the tricky part of the monitor tool, lifted
 * out of the tool action so its invariants are unit-testable through a fake
 * MonitorSource (no real spawning, no real sockets).
 *
 * Responsibilities: coalesce new log lines into bounded stream events,
 * throttle a firehose down to a suppressed-line count, emit exactly one
 * terminal event (on natural exit, kill, timeout, or sustained overflow), and
 * tear the source down. The tool just validates, builds a source, and hands it
 * here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundRegistry } from "./state.ts";
import {
    DELIVER_PASSIVE,
    EVENT,
    type Job,
    type UiContext,
} from "./types.ts";
import { renderSidebar } from "./registry.ts";
import { startBackgroundJob, terminateJobSilently } from "./lifecycle.ts";
import { followLines, type MonitorFollower } from "./monitor-follow.ts";
import type { MonitorSource } from "./monitor-source.ts";
import { completionSummary, sendTaskNotification, type TerminalStatus } from "./notify.ts";

/**
 * Wire a monitor's source to its event stream, terminal event, deadline, and
 * teardown. The job must already be in the registry. Returns nothing — the
 * session runs until the source ends, the deadline fires, or it is killed.
 */
export function startMonitorSession(args: {
    pi: ExtensionAPI;
    reg: BackgroundRegistry;
    ctx: UiContext;
    job: Job;
    source: MonitorSource;
    description: string;
    persistent: boolean;
    timeoutMs: number;
}): void {
    const { pi, reg, ctx, job, source, description, persistent, timeoutMs } = args;
    const { id, logPath } = job;
    const {
        monitorPollMs,
        monitorFlushMs,
        monitorMaxLinesPerEvent,
        monitorRateWindowMs,
        monitorMaxLinesPerWindow,
        monitorMaxOverflowWindows,
    } = reg.config;

    let terminalEmitted = false;
    let windowStart = Date.now();
    let windowLines = 0;
    let overflowWindows = 0;

    // Coalescing buffer. `pending` holds lines waiting for the next flush;
    // `suppressed` counts lines deliberately not shown (over the per-event cap
    // or over the rate budget), reported as one line instead.
    let pending: string[] = [];
    let suppressed = 0;
    let flushTimer: NodeJS.Timeout | undefined;

    // Stream events stay live but passive (never a wake) — they carry data the
    // agent is actively watching and surface on its next natural turn without
    // spawning an unsolicited one. The terminal notice (stream ended / stopped
    // / failed) is its own <task-notification> (see finishMonitor), sent the
    // moment the source ends.
    const emitEvent = (lines: string[]): void => {
        if (lines.length === 0) return;
        pi.sendMessage(
            {
                customType: EVENT.monitorEvent,
                content: `◉ ${description}\n${lines.join("\n")}`,
                display: true,
                details: { jobId: id, description, logPath, terminal: false },
            },
            DELIVER_PASSIVE
        );
    };

    /**
     * Emit whatever is buffered as ONE event, bounded by
     * monitorMaxLinesPerEvent. Returns true when something was emitted, which
     * is how the throttle timer knows the stream is still hot.
     */
    const flush = (): boolean => {
        const shown = pending.slice(0, monitorMaxLinesPerEvent);
        suppressed += pending.length - shown.length;
        pending = [];
        if (suppressed > 0) {
            // The lines are not lost, just not spent on context — say where
            // they are, since that is the whole justification for dropping them.
            shown.push(`[${suppressed} more lines not shown — full output in ${logPath}]`);
            suppressed = 0;
        }
        if (shown.length === 0) return false;
        emitEvent(shown);
        return true;
    };

    /** Re-arm the throttle for as long as lines keep arriving. */
    const armFlush = (): void => {
        const t = setTimeout(() => {
            if (terminalEmitted) return;
            if (flush()) armFlush();
            else flushTimer = undefined;
        }, monitorFlushMs);
        t.unref();
        flushTimer = t;
    };

    const follower: MonitorFollower = followLines(
        logPath,
        (lines) => {
            if (terminalEmitted) return;

            // Sliding rate window. Rolling it here (rather than on a timer)
            // means a stream that stops never escalates — correct, since there
            // is nothing left to suppress.
            const now = Date.now();
            if (now - windowStart > monitorRateWindowMs) {
                overflowWindows =
                    windowLines > monitorMaxLinesPerWindow ? overflowWindows + 1 : 0;
                windowStart = now;
                windowLines = 0;
            }
            windowLines += lines.length;

            if (windowLines > monitorMaxLinesPerWindow) {
                // Over budget: keep counting, stop spending context. Upstream
                // killed the monitor here instead — and killed it AFTER
                // emitting the whole overflowing batch, so a single burst cost
                // the full context AND the watch.
                suppressed += lines.length;
            } else {
                pending.push(...lines);
            }

            if (overflowWindows >= monitorMaxOverflowWindows) {
                stopMonitor(
                    "killed",
                    `Monitor "${description}" stopped (over ${monitorMaxLinesPerWindow} lines/${monitorRateWindowMs / 1000}s for ${overflowWindows} windows — restart with a tighter filter)`
                );
                return;
            }

            // Leading edge: the first lines after a quiet period go out at once,
            // so a slow watch reads live. Everything after them batches until
            // the window closes.
            if (flushTimer === undefined) {
                flush();
                armFlush();
            }
        },
        monitorPollMs
    );

    // job.stop: transient teardown invoked by the kill path. Tears down the
    // source (closes the ws socket) — the follower is stopped *and flushed* by
    // finishMonitor on the exit path (kill → process/socket close → exit →
    // onExit), so a user-initiated kill stays lossless.
    job.stop = source.stop;

    /**
     * Emit exactly one terminal <task-notification> for the monitor. Sent
     * before the job is marked terminal (onExit runs ahead of completeJob), so
     * the status/summary are explicit and eviction is left to completeJob.
     */
    const finishMonitor = (status: TerminalStatus, summary: string): void => {
        if (terminalEmitted) return;
        // Ordering matters three ways: the follower's final read must happen
        // while terminalEmitted is false (or its callback drops the lines), the
        // buffer must then be flushed EXPLICITLY rather than waiting for the
        // throttle (or the last lines arrive after "stream ended"), and the
        // timer must be cleared so a pending tick cannot emit after the
        // terminal event.
        follower.stop(true);
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = undefined;
        }
        flush();
        terminalEmitted = true;
        sendTaskNotification({ reg, pi, job, status, summary, evict: false });
    };

    /** Forced stop (timeout / firehose). Emits a terminal event, then routes
     *  through the standard silent-kill path (which calls job.stop). */
    function stopMonitor(status: TerminalStatus, summary: string): void {
        finishMonitor(status, summary);
        terminateJobSilently(reg, job);
        renderSidebar(reg, ctx);
    }

    // Wire exit → terminal event. notification:"self" because the monitor owns
    // its own terminal event (no double-fire from completeJob). Monitors stream their
    // own output, so the prompt-stall heuristic is nonsensical here; the oversize
    // cap is also suppressed for persistent watches (session-length log tails are
    // expected to grow).
    const jobAc = startBackgroundJob({
        reg,
        pi,
        ctx,
        job,
        exit: source.exit,
        notification: "self",
        disablePromptStall: true,
        disableOversizeKill: persistent,
        onExit: ({ code, signal }) => {
            // A signal death (external kill) is the "stopped" summary, never
            // "stream ended". Natural exits reuse completionSummary — the job
            // carries name: description, so the summary names the watch.
            if (job.status === "killed" || signal !== null) {
                finishMonitor("killed", completionSummary(job, "killed"));
            } else if (code === 0) {
                finishMonitor("completed", completionSummary(job, "completed"));
            } else {
                // completeJob marks terminal after onExit — set the exit code
                // now so completionSummary can name it.
                job.exitCode = code ?? undefined;
                finishMonitor("failed", completionSummary(job, "failed"));
            }
        },
    });

    // Deadline (skipped for persistent watches). Cleared when the job aborts
    // (natural exit or kill) so a short monitor doesn't keep a live timer +
    // closure alive for the whole timeout window.
    if (!persistent) {
        const deadline = setTimeout(() => {
            stopMonitor(
                "killed",
                `Monitor "${description}" stopped (timeout after ${Math.round(timeoutMs / 1000)}s)`
            );
        }, timeoutMs);
        (deadline as NodeJS.Timeout).unref();
        jobAc.signal.addEventListener("abort", () => clearTimeout(deadline), { once: true });
    }
}
