import { nullableControl, parseControlArguments } from "../shared/tool-arguments.ts";
import { createToolCallHeading } from "../beautify/tool-call-heading.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { Type, StringEnum } from "@earendil-works/pi-ai";
import { createRuntimeTaskFacade, type RuntimeTaskCapability } from "./facade.ts";
import { TASK_ACTIONS, TASK_LOG_TYPES, type RuntimeTaskParams, type RuntimeTaskResult, type RuntimeTaskDetails } from "./contracts.ts";
import { executionId, parseExecutionId } from "./execution-id.ts";

export function isManagementDetails(value: unknown): value is ManagementDetails {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !("runtimeManagement" in value)) return false;
  const m = value.runtimeManagement;
  if (!m || typeof m !== "object" || Array.isArray(m)) return false;
  const v = m as Record<string, unknown>;
  const allowed = ["version", "group", "action", "task_id", "task_type", "execution_id", "kind", "agent_id", "title", "status", "raw_status", "error_code", "wait_outcome", "count", "range", "stats"];
  if (Object.keys(v).some(k => !allowed.includes(k)) || v.version !== 2 || (v.group !== "process" && v.group !== "agent") || typeof v.action !== "string" || !Object.hasOwn(fields[v.group], v.action)) return false;
  if (v.group === "process" && ["execution_id", "kind", "agent_id"].some(k => v[k] !== undefined)) return false;
  if (v.group === "agent" && ["task_id", "task_type", "range"].some(k => v[k] !== undefined)) return false;
  for (const k of ["task_id", "agent_id", "title", "raw_status", "error_code"]) if (v[k] !== undefined && typeof v[k] !== "string") return false;
  if (v.execution_id !== undefined && !parseExecutionId(v.execution_id)) return false;
  if (v.task_type !== undefined && !TASK_LOG_TYPES.includes(v.task_type as "bash")) return false;
  if (v.kind !== undefined && v.kind !== "subagent" && v.kind !== "workflow") return false;
  if (v.wait_outcome !== undefined && (v.action !== "wait" || !["waiting", "completed", "released", "cancelled"].includes(String(v.wait_outcome)))) return false;
  if (v.status !== undefined && !["starting", "queued", "running", "paused", "completed", "failed", "stopped"].includes(String(v.status))) return false;
  if (v.count !== undefined && (!Number.isSafeInteger(v.count) || Number(v.count) < 0)) return false;
  if (v.error_code === undefined && ["status", "output", "wait", "stop"].includes(v.action) && v[v.group === "process" ? "task_id" : "execution_id"] === undefined) return false;
  if (v.range !== undefined) {
    const r = v.range as Record<string, unknown>;
    if (!r || typeof r !== "object" || Object.keys(r).length !== 5 || ["start", "end", "size", "omitted_before", "omitted_after"].some(k => !Number.isSafeInteger(r[k]) || Number(r[k]) < 0)) return false;
    if (Number(r.start) > Number(r.end) || Number(r.end) > Number(r.size) || r.omitted_before !== r.start || r.omitted_after !== Number(r.size) - Number(r.end)) return false;
  }
  if (v.stats !== undefined && (!v.stats || typeof v.stats !== "object" || Object.values(v.stats).some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0))) return false;
  return true;
}

const processGuidance = `Process_manage usage:
  - bash runs finite commands; monitor observes ongoing event streams. Use process_manage to inspect, read, await, stop, or search their tasks. Use agent_manage for subagent/workflow executions.
  - Provide every exposed field: action, task_id, task_type, offset, limit, pattern, ignore_case, context. Set unused controls to null; action must be non-null. Unknown fields remain invalid even when null.
  - Non-null arguments by action:
    list/stats: task_type if filtering
    status/stop: task_id
    output: task_id, offset/limit if needed
    wait: task_id, limit if needed
    search: pattern, task_id/task_type/ignore_case/context if needed
  - Copy task_id from launch/list. task_type filters only bash/monitor. Fields outside the selected action's list must be null.
  - output reads a bounded tail page by default; offset=0 reads from the start. offset/limit count bytes; wait accepts limit for its final log page. Use returned ranges to continue reading. Search uses a regex, optional case-insensitivity, and context lines.
  - wait waits for the whole task; for monitor, observation must end, not merely emit an event. /bg or cancellation releases only the wait. stop requests execution cancellation; execution may still be draining afterward.
  - Successful terminal output/wait delivery reports the result and avoids a duplicate completion notification. list/status/search do not consume results. Completion is notified automatically; do not poll solely to detect completion.
  - Examples:
    Read log: {"action":"output","task_id":"<task_id>","task_type":null,"offset":0,"limit":null,"pattern":null,"ignore_case":null,"context":null}
    Await task: {"action":"wait","task_id":"<task_id>","task_type":null,"offset":null,"limit":null,"pattern":null,"ignore_case":null,"context":null}
    Search logs: {"action":"search","task_id":null,"task_type":"bash","offset":null,"limit":null,"pattern":"ERROR","ignore_case":null,"context":null}
    Stop observation: {"action":"stop","task_id":"<monitor_task_id>","task_type":null,"offset":null,"limit":null,"pattern":null,"ignore_case":null,"context":null}`;
