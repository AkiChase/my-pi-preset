import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TaskView } from "../task-ui/types.ts";

export const TASK_TYPES = ["bash", "monitor", "subagent", "workflow"] as const;
export const TASK_ACTIONS = ["list", "status", "output", "wait", "stop", "search", "stats"] as const;
export type RuntimeTaskType = typeof TASK_TYPES[number];
export type RuntimeTaskAction = typeof TASK_ACTIONS[number];
export interface RuntimeTaskParams {
  action: RuntimeTaskAction;
  task_id?: string;
  run_id?: string;
  task_type?: RuntimeTaskType;
  offset?: number;
  limit?: number;
  verbose?: boolean;
  pattern?: string;
  ignore_case?: boolean;
  context?: number;
}
export interface RuntimeTaskMetadata {
  readonly version: 1;
  readonly action: RuntimeTaskAction;
  readonly task_type?: RuntimeTaskType;
  readonly task_id?: string;
  readonly run_id?: string;
  readonly title?: string;
  readonly status?: TaskView["status"];
  readonly raw_status?: string;
  readonly wait_outcome?: "waiting" | "completed" | "released" | "cancelled";
  readonly stats?: Readonly<Record<string, number>>;
  readonly range?: Readonly<{ start: number; end: number; size: number; omitted_before: number; omitted_after: number }>;
  readonly count?: number;
  readonly error_code?: "invalid_arguments" | "not_found" | "stale" | "ambiguous" | "forbidden" | "unsupported" | "closed" | "log_error";
}
export interface RuntimeTaskDetails { readonly runtimeTask: RuntimeTaskMetadata }
export type RuntimeTaskResult = AgentToolResult<RuntimeTaskDetails>;

const statuses = ["starting", "queued", "running", "paused", "completed", "failed", "stopped"];
const outcomes = ["waiting", "completed", "released", "cancelled"];
const errors = ["invalid_arguments", "not_found", "stale", "ambiguous", "forbidden", "unsupported", "closed", "log_error"];
const keys = ["version", "action", "task_type", "task_id", "run_id", "title", "status", "raw_status", "wait_outcome", "stats", "range", "count", "error_code"];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const fractionalStats = ["duration_ms", "durationMs", "cost", "totalDurationMs", "averageDurationMs"];
const countStats = ["pid", "tokens", "inputTokens", "outputTokens", "toolUses", "turnCount", "maxTurns", "doneCount", "totalCount", "totalStarted", "running", "completed", "failed", "killed"];
const safeCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Public data only. Foreign/same-name renderers must not be accepted by coincidence. */
export function isRuntimeTaskMetadata(value: unknown): value is RuntimeTaskMetadata {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) || value.version !== 1 ||
      !TASK_ACTIONS.includes(value.action as RuntimeTaskAction)) return false;
  if (value.task_type !== undefined && !TASK_TYPES.includes(value.task_type as RuntimeTaskType)) return false;
  for (const key of ["task_id", "run_id", "title", "raw_status"])
    if (value[key] !== undefined && typeof value[key] !== "string") return false;
  if (value.task_id === "" || value.run_id === "") return false;
  if ((value.task_id === undefined) !== (value.run_id === undefined)) return false;
  if (value.task_id !== undefined && value.task_type === undefined) return false;
  if (value.status !== undefined && !statuses.includes(value.status as string)) return false;
  if (value.wait_outcome !== undefined && (!outcomes.includes(value.wait_outcome as string) || value.action !== "wait")) return false;
  if (value.error_code !== undefined && !errors.includes(value.error_code as string)) return false;
  if (value.count !== undefined && !safeCount(value.count)) return false;
  if (value.stats !== undefined && (!object(value.stats) || Object.entries(value.stats).some(([key, n]) =>
    fractionalStats.includes(key) ? typeof n !== "number" || !Number.isFinite(n) || n < 0 : !countStats.includes(key) || !safeCount(n)))) return false;
  if (value.error_code === undefined && ["status", "output", "wait", "stop"].includes(value.action as string) && value.task_id === undefined) return false;
  if (value.range !== undefined && (!["output", "wait"].includes(value.action as string) || !["bash", "monitor"].includes(value.task_type as string))) return false;
  if (value.range !== undefined) {
    if (!object(value.range) || Object.keys(value.range).length !== 5 ||
        ["start", "end", "size", "omitted_before", "omitted_after"].some(k => !safeCount((value.range as Record<string, unknown>)[k]))) return false;
    const { start, end, size, omitted_before, omitted_after } = value.range as Record<string, number>;
    if (start > end || end > size || omitted_before !== start || omitted_after !== size - end) return false;
  }
  return true;
}

