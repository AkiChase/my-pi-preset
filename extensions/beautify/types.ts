import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
export type Args = Record<string, unknown>;
export type RenderContext = Parameters<NonNullable<ToolRenderers["renderResult"]>>[3] & { args: Args };
export interface Result { content: readonly { type: string; text?: string }[]; details?: unknown }
export interface View { body: string; notice: string[]; lines: string[] }
export interface Drawing extends Component { update(result: Result, theme: Theme, context: RenderContext): void }
export function text(result: Result): string { return result.content.filter(block => block.type === "text").map(block => block.text ?? "").join("\n"); }
