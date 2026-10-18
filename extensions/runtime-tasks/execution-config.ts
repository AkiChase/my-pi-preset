/** Minimal public execution display data, never an invocation/settings object. */
export const AGENT_CONFIG_FIELDS = ["model", "thinking", "mode", "inherit_context", "isolated", "isolation"] as const;
export type AgentConfigField = typeof AGENT_CONFIG_FIELDS[number];
export type ExecutionConfigValue = string | boolean;
export interface AgentExecutionDifference {
  readonly field: AgentConfigField;
  readonly requested: ExecutionConfigValue;
  readonly actual: ExecutionConfigValue;
  readonly reason?: "agent-configuration" | "session-adjustment" | "worktree-disabled";
}
export interface AgentExecutionConfig {
  readonly kind: "agent";
  readonly phase: "resolved" | "session-effective";
  readonly model?: string;
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  readonly mode?: "foreground" | "background";
  readonly inherit_context?: boolean;
  readonly isolated?: boolean;
  readonly isolation?: "off" | "worktree";
  readonly differences?: readonly AgentExecutionDifference[];
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\x00-\x1f\x7f]/.test(v);
function fieldValue(field: AgentConfigField, value: unknown): boolean {
  switch (field) {
    case "model": return text(value);
    case "thinking": return typeof value === "string" && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value);
    case "mode": return value === "foreground" || value === "background";
    case "inherit_context": case "isolated": return typeof value === "boolean";
    case "isolation": return value === "off" || value === "worktree";
  }
}
export function isAgentExecutionConfig(value: unknown): value is AgentExecutionConfig {
  if (!object(value) || value.kind !== "agent" || (value.phase !== "resolved" && value.phase !== "session-effective") ||
    Object.keys(value).some(k => !["kind", "phase", "differences", ...AGENT_CONFIG_FIELDS].includes(k))) return false;
  for (const field of AGENT_CONFIG_FIELDS) if (value[field] !== undefined && !fieldValue(field, value[field])) return false;
  if (value.differences !== undefined) {
    if (!Array.isArray(value.differences) || value.differences.length > AGENT_CONFIG_FIELDS.length) return false;
    const seen = new Set<string>();
    for (const d of value.differences) {
      if (!object(d) || Object.keys(d).some(k => !["field", "requested", "actual", "reason"].includes(k)) ||
        !AGENT_CONFIG_FIELDS.includes(d.field as AgentConfigField) || seen.has(String(d.field))) return false;
      const field = d.field as AgentConfigField;
      if (!fieldValue(field, d.requested) || !fieldValue(field, d.actual) || d.requested === d.actual || d.actual !== value[field]) return false;
      if (d.reason !== undefined && (typeof d.reason !== "string" || !["agent-configuration", "session-adjustment", "worktree-disabled"].includes(d.reason))) return false;
      seen.add(field);
    }
  }
  return true;
}
/** Copy at every public boundary so later owner updates cannot rewrite history. */
export function copyAgentExecutionConfig(value: unknown): AgentExecutionConfig | undefined {
  if (!isAgentExecutionConfig(value)) return undefined;
  return Object.freeze({ ...value, ...(value.differences ? { differences: Object.freeze(value.differences.map(d => Object.freeze({ ...d }))) } : {}) });
}
export function agentExecutionSummary(value: unknown): string {
  const config = copyAgentExecutionConfig(value);
  if (!config) return "";
  const fields = (["model", "thinking", "mode"] as const).flatMap(k => config[k] === undefined ? [] : [`${k}=${config[k]}`]);
  const differences = config.differences?.map(d => `${d.field} requested ${JSON.stringify(d.requested)}, effective ${JSON.stringify(d.actual)}${d.reason ? ` (${d.reason})` : ""}`) ?? [];
  return `Execution config${config.phase === "resolved" ? " (pending session confirmation)" : " (session-effective)"}: ${fields.join(", ") || "settings unknown"}.${differences.length ? ` Differences: ${differences.join("; ")}.` : ""}\n`;
}
