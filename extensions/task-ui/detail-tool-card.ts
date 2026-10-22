import { ToolExecutionComponent, createEditToolDefinition, createWriteToolDefinition, getMarkdownTheme, type ToolRenderers, type Theme } from "@earendil-works/pi-coding-agent";
import { type TUI } from "@earendil-works/pi-tui";
import { Highlighter } from "../beautify/highlight.ts";
import { readRenderers } from "../beautify/tools/read.ts";
import { createBashRenderers } from "../beautify/tools/bash.ts";
import { createGrepRenderers } from "../beautify/tools/grep.ts";
import { createFindRenderers } from "../beautify/tools/find.ts";
import { clean, wrap } from "../beautify/layout.ts";
import type { ToolTiming } from "../beautify/tool-clock.ts";
import type { ToolCallState, ToolCallSummary, ConversationEntry } from "./types.ts";
import type { TaskTheme } from "./presentation.ts";

type ResultEntry = Extract<ConversationEntry, { kind: "toolResult" }>;
export interface DetailTool { id: string; call: ToolCallSummary; result?: ResultEntry; state?: ToolCallState }
// Only presentation methods are retained, never child execution closures.
const { renderShell: editShell, renderCall: editCall, renderResult: editResult } = createEditToolDefinition("") as ToolRenderers;
const { renderShell: writeShell, renderCall: writeCall, renderResult: writeResult } = createWriteToolDefinition("") as ToolRenderers;
const nativeEdit: ToolRenderers = { renderShell: editShell, renderCall: editCall, renderResult: editResult };
const nativeWrite: ToolRenderers = { renderShell: writeShell, renderCall: writeCall, renderResult: writeResult };

