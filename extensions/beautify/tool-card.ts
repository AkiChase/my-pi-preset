import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, type Component } from "@earendil-works/pi-tui";
import { createCardHeading, textPreview, type CardField, type CardSummary } from "./card-primitives.ts";
import { clean, clip } from "./layout.ts";
import { text, type Args, type RenderContext } from "./types.ts";
import type { ToolTiming } from "./tool-clock.ts";

type HostResult = Parameters<NonNullable<ToolRenderers["renderResult"]>>[0];

export interface ToolCardDescription {
  identity?: string;
  summary?: CardSummary;
  /** Replaces the inferred call-state marker only for a cooperating adapter. */
  marker?: CardField;
  statistics?: readonly CardField[];
  /** A header-free body owned by a cooperating adapter. */
  body?: Component;
  /** Plain body text, subject to the shared three-physical-row preview rule. */
  bodyText?: string;
}

export type ToolCardDescribe = (args: Args, result: HostResult | undefined, context: RenderContext, theme: Theme) => ToolCardDescription | undefined;
export type ToolTimingSource = (context: RenderContext) => ToolTiming | undefined;

export const TOOL_CARD_TIMING_ADAPTER = "__pi_preset_tool_card_timing_adapter" as const;

export interface CooperativeToolCardRenderers extends ToolRenderers {
  [TOOL_CARD_TIMING_ADAPTER]?: (timing: ToolTimingSource) => ToolRenderers;
}

/**
 * Rebuild only an explicitly cooperative factory renderer with an activation-
 * owned timing source. Opaque third-party renderers never satisfy this seam.
 */
export function withToolCardTiming(renderers: ToolRenderers | undefined, timing: ToolTimingSource): ToolRenderers | undefined {
  const adapter = (renderers as CooperativeToolCardRenderers | undefined)?.[TOOL_CARD_TIMING_ADAPTER];
  return typeof adapter === "function" ? adapter(timing) : undefined;
}

interface Cell {
  args: Args;
  theme: Theme;
  context: RenderContext;
  result?: HostResult;
  description: ToolCardDescription;
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return clean(value);
  try { return clean(JSON.stringify(value, null, 2) ?? String(value)); }
  catch { return "[unserializable argument]"; }
}

function argumentsText(args: Args): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return `args: ${displayValue(args)}`;
  const entries = Object.entries(args);
  if (!entries.length) return "";
  return entries.map(([key, value]) => `${clean(key)}: ${displayValue(value).replace(/\n/g, "\n  ")}`).join("\n");
}

function argumentSummary(args: Args): string {
  const full = argumentsText(args).replace(/\n/g, " · ");
  return full.length > 240 ? `${full.slice(0, 239)}…` : full;
}

function callMarker(cell: Cell): CardField {
  if (cell.result && !cell.context.isPartial) return cell.context.isError
    ? { label: "Failed", tone: "error" }
    : { label: "Completed", tone: "success" };
  if (cell.context.executionStarted) return { label: "Running", tone: "accent" };
  return { label: "Pending", tone: "muted" };
}

function defaultDescription(name: string, cell: Cell): ToolCardDescription {
  const output = cell.result ? text(cell.result) : "";
  const bodyText = cell.result
    ? (cell.context.expanded ? [argumentsText(cell.args), output].filter(Boolean).join("\n") : output)
    : argumentsText(cell.args);
  return { identity: name, summary: argumentSummary(cell.args), bodyText };
}

function resolveDescription(name: string, describe: ToolCardDescribe | undefined, cell: Cell): ToolCardDescription {
  if (!describe) return defaultDescription(name, cell);
  try { return describe(cell.args, cell.result, cell.context, cell.theme) ?? defaultDescription(name, cell); }
  catch { return defaultDescription(name, cell); }
}

function bodyComponent(cell: Cell): Component | undefined {
  if (cell.description.body) return cell.description.body;
  const bodyText = cell.description.bodyText;
  if (!bodyText) return undefined;
  return {
    invalidate() {},
    render(width) {
      const preview = textPreview(bodyText, width, { expanded: cell.context.expanded });
      const tone = cell.context.isError ? "error" : "toolOutput";
      const rows = preview.rows.map(row => cell.theme.fg(tone, row));
      if (preview.hidden) {
        const hint = clip(`… (${preview.omittedRows} more lines, expand)`, width, "");
        if (hint) rows.push(cell.theme.fg("muted", hint));
      }
      return rows;
    },
  };
}

function cardComponent(cell: Cell, timing: ToolTimingSource | undefined): Component {
  const render = (width: number) => {
    const marker = cell.description.marker ?? callMarker(cell);
    const currentTiming = timing?.(cell.context);
    const statistics = [
      ...(cell.description.statistics ?? []),
      ...(currentTiming ? [{ label: `${currentTiming.kind} ${(currentTiming.durationMs / 1000).toFixed(1)}s`, tone: "muted" as const }] : []),
    ];
    const box = new Box(cell.context.outputPad, 1, line => cell.theme.bg(
      cell.context.isPartial ? "toolPendingBg" : cell.context.isError ? "toolErrorBg" : "toolSuccessBg",
      line,
    ));
    box.addChild(createCardHeading({
      identity: cell.description.identity ?? "tool",
      summary: cell.description.summary,
      marker,
      statistics,
      theme: cell.theme,
      context: cell.context,
    }));
    const body = bodyComponent(cell);
    if (body) box.addChild(body);
    return box.render(width);
  };
  return {
    invalidate() {},
    render,
    handleMouse(event) {
      const pad = cell.context.outputPad;
      const height = render(event.width).length;
      // The host wraps this component in a result MouseRegion. Consume only the
      // self-owned border/padding so clicks on text retain the host toggle rule.
      if (event.x < pad || event.x >= event.width - pad || event.y < 1 || event.y >= height - 1) return { handled: true, render: false };
      return undefined;
    },
  };
}

/**
 * Public self-shell renderer factory. Generic callers use its default descriptor;
 * cooperating adapters may supply header-free bodies without owning execution.
 */
export function createToolCardRenderers(name: string, timing?: ToolTimingSource, describe?: ToolCardDescribe): ToolRenderers {
  const key = `beautify.tool-card.${name}`;
  const getCell = (theme: Theme, context: RenderContext): Cell => {
    const state = context.state as Record<string, unknown>;
    let cell = state[key] as Cell | undefined;
    if (!cell) {
      cell = { args: context.args, theme, context, description: { identity: name } };
      state[key] = cell;
    }
    cell.args = context.args;
    cell.theme = theme;
    cell.context = context;
    cell.description = resolveDescription(name, describe, cell);
    return cell;
  };

  const renderers: CooperativeToolCardRenderers = {
    renderShell: "self",
    renderCall: (_args, theme, context) => {
      const cell = getCell(theme, context as RenderContext);
      return cardComponent(cell, timing);
    },
    renderResult: (result, _options, theme, context) => {
      const cell = getCell(theme, context as RenderContext);
      cell.result = result;
      cell.description = resolveDescription(name, describe, cell);
      return { invalidate() {}, render() { return []; } };
    },
  };
  Object.defineProperty(renderers, TOOL_CARD_TIMING_ADAPTER, {
    value: (nextTiming: ToolTimingSource) => createToolCardRenderers(name, nextTiming, describe),
    enumerable: true,
  });
  return renderers;
}
