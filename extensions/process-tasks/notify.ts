/**
 * Task-completion notifications — Claude Code's <task-notification> engine.
 *
 * Every backgrounded shell job that reaches a terminal state enqueues its OWN
 * notification message, exactly once, the moment it exits. Shell notifications
 * have no hold-and-flush or coalescing window; monitor delivery belongs to the
 * registry's MonitorNotifications scheduler. Pi's steer delivery queues the
 * message while the agent is streaming and delivers it at the next tool-call
 * boundary (CC's 'next' priority), or starts a turn when the agent is idle
 * (triggerTurn: true).
 *
 * Exactly-once is enforced by the job's `outcomeSurfaced` latch, set after a
 * successful send, so any path that already surfaced the outcome (a jobs
 * output/attach read, a deliberate kill) suppresses the notification. A
 * terminal records stay until the age-based session sweep. Logs remain on disk
 * and every notification carries their absolute path.
 *
 * Deviation from upstream: the latch is set AFTER the send, not before. Set
 * before, a `sendMessage` that throws loses the outcome permanently — the job
 * sat terminal and "notified" with nothing having reached the agent. Since
 * `sendMessage` is synchronous there is no window for a concurrent send to
 * slip in between, so ordering it after costs no duplicate protection.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    DELIVER_STEER,
    EVENT,
    type Job,
} from "./types.ts";
import { DEFAULTS, type ProcessTasksConfig } from "./config.ts";
import type { BackgroundRegistry } from "./state.ts";
import { describeJob } from "./format.ts";
import { readTailLines } from "./output.ts";
import { previewText, type MonitorPreview } from "./monitor-buffer.ts";

export interface MonitorNotificationPayload {
    state: "progress" | "absent" | "resumed" | TerminalStatus;
    description: string;
    preview: MonitorPreview;
    silenceMs?: number;
    note?: string;
}

export function buildMonitorNotification(job: Pick<Job, "id" | "logPath">, payload: MonitorNotificationPayload, summary?: string): string {
    return [
        `[monitor ${job.id} · ${payload.state}] ${payload.description}`,
        ...(summary ? [summary] : []),
        `log: ${job.logPath}`,
        ...(payload.silenceMs !== undefined ? [`No events for ${payload.silenceMs}ms; monitor is still running.`] : []),
        ...(payload.note ? [payload.note] : []),
        previewText(payload.preview),
    ].filter(Boolean).join("\n");
}

/** Terminal statuses a notification can carry. */
export type TerminalStatus = "completed" | "failed" | "killed";

/**
 * Compose a job notification's model-facing text.
 *
 * Deviation from upstream: upstream emitted Claude Code's `<task-notification>`
 * XML block verbatim — seven lines of tags wrapping four short values, with
 * `<summary>` duplicating `details.summary` exactly. CC needs that XML because
 * its notification is injected as plain conversation text; here the message is
 * a `customType` with a `details` payload and a dedicated renderer, so the
 * structure already travels out-of-band and the tags buy nothing but tokens
 * on every single job completion.
 *
 * What survives is what the model cannot get from `details`: the summary, the
 * log path (so it can read more), and the log tail of a failure. `toolUseId`
 * moved to `details` only — nothing in pi lets the model address a tool-use id,
 * and the job id already identifies the task in both the tool result and here.
 *
 * The status segment is omitted for stall warnings (CC parity — the job is
 * still running, so no outcome has happened yet).
 */
export function buildTaskNotification(args: {
    taskId: string;
    outputFile: string;
    status?: TerminalStatus;
    summary: string;
    /** Log tail for failures; "" or omitted renders no tail block. */
    outputTail?: string;
}): string {
    const head = args.status
        ? `[task ${args.taskId} · ${args.status}]`
        : `[task ${args.taskId}]`;
    const lines = [`${head} ${args.summary}`, `log: ${args.outputFile}`];
    // The tail is the one field that genuinely needs its own lines, so it keeps
    // a delimiter: without one, a log line reading like prose is
    // indistinguishable from the notification's own text.
    if (args.outputTail) {
        lines.push("--- output tail ---", args.outputTail);
    }
    return lines.join("\n");
}

/**
 * The log tail to inline for a terminal job, or "" when none should be.
 *
 * Only non-successful outcomes get one: a completed job's output is either
 * irrelevant or already the deliverable the model will read on purpose, and
 * inlining it on every success would spend context for nothing.
 */
