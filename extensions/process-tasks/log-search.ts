/**
 * Streaming log search service.
 *
 * The jobs tool owns parameter parsing and result formatting; this module owns
 * full-log scanning, match counting, bounded display-hit retention, context
 * lines around each hit, and the tail fallback used when the log file cannot be
 * streamed line-by-line.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { PREVIEW_CHARS, type Job } from "./types.ts";
import { readLogTail } from "./registry.ts";

export interface LogSearchHit {
    path: string;
    line: number;
    text: string;
    /** Lines immediately before the match, oldest first. Empty unless asked for. */
    before?: string[];
    /** Lines immediately after the match, in order. Empty unless asked for. */
    after?: string[];
}

export interface LogSearchGroup {
    jobId: string;
    name?: string;
    count: number;
    hits: LogSearchHit[];
}

export interface LogSearchResult {
    totalHits: number;
    groups: LogSearchGroup[];
}

interface ScanOptions {
    maxHitsPerJob: number;
    maxLineChars: number;
    /** Tail budget for the fallback path when a log cannot be streamed. */
    previewChars: number;
    /** Lines of context to keep on each side of a hit. 0 disables it. */
    contextLines: number;
}

export async function searchLogs(args: {
    jobs: Iterable<Job>;
    pattern: RegExp;
    maxHitsPerJob: number;
    maxLineChars?: number;
    previewChars: number;
    contextLines?: number;
}): Promise<LogSearchResult> {
    const options: ScanOptions = {
        maxHitsPerJob: args.maxHitsPerJob,
        maxLineChars: args.maxLineChars ?? PREVIEW_CHARS.line,
        previewChars: args.previewChars,
        contextLines: Math.max(0, Math.floor(args.contextLines ?? 0)),
    };
    const jobs = [...args.jobs];

    // Each job's log is an independent stream — scan them concurrently. Results
    // come back in jobs[] order, so group ordering stays stable.
    const groups = (
        await Promise.all(jobs.map((job) => scanOneJob(job, args.pattern, options)))
    ).filter((g) => g.count > 0);

    let totalHits = 0;
    for (const group of groups) totalHits += group.count;
    return { totalHits, groups };
}

/** Scan one job's log (streamed line-by-line, falling back to the tail when the
 *  file cannot be streamed), returning its hit group. */
async function scanOneJob(
    job: Job,
    re: RegExp,
    options: ScanOptions
): Promise<LogSearchGroup> {
    const group: LogSearchGroup = { jobId: job.id, name: job.name, count: 0, hits: [] };
    const scanned = await streamLogFile(job, re, group, options);
    if (!scanned) {
        scanTailText(job, re, readLogTail(job, options.previewChars), group, options);
    }
    return group;
}

/**
 * Feeds lines through a fixed-size trailing window so a hit can carry the lines
 * around it. `before` is available immediately from the window; `after` can
 * only be filled by lines that arrive later, so a hit stays "open" until it has
 * collected enough of them (or the stream ends).
 *
 * Only DISPLAYED hits collect context — `count` keeps counting every match, so
 * asking for context never changes the reported total.
 */
class ContextCollector {
    private readonly window: string[] = [];
    private readonly pending: LogSearchHit[] = [];
    private readonly group: LogSearchGroup;
    private readonly options: ScanOptions;

    // Explicit assignment, not TS parameter properties: pi (and node --test)
    // run these files through type stripping, which rejects
    // `constructor(private readonly x)` outright.
    constructor(group: LogSearchGroup, options: ScanOptions) {
        this.group = group;
        this.options = options;
    }

    /** Record a line, and a hit at that line when `hit` is true. */
    push(line: string, lineNo: number, hit: boolean, path: string): void {
        const { contextLines, maxHitsPerJob, maxLineChars } = this.options;

        // Any open hit takes this line as trailing context first — a line can
        // be both the "after" of one hit and the "before" of the next.
        for (let i = this.pending.length - 1; i >= 0; i--) {
            const open = this.pending[i]!;
            open.after!.push(truncateLine(line, maxLineChars));
            if (open.after!.length >= contextLines) this.pending.splice(i, 1);
        }

        if (hit) {
            this.group.count++;
            if (this.group.hits.length < maxHitsPerJob) {
                const entry: LogSearchHit = {
                    path,
                    line: lineNo,
                    text: truncateLine(line, maxLineChars),
                };
                if (contextLines > 0) {
                    entry.before = [...this.window];
                    entry.after = [];
                    this.pending.push(entry);
                }
                this.group.hits.push(entry);
            }
        }

        if (contextLines > 0) {
            this.window.push(truncateLine(line, maxLineChars));
            if (this.window.length > contextLines) this.window.shift();
        }
    }
}

async function streamLogFile(
    job: Job,
    re: RegExp,
    group: LogSearchGroup,
    options: ScanOptions
): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        let lineNo = 0;
        let sawFile = false;
        const collector = new ContextCollector(group, options);
        const stream = createReadStream(job.logPath, { encoding: "utf-8" });
        stream.on("error", () => resolve(false));
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        rl.on("line", (line) => {
            sawFile = true;
            lineNo++;
            // A global or sticky regex carries lastIndex between .test() calls
            // and would skip matches; the jobs tool builds a fresh non-global
            // one, and this stays correct if that ever changes.
            re.lastIndex = 0;
            collector.push(line, lineNo, re.test(line), job.logPath);
        });
        rl.on("close", () => resolve(sawFile));
    });
}

function scanTailText(
    job: Job,
    re: RegExp,
    text: string,
    group: LogSearchGroup,
    options: ScanOptions
): void {
    const lines = text.split("\n");
    const collector = new ContextCollector(group, options);
    const path = `${job.logPath} (log tail)`;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        re.lastIndex = 0;
        collector.push(line, i + 1, re.test(line), path);
    }
}

function truncateLine(line: string, maxChars: number): string {
    if (line.length <= maxChars) return line;
    return `${line.slice(0, maxChars)}...[truncated]`;
}
