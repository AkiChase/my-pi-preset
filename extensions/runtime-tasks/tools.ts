import { isAgentExecutionConfig, isMonitorExecutionConfig, type ExecutionConfig } from "./execution-config.ts";
import { argText, defaultableEnum, integerString, nullableEnum, parseControls, rejectInapplicable, requireValue, sentinelString, type ControlSpec } from "../shared/tool-arguments.ts";
import { createToolCallHeading } from "../beautify/tool-call-heading.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { createRuntimeTaskFacade, type RuntimeTaskCapability } from "./facade.ts";
import { TASK_ACTIONS, TASK_LOG_TYPES, isRuntimeTaskMetadata, type RuntimeTaskParams, type RuntimeTaskResult, type RuntimeTaskDetails } from "./contracts.ts";
import { executionId, parseExecutionId } from "./execution-id.ts";

export function isManagementDetails(value: unknown): value is ManagementDetails {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !("runtimeManagement" in value)) return false;
  const m = value.runtimeManagement;
  if (!m || typeof m !== "object" || Array.isArray(m)) return false;
  const v = m as Record<string, unknown>;
  const allowed = ["version", "group", "action", "task_id", "task_type", "execution_id", "kind", "agent_id", "title", "status", "raw_status", "error_code", "wait_outcome", "count", "range", "stats", "executionConfig"];
  if (Object.keys(v).some(k => !allowed.includes(k)) || v.version !== 2 || (v.group !== "process" && v.group !== "agent") || typeof v.action !== "string" || !Object.hasOwn(fields[v.group], v.action)) return false;
  if (v.group === "process" && ["execution_id", "kind", "agent_id"].some(k => v[k] !== undefined)) return false;
  if (v.group === "agent" && ["task_id", "task_type", "range"].some(k => v[k] !== undefined)) return false;
  for (const k of ["task_id", "agent_id", "title", "raw_status", "error_code"]) if (v[k] !== undefined && typeof v[k] !== "string") return false;
  if (v.group === "agent" && v.kind === "subagent" && v.execution_id !== undefined) return false;
  if (v.group === "agent" && v.kind === "workflow" && v.agent_id !== undefined) return false;
  if (v.group === "agent" && v.execution_id !== undefined && (v.kind !== "workflow" || !String(v.execution_id).startsWith("wf_"))) return false;
  if (v.execution_id !== undefined && !parseExecutionId(v.execution_id)) return false;
  if (v.task_type !== undefined && !TASK_LOG_TYPES.includes(v.task_type as "bash")) return false;
  if (v.kind !== undefined && v.kind !== "subagent" && v.kind !== "workflow") return false;
  if (v.wait_outcome !== undefined && (v.action !== "wait" || !["waiting", "completed", "released", "cancelled", "message"].includes(String(v.wait_outcome)))) return false;
  if (v.status !== undefined && !["starting", "queued", "running", "paused", "completed", "failed", "stopped"].includes(String(v.status))) return false;
  if (v.count !== undefined && (!Number.isSafeInteger(v.count) || Number(v.count) < 0)) return false;
  if (v.error_code === undefined && ["status", "output", "wait", "stop"].includes(v.action) && v[v.group === "process" ? "task_id" : "agent_id"] === undefined && v.execution_id === undefined) return false;
  if (v.range !== undefined) {
    if (v.group !== "process" || !["output", "wait"].includes(v.action) || !TASK_LOG_TYPES.includes(v.task_type as "bash")) return false;
    const r = v.range as Record<string, unknown>;
    if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length !== 5 || ["start", "end", "size", "omitted_before", "omitted_after"].some(k => !Number.isSafeInteger(r[k]) || Number(r[k]) < 0)) return false;
    if (Number(r.start) > Number(r.end) || Number(r.end) > Number(r.size) || r.omitted_before !== r.start || r.omitted_after !== Number(r.size) - Number(r.end)) return false;
  }
  if (v.executionConfig !== undefined && !(v.group === "process" ? typeof v.task_id === "string" && v.task_id.length > 0 && v.task_type === "monitor" && isMonitorExecutionConfig(v.executionConfig)
    : v.kind === "subagent" && v.execution_id === undefined && isAgentExecutionConfig(v.executionConfig))) return false;
  // The expanded process card now displays these keys: retain the same public
  // whitelist/count semantics as the backend envelope, not arbitrary numbers.
  if (v.stats !== undefined && !isRuntimeTaskMetadata({ version: 1, action: "stats", stats: v.stats })) return false;
  return true;
}

