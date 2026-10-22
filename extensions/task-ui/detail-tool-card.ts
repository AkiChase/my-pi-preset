import { ToolExecutionComponent, createEditToolDefinition, createWriteToolDefinition, getMarkdownTheme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text, type TUI, type Component } from "@earendil-works/pi-tui";
import { Highlighter } from "../beautify/highlight.ts";
import { readRenderers } from "../beautify/tools/read.ts";
import { createGrepRenderers } from "../beautify/tools/grep.ts";
import { createFindRenderers } from "../beautify/tools/find.ts";
import { createToolCardRenderers } from "../beautify/tool-card.ts";
import { clean, wrap } from "../beautify/layout.ts";
import type { RenderContext } from "../beautify/types.ts";
import type { ToolCallState, ToolCallSummary, ConversationEntry } from "./types.ts";
import type { TaskTheme } from "./presentation.ts";

type ResultEntry = Extract<ConversationEntry, { kind: "toolResult" }>;
export interface DetailTool { id: string; call: ToolCallSummary; result?: ResultEntry; state?: ToolCallState }
// Only presentation methods cross this boundary. Never publish definitions or execution closures.
const editResult = (createEditToolDefinition("") as ToolRenderers).renderResult!;
const writeCall = (createWriteToolDefinition("") as ToolRenderers).renderCall!;
// Strip the audited native logical heading before terminal wrapping, not guessed visual rows.
class WriteBody extends Text {
    override setText(text: string): void {
        const separator = text.indexOf("\n\n");
        super.setText(separator < 0 ? "" : text.slice(separator + 2));
    }
}

