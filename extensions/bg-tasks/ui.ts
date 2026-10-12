/** One focused overlay: select a task on the left, read its live log on the right. */
import { copyToClipboard, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { ScrollView, isKeyRelease, matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import type { BackgroundRegistry } from "./state.ts";
import { FINISHED_LINGER_MS, isTerminalStatus, type Job, type UiContext } from "./types.ts";
import { formatDuration, jobLabel, oneLine } from "./format.ts";
import { terminateJobSilently } from "./lifecycle.ts";
import { renderSidebar } from "./registry.ts";
import { readLogSlice } from "./output.ts";

/** Only the selected record is retained by the interaction, not the runtime hooks. */
function snapshot(job: Job): Job {
    const { id, name, command, pid, startTime, endedAt, status, exitCode, logPath, toolCallId, isBackgrounded, kind, notifyError } = job;
    return { id, name, command, pid, startTime, endedAt, status, exitCode, logPath, toolCallId, isBackgrounded, kind, notifyError };
}
export function panelJobs(reg: BackgroundRegistry, now = Date.now()): Job[] {
    return [...reg.jobs.values()]
        .filter((job) => job.isBackgrounded && (!isTerminalStatus(job.status) || (job.endedAt !== undefined && now - job.endedAt < FINISHED_LINGER_MS)))
        .sort((a, b) => Number(isTerminalStatus(a.status)) - Number(isTerminalStatus(b.status)) || b.startTime - a.startTime);
}
function icon(job: Job): string {
    if (job.status === "running") return job.kind === "monitor" ? "◉" : "▶";
    return job.status === "completed" ? "✓" : job.status === "pending" ? "◌" : "✗";
}
function clean(text: string): string {
    return stripTerminalSequences(text).replace(/[^\S\n\r]+/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}

export class BgTaskPanel implements Component {
    private reg: BackgroundRegistry;
    private ctx: UiContext;
    private tui: Pick<TUI, "requestRender" | "terminal">;
    private theme: Pick<Theme, "fg">;
    private keys: Pick<KeybindingsManager, "matches">;
    private done: () => void;
    private copy: (text: string) => Promise<void>;
    private selected: Job | undefined;
    private focus: "list" | "output" = "list";
    private timer: NodeJS.Timeout | undefined;
    private disposed = false;
    private output: ScrollView;
    private logLines: string[] = [];
    private logKey: string | undefined;
    private pageInfo = "";
    private viewport = 1;

    constructor(args: {
        reg: BackgroundRegistry; ctx: UiContext; tui: Pick<TUI, "requestRender" | "terminal">;
        theme: Pick<Theme, "fg">; keys: Pick<KeybindingsManager, "matches">; done: () => void;
        copy?: (text: string) => Promise<void>;
    }) {
        this.reg = args.reg;
        this.ctx = args.ctx;
        this.tui = args.tui;
        this.theme = args.theme;
        this.keys = args.keys;
        this.done = args.done;
        this.copy = args.copy ?? copyToClipboard;
        this.selected = panelJobs(this.reg)[0];
        if (this.selected) this.selected = snapshot(this.selected);
        this.output = new ScrollView({ render: (width) => this.logLines.flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width))), invalidate() {} }, { follow: "end", overscroll: "contain" });
        this.timer = setInterval(() => {
            if (!this.disposed) {
                this.roster();
                this.tui.requestRender();
            }
        }, 1000);
        this.timer.unref();
    }

    private roster(): Job[] {
        if (this.selected) {
            const live = this.reg.jobs.get(this.selected.id);
            if (live) this.selected = snapshot(live);
        }
        const jobs = panelJobs(this.reg);
        // Do not jump away from final output when the four-second filter or the
        // ten-minute sweep removes the selected ID. Switching away releases it.
        if (this.selected && !jobs.some((job) => job.id === this.selected?.id)) jobs.push(this.selected);
        if (!this.selected && jobs[0]) this.selected = snapshot(jobs[0]);
        return jobs;
    }

    handleInput(data: string): void {
        if (this.disposed || isKeyRelease(data)) return;
        const jobs = this.roster();
        if (matchesKey(data, "escape") || this.keys.matches(data, "tui.select.cancel")) {
            this.close();
            return;
        }
        if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
            this.focus = this.focus === "list" ? "output" : "list";
        } else if (matchesKey(data, "c") && this.selected) {
            const path = resolve(this.selected.logPath);
            void this.copy(path).then(() => {
                if (!this.disposed) this.ctx.ui.notify(`Copied: ${path}`, "info");
            }).catch((err: unknown) => {
                if (!this.disposed) this.ctx.ui.notify(`Could not copy log path: ${String(err)}`, "error");
            });
        } else if (matchesKey(data, "x") && this.selected?.status === "running") {
            const job = this.reg.jobs.get(this.selected.id);
            if (job?.status === "running") {
                terminateJobSilently(this.reg, job);
                this.selected = snapshot(job);
                renderSidebar(this.reg, this.ctx);
            }
        } else {
            const up = this.keys.matches(data, "tui.select.up") || matchesKey(data, "up") || matchesKey(data, "k");
            const down = this.keys.matches(data, "tui.select.down") || matchesKey(data, "down") || matchesKey(data, "j");
            const pageUp = this.keys.matches(data, "tui.select.pageUp") || matchesKey(data, "pageUp");
            const pageDown = this.keys.matches(data, "tui.select.pageDown") || matchesKey(data, "pageDown");
            const delta = up ? -1 : down ? 1 : pageUp ? -this.viewport : pageDown ? this.viewport : 0;
            if (this.focus === "output") {
                if (matchesKey(data, "home")) this.output.scrollToStart();
                else if (matchesKey(data, "end")) this.output.scrollToEnd();
                else this.output.scrollBy(delta);
            } else if (delta && jobs.length) {
                const index = jobs.findIndex((job) => job.id === this.selected?.id);
                const next = jobs[Math.max(0, Math.min(jobs.length - 1, index + delta))];
                if (next.id !== this.selected?.id) {
                    this.selected = snapshot(next);
                    this.logKey = undefined;
                    this.output.scrollToEnd();
                }
            }
        }
        this.tui.requestRender();
    }

    private refreshLog(): void {
        if (!this.selected) { this.logLines = ["No background tasks"]; this.pageInfo = ""; return; }
        let stamp = "missing";
        try { const stat = statSync(this.selected.logPath); stamp = `${stat.size}:${stat.mtimeMs}`; } catch { /* Missing logs are readable as a note. */ }
        const key = `${this.selected.id}:${stamp}`;
        if (key === this.logKey) return;
        this.logKey = key;
        const slice = readLogSlice(this.selected.logPath, { limit: this.reg.config.outputPreviewChars });
        this.pageInfo = slice ? `${slice.start ? `${slice.start} earlier bytes omitted · ` : ""}bytes ${slice.start}–${slice.end} / ${slice.size}` : "No output yet";
        // A bounded tail keeps live rendering O(preview), not O(file size). The
        // byte range is always visible; c exposes the full file without implying
        // that scrolling this viewport reaches bytes outside that range.
        this.logLines = slice?.text ? clean(slice.text).split(/\r\n|\n|\r/) : ["(no output yet)"];
        if (this.logLines.at(-1) === "") this.logLines.pop();
    }

    render(width: number): string[] {
        const jobs = this.roster();
        this.refreshLog();
        const height = Math.max(1, Math.floor(this.tui.terminal.rows * 0.7));
        if (width < 8 || height < 9) {
            return [truncateToWidth(this.theme.fg("muted", "Background Tasks · enlarge terminal · Esc close"), Math.max(0, width))];
        }
        const inner = width - 2;
        const left = Math.max(2, Math.min(32, Math.floor((inner - 1) * 0.3)));
        const right = inner - left - 1;
        const bodyHeight = height - 6;
        const metadata = this.selected ? [
            `${this.selected.kind ?? "shell"} · ${this.selected.status} · ${formatDuration((this.selected.endedAt ?? Date.now()) - this.selected.startTime)}${this.selected.exitCode !== undefined ? ` · exit ${this.selected.exitCode}` : ""}`,
            `Command: ${oneLine(clean(this.selected.command))}`,
            `ID: ${this.selected.id} · PID: ${this.selected.pid}`,
            `Log: ${resolve(this.selected.logPath)}`,
        ] : ["No background tasks"];
        const metaHeight = Math.min(metadata.length, Math.max(1, bodyHeight - 2));
        this.viewport = Math.max(1, bodyHeight - metaHeight - 1);
        const content = this.output.render(right);
        this.output.updateLayout(content.length, this.viewport, () => this.tui.requestRender());
        const outputLines = content.slice(this.output.scrollTop, this.output.scrollTop + this.viewport);
        const details = [...metadata.slice(0, metaHeight).map((line) => this.theme.fg("muted", line)), this.theme.fg("dim", this.pageInfo), ...outputLines.map((line) => this.theme.fg("toolOutput", line))];
        const selectedIndex = jobs.findIndex((job) => job.id === this.selected?.id);
        const start = Math.max(0, Math.min(Math.max(0, jobs.length - bodyHeight), selectedIndex - Math.floor(bodyHeight / 2)));
        const pad = (line: string, columns: number) => {
            const text = truncateToWidth(line, columns, "…");
            return text + " ".repeat(Math.max(0, columns - visibleWidth(text)));
        };
        const border = (text: string) => this.theme.fg("border", text);
        const row = (text: string) => border("│") + pad(text, inner) + border("│");
        const rows = [border(`╭${"─".repeat(inner)}╮`), row(this.theme.fg("accent", "Background Tasks")), row(`${this.focus === "list" ? "●" : "○"} Tasks (${jobs.length})${" ".repeat(Math.max(1, left - 12))}${this.focus === "output" ? "●" : "○"} Output`)];
        for (let i = 0; i < bodyHeight; i++) {
            const job = jobs[start + i];
            const label = job ? `${job.id === this.selected?.id ? "●" : " "} ${icon(job)} ${oneLine(clean(jobLabel(job)))}` : "";
            rows.push(border("│") + pad(this.theme.fg(job?.id === this.selected?.id ? "accent" : "muted", label), left) + border("│") + pad(details[i] ?? "", right) + border("│"));
        }
        const nav = this.focus === "list" ? "↑↓/jk select" : "↑↓/jk scroll · PgUp/PgDn page · Home/End";
        rows.push(row(this.theme.fg("dim", nav)), row(this.theme.fg("dim", `Tab switch${this.selected?.status === "running" ? " · x kill" : ""}${this.selected ? " · c copy path" : ""} · Esc close`)), border(`╰${"─".repeat(inner)}╯`));
        return rows.map((line) => truncateToWidth(line, width));
    }

    invalidate(): void { this.output.invalidate(); }
    close(): void {
        if (this.disposed) return;
        this.dispose();
        this.done();
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.output.setScrollbarActive(false);
    }
}

export async function openBgListPanel(reg: BackgroundRegistry, ctx: UiContext): Promise<void> {
    if (reg.panelOpen) return;
    if ((ctx.mode !== undefined && ctx.mode !== "tui") || !ctx.ui.custom) {
        ctx.ui.notify("Background task panel requires interactive TUI mode; use the jobs tool for logs.", "info");
        return;
    }
    reg.panelOpen = true;
    let panel: BgTaskPanel | undefined;
    try {
        await ctx.ui.custom<void>((tui, theme, keys, done) => {
            panel = new BgTaskPanel({ reg, ctx, tui, theme, keys, done });
            reg.closePanel = () => panel?.close();
            return panel;
        }, { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } });
    } finally {
        panel?.dispose();
        reg.closePanel = undefined;
        reg.panelOpen = false;
    }
}
