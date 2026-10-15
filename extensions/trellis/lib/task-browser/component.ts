import { basename } from "node:path";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import * as hostTui from "@earendil-works/pi-tui";
import { Markdown, Text, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { type NativeFrame, type NativeLayout, NativeLayoutError } from "./native-layout.ts";
import { displayValue, readDocument, readTasks, safeText, taskLabel, type BrowserTask, type TaskDocument, type TaskSnapshot } from "./reader.ts";

const { ScrollView, VStack } = hostTui;
type ScrollView = hostTui.ScrollView;

type ListLayout = { name: number; title: number };

/** Clip before padding so Unicode and ANSI never consume another column's budget. */
function listCell(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

const SECTIONS = ["Overview", "PRD", "Design", "Implement"] as const;
const DOCUMENT_SECTIONS = ["prd", "design", "implement"] as const;
function statusColor(status: string): "accent" | "warning" | "success" | "error" | "muted" {
	return status === "in_progress" ? "accent" : status === "planning" ? "warning" : status === "completed" ? "success" : status === "task_error" ? "error" : "muted";
}
function codeLiteral(text: string): string {
	let longest = 0;
	for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
	const delimiter = "`".repeat(longest + 1);
	return `${delimiter} ${text} ${delimiter}`;
}

/** Literalize only image tokens, not their surrounding table/list/heading or shared link definitions.
 * Definitions remain active for supported links; a literal appendix keeps referenced image URLs visible.
 */
export function readableMarkdown(text: string): string {
	if (!text.includes("![")) return text;
	let fence: { marker: string; length: number } | undefined;
	const definitions: string[] = [];
	let hasImages = false;
	let inList = false;
	const lines = text.split("\n").map(line => {
		const listItem = /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+/.test(line);
		if (listItem) inList = true;
		else if (line.trim() && /^\S/.test(line)) inList = false;
		const match = /^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?(`{3,}|~{3,})/.exec(line);
		if (match) {
			if (!fence) fence = { marker: match[1][0], length: match[1].length };
			else if (match[1][0] === fence.marker && match[1].length >= fence.length && !line.slice(match[0].length).trim()) fence = undefined;
			return line;
		}
		if (fence || (!inList && /^(?: {4}|\t)/.test(line))) return line;
		if (/^\s{0,3}\[[^\]]+\]:/.test(line)) { definitions.push(line); return line; }
		let result = "";
		for (let index = 0; index < line.length;) {
			if (line[index] === "\\") { result += line.slice(index, index + 2); index += 2; continue; }
			if (line[index] === "`") {
				const delimiter = /^`+/.exec(line.slice(index))![0];
				let end = index + delimiter.length;
				let closed = false;
				while (end < line.length) {
					if (line[end] !== "`") { end++; continue; }
					const run = /^`+/.exec(line.slice(end))![0];
					end += run.length;
					if (run.length === delimiter.length) { closed = true; break; }
				}
				if (!closed) {
					// Do not let this unmatched source run become the opener for an inserted image span.
					result += delimiter.replace(/`/g, "\\`"); index += delimiter.length; continue;
				}
				result += line.slice(index, end); index = end; continue;
			}
			if (line.slice(index, index + 2) !== "![") { result += line[index++]; continue; }
			const closing = (start: number, open: string, close: string): number => {
				let depth = 0;
				for (let end = start; end < line.length; end++) {
					if (line[end] === "\\") { end++; continue; }
					if (line[end] === open) depth++;
					else if (line[end] === close && --depth === 0) return end + 1;
				}
				return -1;
			};
			let end = closing(index + 1, "[", "]");
			if (end < 0) { result += line[index++]; continue; }
			if (line[end] === "(" || line[end] === "[") {
				const destination = closing(end, line[end], line[end] === "(" ? ")" : "]");
				if (destination > 0) end = destination;
			}
			// GFM tables require pipes escaped even inside code spans.
			result += codeLiteral(line.slice(index, end)).replace(/(?<!\\)\|/g, "\\|");
			hasImages = true; index = end;
		}
		return result;
	});
	if (hasImages && definitions.length) return lines.concat("", definitions.map(codeLiteral)).join("\n");
	return lines.join("\n");
}

