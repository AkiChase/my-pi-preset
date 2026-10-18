import { parseExecutionId } from "../../runtime-tasks/execution-id.ts";
import { copyExecutionConfig } from "../../runtime-tasks/execution-config.ts";
import { isManagementDetails, parseAgentManagementParams, parseProcessManagementParams, type ManagementDetails, type ManagementGroup } from "../../runtime-tasks/tools.ts";
import type { RetrievalContract } from "./task-manage.ts";
export function managementContract(group: ManagementGroup): RetrievalContract {
  return (input, result, ctx) => {
    let args = input;
    try { args = (group === "agent" ? parseAgentManagementParams(input) : parseProcessManagementParams(input)) as unknown as typeof input; }
    catch { return undefined; }
    const id = args.task_id ?? args.execution_id;
    const title = `${args.action}${id ? ` ${id}` : ""}`;
    if (!result) return { title, stats: args.action === "wait" ? "waiting" : "" };
    if (!isManagementDetails(result.details)) return undefined;
    const m = (result.details as ManagementDetails).runtimeManagement;
    const execution = parseExecutionId(m.execution_id);
    if (m.agent_id !== undefined && (m.kind !== "subagent" || execution?.taskId !== m.agent_id)) return undefined;
    if (m.kind !== undefined && m.execution_id !== undefined &&
        (m.kind === "workflow") !== m.execution_id.startsWith("wf_")) return undefined;
    if (!m || m.version !== 2 || m.group !== group || m.action !== args.action ||
        (id !== undefined && (m.task_id ?? m.execution_id) !== undefined && (m.task_id ?? m.execution_id) !== id) ||
        (ctx.isPartial && (m.action !== "wait" || m.wait_outcome !== "waiting")) || (!ctx.isPartial && m.wait_outcome === "waiting")) return undefined;
    let stats = m.error_code ?? m.raw_status ?? m.status ?? "";
    if (m.action === "list") stats = `${m.count ?? 0} tasks`;
    if (m.action === "search") stats = `${m.count ?? 0} matches`;
    if (m.action === "stats") stats = `${m.count ?? 0} retained tasks`;
    if (m.action === "stop" && !m.error_code) stats = `stop · observed ${m.raw_status ?? m.status ?? "unknown"}`;
    if (m.wait_outcome === "waiting") stats = "waiting";
    if (m.wait_outcome === "released" || m.wait_outcome === "cancelled") stats = `wait ${m.wait_outcome} · target unchanged`;
    const expandedRows = group === "process" ? [
      ...(m.range ? ["Log range (bytes)", ...Object.entries(m.range).map(([key, value]) => `  ${key}: ${value}`)] : []),
      ...(m.stats && Object.keys(m.stats).length ? ["Statistics", ...Object.entries(m.stats).map(([key, value]) => `  ${key}: ${value}`)] : []),
    ] : [];
    return { expandedRows, title: m.title ?? title, stats, secondary: [m.task_type ?? m.kind, m.task_id ?? m.execution_id].filter(Boolean).join(" · "),
      ...(m.executionConfig ? { executionConfig: copyExecutionConfig(m.executionConfig) } : {}) };
  };
}
