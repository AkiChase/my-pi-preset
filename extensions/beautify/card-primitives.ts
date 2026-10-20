import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { clean, clip, wrap } from "./layout.ts";

/** Semantic display colors supported by the public Pi theme contract. */
export type CardTone = Extract<ThemeColor, "accent" | "muted" | "success" | "warning" | "error">;

/** A caller-owned, already-interpreted status or statistic. */
export interface CardField {
  label: string;
  tone: CardTone;
}

export interface CardSummaryContext {
  /** Width available to the summary after identity and title spacing. */
  availableWidth: number;
  expanded: boolean;
  theme: Theme;
}

/** A summary may adapt its text to the title space, but not render arbitrary UI. */
export type CardSummary = string | ((context: CardSummaryContext) => string);

export interface CardHeadingOptions {
  identity: string;
  summary?: CardSummary;
  marker?: CardField;
  statistics?: readonly CardField[];
  /** Lower-priority text, omitted before marker or statistics when space is tight. */
  expandHint?: string;
  theme: Theme;
  context: { expanded: boolean };
}

export interface TextPreview {
  rows: string[];
  /** True only when collapsed rows omit real rendered text rows. */
  hidden: boolean;
  omittedRows: number;
}

function titleText(value: string): string {
  return clean(value).replace(/\n/g, "\\n");
}

function usableField(field: CardField | undefined): CardField | undefined {
  if (!field) return undefined;
  const label = titleText(field.label);
  return label ? { ...field, label } : undefined;
}

function resolveSummary(summary: CardSummary | undefined, context: CardSummaryContext): string {
  if (summary === undefined) return "";
  try {
    return titleText(typeof summary === "function" ? summary(context) : summary);
  } catch {
    // A presentation-only callback must not break a tool card.
    return "";
  }
}

function paint(theme: Theme, tone: CardTone, text: string): string {
  return theme.fg(tone, text);
}

function fieldWidth(fields: readonly CardField[]): number {
  return fields.reduce((total, field, index) => total + visibleWidth(field.label) + (index ? 3 : 0), 0);
}

function renderFields(theme: Theme, fields: readonly CardField[]): string {
  return fields.map(field => paint(theme, field.tone, field.label)).join(" · ");
}

function titleLine(theme: Theme, identity: string, summary: string): string {
  return paint(theme, "accent", identity) + (summary ? `  ${paint(theme, "accent", summary)}` : "");
}

function withOptionalHint(fields: readonly CardField[], hint: string): CardField[] {
  return hint ? [...fields, { label: hint, tone: "muted" }] : [...fields];
}

/**
 * Stateless common title component. It only owns identity/summary/metadata
 * layout; callers retain shell, mouse, body, execution and result ownership.
 */
export function createCardHeading(options: CardHeadingOptions): Component {
  return {
    invalidate() {},
    render(width) {
      if (width < 1) return [];
      const theme = options.theme;
      const identity = clip(titleText(options.identity), width, "");
      const baseFields = [usableField(options.marker), ...(options.statistics ?? []).map(usableField)].filter((field): field is CardField => field !== undefined);
      const hint = titleText(options.expandHint ?? "");
      const summary = resolveSummary(options.summary, {
        availableWidth: Math.max(0, width - visibleWidth(identity) - 2),
        expanded: options.context.expanded,
        theme,
      });

      if (options.context.expanded) {
        const firstRoom = Math.max(0, width - visibleWidth(identity) - (summary ? 2 : 0));
        const title = titleLine(theme, identity, summary ? clip(summary, firstRoom) : "");
        const rows = [title];
        for (const field of baseFields) rows.push(...wrap(`  ${field.label}`, width).map(row => paint(theme, field.tone, row)));
        return rows;
      }

      const candidates = [withOptionalHint(baseFields, hint), baseFields];
      for (const fields of candidates) {
        const metadataWidth = fieldWidth(fields);
        const separatorWidth = metadataWidth ? 2 : 0;
        const summaryRoom = width - visibleWidth(identity) - (summary ? 2 : 0) - separatorWidth - metadataWidth;
        // Preserve a useful summary only when it can coexist with all required metadata.
        if (summaryRoom >= (summary ? Math.min(8, visibleWidth(summary)) : 0)) {
          const clippedSummary = summary ? clip(summary, summaryRoom) : "";
          const row = titleLine(theme, identity, clippedSummary) + (fields.length ? `  ${renderFields(theme, fields)}` : "");
          if (visibleWidth(row) <= width) return [row];
        }
      }

      const summaryRoom = Math.max(0, width - visibleWidth(identity) - (summary ? 2 : 0));
      const rows = [titleLine(theme, identity, summary ? clip(summary, summaryRoom) : "")];
      // A narrow title moves all required metadata below rather than silently dropping it.
      for (const field of baseFields) rows.push(...wrap(`  ${field.label}`, width).map(row => paint(theme, field.tone, row)));
      return rows;
    },
  };
}

/**
 * Produce rows from actual terminal-width wrapping. The caller owns expansion
 * hints and styling, so a hint remains outside the three-row text budget.
 */
export function textPreview(value: string, width: number, options: { expanded: boolean; maxCollapsedRows?: number }): TextPreview {
  const allRows = wrap(clean(value), width);
  if (options.expanded) return { rows: allRows, hidden: false, omittedRows: 0 };
  const maxRows = options.maxCollapsedRows ?? 3;
  const rows = allRows.slice(0, Math.max(0, maxRows));
  return { rows, hidden: rows.length < allRows.length, omittedRows: Math.max(0, allRows.length - rows.length) };
}