export class TaskBrowser {
	private snapshot: TaskSnapshot;
	private mode: "list" | "detail" = "list";
	private selected = 0;
	private listScroll: ScrollView;
	private detailScrolls: ScrollView[];
	private frame?: NativeFrame;
	private ensureSelected = false;
	private detailTask?: BrowserTask;
	private section = 0;
	private documents = new Map<number, TaskDocument>();
	private cachedBody?: { key: string; lines: string[] };
	private cachedListLayout?: { width: number; layout: ListLayout };
	private current?: string;
	private closed = false;

	private root: string;
	private tui: Pick<TUI, "terminal" | "requestRender">;
	private themeSource: Theme | (() => Theme);
	private done: () => void;
	private readCurrent: () => string | undefined;
	private nativeLayout: NativeLayout;
	private unavailable: (error: NativeLayoutError) => void;

	constructor(
		root: string,
		tui: Pick<TUI, "terminal" | "requestRender">,
		themeSource: Theme | (() => Theme),
		done: () => void,
		readCurrent: () => string | undefined,
		nativeLayout: NativeLayout,
		unavailable: (error: NativeLayoutError) => void = () => {},
	) {
		this.root = root; this.tui = tui; this.themeSource = themeSource; this.done = done; this.readCurrent = readCurrent;
		this.nativeLayout = nativeLayout; this.unavailable = unavailable;
		this.listScroll = this.scrollView(width => this.listBody(width));
		this.detailScrolls = this.createDetailScrolls();
		this.snapshot = readTasks(root);
		this.refreshCurrent();
	}
	private get theme(): Theme { return typeof this.themeSource === "function" ? this.themeSource() : this.themeSource; }
	private refreshCurrent(): void {
		try { this.current = this.readCurrent(); } catch { this.current = undefined; }
		// Move the complete top-level tree, never detach a child from its ancestors.
		const rows = this.snapshot.rows;
		const index = rows.findIndex(row => row.task.identity === this.current);
		if (index < 0) return;
		let start = index;
		while (start > 0 && rows[start].prefix) start--;
		let end = index + 1;
		while (end < rows.length && rows[end].prefix) end++;
		if (start > 0) this.snapshot.rows = rows.slice(start, end).concat(rows.slice(0, start), rows.slice(end));
	}
	invalidate(): void { this.cachedBody = undefined; this.cachedListLayout = undefined; this.frame = undefined; }
	private refresh(): void {
		const identity = this.snapshot.rows[this.selected]?.task.identity;
		// Reordering may move a visible selection. Keep it visible on refresh,
		// but never pull back a viewport the user wheeled away from selection.
		const selectedVisible = this.selected >= this.listScroll.scrollTop && this.selected < this.listScroll.scrollTop + this.listScroll.viewportHeight;
		const next = readTasks(this.root);
		this.snapshot = next;
		this.refreshCurrent();
		const index = next.rows.findIndex(row => row.task.identity === identity);
		if (selectedVisible && index !== this.selected) this.ensureSelected = true;
		const total = next.rows.length + next.diagnostics.length;
		this.selected = index >= 0 ? index : Math.min(this.selected, Math.max(0, total - 1));
		if (this.detailTask) this.detailTask = next.tasks.find(task => task.identity === this.detailTask!.identity) ?? this.detailTask;
		this.documents.clear(); this.invalidate();
	}
	private scrollView(render: (width: number) => string[]): ScrollView {
		return new ScrollView({ render, invalidate: () => this.invalidate() }, {
			follow: "none", overscroll: "contain", scrollbar: "always",
			scrollbarTrackStyle: text => this.theme.fg("dim", text),
			scrollbarThumbStyle: text => this.theme.fg("accent", text),
		});
	}
	private createDetailScrolls(): ScrollView[] { return SECTIONS.map((_, section) => this.scrollView(width => this.detailBody(width, section))); }
	private get activeScroll(): ScrollView { return this.mode === "list" ? this.listScroll : this.detailScrolls[this.section]; }
	private ensureInputFrame(): NativeFrame {
		const width = Math.max(1, Math.floor(this.tui.terminal.columns ?? this.frame?.width ?? 80));
		const rows = Math.max(1, Math.floor(this.tui.terminal.rows || 24));
		// Input is coalesced by the host. Allocate only stale geometry, applying
		// earlier keyboard/refresh intents before later scrolling, not on every event.
		if (!this.frame || (this.mode === "list" && this.ensureSelected) || this.frame.width !== width || this.frame.height !== rows) this.renderFrame(width, rows);
		return this.frame!;
	}
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.closed || event.type !== "wheel") return undefined;
		// The host already normalizes/accelerates wheelDelta. Consume fixed regions
		// and edges too: an unhandled overlay wheel can scroll the main transcript.
		try {
			const clip = this.nativeLayout.scrollBox(this.ensureInputFrame(), this.activeScroll).clip;
			if (event.x >= clip.x && event.x < clip.x + clip.width && event.y >= clip.y && event.y < clip.y + clip.height) this.activeScroll.scrollBy(event.wheelDelta ?? 0);
		} catch (cause) { this.refuse(cause); }
		return { handled: true };
	}
	handleInput(data: string): void {
		if (this.closed) return;
		try { this.applyInput(data); } catch (cause) { this.refuse(cause); }
	}
	private applyInput(data: string): void {
		if (matchesKey(data, "ctrl+c") || (matchesKey(data, "escape") && this.mode === "list")) {
			this.closed = true; this.done(); return;
		}
		if (matchesKey(data, "escape")) { this.mode = "list"; this.frame = undefined; }
		else if (matchesKey(data, "r")) this.refresh();
		else if (this.mode === "list") {
			const total = this.snapshot.rows.length + this.snapshot.diagnostics.length;
			if (matchesKey(data, "up")) { this.selected = Math.max(0, this.selected - 1); this.ensureSelected = true; }
			else if (matchesKey(data, "down")) { this.selected = Math.min(Math.max(0, total - 1), this.selected + 1); this.ensureSelected = true; }
			else if (matchesKey(data, "enter") && this.snapshot.rows[this.selected]) {
				this.detailTask = this.snapshot.rows[this.selected].task;
				this.mode = "detail"; this.section = 0; this.detailScrolls = this.createDetailScrolls(); this.documents.clear(); this.invalidate();
			}
		} else {
			if (matchesKey(data, "left")) { this.section = (this.section + SECTIONS.length - 1) % SECTIONS.length; this.frame = undefined; }
			else if (matchesKey(data, "right")) { this.section = (this.section + 1) % SECTIONS.length; this.frame = undefined; }
			else if (matchesKey(data, "up") || matchesKey(data, "down")) {
				this.ensureInputFrame();
				this.activeScroll.scrollBy(matchesKey(data, "up") ? -1 : 1);
			}
		}
		this.tui.requestRender();
	}
	private isCurrent(task: BrowserTask): boolean { return task.identity === this.current; }
	private metadata(task: BrowserTask, width: number): string[] {
		return new Text([
			this.theme.bold(this.theme.fg("text", taskLabel(task))),
			this.theme.fg("muted", `Path: ${safeText(task.dir)}`),
			this.theme.fg(statusColor(task.status), `Status: ${safeText(task.status)}`),
			...(this.isCurrent(task) ? [this.theme.fg("accent", "Current task")] : []),
		].join("\n"), 0, 0).render(width);
	}
	private detailBody(width: number, section: number): string[] {
		const task = this.detailTask!;
		const key = `${task.identity}:${section}:${width}`;
		if (this.cachedBody?.key === key) return this.cachedBody.lines;
		let lines = this.metadata(task, width);
		if (!this.snapshot.tasks.some(item => item.identity === task.identity)) {
			lines = lines.concat(new Text("Task no longer available. Press Esc to return to the list.", 0, 0).render(width));
		} else if (section === 0) {
			const fields: string[] = [];
			for (const [field, label] of [["id", "ID"], ["name", "Name"], ["title", "Title"], ["description", "Description"], ["priority", "Priority"], ["assignee", "Assignee"], ["createdAt", "Created"], ["completedAt", "Completed"], ["branch", "Branch"], ["parent", "Parent"]]) {
				const value = task.record[field];
				if (typeof value === "string" && value) fields.push(`${label}: ${safeText(value, true)}`);
			}
			if (Array.isArray(task.record.children)) fields.push(`Children: ${task.record.children.map(value => safeText(displayValue(value))).join(", ") || "None"}`);
			lines = lines.concat("", new Text(this.theme.fg("text", fields.join("\n") || "No additional metadata"), 0, 0).render(width));
		} else {
			let document = this.documents.get(section);
			if (!document) { document = readDocument(this.root, task, DOCUMENT_SECTIONS[section - 1]); this.documents.set(section, document); }
			lines.push("");
			if (document.state === "ready") {
				try {
					lines = lines.concat(new Markdown(readableMarkdown(document.text), 0, 0, getMarkdownTheme()).render(width));
				} catch {
					// Host parser limits must not take down the TUI; keep the complete source scrollable.
					lines = lines.concat(new Text(this.theme.fg("warning", "Unable to render Markdown; showing document source."), 0, 0).render(width),
						new Text(document.text, 0, 0).render(width));
				}
			} else {
				const detail = "diagnostic" in document && document.diagnostic ? `: ${document.diagnostic}` : "";
				const message = document.state === "missing" ? "Document not created" : document.state === "empty" ? "Document is empty" : document.state === "removed" ? "Task no longer available" : `Unable to read document${detail}`;
				lines = lines.concat(new Text(this.theme.fg(document.state === "error" ? "error" : "muted", message), 0, 0).render(width));
			}
		}
		// Some host raw HTML/code tokens contain embedded newlines or overwide content.
		// Wrap rather than clip: all detail content remains reachable by scrolling.
		lines = lines.flatMap(line => line.split("\n").flatMap(part => wrapTextWithAnsi(part, width)));
		this.cachedBody = { key, lines };
		return lines;
	}
	private listLayout(width: number): ListLayout {
		if (this.cachedListLayout?.width === width) return this.cachedListLayout.layout;
		// Marker (2), bounded status (13), and one gap. Small windows favor identity.
		const available = Math.max(0, width - 16);
		let desired = 0;
		let hasTitles = false;
		for (const row of this.snapshot.rows) {
			const name = safeText(basename(row.task.dir));
			desired = Math.max(desired, Math.min(48, visibleWidth(row.prefix + name)));
			if (safeText(row.task.title || name) !== name) hasTitles = true;
		}
		const name = available < 36 || !hasTitles ? available : Math.min(desired, Math.floor(available * 0.6));
		const title = available < 36 || !hasTitles ? 0 : available - name - 3;
		const layout = { name, title };
		this.cachedListLayout = { width, layout };
		return layout;
	}
	private listLine(index: number, width: number, layout: ListLayout): string {
		const row = this.snapshot.rows[index];
		let line: string;
		if (row) {
			const marker = this.isCurrent(row.task) ? "* " : "  ";
			const name = safeText(basename(row.task.dir));
			const title = safeText(row.task.title || name);
			line = this.theme.fg(this.isCurrent(row.task) ? "accent" : "dim", marker) +
				this.theme.fg(statusColor(row.task.status), listCell(`[${safeText(row.task.status)}]`, 13)) + " " +
				this.theme.fg("text", listCell(row.prefix + name, layout.name));
			if (layout.title > 0 && title !== name) {
				line += this.theme.fg("dim", " · ") + this.theme.fg("text", truncateToWidth(title, layout.title, "…"));
			}
		} else line = this.theme.fg("error", `Warning: ${this.snapshot.diagnostics[index - this.snapshot.rows.length]}`);
		line = truncateToWidth(line, width, "…");
		return index === this.selected ? this.theme.bg("userMessageBg", line + " ".repeat(Math.max(0, width - visibleWidth(line)))) : line;
	}
	private listBody(width: number): string[] {
		const total = this.snapshot.rows.length + this.snapshot.diagnostics.length;
		const layout = this.listLayout(width);
		return total ? Array.from({ length: total }, (_, index) => this.listLine(index, width, layout)) : [this.theme.fg("muted", "No tasks found")];
	}
	private refuse(cause: unknown): NativeLayoutError {
		const error = cause instanceof NativeLayoutError ? cause : new NativeLayoutError(cause);
		if (!this.closed) {
			this.closed = true; this.frame = undefined;
			try { this.unavailable(error); } catch { /* Host notification may be unavailable. */ }
			try { this.done(); } catch { /* Never throw through the host renderer. */ }
		}
		return error;
	}
	render(width: number): string[] {
		if (width < 1) return [];
		width = Math.floor(width);
		const rows = Math.max(1, Math.floor(this.tui.terminal.rows || 24));
		try { return this.renderFrame(width, rows); }
		catch (cause) {
			const error = this.refuse(cause);
			// A failed frame must never throw through the host renderer.
			return Array.from({ length: rows }, (_, index) => listCell(index === 0 ? error.message : "", width));
		}
	}
	private renderFrame(width: number, rows: number): string[] {
		const header = [this.theme.bold(this.theme.fg("accent", "Trellis Tasks"))];
		if (this.mode === "list") header.push(this.theme.fg("muted", `${this.snapshot.tasks.length} tasks${this.snapshot.complete ? "" : " · Incomplete data"} · Directory descending · Current tree first · * Current task`));
		else if (width < 38) header.push(this.theme.fg("accent", `${SECTIONS[this.section]} (${this.section + 1}/${SECTIONS.length}) · ←/→`));
		else header.push(SECTIONS.map((label, index) => index === this.section ? this.theme.bold(this.theme.fg("accent", label)) : this.theme.fg("muted", label)).join(" | "));
		header.push(this.theme.fg("dim", "─".repeat(width)));
		const hints = width < 70
			? this.mode === "list" ? "Esc Close · r Refresh · ↑/↓ · Enter" : "Esc Back · r Refresh · ←/→ · ↑/↓"
			: this.mode === "list" ? "↑/↓ Select · Enter Open · r Refresh · Esc Close" : "←/→ Section · ↑/↓ Scroll · r Refresh · Esc Back";
		// Collapse secondary fixed rows on tiny terminals; native layout still owns
		// the body allocation (including zero-height viewports).
		while (header.length > Math.max(1, rows - 2)) header.splice(1, 1);
		const footerRows = rows > 1 ? 1 : 0;
		const total = this.snapshot.rows.length + this.snapshot.diagnostics.length;
		this.selected = Math.max(0, Math.min(this.selected, Math.max(0, total - 1)));
		const scroll = this.activeScroll;
		let frame: NativeFrame;
		// Fixed-size footer is filled after native geometry has been allocated.
		const footerText = new Text("", 0, 0);
		const root = new VStack([
			{ component: { render: () => header, invalidate() {} }, basis: header.length, shrink: 0 },
			{ component: scroll, basis: 0, grow: 1, minSize: 0 },
			{ component: footerText, basis: footerRows, shrink: 0 },
		]);
		frame = this.nativeLayout.render(root, width, rows, () => this.tui.requestRender());
		if (this.mode === "list" && this.ensureSelected && scroll.viewportHeight > 0) {
			if (this.selected < scroll.scrollTop) scroll.scrollTo(this.selected);
			else if (this.selected >= scroll.scrollTop + scroll.viewportHeight) scroll.scrollTo(this.selected - scroll.viewportHeight + 1);
			this.ensureSelected = false;
			frame = this.nativeLayout.render(root, width, rows, () => this.tui.requestRender());
		}
		const contentHeight = this.nativeLayout.scrollBox(frame, scroll).children[0].rect.height;
		const position = this.mode === "list" ? total ? `${this.selected + 1}/${total}` : "0/0"
			: `${Math.min(contentHeight, scroll.scrollTop + 1)}–${Math.min(contentHeight, scroll.scrollTop + scroll.viewportHeight)}/${contentHeight}`;
		footerText.setText(this.theme.fg("dim", width < 40 ? `${hints} · ${position}` : `${position} · ${hints}`));
		this.frame = this.nativeLayout.render(root, width, rows, () => this.tui.requestRender());
		this.nativeLayout.scrollBox(this.frame, scroll);
		return this.frame.lines.map(line => listCell(line, width));
	}
}
