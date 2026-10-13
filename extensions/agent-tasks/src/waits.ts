import type { TaskCoordinator } from "../../task-ui/coordinator.ts";
import type { WaitLease } from "../../task-ui/types.ts";
import type { AgentManager, AgentRunHandle } from "./agent-manager.ts";
import type { AgentRecord } from "./types.ts";

/** Waits own no execution: only a launch's winning callbacks transfer or stop it. */
export function registerAgentWait(
  manager: AgentManager, coordinator: TaskCoordinator, run: AgentRunHandle,
  kind: "launch" | "retrieval", signal?: AbortSignal,
  reconsider?: () => void,
): WaitLease<AgentRecord> {
  const lease = coordinator.registerWait<AgentRecord>({
    identity: run.identity, label: `Agent ${run.identity.taskId}`, kind, signal,
    onDetach: () => {
      if (!manager.detachRun(run.identity)) throw new Error("Agent launch lost its execution ownership");
    },
    onInterrupt: () => { manager.stopRun(run.identity); },
    onDispose: kind === "launch" ? () => { manager.stopRun(run.identity); } : undefined,
    onComplete: () => { manager.consumeRun(run.identity); },
    // Reconsider after the coordinator has removed this wait. A microtask also
    // lets a completed winner consume before a suppressed terminal notice runs.
    cleanup: () => { if (reconsider) queueMicrotask(reconsider); },
  });
  void run.terminal.then(record => { lease.complete(record); });
  return lease;
}

/** Capture runId at scheduling, never let an old nudge deliver a resumed record. */
export function canDeliverAgentResult(
  manager: AgentManager, coordinator: TaskCoordinator, record: AgentRecord, runId: string | undefined,
): boolean {
  const live = manager.getRecord(record.id);
  return live !== undefined && live.runId === runId && record.runId === runId &&
    live.completedAt !== undefined && !manager.isRunActive(record.id) &&
    live.status !== "stopped" && !live.resultConsumed && !live.notificationDelivered &&
    coordinator.countWaits({ sourceId: "agent", taskId: record.id, runId: runId ?? "0" }) === 0;
}
