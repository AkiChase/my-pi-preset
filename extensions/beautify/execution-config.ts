import type { Theme } from "@earendil-works/pi-coding-agent";
import { AGENT_CONFIG_FIELDS, copyAgentExecutionConfig, type AgentExecutionConfig } from "../runtime-tasks/execution-config.ts";
import { wrap } from "./layout.ts";

/** Pure display of an already verified, historical execution snapshot. */
export function executionConfigRows(value: AgentExecutionConfig, expanded: boolean, width: number, theme: Theme): string[] {
  const config = copyAgentExecutionConfig(value);
  if (!config) return [];
  const phase = config.phase === "resolved" ? "resolved · pending session confirmation" : "session-effective";
  const lines = expanded
    ? ["Execution config", `  phase: ${phase}`, ...AGENT_CONFIG_FIELDS.flatMap(field =>
      // Only core settings are always applicable; missing context/isolation on
      // resumed sessions is not evidence that those new-agent options applied.
      config[field] === undefined && !["model", "thinking", "mode"].includes(field) ? [] : [`  ${field}: ${config[field] ?? "unknown"}`]),
      ...(config.differences?.length ? ["Differences", ...config.differences.map(d =>
        `  ${d.field}: requested ${d.requested}, effective ${d.actual}${d.reason ? ` (${d.reason})` : ""}`)] : [])]
    : [`model: ${config.model ?? "unknown"} · thinking: ${config.thinking ?? "unknown"} · mode: ${config.mode ?? "unknown"}${config.phase === "resolved" ? " · pending session confirmation" : ""}`];
  return lines.flatMap(line => wrap(line, width).map(row => theme.fg("muted", row)));
}
