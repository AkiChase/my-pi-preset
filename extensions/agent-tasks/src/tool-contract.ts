import { parseControls, rejectInapplicable, requireValue, type ControlSpec } from "../../shared/tool-arguments.ts";
import { assertNonEmptyString } from "./spawn-input.ts";
import { CONTEXT_MODES, EXECUTION_MODES, THINKING_LEVELS, TOOL_SCOPES } from "./invocation-config.ts";

export interface AgentToolCapabilities { nested: boolean; isolation: boolean }

/** Internal parameters produced by the model tool parser; manager/RPC contracts keep these names. */
export interface AgentToolParams {
  prompt: string; description?: string; subagent_type?: string; model?: string;
  thinking?: typeof THINKING_LEVELS[number]; run_in_background?: boolean; resume?: string;
  isolated?: boolean; inherit_context?: boolean; isolation?: "off" | "worktree";
}

const NULLABLE: ControlSpec = { kind: "nullable" };
const DEFAULTABLE: ControlSpec = { kind: "defaultable" };
const AGENT_CONTROLS: Record<string, ControlSpec> = {
  description: NULLABLE, subagent_type: NULLABLE, resume: NULLABLE,
  model: DEFAULTABLE, thinking: DEFAULTABLE, execution: DEFAULTABLE, tools: DEFAULTABLE, context: DEFAULTABLE, isolation: DEFAULTABLE,
};

/** Model-facing subagent_run fields, in schema order. */
export function agentToolFields(capabilities: AgentToolCapabilities): string[] {
  return ["prompt", "description", "subagent_type", "model", "thinking", "execution", "resume", "tools", "context",
    ...(capabilities.isolation ? ["isolation"] : [])];
}

function assertEnum(value: unknown, values: readonly string[], field: string): void {
  if (value !== undefined && !values.includes(value as string)) {
    throw new Error(`\`${field}\` must be one of ${values.map(v => `"${v}"`).join(", ")} or "default".`);
  }
}

/** Tool-only admission; internal manager/RPC option contracts remain separate. */
export function parseAgentToolArguments(value: unknown, capabilities: AgentToolCapabilities): AgentToolParams {
  const fields = agentToolFields(capabilities);
  const parsed = parseControls(value, fields, AGENT_CONTROLS);
  const v = parsed.values;
  const resume = Object.hasOwn(v, "resume");
  if (resume) {
    try { assertNonEmptyString(v.resume, "`resume`"); }
    catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} Set resume to "null" for a new agent; to resume, provide a real agent_id. No agent was resumed.`);
    }
    const inapplicable = ["description", "subagent_type", "model", "thinking", "tools", "context",
      ...(capabilities.isolation ? ["isolation"] : []), ...(capabilities.nested ? ["execution"] : [])];
    try { rejectInapplicable(parsed, inapplicable, "when resuming"); }
    catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} A resume value other than "null" selects resume mode; set resume to "null" to start a new agent. No agent was resumed.`);
    }
  } else {
    assertNonEmptyString(requireValue(parsed, "description", "for a new agent"), "`description`");
    assertNonEmptyString(requireValue(parsed, "subagent_type", "for a new agent"), "`subagent_type`");
  }
  assertNonEmptyString(v.prompt, "`prompt`");
  if (Object.hasOwn(v, "model")) assertNonEmptyString(v.model, "`model`");
  assertEnum(v.thinking, THINKING_LEVELS, "thinking");
  assertEnum(v.execution, EXECUTION_MODES, "execution");
  assertEnum(v.tools, TOOL_SCOPES, "tools");
  assertEnum(v.context, CONTEXT_MODES, "context");
  assertEnum(v.isolation, ["off", "worktree"], "isolation");
  const params: AgentToolParams = { prompt: v.prompt as string };
  if (v.description !== undefined) params.description = v.description as string;
  if (v.subagent_type !== undefined) params.subagent_type = v.subagent_type as string;
  if (v.model !== undefined) params.model = v.model as string;
  if (v.thinking !== undefined) params.thinking = v.thinking as AgentToolParams["thinking"];
  if (v.execution !== undefined) params.run_in_background = v.execution === "background";
  if (v.resume !== undefined) params.resume = v.resume as string;
  if (v.tools !== undefined) params.isolated = v.tools === "builtin";
  if (v.context !== undefined) params.inherit_context = v.context === "inherit";
  if (v.isolation !== undefined) params.isolation = v.isolation as "off" | "worktree";
  return params;
}
export function assertAgentToolArguments(value: unknown, capabilities: AgentToolCapabilities): void {
  parseAgentToolArguments(value, capabilities);
}

export interface WorkflowToolParams { script?: string; scriptPath?: string; name?: string; args: unknown; resumeFromRunId?: string }
export function parseWorkflowToolArguments(value: unknown): WorkflowToolParams {
  const { values } = parseControls(value, ["script", "scriptPath", "name", "args", "resumeFromRunId"],
    { script: NULLABLE, scriptPath: NULLABLE, name: NULLABLE, resumeFromRunId: NULLABLE });
  const sources = ["script", "scriptPath", "name"].filter(field => Object.hasOwn(values, field));
  for (const field of sources) assertNonEmptyString(values[field], `\`${field}\``);
  if (Object.hasOwn(values, "resumeFromRunId")) {
    assertNonEmptyString(values.resumeFromRunId, "`resumeFromRunId`");
    if (!/^wf_[a-z0-9-]{6,}$/.test(String(values.resumeFromRunId))) throw new Error("`resumeFromRunId` must be a workflow execution ID, or \"null\" for a new execution.");
  }
  if (sources.length > 1 || (sources.length === 0 && !Object.hasOwn(values, "resumeFromRunId"))) {
    throw new Error("Provide exactly one source among script, scriptPath or name for a new execution and set the others to \"null\"; replay may set all sources to \"null\".");
  }
  return values as unknown as WorkflowToolParams;
}
export function assertWorkflowToolArguments(value: unknown): void {
  parseWorkflowToolArguments(value);
}

export function assertMessageToolArguments(value: unknown): asserts value is Record<string, unknown> {
  const { values } = parseControls(value, ["agent_id", "message"], {});
  assertNonEmptyString(values.agent_id, "`agent_id`");
  assertNonEmptyString(values.message, "`message`");
}

/** Internal reply modes; the model-facing `reply` field adds "skip" for plain guidance. */
export const MESSAGE_REPLY_MODES = ["wait", "notify"] as const;
export const MESSAGE_REPLY_CHOICES = ["skip", ...MESSAGE_REPLY_MODES] as const;
export type MessageReplyMode = typeof MESSAGE_REPLY_MODES[number];
export interface MessageToolParams { agent_id: string; message: string; reply?: MessageReplyMode }

/** subagent_message; reply "skip" keeps plain steering. */
export function parseMessageToolArguments(value: unknown): MessageToolParams {
  const { values } = parseControls(value, ["agent_id", "message", "reply"], {});
  assertNonEmptyString(values.agent_id, "`agent_id`");
  assertNonEmptyString(values.message, "`message`");
  if (!MESSAGE_REPLY_CHOICES.some(mode => mode === values.reply)) {
    throw new Error("`reply` must be \"skip\", \"wait\" or \"notify\".");
  }
  const params: MessageToolParams = { agent_id: values.agent_id, message: values.message };
  if (values.reply !== "skip") params.reply = values.reply as MessageReplyMode;
  return params;
}
