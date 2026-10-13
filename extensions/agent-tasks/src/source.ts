import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { FINISHED_LINGER_MS } from "../../task-ui/model.ts";
import type { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { taskKey, type TaskDetail, type TaskDetailRequest, type TaskIdentity, type TaskSource, type TaskStatus, type TaskView } from "../../task-ui/types.ts";
import type { AgentManager } from "./agent-manager.ts";
import { extractText } from "./context.ts";
import type { AgentRecord } from "./types.ts";
import { getLifetimeTotal } from "./usage.ts";
import { collapse } from "./workflow/progress.ts";
import type { WorkflowTask } from "./workflow/task.ts";

const MAX_DETAIL = 16_000;
export function agentTaskIdentity(record: Pick<AgentRecord, "id" | "runId">): TaskIdentity {
  return Object.freeze({ sourceId: "agent", taskId: record.id, runId: record.runId ?? "0" });
}
export function workflowTaskIdentity(id: string): TaskIdentity {
  return Object.freeze({ sourceId: "agent", taskId: id, runId: id });
}
function range(request: TaskDetailRequest = {}): { offset: number; limit: number } {
  return {
    offset: Number.isFinite(request.offset) ? Math.max(0, Math.floor(request.offset!)) : 0,
    limit: Number.isFinite(request.limit) ? Math.max(1, Math.min(MAX_DETAIL, Math.floor(request.limit!))) : MAX_DETAIL,
  };
}
function textDetail(text: string, request?: TaskDetailRequest): TaskDetail {
  const { offset, limit } = range(request);
  const start = Math.min(offset, text.length), end = Math.min(start + limit, text.length);
  return Object.freeze({ text: text.slice(start, end), start, end, size: text.length, omittedBefore: start, omittedAfter: text.length - end });
}
/** The transcript writer owns the file format; inspection reads a bounded byte slice only. */
function fileDetail(path: string, request?: TaskDetailRequest): TaskDetail | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile()) return undefined;
    const { offset, limit } = range(request);
    const start = Math.min(request?.offset === undefined ? Math.max(0, stat.size - limit) : offset, stat.size), end = Math.min(start + limit, stat.size);
    const buffer = Buffer.alloc(end - start);
    const bytes = readSync(fd, buffer, 0, buffer.length, start);
    return Object.freeze({ text: buffer.subarray(0, bytes).toString("utf8"), path, start, end: start + bytes,
      size: stat.size, omittedBefore: start, omittedAfter: stat.size - start - bytes });
  } catch { return undefined; }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* a failed detail read owns no runtime */ } } }
}

