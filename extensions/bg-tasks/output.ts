// src/output.ts
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { FOREGROUND_TAIL_BYTES } from "./types.ts";

/**
 * Read the tail of a log file, bounded by maxChars. Only the last maxChars
 * bytes are read (O(maxChars), not O(fileSize)). Opens once and fstats the
 * descriptor — no separate path-stat, so no stat-then-read race.
 */
export function readBoundedTail(logPath: string, maxChars: number): string {
    let fd: number;
    try {
        fd = openSync(logPath, "r");
    } catch {
        return "(no output yet)";
    }
    try {
        const { size } = fstatSync(fd);
        if (size === 0) return "(no output yet)";
        const toRead = Math.min(size, maxChars);
        const buf = Buffer.alloc(toRead);
        readSync(fd, buf, 0, toRead, Math.max(0, size - toRead));
        const body = buf.toString("utf-8");
        return size > maxChars
            ? `...[truncated, showing last ${maxChars} chars]\n${body}`
            : body;
    } catch {
        return "(no output yet)";
    } finally {
        closeSync(fd);
    }
}

/**
 * A byte range of a log file, with the context needed to ask for the next one.
 *
 * Offsets are BYTES, not characters: the file is read with positional reads so
 * a 100 MiB log costs O(limit), and a byte offset is the only thing that can
 * be resumed cheaply. A range boundary can therefore land mid-codepoint, which
 * shows up as a single U+FFFD at the seam — the same trade `readBoundedTail`
 * has always made, and harmless for logs.
 */
export interface LogSlice {
    text: string;
    /** Byte offset where this slice starts. */
    start: number;
    /** Byte offset just past this slice — pass it back as `offset` to continue. */
    end: number;
    /** Total size of the log in bytes. */
    size: number;
}

/**
 * Read `limit` bytes of a log, starting at `offset` — or the LAST `limit`
 * bytes when `offset` is undefined.
 *
 * The tail default is what upstream's `readBoundedTail` did and the only thing
 * it could do: there was no offset parameter at all, so the middle of a large
 * log was unreachable and a job whose interesting output was not at the end
 * simply could not be read through the tool.
 *
 * Returns undefined when the file is missing or empty, which callers render as
 * a no-output note.
 */
export function readLogSlice(
    logPath: string,
    opts: { offset?: number; limit: number }
): LogSlice | undefined {
    let fd: number;
    try {
        fd = openSync(logPath, "r");
    } catch {
        return undefined;
    }
    try {
        const { size } = fstatSync(fd);
        if (size === 0) return undefined;
        const limit = Math.max(1, Math.floor(opts.limit));
        // Clamp rather than error: an offset past the end is the normal result
        // of paging to the bottom of a log that has since been truncated.
        const start =
            opts.offset === undefined
                ? Math.max(0, size - limit)
                : Math.min(Math.max(0, Math.floor(opts.offset)), size);
        const toRead = Math.min(limit, size - start);
        if (toRead <= 0) return { text: "", start, end: start, size };
        const buf = Buffer.alloc(toRead);
        readSync(fd, buf, 0, toRead, start);
        return { text: buf.toString("utf-8"), start, end: start + toRead, size };
    } catch {
        return undefined;
    } finally {
        closeSync(fd);
    }
}

// Terminal escape/control sequences stripped from a progress line so the
// sidebar shows clean text and crafted job output cannot inject escapes. The
// leading \u001b (ESC) is essential — without it these would eat literal
// `[...]`/`]...` like JSON.
const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
// Remaining C0/C1 control chars and DEL (newlines handled by the split).
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * The last non-empty line of a log's tail, ANSI-stripped — used to show live
 * progress in the sidebar. Reads only the trailing bytes (cheap per tick), and
 * collapses `\r` progress-bar redraws to their final segment. Returns "" when
 * there's no output yet.
 */
