/** WebSocket message boundaries are activities, not individual display lines. */
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { MonitorBuffer } from "./monitor-buffer.ts";
import { writeAll, type MonitorLimits, type MonitorResult, type MonitorSinks } from "./monitor-source.ts";

export interface WsSpec { url: string; protocols?: string[] }
export interface WsSource { exit: Promise<MonitorResult>; close: () => void }
export function isWsSupported(): boolean {
    return typeof (globalThis as { WebSocket?: unknown }).WebSocket === "function";
}

export function openWsSource(spec: WsSpec, logPath: string,
    sinks: MonitorSinks, limits: MonitorLimits): WsSource {
    if (!isWsSupported()) throw new Error("WebSocket is not available in this runtime (needs Node 22+).");
    mkdirSync(dirname(logPath), { recursive: true });
    const fd = openSync(logPath, "w");
    const WS = (globalThis as { WebSocket: typeof WebSocket }).WebSocket;
    let ws: WebSocket;
    try { ws = new WS(spec.url, spec.protocols); } catch (err) {
        closeSync(fd);
        throw err;
    }
    let settled = false;
    let resolveExit!: (result: MonitorResult) => void;
    const exit = new Promise<MonitorResult>((resolve) => { resolveExit = resolve; });
    const append = (text: string) => writeAll(fd, Buffer.from(text.endsWith("\n") ? text : `${text}\n`));
    const preview = (text: string) => {
        const buffer = new MonitorBuffer(limits.maxLines, limits.maxChars);
        buffer.addText(text);
        return buffer.take();
    };
    const settle = (result: MonitorResult, diagnostic?: string) => {
        if (settled) return;
        settled = true;
        sinks.finishing();
        if (diagnostic) {
            try { append(diagnostic); } catch (err) {
                result = { code: 1, signal: null, reason: `Monitor log error: ${String(err)}` };
            }
            sinks.final(preview(diagnostic));
        }
        try { closeSync(fd); } catch (err) {
            result = { code: 1, signal: null, reason: `Monitor log close error: ${String(err)}` };
        }
        resolveExit(result);
    };
    const closeSocket = () => { try { ws.close(); } catch { /* already closing */ } };
    ws.addEventListener("message", (ev: MessageEvent) => {
        if (settled) return;
        const data: unknown = ev.data;
        const text = typeof data === "string" ? data
            : data instanceof ArrayBuffer ? `[binary frame, ${data.byteLength} bytes]`
            : data && typeof (data as { byteLength?: number }).byteLength === "number"
                ? `[binary frame, ${(data as { byteLength: number }).byteLength} bytes]` : "[non-text frame]";
        const arrivedAt = Date.now();
        try { append(text); } catch (err) {
            settle({ code: 1, signal: null, reason: `Monitor log error: ${String(err)}` });
            closeSocket();
            return;
        }
        sinks.event(preview(text), arrivedAt);
    });
    ws.addEventListener("error", () => {
        if (settled) return;
        settle({ code: 1, signal: null, reason: "WebSocket error" }, "[websocket error]");
        closeSocket();
    });
    ws.addEventListener("close", (ev: CloseEvent) => {
        settle({ code: ev.code === 1000 || ev.code === 1005 ? 0 : 1, signal: null },
            `[socket closed: code ${ev.code}${ev.reason ? ` ${ev.reason}` : ""}]`);
    });
    return { exit, close() {
        settle({ code: 0, signal: null });
        closeSocket();
    } };
}