/** One resident SDK card. The panel owns input and the bounded source owns data. */
export class DetailToolCard {
    private component?: ToolExecutionComponent;
    private highlighter = new Highlighter();
    private active = true;
    private input: DetailTool;
    private expanded = false;
    private signature = "";
    private hadResult = false;
    private readonly redraw: () => void;
    constructor(input: DetailTool, redraw: () => void) {
        this.input = input; this.redraw = redraw;
        // Retain native numbered read output without per-card async jobs/caches.
        // The main page's active highlighter is unaffected.
        this.highlighter.dispose();
    }
    dispose(): void { this.active = false; this.highlighter.dispose(); this.component = undefined; }
    private timing(): ToolTiming | undefined {
        const state = this.input.state;
        const duration = state?.durationMs ?? this.input.result?.durationMs;
        if (state?.status !== "running" && state?.status !== "interrupted" && duration !== undefined)
            return { kind: "execution", durationMs: duration };
        return state?.elapsedMs === undefined ? undefined : { kind: "elapsed", durationMs: state.elapsedMs };
    }
    private timingText(): string | undefined {
        const timing = this.timing();
        const clock = timing ? `${timing.kind} ${(Math.max(0, timing.durationMs) / 1000).toFixed(1)}s` : undefined;
        return this.input.state?.status === "interrupted" ? ["Interrupted", clock].filter(Boolean).join(" · ") : clock;
    }
    /** Native edit may rebuild its call header from the result slot. */
    private nativeTitleTheme(theme: Theme): Theme {
        const display = this.timingText();
        const tone = this.input.state?.status === "interrupted" ? "warning" : "muted";
        // Project only the SDK's title token, never body text or shell ownership.
        return display ? new Proxy(theme, { get(target, key) {
            if (key === "fg") return (color: Parameters<Theme["fg"]>[0], text: string) => target.fg(color, text) +
                (color === "toolTitle" ? target.fg(tone, ` · ${display}`) : "");
            return Reflect.get(target, key);
        } }) : theme;
    }
    private renderers(): ToolRenderers {
        const timing = () => this.timingText();
        const withInterruption = (renderers: ToolRenderers): ToolRenderers => ({ ...renderers, renderCall: (args, theme, context) => {
            const call = renderers.renderCall!(args, theme, context);
            // The actual main expanded heading intentionally omits statistics.
            // Cancellation with no result must still be identifiable, without
            // changing its normal running/completed title or result layout.
            if (!context.expanded || this.input.state?.status !== "interrupted") return call;
            return { invalidate: () => call.invalidate(), render: width => [
                ...call.render(width), ...wrap(this.timingText() ?? "Interrupted", width).map(row => theme.fg("warning", row)),
            ] };
        } });
        switch (this.input.call.name) {
            case "read": return withInterruption(readRenderers(this.highlighter, timing));
            case "bash": return withInterruption(createBashRenderers(timing));
            case "grep": return withInterruption(createGrepRenderers(timing));
            case "find": return withInterruption(createFindRenderers(timing));
            case "write": case "edit": {
                const native = this.input.call.name === "edit" ? nativeEdit : nativeWrite;
                return { ...native, renderCall: (args, theme, context) => {
                    // Native edit's argsComplete branch reads the filesystem to compute
                    // a preview. Result rendering still installs the returned diff in
                    // native shared state, preserving its exact layout at both sizes.
                    const safeContext = this.input.call.name === "edit" ? { ...context, argsComplete: false } : context;
                    return native.renderCall!(args, this.nativeTitleTheme(theme), safeContext);
                }, renderResult: (result, options, theme, context) => native.renderResult!(result, options, this.nativeTitleTheme(theme), context) };
            }
            // A registered unknown tool with no custom renderer reaches the SDK's
            // default call/result fallbacks through a non-empty definition slot.
            // Do not invent a shared descriptor or retain opaque child closures.
            default: return {};
        }
    }
    render(input: DetailTool, expanded: boolean, width: number, injected: TaskTheme): string[] {
        if (this.hadResult && !input.result || this.input.call.name !== input.call.name || this.input.state?.status === "interrupted" && input.state?.status === "running") {
            this.component = undefined; this.signature = "";
        }
        this.hadResult = !!input.result;
        this.input = input; this.expanded = expanded;
        let args: Record<string, unknown> = {};
        try {
            const json = input.call.parameters?.status === "complete" ? input.call.parameters.json : undefined;
            if (json && json.length <= 16 * 1024) {
                const parsed: unknown = JSON.parse(json, (_key, value: unknown) => typeof value === "string" ? clean(value) : value);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
            }
        } catch { /* Malformed snapshots are never passed as complete native arguments. */ }
        let ready = false;
        try { getMarkdownTheme().heading("probe"); ready = !!injected.bg && !!injected.bold; } catch { /* pre-init fallback */ }
        if (!ready) return this.fallback(width, injected);
        try {
            if (!this.component) {
                const ui = { requestRender: () => { if (this.active) this.redraw(); } } as TUI;
                this.component = new ToolExecutionComponent(input.call.name, input.id, args, { showImages: false }, this.renderers(), ui, "");
            }
            const signature = JSON.stringify([args, input.result, input.state]);
            if (signature !== this.signature) {
                this.signature = signature;
                this.component.updateArgs(args);
                if (input.state) this.component.markExecutionStarted();
                if (input.call.parameters?.status === "complete") this.component.setArgsComplete();
                if (input.result) this.component.updateResult({ content: [{ type: "text", text: clean(input.result.text) }], isError: !!input.result.error,
                    details: input.result.display ? {
                        ...(input.result.display.runtimeLaunch ? { runtimeLaunch: input.result.display.runtimeLaunch } : {}),
                        ...(input.result.display.diff === undefined ? {} : { diff: clean(input.result.display.diff), firstChangedLine: input.result.display.firstChangedLine }),
                    } : undefined,
                    durationMs: input.result.durationMs ?? input.state?.durationMs });
                else if (input.state?.status === "interrupted") this.component.updateResult({ content: [], isError: true });
            }
            this.component.setExpanded(expanded);
            const rows = this.component.render(width);
            if (!["read", "bash", "grep", "find", "write", "edit"].includes(input.call.name)) {
                const timing = this.timingText();
                if (timing) rows.push(...wrap(timing, width).map(row => injected.fg(input.state?.status === "interrupted" ? "warning" : "muted", row)));
            }
            return rows;
        } catch { return this.fallback(width, injected); }
    }
    private fallback(width: number, theme: TaskTheme): string[] {
        const { call, result } = this.input;
        const detail = call.detail ?? call.summary?.path ?? call.summary?.command;
        const rows = wrap(`${call.name}${detail ? "  " + detail : ""}`, width).map(s => theme.fg("toolTitle", s));
        const timing = this.timingText();
        if (timing) rows.push(...wrap(timing, width).map(s => theme.fg(this.input.state?.status === "interrupted" ? "warning" : "muted", s)));
        if (result?.error) rows.push(theme.fg("error", "Failed"));
        if (result && (this.expanded || result.error || !["read", "grep", "find", "bash"].includes(call.name))) {
            const body = wrap(call.name === "edit" && result.display?.diff ? result.display.diff : result.text, width);
            rows.push(...(this.expanded || call.name === "edit" ? body : body.slice(0, call.name === "write" ? 10 : 3)).map(s => theme.fg(result.error ? "error" : "toolOutput", s)));
        }
        return rows;
    }
}
