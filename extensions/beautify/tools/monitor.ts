import { copyMonitorExecutionConfig } from "../../runtime-tasks/execution-config.ts";
import { isLaunchMetadata } from "../../runtime-tasks/launch.ts";
import { parseMonitorArguments } from "../../process-tasks/tools/monitor.ts";
import type { RetrievalContract } from "./task-manage.ts";

/** Only the official launch envelope is adapted; foreign/history results delegate. */
export const monitorContract: RetrievalContract = (input, result, ctx) => {
  let args: ReturnType<typeof parseMonitorArguments>;
  try { args = parseMonitorArguments(input); } catch { return undefined; }
  if (!result) return { title: args.description.trim(), stats: "" };
  if (ctx.isPartial || !result.details || typeof result.details !== "object" || Array.isArray(result.details)) return undefined;
  const details = result.details as Record<string, unknown>;
  if (Object.keys(details).some(key => !["runtimeLaunch", "executionConfig"].includes(key)) || !isLaunchMetadata(details.runtimeLaunch)) return undefined;
  const launch = details.runtimeLaunch;
  const config = copyMonitorExecutionConfig(details.executionConfig);
  if (!("task_type" in launch) || launch.task_type !== "monitor" || launch.mode !== "background" || !config) return undefined;
  if (config.timeout_ms !== (args.timeout_ms ?? null) || config.wake_absent_ms !== (args.wake_absent_ms ?? null)) return undefined;
  return { title: args.description.trim(), stats: ctx.isError ? "error" : "started", secondary: launch.task_id, executionConfig: config };
};