export function readLastLine(logPath: string, scanBytes = 2_048): string {
    const tail = readBoundedTail(logPath, scanBytes);
    if (tail === "(no output yet)") return "";
    const lines = tail.replace(ANSI_CSI, "").replace(ANSI_OSC, "").split(/[\r\n]+/);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].replace(CONTROL_CHARS, "").replace(/\t/g, " ").trim();
        if (line.length > 0) return line;
    }
    return "";
}

/**
 * The last `maxLines` non-empty lines of a log, ANSI-stripped and bounded by
 * `maxChars` of trailing bytes — what a failure notification inlines so the
 * model can see *why* a job failed without a second `jobs output` round-trip.
 *
 * Progress-bar redraws (`\r`) collapse to their final segment, same as
 * readLastLine: a 500-frame download bar would otherwise eat the whole budget
 * and push the actual error out of the window.
 *
 * Returns "" when there is no output at all (a job can fail having printed
 * nothing — e.g. exec failure), which callers render as a plain no-output note.
 */
export function readTailLines(
    logPath: string,
    maxLines: number,
    maxChars: number
): string {
    const tail = readBoundedTail(logPath, maxChars);
    if (tail === "(no output yet)") return "";
    const lines = tail
        .replace(ANSI_CSI, "")
        .replace(ANSI_OSC, "")
        .split(/[\r\n]+/)
        .map((l) => l.replace(CONTROL_CHARS, "").replace(/\t/g, " ").trimEnd())
        .filter((l) => l.trim().length > 0);
    if (lines.length === 0) return "";
    // When readBoundedTail truncated, its marker line stays in — it is useful
    // signal ("there is more above"), and the partial line right after it is
    // cheap enough to keep rather than risk dropping a real error line.
    return lines.slice(-maxLines).join("\n");
}

/**
 * Poll a log file tail at `intervalMs` (default 1000ms). Calls `onUpdate`
 * only when content changes. Returns a handle with `stop()`.
 *
 * This is the Claude Code pattern: the file is written to by the child
 * process via file descriptor. We poll the tail for progress display.
 */
export function pollFileTail(
    logPath: string,
    onUpdate: (text: string) => void,
    intervalMs = 1_000
): { stop: () => void } {
    let lastSize = 0;
    let lastContent = "";
    let stopped = false;

    const timer = setTimeout(function tick() {
        if (stopped) return;
        try {
            const { size } = statSync(logPath);
            if (size === lastSize) {
                timer.refresh();
                return;
            }
            lastSize = size;
            const fd = openSync(logPath, "r");
            try {
                const readStart = Math.max(0, size - FOREGROUND_TAIL_BYTES);
                const toRead = Math.min(size, FOREGROUND_TAIL_BYTES);
                const buf = Buffer.alloc(toRead);
                readSync(fd, buf, 0, toRead, readStart);
                const content = buf.toString("utf-8", 0, toRead);
                if (content && content !== lastContent) {
                    lastContent = content;
                    onUpdate(content);
                }
            } finally {
                closeSync(fd);
            }
        } catch {
            // File not yet created or locked — retry next tick.
        }
        if (!stopped) timer.refresh();
    }, intervalMs);
    (timer as NodeJS.Timeout).unref();

    return {
        stop() {
            stopped = true;
            clearTimeout(timer);
        },
    };
}

/** A tool's streaming-update callback (text-only partial results). */
export type ToolTextUpdate = (update: {
    content: { type: "text"; text: string }[];
    details: undefined;
}) => void;

/**
 * Stream a log file's live tail into a tool's onUpdate callback — the shared
 * "show live output while a job runs" mechanic used by bash, agent_bg, and the
 * jobs attach action. Returns the poller's stop handle.
 */
export function streamLog(
    logPath: string,
    onUpdate: ToolTextUpdate | undefined
): { stop: () => void } {
    return pollFileTail(logPath, (text) => {
        onUpdate?.({ content: [{ type: "text", text }], details: undefined });
    });
}
