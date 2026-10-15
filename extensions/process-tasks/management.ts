import { statSync } from "node:fs";
import type { RuntimeTaskCapability } from "../runtime-tasks/facade.ts";
import { runtimeTaskType, taskResult, type RuntimeTaskMetadata, type RuntimeTaskParams } from "../runtime-tasks/contracts.ts";
import type { BackgroundRegistry } from "./state.ts";
import type { TaskIdentity, TaskSource } from "../task-ui/types.ts";
import { ensureCompletionPromise, terminateJobSilently } from "./lifecycle.ts";
import { isTerminalStatus } from "./types.ts";
import { markOutcomeSurfaced } from "./notify.ts";
import { readLogSlice, streamLog } from "./output.ts";
import { getStats } from "./registry.ts";
import { searchAction } from "./search.ts";

/** Uses the same registry and lifecycle as execution, never UI detail truncation. */
export function createProcessManagement(reg: BackgroundRegistry, source: TaskSource): RuntimeTaskCapability {
  const lookup = (identity: TaskIdentity) => identity.sourceId === "process" && identity.runId === identity.taskId && !reg.closed ? reg.jobs.get(identity.taskId) : undefined;
  const metadata = (identity: TaskIdentity, params: RuntimeTaskParams): Omit<RuntimeTaskMetadata, "version"> => {
    const job = lookup(identity);
    return { action: params.action, task_type: job?.kind === "monitor" ? "monitor" : "bash", task_id: identity.taskId, run_id: identity.runId,
      stats: job ? { pid: job.pid, duration_ms: Math.max(0, (job.endedAt ?? Date.now()) - job.startTime) } : undefined,
      title: job?.name ?? job?.command, raw_status: job?.status,
      status: job?.status === "pending" ? "queued" : job?.status === "killed" ? "stopped" : job?.status };
  };
  const output = (identity: TaskIdentity, params: RuntimeTaskParams, consume: boolean) => {
    const job = lookup(identity);
    const meta = metadata(identity, params);
    if (!job) return taskResult("Process task is no longer available.", { ...meta, error_code: "closed" });
    let size: number;
    try { const stat = statSync(job.logPath); if (!stat.isFile()) throw new Error("Not a log file"); size = stat.size; } catch { return taskResult(`Cannot read log: ${job.logPath}. Task status=${job.status}.`, { ...meta, error_code: "log_error" }); }
    const slice = size === 0 ? { text: "", start: 0, end: 0, size: 0 } : readLogSlice(job.logPath, { offset: params.offset, limit: params.limit ?? reg.config.outputPreviewChars });
    if (!slice) return taskResult(`Cannot read log: ${job.logPath}. Task status=${job.status}.`, { ...meta, error_code: "log_error" });
    if (consume && isTerminalStatus(job.status)) markOutcomeSurfaced(job, reg);
    return taskResult([
      `task_type=${meta.task_type} task_id=${job.id} run_id=${job.id} status=${meta.status} raw_status=${job.status}`,
      `Output for ${job.name ?? job.command} — bytes ${slice.start}-${slice.end} of ${slice.size}. Log: ${job.logPath}`,
      slice.start ? `[${slice.start} earlier bytes omitted; offset=0]` : "",
      slice.text || "(no output)",
      slice.end < slice.size ? `[${slice.size - slice.end} more bytes; offset=${slice.end}]` : "",
    ].filter(Boolean).join("\n"), { ...meta, range: { start: slice.start, end: slice.end, size: slice.size, omitted_before: slice.start, omitted_after: slice.size - slice.end } });
  };
  const search: NonNullable<RuntimeTaskCapability["search"]> = async params => {
    // Keep regex/context/count/preview formatting in its original backend owner.
    const jobs = [...reg.jobs.values()].filter(job => (!params.task_id || job.id === params.task_id) && (params.task_type === undefined || (job.kind === "monitor" ? "monitor" : "bash") === params.task_type));
    const result = await searchAction(reg, params.pattern!, { jobId: params.task_id, ignoreCase: params.ignore_case ?? false, contextLines: params.context ?? 0, taskType: params.task_type === "bash" || params.task_type === "monitor" ? params.task_type : undefined });
    if (reg.closed || jobs.some(job => reg.jobs.get(job.id) !== job)) return taskResult("Process search scope is closed or replaced.", { action: "search", task_type: params.task_type, error_code: "closed" });
    return taskResult(result.content.filter(block => block.type === "text").map(block => block.text).join("\n"), { action: "search", task_type: params.task_type, count: result.details.count, error_code: result.details.error_code });
  };
  return {
    list: () => source.list().map(view => { const job = reg.jobs.get(view.taskId); return { view, manageable: true, rawStatus: job?.status ?? view.status, note: job?.notifyError ? `notification failed: ${job.notifyError}` : undefined }; }),
    stats: () => ({ ...getStats(reg) }),
    search,
    async execute(identity, params, signal, onUpdate, ctx) {
      const job = lookup(identity);
      if (!job) return taskResult("Process task is no longer available.", { ...metadata(identity, params), error_code: "closed" });
      if (params.action === "output") return output(identity, params, true);
      if (params.action === "search") {
        const result = await search(params, ctx);
        if (reg.closed || reg.jobs.get(job.id) !== job) return taskResult("Process search scope is closed or replaced.", { ...metadata(identity, params), error_code: "closed" });
        return taskResult(result.content.filter(block => block.type === "text").map(block => block.text).join("\n"), { ...metadata(identity, params), count: result.details.runtimeTask.count, error_code: result.details.runtimeTask.error_code });
      }
      if (params.action === "stop") {
        const requested = !isTerminalStatus(job.status);
        if (requested) terminateJobSilently(reg, job);
        return taskResult(`task_type=${runtimeTaskType({ kind: job.kind ?? "shell" })} task_id=${job.id} run_id=${job.id}\nStop ${requested ? "requested" : "not needed"}; observed status=${job.status}. Actual execution may still be draining.`, metadata(identity, params));
      }
      if (params.action !== "wait") return taskResult("Unsupported process action.", { ...metadata(identity, params), error_code: "unsupported" });
      ensureCompletionPromise(job);
      const terminal = job.donePromise;
      job.attachCount = (job.attachCount ?? 0) + 1;
      let completedOutput: ReturnType<typeof output> | undefined;
      const lease = reg.coordinator.registerWait<void>({ identity, label: job.name ?? job.command, kind: "retrieval", signal,
        // Completion wins before suppression is released. Log failure is reported by output.
        onComplete: () => { completedOutput = output(identity, params, true); if (!completedOutput.details.runtimeTask.error_code) reg.notificationRetries.delete(job.id); },
        cleanup: () => { job.attachCount = Math.max(0, (job.attachCount ?? 1) - 1); reg.changed(); queueMicrotask(() => reg.notificationRetries.get(job.id)?.()); },
      });
      if (isTerminalStatus(job.status)) lease.complete();
      else void terminal?.then(() => lease.complete());
      let poller: ReturnType<typeof streamLog> | undefined;
      try {
        if (!lease.settled) {
          onUpdate?.(taskResult(`task_id=${job.id} run_id=${job.id}\nWaiting for entire task to finish.`, { ...metadata(identity, params), wait_outcome: "waiting" }));
          poller = streamLog(job.logPath, update => onUpdate?.(taskResult(update.content.map(block => block.text).join("\n"), { ...metadata(identity, params), wait_outcome: "waiting" })));
        }
        const outcome = await lease.result;
        if (reg.closed || reg.jobs.get(job.id) !== job) return taskResult("Process activation is closed.", { ...metadata(identity, params), error_code: "closed", wait_outcome: "cancelled" });
        if (outcome.kind !== "completed") return taskResult(`task_id=${job.id} run_id=${job.id}\nWait ${outcome.kind === "detached" ? "released" : "cancelled"}; target unchanged.`, { ...metadata(identity, params), wait_outcome: outcome.kind === "detached" ? "released" : "cancelled" });
        const result = completedOutput ?? output(identity, params, true);
        return taskResult(result.content.filter(block => block.type === "text").map(block => block.text).join("\n"), { ...result.details.runtimeTask, wait_outcome: "completed" });
      } finally { poller?.stop(); if (!lease.settled) lease.dispose(); }
    },
  };
}
