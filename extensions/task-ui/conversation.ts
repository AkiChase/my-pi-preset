import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth, truncateToWidth, wrapTextWithAnsi, type MarkdownOptions, type MarkdownTheme } from "@earendil-works/pi-tui";
import { DetailToolCard, type DetailTool } from "./detail-tool-card.ts";
import type { ConversationEntry, ToolCallState } from "./types.ts";
import { cleanTaskText, taskOneLine, type TaskTheme } from "./presentation.ts";

/** Keep source that only looks like Markdown (renumbered lists, escapes) intact. */
const MARKDOWN_OPTIONS: MarkdownOptions = { preserveOrderedListMarkers: true, preserveBackslashEscapes: true };
const CACHE_LIMIT = 128;
const PREVIEW_LINES = 3;
const EXPANDED_LINES = Infinity;
export interface ConversationRange { id: string; start: number; end: number; collapsible: boolean }
export interface ConversationRenderModel { lines: string[]; ranges: ConversationRange[] }

const sgr = (on: number, off: number) => (text: string) => `\x1b[${on}m${text}\x1b[${off}m`;
const bold = (theme: TaskTheme) => (text: string) => theme.bold ? theme.bold(text) : sgr(1, 22)(text);

/**
 * Pi's Markdown theme when its global theme is initialized (syntax-highlighted
 * fences), else one built from the injected theme. Probed eagerly because the
 * host theme reads its global lazily and would otherwise throw inside render().
 */
function markdownTheme(theme: TaskTheme): MarkdownTheme {
    try { const host = getMarkdownTheme(); host.heading("probe"); return host; } catch { /* fall through */ }
    const b = bold(theme);
    return {
        heading: text => b(theme.fg("mdHeading", text)), link: text => theme.fg("mdLink", text), linkUrl: text => theme.fg("mdLinkUrl", text),
        code: text => theme.fg("mdCode", text), codeBlock: text => theme.fg("mdCodeBlock", text), codeBlockBorder: text => theme.fg("mdCodeBlockBorder", text),
        quote: text => theme.fg("mdQuote", text), quoteBorder: text => theme.fg("mdQuoteBorder", text), hr: text => theme.fg("mdHr", text),
        listBullet: text => theme.fg("mdListBullet", text), bold: b, italic: sgr(3, 23), strikethrough: sgr(9, 29), underline: sgr(4, 24),
    };
}

/** Renders structured conversation entries; owns a bounded Markdown cache for one panel. */
export class ConversationRenderer {
    private cards = new Map<string, DetailToolCard>();
    private cardCosts = new Map<string, number>();
    private readonly redraw: () => void;
    constructor(redraw: () => void = () => {}) { this.redraw = redraw; }
    private cache = new Map<string, { md: Markdown; failed: boolean }>();
    private mdTheme?: MarkdownTheme;
    private themeRef?: TaskTheme;

    render(entries: readonly ConversationEntry[], width: number, theme: TaskTheme, options: { activity?: string; truncated?: boolean; expanded?: ReadonlySet<string>; toolsExpanded?: boolean; toolCalls?: readonly ToolCallState[] } = {}): string[] {
        return this.renderModel(entries, width, theme, options).lines;
    }

