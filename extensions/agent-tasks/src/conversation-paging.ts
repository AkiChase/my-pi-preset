import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { ConversationEntry, ConversationPage, ConversationPageRequest, ToolCallSummary } from "../../task-ui/types.ts";
import { entryFromMessage, MAX_ENTRIES } from "./conversation-entries.ts";

export const MAX_SCAN_MESSAGES = 1024;
export const MAX_SCAN_BYTES = 512 * 1024;
export const MAX_PAGE_BYTES = 256 * 1024;
/** Sources can add at most two bounded terminal entries without exceeding the page cap. */
export const OUTCOME_RESERVE_BYTES = 64 * 1024;
const CHUNK = 16 * 1024;
const MAX_LINE = 128 * 1024;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
interface LiveState { generation: string; owner: WeakRef<object>; count: number; first: string; last: string; compactions: number }
interface Cursor { key: string; generation: string; position: number; anchor?: string; size?: number; mtime?: number }
interface Row { message?: unknown; start: number; end: number; bytes: number }
interface Scan { entries: ConversationEntry[]; start: number; end: number; scannedMessages: number; scannedBytes: number; budgetLimited: boolean }

/** Conservative constant-time sizing for large strings; bounded traversal of external shapes. */
function messageBytes(value: unknown, depth = 0): number {
    if (typeof value === "string") return value.length * 3;
    if (depth > 5) return 0;
    if (Array.isArray(value)) return value.slice(0, 128).reduce<number>((n, v) => n + messageBytes(v, depth + 1), 0);
    if (obj(value)) return Object.keys(value).slice(0, 64).reduce((n, k) => n + k.length * 3 + messageBytes(value[k], depth + 1), 0);
    return 8;
}

/** Activation-owned cursors contain no paths or caller-controlled authorization data. */
export class ConversationPager {
    private cursors = new Map<string, Cursor>();
    private live = new Map<string, LiveState>();
    private ids = new WeakMap<object, string>();
    private fileGenerations = new Map<string, { generation: string; fingerprint: string; size: number; mtime: number }>();
    private tools = new Map<string, ToolCallSummary>();

