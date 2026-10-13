import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { clean, clip, summary, wrap } from "../layout.ts";
import { text, type Args, type RenderContext, type Result } from "../types.ts";
export type Draw = (result: Result, theme: Theme, ctx: RenderContext, width: number) => string[];
export function title(name: string, args: Args): string {
  if (name === "bash") return "$ " + clean(String(args.command ?? "")) + (args.timeout === undefined ? "" : `  timeout ${args.timeout}s`);
  if (name === "read") return clean(String(args.path ?? "read"));
  return `${name} ${clean(String(args.pattern ?? ""))}${args.path ? ` in ${clean(String(args.path))}` : ""}`;
}
export function renderers(name: string, draw: Draw): ToolRenderers {
  return {
    renderShell: "self",
    renderCall: (rawArgs, theme, context) => ({ invalidate() {}, render(width: number) {
      const args = (rawArgs ?? {}) as Args;
      const ctx = context as RenderContext;
      const pad = Math.min(Math.max(0, Math.floor(ctx.outputPad)), Math.max(0, width - 1));
      const room = Math.max(0, width - pad);
      const suffix = name === "read" && typeof args.offset === "number" ? `:${Math.max(1, args.offset)}` : "";
      const rows = ctx.expanded ? wrap(title(name, args) + suffix, room).map(line => theme.fg("accent", line)) : summary(title(name, args), suffix, "", room, theme).slice(0, 1);
      return rows.map(row => " ".repeat(pad) + row);
    } }),
    renderResult: (result, _options, theme, context) => ({ invalidate() {}, render(width: number) {
      const ctx = context as RenderContext;
      const pad = Math.min(Math.max(0, Math.floor(ctx.outputPad)), Math.max(0, width - 1));
      return draw(result, theme, ctx, Math.max(0, width - pad)).map(line => " ".repeat(pad) + clip(line, width - pad));
    } }),
  };
}
export function numbered(line: string, number: number, digits: number, width: number, theme: Theme, match = true): string {
  const prefix = `${String(number).padStart(digits)} ${match ? "│" : "┊"} `;
  if (visibleWidth(prefix) >= width) return clip(line, width);
  return theme.fg("dim", prefix) + clip(line, width - visibleWidth(prefix));
}
export function fallback(result: Result, theme: Theme, ctx: RenderContext, width: number): string[] {
  return wrap(text(result) || "(no output)", width).map(line => theme.fg(ctx.isError ? "error" : "toolOutput", line));
}