const processGuidance = `Process_manage usage:
  - bash runs finite commands; monitor observes ongoing event streams. Use process_manage to inspect, read, await, stop, or search their tasks. Use agent_manage for subagent/workflow executions.
  - Provide every exposed field as a string: action, task_id, task_type, offset, limit, pattern, case, context. Never JSON null. Fields the action does not use are "null"; "default" uses the default where the action uses that field. Numbers are decimal strings such as "0". Unknown fields are invalid.
  - Fields by action:
    list/stats: task_type (or "null" for all)
    status/stop: task_id
    output: task_id; offset ("null" for tail), limit ("default")
    wait: task_id; limit ("default")
    search: pattern; task_id/task_type ("null" for all), case/context ("default")
  - Copy task_id from launch/list. task_type filters only bash/monitor.
  - output reads a bounded tail page by default; offset "0" reads from the start. offset/limit count bytes; wait accepts limit for its final log page. Use returned ranges to continue reading. Search uses a regex, optional case-insensitivity, and context lines.
  - wait waits for the whole task; for monitor, observation must end, not merely emit an event. /task-detach or cancellation releases only the wait. stop requests execution cancellation; execution may still be draining afterward.
  - Successful terminal output/wait delivery reports the result and avoids a duplicate completion notification. list/status/search do not consume results. Completion is notified automatically; do not poll solely to detect completion.
  - Examples:
    Read log: {"action":"output","task_id":"<task_id>","task_type":"null","offset":"0","limit":"default","pattern":"null","case":"null","context":"null"}
    Await task: {"action":"wait","task_id":"<task_id>","task_type":"null","offset":"null","limit":"default","pattern":"null","case":"null","context":"null"}
    Search logs: {"action":"search","task_id":"null","task_type":"bash","offset":"null","limit":"null","pattern":"ERROR","case":"insensitive","context":"2"}
    Stop observation: {"action":"stop","task_id":"<monitor_task_id>","task_type":"null","offset":"null","limit":"null","pattern":"null","case":"null","context":"null"}`;
const agentGuidance = `Agent_manage usage:
  - Manage executions started by subagent_run or subagent_workflow, not process logs or Agent conversation control. Use process_manage for bash/monitor; subagent_message for messages; subagent_run for Agent resume; subagent_workflow for workflow replay.
  - Provide every exposed field as a string: action, agent_id, execution_id, kind, detail. Never JSON null. Fields the action does not use are "null"; "default" uses the default where the action uses that field. Unknown fields are invalid.
  - Fields by action:
    list: kind (or "null" for all); agent_id, execution_id and detail "null".
    status/stop: agent_id for a subagent or execution_id for a workflow, the other "null"; kind and detail "null".
    output/wait: agent_id or execution_id as above; detail "default", or "full" for subagents only; kind "null".
  - Copy the complete agent_id for subagents from launch/list. Workflow keeps its execution_id contract. Subagent execution identities are internal: do not construct or provide execution_id for a subagent.
  - Resuming an agent keeps its agent_id while replacing its internal execution; an admitted wait stays bound to the execution present at admission. Workflow replay creates a separate execution with a new ID.
  - output returns current output/progress or a final result; wait awaits the whole execution, but a subagent's attention message ends it early with wait_outcome "message" while the agent keeps running. detail "full" is only for subagent output/wait and requests additional conversation, not an unlimited trace.
  - /task-detach or cancellation releases a wait without stopping execution. stop requests cancellation; it may still be draining. Stopping a workflow also stops its owned agents, not independent siblings. Visible owned children cannot necessarily be managed directly by another owner.
  - Successful terminal output/wait delivery reports that execution's result and avoids duplicate completion notifications; list/status do not consume it. Completion is notified automatically; do not poll solely to detect completion.
  - Examples:
    List workflows: {"action":"list","agent_id":"null","execution_id":"null","kind":"workflow","detail":"null"}
    Read subagent result: {"action":"output","agent_id":"<agent_id>","execution_id":"null","kind":"null","detail":"default"}
    Await execution: {"action":"wait","agent_id":"null","execution_id":"<execution_id>","kind":"null","detail":"default"}
    Stop execution: {"action":"stop","agent_id":"null","execution_id":"<execution_id>","kind":"null","detail":"null"}`;

