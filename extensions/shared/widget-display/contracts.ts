import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export const CONNECT = "preset:widget-display:connect:v1";
export const SESSION_START = "preset:widget-display:session-start:v1";
export type Region = "aboveEditor" | "belowEditor" | "footer";
export interface DisplayGroup {
    region: Region;
    order: number;
    layout: "block" | "inline";
    overflow?: "wrap" | "truncate";
    separator?: string;
}
export interface DisplayRegistry {
    groups: Readonly<Record<string, DisplayGroup>>;
    items: Readonly<Record<string, { group: string; order: number }>>;
}
export const GROUPS = {
    recap: { region: "aboveEditor", order: 10, layout: "block" },
    trellis: { region: "aboveEditor", order: 20, layout: "block" },
    location: { region: "footer", order: 10, layout: "block" },
    context: { region: "footer", order: 20, layout: "block" },
    usage: { region: "footer", order: 30, layout: "inline", overflow: "truncate", separator: "  │  " },
    agent_overview: { region: "footer", order: 40, layout: "block" },
} as const satisfies DisplayRegistry["groups"];
export const ITEMS = {
    recap: { group: "recap", order: 10 },
    trellis: { group: "trellis", order: 10 },
    location: { group: "location", order: 10 },
    context: { group: "context", order: 10 },
    tokens: { group: "usage", order: 10 },
    cache_metrics: { group: "usage", order: 20 },
    task_summary: { group: "usage", order: 30 },
    external_statuses: { group: "usage", order: 40 },
    agent_overview: { group: "agent_overview", order: 10 },
} as const satisfies DisplayRegistry["items"];
export const REGISTRY: DisplayRegistry = { groups: GROUPS, items: ITEMS };
export type Slot = keyof typeof ITEMS;
export type WidgetComponent = Component & { dispose?(): void };
export type InlineComponent = WidgetComponent & { renderText(width: number): string };
export interface FooterContent {
    kind: "footer";
    factory(tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider): WidgetComponent;
}
export interface InlineContent {
    kind: "inline";
    factory(tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider | undefined): InlineComponent;
}
/** Existing widget text/factories remain supported; inline groups accept only finite text fragments. */
export type WidgetContent = readonly string[] | ((tui: TUI, theme: Theme) => WidgetComponent) | FooterContent | InlineContent;
export interface WidgetHandle {
    /** False means retired, unavailable or unsupported; no implicit fallback. */
    set(content: WidgetContent | undefined): boolean;
    dispose(): void;
}
export interface ConnectRequest {
    version: 1;
    slot: Slot;
    token: object;
    ctx: ExtensionContext;
    accept(handle: WidgetHandle): void;
}
