import { isRuntimeTaskMetadata, validateRuntimeTaskParams, validateTargetOptions } from "../../runtime-tasks/contracts.ts";
import type { Args, RenderContext, Result } from "../types.ts";
import type { Metadata } from "./shared.ts";
export type RetrievalContract = (args: Args, result: Result | undefined, ctx: RenderContext) => Metadata | undefined;
export const taskManageContract: RetrievalContract = (args, result, ctx) => {
  if (validateRuntimeTaskParams(args)) return undefined;
  const title = `${args.action}${args.task_id ? ` ${args.task_id}` : ""}`;
  if (!result) return { title, stats: args.action === "wait" ? "waiting" : "" };
  if (!Array.isArray(result.content) || result.content.length !== 1 || result.content[0]?.type !== "text" || typeof result.content[0].text !== "string") return undefined;
  if (!result.details || typeof result.details !== "object" || Object.keys(result.details).length !== 1 || !Object.hasOwn(result.details, "runtimeTask")) return undefined;
  const meta = (result.details as { runtimeTask: unknown }).runtimeTask;
  if (!isRuntimeTaskMetadata(meta) || meta.action !== args.action || (args.task_id !== undefined && meta.task_id !== undefined && meta.task_id !== args.task_id) ||
      (args.run_id !== undefined && meta.run_id !== undefined && meta.run_id !== args.run_id) || (args.task_type !== undefined && meta.task_type !== args.task_type) ||
      (meta.task_type !== undefined && validateTargetOptions(args as unknown as import("../../runtime-tasks/contracts.ts").RuntimeTaskParams, meta.task_type)) ||
      (ctx.isPartial && (meta.action !== "wait" || meta.wait_outcome !== "waiting")) || (!ctx.isPartial && meta.wait_outcome === "waiting")) return undefined;
  let stats = meta.error_code ?? meta.raw_status ?? meta.status ?? "";
  if (meta.action === "list") stats = `${meta.count ?? 0} tasks`;
  if (meta.action === "search") stats = `${meta.count ?? 0} matches`;
  if (meta.action === "stats") stats = `${meta.count ?? 0} retained tasks`;
  if (meta.action === "stop" && !meta.error_code) stats = `stop · observed ${meta.raw_status ?? meta.status ?? "unknown"}`;
  if (meta.wait_outcome) stats = meta.wait_outcome === "released" || meta.wait_outcome === "cancelled" ? `wait ${meta.wait_outcome} · target unchanged` : meta.wait_outcome === "waiting" ? "waiting" : stats;
  const extra: string[] = [];
  if (meta.task_type) extra.push(meta.task_type);
  if (meta.task_id) extra.push(`${meta.action} ${meta.task_id} run ${meta.run_id}`);
  if (meta.range) extra.push(`bytes ${meta.range.start}-${meta.range.end} of ${meta.range.size}${meta.range.omitted_before || meta.range.omitted_after ? " · omitted" : ""}`);
  if (meta.stats) for (const [key, value] of Object.entries(meta.stats)) extra.push(`${key}: ${value}`);
  return { title: meta.title?.trim() ? meta.title : title, stats, secondary: extra.join(" · ") };
};
