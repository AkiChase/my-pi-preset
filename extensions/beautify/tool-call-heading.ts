import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { createCardHeading, type CardField } from "./card-primitives.ts";

/** Stateless title component; importing it does not activate the extension. */
export function createToolCallHeading(options: {
  name: string;
  detail?: string;
  stats?: string;
  secondary?: string;
  theme: Theme;
  context: { expanded: boolean };
}): Component {
  const statistics: CardField[] = [
    ...(options.stats ? [{ label: options.stats, tone: "muted" as const }] : []),
    ...((options.secondary ?? "").split(" · ").filter(Boolean).map(label => ({ label, tone: "muted" as const }))),
  ];
  return createCardHeading({
    identity: options.name,
    summary: options.detail ?? "",
    statistics,
    theme: options.theme,
    context: options.context,
  });
}
