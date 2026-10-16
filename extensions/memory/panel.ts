import type { Theme } from "@earendil-works/pi-coding-agent";
import * as hostTui from "@earendil-works/pi-tui";
import { Input, Markdown, Text, isKeyRelease, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, Focusable, MarkdownTheme, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { layoutError } from "../shared/scroll-panel/native-layout.ts";
import type { NativeFrame, NativeLayout, NativeLayoutError } from "../shared/scroll-panel/native-layout.ts";
import { consumeWheel } from "../shared/scroll-panel/wheel.ts";
import type { Metadata } from "./policy.ts";
import { displayText } from "./preview.ts";
import type { MemoryDetail } from "./preview.ts";

const { ScrollView, VStack } = hostTui;
type ScrollView = hostTui.ScrollView;

/** Bounded, immutable metadata snapshot read by command.ts outside rendering. */
export interface PanelSnapshot {
  project: string; enabled?: boolean; entries: readonly Metadata[]; scannedBytes: number; diagnostic?: string;
}
/** Result of one bounded detail read. `missing` means the topic no longer exists. */
export interface DetailResult { name: string; detail?: MemoryDetail; error?: string; missing?: boolean }
/** Read-only requests serviced by command.ts. No mutation, menu or dialog kinds exist. */
export type PanelAction = { kind: "close" } | { kind: "back" } | { kind: "detail"; name: string } | { kind: "refresh"; detail?: string };
export interface PanelState { page: "list" | "detail"; query: string; filterMode: boolean; selectedName?: string; listScrollTop: number; detailScrollTop: number; busy: boolean }

export interface MemoryPanelOptions {
  snapshot: PanelSnapshot;
  theme: Theme | (() => Theme);
  tui: Pick<TUI, "terminal" | "requestRender">;
  layout: NativeLayout;
  onAction: (action: PanelAction) => void;
  unavailable?: (error: NativeLayoutError) => void;
}

/** Clip before padding so Unicode and ANSI never exceed the terminal column budget. */
function cell(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}
function markdownTheme(theme: Theme): MarkdownTheme {
  return {
    heading: text => theme.fg("mdHeading", text), link: text => theme.fg("mdLink", text),
    linkUrl: text => theme.fg("mdLinkUrl", text), code: text => theme.fg("mdCode", text),
    codeBlock: text => theme.fg("mdCodeBlock", text), codeBlockBorder: text => theme.fg("mdCodeBlockBorder", text),
    quote: text => theme.fg("mdQuote", text), quoteBorder: text => theme.fg("mdQuoteBorder", text),
    hr: text => theme.fg("mdHr", text), listBullet: text => theme.fg("mdListBullet", text),
    bold: text => theme.bold(text), italic: text => theme.italic(text),
    underline: text => theme.underline(text), strikethrough: text => theme.strikethrough(text),
    highlightCode: code => code.split("\n").map(line => theme.fg("mdCodeBlock", line)),
  };
}

/**
 * One read-only full-screen interaction: list and detail pages share one overlay.
 * Snapshot-only: render/handleInput never perform I/O or await; reads belong to command.ts.
 * Native ScrollViews own viewport, clipping and the always-visible scrollbar.
 */
export class MemoryPanel implements Component, Focusable {
  private snapshot: PanelSnapshot;
  private page: "list" | "detail" = "list";
  private query = "";
  private filterMode = false;
  private matches: readonly Metadata[] = [];
  private selected = 0;
  private selectedName?: string;
  private ensureSelected = false;
  private detail?: DetailResult;
  private notice?: string;
  private busy = false;
  private focus = false;
  private ended = false;
  private frame?: NativeFrame;
  private listScroll: ScrollView;
  private detailScroll: ScrollView;
  private input = new Input({ prompt: "Filter: " });
  private cachedList?: { key: string; lines: string[] };
  private cachedDetail?: { key: string; lines: string[] };
  private version = 0;
  /** Frame size the list viewport was last laid out for; detects resize. */
  private listSize?: string;
  private readonly themeSource: Theme | (() => Theme);
  private readonly tui: Pick<TUI, "terminal" | "requestRender">;
  private readonly layout: NativeLayout;
  private readonly onAction: (action: PanelAction) => void;
  private readonly unavailable: (error: NativeLayoutError) => void;

  constructor(options: MemoryPanelOptions) {
    this.snapshot = options.snapshot; this.themeSource = options.theme; this.tui = options.tui;
    this.layout = options.layout; this.onAction = options.onAction; this.unavailable = options.unavailable ?? (() => {});
    this.input.onSubmit = () => this.endFilter();
    this.input.onEscape = () => this.endFilter();
    this.listScroll = this.scrollView(width => this.listBody(width));
    this.detailScroll = this.scrollView(width => this.detailBody(width));
    this.filter();
  }
  private get theme(): Theme { return typeof this.themeSource === "function" ? this.themeSource() : this.themeSource; }
  get focused(): boolean { return this.focus; }
  set focused(value: boolean) { this.focus = value; this.input.focused = value && this.filterMode; }
  getState(): PanelState {
    return { page: this.page, query: this.query, filterMode: this.filterMode, selectedName: this.selectedName,
      listScrollTop: this.listScroll.scrollTop, detailScrollTop: this.detailScroll.scrollTop, busy: this.busy };
  }

  /** Apply a refreshed snapshot (and the current detail, if any) without pulling back a wheeled viewport. */
  update(snapshot: PanelSnapshot, detail?: DetailResult, notice?: string): void {
    if (this.ended) return;
    const visible = this.selected >= this.listScroll.scrollTop && this.selected < this.listScroll.scrollTop + this.listScroll.viewportHeight;
    const previous = this.selected;
    this.snapshot = snapshot; this.busy = false; this.notice = notice;
    this.filter();
    if (visible && previous !== this.selected) this.ensureSelected = true;
    if (this.page === "detail" && detail) {
      if (detail.missing) { this.page = "list"; this.detail = undefined; this.notice = `Memory ${displayText(detail.name)} no longer exists.`; }
      else this.detail = detail;
    }
    this.changed();
  }
  /** Show a completed detail read. A missing topic stays on the list with a notice. */
  showDetail(result: DetailResult): void {
    if (this.ended) return;
    this.busy = false;
    if (result.missing) { this.notice = `Memory ${displayText(result.name)} no longer exists. Press r to refresh.`; this.changed(); return; }
    this.detail = result; this.page = "detail"; this.notice = undefined; this.filterMode = false; this.input.focused = false;
    this.detailScroll = this.scrollView(width => this.detailBody(width));
    this.changed();
  }
  /** Idempotent: emits a single close request. */
  close(): void {
    if (this.ended) return;
    this.ended = true; this.focused = false;
    this.onAction({ kind: "close" });
  }
  /** Mark ended without requesting close (the owner already finished the interaction). */
  dispose(): void { this.ended = true; this.focused = false; this.frame = undefined; }
  invalidate(): void { this.cachedList = undefined; this.cachedDetail = undefined; this.frame = undefined; this.input.invalidate(); }

  private changed(): void { this.version++; this.invalidate(); this.tui.requestRender(); }
  private scrollView(render: (width: number) => string[]): ScrollView {
    return new ScrollView({ render, invalidate: () => this.invalidate() }, {
      follow: "none", overscroll: "contain", scrollbar: "always",
      scrollbarTrackStyle: text => this.theme.fg("dim", text),
      scrollbarThumbStyle: text => this.theme.fg("accent", text),
    });
  }
  private get activeScroll(): ScrollView { return this.page === "list" ? this.listScroll : this.detailScroll; }
  private filter(): void {
    const query = this.query.toLowerCase();
    this.matches = this.snapshot.entries.filter(meta => `${meta.name}\n${meta.description}`.toLowerCase().includes(query));
    this.cachedList = undefined;
    // With no matches keep the previous selection so clearing the filter returns to it.
    if (!this.matches.length) return;
    const index = this.matches.findIndex(meta => meta.name === this.selectedName);
    this.selected = index >= 0 ? index : Math.max(0, Math.min(this.selected, this.matches.length - 1));
    this.selectedName = this.matches[this.selected]?.name;
  }
  private endFilter(): void { this.filterMode = false; this.input.focused = false; }
  private setQuery(value: string): void {
    // Single-line, control-free and bounded; the original memory data is never modified.
    const query = [...displayText(value).replace(/[\n\r\t]/g, "")].slice(0, 160).join("");
    if (query !== this.input.getValue()) this.input.setValue(query);
    if (query === this.query) return;
    this.query = query; this.filter(); this.ensureSelected = true;
  }
  private ensureInputFrame(): NativeFrame {
    const width = Math.max(1, Math.floor(this.tui.terminal.columns || this.frame?.width || 80));
    const rows = Math.max(1, Math.floor(this.tui.terminal.rows || 24));
    if (!this.frame || (this.page === "list" && this.ensureSelected) || this.frame.width !== width || this.frame.height !== rows) this.renderFrame(width, rows);
    return this.frame!;
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.ended || event.type !== "wheel") return undefined;
    try { return consumeWheel(event, this.layout.scrollBox(this.ensureInputFrame(), this.activeScroll).clip, this.activeScroll); }
    catch (cause) { this.refuse(cause); }
    return { handled: true };
  }
  handleInput(data: string): void {
    if (this.ended || isKeyRelease(data)) return;
    try { this.applyInput(data); } catch (cause) { this.refuse(cause); }
  }
  private applyInput(data: string): void {
    if (this.filterMode) {
      if (matchesKey(data, "ctrl+c")) this.endFilter();
      else { this.input.handleInput(data); this.setQuery(this.input.getValue()); }
      this.tui.requestRender(); return;
    }
    if (this.page === "list") {
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.close(); return; }
      if (data === "r") { this.requestRefresh(); return; }
      const last = Math.max(0, this.matches.length - 1);
      if (matchesKey(data, "up")) this.select(this.selected - 1);
      else if (matchesKey(data, "down")) this.select(this.selected + 1);
      else if (matchesKey(data, "home")) this.select(0);
      else if (matchesKey(data, "end")) this.select(last);
      else if (matchesKey(data, "enter")) {
        const name = this.matches[this.selected]?.name;
        if (!name || name !== this.selectedName || this.busy) return;
        this.busy = true; this.notice = undefined;
        this.onAction({ kind: "detail", name });
      } else if (data === "/") { this.filterMode = true; this.input.focused = this.focus; }
      else if (data === "c") { if (this.query) { this.setQuery(""); this.notice = undefined; } }
      else return;
      this.tui.requestRender(); return;
    }
    if (matchesKey(data, "ctrl+c")) { this.close(); return; }
    if (matchesKey(data, "escape") || matchesKey(data, "left")) {
      this.page = "list"; this.detail = undefined; this.busy = false; this.frame = undefined;
      this.onAction({ kind: "back" }); this.tui.requestRender(); return;
    }
    if (data === "r") { this.requestRefresh(); return; }
    if (matchesKey(data, "up") || matchesKey(data, "down")) { this.ensureInputFrame(); this.detailScroll.scrollBy(matchesKey(data, "up") ? -1 : 1); }
    else if (matchesKey(data, "home")) { this.ensureInputFrame(); this.detailScroll.scrollToStart(); }
    else if (matchesKey(data, "end")) { this.ensureInputFrame(); this.detailScroll.scrollToEnd(); }
    else return;
    this.tui.requestRender();
  }
  private select(index: number): void {
    if (!this.matches.length) return;
    this.selected = Math.max(0, Math.min(index, this.matches.length - 1));
    this.selectedName = this.matches[this.selected]?.name;
    this.ensureSelected = true; this.cachedList = undefined;
  }
  private requestRefresh(): void {
    if (this.busy) return;
    this.busy = true; this.notice = undefined;
    this.onAction({ kind: "refresh", ...(this.page === "detail" && this.detail ? { detail: this.detail.name } : {}) });
    this.tui.requestRender();
  }
  private refuse(cause: unknown): NativeLayoutError {
    const error = layoutError(cause, "Memory");
    if (!this.ended) {
      this.frame = undefined;
      try { this.unavailable(error); } catch { /* Host notification may be unavailable. */ }
      try { this.close(); } catch { /* Never throw through the host renderer. */ }
    }
    return error;
  }

  private status(): string {
    return this.snapshot.enabled === undefined ? "Unknown" : this.snapshot.enabled ? "Enabled" : "Disabled";
  }
  private listLine(meta: Metadata, index: number, width: number): string {
    const theme = this.theme;
    const name = displayText(meta.name);
    const description = displayText(meta.description);
    let line: string;
    if (width < 24) line = theme.fg("text", name);
    else {
      // Protect type and name first; the description takes whatever remains.
      const nameWidth = Math.min(Math.max(12, Math.min(32, visibleWidth(name))), width - 12);
      line = theme.fg("muted", cell(meta.type, 10)) + theme.fg("text", cell(name, nameWidth));
      if (width - 10 - nameWidth >= 8) line += "  " + theme.fg("dim", description);
    }
    line = truncateToWidth(line, width, "…");
    return index === this.selected ? theme.bg("selectedBg", line + " ".repeat(Math.max(0, width - visibleWidth(line)))) : line;
  }
  private listBody(width: number): string[] {
    const key = `${this.version}:${width}:${this.selected}:${this.query}:${this.busy}`;
    if (this.cachedList?.key === key) return this.cachedList.lines;
    const theme = this.theme;
    let lines: string[];
    if (this.matches.length) lines = this.matches.map((meta, index) => this.listLine(meta, index, width));
    else {
      const [message, hint] = this.snapshot.diagnostic ? [theme.fg("error", "Memories unavailable"), "Fix the error above, then press r to reload."]
        : this.busy && !this.snapshot.entries.length ? [theme.fg("muted", "Loading memories…"), ""]
        : this.snapshot.entries.length ? [theme.fg("muted", "No matching memories"), "Press c to clear the filter."]
        : [theme.fg("muted", "No memories yet"), "Durable preferences, corrections, constraints and references are saved with memory_write."];
      lines = [message, ...(hint ? [theme.fg("dim", hint)] : [])].flatMap(line => wrapTextWithAnsi(line, width));
    }
    this.cachedList = { key, lines };
    return lines;
  }
  private detailBody(width: number): string[] {
    const key = `${this.version}:${width}`;
    if (this.cachedDetail?.key === key) return this.cachedDetail.lines;
    const theme = this.theme;
    const result = this.detail;
    const detail = result?.detail;
    const meta: string[] = [];
    if (detail) {
      meta.push(theme.fg("text", `Description: ${displayText(detail.metadata.description)}`));
      meta.push(theme.fg("muted", `Created: ${displayText(detail.metadata.created)} · Updated: ${displayText(detail.metadata.updated)}`));
      meta.push(theme.fg("muted", `Path: ${displayText(detail.path)}`));
      if (detail.warning) meta.push(theme.fg("warning", displayText(detail.warning)));
    }
    let lines = new Text(meta.join("\n"), 0, 0).render(width);
    if (!detail) {
      lines = new Text(theme.fg("error", displayText(result?.error ?? "Memory detail unavailable.")) + "\n" + theme.fg("dim", "Press r to reload or Esc to return."), 0, 0).render(width);
    } else if (detail.body.trim()) {
      lines.push("");
      // Sanitize external controls before host Markdown styling; the stored body is untouched.
      lines = lines.concat(new Markdown(displayText(detail.body), 0, 0, markdownTheme(theme)).render(width));
    } else lines.push("", theme.fg("muted", "(empty body)"));
    lines = lines.flatMap(line => line.split("\n").flatMap(part => wrapTextWithAnsi(part, width)));
    this.cachedDetail = { key, lines };
    return lines;
  }
  private header(width: number, limit: number): string[] {
    const theme = this.theme;
    const fit = (text: string) => truncateToWidth(text, width, "…");
    // [text, priority]: lower priority numbers survive on small terminals.
    const rows: [string, number][] = [[theme.bold(theme.fg("accent", fit(`Memory · ${displayText(this.snapshot.project)} · ${this.status()}`))), 0]];
    if (this.page === "list") {
      const count = this.query ? `${this.matches.length}/${this.snapshot.entries.length} matching` : `${this.snapshot.entries.length} memories`;
      rows.push([theme.fg("muted", fit(`${count} · ${this.snapshot.scannedBytes} metadata bytes`)), 4]);
      if (this.filterMode || this.query) {
        this.input.focused = this.focus && this.filterMode;
        rows.push([fit(this.input.render(width)[0] ?? ""), this.filterMode ? 1 : 3]);
      }
    } else if (this.detail) {
      const meta = this.detail.detail?.metadata;
      rows.push([theme.fg("text", fit(meta ? `${displayText(meta.name)} · ${meta.type}` : displayText(this.detail.name))), 1]);
    }
    if (this.snapshot.diagnostic) rows.push([theme.fg("error", fit(displayText(this.snapshot.diagnostic))), 2]);
    if (this.notice) rows.push([theme.fg("warning", fit(displayText(this.notice))), 2]);
    if (this.snapshot.enabled === false) rows.push([theme.fg("warning", fit("Disabled: not injected; writes rejected. Existing context is not revoked.")), 5]);
    if (this.page === "list" && this.matches.length && width >= 24) rows.push([theme.fg("dim", fit(`${"TYPE".padEnd(10)}NAME`)), 6]);
    rows.push([theme.fg("dim", "─".repeat(width)), 7]);
    const kept = rows.map((row, order) => ({ row, order })).sort((a, b) => a.row[1] - b.row[1] || a.order - b.order).slice(0, limit);
    return kept.sort((a, b) => a.order - b.order).map(item => item.row[0]);
  }
  /** Esc always leads so the close/back path survives truncation on narrow terminals. */
  private hints(width: number): string {
    if (this.page === "detail") return width < 60 ? "Esc Back · r Refresh · ↑/↓" : "Esc/← Back · ↑/↓ Scroll · Home/End · r Refresh · Read-only";
    if (this.filterMode) return "Enter/Esc Done · Type to filter";
    const clear = this.query ? " · c Clear" : "";
    if (width < 70) return `Esc Close · Enter Open · / Filter${clear} · r`;
    return `Esc Close · ↑/↓ Select${width < 100 ? "" : " · Home/End"} · Enter Open · / Filter${clear} · r Refresh`;
  }

  render(width: number): string[] {
    if (width < 1) return [];
    width = Math.floor(width);
    const rows = Math.max(1, Math.floor(this.tui.terminal.rows || 24));
    try { return this.renderFrame(width, rows); }
    catch (cause) {
      const error = this.refuse(cause);
      // A failed frame must never throw through the host renderer.
      return Array.from({ length: rows }, (_, index) => cell(index === 0 ? error.message : "", width));
    }
  }
  private renderFrame(width: number, rows: number): string[] {
    // One row: only the footer (with Esc). Otherwise header ≤ rows-2 and a fixed footer.
    const footerRows = 1;
    const header = rows > 1 ? this.header(width, Math.max(1, rows - 2)) : [];
    const scroll = this.activeScroll;
    const footer = new Text("", 0, 0);
    const root = new VStack([
      { component: { render: () => header, invalidate() {} }, basis: header.length, shrink: 0 },
      { component: scroll, basis: 0, grow: 1, minSize: 0 },
      { component: footer, basis: footerRows, shrink: 0 },
    ]);
    const requestRender = () => this.tui.requestRender();
    if (this.page === "list") {
      // Resize: keep a selection that was visible in the previous viewport visible; a selection
      // the user wheeled out of view is not pulled back. Uses the pre-resize native geometry.
      const size = `${width}x${rows}`;
      if (this.listSize !== undefined && this.listSize !== size && this.matches.length &&
          this.selected >= scroll.scrollTop && this.selected < scroll.scrollTop + scroll.viewportHeight) this.ensureSelected = true;
      this.listSize = size;
    }
    let frame = this.layout.render(root, width, rows, requestRender);
    if (this.page === "list" && this.ensureSelected && scroll.viewportHeight > 0) {
      if (this.selected < scroll.scrollTop) scroll.scrollTo(this.selected);
      else if (this.selected >= scroll.scrollTop + scroll.viewportHeight) scroll.scrollTo(this.selected - scroll.viewportHeight + 1);
      this.ensureSelected = false;
      frame = this.layout.render(root, width, rows, requestRender);
    }
    const contentHeight = this.layout.scrollBox(frame, scroll).children[0].rect.height;
    const position = this.page === "list" ? this.matches.length ? `${this.selected + 1}/${this.matches.length}` : "0/0"
      : `${Math.min(contentHeight, scroll.scrollTop + 1)}–${Math.min(contentHeight, scroll.scrollTop + scroll.viewportHeight)}/${contentHeight}`;
    const hints = this.hints(width);
    const busy = this.busy ? " · Loading…" : "";
    footer.setText(this.theme.fg("dim", truncateToWidth(`${hints}${busy} · ${position}`, width, "…")));
    this.frame = this.layout.render(root, width, rows, requestRender);
    this.layout.scrollBox(this.frame, scroll);
    return this.frame.lines.map(line => cell(line, width));
  }
}
