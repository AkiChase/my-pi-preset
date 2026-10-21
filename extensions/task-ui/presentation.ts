import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TaskView } from "./types.ts";

/** Sanitize external text before applying host-owned styles. Preserve detail line breaks. */
export function cleanTaskText(text: string): string {
    return stripTerminalSequences(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}
export const taskOneLine = (text: string): string => cleanTaskText(text).replace(/\s+/g, " ").trim();

/** Process descriptions carry commands, whereas Agent descriptions carry delegated prose. */
export function taskTitle(view: TaskView): string {
    const candidates = view.kind === "agent" || view.kind === "workflow"
        ? [view.title, view.description] : [view.title, view.description];
    for (const value of candidates) {
        const text = taskOneLine(value ?? "");
        if (text) return text;
    }
    return taskOneLine(view.taskId) || view.kind;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** Only real runtime states; callers opt into animation on active UI surfaces. */
export function taskDot(view: TaskView, frame?: number): string {
    switch (view.status) {
        case "queued": return "○";
        case "starting": case "running": return frame === undefined ? "◌" : SPINNER[Math.abs(Math.floor(frame)) % SPINNER.length];
        case "paused": return "Ⅱ";
        case "completed": return "✓";
        case "failed": return "✕";
        case "stopped": return "■";
        case "interrupted": return "!";
    }
}
export function taskStatusColor(view: TaskView): Parameters<Theme["fg"]>[0] {
    switch (view.status) {
        case "running": return "accent";
        case "starting": case "paused": return "warning";
        case "queued": return "muted";
        case "completed": return "success";
        case "failed": return "error";
        case "stopped": return "dim";
        case "interrupted": return "warning";
    }
}
export function taskDuration(view: TaskView, now = Date.now()): string | undefined {
    const ms = view.stats.durationMs ?? (view.startedAt === undefined ? undefined : (view.endedAt ?? now) - view.startedAt);
    if (ms === undefined || !Number.isFinite(ms)) return undefined;
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}
export function taskTokens(tokens: number | undefined): string | undefined {
    if (tokens === undefined || !Number.isFinite(tokens) || tokens < 0) return undefined;
    return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1_000 ? `${(tokens / 1_000).toFixed(1)}k` : String(Math.floor(tokens));
}

export type TaskTheme = Pick<Theme, "fg"> & Partial<Pick<Theme, "bg" | "bold">>;
export interface TaskLineOptions { prefix?: string; children?: number; selected?: boolean; now?: number; animationFrame?: number }

/** One bounded task line. Protect state/wait first, then statistics, before title/indentation. */
export function taskLine(view: TaskView, width: number, theme: TaskTheme, options: TaskLineOptions = {}): string {
    width = Math.max(0, Math.floor(width));
    if (!width) return "";
    const fit = (text: string, size: number) => truncateToWidth(text, Math.max(0, size), "…");
    const state = `[${view.status}${view.waitCount > 0 ? ` · waiting ${view.waitCount}` : ""}]`;
    const stats = [taskDuration(view, options.now), taskTokens(view.stats.tokens) === undefined ? undefined : `↓ ${taskTokens(view.stats.tokens)}`].filter(Boolean).join(" · ");
    // Narrow terminals drop secondary numbers/indentation, never all evidence of state.
    const dot = theme.fg(taskStatusColor(view), taskDot(view, options.animationFrame));
    const budget = Math.max(0, width - 2);
    let suffix = state;
    if (stats && visibleWidth(state + " " + stats) + 8 <= budget) suffix += ` ${stats}`;
    suffix = fit(suffix, Math.max(0, budget - (budget >= 5 ? 2 : 0)));
    const leftWidth = Math.max(0, budget - visibleWidth(suffix) - 1);
    const count = options.children ? ` (${options.children})` : "";
    const titleWidth = Math.max(0, leftWidth - visibleWidth(count));
    const title = `${view.kind} ${taskTitle(view)}`;
    // Tree spaces are structural, not prose whitespace. Keep the trailing branch
    // on deep trees even when the full continuation cannot fit.
    const prefix = cleanTaskText(options.prefix ?? "").replace(/[\r\n]/g, "");
    const prefixBudget = Math.max(0, titleWidth - 5);
    const tree = visibleWidth(prefix) <= prefixBudget ? prefix : prefixBudget >= 3 ? "…" + prefix.slice(-2) : "";
    const left = fit(tree ? tree + " " + title : title, titleWidth) + fit(count, leftWidth);
    let line = fit(`${dot} ${left}${left ? " " : ""}${theme.fg(taskStatusColor(view), suffix)}`, width);
    line += " ".repeat(Math.max(0, width - visibleWidth(line)));
    if (!options.selected || !theme.bg) return line;
    // Host foreground wrappers/truncation can emit reset-all or background reset.
    // Reapply only the owned background, retaining all foreground style semantics.
    const paintedSpace = theme.bg("userMessageBg", " ");
    const open = paintedSpace.slice(0, paintedSpace.indexOf(" "));
    return theme.bg("userMessageBg", line.replace(/\u001b\[([0-9;]*)m/g, (sgr, codes: string) =>
        codes.split(";").some(code => code === "" || code === "0" || code === "49") ? sgr + open : sgr));
}

/** Fixed selected status: protect lifecycle/name/activity before secondary counters. */
export function taskStatusLine(view: TaskView, width: number, theme: TaskTheme, now?: number, frame?: number): string {
    const state = theme.fg(taskStatusColor(view), `${taskDot(view, frame)} ${view.status}`);
    const name = truncateToWidth(taskOneLine(view.title), Math.max(0, Math.floor(width / 3)), "…");
    const primary = `${state} · ${name}`;
    const activity = view.stats.activity ? ` · ${taskOneLine(view.stats.activity)}` : "";
    const secondary = [taskDuration(view, now), view.stats.turnCount === undefined ? undefined : `${view.stats.turnCount} turns`,
        view.stats.toolUses === undefined ? undefined : `${view.stats.toolUses} tools`, taskTokens(view.stats.tokens)].filter(Boolean).join(" · ");
    return truncateToWidth(primary + activity + (secondary ? ` · ${secondary}` : ""), width, "…");
}
