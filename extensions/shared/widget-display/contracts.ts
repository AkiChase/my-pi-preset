import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export const CONNECT = "preset:widget-display:connect:v1";
export const SESSION_START = "preset:widget-display:session-start:v1";
export const SLOTS = {
    recap: { placement: "aboveEditor", order: 10 },
    trellis: { placement: "aboveEditor", order: 20 },
    agent_overview: { placement: "belowEditor", order: 10 },
} as const;
export type Slot = keyof typeof SLOTS;
export type WidgetComponent = Component & { dispose?(): void };
export type WidgetContent = readonly string[] | ((tui: TUI, theme: Theme) => WidgetComponent);
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
