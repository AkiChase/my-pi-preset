import type { RuntimeTaskType } from "./contracts.ts";
export interface RuntimeLaunchMetadata {
  readonly version: 1;
  readonly task_type: RuntimeTaskType;
  readonly task_id: string;
  readonly run_id: string;
  readonly mode: "foreground" | "background";
}
export function launchMetadata(task_type: RuntimeTaskType, task_id: string, run_id: string, mode: RuntimeLaunchMetadata["mode"]): RuntimeLaunchMetadata {
  return Object.freeze({ version: 1, task_type, task_id, run_id, mode });
}
export function launchText(identity: RuntimeLaunchMetadata): string {
  return `task_type=${identity.task_type} task_id=${identity.task_id} run_id=${identity.run_id}`;
}
export function isLaunchMetadata(value: unknown): value is RuntimeLaunchMetadata {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 5 && v.version === 1 && ["bash", "monitor", "subagent", "workflow"].includes(String(v.task_type)) &&
    typeof v.task_id === "string" && v.task_id.length > 0 && typeof v.run_id === "string" && v.run_id.length > 0 && ["foreground", "background"].includes(String(v.mode));
}
