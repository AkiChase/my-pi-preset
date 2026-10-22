import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { TaskDetail, TaskMessageEntry, TaskView } from "./types.ts";
import { cleanTaskText, taskOneLine, taskTokens, type TaskTheme } from "./presentation.ts";

const LABEL_WIDTH = 10;

/** Human duration for configured millisecond budgets (not elapsed task time). */
export function formatMs(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return String(ms);
    if (ms < 1000) return `${Math.floor(ms)}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return seconds % 60 ? `${minutes}m${seconds % 60}s` : `${minutes}m`;
    return minutes % 60 ? `${Math.floor(minutes / 60)}h${minutes % 60}m` : `${Math.floor(minutes / 60)}h`;
}

/** `── Name ────` section rule; a suffix that does not fit wraps below instead of being lost. */
export function sectionTitle(name: string, theme: TaskTheme, width: number, suffix = ""): string[] {
    if (width < 1) return [];
    const head = `── ${name}`;
    const inline = suffix && visibleWidth(`${head} · ${suffix} `) <= width;
    const text = truncateToWidth(head + (inline ? ` · ${suffix}` : "") + " ", width, "…");
    const fill = Math.max(0, width - visibleWidth(text));
    const nameEnd = Math.min(text.length, head.length);
    const rule = theme.fg("borderMuted", text.slice(0, 3)) + theme.fg("accent", text.slice(3, nameEnd)) +
        theme.fg("dim", text.slice(nameEnd)) + theme.fg("borderMuted", "─".repeat(fill));
    return suffix && !inline ? [rule, ...wrapTextWithAnsi(theme.fg("dim", suffix), width)] : [rule];
}

/** Label column + wrapped value; narrow screens put the value below its label. */
export function field(label: string, value: string, theme: TaskTheme, width: number): string[] {
    if (width < 1) return [];
    const labelText = theme.fg("dim", label);
    if (width < LABEL_WIDTH + 12) return [truncateToWidth(labelText, width, "…"), ...wrapTextWithAnsi(value, width)];
    // Long labels (e.g. artifact kinds) still keep one separating space.
    const column = Math.max(LABEL_WIDTH, visibleWidth(label) + 1), pad = " ".repeat(column);
    return wrapTextWithAnsi(value, width - column).map((line, i) =>
        (i ? pad : labelText + " ".repeat(Math.max(1, LABEL_WIDTH - visibleWidth(label)))) + line);
}

const sep = (theme: TaskTheme) => theme.fg("dim", " · ");
const join = (theme: TaskTheme, parts: (string | undefined | false)[]) => parts.filter((part): part is string => !!part).join(sep(theme));

function agentConfigLine(view: TaskView, theme: TaskTheme): string | undefined {
    const config = view.executionConfig;
    if (!config || config.kind !== "agent") return undefined;
    return join(theme, [
        config.inherit_context ? "inherits context" : undefined,
        config.isolated ? "no extension tools" : undefined,
        config.isolation === "worktree" ? "worktree" : undefined,
        config.phase === "resolved" ? theme.fg("dim", "pending session confirmation") : undefined,
    ]) || undefined;
}

function differences(view: TaskView, theme: TaskTheme): string[] {
    const config = view.executionConfig;
    if (!config || config.kind !== "agent" || !config.differences?.length) return [];
    return config.differences.map(d => `${d.field}: ${theme.fg("dim", taskOneLine(String(d.requested)))} → ${taskOneLine(String(d.actual))}` +
        (d.reason ? theme.fg("dim", ` (${d.reason})`) : ""));
}

/** Kind-specific labelled fields; absent facts are omitted instead of shown raw. */
function fields(view: TaskView, theme: TaskTheme, now: number | undefined): [string, string][] {
    const s = view.stats, rows: [string, string][] = [];
    if (view.kind === "agent") {
        const model = s.model ?? (view.executionConfig?.kind === "agent" ? view.executionConfig.model : undefined);
        const thinking = s.thinking ?? (view.executionConfig?.kind === "agent" ? view.executionConfig.thinking : undefined);
        if (model || thinking) rows.push(["Model", join(theme, [model && theme.fg("toolTitle", taskOneLine(model)), thinking && `thinking ${taskOneLine(thinking)}`])]);
        const config = agentConfigLine(view, theme);
        if (config) rows.push(["Context", config]);
        for (const diff of differences(view, theme)) rows.push(["Override", diff]);
    }
    if (view.kind === "agent" || view.kind === "workflow") {
        const turns = s.turnCount === undefined ? undefined : s.maxTurns ? `${s.turnCount}/${s.maxTurns} turns` : `${s.turnCount} turns`;
        const tools = s.toolUses === undefined ? undefined : `${s.toolUses} tool ${s.toolUses === 1 ? "use" : "uses"}`;
        const progress = view.kind === "workflow" && s.totalCount !== undefined ? `${s.doneCount ?? 0}/${s.totalCount} agents` : undefined;
        const activity = join(theme, [progress, turns, tools]);
        if (activity) rows.push(["Activity", activity]);
        const total = taskTokens(s.tokens);
        if (total) {
            const split = s.inputTokens !== undefined || s.outputTokens !== undefined
                ? theme.fg("dim", ` (in ${taskTokens(s.inputTokens ?? 0)} · out ${taskTokens(s.outputTokens ?? 0)})`) : "";
            rows.push(["Tokens", total + split + (s.cost !== undefined && Number.isFinite(s.cost) && s.cost > 0
                ? ` · $${s.cost < 0.01 ? s.cost.toFixed(4) : s.cost.toFixed(2)}` : "")]);
        }
    }
    if (view.kind === "shell" || view.kind === "monitor") {
        if (s.pid !== undefined) rows.push(["PID", String(s.pid)]);
        if (s.exitCode !== undefined) rows.push(["Exit", theme.fg(s.exitCode === 0 ? "success" : "error", String(s.exitCode))]);
        const config = view.executionConfig;
        if (config?.kind === "monitor") rows.push(["Monitor", join(theme, [
            config.timeout_ms === null ? "no deadline" : `deadline ${formatMs(config.timeout_ms)}`,
            config.wake_absent_ms === null ? undefined : `silence ${formatMs(config.wake_absent_ms)}`,
            `batch ${formatMs(config.batch_interval_ms)}`,
        ])]);
    }
    rows.push(["ID", theme.fg("dim", `${taskOneLine(view.taskId)} · run ${taskOneLine(view.runId)}`)]);
    return rows;
}

export function detailRange(detail: TaskDetail | undefined): string {
    if (!detail) return "not established";
    const span = detail.start !== undefined ? `${detail.start}–${detail.end} / ${detail.size}` : undefined;
    const omitted = (detail.omittedBefore ?? 0) || (detail.omittedAfter ?? 0) ? `omitted before ${detail.omittedBefore ?? 0}, after ${detail.omittedAfter ?? 0}` : undefined;
    return [span, omitted].filter(Boolean).join(" · ") || "complete";
}

/** Non-scrolling metadata summary. Values are single-line and height-bounded. */
export function renderDetailHeader(view: TaskView, theme: TaskTheme, width: number, now?: number, maxLines = 8): string[] {
    width = Math.max(1, Math.floor(width));
    const lines = [...(view.kind === "agent" ? [] : [theme.fg("toolTitle", taskOneLine(view.title))]),
        theme.fg("dim", `${view.kind} · ${view.executionMode}`)];
    if (view.description && taskOneLine(view.description) !== taskOneLine(view.title))
        lines.push(`${view.kind === "shell" || view.kind === "monitor" ? "$ " : ""}${taskOneLine(view.description)}`);
    const metadata = fields(view, theme, now);
    // Compact configuration differences into one bounded row, leaving core statistics room.
    const overrides = metadata.filter(([label]) => label === "Override");
    const context = metadata.findIndex(([label]) => label === "Context");
    if (overrides.length && context >= 0) {
        metadata[context][1] += " · " + overrides.map(([, value]) => `Override ${value}`).join(" · ");
        for (let i = metadata.length - 1; i >= 0; i--) if (metadata[i][0] === "Override") metadata.splice(i, 1);
    }
    // Artifacts remain in the summary even when statistics overflow it. Copy retains full paths.
    const artifact = view.artifacts[0];
    const budget = Math.max(0, Math.floor(maxLines));
    const available = Math.max(0, budget - lines.length - (artifact ? 1 : 0));
    lines.push(...metadata.slice(0, available).map(([label, value]) => `${theme.fg("dim", label)}  ${value}`));
    if (artifact && budget > lines.length) lines.push(`${theme.fg("dim", artifact.kind)}  ${taskOneLine(artifact.path)}${view.artifacts.length > 1 ? ` (+${view.artifacts.length - 1})` : ""}`);
    return lines.slice(0, budget).map(line => truncateToWidth(line, width, "…"));
}

function clock(at: number): string {
    const date = new Date(at);
    return Number.isFinite(date.getTime()) ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}` : "";
}

/** Parent questions (with state) and child replies/notices, oldest first. */
export function renderMessages(entries: readonly TaskMessageEntry[], theme: TaskTheme, width: number): string[] {
    width = Math.max(1, Math.floor(width));
    const lines: string[] = [];
    for (const entry of entries) {
        const time = theme.fg("dim", clock(entry.at));
        const label = entry.kind === "question"
            ? `${theme.fg("accent", "↑ question")} ${theme.fg("dim", entry.requestId)} ${theme.fg(entry.state === "replied" ? "success" : entry.state === "pending" ? "warning" : "error", `[${entry.state}]`)}`
            : entry.kind === "reply" ? `${theme.fg("success", "↓ reply")} ${theme.fg("dim", entry.requestId)}` : theme.fg("muted", "↓ notice");
        lines.push(truncateToWidth(`${time} ${label}`, width, "…"));
        for (const part of cleanTaskText(entry.text).split(/\r\n|\n|\r/)) lines.push(...wrapTextWithAnsi("  " + part, width));
    }
    return lines.map(line => truncateToWidth(line, width, "…"));
}
