import { copyToClipboard, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { Input, ScrollView, VStack, isKeyRelease, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { layoutError, type NativeFrame, type NativeLayout } from "../shared/scroll-panel/native-layout.ts";
import { consumeWheel, contains } from "../shared/scroll-panel/wheel.ts";
import type { TaskCoordinator } from "./coordinator.ts";
import type { TaskUIConfig } from "./config.ts";
import type { TaskControl, TaskDetail, ConversationPageRequest } from "./types.ts";
import { TaskPanelModel, type TaskRow } from "./model.ts";
import { cleanTaskText, taskLine, taskOneLine, taskStatusLine, type TaskTheme } from "./presentation.ts";
import { detailRange, renderDetailHeader, renderMessages, sectionTitle } from "./detail-view.ts";
import { ConversationRenderer, type ConversationRange } from "./conversation.ts";
import { ConversationWindow } from "./conversation-window.ts";
export { cleanTaskText } from "./presentation.ts";
const oneLine = taskOneLine;

interface TaskPanelArgs {
    coordinator: TaskCoordinator; config: TaskUIConfig; layout: NativeLayout;
    ctx: Pick<ExtensionContext, "ui">; tui: Pick<TUI, "requestRender" | "terminal">;
    theme: TaskTheme | (() => TaskTheme); keys: Pick<KeybindingsManager, "matches">;
    done: () => void; now?: () => number; copy?: (text: string) => Promise<void>;
}

/** One interaction; rendering reads only metadata and the unique bounded selected preview. */
/** Running agents show their latest parent message under the row. */
function hasMessageLine(row: TaskRow): boolean {
    return row.view.kind === "agent" && (row.view.status === "running" || row.view.status === "starting") && !!row.view.stats.latestMessage;
}
function messageLine(row: TaskRow, width: number, theme: TaskTheme): string[] {
    if (!hasMessageLine(row)) return [];
    const indent = " ".repeat(Math.min(Math.max(0, width - 8), 4 + visibleWidth(cleanTaskText(row.prefix ?? "").replace(/[\r\n]/g, ""))));
    return [truncateToWidth(indent + theme.fg("dim", "↳ " + taskOneLine(row.view.stats.latestMessage!)), width, "…")];
}

export class TaskPanel implements Component, Focusable {
    readonly model = new TaskPanelModel();
    private listScroll: ScrollView;
    private detailScroll: ScrollView;
    private unsubscribe: () => void = () => {};
    private timer: NodeJS.Timeout | undefined;
    private animationTimer: NodeJS.Timeout | undefined;
    private animationFrame = 0;
    private readonly history = new ConversationWindow();
    private readonly expandedEntryIds = new Set<string>();
    private detailRanges: ConversationRange[] = [];
    private anchor?: { id: string; offset: number; top: number };
    private detailRevision = -1;
    private paging = false;
    private disposed = false;
    private detail: TaskDetail | undefined;
    private detailKey: string | undefined;
    private rows: TaskRow[] = [];
    private page: "list" | "detail" = "list";
    private frame?: NativeFrame;
    private listSize?: string;
    private ensureSelected = false;
    private refreshing = false;
    private refreshQueued = false;
    private cachedList?: { width: number; lines: string[] };
    private cachedDetail?: { width: number; lines: string[] };
    private readonly conversation = new ConversationRenderer();
    /** Steering composer for the selected running agent; owns all input while open. */
    private composer?: { input: Input };
    private focusedState = false;
    get focused(): boolean { return this.focusedState; }
    set focused(value: boolean) { this.focusedState = value; if (this.composer) this.composer.input.focused = value; }
    private readonly copy: (text: string) => Promise<void>;
    private readonly args: TaskPanelArgs;
    constructor(args: TaskPanelArgs) {
        this.args = args;
        this.copy = args.copy ?? copyToClipboard;
        this.listScroll = this.scrollView(width => this.listBody(width));
        this.detailScroll = this.scrollView(width => this.detailBody(width), "end");
        this.refresh();
        const off = args.coordinator.subscribe(() => this.update());
        if (this.disposed) { off(); return; }
        this.unsubscribe = off;
        this.timer = setInterval(() => this.update(false), 1000);
        this.timer.unref();
    }
    private get theme(): TaskTheme { return typeof this.args.theme === "function" ? this.args.theme() : this.args.theme; }
    private scrollView(render: (width: number) => string[], follow: "none" | "end" = "none"): ScrollView {
        return new ScrollView({ render, invalidate: () => this.invalidate() }, {
            follow, overscroll: "contain", scrollbar: "always",
            scrollbarTrackStyle: text => this.theme.fg("dim", text),
            scrollbarThumbStyle: text => this.theme.fg("accent", text),
        });
    }
    private get activeScroll(): ScrollView { return this.page === "list" ? this.listScroll : this.detailScroll; }
    getState() { return { page: this.page, selectedKey: this.model.selected?.key, listScrollTop: this.listScroll.scrollTop, detailScrollTop: this.detailScroll.scrollTop, followingEnd: this.detailScroll.isFollowingEnd, historyPages: this.history.pageCount, historyEntries: this.history.entries.length }; }
    private selectedLine(): number {
        const agents = this.rows.filter(row => row.view.kind === "agent" || row.view.kind === "workflow");
        const processes = this.rows.filter(row => row.view.kind === "shell" || row.view.kind === "monitor");
        // Rows may carry a message line below them; count rendered lines, not rows.
        const height = (row: TaskRow) => 1 + (hasMessageLine(row) ? 1 : 0);
        const offset = (rows: TaskRow[], index: number) => rows.slice(0, index).reduce((sum, row) => sum + height(row), 0);
        const ai = agents.findIndex(row => row.view.key === this.model.selected?.key);
        if (ai >= 0) return 1 + offset(agents, ai);
        const pi = processes.findIndex(row => row.view.key === this.model.selected?.key);
        return pi >= 0 ? Math.max(1, offset(agents, agents.length)) + 2 + offset(processes, pi) : 0;
    }
    private refresh(readDetail = true): void {
        if (this.disposed) return;
        if (this.refreshing) {
            // Sources can publish synchronously from list/detail. Coalesce that event
            // outside their callback instead of recursively reading or overwriting a new pin.
            if (!this.refreshQueued) {
                this.refreshQueued = true;
                queueMicrotask(() => { this.refreshQueued = false; this.update(); });
            }
            return;
        }
        this.refreshing = true;
        try { this.refreshSnapshot(readDetail); } finally { this.refreshing = false; }
    }
    private refreshSnapshot(readDetail: boolean): void {
        const previous = this.selectedLine();
        const visible = previous >= this.listScroll.scrollTop && previous < this.listScroll.scrollTop + this.listScroll.viewportHeight;
        const hadSelection = this.model.selected !== undefined;
        const views = this.args.coordinator.list();
        if (this.disposed) return;
        const rows = this.model.refresh(views, this.args.now?.() ?? Date.now());
        // Partition the actual tree without manufacturing parent groups.
        this.rows = [...rows.filter(row => row.view.kind === "agent" || row.view.kind === "workflow"), ...rows.filter(row => row.view.kind === "shell" || row.view.kind === "monitor")];
        if (!hadSelection && this.rows[0]) this.model.select(this.rows[0].view);
        if (visible && previous !== this.selectedLine()) this.ensureSelected = true;
        const selected = this.model.selected;
        if (selected?.key !== this.detailKey) {
            this.detailKey = selected?.key; this.detail = undefined; this.composer = undefined;
            this.history.clear(); this.expandedEntryIds.clear(); this.detailRanges = []; this.anchor = undefined; this.detailRevision = -1;
            this.detailScroll = this.scrollView(width => this.detailBody(width), "end");
        }
        if (selected && (this.detailRevision < 0 || readDetail && this.detailRevision !== this.args.coordinator.revision)) {
            this.readDetail({ direction: "latest" }, this.detailScroll.isFollowingEnd);
        }
        this.syncAnimation();
        this.cachedList = undefined; this.frame = undefined;
    }
    private syncAnimation(): void {
        const active = this.args.config.animations !== false && this.rows.some(row => row.view.status === "running" || row.view.status === "starting");
        if (!active) { clearInterval(this.animationTimer); this.animationTimer = undefined; return; }
        if (this.animationTimer || this.disposed) return;
        this.animationTimer = setInterval(() => {
            if (this.disposed) return;
            this.animationFrame++; this.cachedList = undefined; this.frame = undefined;
            this.args.tui.requestRender();
        }, 250);
        this.animationTimer.unref();
    }
    private captureAnchor(): void {
        if (this.page !== "detail" || !this.frame) return;
        const top = this.detailScroll.scrollTop;
        const range = this.detailRanges.find(range => range.end > top);
        if (range) this.anchor = { id: range.id, offset: top - range.start, top };
    }
    private readDetail(request: ConversationPageRequest, following: boolean): void {
        const selected = this.model.selected;
        if (!selected || this.disposed || this.paging) return;
        this.paging = true;
        const revision = this.args.coordinator.revision;
        try {
            if (!following) this.captureAnchor();
            const detail = this.args.coordinator.detail(selected, { limit: 16_000, conversationPage: request });
            if (this.disposed || selected.key !== this.model.selected?.key || selected.key !== this.detailKey) return;
            this.detailRevision = revision;
            if (!detail) return; // Preserve the swept selected terminal snapshot.
            if (detail.conversationPage) {
                this.history.accept(detail.conversationPage, request.direction ?? "latest", following);
                this.detail = { ...detail, conversation: this.history.entries };
                if (this.history.last?.hasNewer) this.detailScroll.scrollTo(this.detailScroll.scrollTop, { disableFollow: true });
            } else this.detail = detail;
            this.cachedDetail = undefined; this.frame = undefined;
            if (following) { this.anchor = undefined; this.detailScroll.scrollToEnd(); }
        } catch (error) {
            this.history.hint = `Conversation unavailable: ${oneLine(String(error))}. Press End to retry.`;
            this.history.blocked = true; this.cachedDetail = undefined; this.frame = undefined;
        } finally { this.paging = false; }
    }
    /** One request per user edge action; never auto-loop over filtered/empty source pages. */
    private historyEdge(delta: number): void {
        if (this.page !== "detail" || this.history.blocked || !delta) return;
        const scroll = this.detailScroll;
        if (delta < 0 && scroll.scrollTop === 0 && this.history.first?.hasOlder && this.history.first.before)
            this.readDetail({ direction: "before", cursor: this.history.first.before }, false);
        else if (delta > 0 && this.history.last?.hasNewer && this.history.last.after) {
            const frame = this.ensureInputFrame(), height = this.args.layout.scrollBox(frame, scroll).children[0].rect.height;
            if (scroll.scrollTop + scroll.viewportHeight >= height)
                this.readDetail({ direction: "after", cursor: this.history.last.after }, false);
        }
    }
    private update(readDetail = true): void { if (!this.disposed) { this.refresh(readDetail); if (!this.disposed) this.args.tui.requestRender(); } }
    private ensureInputFrame(): NativeFrame {
        const width = Math.max(1, Math.floor(this.args.tui.terminal.columns || this.frame?.width || 80));
        const rows = Math.max(1, Math.floor(this.args.tui.terminal.rows || 24));
        if (!this.frame || (this.page === "list" && this.ensureSelected) || this.frame.width !== width || this.frame.height !== rows) this.renderFrame(width, rows);
        return this.frame!;
    }
    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
        if (this.disposed || event.type !== "wheel" && (event.type !== "click" || event.button !== "left" || event.shift || event.ctrl || event.alt)) return undefined;
        try {
            const box = this.args.layout.scrollBox(this.ensureInputFrame(), this.activeScroll);
            if (event.type === "wheel") {
                const result = consumeWheel(event, box.clip, this.activeScroll);
                if (contains(box.clip, event.x, event.y)) this.historyEdge(event.wheelDelta ?? 0);
                return result;
            }
            if (this.page !== "detail" || this.composer || !contains(box.clip, event.x, event.y) || event.x >= box.rect.x + box.children[0].rect.width) return undefined;
            const line = event.y - box.rect.y + this.detailScroll.scrollTop;
            const range = this.detailRanges.find(range => range.collapsible && line >= range.start && line < range.end);
            if (!range) return undefined;
            this.captureAnchor();
            if (this.expandedEntryIds.has(range.id)) this.expandedEntryIds.delete(range.id); else {
                if (this.expandedEntryIds.size >= 256) this.expandedEntryIds.delete(this.expandedEntryIds.values().next().value!);
                this.expandedEntryIds.add(range.id);
            }
            this.cachedDetail = undefined; this.frame = undefined; this.args.tui.requestRender();
            return { handled: true };
        } catch (cause) { this.refuse(cause); return { handled: true }; }
    }
    handleInput(data: string): void {
        if (this.disposed || isKeyRelease(data)) return;
        try { this.applyInput(data); } catch (cause) { this.refuse(cause); }
    }
    private applyInput(data: string): void {
        if (this.composer) {
            this.composer.input.handleInput(data);
            // A steer can publish synchronously and close the panel.
            if (!this.disposed) { this.invalidate(); this.args.tui.requestRender(); }
            return;
        }
        if (matchesKey(data, "escape") || this.args.keys.matches(data, "tui.select.cancel")) {
            if (this.page === "detail") { this.page = "list"; this.frame = undefined; this.args.tui.requestRender(); }
            else this.close();
            return;
        }
        if (this.args.config.shortcutBackground.some(key => matchesKey(data, key as Parameters<typeof matchesKey>[1]))) {
            // Results show through status/wait counts; a feedback row would shift the layout.
            this.args.coordinator.detachAll();
            if (this.disposed) return;
        } else if (matchesKey(data, "x") && this.model.selected?.capabilities.stop) {
            this.args.coordinator.stop(this.model.selected);
            if (this.disposed) return;
        } else if ((matchesKey(data, "p") || matchesKey(data, "s") || matchesKey(data, "r")) && this.model.selected) {
            const selected = this.model.selected;
            const action: TaskControl | undefined = matchesKey(data, "p") ? selected.capabilities.pause ? "pause" : selected.capabilities.resume ? "resume" : undefined
                : matchesKey(data, "s") ? selected.capabilities.skip ? "skip" : undefined : selected.capabilities.retry ? "retry" : undefined;
            if (!action) return;
            if (!this.args.coordinator.control(selected, action) && !this.disposed) this.args.ctx.ui.notify(`Could not ${action}: the task changed state.`, "warning");
            if (this.disposed) return;
            this.refresh();
        } else if (matchesKey(data, "enter") && this.page === "detail") {
            if (this.model.selected?.capabilities.steer) this.openComposer(this.model.selected);
            else return;
        } else if (matchesKey(data, "c")) {
            const path = this.detail?.path ?? this.model.selected?.artifacts[0]?.path;
            if (path) void this.copy(path).then(() => {
                if (!this.disposed) this.args.ctx.ui.notify(`Copied: ${oneLine(path)}`, "info");
            }).catch((error: unknown) => { if (!this.disposed) this.args.ctx.ui.notify(`Could not copy path: ${oneLine(String(error))}`, "error"); });
        } else {
            const delta = matchesKey(data, "up") || matchesKey(data, "k") || this.args.keys.matches(data, "tui.select.up") ? -1 :
                matchesKey(data, "down") || matchesKey(data, "j") || this.args.keys.matches(data, "tui.select.down") ? 1 : 0;
            if (this.page === "detail") {
                this.ensureInputFrame();
                if (matchesKey(data, "home")) { this.detailScroll.scrollToStart(); this.historyEdge(-1); }
                else if (matchesKey(data, "end")) {
                    this.readDetail({ direction: "latest" }, true); this.detailScroll.scrollToEnd();
                }
                else if (delta) { this.detailScroll.scrollBy(delta); this.historyEdge(delta); }
                else return;
            } else if (matchesKey(data, "enter")) {
                if (!this.model.selected) return;
                this.refresh(); this.page = "detail"; this.frame = undefined;
            } else if (this.rows.length) {
                const index = this.rows.findIndex(row => row.view.key === this.model.selected?.key);
                if (matchesKey(data, "left")) {
                    const row = this.rows[index];
                    if (row?.group && !this.model.isCollapsed(row.view.key)) this.model.collapse(row.view.key);
                    else if (row?.view.parentKey) {
                        const parent = this.rows.find(parent => parent.view.key === row.view.parentKey); if (parent) this.model.select(parent.view);
                    }
                } else if (matchesKey(data, "right")) {
                    if (this.model.selected) this.model.expand(this.model.selected.key);
                } else if (delta || matchesKey(data, "home") || matchesKey(data, "end")) {
                    const next = matchesKey(data, "home") ? 0 : matchesKey(data, "end") ? this.rows.length - 1 : Math.max(0, Math.min(this.rows.length - 1, index + delta));
                    this.model.select(this.rows[next].view);
                } else return;
                this.ensureSelected = true;
                this.refresh();
            } else return;
        }
        if (!this.disposed) { this.invalidate(); this.args.tui.requestRender(); }
    }
    private openComposer(target: NonNullable<TaskPanelModel["selected"]>): void {
        const input = new Input({ prompt: "› ", placeholder: "Message the agent · Enter send · Esc cancel",
            placeholderStyle: text => this.theme.fg("dim", text) });
        input.focused = this.focusedState;
        const close = () => { if (this.composer?.input === input) this.composer = undefined; };
        input.onEscape = close;
        input.onSubmit = value => {
            close();
            const message = value.trim();
            if (!message || this.disposed) return;
            // Identity is the one the composer was opened for, never a later selection.
            if (!this.args.coordinator.steer(target, message) && !this.disposed) this.args.ctx.ui.notify("Message not delivered: the agent is no longer running.", "warning");
        };
        this.composer = { input };
    }
    private listBody(width: number): string[] {
        if (this.cachedList?.width === width) return this.cachedList.lines;
        const group = (label: string, rows: TaskRow[]) => [this.theme.fg("accent", label), ...(rows.length ? rows.flatMap(row => [taskLine(row.view, width, this.theme, {
            prefix: row.prefix, children: this.model.isCollapsed(row.view.key) ? row.descendantCount : undefined,
            selected: row.view.key === this.model.selected?.key, now: this.args.now?.(), animationFrame: this.animationTimer ? this.animationFrame : undefined,
        }), ...messageLine(row, width, this.theme)]) : [this.theme.fg("dim", "No tasks")])];
        const lines = [...group("Agents", this.rows.filter(row => row.view.kind === "agent" || row.view.kind === "workflow")), ...group("Processes", this.rows.filter(row => row.view.kind === "shell" || row.view.kind === "monitor"))].map(line => truncateToWidth(line, width, "…"));
        this.cachedList = { width, lines }; return lines;
    }
    private detailBody(width: number): string[] {
        if (this.cachedDetail?.width === width) return this.cachedDetail.lines;
        const selected = this.model.selected;
        if (!selected) return [this.theme.fg("dim", "No tasks")];
        const conversation = this.detail?.conversation;
        let body: string[];
        if (conversation) {
            const rendered = this.conversation.renderModel(conversation, width, this.theme, { truncated: !this.detail?.conversationPage && this.detail?.conversationTruncated,
                expanded: this.expandedEntryIds });
            body = rendered.lines;
            this.detailRanges = rendered.ranges;
        } else {
            body = this.detail?.text
                ? cleanTaskText(this.detail.text).split(/\r\n|\n|\r/).flatMap(part => wrapTextWithAnsi(part, Math.max(1, width)))
                : [this.theme.fg("dim", "Output not established yet.")];
        }
        const messageEntries = this.detail?.messages ?? [];
        const messagesOmitted = this.detail?.messagesOmitted ?? 0;
        const messages = messageEntries.length || messagesOmitted
            ? ["", ...sectionTitle("Messages", this.theme, width, `${messageEntries.length}${messagesOmitted ? ` shown · ${messagesOmitted} older omitted` : ""}`),
                ...(messageEntries.length ? renderMessages(messageEntries, this.theme, width) : [this.theme.fg("dim", "Message content omitted by detail budget.")])]
            : [];
        const hints = this.history.hint ? [this.theme.fg("warning", this.history.hint)] : [];
        if (conversation) this.detailRanges = this.detailRanges.map(range => ({ ...range, start: range.start + messages.length + hints.length, end: range.end + messages.length + hints.length }));
        else this.detailRanges = [];
        const lines = [...messages, ...hints, ...body];
        this.cachedDetail = { width, lines }; return lines;
    }
    private detailTitle(width: number): string[] {
        const entries = this.detail?.conversation;
        const suffix = entries ? `${entries.length} messages${this.history.first?.hasOlder ? " · ↑ earlier" : ""}${this.history.last?.hasNewer ? " · ↓ newer" : ""}${!this.detail?.conversationPage && this.detail?.conversationTruncated ? " (latest)" : ""}` : detailRange(this.detail);
        return [truncateToWidth(sectionTitle(entries ? "Conversation" : "Output", this.theme, width, suffix).join(" "), width, "…")];
    }
    private hints(width: number): string {
        const row = this.rows.find(row => row.view.key === this.model.selected?.key);
        const tree = row?.group ? this.model.isCollapsed(row.view.key) ? " · → Expand" : " · ← Collapse" : row?.view.parentKey ? " · ← Parent" : "";
        const navigation = this.page === "detail" ? "Esc Back · ↑↓/jk Scroll" : "Esc Close · Enter Detail · ↑↓/jk Select";
        return `${navigation}${width >= 70 ? " · Home/End" : ""}${this.page === "list" ? tree : ""}`;
    }
    private footerLines(width: number, rows: number, position: string): string[] {
        const detach = this.args.config.shortcutBackground.join("/") || "/task-detach";
        const waits = this.args.coordinator.waitCount;
        const wide = width >= 70, caps = this.model.selected?.capabilities;
        const selected = [
            this.page === "detail" && caps?.steer ? "Enter Message" : undefined,
            caps?.pause ? "p Pause" : caps?.resume ? "p Resume" : undefined,
            caps?.skip ? "s Skip" : undefined, caps?.retry ? "r Retry" : undefined,
        ].filter(Boolean).join(" · ");
        const actions = `waiting ${waits} · ${wide ? "x Stop selected · c Copy path" : "x Stop · c Copy"}${selected ? ` · ${selected}` : ""} · ${detach} ${wide ? "Detach all waits" : "All waits"}`;
        // Wrap action groups independently: ordinary narrow screens must not silently
        // lose either selected operations or the distinct global wait-release entry.
        const lines = [this.hints(width), actions].flatMap(line => wrapTextWithAnsi(line, width));
        if (this.composer) {
            // The composer takes the navigation hint rows; footer height stays the same
            // (blank rows stand in when narrow hints wrapped onto several lines).
            const hintRows = wrapTextWithAnsi(this.hints(width), width).length;
            return [this.composer.input.render(width)[0] ?? "", ...Array.from({ length: hintRows - 1 }, () => ""),
                ...lines.slice(hintRows).map(line => this.theme.fg("dim", truncateToWidth(line, width, "…")))].slice(0, Math.max(1, rows - 2));
        }
        if (width >= 100) lines[0] += ` · ${position}`;
        const budget = Math.max(1, rows - 2);
        return lines.slice(0, budget).map(line => this.theme.fg("dim", truncateToWidth(line, width, "…")));
    }
    render(width: number): string[] {
        if (this.disposed || width < 1) return [];
        width = Math.floor(width);
        const rows = Math.max(1, Math.floor(this.args.tui.terminal.rows || 24));
        try { return this.renderFrame(width, rows); }
        catch (cause) { const error = this.refuse(cause); return Array.from({ length: rows }, (_, i) => this.cell(i ? "" : error.message, width)); }
    }
    private cell(text: string, width: number): string {
        const clipped = truncateToWidth(text, width, "…"); return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
    }
    private renderFrame(width: number, rows: number): string[] {
        const header = rows > (this.page === "detail" ? 3 : 1) ? [this.theme.fg("accent", `Task Panel · ${this.page === "list" ? `Tasks (${this.rows.length})` : "Detail"}`)] : [];
        const scroll = this.activeScroll;
        const footer = { render: () => footerLines, invalidate() {} };
        let footerLines = this.footerLines(width, rows, "");
        // On tight terminals reserve one body row and the selected status before optional metadata.
        const compactFooter = this.page === "detail" && (footerLines.length > Math.max(1, rows - 3) || rows <= 3);
        if (compactFooter) {
            const budget = Math.max(1, rows - 3);
            // Long navigation hints must not displace the action row in a tight terminal.
            const caps = this.model.selected?.capabilities;
            const actions = [caps?.stop ? "x Stop" : undefined, "c Copy", caps?.steer ? "Enter Message" : undefined,
                caps?.pause ? "p Pause" : caps?.resume ? "p Resume" : undefined,
                caps?.skip ? "s Skip" : undefined, caps?.retry ? "r Retry" : undefined,
                `${this.args.config.shortcutBackground.join("/") || "/task-detach"} All waits`].filter(Boolean).join(" · ");
            const navigation = this.composer ? this.composer.input.render(width)[0] ?? "" : this.hints(width);
            const actionLines = wrapTextWithAnsi(actions, width);
            const keys = [caps?.stop ? "x" : undefined, "c", caps?.steer ? "Enter" : undefined,
                caps?.pause || caps?.resume ? "p" : undefined, caps?.skip ? "s" : undefined, caps?.retry ? "r" : undefined].filter(Boolean).join("/");
            const compactActions = `${keys} · ${this.args.config.shortcutBackground.join("/") || "/task-detach"} Detach`;
            // Preserve every available key and the global detach chord before
            // optional labels/navigation when the full action text cannot fit.
            const actionRows = actionLines.length <= budget ? actionLines : wrapTextWithAnsi(compactActions, width).slice(0, budget);
            footerLines = this.composer ? [navigation, ...actionRows].slice(0, budget)
                : [...(actionRows.length < budget ? [navigation] : []), ...actionRows];
            footerLines = footerLines.map(line => this.theme.fg("dim", truncateToWidth(line, width, "…")));
        }
        const status = this.page === "detail" && this.model.selected && rows >= 3
            ? { render: () => [taskStatusLine(this.model.selected!, width, this.theme, this.args.now?.(), this.animationTimer ? this.animationFrame : undefined)], invalidate() {} } : undefined;
        const fixedBudget = Math.max(0, rows - footerLines.length - header.length - (status ? 1 : 0) - 1);
        const metadata = this.page === "detail" && this.model.selected
            ? renderDetailHeader(this.model.selected, this.theme, width, this.args.now?.(), Math.min(8, Math.max(0, fixedBudget - 1))) : [];
        const title = this.page === "detail" && fixedBudget > 0 ? this.detailTitle(width) : [];
        const headerBudget = Math.max(0, rows - footerLines.length - 1);
        header.splice(headerBudget);
        const root = new VStack([
            { component: { render: () => header.map(line => truncateToWidth(line, width, "…")), invalidate() {} }, basis: header.length, shrink: 0 },
            { component: { render: () => [...metadata, ...title], invalidate() {} }, basis: metadata.length + title.length, shrink: 0 },
            { component: scroll, basis: 0, grow: 1, minSize: 0 },
            ...(status ? [{ component: status, basis: 1, shrink: 0 }] : []),
            { component: footer, basis: footerLines.length, shrink: 0 },
        ]);
        if (this.page === "list") {
            const size = `${width}x${rows}`, selected = this.selectedLine();
            if (this.listSize !== undefined && this.listSize !== size && selected >= scroll.scrollTop && selected < scroll.scrollTop + scroll.viewportHeight) this.ensureSelected = true;
            this.listSize = size;
        }
        const request = () => { if (!this.disposed) this.args.tui.requestRender(); };
        let frame = this.args.layout.render(root, width, rows, request);
        if (this.page === "list" && this.ensureSelected && scroll.viewportHeight > 0) {
            const selected = this.selectedLine();
            if (selected < scroll.scrollTop) scroll.scrollTo(selected);
            else if (selected >= scroll.scrollTop + scroll.viewportHeight) scroll.scrollTo(selected - scroll.viewportHeight + 1);
            this.ensureSelected = false; frame = this.args.layout.render(root, width, rows, request);
        }
        if (this.page === "detail" && this.anchor) {
            const anchor = this.anchor; this.anchor = undefined;
            const range = this.detailRanges.find(range => range.id === anchor.id);
            scroll.scrollTo(range ? range.start + anchor.offset : anchor.top, { disableFollow: true });
            frame = this.args.layout.render(root, width, rows, request);
        }
        if (this.page === "detail" && this.history.last?.hasNewer) scroll.scrollTo(scroll.scrollTop, { disableFollow: true });
        const contentHeight = this.args.layout.scrollBox(frame, scroll).children[0].rect.height;
        const position = this.page === "list" ? `${Math.max(0, this.rows.findIndex(row => row.view.key === this.model.selected?.key) + 1)}/${this.rows.length}` : `${Math.min(contentHeight, scroll.scrollTop + 1)}–${Math.min(contentHeight, scroll.scrollTop + scroll.viewportHeight)}/${contentHeight}`;
        if (!compactFooter) footerLines = this.footerLines(width, rows, position).slice(0, footerLines.length);
        this.frame = this.args.layout.render(root, width, rows, request);
        this.args.layout.scrollBox(this.frame, scroll);
        return this.frame.lines.map(line => this.cell(line, width));
    }
    private refuse(cause: unknown): Error {
        const error = layoutError(cause, "Task Panel");
        if (!this.disposed) {
            try { this.args.ctx.ui.notify(error.message, "error"); } catch { /* closing host */ }
            try { this.close(); } catch { /* never throw through host layout/input */ }
        }
        return error;
    }
    invalidate(): void { this.cachedList = undefined; this.cachedDetail = undefined; this.frame = undefined; }
    close(): void { if (this.disposed) return; this.dispose(); this.args.done(); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; clearInterval(this.timer); this.timer = undefined; clearInterval(this.animationTimer); this.animationTimer = undefined; this.unsubscribe();
        this.composer = undefined; this.model.dispose(); this.conversation.dispose(); this.history.clear(); this.expandedEntryIds.clear(); this.detailRanges = []; this.anchor = undefined; this.detail = undefined; this.rows = []; this.invalidate();
    }
}
