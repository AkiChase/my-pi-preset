import { copyAgentExecutionConfig, type AgentExecutionConfig, type AgentExecutionDifference } from "../../runtime-tasks/execution-config.ts";
import type { AgentInvocation } from "./types.ts";

/** Invocation owners retained only genuinely overridden explicit requests. */
export function resolvedExecutionConfig(invocation: AgentInvocation, phase: AgentExecutionConfig["phase"] = "resolved"): AgentExecutionConfig {
  const config: AgentExecutionConfig = {
    kind: "agent", phase,
    ...(invocation.modelId ? { model: invocation.modelId } : {}),
    ...(invocation.thinking !== undefined ? { thinking: invocation.thinking } : {}),
    ...(invocation.runInBackground !== undefined ? { mode: invocation.runInBackground ? "background" : "foreground" } : {}),
    ...(invocation.inheritContext !== undefined ? { inherit_context: invocation.inheritContext } : {}),
    ...(invocation.isolated !== undefined ? { isolated: invocation.isolated } : {}),
    ...(invocation.isolation !== undefined ? { isolation: invocation.isolation } : {}),
  };
  const differences: AgentExecutionDifference[] = [];
  for (const [field, requested] of [
    ["model", invocation.requestedModel], ["thinking", invocation.requestedThinking],
    ["mode", invocation.requestedRunInBackground === undefined ? undefined : invocation.requestedRunInBackground ? "background" : "foreground"],
    ["inherit_context", invocation.requestedInheritContext], ["isolated", invocation.requestedIsolated], ["isolation", invocation.requestedIsolation],
  ] as const) {
    const actual = config[field];
    if (requested !== undefined && actual !== undefined && requested !== actual) differences.push({ field, requested, actual, reason: field === "isolation" ? invocation.isolationDifferenceReason ?? "agent-configuration" : "agent-configuration" });
  }
  return copyAgentExecutionConfig({ ...config, ...(differences.length ? { differences } : {}) })!;
}

/** Session reports replace predictions, never guessed defaults or provenance. */
export function sessionExecutionConfig(previous: AgentExecutionConfig | undefined, session: { model?: { provider: string; id: string }; thinkingLevel?: string }, resume = false, requested: { model?: string; thinking?: AgentExecutionConfig["thinking"] } = {}): AgentExecutionConfig {
  const model = session.model ? `${session.model.provider}/${session.model.id}` : undefined;
  const thinking = session.thinkingLevel as AgentExecutionConfig["thinking"];
  const config = { ...previous, kind: "agent" as const, phase: "session-effective" as const, model, thinking };
  const differences: AgentExecutionDifference[] = [];
  if (!resume) {
    for (const d of previous?.differences ?? []) {
      const actual = config[d.field];
      if (actual !== undefined && d.requested !== actual) differences.push({ ...d, actual, reason: d.actual === actual ? d.reason : undefined });
    }
    for (const field of ["model", "thinking"] as const) {
      const requestedValue = requested[field], actual = config[field];
      if (requestedValue !== undefined && actual !== undefined && requestedValue !== actual && !previous?.differences?.some(d => d.field === field)) {
        differences.push({ field, requested: requestedValue, actual, reason: "session-adjustment" });
      }
    }
  }
  return copyAgentExecutionConfig({ ...config, differences: differences.length ? differences : undefined })!;
}
