import { truncateToWidth } from "@earendil-works/pi-tui";
import { FINISHED_LINGER_MS, isTerminal, taskTreeRows } from "./model.ts";
import { taskLine, type TaskTheme } from "./presentation.ts";
import type { TaskView } from "./types.ts";

/** Metadata only: no selection, detail pin, backend ownership or child token totals. */
export class TaskOverviewModel {
    private readonly retained = new Map<string, TaskView>();
    refresh(views: readonly TaskView[], now: number): readonly TaskView[] {
        for (const view of views) if (view.kind === "agent" || view.kind === "workflow") this.retained.set(view.key, view);
        const all = [...this.retained.values()], byKey = new Map(all.map(view => [view.key, view]));
        const live = new Set(views.map(view => view.key));
        const retained: TaskView[] = [], seen = new Set<string>();
        const children = new Map<string, TaskView[]>();
        for (const view of all) if (view.parentKey && byKey.has(view.parentKey)) {
            const group = children.get(view.parentKey) ?? []; group.push(view); children.set(view.parentKey, group);
        }
        const visit = (view: TaskView, keep: boolean) => {
            if (seen.has(view.key)) return;
            seen.add(view.key);
            if (!keep) this.retained.delete(view.key); else retained.push(view);
            for (const child of children.get(view.key) ?? []) visit(child, keep);
        };
        const root = (view: TaskView) => {
            if (seen.has(view.key)) return;
            const keep = isTerminal(view) ? view.endedAt !== undefined && now < view.endedAt + FINISHED_LINGER_MS : live.has(view.key);
            visit(view, keep);
        };
        for (const view of all) if (!view.parentKey || !byKey.has(view.parentKey)) root(view);
        // Match tree traversal's orphan/cycle tolerance without inventing batch groups.
        for (const view of all) root(view);
        return retained;
    }
    clear(): void { this.retained.clear(); }
}

/** The same conservative row budget drives rendering and visible-task animation. */
export function overviewRootCount(rootCount: number, terminalRows: number): number {
    const budget = Math.min(6, Math.max(1, Math.floor(terminalRows) - 12));
    return Math.min(5, rootCount, budget - (rootCount > Math.min(5, budget) ? 1 : 0));
}

/** Public widgets have width only. Reserve most terminal rows for conversation/editor/footer;
 * the host may still shrink this dock further in an extremely crowded layout. */
export function overviewLines(views: readonly TaskView[], width: number, terminalRows: number, theme: TaskTheme, now: number): string[] {
    width = Math.max(0, Math.floor(width));
    if (!width || !views.length) return [];
    const rows = taskTreeRows(views);
    const count = overviewRootCount(rows.length, terminalRows);
    const visible = rows.slice(0, count).map(row => taskLine(row.view, width, theme, {
        prefix: row.prefix, children: row.descendantCount, now,
    }));
    if (count < rows.length) visible.push(theme.fg("dim", truncateToWidth(`+${rows.length - count} hidden`, width, "…")));
    return visible;
}
