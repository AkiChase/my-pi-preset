/** Monitor-only event sources; the background shell direct-file backend is unchanged. */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import type { SpawnExit } from "./spawn.ts";
import { MonitorBuffer, prefix, type MonitorPreview } from "./monitor-buffer.ts";
import { openWsSource, type WsSpec } from "./monitor-ws.ts";

export interface MonitorResult extends SpawnExit {
    reason?: string;
    observationNote?: string;
}
export interface MonitorSinks {
    event: (preview: MonitorPreview, arrivedAt: number) => void;
    finishing: () => void;
    final: (preview: MonitorPreview) => void;
}
export interface MonitorLimits { maxLines: number; maxChars: number }
export interface MonitorSource {
    pid: number;
    label: string;
    exit: Promise<MonitorResult>;
    stop: () => MonitorResult | void;
}
export type MonitorSourceFactory = (sinks: MonitorSinks) => MonitorSource;

/** Each pipe owns its decoder and bounded unfinished line. */
export class MonitorLineDecoder {
    private decoder = new StringDecoder("utf8");
    private partial = "";
    private missing = 0;
    private limits: MonitorLimits;
    constructor(limits: MonitorLimits) { this.limits = limits; }
    private fragment(text: string): void {
        if (this.missing) { this.missing += text.length; return; }
        const kept = prefix(text, this.limits.maxChars - this.partial.length);
        this.partial += kept;
        this.missing += text.length - kept.length;
    }
    feed(bytes: Buffer): { preview: MonitorPreview; activity: boolean } {
        const text = this.decoder.write(bytes);
        const batch = new MonitorBuffer(this.limits.maxLines, this.limits.maxChars);
        let start = 0;
        let activity = false;
        for (let i = 0; i < text.length; i++) {
            if (text[i] !== "\n") continue;
            this.fragment(text.slice(start, i));
            batch.addLine(this.partial, this.missing);
            this.partial = "";
            this.missing = 0;
            activity = true;
            start = i + 1;
        }
        this.fragment(text.slice(start));
        return { preview: batch.take(), activity };
    }
    finish(): { preview: MonitorPreview; incomplete: boolean } {
        // StringDecoder.end returns a replacement character for an incomplete UTF-8 tail.
        const tail = this.decoder.end();
        this.fragment(tail);
        const batch = new MonitorBuffer(this.limits.maxLines, this.limits.maxChars);
        if (this.partial.length || this.missing) batch.addLine(this.partial, this.missing);
        this.partial = "";
        this.missing = 0;
        return { preview: batch.take(), incomplete: tail.includes("\ufffd") };
    }
}

/** Raw bytes, including short writes, are saved before reporting activity. */
export function writeAll(fd: number, bytes: Buffer): void {
    let offset = 0;
    while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error("Monitor log write made no progress");
        offset += written;
    }
}

export function spawnCommandSource(args: {
    command: string;
    cwd: string;
    logPath: string;
    sinks: MonitorSinks;
    limits: MonitorLimits;
    /** Local subprocess seam for deterministic exit/drain tests. */
    spawnProcess?: typeof spawn;
}): MonitorSource {
    mkdirSync(dirname(args.logPath), { recursive: true });
    const fd = openSync(args.logPath, "w");
    let child;
    try {
        // Do not rewrite the command: stderr bypasses a user's stdout-only pipe.
        child = (args.spawnProcess ?? spawn)("bash", ["-c", args.command], {
            cwd: args.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (err) {
        closeSync(fd);
        throw err;
    }
    let settled = false;
    let finishing = false;
    let closed = false;
    let resolveExit!: (result: MonitorResult) => void;
    const exit = new Promise<MonitorResult>((resolve) => { resolveExit = resolve; });
    const pipes = [child.stdout!, child.stderr!];
    const decoders = pipes.map(() => new MonitorLineDecoder(args.limits));
    const closeFd = () => {
        if (closed) return;
        closed = true;
        closeSync(fd);
    };
    const receive = (pipe: Readable, bytes: Buffer): void => {
        if (settled) return;
        const arrivedAt = Date.now();
        writeAll(fd, bytes);
        const parsed = decoders[pipes.indexOf(pipe)]!.feed(bytes);
        if (finishing) args.sinks.final(parsed.preview);
        else if (parsed.activity) args.sinks.event(parsed.preview, arrivedAt);
    };
    const finish = (result: MonitorResult): MonitorResult | undefined => {
        if (settled || finishing) return;
        finishing = true;
        args.sinks.finishing();
        const notes: string[] = [];
        if (pipes.some((pipe) => !pipe.readableEnded)) {
            notes.push("Observation ended with the main command; later output may not have been recorded.");
        }
        for (const pipe of pipes) pipe.pause();
        for (let i = 0; i < pipes.length; i++) {
            const pipe = pipes[i]!;
            try {
                let bytes: Buffer | null;
                while (pipe.readableLength > 0 && (bytes = pipe.read(pipe.readableLength) as Buffer | null) !== null) {
                    receive(pipe, bytes);
                }
            } catch (err) {
                result = { code: 1, signal: null, reason: `Monitor log/pipe error: ${String(err)}` };
            }
            const final = decoders[i]!.finish();
            args.sinks.final(final.preview);
            if (final.incomplete) notes.push("Incomplete UTF-8 at the observation boundary.");
            pipe.destroy();
        }
        settled = true;
        try { closeFd(); } catch (err) {
            result = { code: 1, signal: null, reason: `Monitor log close error: ${String(err)}` };
        }
        const finalResult = { ...result, ...(notes.length ? { observationNote: [...new Set(notes)].join(" ") } : {}) };
        resolveExit(finalResult);
        return finalResult;
    };
    for (const pipe of pipes) {
        pipe.on("data", (bytes: Buffer) => {
            if (finishing || settled) return;
            try { receive(pipe, bytes); } catch (err) {
                finish({ code: 1, signal: null, reason: `Monitor log/pipe error: ${String(err)}` });
                // A write failure must not leave an unobserved producer running.
                try { if (child.pid && child.pid > 0) process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
            }
        });
        pipe.on("error", (err) => {
            if (settled || finishing) return;
            finish({ code: 1, signal: null, reason: `Monitor pipe error: ${err.message}` });
            try { if (child.pid && child.pid > 0) process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
        });
    }
    child.on("error", (err) => finish({ code: 1, signal: null, reason: `Monitor source error: ${err.message}` }));
    // Exit, not close/EOF, is the explicitly chosen observation boundary.
    child.on("exit", (code, signal) => finish({ code, signal }));
    return { pid: child.pid ?? 0, label: args.command, exit,
        stop: () => finish({ code: null, signal: "SIGTERM" }) };
}

export function openWsMonitorSource(spec: WsSpec, logPath: string,
    sinks: MonitorSinks, limits: MonitorLimits): MonitorSource {
    const ws = openWsSource(spec, logPath, sinks, limits);
    return { pid: 0, label: `ws ${spec.url}`, exit: ws.exit, stop: ws.close };
}
