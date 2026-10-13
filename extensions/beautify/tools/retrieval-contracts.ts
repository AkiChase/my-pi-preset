import type { Args, RenderContext, Result } from "../types.ts";
import type { Metadata } from "./shared.ts";

export type RetrievalContract = (args: Args, result: Result | undefined, ctx: RenderContext) => Metadata | undefined;
export function validArgs(raw: unknown, fields: Record<string, "string" | "boolean" | "number">, required: string[]): raw is Args {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const args = raw as Args;
  return required.every(key => typeof args[key] === fields[key] && args[key] !== "") && Object.entries(args).every(([key, value]) =>
    Object.hasOwn(fields, key) && (value === undefined || (typeof value === fields[key] && (typeof value !== "number" || Number.isFinite(value)))));
}
export function envelope(result: Result): string | undefined {
  if (!result || result.details !== undefined || !Array.isArray(result.content) || result.content.length !== 1) return undefined;
  const block = result.content[0];
  return block?.type === "text" && typeof block.text === "string" ? block.text : undefined;
}
export const jobStatus = "(?:pending|running|completed|failed|killed)";
export const duration = "\\d+(?:m\\d+)?s";
export function safeCount(value: string): boolean { return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)); }
