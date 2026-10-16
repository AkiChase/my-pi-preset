import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { toolHeading } from "./layout.ts";

/** Stateless title component; importing it does not activate the extension. */
export function createToolCallHeading(options: {
  name: string;
  detail?: string;
  stats?: string;
  secondary?: string;
  theme: Theme;
  context: { expanded: boolean };
}): Component {
  return {
    invalidate() {},
    render(width) {
      return toolHeading(options.name, options.detail ?? "", "", options.stats ?? "", width,
        options.theme, options.context.expanded, options.secondary ?? "", false);
    },
  };
}
