import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { TaskIdentity, TaskView } from "../task-ui/types.ts";
import {
  TASK_ACTIONS, TASK_TYPES, runtimeTaskType, taskResult, validateRuntimeTaskParams, validateTargetOptions,
  type RuntimeTaskParams, type RuntimeTaskResult, type RuntimeTaskDetails,
} from "./contracts.ts";

export interface RuntimeTaskEntry {
  readonly view: TaskView;
  readonly manageable: boolean;
  readonly rawStatus: string;
  readonly note?: string;
}
/** Finite backend seam. The facade never receives sessions, controllers or records. */
export interface RuntimeTaskCapability {
  list(): readonly RuntimeTaskEntry[];
  execute(identity: TaskIdentity, params: RuntimeTaskParams, signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<RuntimeTaskDetails> | undefined, ctx: ExtensionContext): Promise<RuntimeTaskResult>;
  search?(params: RuntimeTaskParams, ctx: ExtensionContext): Promise<RuntimeTaskResult>;
  stats?(): Readonly<Record<string, number>>;
}

export function createRuntimeTaskFacade(initial: readonly RuntimeTaskCapability[]) {
  let capabilities = [...initial];
  let closed = false;
  const close = () => { closed = true; capabilities = []; };
  const execute = async (params: RuntimeTaskParams, signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<RuntimeTaskDetails> | undefined, ctx: ExtensionContext): Promise<RuntimeTaskResult> => {
    const error = validateRuntimeTaskParams(params);
    if (error) return taskResult(error, { action: TASK_ACTIONS.includes(params?.action) ? params.action : "status", error_code: "invalid_arguments" });
    if (closed) return taskResult("Runtime task activation is closed.", { action: params.action, error_code: "closed" });
    // Bind once at admission; no second target lookup after an await.
    const entries = capabilities.flatMap(capability => capability.list().map(entry => ({ capability, entry })));
    if (params.task_id !== undefined) {
      const matches = entries.filter(({ entry }) => entry.view.taskId === params.task_id);
      if (matches.length === 0) return taskResult(`Task ${params.task_id} not found in this scope.`, { action: params.action, error_code: "not_found" });
      if (matches.length !== 1) return taskResult(`Ambiguous task_id ${params.task_id}.`, { action: params.action, error_code: "ambiguous" });
      const { entry, capability } = matches[0];
      const view = entry.view;
      const reliableStats = Object.fromEntries(Object.entries(view.stats).flatMap(([key, value]) => typeof value === "number" && Number.isFinite(value) && value >= 0 && !["exitCode"].includes(key) ? [[key, value] as const] : []));
      const metadata = { stats: reliableStats, action: params.action, task_type: runtimeTaskType(view), task_id: view.taskId, run_id: view.runId, title: view.title, status: view.status, raw_status: entry.rawStatus };
      if (params.run_id !== undefined && params.run_id !== view.runId)
        return taskResult(`Stale run_id ${params.run_id}; current run_id=${view.runId}.`, { ...metadata, error_code: "stale" });
      if (!entry.manageable) return taskResult("This task belongs to another owner; manage its owner instead.", { ...metadata, error_code: "forbidden" });
      const optionsError = validateTargetOptions(params, metadata.task_type);
      if (optionsError) return taskResult(optionsError, { ...metadata, error_code: "unsupported" });
      if (params.task_type !== undefined && params.task_type !== metadata.task_type)
        return taskResult("task_type does not match target.", { ...metadata, error_code: "invalid_arguments" });
      if (params.action === "status") return taskResult([
        `task_type=${metadata.task_type} task_id=${view.taskId} run_id=${view.runId}`,
        `${view.title}: ${view.status} (raw_status=${entry.rawStatus})`,
        `mode=${view.executionMode} wait_count=${view.waitCount}`,
        `capabilities=${JSON.stringify(view.capabilities)}`,
        `stats=${JSON.stringify(view.stats)}`,
        ...view.artifacts.map(artifact => `${artifact.kind}=${artifact.path}`),
      ].join("\n"), metadata);
      return capability.execute(Object.freeze({ sourceId: view.sourceId, taskId: view.taskId, runId: view.runId }), params, signal, onUpdate, ctx);
    }
    if (params.action === "list") {
      const filtered = entries.filter(({ entry }) => params.task_type === undefined || runtimeTaskType(entry.view) === params.task_type);
      return taskResult(filtered.length ? filtered.map(({ entry }) => {
        const view = entry.view;
        return `task_type=${runtimeTaskType(view)} task_id=${view.taskId} run_id=${view.runId} status=${view.status} raw_status=${entry.rawStatus} mode=${view.executionMode} wait_count=${view.waitCount} manageable=${entry.manageable}${view.parentKey ? ` parent=${view.parentKey}` : ""}\n  ${view.title}${entry.note ? `\n  ${entry.note}` : ""}`;
      }).join("\n") : "No runtime tasks in this scope.", { action: "list", task_type: params.task_type, count: filtered.length });
    }
    if (params.action === "search") {
      if (params.task_type === "subagent" || params.task_type === "workflow")
        return taskResult("Search supports only bash and monitor logs.", { action: "search", error_code: "unsupported" });
      const searchers = capabilities.filter(capability => capability.search !== undefined);
      const results = await Promise.all(searchers.map(capability => capability.search!(params, ctx)));
      const failure = results.find(result => result.isError || result.details.runtimeTask.error_code);
      if (failure) return failure;
      if (closed) return taskResult("Runtime task activation is closed.", { action: params.action, error_code: "closed" });
      return taskResult(results.flatMap(result => result.content.filter(block => block.type === "text").map(block => block.text)).join("\n") || "No searchable logs.", { action: "search", task_type: params.task_type, count: results.reduce((count, result) => count + (result.details.runtimeTask.count ?? 0), 0) });
    }
    if (params.action === "stats") {
      const filtered = entries.filter(({ entry }) => params.task_type === undefined || runtimeTaskType(entry.view) === params.task_type);
      const lines = TASK_TYPES.filter(type => params.task_type === undefined || params.task_type === type).map(type => {
        const current = filtered.filter(({ entry }) => runtimeTaskType(entry.view) === type);
        const counts = Object.fromEntries(["starting", "queued", "running", "paused", "completed", "failed", "stopped"].map(status => [status, current.filter(({ entry }) => entry.view.status === status).length]));
        return `${type} current retained snapshot: ${JSON.stringify(counts)}`;
      });
      if (params.task_type === undefined || params.task_type === "bash" || params.task_type === "monitor")
        for (const capability of capabilities) if (capability.stats) lines.push(`process activation cumulative (bash+monitor): ${JSON.stringify(capability.stats())}`);
      return taskResult(lines.join("\n"), { action: "stats", task_type: params.task_type, count: filtered.length });
    }
    return taskResult("Target action requires task_id.", { action: params.action, error_code: "invalid_arguments" });
  };
  return { execute, close };
}

