import { copyAgentExecutionConfig, agentExecutionSummary } from "../../runtime-tasks/execution-config.ts";
import { executionId } from "../../runtime-tasks/execution-id.ts";
import type { RuntimeTaskCapability } from "../../runtime-tasks/facade.ts";
import { taskResult as runtimeResult, type RuntimeTaskMetadata } from "../../runtime-tasks/contracts.ts";
import type { AgentManager } from "./agent-manager.ts";
import type { AgentRecord } from "./types.ts";
import type { TaskCoordinator } from "../../task-ui/coordinator.ts";
import type { TaskSource } from "../../task-ui/types.ts";
import { registerAgentWait } from "./waits.ts";

function taskResult(text: string, metadata: Omit<RuntimeTaskMetadata, "version">) {
  return runtimeResult(agentExecutionSummary(metadata.executionConfig) + text, metadata);
}

export function createAgentManagement(options: {
  manager: AgentManager; coordinator: TaskCoordinator; source: TaskSource; active: () => boolean;
  owns: (record: AgentRecord) => boolean;
  format: (record: AgentRecord, verbose?: boolean) => string;
  cancelNotice: (id: string) => void; reconsider: (record: AgentRecord) => void;
}): RuntimeTaskCapability {
  const { manager, coordinator, source } = options;
  return {
    list: () => source.list().filter(view => view.kind === "agent").map(view => {
      const record = manager.getRecord(view.taskId);
      return { view, manageable: record !== undefined && options.owns(record), rawStatus: record?.status ?? view.status };
    }),
    async execute(identity, params, signal, onUpdate) {
      const record = manager.getRecord(identity.taskId);
      const run = manager.getRun(identity.taskId);
      const initial = record ? { ...record } : undefined;
      const meta = (snapshot = initial): Omit<RuntimeTaskMetadata, "version"> => ({ action: params.action, task_type: "subagent", task_id: identity.taskId, run_id: identity.runId,
        executionConfig: copyAgentExecutionConfig(snapshot?.executionConfig),
        stats: snapshot ? { toolUses: snapshot.toolUses, duration_ms: Math.max(0, (snapshot.completedAt ?? Date.now()) - snapshot.startedAt), turnCount: snapshot.turnCount ?? 0, ...(snapshot.lifetimeUsage ? { inputTokens: snapshot.lifetimeUsage.input, outputTokens: snapshot.lifetimeUsage.output, cost: snapshot.lifetimeUsage.cost } : {}) } : undefined,
        title: snapshot?.description, raw_status: snapshot?.status,
        status: snapshot?.status === "error" ? "failed" : snapshot?.status === "aborted" || snapshot?.status === "stopped" ? "stopped" : snapshot?.status === "steered" ? "completed" : snapshot?.status,
      });
      if (identity.sourceId !== "agent" || !record || !run || run.identity.runId !== identity.runId || !options.active()) return taskResult("Subagent run is no longer available.", { ...meta(), error_code: "stale" });
      if (!options.owns(record)) return taskResult("Subagent belongs to another owner.", { ...meta(), error_code: "forbidden" });
      const currentTarget = () => options.active() && manager.getRecord(record.id) === record && manager.getRun(record.id)?.identity.runId === identity.runId && options.owns(record);
      if (params.action === "stop") {
        if (!currentTarget()) return taskResult("Subagent run is no longer available.", { ...meta(), error_code: "stale" });
        const requested = manager.stopRun(identity);
        return taskResult(`kind=subagent agent_id=${identity.taskId} execution_id=${executionId({ taskId: identity.taskId, runId: identity.runId }, "subagent")}\nStop ${requested ? "requested" : "not needed"}; observed status=${record.status}. Cancellation is cooperative; actual execution may still be draining.`, { ...meta({ ...record }) });
      }
      if (params.action === "output") {
        const snapshot = record.status === "running" || record.status === "queued" ? record : await run.terminal;
        if (!options.active()) return taskResult("Subagent activation is closed.", { ...meta(snapshot), error_code: "closed" });
        const text = options.format(snapshot, params.verbose);
        if (currentTarget() && manager.consumeRun(identity) && currentTarget()) options.cancelNotice(record.id);
        return taskResult(`kind=subagent agent_id=${record.id} execution_id=${executionId({ taskId: record.id, runId: identity.runId }, "subagent")}\n${text}`, meta(snapshot));
      }
      if (params.action !== "wait") return taskResult("Unsupported subagent action.", { ...meta(), error_code: "unsupported" });
      const lease = registerAgentWait(manager, coordinator, run, "retrieval", signal, () => { if (currentTarget()) options.reconsider(record); }, currentTarget);
      try {
        if (!lease.settled) try { onUpdate?.(taskResult(`execution_id=${executionId(identity, "subagent")}\nWaiting for subagent final answer.`, { ...meta(), wait_outcome: "waiting" })); } catch { /* optional presentation sink */ }
        const outcome = await lease.result;
        if (!options.active()) return taskResult("Subagent activation is closed.", { ...meta(), error_code: "closed", wait_outcome: "cancelled" });
        if (outcome.kind !== "completed") return taskResult(`execution_id=${executionId(identity, "subagent")}\nWait ${outcome.kind === "detached" ? "released" : "cancelled"}; target unchanged.`, { ...meta(), wait_outcome: outcome.kind === "detached" ? "released" : "cancelled" });
        if (currentTarget()) options.cancelNotice(record.id);
        return taskResult(`kind=subagent agent_id=${record.id} execution_id=${executionId({ taskId: record.id, runId: identity.runId }, "subagent")}\n${options.format(outcome.value, params.verbose)}`, { ...meta(outcome.value), wait_outcome: "completed" });
      } finally { if (!lease.settled) lease.dispose(); }
    },
  };
}