const agentGuidance = `Agent_manage usage:
  - Manage executions started by subagent_run or subagent_workflow, not process logs or Agent conversation control. Use process_manage for bash/monitor; subagent_message for messages; subagent_run for Agent resume; subagent_workflow for workflow replay.
  - Provide every exposed field: action, execution_id, kind, verbose. Set unused controls to null; action must be non-null. Unknown fields remain invalid even when null.
  - Non-null arguments by action:
    list: kind filter if needed; execution_id and verbose must be null.
    status/stop: execution_id; kind and verbose must be null.
    output/wait: execution_id and verbose if needed; kind must be null.
  - kind filters list to subagent/workflow. Copy execution_id from launch/list; do not construct it or substitute agent_id. agent_id identifies a conversation for messaging/resume; execution_id identifies one execution. Do not provide non-null values outside the selected action.
  - Agent resume produces a new execution_id. New calls with the previous execution_id fail as stale; they never operate on the resumed execution. A wait already admitted remains bound to its original execution. Workflow replay creates a separate execution with a new ID.
  - output returns current output/progress or a final result; wait awaits the whole execution. verbose is only for subagent output/wait and requests formatted detail, not an unlimited trace. Set verbose to null for workflow.
  - /bg or cancellation releases a wait without stopping execution. stop requests cancellation; it may still be draining. Stopping a workflow also stops its owned agents, not independent siblings. Visible owned children cannot necessarily be managed directly by another owner.
  - Successful terminal output/wait delivery reports that execution's result and avoids duplicate completion notifications; list/status do not consume it. Completion is notified automatically; do not poll solely to detect completion.
  - Examples:
    List workflows: {"action":"list","execution_id":null,"kind":"workflow","verbose":null}
    Read result: {"action":"output","execution_id":"<execution_id>","kind":null,"verbose":null}
    Await execution: {"action":"wait","execution_id":"<execution_id>","kind":null,"verbose":null}
    Stop execution: {"action":"stop","execution_id":"<execution_id>","kind":null,"verbose":null}`;

export interface ManagementParams {
  action: RuntimeTaskParams["action"]; task_id?: string; task_type?: "bash" | "monitor";
  execution_id?: string; kind?: "subagent" | "workflow";
  offset?: number; limit?: number; pattern?: string; ignore_case?: boolean; context?: number; verbose?: boolean;
}
export type ManagementGroup = "process" | "agent";
export interface ManagementDetails { runtimeManagement: { version: 2; group: ManagementGroup; action: string;
  task_id?: string; task_type?: string; execution_id?: string; kind?: string; agent_id?: string;
  title?: string; status?: string; raw_status?: string; error_code?: string; wait_outcome?: string;
  count?: number; range?: RuntimeTaskDetails["runtimeTask"]["range"]; stats?: Readonly<Record<string, number>> } }
