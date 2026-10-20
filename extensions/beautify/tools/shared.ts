import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { clean, clip, summary, toolHeading, wrap } from "../layout.ts";
import { text, type Args, type RenderContext, type Result } from "../types.ts";
export type Draw = (result: Result, theme: Theme, context: RenderContext, width: number) => string[];
export interface Metadata { title?: string; suffix?: string; stats: string; secondary?: string; expandedRows?: readonly string[]; executionConfig?: import("../../runtime-tasks/execution-config.ts").ExecutionConfig }
export type Describe = (result: Result | undefined, context: RenderContext) => Metadata;
export function title(name: string, args: Args): string {
  if (name === "bash") {
    const mode = args.run_in_background === true ? "  background"
      : args.background_after_seconds !== undefined ? `  background after ${args.background_after_seconds}s`
      : args.timeout !== undefined ? `  timeout ${args.timeout}s` : "";
    return clean(typeof args.description === "string" && args.description.trim() ? args.description.trim() : String(args.command ?? "")) + mode;
  }
  if (name === "read") return clean(String(args.path ?? ""));
  return `${clean(String(args.pattern ?? ""))}${args.path ? ` in ${clean(String(args.path))}` : ""}`;
}
interface Cell { result?: Result; ctx: RenderContext; theme: Theme }
export type TimingDisplay = (ctx: RenderContext) => string | undefined;
export function renderers(name: string, draw: Draw, describe: Describe = genericMetadata, timing?: TimingDisplay): ToolRenderers {
  const key = `beautify.${name}.composition`;
  const cell = (theme: Theme, ctx: RenderContext): Cell => {
    const existing = ctx.state[key] as Cell | undefined;
    if (existing) { existing.ctx = ctx; existing.theme = theme; return existing; }
    const created = { ctx, theme }; ctx.state[key] = created; return created;
  };
  return {
    renderShell: "default",
    renderCall: (_args, theme, context) => {
      const current = cell(theme, context as RenderContext);
      return { invalidate() {}, render(width) {
        const { ctx, result, theme } = current;
        const meta = describe(result, ctx);
        const display = timing?.(ctx);
        if (display) meta.stats = [meta.stats, display].filter(Boolean).join(" · ");
        const label = meta.title ?? title(name, ctx.args);
        const suffix = meta.suffix ?? (name === "read" && typeof ctx.args.offset === "number" ? `:${Math.max(1, ctx.args.offset)}` : "");
        return toolHeading(name, label, suffix, meta.stats, width, theme, ctx.expanded, meta.secondary);
      } };
    },
    renderResult: (result, _options, theme, context) => {
      const ctx = context as RenderContext, current = cell(theme, ctx);
      current.result = result;
      return { invalidate() {}, render: width => current.ctx.expanded ? draw(current.result!, current.theme, current.ctx, width).map(line => clip(line, width)) : [] };
    },
  };
}
export function genericMetadata(result: Result | undefined, ctx: RenderContext): Metadata {
  if (!result) return { stats: "" };
  const raw = clean(text(result));
  return { stats: ctx.isError ? `error: ${raw.split("\n")[0] || "failed"}` : raw && raw !== "(no output)" ? `${raw.split("\n").length} output lines` : "no output" };
}
export function numbered(line: string, number: number, digits: number, width: number, theme: Theme, match = true): string {
  const prefix = `${String(number).padStart(digits)} ${match ? "│" : "┊"} `;
  if (visibleWidth(prefix) >= width) return clip(line, width);
  return theme.fg("dim", prefix) + clip(line, width - visibleWidth(prefix));
}
export function fallback(result: Result, theme: Theme, ctx: RenderContext, width: number): string[] {
  if (!ctx.expanded) return summary("Output", "", genericMetadata(result, ctx).stats, width, theme);
  return wrap(text(result) || "(no output)", width).map(line => theme.fg(ctx.isError ? "error" : "toolOutput", line));
}
export function component(render: (width: number) => string[]): Component { return { invalidate() {}, render }; }