export function failureTail(
    job: Job,
    status: TerminalStatus,
    config: Pick<ProcessTasksConfig, "failureTailLines" | "failureTailChars"> = DEFAULTS
): string {
    if (status === "completed") return "";
    const tail = readTailLines(
        job.logPath,
        config.failureTailLines,
        config.failureTailChars
    );
    return tail || "(no output)";
}

/**
 * Claude Code's exact completion summary for a terminal job. `status`
 * overrides job.status for callers that notify before the job is marked
 * terminal (the monitor exit path).
 */
export function completionSummary(job: Job, status?: TerminalStatus): string {
    const s = status ?? (job.status as TerminalStatus);
    const desc = describeJob(job.name, job.command);
    if (job.kind === "monitor") {
        if (s === "killed") return `Monitor "${desc}" stopped`;
        // Not "script failed": a ws monitor has no script, and sending the model
        // after one is a wild goose chase. The exit code is the synthetic
        // abnormal-close code there, and the inlined log tail carries the real
        // reason (`[socket closed: code 1006]`).
        if (s === "failed") return `Monitor "${desc}" failed (exit ${job.exitCode ?? "unknown"})`;
        return `Monitor "${desc}" stream ended`;
    }
    if (s === "killed") return `Background command "${desc}" was stopped`;
    if (s === "failed") return `Background command "${desc}" failed with exit code ${job.exitCode ?? "unknown"}`;
    return `Background command "${desc}" completed${job.exitCode != null ? ` (exit code ${job.exitCode})` : ""}`;
}

/**
 * Record that the agent has seen a job's outcome (Claude Code's
 * markTaskNotified). Idempotent. Called by every path that surfaces the
 * outcome WITHOUT a notification: kill paths (before the kill, so the exit
 * handler skips notifying) and terminal reads (process_manage output / wait).
 */
export function markOutcomeSurfaced(job: Job, reg?: BackgroundRegistry): void {
    job.outcomeSurfaced = true;
    if (job.kind === "monitor") reg?.monitorNotifications.cancel(job);
    // The outcome got through by another route, so a stale send failure is no
    // longer worth reporting.
    delete job.notifyError;
}

/**
 * Send a terminal job's notification, at most once.
 *
 * Skipped — without marking the outcome surfaced — while a `process_manage wait` is
 * waiting on the job, because that attach's result is the report. Skipped
 * permanently once the outcome has been surfaced by any route.
 *
 * A send that throws records `job.notifyError` and returns false, leaving the
 * job terminal, unsurfaced, and still in the registry so `process_manage list` can
 * report it. Upstream dropped it to a console.error and the outcome was gone.
 *
 * Delivery does not affect metadata retention.
 *
 * Returns true when the notification was sent.
 */
export function sendTaskNotification(args: {
    reg: BackgroundRegistry;
    pi: ExtensionAPI;
    job: Job;
    /** Explicit terminal status when the job isn't marked terminal yet. */
    status?: TerminalStatus;
    /** Explicit summary (monitors compose their own). */
    summary?: string;
    monitor?: MonitorNotificationPayload;
}): boolean {
    const { reg, pi, job } = args;
    if (reg.closed || job.outcomeSurfaced) return false;
    if ((job.attachCount ?? 0) > 0) {
        // Preserve the already-bounded monitor terminal payload, not its source/buffer.
        reg.notificationRetries.set(job.id, () => {
            if (reg.jobs.get(job.id) === job) sendTaskNotification(args);
        });
        return false;
    }
    const status = args.status ?? (job.status as TerminalStatus);
    const summary = args.summary ?? completionSummary(job, status);
    const outputTail = args.monitor ? "" : failureTail(job, status, reg.config);

    try {
        pi.sendMessage(
            {
                customType: EVENT.taskNotification,
                content: args.monitor ? buildMonitorNotification(job, args.monitor, summary) : buildTaskNotification({
                    taskId: job.id,
                    outputFile: job.logPath,
                    status,
                    summary,
                    outputTail,
                }),
                display: true,
                details: {
                    jobId: job.id,
                    status,
                    summary,
                    outputFile: job.logPath,
                    ...(args.monitor ? { monitor: args.monitor } : {}),
                    // Kept for correlation by anything reading the session log;
                    // deliberately out of the model-facing text.
                    ...(job.toolCallId ? { toolUseId: job.toolCallId } : {}),
                    ...(outputTail ? { outputTail } : {}),
                },
            },
            DELIVER_STEER
        );
    } catch (err) {
        job.notifyError = err instanceof Error ? err.message || String(err) : String(err);
        console.error("[process-tasks] task notification failed:", err);
        return false;
    }
    markOutcomeSurfaced(job);
    reg.notificationRetries.delete(job.id);
    reg.changed();
    return true;
}
