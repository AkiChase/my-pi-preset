import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { FINISHED_LINGER_MS, isTerminal } from "./model.ts";
import { taskDot, taskDuration, taskStatusColor, taskTitle, taskTokens, type TaskTheme } from "./presentation.ts";
import type { TaskView } from "./types.ts";

/** Metadata only: no selection, detail pin, backend ownership or child token totals. */
export class TaskOverviewModel {
    private readonly retained = new Map<string, TaskView>();
    refresh(views: readonly TaskView[], now: number): readonly TaskView[] {
        for (const view of views) if (view.kind === "agent" || view.kind === "workflow") this.retained.set(view.key, view);
        const all = [...this.retained.values()], byKey = new Map(all.map(view => [view.key, view]));
        const live = new Set(views.map(view => view.key));
        const roots: TaskView[] = [], seen = new Set<string>();
        const children = new Map<string, TaskView[]>();
        for (const view of all) if (view.parentKey && byKey.has(view.parentKey)) {
            const group = children.get(view.parentKey) ?? []; group.push(view); children.set(view.parentKey, group);
        }
        const visit = (view: TaskView, keep: boolean) => {
            if (seen.has(view.key)) return;
            seen.add(view.key);
            if (!keep) this.retained.delete(view.key);
            for (const child of children.get(view.key) ?? []) visit(child, keep);
        };
        const root = (view: TaskView) => {
            if (seen.has(view.key)) return;
            const keep = isTerminal(view) ? view.endedAt !== undefined && now < view.endedAt + FINISHED_LINGER_MS : live.has(view.key);
            if (keep) roots.push(view);
            visit(view, keep);
        };
        for (const view of all) if (!view.parentKey || !byKey.has(view.parentKey)) root(view);
        // Match tree traversal's orphan/cycle tolerance without inventing batch groups.
        for (const view of all) root(view);
        return roots;
    }
    clear(): void { this.retained.clear(); }
}

/** Public widgets have width only. Reserve most terminal rows for conversation/editor/footer;
 * the host may still shrink this dock further in an extremely crowded layout. */
export function overviewLines(roots: readonly TaskView[], width: number, terminalRows: number, theme: TaskTheme, now: number): string[] {
    width = Math.max(0, Math.floor(width));
    if (!width || !roots.length) return [];
    const budget = Math.min(6, Math.max(1, Math.floor(terminalRows) - 12));
    const count = Math.min(5, roots.length, budget - (roots.length > Math.min(5, budget) ? 1 : 0));
    const lines = roots.slice(0, count).map(view => {
        const stats = [taskDuration(view, now), taskTokens(view.stats.tokens) === undefined ? undefined : `↓ ${taskTokens(view.stats.tokens)}`].filter(Boolean).join(" · ");
        const state = `[${view.status}${view.waitCount ? ` · waiting ${view.waitCount}` : ""}]`;
        const suffix = truncateToWidth(state + (stats ? ` ${stats}` : ""), Math.max(0, width - 3), "…");
        const left = truncateToWidth(`${theme.fg(taskStatusColor(view), taskDot(view))} ${taskTitle(view)}`, Math.max(0, width - visibleWidth(suffix) - 1), "…");
        return left + " ".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(suffix))) + theme.fg(taskStatusColor(view), suffix);
    });
    if (count < roots.length) lines.push(theme.fg("dim", truncateToWidth(`+${roots.length - count} hidden`, width, "…")));
    return lines;
}
