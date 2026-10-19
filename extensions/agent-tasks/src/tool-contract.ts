import { parseControlArguments } from "../../shared/tool-arguments.ts";
import { assertNonEmptyString } from "./spawn-input.ts";
import { THINKING_LEVELS } from "./invocation-config.ts";

export interface AgentToolCapabilities { nested: boolean; isolation: boolean }

export interface AgentToolParams {
  prompt: string; description?: string; subagent_type?: string; name?: string; model?: string;
  thinking?: typeof THINKING_LEVELS[number]; run_in_background?: boolean; resume?: string;
  isolated?: boolean; inherit_context?: boolean; isolation?: "off" | "worktree";
}
export function agentToolFields(capabilities: AgentToolCapabilities): string[] {
  return ["prompt", "description", "subagent_type", ...(capabilities.nested ? [] : ["name"]), "model", "thinking", "run_in_background", "resume", "isolated", "inherit_context",
    ...(capabilities.isolation ? ["isolation"] : [])];
}

/** Tool-only admission; internal manager/RPC option contracts remain separate. */
export function parseAgentToolArguments(value: unknown, capabilities: AgentToolCapabilities): AgentToolParams {
  const fields = agentToolFields(capabilities);
  const params = parseControlArguments(value, fields, fields.filter(field => field !== "prompt"));
  const resume = Object.hasOwn(params, "resume");
  if (resume) {
    try { assertNonEmptyString(params.resume, "`resume`"); }
    catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} Set resume to null for a new agent; to resume, provide a real agent_id. No agent was resumed.`);
    }
  }
  const allowed = resume
    ? ["prompt", "resume", ...(capabilities.nested ? [] : ["run_in_background"])]
    : ["prompt", "description", "subagent_type", ...(capabilities.nested ? [] : ["name"]), "model", "thinking", "run_in_background", "isolated", "inherit_context",
      ...(capabilities.isolation ? ["isolation"] : [])];
  assertFields(params, allowed);
  assertNonEmptyString(params.prompt, "`prompt`");
  if (!resume) {
    assertNonEmptyString(params.description, "`description`");
    assertNonEmptyString(params.subagent_type, "`subagent_type`");
  }
  for (const field of ["model", "name"]) if (Object.hasOwn(params, field)) assertNonEmptyString(params[field], `\`${field}\``);
  if (params.name !== undefined && !/^[A-Za-z0-9_-]+$/.test(String(params.name))) throw new Error("name accepts only letters, digits, '_' and '-'.");
  for (const field of ["run_in_background", "isolated", "inherit_context"]) {
    if (Object.hasOwn(params, field) && typeof params[field] !== "boolean") throw new Error(`${field} must be boolean.`);
  }
  if (Object.hasOwn(params, "thinking") && !THINKING_LEVELS.some(level => level === params.thinking)) throw new Error(`thinking must be one of ${THINKING_LEVELS.join(", ")}.`);
  if (Object.hasOwn(params, "isolation") && params.isolation !== "off" && params.isolation !== "worktree") throw new Error("isolation must be off or worktree.");
  return params as unknown as AgentToolParams;
}
export function assertAgentToolArguments(value: unknown, capabilities: AgentToolCapabilities): void {
  parseAgentToolArguments(value, capabilities);
}

export interface WorkflowToolParams { script?: string; scriptPath?: string; name?: string; args: unknown; resumeFromRunId?: string }
export function parseWorkflowToolArguments(value: unknown): WorkflowToolParams {
  const params = parseControlArguments(value, ["script", "scriptPath", "name", "args", "resumeFromRunId"], ["script", "scriptPath", "name", "resumeFromRunId"]);
  assertFields(params, ["script", "scriptPath", "name", "args", "resumeFromRunId"]);
  const sources = ["script", "scriptPath", "name"].filter(field => Object.hasOwn(params, field));
  for (const field of sources) assertNonEmptyString(params[field], `\`${field}\``);
  if (Object.hasOwn(params, "resumeFromRunId")) {
    assertNonEmptyString(params.resumeFromRunId, "`resumeFromRunId`");
    if (!/^wf_[a-z0-9-]{6,}$/.test(String(params.resumeFromRunId))) throw new Error("resumeFromRunId must be a workflow execution ID.");
  }
  if (sources.length > 1 || (sources.length === 0 && !Object.hasOwn(params, "resumeFromRunId"))) throw new Error("Provide exactly one non-null source among script, scriptPath or name for a new execution; replay may use null for all sources. Set unused source fields to null rather than filling them with empty strings.");
  return params as unknown as WorkflowToolParams;
}
export function assertWorkflowToolArguments(value: unknown): void {
  parseWorkflowToolArguments(value);
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
  if (invalid) throw new Error(`Field '${invalid}' is not accepted for this invocation. Accepted fields: ${allowed.join(", ")}.${Object.hasOwn(params, "resume") ? " Supplying a non-null resume selects resume mode. Set new-agent fields to null when resuming, or set resume to null to start a new agent. No agent was resumed." : " Set fields that do not apply to this invocation to null."}`);
}