export function runtimeTaskTool(facade: ReturnType<typeof createRuntimeTaskFacade>, report: (id: string, result: RuntimeTaskResult) => RuntimeTaskResult = (_id, result) => result) {
  return {
    name: "task_manage", label: "Runtime Tasks",
    description: "Manage runtime bash, monitor, subagent and workflow tasks in this scope. Not Trellis planning tasks.",
    promptSnippet: "List/status/output/wait/stop/search/stats for runtime tasks",
    promptGuidelines: [
      "Use task_id and optional exact run_id returned by launch/list. Omitted run_id binds the current run at call admission.",
      "wait waits for the entire task, including monitors; /bg or cancellation releases only the wait, not execution.",
      "output returns final subagent answers, workflow script returns, or a byte page of process logs. verbose is only for subagents.",
      "search is regex over bash/monitor logs only. stats separates current retained counts from process activation cumulative metrics.",
    ],
    parameters: Type.Object({
      action: StringEnum(TASK_ACTIONS), task_id: Type.Optional(Type.String()), run_id: Type.Optional(Type.String()),
      task_type: Type.Optional(StringEnum(TASK_TYPES)), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()),
      verbose: Type.Optional(Type.Boolean()), pattern: Type.Optional(Type.String()), ignore_case: Type.Optional(Type.Boolean()), context: Type.Optional(Type.Number()),
    }),
    execute: async (id: string, params: RuntimeTaskParams, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<RuntimeTaskDetails> | undefined, ctx: ExtensionContext) => report(id, await facade.execute(params, signal, onUpdate, ctx)),
  };
}
export function registerRuntimeTaskTool(pi: ExtensionAPI, facade: ReturnType<typeof createRuntimeTaskFacade>, report?: (id: string, result: RuntimeTaskResult) => RuntimeTaskResult): void {
  pi.registerTool(runtimeTaskTool(facade, report));
}
