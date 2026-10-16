import { assertNonEmptyString } from "./spawn-input.ts";
import { THINKING_LEVELS } from "./invocation-config.ts";

export interface AgentToolCapabilities { nested: boolean; isolation: boolean; scheduling: boolean }

/** Tool-only admission; internal manager/RPC option contracts remain separate. */
export function assertAgentToolArguments(value: unknown, capabilities: AgentToolCapabilities): asserts value is Record<string, unknown> {
  const params = assertObject(value);
  const resume = Object.hasOwn(params, "resume");
  const allowed = resume
    ? ["prompt", "resume", ...(capabilities.nested ? [] : ["run_in_background"])]
    : ["prompt", "description", "subagent_type", "name", "model", "thinking", "run_in_background", "isolated", "inherit_context",
      ...(capabilities.isolation ? ["isolation"] : []), ...(capabilities.scheduling ? ["schedule"] : [])];
  assertFields(params, allowed);
  assertNonEmptyString(params.prompt, "`prompt`");
  if (resume) assertNonEmptyString(params.resume, "`resume`");
  else {
    assertNonEmptyString(params.description, "`description`");
    assertNonEmptyString(params.subagent_type, "`subagent_type`");
  }
  for (const field of ["model", "name", "schedule"]) if (Object.hasOwn(params, field)) assertNonEmptyString(params[field], `\`${field}\``);
  if (params.name !== undefined && !/^[A-Za-z0-9_-]+$/.test(String(params.name))) throw new Error("name accepts only letters, digits, '_' and '-'.");
  for (const field of ["run_in_background", "isolated", "inherit_context"]) {
    if (Object.hasOwn(params, field) && typeof params[field] !== "boolean") throw new Error(`${field} must be boolean.`);
  }
  if (Object.hasOwn(params, "thinking") && !THINKING_LEVELS.some(level => level === params.thinking)) throw new Error(`thinking must be one of ${THINKING_LEVELS.join(", ")}.`);
  if (Object.hasOwn(params, "isolation") && params.isolation !== "off" && params.isolation !== "worktree") throw new Error("isolation must be off or worktree.");
  if (Object.hasOwn(params, "schedule") && params.inherit_context === true) throw new Error("Cannot combine schedule with inherit_context.");
}

export function assertWorkflowToolArguments(value: unknown): asserts value is Record<string, unknown> {
  const params = assertObject(value);
  assertFields(params, ["script", "scriptPath", "name", "args", "resumeFromRunId"]);
  const sources = ["script", "scriptPath", "name"].filter(field => Object.hasOwn(params, field));
  if (sources.length > 1 || (sources.length === 0 && !Object.hasOwn(params, "resumeFromRunId"))) throw new Error("Provide exactly one of script, scriptPath or name; replay may omit the source.");
  for (const field of sources) assertNonEmptyString(params[field], `\`${field}\``);
  if (Object.hasOwn(params, "resumeFromRunId")) {
    assertNonEmptyString(params.resumeFromRunId, "`resumeFromRunId`");
    if (!/^wf_[a-z0-9-]{6,}$/.test(String(params.resumeFromRunId))) throw new Error("resumeFromRunId must be a workflow execution ID.");
  }
}

export function assertMessageToolArguments(value: unknown): asserts value is Record<string, unknown> {
  const params = assertObject(value);
  assertFields(params, ["agent_id", "message"]);
  assertNonEmptyString(params.agent_id, "`agent_id`");
  assertNonEmptyString(params.message, "`message`");
}

function assertObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  return value as Record<string, unknown>;
}
function assertFields(params: Record<string, unknown>, allowed: string[]): void {
  const invalid = Object.keys(params).find(field => !allowed.includes(field));
  if (invalid) throw new Error(`Field '${invalid}' is not accepted for this invocation. Accepted fields: ${allowed.join(", ")}.${Object.hasOwn(params, "resume") ? " No agent was resumed." : ""}`);
}
