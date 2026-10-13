import { copyToClipboard, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { ScrollView, isKeyRelease, matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import type { TaskCoordinator } from "./coordinator.ts";
import type { TaskUIConfig } from "./config.ts";
import type { TaskDetail } from "./types.ts";
import { TaskPanelModel, type TaskRow } from "./model.ts";

export function cleanTaskText(text: string): string {
    return stripTerminalSequences(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}
const oneLine = (text: string) => cleanTaskText(text).replace(/[\r\n]/g, " ");

interface TaskPanelArgs {
    coordinator: TaskCoordinator; config: TaskUIConfig;
    ctx: Pick<ExtensionContext, "ui">; tui: Pick<TUI, "requestRender" | "terminal">;
    theme: Pick<Theme, "fg">; keys: Pick<KeybindingsManager, "matches">;
    done: () => void; now?: () => number; copy?: (text: string) => Promise<void>;
}

/** The panel reads only immutable source views and one bounded selected preview. */
export class TaskPanel implements Component {
    readonly model = new TaskPanelModel();
    private readonly output: ScrollView;
    private readonly unsubscribe: () => void;
    private timer: NodeJS.Timeout | undefined;
    private disposed = false;
    private detail: TaskDetail | undefined;
    private detailKey: string | undefined;
    private lines: string[] = [];
    private focus: "list" | "detail" = "list";
    private viewport = 1;
    private feedback = "";
    private readonly copy: (text: string) => Promise<void>;
    private readonly args: TaskPanelArgs;
    constructor(args: TaskPanelArgs) {
        this.args = args;
        this.copy = args.copy ?? copyToClipboard;
        this.output = new ScrollView({ render: width => this.lines.flatMap(line => wrapTextWithAnsi(line, Math.max(1, width))), invalidate() {} }, { follow: "end", overscroll: "contain" });
        this.refresh();
        this.unsubscribe = args.coordinator.subscribe(() => { if (!this.disposed) { this.refresh(); this.args.tui.requestRender(); } });
        this.timer = setInterval(() => { if (!this.disposed) { this.refresh(); this.args.tui.requestRender(); } }, 1000);
        this.timer.unref();
    }
    private refresh(): TaskRow[] {
        const rows = this.model.refresh(this.args.coordinator.list(), this.args.now?.() ?? Date.now());
        const selected = this.model.selected;
        if (selected?.key !== this.detailKey) {
            this.detailKey = selected?.key; this.detail = undefined; this.feedback = ""; this.output.scrollToEnd();
        }
        if (selected) {
            const detail = this.args.coordinator.detail(selected, { limit: 16_000 });
            // A final selected snapshot survives source removal without re-reading files.
            if (detail) this.detail = detail;
        }
        this.lines = cleanTaskText(this.detail?.text ?? (selected ? "Conversation/output not established yet." : "No tasks in this session.")).split(/\r\n|\n|\r/);
        return rows;
    }
    handleInput(data: string): void {
        if (this.disposed || isKeyRelease(data)) return;
        if (matchesKey(data, "escape") || this.args.keys.matches(data, "tui.select.cancel")) { this.close(); return; }
        if (this.args.config.shortcutBackground.some(key => matchesKey(data, key as Parameters<typeof matchesKey>[1]))) {
            const count = this.args.coordinator.detachAll();
            if (this.disposed) return;
            this.feedback = `Released ${count} wait(s); execution continues.`;
        } else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
            this.focus = this.focus === "list" ? "detail" : "list";
        } else if (matchesKey(data, "x") && this.model.selected?.capabilities.stop) {
            const selected = this.model.selected;
            const stopped = this.args.coordinator.stop(selected);
            if (this.disposed) return;
            this.feedback = stopped ? `Stop requested: ${oneLine(selected.title)}` : "Task no longer stoppable.";
        } else if (matchesKey(data, "c")) {
            const path = this.detail?.path ?? this.model.selected?.artifacts[0]?.path;
            if (path) void this.copy(path).then(() => {
                if (!this.disposed) this.args.ctx.ui.notify(`Copied: ${oneLine(path)}`, "info");
            }).catch((error: unknown) => { if (!this.disposed) this.args.ctx.ui.notify(`Could not copy path: ${oneLine(String(error))}`, "error"); });
        } else {
            const rows = this.refresh();
            const selectedIndex = rows.findIndex(row => row.view.key === this.model.selected?.key);
            const delta = matchesKey(data, "up") || matchesKey(data, "k") || this.args.keys.matches(data, "tui.select.up") ? -1 :
                matchesKey(data, "down") || matchesKey(data, "j") || this.args.keys.matches(data, "tui.select.down") ? 1 :
                matchesKey(data, "pageUp") || this.args.keys.matches(data, "tui.select.pageUp") ? -this.viewport :
                matchesKey(data, "pageDown") || this.args.keys.matches(data, "tui.select.pageDown") ? this.viewport : 0;
            if (this.focus === "detail") {
                if (matchesKey(data, "home")) this.output.scrollToStart();
                else if (matchesKey(data, "end")) this.output.scrollToEnd();
                else if (delta) this.output.scrollBy(delta);
            } else if (rows.length) {
                if (matchesKey(data, "left")) {
                    const row = rows[selectedIndex];
                    if (row?.group && !this.model.isCollapsed(row.view.key)) this.model.collapse(row.view.key);
                    else if (row?.view.parentKey) {
                        const parent = rows.find(parent => parent.view.key === row.view.parentKey); if (parent) this.model.select(parent.view);
                    }
                } else if (matchesKey(data, "right")) {
                    if (this.model.selected) this.model.expand(this.model.selected.key);
                } else if (delta || matchesKey(data, "home") || matchesKey(data, "end")) {
                    const index = matchesKey(data, "home") ? 0 : matchesKey(data, "end") ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, selectedIndex + delta));
                    this.model.select(rows[index].view);
                }
            }
        }
        if (!this.disposed) { this.refresh(); this.args.tui.requestRender(); }
    }
    render(width: number): string[] {
        if (this.disposed) return [];
        const rows = this.refresh(), selected = this.model.selected;
        const height = Math.max(1, Math.floor(this.args.tui.terminal.rows * 0.7));
        const fit = (text: string, columns: number) => {
            const clipped = truncateToWidth(text, Math.max(0, columns), "…");
            return clipped + " ".repeat(Math.max(0, columns - visibleWidth(clipped)));
        };
        if (width < 20 || height < 10) return [truncateToWidth("Task Panel · enlarge terminal · Esc close", Math.max(0, width))];
        const inner = width - 2, left = Math.min(34, Math.max(7, Math.floor((inner - 1) * 0.34))), right = inner - left - 1;
        const bodyHeight = height - 5;
        const metadata = selected ? [
            `${selected.kind} · ${selected.status} · ${selected.executionMode} · waits ${selected.waitCount}`,
            `${oneLine(selected.title)}${selected.description ? ` — ${oneLine(selected.description)}` : ""}`,
            `ID: ${oneLine(selected.taskId)} · run ${oneLine(selected.runId)}`,
            Object.entries(selected.stats).filter(([key, value]) => value !== undefined && key !== "phases").map(([key, value]) => `${key}: ${oneLine(String(value))}`).join(" · "),
            ...(selected.stats.phases ?? []).map(phase => `Phase ${phase.index}: ${oneLine(phase.title)}`),
        ] : ["No tasks"];
        const omitted = this.detail ? `Bounded preview${this.detail.start !== undefined ? ` ${this.detail.start}–${this.detail.end} / ${this.detail.size}` : ""} · omitted before ${this.detail.omittedBefore ?? 0}, after ${this.detail.omittedAfter ?? 0}; scroll preview only` : "Bounded preview · not full file";
        // Range remains visible even with many declared phases or a small terminal.
        const metaHeight = Math.min(metadata.length, Math.max(1, bodyHeight - 3));
        this.viewport = Math.max(1, bodyHeight - metaHeight - 1);
        const content = this.output.render(right);
        this.output.updateLayout(content.length, this.viewport, () => { if (!this.disposed) this.args.tui.requestRender(); });
        const details = [...metadata.slice(0, metaHeight), omitted, ...content.slice(this.output.scrollTop, this.output.scrollTop + this.viewport)];
        const index = rows.findIndex(row => row.view.key === selected?.key);
        const start = Math.max(0, Math.min(Math.max(0, rows.length - bodyHeight), index - Math.floor(bodyHeight / 2)));
        const border = (text: string) => this.args.theme.fg("border", text);
        const fullRow = (text: string) => border("│") + fit(text, inner) + border("│");
        const result = [border(`╭${"─".repeat(inner)}╮`), fullRow(this.args.theme.fg("accent", `Task Panel · ${this.focus === "list" ? "● Tasks" : "● Detail"} (${rows.length})`))];
        for (let i = 0; i < bodyHeight; i++) {
            const row = rows[start + i];
            const label = row ? `${row.view.key === selected?.key ? "●" : " "} ${"  ".repeat(Math.min(row.depth, 8))}${row.group ? this.model.isCollapsed(row.view.key) ? "▸" : "▾" : "·"} ${row.view.kind} ${oneLine(row.view.title)} [${row.view.status}]` : "";
            result.push(border("│") + fit(this.args.theme.fg(row?.view.key === selected?.key ? "accent" : "muted", label), left) + border("│") + fit(details[i] ?? "", right) + border("│"));
        }
        result.push(fullRow(oneLine(this.feedback) || "↑↓/jk · PgUp/PgDn · Home/End · ←→ groups"), fullRow(`Tab focus · x stop selected · c copy path · Esc close · ${this.args.config.shortcutBackground.join("/") || "/bg"} detach`), border(`╰${"─".repeat(inner)}╯`));
        return result.map(line => truncateToWidth(line, width));
    }
    invalidate(): void { this.output.invalidate(); }
    close(): void { if (this.disposed) return; this.dispose(); this.args.done(); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; clearInterval(this.timer); this.timer = undefined; this.unsubscribe();
        this.output.setScrollbarActive(false); this.model.dispose(); this.detail = undefined; this.lines = [];
    }
}
