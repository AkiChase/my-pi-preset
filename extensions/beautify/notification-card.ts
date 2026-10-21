import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component } from "@earendil-works/pi-tui";
import { createCardHeading, textPreview, type CardField, type CardSummary, type CardTone } from "./card-primitives.ts";
import { clip } from "./layout.ts";

/** Caller-owned presentation data for a persisted custom message or entry. */
export interface NotificationCardData {
  identity: string;
  summary?: CardSummary;
  marker?: CardField;
  statistics?: readonly CardField[];
  /** Plain delivered text receives the shared physical-row preview budget. */
  textBody?: string;
  /** A producer-owned rich body; never stringify or structurally reinterpret it. */
  body?: Component;
  bodyTone?: CardTone;
}

export interface NotificationCardOptions {
  expanded: boolean;
  outputPad: number;
}

/**
 * Public, registration-free shell for custom-message and custom-entry cards.
 * It owns only framing, title layout, and plain-text previewing. Producers retain
 * validation, delivery, business status semantics, and rich-body ownership.
 */
export function createNotificationCard(
  data: NotificationCardData,
  options: NotificationCardOptions,
  theme: Theme,
): Component {
  let current: Box | undefined;
  const build = () => {
    const box = new Box(options.outputPad, 1, line => theme.bg("customMessageBg", line));
    box.addChild(createCardHeading({
      identity: data.identity,
      summary: data.summary,
      marker: data.marker,
      statistics: data.statistics,
      theme,
      context: { expanded: options.expanded },
    }));
    if (data.body) {
      box.addChild(data.body);
    } else if (data.textBody) {
      box.addChild({
        invalidate() {},
        render(width) {
          const preview = textPreview(data.textBody!, width, { expanded: options.expanded });
          const tone = data.bodyTone ?? "muted";
          const rows = preview.rows.map(row => theme.fg(tone, row));
          if (preview.hidden) {
            const hint = clip(`… (${preview.omittedRows} more lines, expand)`, width, "");
            if (hint) rows.push(theme.fg("muted", hint));
          }
          return rows;
        },
      });
    }
    return box;
  };
  return {
    invalidate() {
      if (current) current.invalidate();
      else data.body?.invalidate();
    },
    render(width) {
      current = build();
      return current.render(width);
    },
    handleMouse(event) {
      return current?.handleMouse(event);
    },
  };
}
