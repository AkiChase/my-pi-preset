import { copyAgentExecutionConfig } from "../../runtime-tasks/execution-config.ts";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { FINISHED_LINGER_MS } from "../../task-ui/model.ts";
import type { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { taskKey, type ConversationEntry, type TaskDetail, type TaskMessageEntry, type TaskDetailRequest, type TaskIdentity, type TaskSource, type TaskStatus, type TaskView } from "../../task-ui/types.ts";
import type { AgentManager } from "./agent-manager.ts";
import { extractText } from "./context.ts";
import { resumeKey } from "./mention.ts";
import { MAX_TEXT } from "./conversation-entries.ts";
import { ConversationPager, MAX_PAGE_BYTES } from "./conversation-paging.ts";
import type { AgentRecord } from "./types.ts";
import { getLifetimeTotal } from "./usage.ts";
import { collapse, displayState, type WorkflowAgentEntry } from "./workflow/progress.ts";
import { pauseWorkflowTask, resumeWorkflowTask } from "./workflow/task.ts";
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

/** The final answer/error lives on the record; show it when the bounded messages do not end with it. */
function withOutcome(entries: readonly ConversationEntry[], record: AgentRecord): readonly ConversationEntry[] {
  const extra: ConversationEntry[] = [];
  const result = record.result?.trim();
  const last = [...entries].reverse().find(entry => entry.kind === "assistant");
  if (result && (last?.kind !== "assistant" || last.text.trim() !== result.slice(0, MAX_TEXT).trim()))
    extra.push(Object.freeze({ id: `${taskKey(agentTaskIdentity(record))}:outcome`, kind: "assistant" as const, text: result.slice(0, MAX_TEXT), tools: Object.freeze([]) }));
  if (record.status === "error" && record.error) extra.push(Object.freeze({ id: `${taskKey(agentTaskIdentity(record))}:error`, kind: "notice" as const, text: `Error: ${record.error.slice(0, 2_000)}` }));
  return extra.length ? Object.freeze([...entries, ...extra]) : entries;
}

/** A workflow still accepting control: active status and a live control handle. */
function controllable(task: WorkflowTask | undefined): task is WorkflowTask & { control: NonNullable<WorkflowTask["control"]> } {
  return !!task && (task.status === "running" || task.status === "paused") && task.control !== undefined;
}
/** Workflow children answer to their script, not the user; only independent live agents take steering. */
function steerable(record: AgentRecord): boolean {
  return !record.workflowId && (record.status === "running" || record.status === "queued");
}
/** The workflow progress row that owns a child record, by manager record id. */
function childEntry(task: WorkflowTask, recordId: string): WorkflowAgentEntry | undefined {
  return collapse(task.workflowProgress).agents.find(entry => entry.recordId === recordId);
}
/** Skip covers the whole unanswered window; retry needs a running child to restart. */
function childActions(task: WorkflowTask | undefined, record: AgentRecord): { skip: boolean; retry: boolean } {
  if (!controllable(task) || !record.workflowId) return { skip: false, retry: false };
  const entry = childEntry(task, record.id);
  if (!entry) return { skip: false, retry: false };
  const state = displayState(entry, true);
  return { skip: state === "queued" || state === "running", retry: state === "running" };
}

const MESSAGE_PREVIEW = 160;
/** Message headers/styles consume a small fixed amount in the detail budget. */
const MESSAGE_DETAIL_OVERHEAD = 128;
/** Messages of one execution, oldest first, bounded by the requested detail budget. */
function executionMessages(record: AgentRecord, runId: string, budget: number): { entries: readonly TaskMessageEntry[]; omitted: number } {
  const mailbox = record.mailbox;
  if (!mailbox) return { entries: [], omitted: 0 };
  const entries: TaskMessageEntry[] = [
    ...mailbox.listRequests(runId).map(request => Object.freeze({ kind: "question" as const, requestId: request.requestId, state: request.state, text: request.question, at: request.createdAt })),
    ...mailbox.listMessages(runId).map(message => Object.freeze(message.requestId
      ? { kind: "reply" as const, requestId: message.requestId, text: message.text, at: message.at }
      : { kind: "notice" as const, text: message.text, at: message.at })),
  ];
  // Stable: a question precedes a reply sharing its timestamp.
  const ordered = entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.at - b.entry.at || a.index - b.index).map(({ entry }) => entry);
  let start = ordered.length;
  let used = 0;
  for (let index = ordered.length - 1; index >= 0; index--) {
    const size = Buffer.byteLength(ordered[index]!.text, "utf8") + MESSAGE_DETAIL_OVERHEAD;
    if (used + size > budget) break;
    used += size;
    start = index;
  }
  return { entries: Object.freeze(ordered.slice(start)), omitted: start };
}
function latestMessage(record: AgentRecord): string | undefined {
  if (record.status !== "running" || !record.mailbox || !record.runId) return undefined;
  const last = record.mailbox.listMessages(record.runId).at(-1);
  if (!last) return undefined;
  const text = last.text.replace(/\s+/g, " ").trim();
  return (last.requestId ? "reply: " : "notice: ") + (text.length > MESSAGE_PREVIEW ? text.slice(0, MESSAGE_PREVIEW - 1) + "…" : text);
}