/** One resident card owns its SDK component; detail read highlighting retains no async cache. */
export class DetailToolCard {
    private component?: ToolExecutionComponent;
    private highlighter = new Highlighter();
    private active = true;
    private input: DetailTool;
    private expanded = false;
    private signature = "";
    private nativeState: Record<string, unknown> = {};
    private nativeBody?: Component;
    private writeBody?: WriteBody;
    private hadResult = false;
    private readonly redraw: () => void;
    constructor(input: DetailTool, redraw: () => void) {
        this.input = input; this.redraw = redraw;
        // Reuse ReadDrawing's audited inactive seam: numbered native output without
        // per-card async jobs/ANSI caches. Main-page highlighting is unchanged.
        this.highlighter.dispose();
    }
    dispose(): void { this.active = false; this.highlighter.dispose(); this.component = undefined; this.nativeBody = undefined; this.writeBody = undefined; this.nativeState = {}; }
    render(input: DetailTool, expanded: boolean, width: number, injected: TaskTheme): string[] {
        // A public source may omit or replace an earlier result. SDK has no clearResult.
        if (this.hadResult && !input.result || this.input.call.name !== input.call.name) {
            this.component = undefined;
            this.nativeBody = undefined; this.writeBody = undefined; this.nativeState = {}; this.signature = "";
        }
        this.hadResult = !!input.result;
        this.input = input; this.expanded = expanded;
        let args: Record<string, unknown> = {};
        try {
            const json = input.call.parameters?.status === "complete" ? input.call.parameters.json : undefined;
            if (json && json.length <= 16 * 1024) {
                const parsed: unknown = JSON.parse(json);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
            }
        } catch { /* Malformed external parameter snapshots remain readable, never native args. */ }
        const signature = JSON.stringify([args, input.result, expanded]);
        // SDK shell uses the initialized host theme. Injected fallback never changes that global.
        let ready = false;
        try { getMarkdownTheme().heading("probe"); ready = !!injected.bg && !!injected.bold; } catch { /* standalone tests / pre-init */ }
        if (!ready) return this.fallback(width, injected);
        try {
            if (!this.component) {
                const special = input.call.name === "read" ? readRenderers(this.highlighter) : input.call.name === "grep" ? createGrepRenderers() : input.call.name === "find" ? createFindRenderers() : undefined;
                const policy: ToolRenderers = createToolCardRenderers(input.call.name, () => {
                    const state = this.input.state;
                    const execution = state && state.status !== "running" && state.status !== "interrupted" && state.durationMs !== undefined;
                    const ms = execution ? state?.durationMs : state?.elapsedMs;
                    return ms === undefined ? undefined : { kind: execution ? "execution" : "elapsed", durationMs: ms };
                }, (_args, _result, context, theme) => {
                    const current = this.input, result = current.result, summary = current.call.summary;
                    const state = current.state?.status;
                    const marker = state ? { label: { running: "Running", completed: "Completed", failed: "Failed", interrupted: "Interrupted" }[state], tone: state === "running" ? "accent" as const : state === "completed" ? "success" as const : state === "failed" ? "error" as const : "warning" as const } : undefined;
                    let body: Component | undefined;
                    if (result) {
                        const hostResult = { content: [{ type: "text" as const, text: clean(result.text) }], details: result.display?.diff === undefined ? undefined : { diff: clean(result.display.diff), firstChangedLine: result.display.firstChangedLine } };
                        const nativeContext = { ...context, argsComplete: false, expanded: true, state: this.nativeState, lastComponent: this.nativeBody } as RenderContext;
                        if (this.expanded && special?.renderResult) body = special.renderResult(hostResult, { expanded: true, isPartial: false }, theme, nativeContext);
                        else if (this.expanded && !result.error && current.call.name === "edit" && hostResult.details) body = editResult({ ...hostResult, details: { ...hostResult.details, patch: "" } }, { expanded: true, isPartial: false }, theme, nativeContext);
                        else if (this.expanded && !result.error && current.call.name === "write" && current.call.parameters?.status === "complete") {
                            this.writeBody ??= new WriteBody("", 0, 0);
                            body = writeCall({ path: typeof context.args.path === "string" ? clean(context.args.path) : "", content: typeof context.args.content === "string" ? clean(context.args.content) : "" }, theme, { ...nativeContext, lastComponent: this.writeBody });
                        }
                    }
                    if (body) this.nativeBody = body;
                    const summaryOnly = ["read", "grep", "find", "write", "edit"].includes(current.call.name) && !result?.error;
                    const stats = [result && ["read", "grep", "find"].includes(current.call.name) ? `${result.text.split("\n").length} output lines shown` : undefined, summary?.lines === undefined ? undefined : `${summary.lines} lines`, summary?.bytes === undefined ? undefined : `${summary.bytes} bytes`, summary?.addedLines === undefined ? undefined : `+${summary.addedLines} lines`, summary?.removedLines === undefined ? undefined : `−${summary.removedLines} lines`].filter(Boolean).join(" · ");
                    return { identity: current.call.name, summary: current.call.detail ?? summary?.path ?? summary?.command,
                        marker, statistics: stats ? [{ label: stats, tone: "muted" }] : [], body,
                        bodyText: body || !result || summaryOnly && !this.expanded ? "" : clean(result.text) };
                });
                const ui = { requestRender: () => { if (this.active) this.redraw(); } } as TUI;
                this.component = new ToolExecutionComponent(input.call.name, input.id, args, { showImages: false, outputPad: 1 }, policy, ui, "");
            }
            if (signature !== this.signature) {
                this.signature = signature;
                this.component.updateArgs(args);
                if (input.result) this.component.updateResult({ content: [{ type: "text", text: clean(input.result.text) }], isError: !!input.result.error, details: input.result.display, durationMs: input.result.durationMs });
            }
            this.component.setExpanded(expanded);
            // The cooperating self-shell owns one outer spacer and one vertical pad.
            // Drop those empty rows for this compact surface, preserving body layout.
            return this.component.render(width).slice(2, -1);
        } catch { return this.fallback(width, injected); }
    }
    private fallback(width: number, theme: TaskTheme): string[] {
        const { call, result, state } = this.input;
        const execution = state && state.status !== "running" && state.status !== "interrupted" && state.durationMs !== undefined;
        const ms = execution ? state?.durationMs : state?.elapsedMs;
        const timing = ms === undefined ? "" : ` · ${execution ? "execution" : "elapsed"} ${(ms / 1000).toFixed(1)}s`;
        const label = state ? { running: "Running", completed: "Completed", failed: "Failed", interrupted: "Interrupted" }[state.status] : result ? result.error ? "Failed" : "Completed" : "";
        const path = call.detail ?? call.summary?.path ?? call.summary?.command;
        const rows = wrap(`${call.name}${path ? "  " + path : ""}`, width).slice(0, 1).map(s => theme.fg("toolTitle", s));
        if (label) rows.push(...wrap(label + timing, width).map(s => theme.fg(state?.status === "interrupted" ? "warning" : result?.error ? "error" : "muted", s)));
        const summary = call.summary;
        const stats = [summary?.offset === undefined ? undefined : `from line ${summary.offset}`, summary?.limit === undefined ? undefined : `limit ${summary.limit}`, summary?.lines === undefined ? undefined : `${summary.lines} lines`, summary?.bytes === undefined ? undefined : `${summary.bytes} bytes`, summary?.addedLines === undefined ? undefined : `+${summary.addedLines} lines`, summary?.removedLines === undefined ? undefined : `−${summary.removedLines} lines`].filter(Boolean).join(" · ");
        if (stats) rows.push(...wrap(stats, width).map(s => theme.fg("muted", s)));
        if (result && (this.expanded || result.error || !["read", "grep", "find", "write", "edit"].includes(call.name))) {
            const body = wrap(call.name === "edit" && result.display?.diff ? result.display.diff : result.text, width);
            rows.push(...(this.expanded ? body : body.slice(0, 3)).map(s => theme.fg(result.error ? "error" : "toolOutput", s)));
            if (!this.expanded && body.length > 3) rows.push(theme.fg("dim", `… ${body.length - 3} more visual lines · click to expand`));
        }
        return rows;
    }
}
