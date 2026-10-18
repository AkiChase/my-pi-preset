/**
 * Type definitions and shared constants for the process-tasks extension.
 */

import type { ChildProcess } from "node:child_process";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";

// --- Fixed internal constants ---
// Configurable knobs live in config.ts; what stays here is either a rendering
// detail with no reason to vary, or a value the interaction model depends on.
/** How long a foreground command may finish in before the live-progress UI and
 *  the background hint appear. Shorter and quick commands would flicker a hint;
 *  longer and a slow command looks frozen. */
export const QUICK_COMPLETION_MS = 2_000;
export const FOREGROUND_TAIL_BYTES = 4_096;
export const FINISHED_LINGER_MS = 4_000;
export const TERMINAL_RETENTION_MS = 10 * 60_000;
export const REGISTRY_SWEEP_MS = 60_000;

export const PREVIEW_CHARS = {
    line: 80,
    /** Command preview in the foreground hand-off hint. */
    progress: 60,
} as const;

// --- Domain types ---
/** Claude Code's task-status enum. "pending" exists for parity (a task that is
 *  registered but not yet started); every spawn path here starts "running". */
export type JobStatus = "pending" | "running" | "completed" | "failed" | "killed";

/** True once the job has reached a terminal state (completed | failed | killed). */
export function isTerminalStatus(status: JobStatus): boolean {
    return status === "completed" || status === "failed" || status === "killed";
}

/** What kind of background job this is. "shell" is the default (bash);
 *  "monitor" is a
 *  streaming-event watch (the monitor tool). */
export type JobKind = "shell" | "monitor";

/** Claude Code's typed task-id prefixes — one letter per kind, followed by 8
 *  random base36 chars (e.g. `b7f3k9a2x1`). See registry.newJobId. */
export const JOB_ID_PREFIX: Record<JobKind, string> = {
    shell: "b",
    monitor: "m",
};

export interface Job {
    readonly executionConfig?: import("../runtime-tasks/execution-config.ts").MonitorExecutionConfig;
    id: string;
    name?: string;
    command: string;
    pid: number;
    startTime: number;
    /** Frozen on the first terminal transition; drives UI hiding and registry expiry. */
    endedAt?: number;
    status: JobStatus;
    exitCode?: number;
    logPath: string;
    proc?: ChildProcess;
    toolCallId: string;
    donePromise?: Promise<void>;
    resolveDone?: () => void;
    /**
     * Whether the agent has seen this job's terminal outcome — by
     * <task-notification>, by asking for the kill, or by reading it through
     * `process_manage output` / `process_manage wait`. Set only AFTER the outcome actually
     * reached the agent. Delivery does not control metadata retention; all
     * terminal records stay for the same ten-minute window.
     *
     * Upstream had a single `notified` boolean carrying three different
     * meanings at once ("already told", "don't tell", "being read right
     * now"), which is why a `notify: false` failure could vanish without
     * ever being reported. Those are now three separate fields.
     */
    outcomeSurfaced?: boolean;
    /**
     * In-flight `process_manage wait` waits. While above zero the terminal
     * notification is skipped — the attach result IS the report — but the
     * outcome is NOT marked surfaced, so detaching early still leaves the job
     * able to notify later. A counter rather than a flag because two attaches
     * to one job must not have the first's return cancel the second's
     * suppression.
     */
    attachCount?: number;
    /**
     * Why the last notification send failed. The outcome is then stranded:
     * nothing reached the agent, so `process_manage list` has to show the job and say
     * so, rather than silently dropping it.
     */
    notifyError?: string;
    isBackgrounded: boolean;
    /** Defaults to "shell" when absent. */
    kind?: JobKind;
    /** Transient source teardown hook; released on the terminal transition. */
    stop?: () => void;
}

export type BackgroundReason = "manual" | "timeout";

/** Transient handle for an in-flight foreground bash command, keyed by
 *  toolCallId in the registry. Ctrl+Shift+B and the timeout timer call
 *  requestPause to flip the command into the background. */
export interface ForegroundSlot {
    requestPause: (reason: BackgroundReason) => void;
    /** The registry job backing this command — the hint reads its command text
     *  and start time from there rather than duplicating them. */
    jobId: string;
    /** Whether this command has outlived the quick-completion window and so is
     *  advertised in the "run in background" hint. The hint is derived from
     *  these flags, so deleting the slot inherently retires the hint. */
    hinted?: boolean;
}

// --- Event types ---
export const EVENT = {
    stall: "bg-stall",
    taskNotification: "task-notification",
    monitorEvent: "bg-monitor-event",
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];

// --- Deliver options ---
/** Steer the message into the current/next turn AND wake the agent.
 *  Pi 1.1.0 queues it while streaming and consumes it after the current
 *  assistant tool batch, without cancelling tools. Use for task completion,
 *  bounded monitor progress/silence/recovery, stall warnings and deadlines. */
export const DELIVER_STEER = { deliverAs: "steer", triggerTurn: true } as const;
/** Append to the transcript PASSIVELY without scheduling agent processing.
 *  Used by the shell's existing resource warning path, not monitor events.
 *
 *  What pi actually does with this (agent-session.ts sendCustomMessage): with
 *  `triggerTurn: false` the steer/followUp queue branch is skipped entirely, so
 *  `deliverAs` is never read — an idle agent gets the message appended and
 *  rendered immediately, and a streaming one gets it appended when the agent
 *  run settles. The field stays for shape compatibility; the name of this
 *  constant describes the effect, because the previous name (DELIVER_FOLLOWUP)
 *  named a queue this never reaches. */
export const DELIVER_PASSIVE = { deliverAs: "followUp", triggerTurn: false } as const;

// --- UI context ---
export interface UiContext {
    /** Custom overlays are TUI-only; the other methods also work in RPC. */
    mode?: string;
    ui: Pick<ExtensionUIContext, "notify" | "setWidget" | "setStatus" | "select" | "editor"> & {
        theme: Pick<Theme, "fg">;
        custom?: ExtensionUIContext["custom"];
    };
}

export type ToolResult = AgentToolResult<unknown>;