export function createAgentTaskSource(manager: AgentManager, coordinator: TaskCoordinator, workflows: ReadonlyMap<string, WorkflowTask>, options: { observe?: boolean; filter?: (record: AgentRecord) => boolean } = {}): TaskSource {
  const pager = new ConversationPager();
  let revision = 0, disposed = false;
  const listeners = new Set<() => void>();
  const changed = () => {
    if (disposed) return;
    revision++;
    for (const listener of listeners) { try { listener(); } catch { /* isolate view observers */ } }
  };
  const offBackend = options.observe === false ? () => {} : manager.subscribe(changed);
  // General coordinator subscriptions include source changes and would recurse.
  const offWaits = options.observe === false ? () => {} : coordinator.subscribeWaits(changed);
  if (options.observe !== false) manager.setOwnerRetention(record => {
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
      const views: TaskView[] = manager.listAgents().filter(record => !options.filter || options.filter(record)).map(record => {
        const identity = agentTaskIdentity(record);
        const parent = record.parentAgentId ? manager.getRecord(record.parentAgentId) : undefined;
        const parentKey = record.parentAgentId ? taskKey({ sourceId: "agent", taskId: record.parentAgentId, runId: record.parentRunId ?? parent?.runId ?? "0" }) : record.workflowId ? taskKey(workflowTaskIdentity(record.workflowId)) : undefined;
        const status: TaskStatus = record.status === "queued" ? "queued" : record.status === "running" ? record.starting ? "starting" : "running" :
          record.status === "error" ? "failed" : record.status === "interrupted" ? "interrupted" : record.status === "stopped" || record.status === "aborted" ? "stopped" : "completed";
        const artifacts: TaskView["artifacts"][number][] = [];
        if (record.outputFile) artifacts.push(Object.freeze({ kind: "conversation", path: record.outputFile }));
        if (record.sessionFile) artifacts.push(Object.freeze({ kind: "conversation", path: record.sessionFile }));
        if (record.worktree) artifacts.push(Object.freeze({ kind: "worktree", path: record.worktree.path }));
        return Object.freeze({ ...identity, key: taskKey(identity), parentKey, kind: "agent" as const,
          title: Number.isSafeInteger(record.registryIndex) && record.registryIndex! >= 0 ? resumeKey(record.type, record.registryIndex!) : record.id, description: `${record.type} · ${record.description}${record.status === "interrupted" ? " · interrupted by Pi exit; resume to continue" : ""}`, status,
          executionMode: parentKey ? "owned" as const : record.isBackground === false ? "foreground" as const : "background" as const,
          waitCount: coordinator.countWaits(identity), startedAt: record.startedAt, endedAt: record.completedAt,
          executionConfig: copyAgentExecutionConfig(record.executionConfig),
          stats: Object.freeze({ tokens: getLifetimeTotal(record.lifetimeUsage), inputTokens: record.lifetimeUsage.input,
            outputTokens: record.lifetimeUsage.output, cost: record.lifetimeUsage.cost, toolUses: record.toolUses,
            turnCount: record.turnCount, maxTurns: record.maxTurns, activity: status === "running" || status === "starting" ? record.activity : undefined,
            toolCalls: manager.getToolCalls?.(record.id),
            settling: status !== "running" && status !== "starting" && status !== "queued" && manager.isRunSettling?.(record.id) === true,
            latestMessage: latestMessage(record),
            model: record.executionConfig ? record.executionConfig.model : record.invocation?.modelId ?? record.invocation?.modelName,
            thinking: record.executionConfig ? record.executionConfig.thinking : record.invocation?.thinking,
            durationMs: (record.completedAt ?? Date.now()) - record.startedAt }),
          artifacts: Object.freeze(artifacts), capabilities: Object.freeze({ stop: status === "starting" || status === "running" || status === "queued", details: true,
            steer: steerable(record),
            ...childActions(record.workflowId ? workflows.get(record.workflowId) : undefined, record) }),
        });
      });
      for (const task of workflows.values()) {
        const identity = workflowTaskIdentity(task.id);
        const declared = new Map((task.meta?.phases ?? []).map((phase, index) => [index, { index, title: phase.title, detail: phase.detail }]));
        for (const entry of task.workflowProgress) if (entry.type === "workflow_phase") declared.set(entry.index, { index: entry.index, title: entry.title, detail: declared.get(entry.index)?.detail });
        const phases = Object.freeze([...declared.values()].map(phase => Object.freeze(phase)));
        views.push(Object.freeze({ ...identity, key: taskKey(identity), kind: "workflow", title: task.meta?.name ?? task.workflowName ?? task.id, description: task.meta?.description,
          status: task.status === "killed" ? "stopped" : task.status, executionMode: "background", waitCount: coordinator.countWaits(identity),
          startedAt: task.startTime, endedAt: task.endTime,
          stats: Object.freeze({ tokens: task.totalTokens, toolUses: task.totalToolCalls, doneCount: task.doneCount, totalCount: task.agentCount, phases }),
          artifacts: Object.freeze(task.journalPath ? [Object.freeze({ kind: "log" as const, path: task.journalPath })] : []),
          capabilities: Object.freeze({ stop: task.status === "running" || task.status === "paused", details: true,
            pause: controllable(task) && task.status === "running", resume: controllable(task) && task.status === "paused" }),
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
      if (!record || record.runId !== identity.runId || (options.filter && !options.filter(record))) return undefined;
      // The source owns stable IDs and bounded cursors, even for legacy latest reads.
      const rawPage = record.session
        ? pager.livePage(taskKey(identity), record.session, record.session.messages, record.compactionCount, request?.conversationPage)
        : record.outputFile ? pager.transcriptPage(taskKey(identity), record.outputFile, request?.conversationPage) : pager.unavailable();
      // Terminal annotations are not transcript positions. Only append at the
      // latest boundary; keep both cursors anchored to real messages unchanged.
      const tail = rawPage.status === "ok" && !rawPage.hasNewer ||
        rawPage.status === "unavailable" && (request?.conversationPage?.direction ?? "latest") === "latest";
      const outcomeEntries = tail ? withOutcome(rawPage.entries, record) : rawPage.entries;
      const entries = Buffer.byteLength(JSON.stringify(outcomeEntries)) <= MAX_PAGE_BYTES ? outcomeEntries : rawPage.entries;
      const page = entries === rawPage.entries ? rawPage : Object.freeze({ ...rawPage, entries });
      const conversation = {
        ...(request?.conversationPage || page.source !== "unavailable" ? {
          conversation: page.entries,
          conversationTruncated: page.hasOlder,
        } : { conversation: withOutcome([], record).length ? withOutcome([], record) : undefined }),
        ...(request?.conversationPage ? { conversationPage: page } : {}),
      };
      const messages = executionMessages(record, identity.runId, range(request).limit);
      if (messages.entries.length || messages.omitted) Object.assign(conversation, { messages: messages.entries, ...(messages.omitted ? { messagesOmitted: messages.omitted } : {}) });
      if (record.outputFile) {
        const detail = fileDetail(record.outputFile, request);
        if (detail) return Object.freeze({ ...detail, ...conversation });
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
      return Object.freeze({ ...textDetail(preview.slice(0, MAX_DETAIL), request), ...conversation });
    },
    stop(identity) {
      if (disposed || identity.sourceId !== "agent") return false;
      const task = workflows.get(identity.taskId);
      if (task && task.id === identity.runId && (task.status === "running" || task.status === "paused")) {
        task.abortController.abort();
        for (const record of manager.listAgents()) if (record.workflowId === task.id) manager.abort(record.id);
        manager.notifyChanged(); return true;
      }
      const record = manager.getRecord(identity.taskId);
      return record !== undefined && (!options.filter || options.filter(record)) && manager.stopRun(identity);
    },
    steer(identity, message) {
      if (disposed || identity.sourceId !== "agent" || !message.trim()) return false;
      const record = manager.getRecord(identity.taskId);
      if (!record || record.runId !== identity.runId || !steerable(record) || (options.filter && !options.filter(record))) return false;
      return manager.steer(record.id, message);
    },
    control(identity, action) {
      if (disposed || identity.sourceId !== "agent") return false;
      const task = workflows.get(identity.taskId);
      if (task && identity.runId === task.id) {
        if (action === "pause") return pauseWorkflowTask(task);
        if (action === "resume") return resumeWorkflowTask(task);
        return false;
      }
      if (action !== "skip" && action !== "retry") return false;
      const record = manager.getRecord(identity.taskId);
      if (!record || record.runId !== identity.runId || (options.filter && !options.filter(record))) return false;
      const parent = record.workflowId ? workflows.get(record.workflowId) : undefined;
      // Recheck the current window: the row may have settled since the panel rendered.
      if (!childActions(parent, record)[action] || !controllable(parent)) return false;
      const entry = childEntry(parent, record.id)!;
      return parent.control[action](entry.index);
    },
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      if (disposed) return;
      disposed = true; pager.dispose(); offBackend(); offWaits(); if (options.observe !== false) manager.setOwnerRetention(); listeners.clear();
    },
  };
  return Object.freeze(source);
}
