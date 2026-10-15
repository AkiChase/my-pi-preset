import type { RuntimeTaskCapability } from "../../../runtime-tasks/facade.ts";
import { taskResult, type RuntimeTaskMetadata } from "../../../runtime-tasks/contracts.ts";
import type { TaskCoordinator } from "../../../task-ui/coordinator.ts";
import type { TaskSource } from "../../../task-ui/types.ts";
import type { AgentManager } from "../agent-manager.ts";
import type { WorkflowTask } from "./task.ts";

/** Terminal retrieval is distinct from the worker/host actual-execution drain. */
function progressPreview(logs: readonly string[]): string {
  const tail = logs.slice(-100).join("\n");
  const omittedEntries = Math.max(0, logs.length - 100);
  const omittedChars = Math.max(0, tail.length - 16_000);
  return `${omittedEntries || omittedChars ? `[Progress omitted: ${omittedEntries} earlier entries, ${omittedChars} earlier characters]\n` : ""}${tail.slice(-16_000)}`;
}

export function createWorkflowManagement(options: {
  tasks: ReadonlyMap<string, WorkflowTask>; source: TaskSource; coordinator: TaskCoordinator;
  manager: AgentManager; active: () => boolean;
  cancelNotice: (id: string) => void; reconsider: (task: WorkflowTask) => void;
}): RuntimeTaskCapability {
  const { tasks, source, coordinator } = options;
  return {
    list: () => source.list().filter(view => view.kind === "workflow").map(view => ({ view, manageable: true, rawStatus: tasks.get(view.taskId)?.status ?? view.status })),
    async execute(identity, params, signal, onUpdate) {
      const task = tasks.get(identity.taskId);
      const meta = (): Omit<RuntimeTaskMetadata, "version"> => ({ action: params.action, task_type: "workflow", task_id: identity.taskId, run_id: identity.runId,
        title: task?.workflowName ?? task?.id, status: task?.status === "killed" ? "stopped" : task?.status, raw_status: task?.status });
      if (identity.sourceId !== "agent" || !task || identity.runId !== task.id || !options.active()) return taskResult("Workflow is no longer available.", { ...meta(), error_code: "closed" });
      const consume = () => { task.resultConsumed = true; options.cancelNotice(task.id); };
      if (params.action === "stop") {
        const requested = !task.terminalResolved;
        if (requested) {
          // Silent cancellation, not a completion delivery; actual drain remains owned.
          consume(); task.notificationDelivered = true;
          task.abortController.abort();
          for (const record of options.manager.listAgents()) if (record.workflowId === task.id) options.manager.abort(record.id);
        }
        return taskResult(`task_type=workflow task_id=${task.id} run_id=${task.id}\nStop ${requested ? "requested" : "not needed"}; observed status=${task.status}. Worker/host execution may still be draining.`, meta());
      }
      if (params.action === "output") {
        if (task.terminalResolved) consume();
        return taskResult(`task_type=workflow task_id=${task.id} run_id=${task.id}\nScript ${task.terminalResolved ? "return/error" : "still running"}:\n${task.terminalResolved ? task.terminalResult!.text : task.status}\n\nProgress logs (last 100 entries):\n${progressPreview(task.terminalResult?.logs ?? task.logs)}\nJournal: ${task.journalPath ?? "unavailable"}`, meta());
      }
      if (params.action !== "wait") return taskResult("Unsupported workflow action.", { ...meta(), error_code: "unsupported" });
      const lease = coordinator.registerWait<Awaited<WorkflowTask["terminal"]>>({ identity, label: task.workflowName ?? task.id, kind: "retrieval", signal,
        onComplete: consume, cleanup: () => { queueMicrotask(() => options.reconsider(task)); },
      });
      void task.terminal.then(terminal => lease.complete(terminal));
      try {
        if (!lease.settled) try { onUpdate?.(taskResult(`task_id=${task.id} run_id=${task.id}\nWaiting for workflow script return.`, { ...meta(), wait_outcome: "waiting" })); } catch { /* optional presentation sink */ }
        const outcome = await lease.result;
        if (!options.active() || tasks.get(task.id) !== task) return taskResult("Workflow activation is closed.", { ...meta(), error_code: "closed", wait_outcome: "cancelled" });
        if (outcome.kind !== "completed") return taskResult(`task_id=${task.id} run_id=${task.id}\nWait ${outcome.kind === "detached" ? "released" : "cancelled"}; target unchanged.`, { ...meta(), wait_outcome: outcome.kind === "detached" ? "released" : "cancelled" });
        return taskResult(`task_type=workflow task_id=${task.id} run_id=${task.id}\nScript return/error:\n${outcome.value.text}\n\nProgress logs (last 100 entries):\n${progressPreview(outcome.value.logs)}`, { ...meta(), wait_outcome: "completed" });
      } finally { if (!lease.settled) lease.dispose(); }
    },
  };
}