    dispose(): void { this.cursors.clear(); this.live.clear(); this.fileGenerations.clear(); this.tools.clear(); this.ids = new WeakMap(); }
    private token(cursor: Cursor): string {
        const token = randomUUID();
        if (this.cursors.size >= 2048) this.cursors.delete(this.cursors.keys().next().value!);
        this.cursors.set(token, cursor);
        return token;
    }
    private empty(source: ConversationPage["source"], generation: string, status: "reset" | "unavailable", hint: string): ConversationPage {
        return Object.freeze({ entries: Object.freeze([]), hasOlder: false, hasNewer: false, source, generation, status, hint,
            budgetLimited: false, scannedMessages: 0, scannedBytes: 0 });
    }
    unavailable(): ConversationPage { return this.empty("unavailable", "unavailable", "unavailable", "Conversation unavailable; inspect the transcript artifact or retry."); }
    private request(key: string, generation: string, request: ConversationPageRequest): Cursor | undefined {
        const cursor = request.cursor ? this.cursors.get(request.cursor) : undefined;
        return cursor?.key === key && cursor.generation === generation ? cursor : undefined;
    }
    private id(message: unknown, fallback: string): string {
        if (!obj(message)) return fallback;
        let id = this.ids.get(message);
        if (!id) { id = randomUUID(); this.ids.set(message, id); }
        return id;
    }
    private entry(message: unknown, id: string, scope: string): ConversationEntry | undefined {
        const entry = entryFromMessage(message, true);
        if (!entry) return undefined;
        if (entry.kind === "assistant") for (const tool of entry.tools) if (tool.toolCallId) {
            if (this.tools.size >= 1024) this.tools.delete(this.tools.keys().next().value!);
            this.tools.set(`${scope}:${tool.toolCallId}`, tool);
        }
        if (entry.kind === "toolResult" && entry.toolCallId) {
            const tool = this.tools.get(`${scope}:${entry.toolCallId}`);
            return Object.freeze({ ...entry, id, ...(tool?.summary ? { summary: tool.summary } : {}), ...(tool?.detail ? { callDetail: tool.detail } : {}) });
        }
        return Object.freeze({ ...entry, id });
    }
    private scan(rows: Iterable<Row>, backwards: boolean, target: number, initial: number, scope: string, identity: (row: Row) => string): Scan {
        const candidates: { row: Row; entry: ConversationEntry }[] = [];
        let scannedMessages = 0, scannedBytes = 0, position = initial, budgetLimited = false;
        let batch = target * 2;
        // Raw sampling is adaptive: 2x initially, then fixed 64-message supplements.
        for (const row of rows) {
            position = backwards ? row.start : row.end;
            const fits = row.bytes <= MAX_SCAN_BYTES - scannedBytes;
            scannedMessages++;
            scannedBytes += Math.min(MAX_SCAN_BYTES - scannedBytes, row.bytes);
            if (fits && row.message !== undefined) {
                const entry = this.entry(row.message, identity(row), scope);
                if (entry) candidates.push({ row, entry });
            }
            if (scannedMessages >= MAX_SCAN_MESSAGES || scannedBytes >= MAX_SCAN_BYTES) { budgetLimited = true; break; }
            if (scannedMessages >= batch) {
                if (candidates.length >= target) break;
                batch += MAX_ENTRIES;
            }
        }
        // Results encountered before their calls in a reverse scan are enriched now.
        const ordered = backwards ? candidates.reverse() : candidates;
        const selected = backwards ? ordered.slice(-target) : ordered.slice(0, target);
        let used = 0;
        const kept: typeof selected = [];
        for (const item of backwards ? [...selected].reverse() : selected) {
            const entry = this.entry(item.row.message, item.entry.id!, scope)!;
            const size = Buffer.byteLength(JSON.stringify(entry));
            if (used + size > MAX_PAGE_BYTES - OUTCOME_RESERVE_BYTES) { budgetLimited = true; break; }
            used += size; kept.push({ ...item, entry });
        }
        if (backwards) kept.reverse();
        // Unreturned sampled entries remain available on the next page.
        const start = backwards ? kept[0]?.row.start ?? position : initial;
        const end = backwards ? initial : kept.at(-1)?.row.end ?? position;
        return { entries: kept.map(item => item.entry), start, end, scannedMessages, scannedBytes, budgetLimited };
    }
    private finish(scan: Scan, key: string, generation: string, source: "live" | "transcript", size: number, extra: Partial<Cursor> = {}, anchors?: readonly unknown[]): ConversationPage {
        const hasOlder = scan.start > 0, hasNewer = scan.end < size;
        return Object.freeze({ entries: Object.freeze(scan.entries), scannedMessages: scan.scannedMessages, scannedBytes: scan.scannedBytes,
            budgetLimited: scan.budgetLimited, source, generation, status: "ok", hasOlder, hasNewer,
            before: this.token({ ...extra, key, generation, position: scan.start, ...(anchors ? { anchor: this.id(anchors[scan.start], `${generation}:${scan.start}`) } : {}) }),
            after: this.token({ ...extra, key, generation, position: scan.end, ...(anchors ? { anchor: this.id(anchors[scan.end - 1], `${generation}:${scan.end - 1}`) } : {}) }),
            ...(scan.budgetLimited ? { hint: "Conversation scan budget reached; continue paging for more history." } : {}) });
    }
    livePage(key: string, owner: object, messages: readonly unknown[], compactions: number, request: ConversationPageRequest = {}): ConversationPage {
        let state = this.live.get(key);
        if (!state || state.owner.deref() !== owner || state.compactions !== compactions || messages.length < state.count ||
            (state.count > 0 && (this.id(messages[0], "empty") !== state.first || this.id(messages[state.count - 1], "empty") !== state.last))) {
            state = { owner: new WeakRef(owner), generation: randomUUID(), count: messages.length, first: this.id(messages[0], "empty"), last: this.id(messages.at(-1), "empty"), compactions };
            if (this.live.size >= 256) this.live.delete(this.live.keys().next().value!);
            this.live.set(key, state);
        } else { state.count = messages.length; state.last = this.id(messages.at(-1), "empty"); state.first = this.id(messages[0], "empty"); }
        const direction = request.direction ?? "latest";
        const cursor = direction === "latest" ? undefined : this.request(key, state.generation, request);
        if (direction !== "latest" && (!cursor || cursor.position > messages.length ||
            (cursor.anchor !== undefined && this.id(messages[direction === "before" ? cursor.position : cursor.position - 1], `${state.generation}:${direction === "before" ? cursor.position : cursor.position - 1}`) !== cursor.anchor)))
            return this.empty("live", state.generation, "reset", "Conversation changed or cursor expired; reload the latest page.");
        const backwards = direction !== "after", position = cursor?.position ?? messages.length;
        function* rows(): Generator<Row> {
            for (let i = backwards ? position - 1 : position; i >= 0 && i < messages.length; i += backwards ? -1 : 1)
                yield { message: messages[i], start: i, end: i + 1, bytes: messageBytes(messages[i]) };
        }
        const target = pageLimit(request.limit);
        const scan = this.scan(rows(), backwards, target, position, `${key}:${state.generation}`, row => this.id(row.message, `${state!.generation}:${row.start}`));
        return this.finish(scan, key, state.generation, "live", messages.length, {}, messages);
    }
    transcriptPage(key: string, path: string, request: ConversationPageRequest = {}): ConversationPage {
        let fd: number | undefined;
        try {
            fd = openSync(path, "r");
            const stat = fstatSync(fd);
            if (!stat.isFile()) return this.unavailable();
            const fingerprint = `${path}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
            let state = this.fileGenerations.get(key);
            if (!state || state.fingerprint !== fingerprint || stat.size < state.size || (stat.size === state.size && stat.mtimeMs !== state.mtime)) {
                state = { generation: randomUUID(), fingerprint, size: stat.size, mtime: stat.mtimeMs };
                if (this.fileGenerations.size >= 256) this.fileGenerations.delete(this.fileGenerations.keys().next().value!);
                this.fileGenerations.set(key, state);
            } else { state.size = stat.size; state.mtime = stat.mtimeMs; }
            const direction = request.direction ?? "latest";
            const cursor = direction === "latest" ? undefined : this.request(key, state.generation, request);
            if (direction !== "latest" && (!cursor || cursor.position > stat.size || (cursor.size === stat.size && cursor.mtime !== stat.mtimeMs)))
                return this.empty("transcript", state.generation, "reset", "Transcript changed or cursor expired; reload the latest page.");
            const backwards = direction !== "after", position = cursor?.position ?? stat.size;
            const io: { bytes: number; completeEnd?: number; pendingTail?: boolean } = { bytes: 0 };
            const scan = this.scan(fileRows(fd, position, stat.size, backwards, io), backwards, pageLimit(request.limit), position, `${key}:${state.generation}`,
                row => `${state!.generation}:${row.start}`);
            if (backwards && io.completeEnd !== undefined) scan.end = io.completeEnd;
            scan.scannedBytes = io.bytes;
            if (io.bytes >= MAX_SCAN_BYTES) scan.budgetLimited = true;
            const page = this.finish(scan, key, state.generation, "transcript", stat.size, { size: stat.size, mtime: stat.mtimeMs });
            return io.pendingTail ? Object.freeze({ ...page, hasNewer: false }) : page;
        } catch { return this.unavailable(); }
        finally { if (fd !== undefined) try { closeSync(fd); } catch { /* read-only descriptor */ } }
    }
}
export function pageLimit(limit?: number): number { return Number.isFinite(limit) ? Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit!))) : MAX_ENTRIES; }

/** Streaming byte-range reader. Oversize and incomplete lines are skipped, not retained. */
function* fileRows(fd: number, initial: number, size: number, backwards: boolean, io: { bytes: number; completeEnd?: number; pendingTail?: boolean }): Generator<Row> {
    let position = initial, carry = Buffer.alloc(0), boundary = initial, dropping = false;
    if (!backwards && initial > 0) {
        const preceding = Buffer.alloc(1);
        io.bytes += readSync(fd, preceding, 0, 1, initial - 1);
        dropping = preceding[0] !== 10;
    }
    let first = true;
    while ((backwards ? position > 0 : position < size) && io.bytes < MAX_SCAN_BYTES) {
        const length = Math.min(CHUNK, MAX_SCAN_BYTES - io.bytes, backwards ? position : size - position);
        const start = backwards ? position - length : position;
        const buffer = Buffer.alloc(length);
        const actual = readSync(fd, buffer, 0, length, start);
        if (!actual) break;
        io.bytes += actual;
        position = backwards ? start : start + actual;
        const data = backwards ? Buffer.concat([buffer.subarray(0, actual), carry]) : Buffer.concat([carry, buffer.subarray(0, actual)]);
        const base = backwards ? start : start - carry.length;
        let edge = backwards ? data.length : 0;
        if (backwards) {
            for (let i = data.length - 1; i >= 0; i--) if (data[i] === 10) {
                if (first) { first = false; dropping = false; edge = i; boundary = base + i + 1; io.completeEnd = boundary; io.pendingTail = initial === size && boundary < size; continue; }
                const line = data.subarray(i + 1, edge);
                yield { message: dropping ? undefined : parseLine(line), start: base + i + 1, end: boundary, bytes: boundary - (base + i + 1) };
                dropping = false; edge = i; boundary = base + i + 1;
            }
            carry = dropping || edge > MAX_LINE ? Buffer.alloc(0) : Buffer.from(data.subarray(0, edge));
            if (edge > MAX_LINE) dropping = true;
        } else {
            for (let i = 0; i < data.length; i++) if (data[i] === 10) {
                yield { message: dropping ? undefined : parseLine(data.subarray(edge, i)), start: boundary, end: base + i + 1, bytes: base + i + 1 - boundary };
                dropping = false; edge = i + 1; boundary = base + i + 1;
            }
            carry = dropping || data.length - edge > MAX_LINE ? Buffer.alloc(0) : Buffer.from(data.subarray(edge));
            if (data.length - edge > MAX_LINE) dropping = true;
        }
    }
    if (backwards && position === 0 && first) { io.completeEnd = 0; io.pendingTail = size > 0; }
    if (!backwards && position === size && boundary < size && !dropping) { io.pendingTail = true; return; }
    if (backwards && position === 0 && !first) yield { message: dropping ? undefined : parseLine(carry), start: 0, end: boundary, bytes: boundary };
    else if (position !== boundary) yield { start: backwards ? position : boundary, end: backwards ? boundary : position, bytes: Math.abs(position - boundary) };
}
function parseLine(line: Buffer): unknown {
    if (line.length > MAX_LINE) return undefined;
    try { const value: unknown = JSON.parse(line.toString("utf8")); return obj(value) ? value.message : undefined; } catch { return undefined; }
}
