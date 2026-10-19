import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { TaskDetail, TaskView } from "./types.ts";
import { cleanTaskText, taskDot, taskDuration, taskOneLine, taskStatusColor, taskTokens, type TaskTheme } from "./presentation.ts";

type Color = Parameters<TaskTheme["fg"]>[0];
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
    const duration = taskDuration(view, now);
    if (view.kind === "agent") {
        const model = s.model ?? (view.executionConfig?.kind === "agent" ? view.executionConfig.model : undefined);
        const thinking = s.thinking ?? (view.executionConfig?.kind === "agent" ? view.executionConfig.thinking : undefined);
        if (model || thinking) rows.push(["Model", join(theme, [model && theme.fg("toolTitle", taskOneLine(model)), thinking && `thinking ${taskOneLine(thinking)}`])]);
        const config = agentConfigLine(view, theme);
        if (config) rows.push(["Context", config]);
        for (const diff of differences(view, theme)) rows.push(["Override", diff]);
    }
    if (duration) rows.push(["Time", duration]);
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
            rows.push(["Tokens", total + split]);
        }
        if (s.cost !== undefined && Number.isFinite(s.cost) && s.cost > 0) rows.push(["Cost", `$${s.cost < 0.01 ? s.cost.toFixed(4) : s.cost.toFixed(2)}`]);
        if (s.activity) rows.push(["Now", theme.fg("accent", taskOneLine(s.activity))]);
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
    if (view.waitCount > 0) rows.push(["Waiting", theme.fg("warning", `${view.waitCount} wait${view.waitCount === 1 ? "" : "s"}`)]);
    rows.push(["ID", theme.fg("dim", `${taskOneLine(view.taskId)} · run ${taskOneLine(view.runId)}`)]);
    return rows;
}

export function detailRange(detail: TaskDetail | undefined): string {
    if (!detail) return "not established";
    const span = detail.start !== undefined ? `${detail.start}–${detail.end} / ${detail.size}` : undefined;
    const omitted = (detail.omittedBefore ?? 0) || (detail.omittedAfter ?? 0) ? `omitted before ${detail.omittedBefore ?? 0}, after ${detail.omittedAfter ?? 0}` : undefined;
    return [span, omitted].filter(Boolean).join(" · ") || "complete";
}

/** Summary card plus kind-specific sections; the bounded output body is appended by the caller. */
export function renderDetailHeader(view: TaskView, theme: TaskTheme, width: number, now?: number): string[] {
    width = Math.max(1, Math.floor(width));
    const color: Color = taskStatusColor(view);
    const mode = view.executionMode === "owned" ? "owned" : view.executionMode;
    const status = `${theme.fg(color, taskDot(view) + " " + view.status)}${sep(theme)}${theme.fg("muted", view.kind)}${sep(theme)}${theme.fg("dim", mode)}`;
    const lines = [truncateToWidth(status, width, "…")];
    // Agent title is a handle/type; its description is the delegated prose (shown in full below).
    const title = cleanTaskText(view.title);
    lines.push(...wrapTextWithAnsi(theme.fg("toolTitle", title.replace(/\s+/g, " ").trim()), width));
    const isProcess = view.kind === "shell" || view.kind === "monitor";
    if (view.description && !isProcess && taskOneLine(view.description) !== taskOneLine(view.title)) {
        for (const part of cleanTaskText(view.description).split(/\r\n|\n|\r/)) lines.push(...wrapTextWithAnsi(part, width));
    }
    lines.push("");
    for (const [label, value] of fields(view, theme, now)) lines.push(...field(label, value, theme, width));
    if (isProcess && view.description) {
        lines.push("", ...sectionTitle("Command", theme, width));
        const command = cleanTaskText(view.description).split(/\r\n|\n|\r/);
        command.forEach((part, i) => lines.push(...wrapTextWithAnsi((i ? "  " : theme.fg("dim", "$ ")) + theme.fg("mdCode", part), width)));
    }
    const phases = view.stats.phases ?? [];
    if (phases.length) {
        lines.push("", ...sectionTitle("Phases", theme, width));
        for (const phase of phases) {
            lines.push(...wrapTextWithAnsi(`${theme.fg("dim", String(phase.index).padStart(2))} ${cleanTaskText(phase.title)}`, width));
            if (phase.detail) lines.push(...wrapTextWithAnsi(theme.fg("dim", "   " + cleanTaskText(phase.detail)), width));
        }
    }
    if (view.artifacts.length) {
        lines.push("", ...sectionTitle("Artifacts", theme, width));
        for (const artifact of view.artifacts) lines.push(...field(artifact.kind, cleanTaskText(artifact.path), theme, width));
    }
    return lines.map(line => truncateToWidth(line, width, "…"));
}