const allowed: Record<RuntimeTaskAction, readonly string[]> = {
  list: ["action", "task_type"], status: ["action", "task_id", "run_id"],
  output: ["action", "task_id", "run_id", "offset", "limit", "verbose"],
  wait: ["action", "task_id", "run_id", "limit", "verbose"],
  stop: ["action", "task_id", "run_id"],
  search: ["action", "task_id", "run_id", "task_type", "pattern", "ignore_case", "context"],
  stats: ["action", "task_type"],
};

/** Flat provider schema has intentionally stricter per-action runtime admission. */
export function validateRuntimeTaskParams(value: unknown): string | undefined {
  if (!object(value) || !TASK_ACTIONS.includes(value.action as RuntimeTaskAction)) return "Unknown task action.";
  const action = value.action as RuntimeTaskAction;
  if (Object.keys(value).some(key => !allowed[action].includes(key))) return `Inapplicable field for ${action}.`;
  for (const key of ["task_id", "run_id"])
    if (value[key] !== undefined && (typeof value[key] !== "string" || !String(value[key]).trim())) return `${key} must be a non-empty string.`;
  if (["status", "output", "wait", "stop"].includes(action) && value.task_id === undefined) return `${action} requires task_id.`;
  if (value.run_id !== undefined && value.task_id === undefined) return "run_id requires task_id.";
  if (value.task_type !== undefined && !TASK_TYPES.includes(value.task_type as RuntimeTaskType)) return "Unknown task_type.";
  for (const key of ["offset", "limit", "context"])
    if (value[key] !== undefined && (!safeCount(value[key]) || (key === "limit" && value[key] === 0))) return `${key} must be a safe ${key === "limit" ? "positive" : "non-negative"} integer.`;
  for (const key of ["verbose", "ignore_case"])
    if (value[key] !== undefined && typeof value[key] !== "boolean") return `${key} must be boolean.`;
  if (action === "search" && (typeof value.pattern !== "string" || value.pattern.length === 0)) return "search requires pattern.";
  return undefined;
}

export function validateTargetOptions(params: RuntimeTaskParams, type: RuntimeTaskType): string | undefined {
  if (params.action === "search" && type !== "bash" && type !== "monitor") return "Search supports only bash and monitor logs.";
  if (params.verbose !== undefined && type !== "subagent") return "verbose applies only to subagent output/wait.";
  if ((params.offset !== undefined || params.limit !== undefined) && type !== "bash" && type !== "monitor") return "Byte pagination applies only to bash and monitor logs.";
  return undefined;
}

export function runtimeTaskType(view: Pick<TaskView, "kind">): RuntimeTaskType {
  return view.kind === "shell" ? "bash" : view.kind === "agent" ? "subagent" : view.kind;
}

export function taskResult(text: string, metadata: Omit<RuntimeTaskMetadata, "version">): RuntimeTaskResult {
  const runtimeTask = Object.freeze({ version: 1 as const, ...metadata,
    ...(metadata.stats ? { stats: Object.freeze({ ...metadata.stats }) } : {}),
    ...(metadata.range ? { range: Object.freeze({ ...metadata.range }) } : {}),
  });
  return { content: [{ type: "text", text }], details: Object.freeze({ runtimeTask }), ...(metadata.error_code ? { isError: true } : {}) };
}
