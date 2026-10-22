import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth, truncateToWidth, wrapTextWithAnsi, type MarkdownOptions, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { ConversationEntry, ToolCallState } from "./types.ts";
import { cleanTaskText, taskOneLine, type TaskTheme } from "./presentation.ts";

/** Keep source that only looks like Markdown (renumbered lists, escapes) intact. */
const MARKDOWN_OPTIONS: MarkdownOptions = { preserveOrderedListMarkers: true, preserveBackslashEscapes: true };
const CACHE_LIMIT = 128;
const PREVIEW_LINES = 5;
const EXPANDED_LINES = 40;
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
    private cache = new Map<string, { md: Markdown; failed: boolean }>();
    private mdTheme?: MarkdownTheme;
    private themeRef?: TaskTheme;

    render(entries: readonly ConversationEntry[], width: number, theme: TaskTheme, options: { activity?: string; truncated?: boolean; expanded?: ReadonlySet<string>; toolCalls?: readonly ToolCallState[] } = {}): string[] {
        return this.renderModel(entries, width, theme, options).lines;
    }

    renderModel(entries: readonly ConversationEntry[], width: number, theme: TaskTheme, options: { activity?: string; truncated?: boolean; expanded?: ReadonlySet<string>; toolCalls?: readonly ToolCallState[] } = {}): ConversationRenderModel {
        width = Math.max(1, Math.floor(width));
        if (theme !== this.themeRef) { this.themeRef = theme; this.mdTheme = undefined; this.cache.clear(); }
        const calls = new Map((options.toolCalls ?? []).map(call => [call.toolCallId, call]));
        for (const entry of entries) if (entry.kind === "toolResult" && entry.toolCallId && !calls.has(entry.toolCallId))
            calls.set(entry.toolCallId, { toolCallId: entry.toolCallId, name: entry.name ?? "result", status: entry.error ? "failed" : "completed",
                ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }) });
        const lines: string[] = [], ranges: ConversationRange[] = [];
        if (options.truncated) lines.push(theme.fg("dim", "… older messages omitted"), "");
        if (!entries.length) lines.push(theme.fg("dim", "(waiting for first message…)"));
        entries.forEach((entry, i) => {
            if (i) lines.push("");
            const start = lines.length;
            lines.push(...this.entry(entry, width, theme, !!entry.id && !!options.expanded?.has(entry.id), [...calls.values()]));
            if (entry.id) ranges.push({ id: entry.id, start, end: lines.length, collapsible: entry.kind === "bash" || entry.kind === "toolResult" });
        });
        if (options.activity) lines.push("", theme.fg("accent", "▍ ") + theme.fg("dim", taskOneLine(options.activity)));
        return { lines: lines.map(line => truncateToWidth(line, width, "…")), ranges };
    }

    dispose(): void { this.cache.clear(); this.mdTheme = undefined; this.themeRef = undefined; }

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
            case "toolResult": {
                const summary = entry.summary;
                const facts = summary ? [summary.path, summary.command,
                    summary.offset === undefined ? undefined : `from line ${summary.offset}`,
                    summary.limit === undefined ? undefined : `limit ${summary.limit}`,
                    summary.lines === undefined ? undefined : `${summary.lines} lines`,
                    summary.bytes === undefined ? undefined : `${summary.bytes} bytes`,
                    summary.addedLines === undefined ? undefined : `+${summary.addedLines} lines`,
                    summary.removedLines === undefined ? undefined : `−${summary.removedLines} lines`].filter(Boolean).map(value => taskOneLine(String(value))).join(" · ") : entry.callDetail;
                const successWrite = summary?.kind === "write" && !entry.error;
                const call = calls.find(call => call.toolCallId === entry.toolCallId);
                const timing = call ?? (entry.durationMs === undefined ? undefined : { toolCallId: entry.toolCallId ?? "", name: entry.name ?? "result", status: entry.error ? "failed" as const : "completed" as const, durationMs: entry.durationMs });
                return [timing ? this.toolLine(entry.name ?? summary?.kind ?? "result", toggle.trim() || undefined, width, theme, timing)
                    : truncateToWidth(theme.fg(entry.error ? "error" : "muted", `  ${entry.error ? "✗" : "↳"} ${taskOneLine(entry.name ?? summary?.kind ?? "result")}${entry.error ? " failed" : ""}${toggle}`), width, "…"),
                    ...(facts ? [truncateToWidth("  " + theme.fg("muted", taskOneLine(facts)), width, "…")] : []),
                    ...(!successWrite && entry.text ? preview(entry.text, "    ", summary?.kind === "bash") : []), ...elided(entry.elided),
                    ...(entry.sourceTruncated ? [theme.fg("dim", "  … additional content omitted")] : [])];
            }
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