export interface ManagementParams {
  action: RuntimeTaskParams["action"]; task_id?: string; task_type?: "bash" | "monitor";
  agent_id?: string; execution_id?: string; kind?: "subagent" | "workflow";
  offset?: number; limit?: number; pattern?: string; ignore_case?: boolean; context?: number; verbose?: boolean;
}
export type ManagementGroup = "process" | "agent";
export interface ManagementDetails { runtimeManagement: { version: 2; group: ManagementGroup; action: string;
  task_id?: string; task_type?: string; execution_id?: string; kind?: string; agent_id?: string;
  title?: string; status?: string; raw_status?: string; error_code?: string; wait_outcome?: string;
  executionConfig?: ExecutionConfig;
  count?: number; range?: RuntimeTaskDetails["runtimeTask"]["range"]; stats?: Readonly<Record<string, number>> } }
type FieldRule = "required" | "optional";
/** Fields each action uses; every other control does not apply and accepts only "null". */
const fields: Record<ManagementGroup, Record<string, Record<string, FieldRule>>> = {
  process: {
    list: { task_type: "optional" }, stats: { task_type: "optional" },
    status: { task_id: "required" }, stop: { task_id: "required" },
    output: { task_id: "required", offset: "optional", limit: "optional" }, wait: { task_id: "required", limit: "optional" },
    search: { pattern: "required", task_id: "optional", task_type: "optional", case: "optional", context: "optional" },
  },
  agent: {
    list: { kind: "optional" }, status: { target: "required" }, stop: { target: "required" },
    output: { target: "required", detail: "optional" }, wait: { target: "required", detail: "optional" },
  },
};
const CONTROLS: Record<ManagementGroup, Record<string, ControlSpec>> = {
  process: {
    task_id: { kind: "nullable" }, task_type: { kind: "nullable" }, offset: { kind: "nullable", integer: { min: 0 } },
    limit: { kind: "defaultable", integer: { min: 1 } }, pattern: { kind: "nullable" }, case: { kind: "defaultable" },
    context: { kind: "defaultable", integer: { min: 0 } },
  },
  agent: { agent_id: { kind: "nullable" }, execution_id: { kind: "nullable" }, kind: { kind: "nullable" }, detail: { kind: "defaultable" } },
};
const AGENT_ACTIONS = ["list", "status", "output", "wait", "stop"] as const;
const ACTIONS: Record<ManagementGroup, readonly string[]> = { process: TASK_ACTIONS, agent: AGENT_ACTIONS };
const CASE_MODES = ["sensitive", "insensitive"] as const;
const DETAIL_LEVELS = ["summary", "full"] as const;

