import { keyHint, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { clean, clip, summary, toolHeading, wrap } from "../layout.ts";
import { text, type Args, type RenderContext, type Result } from "../types.ts";
export type Draw = (result: Result, theme: Theme, context: RenderContext, width: number) => string[];
export interface Metadata { title?: string; suffix?: string; stats: string; secondary?: string; expandedRows?: readonly string[]; executionConfig?: import("../../runtime-tasks/execution-config.ts").ExecutionConfig }
export type Describe = (result: Result | undefined, context: RenderContext) => Metadata;

type BuiltinName = "bash" | "read" | "find" | "grep";
interface CallDescription { title: string; suffix: string; options: string; details: string[] }

/** Args-only call information: execution and result updates only add metadata/body. */
export function describeCall(name: BuiltinName, args: Args): CallDescription {
  const string = (key: string) => Object.hasOwn(args, key) && typeof args[key] === "string" ? clean(args[key]) : "";
  const boolean = (key: string) => Object.hasOwn(args, key) && typeof args[key] === "boolean" ? args[key] : undefined;
  const number = (key: string) => Object.hasOwn(args, key) && typeof args[key] === "number" && Number.isFinite(args[key]) ? args[key] : undefined;
  const options: string[] = [], details: string[] = [];
  if (name === "bash") {
    const description = string("description").trim(), command = string("command");
    const after = number("background_after_seconds"), timeout = number("timeout");
    const mode = boolean("run_in_background") === true ? "  background"
      : after !== undefined ? `  background after ${after}s`
      : timeout !== undefined ? `  timeout ${timeout}s` : "";
    if (description && command) options.push(command.replace(/\n/g, "\\n"));
    if (command) details.push(`Command: ${command}`);
    return { title: (description || command) + mode, suffix: "", options: options.join(" · "), details };
  }
  const path = string("path"), limit = number("limit");
  if (name === "read") {
    const offset = number("offset");
    if (limit !== undefined) options.push(`up to ${limit} lines`);
    if (offset !== undefined || limit !== undefined) {
      const start = Math.max(1, offset ?? 1);
      details.push(limit !== undefined && limit > 0 ? `Lines ${start}–${start + limit - 1}` : `From line ${start}`);
    }
    return { title: path, suffix: offset !== undefined ? `:${Math.max(1, offset)}` : "", options: options.join(" · "), details };
  }
  if (name === "grep") {
    const glob = string("glob"), context = number("context");
    if (glob.trim()) options.push(`files ${glob}`);
    if (boolean("ignoreCase") === true) options.push("case-insensitive");
    else if (boolean("ignoreCase") === false) options.push("case-sensitive");
    if (boolean("literal") === true) options.push("literal");
    else if (boolean("literal") === false) options.push("regex");
    if (context !== undefined) options.push(`${context} context lines`);
  }
  if (limit !== undefined) options.push(`up to ${limit} ${name === "find" ? "files" : "matches"}`);
  return { title: string("pattern") + (path ? ` in ${path}` : ""), suffix: "", options: options.join(" · "), details };
}
interface Cell { result?: Result; ctx: RenderContext; theme: Theme }
export type TimingDisplay = (ctx: RenderContext) => string | undefined;
export function renderers(name: BuiltinName, draw: Draw, describe: Describe = genericMetadata, timing?: TimingDisplay): ToolRenderers {
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
        const call = describeCall(name, ctx.args);
        const label = meta.title ?? call.title;
        const suffix = meta.suffix ?? call.suffix;
        const secondary = [meta.secondary, call.options].filter(Boolean).join(" · ");
        // Keep the compact composition (and its metadata priority) in both
        // states when it fits. Expanded overflow restores full call information
        // in separately styled rows, without changing other tool families.
        const metadata = [meta.stats, secondary, keyHint("app.tools.expand", "expand")]
          .filter(Boolean).map(value => clean(value).replace(/\n/g, "\\n")).join(" · ");
        const fullTitle = clean(name + (label || suffix ? `  ${label}${suffix}` : "")).replace(/\n/g, "\\n");
        // summary() retains its own two-cell metadata separator even when
        // no title has arrived; toolHeading adds the identity separator too.
        const metadataGap = label || suffix ? 2 : 4;
        const heading = !ctx.expanded || visibleWidth(fullTitle) + (metadata ? metadataGap + visibleWidth(metadata) : 0) <= width
          ? toolHeading(name, label, suffix, meta.stats, width, theme, false, secondary)
          : [...toolHeading(name, label, suffix, "", width, theme, true),
            ...wrap(metadata, width).filter(Boolean).map(row => theme.fg("muted", row))];
        if (!ctx.expanded) return heading;
        return [...heading,
          ...call.details.flatMap(detail => wrap(detail, width).map(row => theme.fg("muted", row))),
        ];
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
