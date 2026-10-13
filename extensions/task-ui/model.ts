import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TaskView } from "./types.ts";

export const FINISHED_LINGER_MS = 4_000;
export const isTerminal = (view: TaskView): boolean => ["completed", "failed", "stopped"].includes(view.status);
export interface TaskRow { readonly view: TaskView; readonly depth: number; readonly group: boolean; }

/** Interaction-only metadata. Never retains backend records or consumes results. */
export class TaskPanelModel {
    private readonly collapsed = new Set<string>();
    private readonly retained = new Map<string, TaskView>();
    private current: readonly TaskView[] = [];
    selected: TaskView | undefined;

    refresh(views: readonly TaskView[], now = Date.now()): TaskRow[] {
        for (const view of views) this.retained.set(view.key, view);
        // Keep a completed group together even when backend metadata sweep starts.
        const all = [...this.retained.values()];
        const byKey = new Map(all.map(view => [view.key, view]));
        const rootOf = (view: TaskView): TaskView => {
            const seen = new Set([view.key]);
            let root = view;
            while (root.parentKey && byKey.has(root.parentKey) && !seen.has(root.parentKey)) {
                seen.add(root.parentKey); root = byKey.get(root.parentKey)!;
            }
            return root;
        };
        const liveKeys = new Set(views.map(view => view.key));
        this.current = all.filter(view => {
            const root = rootOf(view);
            const keep = !isTerminal(root) ? liveKeys.has(root.key) : root.endedAt !== undefined && now - root.endedAt < FINISHED_LINGER_MS;
            if (!keep) this.retained.delete(view.key);
            return keep;
        });
        const liveSelected = views.find(view => view.key === this.selected?.key);
        if (liveSelected) this.selected = liveSelected;
        const rows = this.rows();
        if (!this.selected && rows[0]) this.selected = rows[0].view;
        // The one pinned final snapshot outlives display retention, until switching.
        if (this.selected && !rows.some(row => row.view.key === this.selected?.key)) rows.push({ view: this.selected, depth: 0, group: false });
        return rows;
    }

    private rows(): TaskRow[] {
        const byKey = new Map(this.current.map(view => [view.key, view]));
        const children = new Map<string, TaskView[]>();
        for (const view of this.current) if (view.parentKey && byKey.has(view.parentKey)) {
            const group = children.get(view.parentKey) ?? []; group.push(view); children.set(view.parentKey, group);
        }
        const rows: TaskRow[] = [], seen = new Set<string>();
        const visit = (view: TaskView, depth: number) => {
            if (seen.has(view.key)) return;
            seen.add(view.key);
            const nested = children.get(view.key) ?? [];
            rows.push({ view, depth, group: nested.length > 0 || view.kind === "workflow" });
            if (!this.collapsed.has(view.key)) for (const child of nested) visit(child, depth + 1);
        };
        for (const view of this.current) if (!view.parentKey || !byKey.has(view.parentKey)) visit(view, 0);
        // Cyclic/invalid external hierarchy must not silently hide every row.
        for (const view of this.current) if (!seen.has(view.key) && (!view.parentKey || !this.collapsed.has(view.parentKey))) {
            // Only actual cycles need fallback; collapsed descendants stay hidden.
            let parent = view.parentKey; const ancestors = new Set<string>(); let cycle = false;
            while (parent && byKey.has(parent)) { if (ancestors.has(parent)) { cycle = true; break; } ancestors.add(parent); parent = byKey.get(parent)?.parentKey; }
            if (cycle) visit(view, 0);
        }
        return rows;
    }
    select(view: TaskView): void { this.selected = view; }
    expand(key: string): void { this.collapsed.delete(key); }
    collapse(key: string): void { this.collapsed.add(key); }
    isCollapsed(key: string): boolean { return this.collapsed.has(key); }
    dispose(): void { this.selected = undefined; this.retained.clear(); this.collapsed.clear(); this.current = []; }
}

/** Counts independent work, not workflow/ordinary-agent descendants twice. */
export function taskSummary(views: readonly TaskView[], theme?: Pick<Theme, "fg">): string | undefined {
    const paint: Theme["fg"] = (color, text) => theme ? theme.fg(color, text) : text;
    const counts = new Map<string, { active: number; queued: number }>();
    for (const view of views) {
        if (view.parentKey || isTerminal(view)) continue;
        const count = counts.get(view.kind) ?? { active: 0, queued: 0 };
        if (view.status === "queued" || view.status === "starting") count.queued++; else count.active++;
        counts.set(view.kind, count);
    }
    return counts.size ? ["shell", "monitor", "agent", "workflow"].flatMap(kind => {
        const count = counts.get(kind);
        return count ? [`${paint("accent", kind)}${paint("dim", ":")} ${paint("text", String(count.active))} ${paint("success", "active")}${count.queued ? `${paint("dim", " / ")}${paint("text", String(count.queued))} ${paint("warning", "queued")}` : ""}`] : [];
    }).join(paint("dim", " · ")) : undefined;
}
