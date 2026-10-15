/**
 * Streaming log search service.
 *
 * The process management capability owns parameter parsing and formatting; this module owns
 * full-log scanning, match counting, bounded display-hit retention, context
 * lines around each hit, and the tail fallback used when the log file cannot be
 * streamed line-by-line.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { PREVIEW_CHARS, type Job } from "./types.ts";
import { readBoundedTailOrThrow } from "./output.ts";

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
    /** Set only when both the stream and bounded fallback are unavailable. */
    error?: { path: string; error_code: "log_error" };
}

export interface LogSearchResult {
    totalHits: number;
    groups: LogSearchGroup[];
    errors: LogSearchGroup[];
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
    const scanned = await Promise.all(jobs.map((job) => scanOneJob(job, args.pattern, options)));
    const groups = scanned.filter(group => group.count > 0);
    const errors = scanned.filter(group => group.error !== undefined);

    let totalHits = 0;
    for (const group of groups) totalHits += group.count;
    return { totalHits, groups, errors };
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
        // A failed stream may have produced hits: do not count them twice or
        // publish an incomplete stream as a complete scan.
        group.count = 0;
        group.hits = [];
        try {
            const tail = readBoundedTailOrThrow(job.logPath, options.previewChars);
            if (tail) scanTailText(job, re, tail, group, options);
        } catch {
            group.error = { path: job.logPath, error_code: "log_error" };
        }
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
        let failed = false;
        const collector = new ContextCollector(group, options);
        let stream: ReturnType<typeof createReadStream>;
        try { stream = createReadStream(job.logPath, { encoding: "utf-8" }); }
        catch { resolve(false); return; }
        let rl: ReturnType<typeof createInterface> | undefined;
        const fail = () => {
            failed = true;
            rl?.close();
            stream.destroy();
        };
        // readline forwards input errors to its own emitter. Both emitters
        // need an owning handler; a promise catch cannot catch an unhandled event.
        stream.on("error", fail);
        // Settle only after actual fd close, even after partial setup failure.
        stream.on("close", () => { rl?.close(); resolve(!failed); });
        try { rl = createInterface({ input: stream, crlfDelay: Infinity }); }
        catch { fail(); return; }
        rl.on("error", fail);
        rl.on("line", (line) => {
            if (failed) return;
            lineNo++;
            // Global/sticky regexes carry lastIndex between .test() calls.
            re.lastIndex = 0;
            collector.push(line, lineNo, re.test(line), job.logPath);
        });
        rl.on("close", () => { stream.destroy(); });
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