    renderModel(entries: readonly ConversationEntry[], width: number, theme: TaskTheme, options: { activity?: string; truncated?: boolean; expanded?: ReadonlySet<string>; toolsExpanded?: boolean; toolCalls?: readonly ToolCallState[] } = {}): ConversationRenderModel {
        width = Math.max(1, Math.floor(width));
        if (theme !== this.themeRef) { this.themeRef = theme; this.mdTheme = undefined; this.cache.clear(); for (const card of this.cards.values()) card.dispose(); this.cards.clear(); this.cardCosts.clear(); }
        const calls = new Map((options.toolCalls ?? []).map(call => [call.toolCallId, call]));
        for (const entry of entries) if (entry.kind === "toolResult" && entry.toolCallId && !calls.has(entry.toolCallId))
            calls.set(entry.toolCallId, { toolCallId: entry.toolCallId, name: entry.name ?? "result", status: entry.error ? "failed" : "completed",
                ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }) });
        const lines: string[] = [], ranges: ConversationRange[] = [];
        if (options.truncated) lines.push(theme.fg("dim", "… older messages omitted"), "");
        if (!entries.length) lines.push(theme.fg("dim", "(waiting for first message…)"));
        const tools = new Map<string, DetailTool>();
        const idFor = (id: string) => `tool:${id}`;
        entries.forEach((entry, index) => {
            if (entry.kind === "assistant") entry.tools.forEach((call, n) => {
                const id = call.toolCallId ? idFor(call.toolCallId) : `${entry.id ?? index}:tool:${n}`;
                const previous = tools.get(id);
                tools.set(id, { ...previous, id, call: { ...previous?.call, ...call,
                    parameters: call.parameters ?? previous?.call.parameters, summary: call.summary ?? previous?.call.summary,
                    detail: call.detail ?? previous?.call.detail }, state: call.toolCallId ? calls.get(call.toolCallId) : undefined });
            });
            if (entry.kind === "toolResult") {
                const id = entry.toolCallId ? idFor(entry.toolCallId) : entry.id ?? `result:${index}`;
                const existing = tools.get(id);
                tools.set(id, { id, call: existing?.call ?? entry.call ?? { name: entry.name ?? entry.summary?.kind ?? "result", detail: entry.callDetail, summary: entry.summary }, result: entry,
                    state: entry.toolCallId ? calls.get(entry.toolCallId) : { toolCallId: id, name: entry.name ?? "result", status: entry.error ? "failed" : "completed", durationMs: entry.durationMs } });
            }
        });
        const emitted = new Set<string>();
        const emit = (id: string) => {
            if (emitted.has(id)) return;
            emitted.add(id);
            const tool = tools.get(id)!;
            const start = lines.length, expanded = options.toolsExpanded ? !options.expanded?.has(id) : !!options.expanded?.has(id);
            let card = this.cards.get(id);
            if (!card) { card = new DetailToolCard(tool, this.redraw); this.cards.set(id, card); }
            const renderedCard = card.render(tool, expanded, width, theme);
            lines.push(...renderedCard);
            // Logical retained payload budget: two serialized-input copies plus the
            // final styled rows. SDK object overhead/engine heap is not byte-accounted;
            // native caches derive only from bounded args/text/diff and <=128 cards.
            this.cardCosts.set(id, Buffer.byteLength(JSON.stringify(tool)) * 2 + Buffer.byteLength(renderedCard.join("\n")));
            while (this.cards.size > 128 || [...this.cardCosts.values()].reduce((a, b) => a + b, 0) > 256 * 1024) {
                const oldest = this.cards.keys().next().value!;
                this.cards.get(oldest)!.dispose(); this.cards.delete(oldest); this.cardCosts.delete(oldest);
            }
            if (tool.call.parameters?.status === "truncated") lines.push(theme.fg("dim", "… source parameters truncated"));
            if (tool.call.parameters?.status === "unavailable") lines.push(theme.fg("dim", "Parameters unavailable"));
            const result = tool.result;
            if (result?.elided) lines.push(theme.fg("dim", `… source truncated · ${result.elided.toLocaleString("en-US")} more characters`));
            if (result?.sourceTruncated) lines.push(theme.fg("dim", "… additional content omitted by source"));
            if (result?.display?.diffTruncated) lines.push(theme.fg("dim", "… source diff truncated"));
            if (result?.display?.status === "unavailable") lines.push(theme.fg("dim", "Result unavailable"));
            ranges.push({ id, start, end: lines.length, collapsible: true });
        };
        entries.forEach((entry, i) => {
            if (entry.kind === "toolResult") { emit(entry.toolCallId ? idFor(entry.toolCallId) : entry.id ?? `result:${i}`); return; }
            if (entry.kind === "assistant") {
                if (entry.text) {
                    if (lines.length) lines.push("");
                    const start = lines.length;
                    lines.push(...this.entry({ ...entry, tools: [] }, width, theme, false));
                    if (entry.id) ranges.push({ id: entry.id, start, end: lines.length, collapsible: false });
                }
                entry.tools.forEach((call, n) => emit(call.toolCallId ? idFor(call.toolCallId) : `${entry.id ?? i}:tool:${n}`));
                return;
            }
            if (lines.length) lines.push("");
            const start = lines.length;
            lines.push(...this.entry(entry, width, theme, !!entry.id && (options.toolsExpanded ? !options.expanded?.has(entry.id) : !!options.expanded?.has(entry.id)), [...calls.values()]));
            if (entry.id) ranges.push({ id: entry.id, start, end: lines.length, collapsible: entry.kind === "bash" });
        });
        for (const [id, card] of this.cards) if (!emitted.has(id)) { card.dispose(); this.cards.delete(id); this.cardCosts.delete(id); }
        if (options.activity) lines.push("", theme.fg("accent", "▍ ") + theme.fg("dim", taskOneLine(options.activity)));
        return { lines: lines.map(line => truncateToWidth(line, width, "…")), ranges };
    }

    dispose(): void { for (const card of this.cards.values()) card.dispose(); this.cards.clear(); this.cardCosts.clear(); this.cache.clear(); this.mdTheme = undefined; this.themeRef = undefined; }

    private entry(entry: ConversationEntry, width: number, theme: TaskTheme, expanded: boolean, calls: readonly ToolCallState[] = []): string[] {
        const b = bold(theme);
        const preview = (text: string, indent: string, tail = false): string[] => {
            const cap = expanded ? EXPANDED_LINES : PREVIEW_LINES;
            const visual = cleanTaskText(text).split(/\r\n|\n|\r/).flatMap(part => wrapTextWithAnsi(part, Math.max(1, width - indent.length)));
            const shown = tail ? visual.slice(-cap) : visual.slice(0, cap);
            return [...shown.map(line => indent + theme.fg("dim", line)),
                ...(visual.length > cap ? [theme.fg("dim", `  … ${visual.length - cap} more visual lines`)] : [])];
        };
        const elided = (count: number) => count ? [theme.fg("dim", `  … ${count.toLocaleString("en-US")} more characters`)] : [];
        const toggle = entry.id ? expanded ? " [click to collapse]" : " [click to expand]" : "";
        switch (entry.kind) {
            case "user":
                return [b(theme.fg("accent", "User")), ...cleanTaskText(entry.text).split(/\r\n|\n|\r/).flatMap(part => wrapTextWithAnsi(part, width))];
            case "assistant":
                return [b(theme.fg("success", "Assistant")), ...(entry.text ? this.markdown(cleanTaskText(entry.text), width, theme) : []),
                    ...entry.tools.map(tool => this.toolLine(tool.name, tool.detail, width, theme, calls.find(call => call.toolCallId === tool.toolCallId)))];
            case "toolResult": return []; // Paired cards are rendered above.
            case "bash":
                return [truncateToWidth(theme.fg("bashMode", "$ ") + theme.fg("mdCode", taskOneLine(entry.command)) +
                    (entry.exitCode !== undefined ? theme.fg(entry.exitCode ? "error" : "dim", ` (exit ${entry.exitCode})`) : "") + theme.fg("dim", toggle), width, "…"),
                    ...(entry.output ? preview(entry.output, "  ", true) : []), ...elided(entry.elided)];
            case "notice":
                return wrapTextWithAnsi(theme.fg("warning", taskOneLine(entry.text)), width);
        }
    }

    private toolLine(name: string, detail: string | undefined, width: number, theme: TaskTheme, call?: ToolCallState): string {
        const head = `  ⏺ ${taskOneLine(name)}`;
        const rest = detail ? "  " + taskOneLine(detail) : "";
        if (!call) return truncateToWidth(theme.fg("toolTitle", head) + theme.fg("muted", rest), width, "…");
        const state = { running: "Running", completed: "Completed", failed: "Failed", interrupted: "Interrupted" }[call.status];
        const execution = call.status !== "running" && call.status !== "interrupted" && call.durationMs !== undefined;
        const ms = execution ? call.durationMs : call.elapsedMs;
        const clock = ms === undefined ? "" : ` · ${execution ? "execution" : "elapsed"} ${(Math.max(0, ms) / 1000).toFixed(1)}s`;
        const suffix = theme.fg(call.status === "running" ? "accent" : call.status === "completed" ? "success" : call.status === "failed" ? "error" : "warning", state) + theme.fg("dim", clock);
        const left = truncateToWidth(theme.fg("toolTitle", head) + theme.fg("muted", rest), Math.max(0, width - visibleWidth(suffix) - 2), "…");
        return truncateToWidth((left ? left + "  " : "") + suffix, width, "…");
    }

    private markdown(text: string, width: number, theme: TaskTheme): string[] {
        let entry = this.cache.get(text);
        if (!entry) {
            this.mdTheme ??= markdownTheme(theme);
            entry = { md: new Markdown(text, 0, 0, this.mdTheme, undefined, MARKDOWN_OPTIONS), failed: false };
            if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(text, entry);
        }
        if (!entry.failed) {
            // The parser is recursive over arbitrary model text; deep nesting can overflow.
            try { return entry.md.render(width); } catch { entry.failed = true; }
        }
        return text.split(/\r\n|\n|\r/).flatMap(part => wrapTextWithAnsi(part, width));
    }
}