export function createAgentTaskSource(manager: AgentManager, coordinator: TaskCoordinator, workflows: ReadonlyMap<string, WorkflowTask>): TaskSource {
  let revision = 0, disposed = false;
  const listeners = new Set<() => void>();
  const changed = () => {
    if (disposed) return;
    revision++;
    for (const listener of listeners) { try { listener(); } catch { /* isolate view observers */ } }
  };
  const offBackend = manager.subscribe(changed);
  // General coordinator subscriptions include source changes and would recurse.
  const offWaits = coordinator.subscribeWaits(changed);
  manager.setOwnerRetention(record => {
    if (record.workflowId) {
      const task = workflows.get(record.workflowId);
      if (task?.status === "running" || task?.status === "paused") return true;
      // A fresh panel cannot recover metadata swept before its first read.
      // Match the whole group's display window, not the child's completion age.
      if (task?.endTime !== undefined && Date.now() - task.endTime < FINISHED_LINGER_MS) return true;
    }
    return !!record.parentAgentId && manager.isRunActive(record.parentAgentId);
  });
  const source: TaskSource = {
    sourceId: "agent",
    get revision() { return revision; },
    list() {
      if (disposed) return Object.freeze([]);
      const views: TaskView[] = manager.listAgents().map(record => {
        const identity = agentTaskIdentity(record);
        const parent = record.parentAgentId ? manager.getRecord(record.parentAgentId) : undefined;
        const parentKey = record.parentAgentId ? taskKey({ sourceId: "agent", taskId: record.parentAgentId, runId: record.parentRunId ?? parent?.runId ?? "0" }) : record.workflowId ? taskKey(workflowTaskIdentity(record.workflowId)) : undefined;
        const status: TaskStatus = record.status === "queued" ? "queued" : record.status === "running" ? record.starting ? "starting" : "running" :
          record.status === "error" ? "failed" : record.status === "stopped" || record.status === "aborted" ? "stopped" : "completed";
        const artifacts: TaskView["artifacts"][number][] = [];
        if (record.outputFile) artifacts.push(Object.freeze({ kind: "conversation", path: record.outputFile }));
        if (record.sessionFile) artifacts.push(Object.freeze({ kind: "conversation", path: record.sessionFile }));
        if (record.worktree) artifacts.push(Object.freeze({ kind: "worktree", path: record.worktree.path }));
        return Object.freeze({ ...identity, key: taskKey(identity), parentKey, kind: "agent" as const,
          title: record.alias ?? record.handle ?? record.type, description: record.description, status,
          executionMode: parentKey ? "owned" as const : record.isBackground === false ? "foreground" as const : "background" as const,
          waitCount: coordinator.countWaits(identity), startedAt: record.startedAt, endedAt: record.completedAt,
          stats: Object.freeze({ tokens: getLifetimeTotal(record.lifetimeUsage), inputTokens: record.lifetimeUsage.input,
            outputTokens: record.lifetimeUsage.output, cost: record.lifetimeUsage.cost, toolUses: record.toolUses,
            turnCount: record.turnCount, maxTurns: record.invocation?.maxTurns, activity: record.activity,
            model: record.invocation?.modelId ?? record.invocation?.modelName, thinking: record.invocation?.thinking,
            durationMs: (record.completedAt ?? Date.now()) - record.startedAt }),
          artifacts: Object.freeze(artifacts), capabilities: Object.freeze({ stop: status === "starting" || status === "running" || status === "queued", details: true }),
        });
      });
      for (const task of workflows.values()) {
        const identity = workflowTaskIdentity(task.id);
        const declared = new Map((task.meta?.phases ?? []).map((phase, index) => [index, { index, title: phase.title, detail: phase.detail }]));
        for (const entry of task.workflowProgress) if (entry.type === "workflow_phase") declared.set(entry.index, { index: entry.index, title: entry.title, detail: declared.get(entry.index)?.detail });
        const phases = Object.freeze([...declared.values()].map(phase => Object.freeze(phase)));
        views.push(Object.freeze({ ...identity, key: taskKey(identity), kind: "workflow", title: task.meta?.name ?? task.workflowName ?? task.id,
          status: task.status === "killed" ? "stopped" : task.status, executionMode: "background", waitCount: coordinator.countWaits(identity),
          startedAt: task.startTime, endedAt: task.endTime,
          stats: Object.freeze({ tokens: task.totalTokens, toolUses: task.totalToolCalls, doneCount: task.doneCount, totalCount: task.agentCount, phases }),
          artifacts: Object.freeze(task.journalPath ? [Object.freeze({ kind: "log" as const, path: task.journalPath })] : []),
          capabilities: Object.freeze({ stop: task.status === "running" || task.status === "paused", details: true }),
        }));
      }
      return Object.freeze(views);
    },
    detail(identity, request) {
      if (disposed || identity.sourceId !== "agent") return undefined;
      const task = workflows.get(identity.taskId);
      if (task && identity.runId === task.id) {
        const phases = (task.meta?.phases ?? []).map((phase, index) => `${index}: ${phase.title}${phase.detail ? ` — ${phase.detail}` : ""}`);
        const active = task.workflowProgress.filter(entry => entry.type === "workflow_phase").map(entry => `${entry.index}: ${entry.title}`);
        const progress = collapse(task.workflowProgress).agents;
        const childProgress = progress.slice(-32).map(agent => `${agent.label.slice(0, 256)}: ${agent.state}${agent.phaseTitle ? ` — ${agent.phaseTitle.slice(0, 256)}` : ""}${agent.error ? ` (${agent.error.slice(0, 512)})` : ""}`).join("\n");
        const text = `${task.meta?.name ?? task.id} — ${task.status}\nAgents: ${task.doneCount}/${task.agentCount}\n` +
          (phases.length ? `Declared progress phases:\n${phases.join("\n")}\n` : "No progress phase declared.\n") +
          (active.length ? `Reached phases:\n${active.join("\n")}\n` : "") +
          `${childProgress}\n${progress.length > 32 ? "[Older child progress omitted.]\n" : ""}` +
          task.logs.slice(-32).map(log => log.slice(0, 1024)).join("\n") +
          (task.logs.length > 32 ? "\n[Older workflow log entries omitted; inspect the journal artifact.]" : "") +
          (task.error ? `\nError: ${task.error.slice(0, MAX_DETAIL)}` : "");
        return textDetail(text, request);
      }
      const record = manager.getRecord(identity.taskId);
      if (!record || record.runId !== identity.runId) return undefined;
      if (record.outputFile) {
        const detail = fileDetail(record.outputFile, request);
        if (detail) return detail;
      }
      // Do not materialize the full conversation: bound each extraction and the
      // assembled preview. The disk transcript, when enabled, is the paged path.
      let preview = "Transcript unavailable; bounded in-memory preview (older/large content may be omitted).\n";
      for (const message of record.session?.messages.slice(-32) ?? []) {
        preview += `${message.role}: ${("content" in message ? typeof message.content === "string" ? message.content.slice(0, 1024) : extractText(message.content.slice(0, 8).map(block => block.type === "text" ? { ...block, text: block.text.slice(0, 1024) } : block)).slice(0, 1024) : "[non-conversation event omitted]")}\n`;
        if (preview.length >= MAX_DETAIL) break;
      }
      if (!record.session) preview += `${record.status === "queued" ? "Queued" : record.starting ? "Starting" : record.status}: conversation not established.\n`;
      preview += record.error?.slice(0, MAX_DETAIL) ?? record.result?.slice(0, MAX_DETAIL) ?? "";
      return textDetail(preview.slice(0, MAX_DETAIL), request);
    },
    stop(identity) {
      if (disposed || identity.sourceId !== "agent") return false;
      const task = workflows.get(identity.taskId);
      if (task && task.id === identity.runId && (task.status === "running" || task.status === "paused")) {
        task.abortController.abort();
        for (const record of manager.listAgents()) if (record.workflowId === task.id) manager.abort(record.id);
        manager.notifyChanged(); return true;
      }
      return manager.stopRun(identity);
    },
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      if (disposed) return;
      disposed = true; offBackend(); offWaits(); manager.setOwnerRetention(); listeners.clear();
    },
  };
  return Object.freeze(source);
}
