/**
 * `jobs` tool — manage background jobs.
 *
 * Actions:
 *   - list: show all jobs (running + recently terminal)
 *   - output: read a job's log — tail by default, or any byte range
 *   - kill: terminate a job
 *   - attach: follow a job's live output and wait for it to finish
 *   - search: regex-search job output, optionally scoped to one job
 *   - stats: aggregate metrics
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { BackgroundRegistry } from "../state.ts";
import {
    isTerminalStatus,
    PREVIEW_CHARS,
    type Job,
    type UiContext,
} from "../types.ts";
import { processExists } from "../spawn.ts";
import {
    findJob,
    getStats,
    renderSidebar,
} from "../registry.ts";
import { formatDuration, formatJobLine, jobLabel, oneLine, textBlock } from "../format.ts";
import { readLogSlice, streamLog } from "../output.ts";
import { searchLogs, type LogSearchHit } from "../log-search.ts";
import { processTaskIdentity } from "../source.ts";
import { markOutcomeSurfaced } from "../notify.ts";
import {
    abortJob,
    ensureCompletionPromise,
    markTerminal,
    terminateJobSilently,
} from "../lifecycle.ts";

/** Register the `jobs` tool. */
export function registerJobsTool(
    pi: ExtensionAPI,
    reg: BackgroundRegistry
): void {
    pi.registerTool({
        name: "jobs",
        label: "Background Jobs",
        description:
            "Manage background jobs: list, output, kill, attach, search, and stats.",
        promptSnippet: "Inspect and manage background jobs",
        promptGuidelines: [
            "list: show all jobs",
            "output: show a job's log. Defaults to the tail; to page through a large log pass offset (bytes) — each result reports the byte range it covers and the offset to continue from. limit caps one page.",
            "kill: terminate a job",
            "attach: follow a job's live output and wait for it to finish (use output for a non-blocking peek)",
            "search: regex-search job output. Narrow to one job with jobId, match case-insensitively with ignoreCase, and see surrounding lines with context.",
            "stats: show aggregate metrics",
            "Completion notices for a failed job already inline the tail of its log — do NOT call 'output' just to learn why it failed. Call 'output' when that tail is truncated and you need more, or when a job's full output is the deliverable (e.g. a test report you must relay). Never call it merely to acknowledge a completed job.",
        ],
        parameters: Type.Object({
            action: StringEnum(
                [
                    "list",
                    "output",
                    "kill",
                    "attach",
                    "search",
                    "stats",
                ] as const,
                { description: "Action to perform" }
            ),
            // The action/parameter dependencies live in these descriptions
            // because the schema is one flat object — every action shares it.
            // execute() validates them explicitly so a missing jobId fails
            // with a sentence instead of a lookup error from three frames down.
            jobId: Type.Optional(
                Type.String({
                    description:
                        "Job ID. Required for output, kill and attach; optional for search, where it limits the scan to one job.",
                })
            ),
            pattern: Type.Optional(
                Type.String({ description: "Regex pattern. Required for search." })
            ),
            wait: Type.Optional(
                Type.Boolean({
                    description: "Whether attach should wait for completion (default: true)",
                })
            ),
            offset: Type.Optional(
                Type.Number({
                    description:
                        "output: byte offset to read from. Omit for the tail (the usual case); pass the nextOffset from a previous result to page forward.",
                })
            ),
            limit: Type.Optional(
                Type.Number({
                    description: `output: maximum bytes to return (default ${reg.config.outputPreviewChars}).`,
                })
            ),
            ignoreCase: Type.Optional(
                Type.Boolean({ description: "search: match case-insensitively." })
            ),
            context: Type.Optional(
                Type.Number({
                    description:
                        "search: lines of context to show before and after each match (default 0).",
                })
            ),
        }),

        async execute(_toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<undefined>> {
            if (reg.closed) throw new Error("Process task activation is closed");
            const p = params as {
                action: "list" | "output" | "kill" | "attach" | "search" | "stats";
                jobId?: string;
                pattern?: string;
                wait?: boolean;
                offset?: number;
                limit?: number;
                ignoreCase?: boolean;
                context?: number;
            };
            switch (p.action) {
                case "list":
                    return listAction(reg);
                case "output":
                    return outputAction(reg, required(p.jobId, "jobId", "output"), {
                        offset: p.offset,
                        limit: p.limit,
                    });
                case "kill":
                    return await killAction(reg, required(p.jobId, "jobId", "kill"), ctx);
                case "attach":
                    return await attachAction(reg, required(p.jobId, "jobId", "attach"), p.wait ?? true, signal, onUpdate, ctx);
                case "search":
                    return await searchAction(reg, required(p.pattern, "pattern", "search"), {
                        jobId: p.jobId,
                        ignoreCase: p.ignoreCase ?? false,
                        contextLines: p.context ?? 0,
                    });
                case "stats":
                    return statsAction(reg);
            }
        },
    });
}

// ─── parameter validation ─────────────────────────────────────

/**
 * Demand a parameter the chosen action needs. Upstream wrote `p.jobId!` and let
 * the omission surface as whatever the downstream lookup happened to say —
 * `No task found with ID: undefined` for output, a TypeError for others. The
 * schema cannot express "required for these actions only" (it is one flat
 * object shared by all six), so the check belongs here, named.
 */
function required<T>(value: T | undefined, name: string, action: string): T {
    if (value === undefined || value === "") {
        throw new Error(`jobs action '${action}' requires ${name}`);
    }
    return value;
}

// ─── list: show all jobs ─────────────────────────────────────────────────

function listAction(reg: BackgroundRegistry): AgentToolResult<undefined> {
    const live = Array.from(reg.jobs.values());
    const lines = live.sort((a, b) => b.startTime - a.startTime).map(formatJobLine);
    return {
        content: [
            textBlock(
                lines.length > 0
                    ? `Background Jobs:\n${lines.join("\n")}`
                    : "No background jobs"
            ),
        ],
        details: undefined,
    };
}

// ─── output: read a job's log tail ───────────────────────────────────────

function outputAction(
    reg: BackgroundRegistry,
    jobId: string,
    page: { offset?: number; limit?: number }
): AgentToolResult<undefined> {
    const job = findJob(reg, jobId);
    if (!job) throw new Error(`No task found with ID: ${jobId}`);
    // CC's TaskOutputTool: a successful read of a TERMINAL job's output marks
    // the outcome surfaced, suppressing the separate <task-notification>.
    // Peeking at a still-running job does NOT mark — its completion must still
    // notify.
    if (isTerminalStatus(job.status)) markOutcomeSurfaced(job);

    const limit = page.limit ?? reg.config.outputPreviewChars;
    const slice = readLogSlice(job.logPath, { offset: page.offset, limit });
    const label = jobLabel(job);
    if (!slice || slice.text.length === 0) {
        const where = page.offset === undefined ? "yet " : `at offset ${page.offset} `;
        return {
            content: [
                textBlock(`No output ${where}for ${label} (${job.status}). Log: ${job.logPath}`),
            ],
            details: undefined,
        };
    }

    // Say exactly which bytes these are and how to reach the rest. Upstream
    // printed a bare tail with no indication that anything was missing, which
    // reads as the whole log.
    const head = `Output for ${label} (${job.status}) — bytes ${slice.start}-${slice.end} of ${slice.size}`;
    const before =
        slice.start > 0
            ? `[${slice.start} earlier bytes not shown — read them with offset=0]\n`
            : "";
    const after =
        slice.end < slice.size
            ? `\n[${slice.size - slice.end} more bytes — continue with offset=${slice.end}]`
            : "";
    return {
        content: [textBlock(`${head}\n${before}${slice.text.trimEnd()}${after}`)],
        details: undefined,
    };
}

// ─── kill: terminate a job ───────────────────────────────────────────────

async function killAction(
    reg: BackgroundRegistry,
    jobId: string,
    ctx: UiContext
): Promise<AgentToolResult<undefined>> {
    const job = findJob(reg, jobId);
    if (!job) throw new Error(`No task found with ID: ${jobId}`);
    if (isTerminalStatus(job.status)) {
        throw new Error(`Job is not running: ${job.id}`);
    }
    // terminateJobSilently marks the outcome surfaced BEFORE the kill, so the exit
    // handler skips the <task-notification> — this result IS the outcome.
    terminateJobSilently(reg, job);
    renderSidebar(reg, ctx);
    // Claude Code's TaskStopTool result string (command collapsed to one line).
    return {
        content: [
            textBlock(`Successfully stopped task: ${job.id} (${oneLine(job.command)})`),
        ],
        details: undefined,
    };
}

// ─── attach: follow live output until completion ─────────────────────────

async function attachAction(
    reg: BackgroundRegistry,
    jobId: string,
    waitForCompletion: boolean,
    signal: AbortSignal | undefined,
    onUpdate: ((u: { content: Array<{ type: "text"; text: string }>; details: undefined }) => void) | undefined,
    ctx: UiContext
): Promise<AgentToolResult<undefined>> {
    const job = findJob(reg, jobId);
    if (!job) throw new Error(`No task found with ID: ${jobId}`);
    const label = jobLabel(job);

    if (!isTerminalStatus(job.status)) {
        if (!waitForCompletion) {
            return { content: [textBlock(`${label} is ${job.status}. Use jobs output for a non-blocking peek.`)], details: undefined };
        }
        ensureCompletionPromise(job);
        job.attachCount = (job.attachCount ?? 0) + 1;
        const lease = reg.coordinator.registerWait<void>({
            identity: processTaskIdentity(job.id), label, kind: "retrieval", signal,
            onComplete: () => { markOutcomeSurfaced(job); reg.notificationRetries.delete(job.id); },
            cleanup: () => {
                job.attachCount = Math.max(0, (job.attachCount ?? 1) - 1);
                reg.changed();
            },
        });
        const done = job.donePromise;
        // Capture the promise before a terminal transition drops runtime hooks.
        void done?.then(() => { lease.complete(); });
        if (!lease.settled && job.pid > 0 && !processExists(job.pid)) {
            markTerminal(reg, job, "failed");
            abortJob(reg, job.id);
            renderSidebar(reg, ctx);
        }
        let poller: ReturnType<typeof streamLog> | undefined;
        try {
            if (!lease.settled) {
                onUpdate?.({ content: [textBlock(`Following ${label} live output — waiting for it to finish…`)], details: undefined });
                poller = streamLog(job.logPath, onUpdate);
            }
            const outcome = await lease.result;
            if (outcome.kind !== "completed") {
                // Completion may have been suppressed on this same tick. Reconsider it
                // after the wait count has dropped, without clearing sibling waits.
                reg.notificationRetries.get(job.id)?.();
                const state = job.isBackgrounded ? "in the background" : "in the foreground";
                return { content: [textBlock(isTerminalStatus(job.status)
                    ? `Stopped following ${label} — status: ${job.status}. Use jobs output for the full log.`
                    : `Stopped following ${label} — it's still ${job.status} ${state}. Use jobs output to check on it.`)], details: undefined };
            }
        } finally {
            poller?.stop();
            if (!lease.settled) {
                lease.dispose();
                reg.notificationRetries.get(job.id)?.();
            }
        }
    }

    const message = `${label} finished. Status: ${job.status}`;
    // The inline result owns completion; an optional toast must not reject it
    // after the lease has atomically consumed the outcome.
    try { ctx.ui.notify(message, job.status === "failed" ? "error" : "info"); } catch { /* optional completion toast */ }
    // The attach result IS the outcome report — mark it surfaced so the
    // <task-notification> is suppressed (CC parity). Covers both the "attached
    // to an already-terminal job" and "waited then finished" cases.
    markOutcomeSurfaced(job);
    return {
        content: [textBlock(`${message}. Use jobs output for the full log.`)],
        details: undefined,
    };
}

// ─── search ──────────────────────────────────────────────────────────────

const SEARCH_DISPLAY_LIMIT_PER_JOB = 20;

async function searchAction(
    reg: BackgroundRegistry,
    pattern: string,
    opts: { jobId?: string; ignoreCase: boolean; contextLines: number }
): Promise<AgentToolResult<undefined>> {
    let re: RegExp;
    try {
        // Non-global on purpose: .test() on a global regex advances lastIndex
        // and would skip every other match.
        re = new RegExp(pattern, opts.ignoreCase ? "i" : "");
    } catch (err) {
        throw new Error(`Invalid regex: ${(err as Error).message}`);
    }

    // Scoping to one job is the difference between reading four lines and
    // reading every log in the session; upstream could only do the latter.
    let jobs: Job[];
    let scope: string;
    if (opts.jobId) {
        const job = findJob(reg, opts.jobId);
        if (!job) throw new Error(`No task found with ID: ${opts.jobId}`);
        jobs = [job];
        scope = jobLabel(job);
    } else {
        jobs = Array.from(reg.jobs.values());
        scope = "any job log";
    }

    const result = await searchLogs({
        jobs,
        pattern: re,
        maxHitsPerJob: SEARCH_DISPLAY_LIMIT_PER_JOB,
        maxLineChars: PREVIEW_CHARS.line,
        previewChars: reg.config.outputPreviewChars,
        contextLines: opts.contextLines,
    });

    const flags = opts.ignoreCase ? "i" : "";
    if (result.totalHits === 0) {
        return {
            content: [textBlock(`No matches for /${pattern}/${flags} in ${scope}.`)],
            details: undefined,
        };
    }

    const blocks = result.groups.map((group) => {
        const headLabel = group.name ? `${group.name} (${group.jobId})` : group.jobId;
        const body = group.hits.map((h) => formatHit(h)).join(
            // Blank line between hits only when they carry context, so
            // context-free output stays as dense as it was.
            opts.contextLines > 0 ? "\n\n" : "\n"
        );
        const more = group.count > group.hits.length
            ? `\n  ... and ${group.count - group.hits.length} more`
            : "";
        return `${headLabel} (${group.count} matches)\n${body}${more}`;
    });

    return {
        content: [
            textBlock(
                `Found ${result.totalHits} matches for /${pattern}/${flags} across ${result.groups.length} job(s):\n\n${blocks.join("\n\n")}`
            ),
        ],
        details: undefined,
    };
}

/** grep -C's convention: `:` marks the matching line, `-` marks context. */
function formatHit(hit: LogSearchHit): string {
    const rows: string[] = [];
    const before = hit.before ?? [];
    before.forEach((text, i) => {
        rows.push(`  ${hit.path}:${hit.line - before.length + i}- ${text}`);
    });
    rows.push(`  ${hit.path}:${hit.line}: ${hit.text}`);
    (hit.after ?? []).forEach((text, i) => {
        rows.push(`  ${hit.path}:${hit.line + i + 1}- ${text}`);
    });
    return rows.join("\n");
}

// ─── stats ───────────────────────────────────────────────────────────────

function statsAction(reg: BackgroundRegistry): AgentToolResult<undefined> {
    const s = getStats(reg);
    // padEnd instead of hand-counted spaces: upstream v2.0.0 hardcoded them and
    // "Total started:" / "Currently running:" ended up in different columns.
    // "Total elapsed", not "Total CPU time" — totalDurationMs is summed wall
    // clock (terminalDurationMs), which for parallel jobs exceeds CPU time.
    const rows: [string, string][] = [
        ["Total started", String(s.totalStarted)],
        ["Currently running", String(s.running)],
        ["Completed", String(s.completed)],
        ["Failed", String(s.failed)],
        ["Killed", String(s.killed)],
        ["Average duration", formatDuration(s.averageDurationMs)],
        ["Total elapsed", formatDuration(s.totalDurationMs)],
    ];
    const width = Math.max(...rows.map(([label]) => label.length)) + 1;
    const lines = rows.map(
        ([label, value]) => `${`${label}:`.padEnd(width + 1)}${value}`
    );
    return {
        content: [textBlock("Background Jobs Stats:\n" + lines.join("\n"))],
        details: undefined,
    };
}
