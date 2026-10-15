import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { BackgroundRegistry } from "./state.ts";
import { PREVIEW_CHARS, type Job } from "./types.ts";
import { findJob } from "./registry.ts";
import { jobLabel, textBlock } from "./format.ts";
import { searchLogs, type LogSearchHit } from "./log-search.ts";

const SEARCH_DISPLAY_LIMIT_PER_JOB = 20;

export async function searchAction(
    reg: BackgroundRegistry,
    pattern: string,
    opts: { jobId?: string; ignoreCase: boolean; contextLines: number; taskType?: "bash" | "monitor" }
): Promise<AgentToolResult<{ count: number; error_code?: "log_error" }>> {
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
        jobs = Array.from(reg.jobs.values()).filter(job => opts.taskType === undefined || (job.kind === "monitor" ? "monitor" : "bash") === opts.taskType);
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
    const errors = result.errors.map(group => `Cannot read log: ${group.error!.path} (task_id=${group.jobId}).`);
    if (result.totalHits === 0) {
        return {
            content: [textBlock(errors.length ? `Search incomplete for /${pattern}/${flags} in ${scope}.\n${errors.join("\n")}` : `No matches for /${pattern}/${flags} in ${scope}.`)],
            details: { count: 0, ...(errors.length ? { error_code: "log_error" as const } : {}) },
            ...(errors.length ? { isError: true } : {}),
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
                `${errors.length ? "Search incomplete. " : ""}Found ${result.totalHits} matches for /${pattern}/${flags} across ${result.groups.length} job(s):\n\n${blocks.join("\n\n")}${errors.length ? `\n\n${errors.join("\n")}` : ""}`
            ),
        ],
        details: { count: result.totalHits, ...(errors.length ? { error_code: "log_error" as const } : {}) },
        ...(errors.length ? { isError: true } : {}),
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
