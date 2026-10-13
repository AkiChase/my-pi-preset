/** Bounded wire payloads and log-retained, exclusive batch manifests (no SDK runtime). */
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { buildMonitorNotification } from "./notify.ts";
import type { MonitorBatchItem } from "./monitor-notifications.ts";

// Includes JSON escaping, UTF-8 expansion and BOTH model content and details.
// Leave 1KiB for the small envelope supplied by the caller/host. Not configurable:
// running admission does not bound the number of retained terminal sources.
export const MONITOR_NOTIFICATION_MAX_BYTES = 64 * 1024;
const PAYLOAD_BYTES = MONITOR_NOTIFICATION_MAX_BYTES - 1024;
export interface MonitorBatchOverflow {
    sourceCount: number;
    omittedSources: number;
    manifestPath?: string;
    manifestError?: string;
}
interface Payload { content: string; details: Record<string, unknown> }
export interface ManifestSource {
    jobId: string;
    logPath: string;
    state: string;
    description: string;
    transitions: string[];
    omittedTransitions: number;
    summary?: string;
    note?: string;
    silenceMs?: number;
    toolUseId?: string;
}
function section(item: MonitorBatchItem): string {
    return [buildMonitorNotification({ id: item.jobId, logPath: item.logPath }, item.monitor, item.summary),
        ...(item.transitions.length > 1 ? [`transitions: ${item.transitions.join(" → ")}`] : []),
        ...(item.omittedTransitions ? [`[${item.omittedTransitions} additional transitions omitted]`] : []),
    ].join("\n");
}
function hint(overflow: MonitorBatchOverflow): string {
    return `[${overflow.omittedSources} sources omitted inline; ${overflow.manifestPath
        ? "complete batch manifest below" : "batch manifest unavailable — omitted outcomes not surfaced"}]\n` +
        (overflow.manifestPath ? `manifest: ${overflow.manifestPath}` : `manifest error: ${overflow.manifestError}`);
}
export function monitorBatchPayload(items: MonitorBatchItem[], overflow?: MonitorBatchOverflow): Payload {
    const single = !overflow && items.length === 1 ? items[0]! : undefined;
    const body = items.map(section).join("\n\n");
    return {
        content: single ? body : `[monitor batch · ${overflow?.sourceCount ?? items.length} sources]\n` +
            (overflow ? `${hint(overflow)}\n\n` : "") + body,
        details: single ? { jobId: single.jobId, logPath: single.logPath, outputFile: single.logPath,
            monitor: single.monitor, summary: single.summary, status: single.monitor.state,
            transitions: single.transitions, omittedTransitions: single.omittedTransitions,
            ...(single.toolUseId ? { toolUseId: single.toolUseId } : {}) }
            : { monitorBatch: items, ...(overflow ? { monitorBatchOverflow: overflow } : {}) },
    };
}
export function monitorPayloadFits(payload: Payload): boolean {
    return Buffer.byteLength(JSON.stringify(payload), "utf8") <= PAYLOAD_BYTES;
}
/** Never assemble an unbounded batch string. Candidate metadata is measured per
 * source; only a bounded prefix can reach the renderer/JSON serialization. */
export function boundedMonitorBatch(items: Iterable<MonitorBatchItem>, sourceCount: number,
    overflow: Omit<MonitorBatchOverflow, "omittedSources" | "sourceCount"> = {}): { payload: Payload; items: MonitorBatchItem[] } {
    const selected: MonitorBatchItem[] = [];
    const hasOverflow = Object.keys(overflow).length > 0;
    const base = hasOverflow ? monitorBatchPayload([], { ...overflow, sourceCount, omittedSources: sourceCount })
        : { ...monitorBatchPayload([]), content: `[monitor batch · ${sourceCount} sources]\n` };
    if (!monitorPayloadFits(base)) throw new Error("Manifest path exceeds monitor notification capacity");
    let bytes = Buffer.byteLength(JSON.stringify(base), "utf8");
    for (const item of items) {
        if (!hasOverflow && sourceCount === 1) {
            const single = monitorBatchPayload([item]);
            if (monitorPayloadFits(single)) return { payload: single, items: [item] };
            break;
        }
        // Count exact additive JSON bytes without assembling the whole batch:
        // section quotes are already in base.content; subsequent sources add
        // one array comma and the JSON-escaped pair of newline separators.
        const addition = Buffer.byteLength(JSON.stringify(item), "utf8") +
            Buffer.byteLength(JSON.stringify(section(item)), "utf8") - 2 + (selected.length ? 5 : 0);
        if (bytes + addition > PAYLOAD_BYTES) break;
        selected.push(item); bytes += addition;
    }
    if (!hasOverflow && selected.length === sourceCount) {
        const payload = monitorBatchPayload(selected);
        if (!monitorPayloadFits(payload)) throw new Error("Monitor notification capacity exceeded");
        return { payload, items: selected };
    }
    // A truly overflowing batch needs room for its hint; do not reserve that
    // hint while testing an ordinary batch that fits without any manifest.
    if (!hasOverflow) return boundedMonitorBatch(selected, sourceCount, { manifestError: "Complete batch metadata requires a manifest." });
    const payload = monitorBatchPayload(selected, { ...overflow, sourceCount, omittedSources: sourceCount - selected.length });
    if (!monitorPayloadFits(payload)) throw new Error("Monitor notification capacity exceeded");
    return { payload, items: selected };
}
export function newMonitorManifestPath(logDir: string): string {
    return resolve(logDir, `monitor-batch-${randomUUID()}.jsonl`);
}
/** JSONL header followed by one complete metadata row per snapshot source.
 * No previews: raw source logs are the full output. Serialize strings in chunks
 * too, since even a single description/log path need not have a capacity bound. */
export function writeMonitorManifest(path: string, sources: Iterable<ManifestSource>,
    sourceCount: number, omittedSources: number): void {
    mkdirSync(resolve(path, ".."), { recursive: true });
    // O_EXCL + an unguessable filename prevents cross-registry/session overwrite.
    const fd = openSync(path, "wx", 0o600);
    let complete = false;
    const write = (text: string) => {
        const bytes = Buffer.from(text);
        for (let offset = 0; offset < bytes.length;) {
            const written = writeSync(fd, bytes, offset, bytes.length - offset);
            if (written <= 0) throw new Error("Short monitor manifest write");
            offset += written;
        }
    };
    const json = (value: unknown): void => {
        if (typeof value === "string") {
            write('"');
            for (let start = 0; start < value.length;) {
                let end = Math.min(start + 4096, value.length);
                if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!)) end--;
                write(JSON.stringify(value.slice(start, end)).slice(1, -1)); start = end;
            }
            write('"');
        } else if (Array.isArray(value)) {
            write("["); value.forEach((entry, i) => { if (i) write(","); json(entry); }); write("]");
        } else if (value && typeof value === "object") {
            write("{"); let first = true;
            for (const [key, entry] of Object.entries(value)) {
                if (entry === undefined) continue;
                if (!first) write(","); first = false; json(key); write(":"); json(entry);
            }
            write("}");
        } else write(JSON.stringify(value) ?? "null");
    };
    try {
        json({ format: "monitor-batch-v1", sourceCount, omittedSources, createdAt: Date.now() }); write("\n");
        for (const source of sources) { json(source); write("\n"); }
        // A close failure is a save failure too; never advertise partial output.
        closeSync(fd); complete = true;
    } finally {
        if (!complete) {
            try { closeSync(fd); } catch { /* Close may already have succeeded. */ }
            try { unlinkSync(path); } catch { /* Only our exclusively-created file. */ }
        }
    }
}
