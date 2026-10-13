/** Non-overview formatting/activity contracts shared by tools, notifications and inspectors. */
import { getConfig } from "./agent-types.ts";
import type { AgentInvocation, SubagentType } from "./types.ts";
import type { SessionLike } from "./usage.ts";
export type Theme = { fg(color: string, text: string): string; bold(text: string): string };
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const ERROR_STATUSES = new Set(["error", "aborted", "steered", "stopped"]);
export interface AgentActivity {
  activeTools: Map<string, string>; toolUses: number; responseText: string; session?: SessionLike; turnCount: number; maxTurns?: number;
}
export interface AgentDetails {
  displayName: string; description: string; subagentType: string; toolUses: number; tokens: string; durationMs: number;
  status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error" | "background";
  activity?: string; spinnerFrame?: number; modelName?: string; tags?: string[]; turnCount?: number; maxTurns?: number;
  cost?: number; agentId?: string; error?: string;
}
export function fgPreservingNestedStyles(theme: Theme, color: string, text: string): string {
  const styleStart = theme.fg(color, "").replace(/\u001b\[(?:0|39)m/g, "");
  return theme.fg(color, text.replace(/\u001b\[(?:0|39)m/g, reset => `${reset}${styleStart}`));
}
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
  return `${count} token`;
}
export function formatCost(cost: number): string {
  if (!(cost > 0)) return "";
  if (cost < 0.0001) return "<$0.0001";
  if (cost >= 1) return `~$${cost.toFixed(2)}`;
  const rounded = Number(cost.toFixed(4));
  return `~$${rounded.toFixed(Math.max(2, (String(rounded).split(".")[1] ?? "").length))}`;
}
export function formatSessionTokens(tokens: number, percent: number | null, theme: Theme, compactions = 0): string {
  const annotations: string[] = [];
  if (percent !== null) annotations.push(theme.fg(percent >= 85 ? "error" : percent >= 70 ? "warning" : "dim", `${Math.round(percent)}%`));
  if (compactions > 0) annotations.push(theme.fg("dim", `⇊${compactions}`));
  return formatTokens(tokens) + (annotations.length ? ` (${annotations.join(" · ")})` : "");
}
export function formatTurns(turnCount: number, maxTurns?: number | null): string { return maxTurns != null ? `↻${turnCount}≤${maxTurns}` : `↻${turnCount}`; }
export function formatMs(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }
export function formatDuration(startedAt: number, completedAt?: number): string { return completedAt ? formatMs(completedAt - startedAt) : `${formatMs(Date.now() - startedAt)} (running)`; }
export function getDisplayName(type: SubagentType): string { return getConfig(type).displayName; }
export function getPromptModeLabel(type: SubagentType): string | undefined { return getConfig(type).promptMode === "append" ? "twin" : undefined; }
export function buildInvocationTags(invocation: AgentInvocation | undefined): { modelName?: string; modelId?: string; tags: string[] } {
  const tags: string[] = [];
  if (!invocation) return { tags };
  const asked = (value: string | undefined, requested: string | undefined) => value && requested && requested !== value ? `${value} (asked ${requested})` : value;
  const thinking = asked(invocation.thinking, invocation.requestedThinking);
  if (thinking) tags.push(`thinking: ${thinking}`);
  if (invocation.isolated) tags.push("isolated");
  if (invocation.isolation === "worktree") tags.push("worktree");
  if (invocation.inheritContext) tags.push("inherit context");
  if (invocation.runInBackground) tags.push("background");
  if (invocation.maxTurns != null) tags.push(`max turns: ${invocation.maxTurns}`);
  return { modelName: asked(invocation.modelName, invocation.requestedModel), modelId: asked(invocation.modelId, invocation.requestedModel), tags };
}
const TOOL_DISPLAY: Record<string, string> = { read: "reading", bash: "running command", edit: "editing", write: "writing", grep: "searching", find: "finding files", ls: "listing" };
export function describeActivity(activeTools: Map<string, string>, responseText?: string): string {
  if (activeTools.size) {
    const groups = new Map<string, number>();
    for (const name of activeTools.values()) { const action = TOOL_DISPLAY[name] ?? name; groups.set(action, (groups.get(action) ?? 0) + 1); }
    return [...groups].map(([action, count]) => count > 1 ? `${action} ${count} ${action === "searching" ? "patterns" : "files"}` : action).join(", ") + "…";
  }
  if (responseText?.trim()) { const line = responseText.split("\n").find(line => line.trim())?.trim() ?? ""; return line.length > 60 ? line.slice(0, 60) + "…" : line; }
  return "thinking…";
}
