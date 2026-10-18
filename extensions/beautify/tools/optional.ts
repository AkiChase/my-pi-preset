import { executionConfigRows } from "../execution-config.ts";
import { keyHint, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, type Component } from "@earendil-works/pi-tui";
import { clean, toolHeading, wrap } from "../layout.ts";
import { text, type Args, type RenderContext } from "../types.ts";
import { component, type Metadata } from "./shared.ts";
import type { RetrievalContract } from "./task-manage.ts";

type Options = Parameters<NonNullable<ToolRenderers["renderResult"]>>[1];
type HostResult = Parameters<NonNullable<ToolRenderers["renderResult"]>>[0];
interface Cell {
  args: Args; theme: Theme; ctx: RenderContext; result?: HostResult; options: Options;
  meta?: Metadata; callDelegated: boolean; originalState: Record<string, unknown>; originalCall?: Component; originalResult?: Component; callDisplay?: Component; resultDisplay?: Component; shell: Component;
}
function displayValue(value: unknown): string {
  if (typeof value === "string") return clean(value);
  try { return clean(JSON.stringify(value, null, 2) ?? String(value)); }
  catch { return "[unserializable argument]"; }
}
function callFallback(name: string, args: unknown, theme: Theme, expanded: boolean): Component {
  const entries = args == null ? [] : typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [["args", args]];
  const header = theme.fg("toolTitle", name);
  if (expanded) return component(width => [
    ...wrap(name, width).map(line => theme.fg("toolTitle", line)),
    ...entries.flatMap(([key, value]) => wrap(`  ${key}: ${displayValue(value).replace(/\n/g, "\n    ")}`, width).map(line => theme.fg("muted", line))),
  ]);
  const pairs = entries.map(([key, value]) => `${key}=${displayValue(value).replace(/\n/g, "\\n")}`).join(" ");
  const preview = pairs.length > 100 ? pairs.slice(0, 97) + "..." : pairs;
  return new Text(header + (preview ? " " + theme.fg("muted", preview) : ""), 0, 0);
}
export function optionalRenderers(name: string, original: ToolRenderers | undefined, contract: RetrievalContract): ToolRenderers {
  const key = `beautify.${name}.optional`;
  let warned = false;
  const diagnose = () => {
    if (!warned) { warned = true; console.error("[beautify] Optional renderer failed; retaining readable arguments and result."); }
  };
  const getCell = (theme: Theme, ctx: RenderContext): Cell => {
    let current = ctx.state[key] as Cell | undefined;
    if (!current) {
      current = { args: ctx.args, theme, ctx, options: { expanded: ctx.expanded, isPartial: ctx.isPartial }, callDelegated: false, originalState: {}, shell: component(() => []) };
      ctx.state[key] = current;
    }
    current.args = ctx.args; current.theme = theme; current.ctx = ctx;
    current.options = { expanded: ctx.expanded, isPartial: ctx.isPartial };
    return current;
  };
  const ownShell = original?.renderShell === "self";
  const compose = (cell: Cell, phase: "call" | "result") => {
    const { args, theme, ctx, result } = cell;
    cell.meta = contract(args, result, ctx);
    const children: Component[] = [];
    if (cell.meta) {
      const meta = cell.meta;
      children.push(component(width => toolHeading(name, meta.title ?? "", "", meta.stats, width, theme, ctx.expanded, meta.secondary)));
      if (meta.executionConfig) children.push(component(width => [
        ...(ctx.expanded && meta.stats ? wrap(`State: ${meta.stats}`, width).map(row => theme.fg("muted", row)) : []),
        ...executionConfigRows(meta.executionConfig!, ctx.expanded, width, theme),
      ]));
      if (result && ctx.expanded) children.push(component(width => wrap(text(result), width).map(line => theme.fg(ctx.isError ? "error" : "toolOutput", line))));
    } else {
      if (phase === "call" || !cell.callDelegated) {
        const callCtx = { ...ctx, state: cell.originalState, lastComponent: cell.originalCall };
        try {
          const rendered = original?.renderCall?.(args, theme, callCtx);
          if (rendered) cell.originalCall = rendered;
          cell.callDisplay = rendered ?? callFallback(name, args, theme, ctx.expanded);
        } catch { diagnose(); cell.callDisplay = callFallback(name, args, theme, ctx.expanded); }
        cell.callDelegated = true;
      }
      children.push(cell.callDisplay!);
      if (result && phase === "result") {
        const resultCtx = { ...ctx, state: cell.originalState, lastComponent: cell.originalResult };
        const fallback = () => component(width => {
          const lines = clean(text(result)).split("\n");
          if (!text(result)) return [];
          const shown = ctx.expanded ? lines : lines.slice(0, 10);
          const rows = shown.flatMap(line => wrap(line, width).map(row => theme.fg("toolOutput", row)));
          if (shown.length < lines.length) rows.push(...wrap(`... (${lines.length - shown.length} more lines, ${clean(keyHint("app.tools.expand", "to expand"))})`, width).map(row => theme.fg("muted", row)));
          return rows;
        });
        try {
          const rendered = original?.renderResult?.(result, cell.options, theme, resultCtx);
          if (rendered) cell.originalResult = rendered;
          cell.resultDisplay = rendered ?? fallback();
        } catch { diagnose(); cell.resultDisplay = fallback(); }
      }
      if (result && cell.resultDisplay) children.push(cell.resultDisplay);
    }
    // Pi 1.2 selects its shell BEFORE call/result and renderShell has no context.
    // Only an original self renderer needs a local Box: same-round switching
    // must remove that Box for delegation. All other adapters use the host Box.
    const shell = ownShell && cell.meta ? new Box(ctx.outputPad, 1, line => theme.bg(ctx.isPartial ? "toolPendingBg" : ctx.isError ? "toolErrorBg" : "toolSuccessBg", line)) : new Container();
    children.forEach(child => shell.addChild(child));
    cell.shell = shell;
  };
  return {
    renderShell: ownShell ? "self" : "default",
    renderCall: (_args, theme, context) => {
      const cell = getCell(theme, context as RenderContext); cell.callDelegated = false;
      // With a result, the host immediately calls renderResult in this round.
      // Defer both contract parsing and original callbacks until its NEW payload
      // arrives: the cached partial result must not be parsed as a final result.
      if (!cell.result) compose(cell, "call");
      return {
        render: width => cell.shell.render(width),
        invalidate() { cell.shell.invalidate(); },
        handleMouse(event) {
          if (ownShell && cell.meta) {
            const pad = cell.ctx.outputPad, height = cell.shell.render(event.width).length;
            // The host wraps a self component in one MouseRegion. Suppress its
            // fallback click on Box padding, matching the real default shell.
            if (event.x < pad || event.x >= event.width - pad || event.y < 1 || event.y >= height - 1) return { handled: true, render: false };
          }
          return cell.shell.handleMouse?.(event);
        },
      };
    },
    renderResult: (result, options, theme, context) => {
      const cell = getCell(theme, context as RenderContext);
      cell.result = result; cell.options = options; compose(cell, "result");
      return component(() => []);
    },
  };
}