const fields = {
  process: { list: ["task_type"], stats: ["task_type"], status: ["task_id"], stop: ["task_id"], output: ["task_id", "offset", "limit"], wait: ["task_id", "limit"], search: ["pattern", "task_id", "task_type", "ignore_case", "context"] },
  agent: { list: ["kind"], status: ["execution_id"], stop: ["execution_id"], output: ["execution_id", "verbose"], wait: ["execution_id", "verbose"] },
} as const;
export interface ProcessManagementParams {
  action: ManagementParams["action"]; task_id: string | null; task_type: "bash" | "monitor" | null;
  offset: number | null; limit: number | null; pattern: string | null; ignore_case: boolean | null; context: number | null;
}
export interface AgentManagementParams { action: ManagementParams["action"]; execution_id: string | null; kind: "subagent" | "workflow" | null; verbose: boolean | null }
export function parseProcessManagementParams(value: unknown): ManagementParams {
  const controls = ["task_id", "task_type", "offset", "limit", "pattern", "ignore_case", "context"];
  const params = parseControlArguments(value, ["action", ...controls], controls);
  const error = validateNormalizedManagementParams("process", params);
  if (error) throw new Error(error);
  return params as unknown as ManagementParams;
}
export function parseAgentManagementParams(value: unknown): ManagementParams {
  const params = parseControlArguments(value, ["action", "execution_id", "kind", "verbose"], ["execution_id", "kind", "verbose"]);
  const error = validateNormalizedManagementParams("agent", params);
  if (error) throw new Error(error);
  return params as unknown as ManagementParams;
}
export function validateManagementParams(group: ManagementGroup, value: unknown): string | undefined {
  try {
    if (group === "agent") parseAgentManagementParams(value);
    else parseProcessManagementParams(value);
    return undefined;
  } catch (error) { return error instanceof Error ? error.message : String(error); }
}
function validateNormalizedManagementParams(group: ManagementGroup, value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Arguments must be an object.";
  const v = value as Record<string, unknown>, table = fields[group] as Record<string, readonly string[]>;
  if (typeof v.action !== "string" || !Object.hasOwn(table, v.action)) return `Unsupported ${group} management action.`;
  const accepted = ["action", ...table[v.action]!];
  const bad = Object.keys(v).find(k => !accepted.includes(k));
  if (bad) return `Field '${bad}' is not accepted for ${v.action}. Accepted fields: ${accepted.join(", ")}. Set fields that do not apply to this action to null.`;
  const target = group === "process" ? "task_id" : "execution_id";
  if (["status", "output", "wait", "stop"].includes(v.action) && (typeof v[target] !== "string" || !v[target].trim())) return `${v.action} requires ${target}.`;
  if (v.task_id !== undefined && (typeof v.task_id !== "string" || !v.task_id.trim())) return "task_id must be a non-empty string.";
  if (v.execution_id !== undefined && !parseExecutionId(v.execution_id)) return "Invalid execution_id; copy it from launch/list.";
  if (v.task_type !== undefined && !TASK_LOG_TYPES.includes(v.task_type as "bash")) return "task_type must be bash or monitor.";
  if (v.kind !== undefined && !["subagent", "workflow"].includes(String(v.kind))) return "kind must be subagent or workflow.";
  for (const k of ["offset", "limit", "context"]) if (v[k] !== undefined && (!Number.isSafeInteger(v[k]) || Number(v[k]) < (k === "limit" ? 1 : 0))) return `${k} must be a safe ${k === "limit" ? "positive" : "non-negative"} integer.`;
  for (const k of ["verbose", "ignore_case"]) if (v[k] !== undefined && typeof v[k] !== "boolean") return `${k} must be boolean.`;
  if (v.action === "search" && (typeof v.pattern !== "string" || !v.pattern.length)) return "search requires pattern.";
  return undefined;
}
function project(group: ManagementGroup, result: RuntimeTaskResult) {
  const m = result.details.runtimeTask;
  const { version: _version, task_id, run_id, task_type, ...rest } = m;
  const identity = task_id && run_id && (task_type === "subagent" || task_type === "workflow")
    ? { execution_id: executionId({ taskId: task_id, runId: run_id }, task_type), kind: task_type, ...(task_type === "subagent" ? { agent_id: task_id } : {}) }
    : group === "agent" ? { ...(task_type ? { kind: task_type } : {}) }
    : { ...(task_id ? { task_id } : {}), ...(task_type ? { task_type } : {}) };
  return { ...result, details: { runtimeManagement: { version: 2 as const, group, ...rest, ...identity } } };
}
export function managementTool(group: ManagementGroup, capabilities: readonly RuntimeTaskCapability[], report = (_id: string, r: RuntimeTaskResult) => r) {
  const selected = capabilities.map(cap => ({ ...cap, list: () => cap.list().filter(e => group === "process" ? e.view.kind === "shell" || e.view.kind === "monitor" : e.view.kind === "agent" || e.view.kind === "workflow") }));
  const facade = createRuntimeTaskFacade(selected);
  const name = group === "process" ? "process_manage" : "agent_manage";
  const parameters = group === "process" ? Type.Object({
    action: StringEnum(TASK_ACTIONS), task_id: nullableControl(Type.String({ description: "Task identity from bash/monitor launch or list; non-null for targeted actions, null when unused." })),
    task_type: nullableControl(StringEnum(TASK_LOG_TYPES, { description: "Filter list/stats/search to bash or monitor; null for no filter or other actions." })),
    offset: nullableControl(Type.Number({ minimum: 0, multipleOf: 1, description: "Output log byte offset; null for tail, 0 for start; null for other actions." })),
    limit: nullableControl(Type.Number({ minimum: 1, multipleOf: 1, description: "Output/wait log byte budget; null for default or other actions." })),
    pattern: nullableControl(Type.String({ description: "Non-empty search regex; null for other actions." })), ignore_case: nullableControl(Type.Boolean({ description: "Search case-insensitivity; null for default false or other actions." })),
    context: nullableControl(Type.Number({ minimum: 0, multipleOf: 1, description: "Search context lines; null for default 0 or other actions." })),
  }, { additionalProperties: false }) : Type.Object({
    action: StringEnum(["list", "status", "output", "wait", "stop"] as const), execution_id: nullableControl(Type.String({ description: "Execution handle from launch/list; non-null for targeted actions, null for list." })),
    kind: nullableControl(StringEnum(["subagent", "workflow"] as const, { description: "List filter; null for no filter or other actions." })), verbose: nullableControl(Type.Boolean({ description: "Formatted detail for subagent output/wait; null when unused or for workflow." })),
  }, { additionalProperties: false });
  let closed = false;
  const close = () => { closed = true; facade.close(); };
  const execute = async (id: string, input: ProcessManagementParams | AgentManagementParams, signal: AbortSignal | undefined, update: AgentToolUpdateCallback<ManagementDetails> | undefined, ctx: ExtensionContext) => {
    let params: ManagementParams = input as ManagementParams;
    let error: string | undefined;
    try { params = group === "agent" ? parseAgentManagementParams(input) : parseProcessManagementParams(input); }
    catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    const fail = (text: string, code = "invalid_arguments") => ({ content: [{ type: "text" as const, text }], details: { runtimeManagement: { version: 2 as const, group, action: String(params?.action ?? "status"), error_code: code } }, isError: true });
    if (closed) return fail("Management activation is closed.", "closed");
    if (error) return fail(error);
    const { execution_id, kind, ...base } = params;
    const identity = execution_id ? parseExecutionId(execution_id)! : undefined;
      if (execution_id && !identity) return fail("Invalid execution_id; copy it from launch/list.");
    if (identity && identity.taskId.startsWith("wf_") !== execution_id!.startsWith("wf_")) return fail("Execution handle kind does not match its target.");
    if (identity && !selected.some(c => c.list().some(e => e.view.taskId === identity.taskId && e.view.runId === identity.runId))) return fail("Execution is stale or not available in this scope.", "stale");
    const internal: RuntimeTaskParams = { ...base, ...(identity ? { task_id: identity.taskId, run_id: identity.runId } : {}), ...(kind ? { task_type: kind } : {}) };
    return project(group, report(id, await facade.execute(internal, signal, update ? r => update(project(group, r)) : undefined, ctx)));
  };
  const renderCall = (value: unknown, theme: import("@earendil-works/pi-coding-agent").Theme, context: { expanded: boolean }) => {
    const args = value && typeof value === "object" ? value as Partial<ManagementParams> : {};
    return createToolCallHeading({ name, detail: `${args.action ?? ""}${args.task_id ?? args.execution_id ? ` ${args.task_id ?? args.execution_id}` : ""}`, theme, context });
  };
  return { tool: { name, label: name, renderCall, description: group === "process" ? "Manage bash and monitor tasks and their logs." : "Manage subagent and agent-workflow executions, not conversation control.", promptSnippet: group === "process" ? "Manage command and observation tasks" : "Inspect, read, await, or stop delegated executions", promptGuidelines: [group === "process" ? processGuidance : agentGuidance], parameters, execute }, close };
}
export function registerManagementTool(pi: ExtensionAPI, group: ManagementGroup, capabilities: readonly RuntimeTaskCapability[], report?: (id: string, r: RuntimeTaskResult) => RuntimeTaskResult) {
  const registered = managementTool(group, capabilities, report);
  pi.registerTool(registered.tool); return registered;
}
