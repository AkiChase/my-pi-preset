import type { RuntimeTaskType } from "./contracts.ts";
import { executionId, parseExecutionId } from "./execution-id.ts";

export type RuntimeLaunchMetadata =
  | { readonly version: 2; readonly task_type: "bash" | "monitor"; readonly task_id: string; readonly mode: "foreground" | "background" }
  | { readonly version: 2; readonly kind: "subagent"; readonly agent_id: string; readonly mode: "foreground" | "background" }
  | { readonly version: 2; readonly kind: "workflow"; readonly execution_id: string; readonly mode: "foreground" | "background" };

export function launchMetadata(type: RuntimeTaskType, taskId: string, runId: string, mode: RuntimeLaunchMetadata["mode"]): RuntimeLaunchMetadata {
  if (type === "bash" || type === "monitor") return Object.freeze({ version: 2, task_type: type, task_id: taskId, mode });
  if (type === "subagent") return Object.freeze({ version: 2, kind: type, agent_id: taskId, mode });
  return Object.freeze({ version: 2, kind: type, execution_id: executionId({ taskId, runId }, type), mode });
}

export function launchText(identity: RuntimeLaunchMetadata): string {
  if ("task_id" in identity) return `task_type=${identity.task_type} task_id=${identity.task_id}`;
  if (identity.kind === "subagent") return `kind=subagent agent_id=${identity.agent_id}`;
  return `kind=workflow execution_id=${identity.execution_id}`;
}

export function isLaunchMetadata(value: unknown): value is RuntimeLaunchMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 2 || !["foreground", "background"].includes(String(v.mode))) return false;
  const nonempty = (x: unknown) => typeof x === "string" && x.length > 0;
  if (v.task_type === "bash" || v.task_type === "monitor") return Object.keys(v).length === 4 && typeof v.task_id === "string" && v.task_id.trim().length > 0;
  if (v.kind === "subagent") return Object.keys(v).length === 4 && nonempty(v.agent_id);
  if (v.kind !== "workflow" || Object.keys(v).length !== 4) return false;
  const identity = parseExecutionId(v.execution_id);
  return !!identity && identity.taskId === v.execution_id;
}
