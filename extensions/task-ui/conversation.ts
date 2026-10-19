import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, wrapTextWithAnsi, type MarkdownOptions, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { ConversationEntry } from "./types.ts";
import { cleanTaskText, taskOneLine, type TaskTheme } from "./presentation.ts";

/** Keep source that only looks like Markdown (renumbered lists, escapes) intact. */
const MARKDOWN_OPTIONS: MarkdownOptions = { preserveOrderedListMarkers: true, preserveBackslashEscapes: true };
const CACHE_LIMIT = 128;

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

    render(entries: readonly ConversationEntry[], width: number, theme: TaskTheme, options: { activity?: string; truncated?: boolean } = {}): string[] {
        width = Math.max(1, Math.floor(width));
        if (theme !== this.themeRef) { this.themeRef = theme; this.mdTheme = undefined; this.cache.clear(); }
        const lines: string[] = [];
        if (options.truncated) lines.push(theme.fg("dim", "… older messages omitted"), "");
        if (!entries.length) lines.push(theme.fg("dim", "(waiting for first message…)"));
        entries.forEach((entry, i) => {
            if (i) lines.push("");
            lines.push(...this.entry(entry, width, theme));
        });
        if (options.activity) lines.push("", theme.fg("accent", "▍ ") + theme.fg("dim", taskOneLine(options.activity)));
        return lines.map(line => truncateToWidth(line, width, "…"));
    }

    dispose(): void { this.cache.clear(); this.mdTheme = undefined; this.themeRef = undefined; }

    private entry(entry: ConversationEntry, width: number, theme: TaskTheme): string[] {
        const b = bold(theme);
        const wrapDim = (text: string, indent = "  ") => cleanTaskText(text).split(/\r\n|\n|\r/)
            .flatMap(part => wrapTextWithAnsi(part, Math.max(1, width - indent.length)).map(line => indent + theme.fg("dim", line)));
        const elided = (count: number) => count ? [theme.fg("dim", `  … ${count.toLocaleString("en-US")} more characters`)] : [];
        switch (entry.kind) {
            case "user":
                return [b(theme.fg("accent", "User")), ...cleanTaskText(entry.text).split(/\r\n|\n|\r/).flatMap(part => wrapTextWithAnsi(part, width))];
            case "assistant":
                return [b(theme.fg("success", "Assistant")), ...(entry.text ? this.markdown(cleanTaskText(entry.text), width, theme) : []),
                    ...entry.tools.map(tool => this.toolLine(tool.name, tool.detail, width, theme))];
            case "toolResult":
                return [theme.fg(entry.error ? "error" : "muted", `  ${entry.error ? "✗" : "↳"} ${taskOneLine(entry.name ?? "result")}${entry.error ? " failed" : ""}`),
                    ...(entry.text ? wrapDim(entry.text, "    ") : []), ...elided(entry.elided)];
            case "bash":
                return [theme.fg("bashMode", "$ ") + theme.fg("mdCode", taskOneLine(entry.command)) +
                    (entry.exitCode !== undefined && entry.exitCode !== 0 ? theme.fg("error", ` (exit ${entry.exitCode})`) : ""),
                    ...(entry.output ? wrapDim(entry.output) : []), ...elided(entry.elided)];
            case "notice":
                return wrapTextWithAnsi(theme.fg("warning", taskOneLine(entry.text)), width);
        }
    }

    private toolLine(name: string, detail: string | undefined, width: number, theme: TaskTheme): string {
        const head = `  ⏺ ${taskOneLine(name)}`;
        const rest = detail ? "  " + taskOneLine(detail) : "";
        return truncateToWidth(theme.fg("toolTitle", head) + theme.fg("muted", rest), width, "…");
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
