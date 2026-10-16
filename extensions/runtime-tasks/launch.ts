import type { RuntimeTaskType } from "./contracts.ts";
import { executionId, parseExecutionId } from "./execution-id.ts";
export type RuntimeLaunchMetadata =
  | { readonly version: 2; readonly task_type: "bash" | "monitor"; readonly task_id: string; readonly mode: "foreground" | "background" }
  | { readonly version: 2; readonly kind: "subagent"; readonly agent_id: string; readonly execution_id: string; readonly mode: "foreground" | "background" }
  | { readonly version: 2; readonly kind: "workflow"; readonly execution_id: string; readonly mode: "foreground" | "background" };
export function launchMetadata(type: RuntimeTaskType, taskId: string, runId: string, mode: RuntimeLaunchMetadata["mode"]): RuntimeLaunchMetadata {
  if (type === "bash" || type === "monitor") return Object.freeze({ version: 2, task_type: type, task_id: taskId, mode });
  const execution_id = executionId({ taskId, runId }, type);
  return type === "subagent" ? Object.freeze({ version: 2, kind: type, agent_id: taskId, execution_id, mode })
    : Object.freeze({ version: 2, kind: type, execution_id, mode });
}
export function launchText(identity: RuntimeLaunchMetadata): string {
  return "task_id" in identity ? `task_type=${identity.task_type} task_id=${identity.task_id}`
    : `kind=${identity.kind}${"agent_id" in identity ? ` agent_id=${identity.agent_id}` : ""} execution_id=${identity.execution_id}`;
}
export function isLaunchMetadata(value: unknown): value is RuntimeLaunchMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 2 || !["foreground", "background"].includes(String(v.mode))) return false;
  const nonempty = (x: unknown) => typeof x === "string" && x.length > 0;
  if (v.task_type === "bash" || v.task_type === "monitor") return Object.keys(v).length === 4 && typeof v.task_id === "string" && v.task_id.trim().length > 0;
  const identity = parseExecutionId(v.execution_id);
  if (!identity) return false;
  return v.kind === "subagent" ? Object.keys(v).length === 5 && nonempty(v.agent_id) && identity.taskId === v.agent_id && !String(v.execution_id).startsWith("wf_")
    : v.kind === "workflow" && Object.keys(v).length === 4 && identity.taskId === v.execution_id;
}