function parseManagement(group: ManagementGroup, value: unknown): ManagementParams {
  const controls = CONTROLS[group];
  const parsed = parseControls(value, ["action", ...Object.keys(controls)], controls);
  const v = parsed.values;
  const action = v.action;
  if (typeof action !== "string" || !ACTIONS[group].includes(action)) throw new Error(`Unsupported ${group} management action; use one of ${ACTIONS[group].join(", ")}.`);
  const rules = fields[group][action]!;
  const context = `to ${action}`;
  const applies = (field: string) => Object.hasOwn(rules, field) || (group === "agent" && (field === "agent_id" || field === "execution_id") && Object.hasOwn(rules, "target"));
  rejectInapplicable(parsed, Object.keys(controls).filter(field => !applies(field)), context);
  const nonEmpty = (field: string) => {
    if (v[field] !== undefined && (typeof v[field] !== "string" || !(v[field] as string).trim())) throw new Error(`\`${field}\` must be a non-empty string or "null".`);
  };
  const params: ManagementParams = { action: action as ManagementParams["action"] };
  if (group === "process") {
    nonEmpty("task_id");
    // A regex is not trimmed: whitespace-only patterns are legitimate searches.
    if (v.pattern !== undefined && (typeof v.pattern !== "string" || !v.pattern.length)) throw new Error("`pattern` must be a non-empty regex or \"null\".");
    for (const [field, rule] of Object.entries(rules)) if (rule === "required") requireValue(parsed, field, context);
    if (v.task_type !== undefined && !TASK_LOG_TYPES.includes(v.task_type as "bash")) throw new Error("`task_type` must be \"bash\", \"monitor\" or \"null\".");
    if (v.case !== undefined && !CASE_MODES.includes(v.case as "sensitive")) throw new Error("`case` must be \"sensitive\", \"insensitive\" or \"default\".");
    if (v.task_id !== undefined) params.task_id = v.task_id as string;
    if (v.task_type !== undefined) params.task_type = v.task_type as "bash" | "monitor";
    if (v.offset !== undefined) params.offset = v.offset as number;
    if (v.limit !== undefined) params.limit = v.limit as number;
    if (v.pattern !== undefined) params.pattern = v.pattern as string;
    if (v.case !== undefined) params.ignore_case = v.case === "insensitive";
    if (v.context !== undefined) params.context = v.context as number;
    return params;
  }
  for (const field of ["agent_id", "execution_id"]) nonEmpty(field);
  if (Object.hasOwn(rules, "target")) {
    const targets = ["agent_id", "execution_id"].filter(field => v[field] !== undefined);
    if (targets.length !== 1) throw new Error(`${action} requires exactly one of agent_id (subagent) or execution_id (workflow); set the other to "null".`);
  }
  if (v.execution_id !== undefined && (!parseExecutionId(v.execution_id) || !String(v.execution_id).startsWith("wf_"))) {
    throw new Error("Invalid execution_id; workflows require a wf_ execution_id from launch/list. Subagents require agent_id.");
  }
  if (v.kind !== undefined && !["subagent", "workflow"].includes(String(v.kind))) throw new Error("`kind` must be \"subagent\", \"workflow\" or \"null\".");
  if (v.detail !== undefined && !DETAIL_LEVELS.includes(v.detail as "full")) throw new Error("`detail` must be \"summary\", \"full\" or \"default\".");
  if (v.detail === "full" && v.execution_id !== undefined) throw new Error("`detail` \"full\" applies only to subagents; use \"default\" for workflows.");
  if (v.agent_id !== undefined) params.agent_id = v.agent_id as string;
  if (v.execution_id !== undefined) params.execution_id = v.execution_id as string;
  if (v.kind !== undefined) params.kind = v.kind as "subagent" | "workflow";
  // "summary" equals the default; workflows have no detail option downstream, so only subagents carry it.
  if (v.detail !== undefined && v.agent_id !== undefined) params.verbose = v.detail === "full";
  return params;
}
export function parseProcessManagementParams(value: unknown): ManagementParams { return parseManagement("process", value); }
export function parseAgentManagementParams(value: unknown): ManagementParams { return parseManagement("agent", value); }
export function validateManagementParams(group: ManagementGroup, value: unknown): string | undefined {
  try { parseManagement(group, value); return undefined; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}
function project(group: ManagementGroup, result: RuntimeTaskResult) {
  const m = result.details.runtimeTask;
  const { version: _version, task_id, run_id, task_type, ...rest } = m;
  const identity = task_id && run_id && task_type === "workflow"
    ? { execution_id: executionId({ taskId: task_id, runId: run_id }, task_type), kind: task_type }
    : task_id && task_type === "subagent"
      ? { agent_id: task_id, kind: task_type }
      : group === "agent" ? { ...(task_type ? { kind: task_type } : {}) }
    : { ...(task_id ? { task_id } : {}), ...(task_type ? { task_type } : {}) };
  return { ...result, details: { runtimeManagement: { version: 2 as const, group, ...rest, ...identity } } };
}
export function managementTool(group: ManagementGroup, capabilities: readonly RuntimeTaskCapability[], report = (_id: string, r: RuntimeTaskResult) => r) {
  const selected = capabilities.map(cap => ({ ...cap, list: () => cap.list().filter(e => group === "process" ? e.view.kind === "shell" || e.view.kind === "monitor" : e.view.kind === "agent" || e.view.kind === "workflow") }));
  const facade = createRuntimeTaskFacade(selected);
  const name = group === "process" ? "process_manage" : "agent_manage";
  const parameters = group === "process" ? Type.Object({
    action: StringEnum(TASK_ACTIONS),
    task_id: sentinelString('Task identity from bash/monitor launch or list; "null" when the action does not use it.'),
    task_type: nullableEnum(TASK_LOG_TYPES, 'Filter list/stats/search to "bash" or "monitor"; "null" for no filter or other actions.'),
    offset: integerString(["null"], 'Output log byte offset as a decimal string; "0" reads from the start; "null" reads the tail, and is required for other actions.'),
    limit: integerString(["default"], 'Output/wait log byte budget as a positive decimal string; "default" uses the configured budget; "null" for other actions.'),
    pattern: sentinelString('Non-empty search regex; "null" for other actions.'),
    case: defaultableEnum(CASE_MODES, 'Search case: "sensitive" or "insensitive"; "default" is sensitive; "null" for other actions.'),
    context: integerString(["default"], 'Search context lines as a decimal string; "default" is 0; "null" for other actions.'),
  }, { additionalProperties: false }) : Type.Object({
    action: StringEnum(AGENT_ACTIONS),
    agent_id: sentinelString('Complete persistent subagent identity from launch/list; "null" for workflows or when the action does not use it.'),
    execution_id: sentinelString('Workflow execution handle from launch/list; "null" for subagents or when the action does not use it.'),
    kind: nullableEnum(["subagent", "workflow"] as const, 'List filter; "null" for no filter or other actions.'),
    detail: defaultableEnum(DETAIL_LEVELS, 'Subagent output/wait detail: "full" adds conversation; "default" is "summary". Workflows use "default"; "null" for other actions.'),
  }, { additionalProperties: false });
  let closed = false;
  const close = () => { closed = true; facade.close(); };
  const execute = async (id: string, input: unknown, signal: AbortSignal | undefined, update: AgentToolUpdateCallback<ManagementDetails> | undefined, ctx: ExtensionContext) => {
    let params: ManagementParams = input as ManagementParams;
    let error: string | undefined;
    try { params = group === "agent" ? parseAgentManagementParams(input) : parseProcessManagementParams(input); }
    catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    const fail = (text: string, code = "invalid_arguments") => ({ content: [{ type: "text" as const, text }], details: { runtimeManagement: { version: 2 as const, group, action: String(params?.action ?? "status"), error_code: code } }, isError: true });
    if (closed) return fail("Management activation is closed.", "closed");
    if (error) return fail(error);
    const { agent_id, execution_id, kind, ...base } = params;
    const identity = execution_id ? parseExecutionId(execution_id) : undefined;
    if (execution_id && (!identity || !execution_id.startsWith("wf_"))) return fail("Invalid execution_id; workflows require a wf_ execution_id from launch/list. Subagents require agent_id.");
    if (identity && identity.taskId.startsWith("wf_") !== execution_id!.startsWith("wf_")) return fail("Execution handle kind does not match its target.");
    if (agent_id && execution_id) return fail("Provide agent_id for a subagent or execution_id for a workflow, not both.");
    if (agent_id && kind === "workflow") return fail("agent_id addresses subagents; workflows require execution_id.");
    const executionView = identity ? selected.flatMap(c => c.list()).map(entry => entry.view).find(view => view.taskId === identity.taskId && view.runId === identity.runId) : undefined;
    if (identity && !executionView) return fail("Execution is stale or not available in this scope.", "stale");
    if (executionView && executionView.kind !== "workflow") return fail("Subagents require agent_id; execution_id is reserved for workflows.");
    const agentView = agent_id ? selected.flatMap(c => c.list()).map(e => e.view).find(view => view.kind === "agent" && view.taskId === agent_id) : undefined;
    if (agent_id && !agentView) return fail("Subagent agent_id is not available in this scope.", "stale");
    const internal: RuntimeTaskParams = { ...base,
      ...(identity ? { task_id: identity.taskId, run_id: identity.runId } : agentView ? { task_id: agentView.taskId, run_id: agentView.runId } : {}),
      ...(kind ? { task_type: kind } : {}),
    };
    return project(group, report(id, await facade.execute(internal, signal, update ? r => update(project(group, r)) : undefined, ctx)));
  };
  const renderCall = (value: unknown, theme: import("@earendil-works/pi-coding-agent").Theme, context: { expanded: boolean }) => {
    const args = value && typeof value === "object" ? value as Partial<ManagementParams> : {};
    const id = argText(args.task_id) ?? argText(args.agent_id) ?? argText(args.execution_id);
    return createToolCallHeading({ name, detail: `${args.action ?? ""}${id ? ` ${id}` : ""}`, theme, context });
  };
  return { tool: { name, label: name, renderCall, description: group === "process" ? "Manage bash and monitor tasks and their logs." : "Manage subagent and agent-workflow executions, not conversation control.", promptSnippet: group === "process" ? "Manage command and observation tasks" : "Inspect, read, await, or stop delegated executions", promptGuidelines: [group === "process" ? processGuidance : agentGuidance], parameters, execute }, close };
}
export function registerManagementTool(pi: ExtensionAPI, group: ManagementGroup, capabilities: readonly RuntimeTaskCapability[], report?: (id: string, r: RuntimeTaskResult) => RuntimeTaskResult) {
  const registered = managementTool(group, capabilities, report);
  pi.registerTool(registered.tool); return registered;
}
