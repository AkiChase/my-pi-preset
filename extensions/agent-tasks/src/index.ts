import { executionConfigRows } from "../../beautify/execution-config.ts";
import { clean, wrap } from "../../beautify/layout.ts";
import { component } from "../../beautify/tools/shared.ts";
import { copyAgentExecutionConfig, agentExecutionSummary } from "../../runtime-tasks/execution-config.ts";
import { registerBuiltinSkills } from "./builtin-skills.ts";
import { nullableControl } from "../../shared/tool-arguments.ts";
import { createToolCallHeading } from "../../beautify/tool-call-heading.ts";
import { executionId } from "../../runtime-tasks/execution-id.ts";
import { launchMetadata, launchText, isLaunchMetadata } from "../../runtime-tasks/launch.ts";
import { createAgentManagement } from "./management.ts";
import { createWorkflowManagement } from "./workflow/management.ts";
import type { RuntimeTaskCapability } from "../../runtime-tasks/facade.ts";

import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
/**
 * pi-agents — A pi extension providing Claude Code-style autonomous sub-agents.
 *
 * Tools:
 *   subagent_run      — LLM-callable: spawn or resume a subagent
 *   subagent_workflow — LLM-callable: execute an opted-in workflow
 *   subagent_message  — LLM-callable: guide a running subagent
 * Management is registered once by composition as agent_manage.
 *
 * Commands:
 *   /agents-config          — Agent types and settings
 *   /agents-create          — Create a new agent type
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { defineTool, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SettingItem, SettingsList, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { renderAgentName } from "./agent-color.ts";
import { buildNewAgentFile, disableInContent, enableInContent, isEmptyStub, locateAgentFile, personalAgentsDir, projectAgentsDir, serializeAgentFile } from "./agent-file-toggle.ts";
import type { AgentManagerDependencies } from "./agent-manager.ts";
import { createAgentTaskSource } from "./source.ts";
import { registerAgentWait, canDeliverAgentResult } from "./waits.ts";
import { AgentManager, isTopLevelAgent } from "./agent-manager.ts";
import { getAgentConversation, getDefaultMaxTurns, getGraceTurns, getRememberAgents, normalizeMaxTurns, resolveEffectiveMaxTurns, SUBAGENT_TOOL_NAMES, setDefaultMaxTurns, setGraceTurns, setRememberAgents, steerAgent } from "./agent-runner.ts";
import { BUILTIN_TOOL_NAMES, getAgentConfig, getAllTypes, getAvailableTypes, getConfig, getFallbackSubagent, isDefaultsDisabled, NO_FALLBACK, registerAgents, resolveSpawnType, resolveType, setDefaultsDisabled, setFallbackSubagent } from "./agent-types.ts";
import { inChildSessionContext, runInChildSessionContext } from "./child-context.ts";
// Expose the same context instance as the activation guard for host-loader probes.
export { runInChildSessionContext };
import { type RpcHandle, registerRpcHandlers } from "./cross-extension-rpc.ts";
import { loadCustomAgents } from "./custom-agents.ts";
import { GroupJoinManager } from "./group-join.ts";
import { isolationParam, resolveAgentInvocationConfig, resolveJoinMode, THINKING_LEVELS, thinkingParam } from "./invocation-config.ts";
import { describeMention, handleBase, isReservedHandle, parseMention, resolveHandleToType, stripAgentPrefix } from "./mention.ts";
import { runMentionClone } from "./mention-clone.ts";
import { describeModel, type ModelRegistry, resolveModel } from "./model-resolver.ts";
import { checkModelScope, isScopeModelsEnabled, setScopeModelsEnabled } from "./model-scope.ts";
import { getMaxSubagentDepth, setMaxSubagentDepth } from "./nested-tools.ts";
import { createOutputFilePath, ensureOutputFile, getOutputTranscriptDefault, sessionTaskDir, setOutputTranscriptDefault, streamToOutputFile, writeInitialEntry } from "./output-file.ts";
import { applyAndEmitLoaded, loadSettings, type SubagentsSettings, saveAndEmitChanged } from "./settings.ts";
import { getForegroundOutcomeNote, getStatusNote, partialOutputSuffix } from "./status-note.ts";
import { type AgentConfig, type AgentInvocation, type AgentMentionMode, type AgentRecord, type JoinMode, type NotificationDetails, type SubagentType } from "./types.ts";
import { createMentionProvider, mentionRoster, type TypeInfo } from "./ui/agent-mention.ts";
import {
  type AgentActivity,
  type AgentDetails,
  buildInvocationTags,
  describeActivity,
  fgPreservingNestedStyles,
  formatCost,
  formatDuration,
  formatMs,
  formatTokens,
  formatTurns,
  getDisplayName,
  getPromptModeLabel,
  SPINNER,
  type Theme,
} from "./activity.ts";
import { renderWorkflowCard, renderWorkflowEntryCard } from "./ui/workflow-card.ts";
import { getLifetimeCost, getLifetimeTotal, getSessionContextPercent, type LifetimeUsage, PendingUsagePool, toReportedUsage } from "./usage.ts";
import { decideWorkflowCollision, FOREIGN_WORKFLOW_TOOL_NAMES } from "./workflow/collisions.ts";
import { WORKFLOW_ENTRY_TYPE, type WorkflowEntryData, workflowEntryData } from "./workflow/entry.ts";
import { createWorkflowHost } from "./workflow/host.ts";
import { appendJournal, readJournal, type WorkflowJournalEntry } from "./workflow/journal.ts";
import { extractMeta, type WorkflowMeta, workflowCallName } from "./workflow/meta.ts";
import { elapsedMs } from "./workflow/progress.ts";
import { runWorkflow, validateScript, assertBoundarySafe } from "./workflow/runtime.ts";
import { resolveWorkflowScript } from "./workflow/saved.ts";
import { completeWorkflowTask, createWorkflowTask, failWorkflowTask, formatWorkflowNotification, resolveResumeTarget, updateWorkflowProgressBatch, type WorkflowTask, workflowResultText, workflowRunId } from "./workflow/task.ts";
import { workflowToolGuidance } from "./workflow/tool-description.ts";
import { isWorktreeIsolationEnabled, setWorktreeIsolationEnabled } from "./worktree.ts";
import { runToolGuidance, messageToolGuidance } from "./tool-guidance.ts";
import { parseAgentToolArguments, assertMessageToolArguments, parseWorkflowToolArguments } from "./tool-contract.ts";
import { assertNonEmptyString, assertSpawnInput, normalizeAgentDescription, parseSpawnOptions } from "./spawn-input.ts";
import { escapeXml } from "./xml.ts";

// ---- Shared helpers ----

/** Tool execute return value for a text response. */
function textResult(msg: string, details?: AgentDetails) {
  const identity = (details as { runtimeLaunch?: unknown } | undefined)?.runtimeLaunch;
  return { content: [{ type: "text" as const, text: isLaunchMetadata(identity) ? `${launchText(identity)}\n${agentExecutionSummary(details?.executionConfig)}${msg}` : msg }], details: details as any };
}

/**
 * A refusal: the call did not run, or ran and failed.
 *
 * `isError` is what makes that visible. Without it the text still reaches the
 * model, but as an ordinary successful result — so an unrecognised agent type, a
 * steering failure or a crashed run reads exactly like a normal completion, and
 * a caller that branches on success takes the wrong branch.
 *
 * Queued messages and detached hand-offs are successful admission, not proof
 * of completion. A refused resume is an error because no new run was started.
 */
function errorResult(msg: string, details?: AgentDetails) {
  return { ...textResult(msg, details), isError: true };
}

export function renderRunningAgentStatus(
  frame: string,
  statsText: string,
  activity: string,
  theme: Pick<Theme, "fg">,
): Container {
  const container = new Container();
  container.addChild(new Text(theme.fg("accent", frame) + (statsText ? " " + statsText : ""), 0, 0));
  container.addChild(new Text(theme.fg("dim", `  ⎿  ${activity}`), 0, 0));
  return container;
}

/** Format an agent's lifetime token total, or "" when zero. */
function formatLifetimeTokens(o: { lifetimeUsage: LifetimeUsage }): string {
  const t = getLifetimeTotal(o.lifetimeUsage);
  return t > 0 ? formatTokens(t) : "";
}

/**
 * Create an AgentActivity state and spawn callbacks for tracking tool usage.
 * Used by both foreground and background paths to avoid duplication.
 */
function createActivityTracker(maxTurns?: number, onStreamUpdate?: () => void) {
  const state: AgentActivity = {
    activeTools: new Map(),
    toolUses: 0,
    turnCount: 1,
    maxTurns,
    responseText: "",
    session: undefined,
  };

  const callbacks = {
    onToolActivity: (activity: { type: "start" | "end"; toolName: string }) => {
      if (activity.type === "start") {
        state.activeTools.set(activity.toolName + "_" + Date.now(), activity.toolName);
      } else {
        for (const [key, name] of state.activeTools) {
          if (name === activity.toolName) { state.activeTools.delete(key); break; }
        }
        state.toolUses++;
      }
      onStreamUpdate?.();
    },
    onTextDelta: (_delta: string, fullText: string) => {
      state.responseText = fullText;
      onStreamUpdate?.();
    },
    onTurnEnd: (turnCount: number) => {
      state.turnCount = turnCount;
      onStreamUpdate?.();
    },
    onSessionCreated: (session: any) => {
      state.session = session;
    },
    // Spend is accumulated on the AgentRecord (agent-manager), which is what
    // every surface reads; this callback exists here only to repaint on it.
    onAssistantUsage: (_usage: LifetimeUsage) => {
      onStreamUpdate?.();
    },
  };

  return { state, callbacks };
}

/** Human-readable status label for agent completion. */
function getStatusLabel(status: string, error?: string): string {
  switch (status) {
    case "error": return `Error: ${error ?? "unknown"}`;
    case "aborted": return "Aborted (max turns exceeded)";
    case "steered": return "Wrapped up (turn limit)";
    case "stopped": return "Stopped";
    default: return "Done";
  }
}

/** Format a structured task notification matching Claude Code's <task-notification> XML. */
function formatTaskNotification(record: AgentRecord, resultMaxLen: number, showCost = false): string {
  const status = getStatusLabel(record.status, record.error);
  const durationMs = record.completedAt ? record.completedAt - record.startedAt : 0;
  const totalTokens = getLifetimeTotal(record.lifetimeUsage);
  const contextPercent = getSessionContextPercent(record.session);
  const ctxXml = contextPercent !== null ? `<context_percent>${Math.round(contextPercent)}</context_percent>` : "";
  const compactXml = record.compactionCount ? `<compactions>${record.compactionCount}</compactions>` : "";
  // Only under `showCost`: this is LLM context, and a figure the orchestrator
  // did not ask for is a figure it may start reporting unprompted.
  const cost = showCost ? getLifetimeCost(record.lifetimeUsage) : 0;
  const costXml = cost > 0 ? `<estimated_cost_usd>${cost.toFixed(4)}</estimated_cost_usd>` : "";

  const resultPreview = record.result
    ? record.result.length > resultMaxLen
      ? record.result.slice(0, resultMaxLen) + "\n...(truncated, use agent_manage for full output)"
      : record.result
    : "No output.";

  return [
    `<task-notification>`,
    `<agent-id>${record.id}</agent-id>`,
    `<execution-id>${executionId({ taskId: record.id, runId: record.runId ?? "1" }, "subagent")}</execution-id>`,
    record.toolCallId ? `<tool-use-id>${escapeXml(record.toolCallId)}</tool-use-id>` : null,
    record.outputFile ? `<output-file>${escapeXml(record.outputFile)}</output-file>` : null,
    `<status>${escapeXml(status)}</status>`,
    `<summary>Agent "${escapeXml(record.description)}" ${record.status}${getStatusNote(record.status)}</summary>`,
    `<result>${escapeXml(resultPreview)}</result>`,
    `<usage><total_tokens>${totalTokens}</total_tokens><tool_uses>${record.toolUses}</tool_uses>${ctxXml}${compactXml}${costXml}<duration_ms>${durationMs}</duration_ms></usage>`,
    `</task-notification>`,
  ].filter(Boolean).join('\n');
}

/** Build AgentDetails from a base + record-specific fields. */
function buildDetails(
  base: Pick<AgentDetails, "displayName" | "description" | "subagentType" | "modelName" | "tags">,
  record: { toolUses: number; startedAt: number; completedAt?: number; status: string; error?: string; id?: string; session?: any; lifetimeUsage: LifetimeUsage },
  activity?: AgentActivity,
  overrides?: Partial<AgentDetails>,
): AgentDetails {
  return {
    ...base,
    toolUses: record.toolUses,
    tokens: formatLifetimeTokens(record),
    // Raw, and unconditional: `tokens` is preformatted because it is one stat,
    // but a cost is joined by "·" in one surface, "," in another and "|" in a
    // third — so it travels as a number and each renderer punctuates its own.
    cost: getLifetimeCost(record.lifetimeUsage),
    turnCount: activity?.turnCount,
    maxTurns: activity?.maxTurns,
    durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    status: record.status as AgentDetails["status"],
    agentId: record.id,
    error: record.error,
    ...overrides,
  };
}

/** Build notification details for the custom message renderer. */
function buildNotificationDetails(record: AgentRecord, resultMaxLen: number, activity?: AgentActivity): NotificationDetails {
  const totalTokens = getLifetimeTotal(record.lifetimeUsage);

  return {
    id: record.id,
    toolCallId: record.toolCallId,
    description: record.description,
    status: record.status,
    toolUses: record.toolUses,
    turnCount: record.turnCount ?? activity?.turnCount ?? 0,
    maxTurns: record.maxTurns,
    totalTokens,
    // Carried unconditionally; the renderer gates on the setting. Details are
    // data, and a notification rendered before a mid-session toggle should not
    // be stuck with the old answer.
    totalCost: getLifetimeCost(record.lifetimeUsage),
    durationMs: record.completedAt ? record.completedAt - record.startedAt : 0,
    outputFile: record.outputFile,
    error: record.error,
    resultPreview: record.result
      ? record.result.length > resultMaxLen
        ? record.result.slice(0, resultMaxLen) + "…"
        : record.result
      : "No output.",
  };
}

/**
 * Format an agent's tool scope for the subagent_run tool description.
 *
 * This suffix describes BUILT-IN scope only — extension tools are resolved when
 * the agent runs (extensions can register asynchronously), so they cannot be
 * enumerated while the description is being built. That is why an agent with
 * `tools: "*, ext:mcp/search"` renders "*" and always has.
 *
 * Two distinctions matter, both of them capability claims the orchestrator acts on:
 *
 * - absent vs empty. `builtinToolNames: undefined` means the agent never narrowed
 *   its tools (the shipped defaults); `[]` is what `tools: none` and an `ext:`-only
 *   `tools:` parse to, and the runtime really does hand those agents no built-ins.
 *   Rendering both "*" tells the orchestrator a tool-less agent can run `bash`.
 * - empty-with-extensions vs empty-without. Zero built-ins does NOT imply zero
 *   tools: `tools: none` alongside `extensions:` still surfaces every extension
 *   tool (see test/fixtures/.pi/agents/tools-none.md, which expects three). Calling
 *   that "none" understates the agent instead of overstating it — better, but still
 *   wrong, and it would route work away from the only agent able to do it. "none"
 *   is therefore reserved for agents that genuinely can call nothing: `isolated`
 *   agents and those with `extensions: false`.
 */
export function formatToolsSuffix(cfg: AgentConfig | undefined): string {
  const tools = cfg?.builtinToolNames;
  if (!tools) return "*";
  if (tools.length === 0) {
    // `isolated` overrides extensions to false in the runner, so both mean the
    // agent has no extension tools either — and then it truly has nothing.
    const noExtensionTools = cfg?.isolated === true || cfg?.extensions === false;
    return noExtensionTools ? "none" : "no built-ins, extension tools only";
  }
  const isFullSet =
    tools.length === BUILTIN_TOOL_NAMES.length
    && BUILTIN_TOOL_NAMES.every((t) => tools.includes(t));
  return isFullSet ? "*" : tools.join(", ");
}

/** CLI flag that runs a workflow script at session start. */
export const WORKFLOW_FILE_FLAG = "subagents-workflow-file";

/**
 * Re-exported from where they now live, because this is where they were
 * defined and a consumer (or a test) that matched a session entry on
 * {@link WORKFLOW_ENTRY_TYPE} imports it from here.
 */
export { FOREIGN_WORKFLOW_TOOL_NAMES, WORKFLOW_ENTRY_TYPE, type WorkflowEntryData, workflowEntryData };

/** Composition owns the shared coordinator; direct offline factories may own a scoped one. */
export interface AgentTasksOptions {
  readonly onManagementResult?: (report: (id: string, result: import("../../runtime-tasks/contracts.ts").RuntimeTaskResult) => import("../../runtime-tasks/contracts.ts").RuntimeTaskResult) => void;
  readonly onManagement?: (capability: RuntimeTaskCapability) => void;
  readonly coordinator?: TaskCoordinator;
  /** Composition-owned activation shutdown protocol. */
  readonly lifecycle?: import("../../task-ui/lifecycle.ts").TaskLifecycle;
  /** Narrow runner/startup seam for offline backend integration tests. */
  readonly managerDependencies?: AgentManagerDependencies;
  readonly mentionDependencies?: import("./mention-clone.ts").MentionCloneDependencies;
}

export default function (pi: ExtensionAPI, options: AgentTasksOptions = {}) {
  registerBuiltinSkills(pi);
  // Child AgentSessions load normal extensions. Re-entering this extension there
  // would create another manager and leak handlers. Nested orchestration is
  // injected as scoped custom tools by the existing manager instead.
  if (inChildSessionContext()) return;
  const ownsLifecycle = options.lifecycle === undefined;
  const coordinator = options.coordinator ?? new TaskCoordinator();
  const lifecycle = options.lifecycle ?? new TaskLifecycle(coordinator);
  const active = () => lifecycle.active;
  const cloneBackgroundParams = new WeakSet<object>();
  const assertActive = () => { if (!active()) throw new Error("Agent task activation is closing or closed"); };
  // Optional host sinks can synchronously initiate shutdown. Re-check at every
  // effect, not just at callback entry, so later effects in that callback stop.
  const hostPi = pi;
  const guardedEvents = new Proxy(pi.events, {
    get(target, property) {
      if (property === "emit") return (...args: Parameters<ExtensionAPI["events"]["emit"]>) => { if (active()) target.emit(...args); };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  pi = new Proxy(hostPi, {
    get(target, property) {
      if (property === "events") return guardedEvents;
      const value = Reflect.get(target, property, target);
      if (property === "sendMessage" || property === "appendEntry") {
        return (...args: unknown[]) => { if (active()) return Reflect.apply(value, target, args); };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const clones = new Set<AbortController>();
  const auxiliary = new Set<Promise<unknown>>();
  // Register ownership BEFORE any callback can synchronously shut down.
  function own<T>(start: () => Promise<T>): Promise<T> {
    let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    auxiliary.add(promise);
    void promise.then(() => auxiliary.delete(promise), () => auxiliary.delete(promise));
    try { resolve(start()); } catch (error) { reject(error); }
    return promise;
  }
  async function drainAuxiliary(): Promise<void> {
    while (auxiliary.size) await Promise.allSettled([...auxiliary]);
  }
  const safely = (effect: () => void) => { try { effect(); } catch { /* optional host sinks must not own execution cleanup */ } };


  // ---- Register custom notification renderer ----
  pi.registerMessageRenderer<NotificationDetails>(
    "subagent-notification",
    (message, { expanded }, theme) => {
      const d = message.details;
      if (!d) return undefined;

      function renderOne(d: NotificationDetails): string {
        const isError = d.status === "error" || d.status === "stopped" || d.status === "aborted";
        const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
        const statusText = isError ? d.status
          : d.status === "steered" ? "completed (steered)"
          : "completed";

        // Line 1: icon + agent description + status
        let line = `${icon} ${theme.bold(d.description)} ${theme.fg("dim", statusText)}`;

        // Line 2: stats
        const parts: string[] = [];
        if (d.turnCount > 0) parts.push(formatTurns(d.turnCount, d.maxTurns));
        if (d.toolUses > 0) parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
        if (d.totalTokens > 0) parts.push(formatTokens(d.totalTokens));
        if (showCost) {
          const costText = formatCost(d.totalCost ?? 0);
          if (costText) parts.push(costText);
        }
        if (d.durationMs > 0) parts.push(formatMs(d.durationMs));
        if (parts.length) {
          line += "\n  " + parts.map(p => theme.fg("dim", p)).join(" " + theme.fg("dim", "·") + " ");
        }

        // Line 3: result preview (collapsed) or full (expanded)
        if (expanded) {
          const lines = d.resultPreview.split("\n").slice(0, 30);
          for (const l of lines) line += "\n" + theme.fg("dim", `  ${l}`);
        } else {
          const preview = d.resultPreview.split("\n")[0]?.slice(0, 80) ?? "";
          line += "\n  " + theme.fg("dim", `⎿  ${preview}`);
        }

        // Line 4: output file link (if present)
        if (d.outputFile) {
          line += "\n  " + theme.fg("muted", `transcript: ${d.outputFile}`);
        }

        return line;
      }

      const all = [d, ...(d.others ?? [])];
      const rendered = all.map(renderOne);
      // A group of agents lands as one notification, and the number a user wants
      // from it is what the batch cost — not four figures to add up by hand.
      // Derived from the per-agent details rather than carried alongside them:
      // one source, so the total can never disagree with the rows above it.
      if (showCost && all.length > 1) {
        const total = formatCost(all.reduce((sum, a) => sum + (a.totalCost ?? 0), 0));
        if (total) {
          const tokens = all.reduce((sum, a) => sum + a.totalTokens, 0);
          rendered.unshift(theme.fg("dim", `${all.length} agents · ${formatTokens(tokens)} · ${total}`));
        }
      }
      return new Text(rendered.join("\n"), 0, 0);
    }
  );

  // ---- Workflow run rendered as a session entry ----
  // A workflow launched from the CLI flag has no tool call to hang its result
  // card on, so it renders here instead — through the SAME layout the tool
  // result uses, not a second one. Custom entries with no registered renderer
  // are silently dropped by the host, which is why this is registered at
  // activation rather than lazily.
  pi.registerEntryRenderer<WorkflowEntryData>(WORKFLOW_ENTRY_TYPE, (entry, _options, theme) =>
    renderWorkflowEntryCard(entry.data, theme));

  // Registered at activation; READ from session_start. The host applies CLI
  // values after every extension factory has run, so `getFlag` here would only
  // ever hand back the registered default (see the read site below).
  pi.registerFlag(WORKFLOW_FILE_FLAG, {
    type: "string",
    description:
      `Run a workflow script at startup: --${WORKFLOW_FILE_FLAG}=<path>. ` +
      "Use the `=` form — the space form consumes the next argument, which would swallow a following prompt.",
  });

  // Read directly rather than waiting for applyAndEmitLoaded below: this decides
  // the initial load, which happens hundreds of lines before settings are applied.
  let strictAgentFiles = loadSettings(process.cwd()).strictAgentFiles === true;

  /** Reload agents from project/global custom agent dirs and merge with defaults (called on init and each subagent_run invocation). */
  const reloadCustomAgents = (strict = false) => {
    const userAgents = loadCustomAgents(process.cwd(), strict);
    registerAgents(userAgents);
  };

  // Initial load — the only strict one. A bad edit mid-session must not kill the
  // session on the next unrelated spawn, so every later reload keeps warning.
  reloadCustomAgents(strictAgentFiles);

  // ---- Agent activity tracking + widget ----
  const agentActivity = new Map<string, AgentActivity>();

  // ---- Usage reporting (both off by default; see SubagentsSettings) ----
  /** Attach subagent spend to tool results, so the parent session counts it. */
  let reportUsage = false;
  function isReportUsageEnabled(): boolean { return reportUsage; }
  function setReportUsage(b: boolean): void {
    reportUsage = b;
    // Whatever accumulated while it was on is stale the moment it goes off:
    // draining it later would bill the parent for a window the user opted out
    // of, in one lump, on some unrelated later tool call.
    if (!b) pendingUsage.drain();
  }
  /** Show `~$X` next to token counts in the subagent surfaces. */
  let showCost = false;
  function isShowCostEnabled(): boolean { return showCost; }
  function setShowCost(b: boolean): void { showCost = b; }
  const pendingUsage = new PendingUsagePool();

  // ---- Cancellable pending notifications ----
  // Holds notifications briefly so agent_manage can cancel them
  // before they reach pi.sendMessage (fire-and-forget).
  const pendingNudges = new Map<string, ReturnType<typeof setTimeout>>();
  const NUDGE_HOLD_MS = 200;
  // A queued result wait must observe completion before its held notification
  // can fire, so successful waits can still suppress that redundant nudge.

  function scheduleNudge(key: string, send: () => void, delay = NUDGE_HOLD_MS) {
    if (!active()) return;
    cancelNudge(key);
    pendingNudges.set(key, setTimeout(() => {
      pendingNudges.delete(key);
      if (!active()) return;
      try { send(); } catch { reportNoticeFailure(); }
    }, delay));
  }

  function reportNoticeFailure(): void {
    if (!active()) return;
    const message = "Subagent completion notification failed; results are still available.";
    // A fixed message cannot leak provider payloads, prompts or result text.
    // Optional feedback must never prevent another notice or execution cleanup.
    if (currentCtx?.hasUI) safely(() => { if (active()) currentCtx?.ui.notify(message, "warning"); });
    else safely(() => { if (active()) console.warn(`[pi-subagents] ${message}`); });
  }

  function cancelNudge(key: string) {
    const timer = pendingNudges.get(key);
    if (timer != null) {
      clearTimeout(timer);
      pendingNudges.delete(key);
    }
  }

  // ---- Individual nudge helper (async join mode) ----
  function emitIndividualNudge(record: AgentRecord, runId = record.runId) {
    if (!active() || !canDeliverAgentResult(manager, coordinator, record, runId)) return;

    const notification = formatTaskNotification(record, 500, showCost);
    const footer = record.outputFile ? `\nFull transcript available at: ${record.outputFile}` : '';

    pi.sendMessage<NotificationDetails>({
      customType: "subagent-notification",
      content: notification + footer,
      display: true,
      details: buildNotificationDetails(record, 500, agentActivity.get(record.id)),
    }, { deliverAs: "followUp", triggerTurn: true });
    if (!active() || manager.getRecord(record.id) !== record || record.runId !== runId) return;
    record.notificationDelivered = true;
    manager.notifyChanged();
  }

  function finishActivity(record: AgentRecord): void {
    agentActivity.delete(record.id);
  }
  function sendIndividualNudge(record: AgentRecord) {
    finishActivity(record);
    const runId = record.runId;
    scheduleNudge(record.id, () => emitIndividualNudge(record, runId));
  }
  function reconsiderAgentNotice(record: AgentRecord): void {
    if (!active() || manager.getRecord(record.id) !== record || record.completedAt === undefined) return;
    // Public stopped terminal state closes group membership even while its
    // noncooperative runner drains; other outcomes still wait for cleanup.
    if (manager.isRunActive(record.id) && record.status !== "stopped") return;
    if (currentBatchAgents.some(a => a.id === record.id && a.runId === record.runId)) return;
    // Group ownership must observe ALL terminal members, even consumed/waited
    // ones; otherwise a suppressed member strands its siblings until timeout.
    if (groupJoin.isGrouped(record.id)) { groupJoin.onAgentComplete(record); return; }
    if (canDeliverAgentResult(manager, coordinator, record, record.runId)) sendIndividualNudge(record);
  }

  // ---- Group join manager ----
  const groupJoin = new GroupJoinManager(
    (records, partial) => {
      if (!active()) return;
      for (const r of records) finishActivity(r);
      const runs = records.map(record => ({ record, runId: record.runId }));

      const groupKey = `group:${records.map(r => r.id).join(",")}`;
      scheduleNudge(groupKey, () => {
        // Re-check at send time
        const unconsumed = runs.filter(({ record, runId }) => canDeliverAgentResult(manager, coordinator, record, runId)).map(({ record }) => record);
        if (unconsumed.length === 0) return;

        const notifications = unconsumed.map(r => formatTaskNotification(r, 300, showCost)).join('\n\n');
        const label = partial
          ? `${unconsumed.length} agent(s) finished (partial — others still running)`
          : `${unconsumed.length} agent(s) finished`;

        const [first, ...rest] = unconsumed;
        const details = buildNotificationDetails(first, 300, agentActivity.get(first.id));
        if (rest.length > 0) {
          details.others = rest.map(r => buildNotificationDetails(r, 300, agentActivity.get(r.id)));
        }

        pi.sendMessage<NotificationDetails>({
          customType: "subagent-notification",
          content: `Background agent group completed: ${label}\n\n${notifications}\n\nUse agent_manage for full output.`,
          display: true,
          details,
        }, { deliverAs: "followUp", triggerTurn: true });
        for (const { record, runId } of runs) {
          const live = manager.getRecord(record.id);
          if (active() && live && live.runId === runId && unconsumed.some(member => member.id === record.id)) live.notificationDelivered = true;
        }
        manager.notifyChanged();
      });
    },
    30_000,
  );

  function rollbackUnreturnedRun(record: AgentRecord): void {
    record.resultConsumed = true;
    cancelNudge(record.id);
    groupJoin.forgetAgent(record.id);
    manager.stopRun(manager.getRun(record.id)!.identity);
    record.abortController?.abort();
    try { record.outputCleanup?.(); } catch { /* retain artifact, release subscription */ }
    record.outputCleanup = undefined;
    agentActivity.delete(record.id);
  }

  /** Helper: build event data for lifecycle events from an AgentRecord. */
  function buildEventData(record: AgentRecord) {
    const durationMs = record.completedAt ? record.completedAt - record.startedAt : Date.now() - record.startedAt;
    // All three fields are lifetime-accumulated (Σ over every assistant message_end),
    // so they survive compaction together — input + output ≤ total always.
    // tokens is omitted when nothing was ever produced (e.g. agent errored before
    // any message_end fired), preserving prior payload shape.
    const u = record.lifetimeUsage;
    const total = getLifetimeTotal(u);
    const tokens = total > 0
      ? { input: u.input, output: u.output, total }
      : undefined;
    // The whole run's spend as a pi `Usage` — pi's convention for handing spend
    // to a consumer, so `usage.cost.total` and `usage.cacheRead` are where a
    // listener already expects them and anything pi adds to `Usage` arrives
    // without a change here. Omitted when nothing was spent, so "spent nothing"
    // and "never ran" stay distinguishable. Ungated by `showCost`: that setting
    // governs what a human is shown, not what the event carries.
    //
    // `tokens` above is the other convention, kept as it shipped: a flat view
    // model like pi's own `SessionStats`, carrying the DISPLAY total, which
    // excludes cacheRead (#38). The two answer different questions and neither
    // derives from the other.
    const usage = toReportedUsage(u);
    return {
      id: record.id,
      type: record.type,
      description: record.description,
      result: record.result,
      error: record.error,
      status: record.status,
      toolUses: record.toolUses,
      durationMs,
      tokens,
      usage,
    };
  }

  // Background completion: route through group join or send individual nudge
  const manager = new AgentManager((record) => {
    // Owned children — nested, or a workflow's — report only through their
    // owner: the parent's scoped tools, or the workflow's card, notification
    // and dialog. Keep them out of top-level lifecycle, transcript,
    // notification, and UI channels.
    if (!active() || !isTopLevelAgent(record)) return;

    // Emit lifecycle event based on terminal status
    const isError = record.status === "error" || record.status === "stopped" || record.status === "aborted";
    const eventData = buildEventData(record);
    if (isError) {
      safely(() => pi.events.emit("subagents:failed", eventData));
    } else {
      safely(() => pi.events.emit("subagents:completed", eventData));
    }

    // Persist final record for cross-extension history reconstruction
    safely(() => pi.appendEntry("subagents:record", {
      id: record.id, type: record.type, description: record.description,
      status: record.status, result: record.result, error: record.error,
      startedAt: record.startedAt, completedAt: record.completedAt,
    }));

    finishActivity(record);
    reconsiderAgentNotice(record);
  }, undefined, (record) => {
    if (!isTopLevelAgent(record)) return;
    // Shared source subscriptions drive UI; programmatic starts still emit lifecycle events.
    // Emit started event when agent transitions to running (including from queue)
    pi.events.emit("subagents:started", {
      id: record.id,
      type: record.type,
      description: record.description,
    });
  }, (record, info) => {
    if (!isTopLevelAgent(record)) return;
    // Emit compacted event when agent's session compacts (preserves count on record).
    pi.events.emit("subagents:compacted", {
      id: record.id,
      type: record.type,
      description: record.description,
      reason: info.reason,
      tokensBefore: info.tokensBefore,
      compactionCount: record.compactionCount,
    });
  }, (_record, usage) => {
    // Every assistant message from every agent — nested included, exactly once.
    // Parked here until a tool result can carry it back to the parent session;
    // see `PendingUsagePool`. Skipped entirely when the feature is off, so no
    // pool grows in a session that will never drain it.
    if (active() && reportUsage) pendingUsage.add(usage);
  }, options.managerDependencies);

  // Expose manager via Symbol.for() global registry for cross-package access.
  // Standard Node.js pattern for cross-package singletons (used by OpenTelemetry, etc.).
  // Documented for callers in docs/rpc.md ("The manager registry").
  //
  // Claim the slot only if it's free: subagent sessions re-activate this
  // extension in the same process (session.bindExtensions in agent-runner.ts),
  // and unconditionally overwriting would point the registry at a short-lived
  // child manager — and the child's shutdown would then delete the root
  // session's entry. The first activation (the root session) wins; child
  // activations leave it alone.
  const MANAGER_KEY = Symbol.for("pi-subagents:manager");
  // Process-external callers may supply arbitrary options. Nested ownership and
  // config-root metadata are internal capabilities issued only by scoped tools.
  /**
   * Resolve the agent type and spawn. Trusts its options — every caller must
   * either be in-process or have gone through `spawnTopLevel` first.
   */
  const spawnResolved = (piRef: any, ctxRef: any, type: string, prompt: string, options: any) => {
    assertActive();
    // Cross-extension callers get the same dispatch contract as the LLM (#183).
    // The RPC layer already throws for an unresolvable model rather than falling
    // back silently; a bad agent type should not be quieter. Throws become error
    // envelopes at the RPC boundary. Reload first so an agent file added mid
    // session is spawnable here too, not only through the subagent_run tool.
    reloadCustomAgents();
    const dispatch = resolveSpawnType(type);
    if (!dispatch.ok) throw new Error(dispatch.message);
    // Every programmatic spawn lands here — cross-extension RPC, both `@handle`
    // mention paths, and the `Symbol.for("pi-subagents:manager")` registry — and
    // none came through the subagent_run tool, which is where the UI activity tracker is
    // otherwise created. Without one the widget and FleetView have no tool name
    // and no turn count, so the row reads `thinking…` for the agent's whole life
    // while the header's tool-use count climbs beside it (#181). Double-tracking
    // is not possible: the subagent_run tool calls `manager.spawn` directly. The tracker
    // callbacks are the funnel's own — a caller's are not honoured, since a
    // half-wired tracker renders worse than none.
    //
    // The turn limit is resolved rather than read off `options`, which a mention
    // spawn deliberately omits so the agent's own config can decide: a tracker
    // built with `undefined` renders `↻3` where the subagent_run tool renders `↻3≤20`.
    // Like the tool's own, it is a prediction — editing the agent file mid-run
    // leaves the displayed ceiling stale.
    const { state, callbacks } = createActivityTracker(resolveEffectiveMaxTurns(dispatch.type, options?.maxTurns));
    // Repaints are left to the manager's `onStart` callback, which already starts
    // the widget/fleet timers for agents that enter this way.
    const normalized = { ...options, description: normalizeAgentDescription(options?.description, dispatch.type) };
    const id = manager.spawn(piRef, ctxRef, dispatch.type, prompt, { ...normalized, ...callbacks });
    assertActive();
    agentActivity.set(id, state);
    return id;
  };

  const spawnTopLevel = (piRef: any, ctxRef: any, type: string, prompt: string, options: any) => {
    assertSpawnInput(type, prompt);
    const safeOptions = parseSpawnOptions(options);
    delete safeOptions.parentAgentId;
    // Internal too: a forged value would hide an RPC-spawned agent inside
    // someone else's workflow, and take it out of the concurrency pool with it.
    delete safeOptions.workflowId;
    delete safeOptions.depth;
    delete safeOptions.maxSubagentDepth;
    delete safeOptions.configCwd;
    // Also internal: it names a transcript directory, so a forged value would
    // be a path-traversal primitive.
    delete safeOptions.rootSessionId;
    // Worse than rootSessionId: this one names a file to OPEN and replay as a
    // conversation. Only the mention dispatcher may set it, and only from a
    // path this extension itself recorded — never from anything a caller sent.
    delete safeOptions.resumeSessionFile;
    // Bypasses handle allocation, so a forged value would duplicate a live
    // agent's name and make `@handle` ambiguous. Same rule: dispatcher only.
    delete safeOptions.reclaim;
    // Every spawn through here is DETACHED — the caller gets an id back and
    // awaits nothing. A forged `blocking` would charge it to the foreground
    // pool and could defer it behind a queue whose gate nobody is holding.
    delete safeOptions.blocking;
    return spawnResolved(piRef, ctxRef, type, prompt, safeOptions);
  };

  /**
   * Resolve a tool's `agent_id` as an id OR a handle, so the model addresses
   * agents by the same names the user types. Ids are tried first, keeping the
   * existing behaviour exact — a handle is only consulted when the string is
   * not an id at all. Only live records: a tombstone has nothing to steer and
   * no result to read. Callers still enforce the nested-ownership rejection.
   */
  const resolveAgentRef = (ref: string): AgentRecord | undefined => {
    const byId = manager.getRecord(ref);
    if (byId) return byId;
    const resolved = manager.resolveMention(ref);
    return resolved?.kind === "live" ? resolved.record : undefined;
  };

  const registryEntry = {
    waitForAll: () => { assertActive(); return manager.waitForAll(); },
    hasRunning: () => active() && manager.hasRunning(),
    spawn: spawnTopLevel,
    getRecord: (id: string) => {
      if (!active()) return undefined;
      const record = manager.getRecord(id);
      return record !== undefined && isTopLevelAgent(record) ? record : undefined;
    },
  };
  const ownsManagerRegistry = (globalThis as any)[MANAGER_KEY] === undefined;
  if (ownsManagerRegistry) {
    (globalThis as any)[MANAGER_KEY] = registryEntry;
  }

  // --- Cross-extension RPC via pi.events ---
  let currentCtx: ExtensionContext | undefined;
  // RPC handlers + the `subagents:ready` broadcast are wired on `session_start`
  // (a bound lifecycle event), not at factory time. pi runs every extension
  // factory before the `extensions:` filter and only fires lifecycle events for
  // survivors, so a child session that filtered pi-subagents out never reaches
  // session_start — and must not advertise or answer RPC it can't service
  // (currentCtx would stay undefined → spawn always "No active session"). Gating
  // here makes a filtered session behave like an absent one (#142).
  let rpcHandle: RpcHandle | undefined;
  /** Whether the `@handle` autocomplete wrapper has been stacked on pi's provider. */
  let mentionProviderRegistered = false;

  // Capture ctx from session_start for the RPC spawn handler.
  // This also wires the RPC handlers and broadcasts readiness — on the first
  // bound session_start, so a filtered-out activation never advertises (#142).
  pi.on("session_start", async (_event, ctx) => {
    if (!active()) return;
    currentCtx ??= ctx;
    if (!unregisterSource) {
      const unsubscribe = coordinator.registerSource(agentSource);
      unregisterSource = unsubscribe;
      if (!active()) { unsubscribe(); unregisterSource = undefined; return; }
    }
    // session_start fires once per activation, but a double-bind must not leak listeners.
    if (!rpcHandle) {
      rpcHandle = registerRpcHandlers({
        events: pi.events,
        pi,
        getCtx: () => active() ? currentCtx : undefined,
        isActive: active,
        manager: {
          spawn: spawnTopLevel,
          awaitStartup: (id) => manager.awaitStartup(id),
          getRecord: (id) => manager.getRecord(id),
          // Unguarded on purpose: the stop handler now runs the top-level check
          // itself off `getRecord`, and reports the refusal instead of the
          // "Agent not found" a false from here used to be read as.
          abort: (id) => manager.abort(id),
          consumeResult: (id) => {
            const record = resolveAgentRef(id);
            // Same guard as agent_manage: a running agent has no result
            // to consume, and its notification is still the caller's only
            // signal that it finished.
            if (!record || record.parentAgentId) return false;
            if (record.status === "running" || record.status === "queued") return false;
            manager.consumeRun(manager.getRun(record.id)!.identity);
            cancelNudge(record.id);
            return true;
          },
        },
      });
      // Broadcast readiness so extensions loaded alongside us can discover us.
      // Emitting after all factories have run (rather than at factory time)
      // also avoids the race where a consumer loaded after us misses the event.
      if (!active()) { for (const unsubscribe of Object.values(rpcHandle)) safely(unsubscribe); rpcHandle = undefined; return; }
      pi.events.emit("subagents:ready", {});
    }
    if (!active()) return;
    // Stack `@handle` suggestions on pi's built-in autocomplete. Registered at
    // most once per activation: pi appends wrappers to a list it never prunes,
    // so a second call would layer a duplicate provider on the first. TUI only
    // — print mode has no such method, and RPC mode's is a no-op.
    if (ctx.mode === "tui" && !mentionProviderRegistered) {
      mentionProviderRegistered = true;
      ctx.ui.addAutocompleteProvider(current =>
        createMentionProvider(
          current,
          // Plain text, not renderAgentName: the same label FleetView and the
          // widget show, but the autocomplete description cannot carry ANSI.
          () => active() ? mentionRoster(manager, mentionTypes(), type => getConfig(type).displayName) : [],
          () => active() && isAgentMentionsEnabled(),
        ),
      );
    }
    // Last, and only here: CLI flag values are applied by the host AFTER every
    // extension factory has run, so this is the earliest point the real value
    // exists. Detached inside — a workflow must not hold up session startup.
    if (!active()) return;
    resolveWorkflowCollisions(ctx);
    if (!active()) return;
    runWorkflowFlag(ctx);
  });

  /** Agent types `@` can start, in the shape the roster wants. */
  const mentionTypes = (): TypeInfo[] =>
    getAvailableTypes().map(name => ({ name, description: getAgentConfig(name)?.description ?? name }));

  /**
   * `@handle message` typed at the prompt addresses that agent instead of the
   * main model — Claude Code's prompt mention, same grammar (see mention.ts).
   *
   * The handle names the *agent*, not one process, so one syntax covers its
   * whole lifecycle: message it while it runs, resume it once it has finished,
   * start it if it never ran. Everything that isn't an agent mention falls
   * through untouched, which is what keeps `@src/foo.ts summarize this`, a bare
   * `@handle`, and ordinary prose working. A delivered mention costs no
   * main-model turn; the answer arrives through the ordinary completion
   * notification either way.
   */
  pi.on("input", (event, ctx) => own(async () => {
    if (!active()) return { action: "continue" as const };
    // Never hijack text the extension layer itself submitted (pi.sendMessage,
    // scheduled prompts) — only something a person typed can be a mention.
    if (event.source === "extension" || !isAgentMentionsEnabled()) return { action: "continue" as const };
    // Claiming the turn is TUI only, matching the `@` completion that teaches
    // the syntax. Pi defaults `session.prompt()` to source "interactive", so a
    // headless `pi -p "@explore …"` reaches here too — and claiming it would
    // answer with silence, which the background hold cannot fix: `handled`
    // returns from prompt() before any turn starts, so the loop that patch wraps
    // never runs (it holds subagents spawned by the subagent_run tool MID-turn, a
    // different path). The agent would detach, `ctx.ui.notify` is a no-op
    // outside the TUI, and print mode would exit having printed nothing.
    //
    // `model` mode has none of that problem: it queues a reminder and lets the
    // turn run, so the answer is the model's own, printed as usual. It is the
    // only branch allowed to act headlessly; everything else falls through to
    // the main model exactly as it did before mentions existed.
    const canDispatchDirectly = ctx.mode === "tui";
    if (!canDispatchDirectly && getAgentMentionMode() !== "model") return { action: "continue" as const };

    const mention = parseMention(event.text);
    if (!mention) return { action: "continue" as const };

    // `@main` addresses the main conversation, never a subagent — the one name
    // `assignHandle` refuses to allocate. An explicit escape hatch for text
    // that would otherwise read as a mention, so the prefix is dropped and the
    // rest goes to the model with its attachments intact.
    if (isReservedHandle(mention.handle)) {
      return { action: "transform" as const, text: mention.message, ...(event.images && { images: event.images }) };
    }

    // As typed first, so an agent actually called `agent-foo` wins over Claude
    // Code's `@agent-` + `foo` spelling rather than being shadowed by it.
    const alias = stripAgentPrefix(mention.handle);
    const resolved = manager.resolveMention(mention.handle)
      ?? (alias ? manager.resolveMention(alias) : undefined);

    // Steering and resuming are direct in every mode, so headless they are not
    // available at all. Falling through here rather than dropping to the start
    // path below matters: the handle names an agent that already exists, and
    // asking the model to start another one is not what was typed.
    if (resolved && !canDispatchDirectly) return { action: "continue" as const };

    if (resolved?.kind === "live") {
      const record = resolved.record;
      const target = `@${record.alias ?? record.handle ?? mention.handle}`;

      if (record.status === "running" || record.status === "queued") {
        // Steering interrupts after the current tool call, exactly like the
        // subagent_message tool. Un-consume the result so the agent's reply to
        // this message is still relayed even if the LLM read its last answer.
        record.resultConsumed = false;
        manager.steer(record.id, mention.message);
        pi.events.emit("subagents:steered", { id: record.id, message: mention.message });
        ctx.ui.notify(`Sent to ${target}`, "info");
        return { action: "handled" as const };
      }

      if (record.session) {
        // Both derived from the record's OWN type: a mention names an existing
        // agent, so its frontmatter is what governs — `output_transcript: false`
        // must keep holding, since record.outputFile is the sole gate every
        // downstream consumer keys off and a resume must not re-open it.
        const config = getAgentConfig(record.type);
        const resumedRecord = await startBackgroundResume(ctx, record, mention.message, {
          outputTranscript: config?.outputTranscript ?? getOutputTranscriptDefault(),
          maxTurns: normalizeMaxTurns(config?.maxTurns ?? getDefaultMaxTurns()),
        });
        assertActive();
        ctx.ui.notify(
          resumedRecord ? `Resuming ${target}` : `Could not resume ${target} — it is still running.`,
          resumedRecord ? "info" : "warning",
        );
        return { action: "handled" as const };
      }
      // A live record with no session never got far enough to continue, so it
      // falls through to the start-fresh path below, like Claude's
      // `no_transcript`.
    }

    // Evicted, but its conversation is still on disk: reopen it. This is an
    // ordinary spawn carrying a session file, so the new record picks up the
    // widget, fleet row, transcript and completion notification unchanged —
    // and `reclaim` hands it back the names the tombstone was holding.
    if (resolved?.kind === "tombstone") {
      const entry = resolved.entry;
      const target = `@${entry.alias ?? entry.handle}`;

      // Checked here rather than left to SessionManager.open: that runs inside
      // runAgent, whose rejection lands on the record as an agent error, not in
      // the catch below. A `/new` in another pi window or a manual delete makes
      // the conversation unrecoverable (Claude Code's `not_reachable`), so drop
      // the entry — a row that can only ever fail is worse than none — and say
      // so rather than quietly sending this message to an unrelated agent.
      if (!existsSync(entry.sessionFile)) {
        manager.dropTombstone(entry.handle);
        ctx.ui.notify(`Could not resume ${target} — its session is gone.`, "warning");
        return { action: "handled" as const };
      }

      // The subagent_run tool deliberately falls back to general-purpose for a type it
      // cannot resolve (#183), which covers a deleted file AND a merely
      // disabled one. A resume must not inherit that: reopening this
      // conversation under a different agent's prompt and tools is not
      // continuing it, and the new record would re-tombstone under the
      // substitute, so the handle would never find its way back.
      reloadCustomAgents();
      const dispatch = resolveSpawnType(entry.type);
      if (!dispatch.ok || dispatch.fellBackFrom !== undefined) {
        // The tombstone stays: re-enabling the agent makes the handle work
        // again, which a drop would foreclose.
        ctx.ui.notify(`Could not resume ${target} — the ${entry.type} agent is no longer available.`, "warning");
        return { action: "handled" as const };
      }

      try {
        // spawnResolved, not spawnTopLevel: the latter strips
        // `resumeSessionFile` and `reclaim` as untrusted. This path is the
        // exception — both come from a tombstone this extension wrote.
        const id = spawnResolved(pi, ctx, dispatch.type, mention.message, {
          description: entry.description,
          reclaim: { handle: entry.handle, alias: entry.alias },
          resumeSessionFile: entry.sessionFile,
          isBackground: true,
        });
        // The agent may still be starting — wait, so a startup failure lands in
        // the catch below instead of being announced as a resume.
        await manager.awaitStartup(id);
        assertActive();
        // The tombstone deliberately stays. `resolveMention` prefers the live
        // record holding these same names, so it cannot shadow the resume — and
        // if this run dies before establishing its own session, the original
        // transcript is still the right thing for the next mention to reopen.
        // Once the resumed record is evicted it overwrites this entry in place,
        // keyed by the same handle, so nothing accumulates.
        ctx.ui.notify(`Resuming ${target}`, "info");
      } catch (err) {
        if (!active()) return { action: "handled" as const };
        // The type is already settled above, so what is left is a spawn-time
        // failure: a strict worktree-isolation error, an unusable cwd.
        ctx.ui.notify(
          `Could not resume ${target}: ${err instanceof Error ? err.message : String(err)}`,
          "warning",
        );
      }
      return { action: "handled" as const };
    }

    // No agent under that handle — but the name may still be an agent type, in
    // which case the mention starts one.
    const typeHandle = mention.handle;
    const type = resolveHandleToType(typeHandle, getAvailableTypes())
      ?? (alias ? resolveHandleToType(alias, getAvailableTypes()) : undefined);
    if (!type) return { action: "continue" as const };

    // Claude Code never starts the agent itself: `@agent-<type>` becomes an
    // attachment asking the main model to do it, and the model writes the
    // agent's prompt from the conversation rather than forwarding the typed
    // text. That buys a real `subagent_run` tool call — transcript, per-tool widget
    // detail, tool-use-id correlation, join grouping — and a prompt with the
    // context a cold spawn lacks.
    //
    // It also costs a visible turn, spent narrating a decision the user already
    // made by typing the handle. So the turn is taken by a clone of this
    // conversation instead (mention-clone.ts): same messages, same system
    // prompt, off-screen, holding only the `subagent_run` tool. Nothing reaches the
    // chat, and what it starts is an ordinary top-level agent.
    if (getAgentMentionMode() === "model") {
      const label = `@${handleBase(type)}`;
      // "Prompting", not "Starting": in this mode nothing starts until the
      // off-screen clone has taken a whole model turn writing the agent's
      // prompt, and that wait is the one thing the chat cannot show. `direct`
      // says "Started" because by then it has. The distinction tells the user
      // which of the two they are waiting on.
      ctx.ui.notify(`Prompting ${label}…`, "info");
      // Not awaited: the clone runs a full model turn, and prompt() is blocked
      // until this hook returns. The user gets their prompt back immediately
      // and the agent appears in the widget when it starts.
      const controller = new AbortController();
      clones.add(controller);
      void own(() => runMentionClone({ ctx, type, message: mention.message, agentTool: cloneAgentTool,
        signal: controller.signal, isActive: active, dependencies: options.mentionDependencies })
        .then(async (result) => {
          if (!active() || controller.signal.aborted || result.spawned) return;
          if (result.attempted) {
            ctx.ui.notify(`Could not start ${label}: ${result.error ?? "Agent admission failed; not retrying this mention"}`, "error");
            return;
          }
          // A clone that could not run must not swallow the mention: start the
          // agent the direct way rather than leaving the user with a toast and
          // nothing running.
          try {
            const id = spawnTopLevel(pi, ctx, type, mention.message, {
              description: describeMention(mention.message),
              isBackground: true,
            });
            // Same reason as the direct path below: the agent may still be
            // starting, and a failure there must reach this catch.
            await manager.awaitStartup(id);
            assertActive();
            ctx.ui.notify(`Started ${label} directly — ${result.error}`, "warning");
          } catch (err) {
            if (!active()) return;
            ctx.ui.notify(
              `Could not start ${label}: ${err instanceof Error ? err.message : String(err)}`,
              "error",
            );
          }
        }).catch(() => {}).finally(() => clones.delete(controller)));
      return { action: "handled" as const };
    }

    try {
      // Nothing else to pass: runAgent resolves model, thinking and max turns
      // from the agent's own config when the spawn omits them, and the
      // manager's onStart/onComplete callbacks own the widget, the fleet list
      // and the completion notification — the same contract cross-extension
      // RPC spawns run under.
      const id = spawnTopLevel(pi, ctx, type, mention.message, {
        description: describeMention(mention.message),
        isBackground: true,
      });
      // The agent may still be starting (a worktree copy is an awaited git
      // call) — report a failure that lands there as a failed start, not as a
      // "Started" toast for an agent that never ran.
      await manager.awaitStartup(id);
      assertActive();
      ctx.ui.notify(`Started @${handleBase(type)}`, "info");
    } catch (err) {
      if (!active()) return { action: "handled" as const };
      ctx.ui.notify(`Could not start @${handleBase(type)}: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
    return { action: "handled" as const };
  }));

  // Keep the bound event root-scoped, but do not tear down on a cancellable switch.
  pi.on("session_before_switch", () => { if (!active()) return; });

  // before_switch can be cancelled; irreversible teardown belongs to shutdown.
  lifecycle.register({
    name: "agent-tasks",
    freeze() {
      // Disarm every outward path before shared waits can cancel executions.
      currentCtx = undefined;
      for (const timer of pendingNudges.values()) clearTimeout(timer);
      pendingNudges.clear();
      clearTimeout(batchFinalizeTimer); batchFinalizeTimer = undefined;
      currentBatchAgents = [];
      safely(() => groupJoin.dispose());
      manager.freezeAdmission();
      if (rpcHandle) for (const unsubscribe of Object.values(rpcHandle)) safely(unsubscribe);
      rpcHandle = undefined;
    },
    stop() {
      for (const controller of clones) safely(() => controller.abort());
      for (const task of workflowTasks.values()) safely(() => task.abortController.abort());
      manager.stopForShutdown();
    },
    async drain() {
      await Promise.all([manager.drainExecution(), drainAuxiliary()]);
    },
    dispose() {
      manager.sealHostEffects();
      void manager.dispose();
      // Registration callbacks may close synchronously before returning handles.
      clearTimeout(batchFinalizeTimer); batchFinalizeTimer = undefined;
      safely(() => unregisterSource?.()); unregisterSource = undefined;
      safely(() => offStopped()); safely(() => agentSource.dispose());
      workflowTasks.clear(); agentActivity.clear(); observedStops.clear(); pendingUsage.drain();
      if (ownsManagerRegistry && (globalThis as any)[MANAGER_KEY] === registryEntry) delete (globalThis as any)[MANAGER_KEY];
    },
  });
  if (ownsLifecycle) pi.on("session_shutdown", async () => { await lifecycle.shutdown(); });

  // Claude Code-style `@handle message` prompt mentions. Read live by both the
  // `input` hook and the stacked autocomplete provider, so the toggle applies
  // immediately — the provider itself can never be unregistered (pi's wrapper
  // list is append-only), it just delegates everything when this is off.
  let agentMentionMode: AgentMentionMode = "model";
  function getAgentMentionMode(): AgentMentionMode { return agentMentionMode; }
  function setAgentMentionMode(mode: AgentMentionMode): void { agentMentionMode = mode; }
  // `model` and `direct` differ only in who starts a not-yet-running agent, so
  // everything that just asks "are mentions live at all" — the suggestion list,
  // the steer and resume branches — reads this instead of the mode.
  function isAgentMentionsEnabled(): boolean { return agentMentionMode !== "off"; }

  // Project/global default for writing the subagent .output transcript lives in
  // output-file.ts (both spawn paths read it). A custom agent's
  // `output_transcript` frontmatter overrides it per spawn; when the frontmatter
  // is silent, this default applies. Read live at spawn time.

  // ---- Join mode configuration ----
  let defaultJoinMode: JoinMode = 'smart';
  function getDefaultJoinMode(): JoinMode { return defaultJoinMode; }
  function setDefaultJoinMode(mode: JoinMode) { defaultJoinMode = mode; }

  // What an unqualified top-level spawn means. Defaults to background,
  // following Claude Code; `backgroundByDefault: false` restores the previous
  // foreground default. Nested spawns ignore this — see nested-tools.ts.
  let backgroundByDefault = true;
  function getBackgroundByDefault(): boolean { return backgroundByDefault; }
  function setBackgroundByDefault(b: boolean) { backgroundByDefault = b; }

  // Master switch for scripted workflows. Defaults to ON. Off means the
  // `subagent_workflow` tool is never registered: the model is not told the
  // feature exists (zero context cost) and has nothing to call. The
  // `--subagents-workflow-file` flag is refused too, so
  // there is no second door into the same machinery.
  //
  // `workflowsPinned` records that the answer came from the user — a boolean in
  // agent-tasks.json, or the settings toggle — rather than from this default. It
  // is what `resolveWorkflowCollisions` checks before yielding to another
  // extension's workflow tool: a default may be overridden by what else is
  // loaded, an explicit choice may not.
  let workflowsEnabled = true;
  let workflowsPinned = false;
  function isWorkflowsEnabled(): boolean { return workflowsEnabled; }
  function isWorkflowsPinned(): boolean { return workflowsPinned; }
  function setWorkflowsEnabled(b: boolean) {
    workflowsEnabled = b;
    workflowsPinned = true;
  }

  // ---- Disable default agents configuration ----
  // When enabled, the three hardcoded default agents (general-purpose, Explore,
  // Plan) are not registered. User-defined agents from project/global custom
  // agent dirs are completely unaffected — only DEFAULT_AGENTS are suppressed.
  // Defaults to false; opt-in via `/agents-config → Settings` or agent-tasks.json.
  // State lives in agent-types.ts (isDefaultsDisabled) because registerAgents
  // needs it; this wrapper just re-registers after flipping it.
  function setDisableDefaultAgents(b: boolean): void {
    setDefaultsDisabled(b);
    reloadCustomAgents(); // re-register with new setting
  }

  // ---- Batch tracking for smart join mode ----
  // Collects background agent IDs spawned in the current turn for smart grouping.
  // Uses a debounced timer: each new agent resets the 100ms window so that all
  // parallel tool calls (which may be dispatched across multiple microtasks by the
  // framework) are captured in the same batch.
  let currentBatchAgents: { id: string; runId?: string; joinMode: JoinMode }[] = [];
  let batchFinalizeTimer: ReturnType<typeof setTimeout> | undefined;
  let batchCounter = 0;

  /** Finalize the current batch: if 2+ smart-mode agents, register as a group. */
  function finalizeBatch() {
    if (!active()) return;
    batchFinalizeTimer = undefined;
    const batchAgents = currentBatchAgents.filter(a => manager.getRecord(a.id)?.runId === a.runId);
    currentBatchAgents = [];

    const smartAgents = batchAgents.filter(a => a.joinMode === 'smart' || a.joinMode === 'group');
    if (smartAgents.length >= 2) {
      const groupId = `batch-${++batchCounter}`;
      const ids = smartAgents.map(a => a.id);
      groupJoin.registerGroup(groupId, ids);
      // Retroactively process agents that already completed during the debounce window.
      // Their onComplete fired but was deferred (agent was in currentBatchAgents),
      // so we feed them into the group now.
      for (const id of ids) {
        const record = manager.getRecord(id);
        if (!record) continue;
        record.groupId = groupId;
        if (record.completedAt != null && (!manager.isRunActive(record.id) || record.status === "stopped")) {
          groupJoin.onAgentComplete(record);
        }
      }
    } else {
      // No group formed — send individual nudges for any agents that completed
      // during the debounce window and had their notification deferred.
      for (const { id } of batchAgents) {
        const record = manager.getRecord(id);
        if (record?.completedAt != null && !manager.isRunActive(record.id) && !record.resultConsumed) {
          sendIndividualNudge(record);
        }
      }
    }
  }

  /**
   * Launch a detached resume of an existing agent and wire everything a
   * re-running agent needs: transcript anchoring, activity tracking, join-mode
   * batching, the widget/fleet refresh, and the `subagents:created` event.
   *
   * Shared by the subagent_run tool's `resume` + `run_in_background` branch and the
   * `@handle message` prompt mention — they differ only in how they report the
   * outcome. Returns the record, or undefined when the manager refused because
   * the agent is still running (see AgentManager.resume).
   *
   * Callers must have already established that the record has a session.
   */
  async function startBackgroundResume(
    ctx: ExtensionContext,
    existing: AgentRecord,
    prompt: string,
    opts: { outputTranscript: boolean; maxTurns?: number; toolCallId?: string; requestedRunInBackground?: boolean },
  ): Promise<AgentRecord | undefined> {
    assertActive();
    const id = existing.id;
    if (manager.isRunActive(id)) return undefined;
    // Prepare before changing result ownership: a filesystem failure here has
    // not created a new run, so the previous run's held notice stays eligible.
    const outputFile = opts.outputTranscript
      ? createOutputFilePath(ctx.cwd, id, ctx.sessionManager.getSessionId())
      : undefined;
    if (outputFile) ensureOutputFile(outputFile);
    groupJoin.forgetAgent(id);
    cancelNudge(id);
    const joinMode = resolveJoinMode(defaultJoinMode, true);
    // Mention resume must clear the previous call's correlation.
    existing.toolCallId = opts.toolCallId;
    if (joinMode) existing.joinMode = joinMode;
    // Resume appends; never truncate a previous run's turns.
    existing.outputFile = outputFile;
    // Anchor streaming past the turns already on disk, captured BEFORE the
    // run starts. The resumed prompt lands as an ordinary user message at
    // this index, so it is written exactly once.
    const transcriptAnchor = existing.session?.messages.length ?? 0;

    const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(opts.maxTurns);
    // resumeAgent has no onSessionCreated — the session predates this run —
    // so seed it directly, or the widget shows no context % for the agent.
    bgState.session = existing.session;

    // No `signal`: a background spawn deliberately omits it, and a detached
    // resume must behave the same. Passing it would abort this agent when
    // the parent turn is interrupted (user Esc), while agents started with
    // run_in_background in that same turn keep going.
    let wiringError: unknown;
    const record = manager.resumeRun(id, prompt, undefined, {
      isBackground: true,
      requestedRunInBackground: opts.requestedRunInBackground,
      maxTurns: opts.maxTurns,
      onTurnEnd: bgCallbacks.onTurnEnd,
      onToolActivity: bgCallbacks.onToolActivity,
      onAssistantUsage: bgCallbacks.onAssistantUsage,
      // Fires when the run actually starts — immediately, or on queue
      // drain. Wiring it here (rather than after resume() returns) means a
      // resume stopped while still queued never started streaming, so
      // there is no subscription left behind for a later run to trip over.
      onStarted: () => {
        assertActive();
        const rec = manager.getRecord(id);
        if (rec?.session && rec.outputFile) {
          try { rec.outputCleanup = streamToOutputFile(rec.session, rec.outputFile, id, ctx.cwd, transcriptAnchor); }
          catch (error) { wiringError = error; throw error; }
        }
      },
    });
    assertActive();
    if (!record) return undefined;
    if (wiringError !== undefined) {
      rollbackUnreturnedRun(record);
      throw wiringError;
    }

    if (joinMode != null && joinMode !== 'async') {
      currentBatchAgents.push({ id, runId: manager.getRecord(id)?.runId, joinMode });
      if (batchFinalizeTimer) clearTimeout(batchFinalizeTimer);
      batchFinalizeTimer = setTimeout(finalizeBatch, 100);
    }

    agentActivity.set(id, bgState);

    // Resume ignores subagent_type (the record keeps the type it was
    // spawned with), so report the record's own identity — a "created"
    // event carrying the caller's type would re-register the agent under
    // the wrong one in cross-extension mirrors keyed by id.
    pi.events.emit("subagents:created", {
      id,
      type: existing.type,
      description: existing.description,
      isBackground: true,
    });

    assertActive();
    return record;
  }

  /** Build the full type list text dynamically from available agents only. */
  const buildTypeListText = () => {
    const available = getAvailableTypes();

    return available.map((name) => {
      const cfg = getAgentConfig(name);
      const modelSuffix = cfg?.model ? ` (${getModelLabelFromConfig(cfg.model)})` : "";
      const toolsSuffix = ` (Tools: ${formatToolsSuffix(cfg)})`;
      return `- ${name}: ${cfg?.description ?? name}${modelSuffix}${toolsSuffix}`;
    }).join("\n");
  };

  /** Derive a short model label from a model string. */
  function getModelLabelFromConfig(model: string): string {
    // Strip provider prefix (e.g. "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6")
    const name = model.includes("/") ? model.split("/").pop()! : model;
    // Strip trailing date suffix (e.g. "claude-haiku-4-5-20251001" → "claude-haiku-4-5")
    return name.replace(/-\d{8}$/, "");
  }

  // Apply persisted settings on startup and emit `subagents:settings_loaded`.
  // Global + project merged; missing → defaults; corrupt file emits a warning
  // to stderr and falls back to defaults.
  applyAndEmitLoaded(
    {
      setMaxConcurrent: (n) => manager.setMaxConcurrent(n),
      setMaxConcurrentForeground: (n) => manager.setMaxConcurrentForeground(n),
      setDefaultMaxTurns,
      setGraceTurns,
      setDefaultJoinMode,
      setBackgroundByDefault,
      setScopeModels: setScopeModelsEnabled,
      setStrictAgentFiles: (b) => { strictAgentFiles = b; },
      setDisableDefaultAgents: setDisableDefaultAgents,
      setAgentMentions: setAgentMentionMode,
      setRememberAgents,
      setOutputTranscript: setOutputTranscriptDefault,
      setWorktreeIsolation: setWorktreeIsolationEnabled,
      setWorkflowsEnabled: setWorkflowsEnabled,
      setMaxSubagentDepth: setMaxSubagentDepth,
      setFallbackSubagent: setFallbackSubagent,
      setReportUsage,
      setShowCost,
    },
    (event, payload) => pi.events.emit(event, payload),
  );

  // ---- subagent_run tool ----

  // Held rather than registered inline: the mention clone reuses this exact
  // definition, so the agent it starts is an ordinary top-level spawn instead
  // of a second implementation that has to be kept in step with this one.
  const agentTool = defineTool({
    name: SUBAGENT_TOOL_NAMES.AGENT,
    label: "subagent_run",
    description: "Start or resume an autonomous agent for delegated work.",
    promptSnippet: "Launch autonomous sub-agents for complex multi-step tasks",
    promptGuidelines: runToolGuidance({ nested: false, isolation: isWorktreeIsolationEnabled(), agentTypes: buildTypeListText() }),
    parameters: Type.Object({
      prompt: Type.String({
        description: "The task for the agent to perform.",
      }),
      description: nullableControl(Type.String({
        description: "Required for new agents: a short, specific task description. Set null with resume.",
      })),
      name: nullableControl(
        Type.String({
          description:
            'Name for a new agent; set null for an automatic name, usable as @name in the input box. Tool messaging/resume uses the real agent_id; execution management uses execution_id. Set null with resume.',
        }),
      ),
      subagent_type: nullableControl(Type.String({
        description: `Required non-null for new agents; null with resume. Available types: ${getAvailableTypes().join(", ")}.`,
      })),
      model: nullableControl(
        Type.String({
          description:
            'Model override. Accepts "provider/modelId" or fuzzy name (e.g. "haiku", "sonnet"). Null uses agent configuration, otherwise the parent session model. Agent-file configuration takes precedence over calls.',
        }),
      ),
      ...thinkingParam(),
      run_in_background: nullableControl(
        Type.Boolean({
          description: "Execution mode; null uses configuration. Agent-file configuration takes precedence over true/false requests. Background returns execution identity; foreground waits for results.",
        }),
      ),
      resume: nullableControl(
        Type.String({
          description: "Real agent_id of a finished agent. Set null for new agents; an empty string is invalid. With resume, set new-agent fields to null; prompt and run_in_background remain applicable. Session settings are retained; this execution mode is resolved again.",
        }),
      ),
      isolated: nullableControl(
        Type.Boolean({
          description: "Null uses configuration, otherwise false. If true, agent gets no extension/MCP tools — only built-in tools.",
        }),
      ),
      inherit_context: nullableControl(
        Type.Boolean({
          description: "Null uses configuration, otherwise false (fresh context). If true, add parent conversation text to the prompt.",
        }),
      ),
      ...isolationParam(isWorktreeIsolationEnabled()),
    }, { additionalProperties: false }),

    // ---- Custom rendering: Claude Code style ----

    renderCall(args, theme, context) {
      const detail = [String(args.subagent_type ?? ""), String(args.description ?? "")].filter(Boolean).join(" · ");
      return createToolCallHeading({ name: "subagent_run", detail, theme, context });
    },

    renderResult(result, { expanded, isPartial }, theme, renderContext) {
      const supplied = result.details as (AgentDetails & { runtimeLaunch?: unknown }) | undefined;
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
      // Metadata may be historical or foreign. Validate every field used by the
      // status renderer before formatting; a valid config does not validate its
      // neighboring counters, spinner or legacy tags.
      if (supplied && (
        !nonnegative(supplied.toolUses) || typeof supplied.tokens !== "string" || !nonnegative(supplied.durationMs) ||
        [supplied.cost, supplied.turnCount, supplied.maxTurns].some(value => value !== undefined && !nonnegative(value)) ||
        (supplied.spinnerFrame !== undefined && (!Number.isInteger(supplied.spinnerFrame) || supplied.spinnerFrame < 0 || supplied.spinnerFrame >= SPINNER.length)) ||
        (supplied.tags !== undefined && (!Array.isArray(supplied.tags) || supplied.tags.some(tag => typeof tag !== "string"))) ||
        [supplied.modelName, supplied.activity, supplied.error].some(value => value !== undefined && typeof value !== "string")
      )) return component(width => wrap(text, width).map(row => theme.fg(renderContext.isError ? "error" : "toolOutput", row)));
      const identity = supplied?.runtimeLaunch;
      const snapshot = copyAgentExecutionConfig(supplied?.executionConfig);
      const config = isLaunchMetadata(identity) && "kind" in identity && identity.kind === "subagent" &&
        (supplied?.agentId === undefined || supplied.agentId === identity.agent_id) &&
        (typeof renderContext.args.resume !== "string" || renderContext.args.resume === identity.agent_id) &&
        (snapshot?.mode === undefined || snapshot.mode === identity.mode) &&
        typeof supplied?.status === "string" && ["queued", "running", "completed", "steered", "aborted", "stopped", "error", "background"].includes(supplied.status) &&
        typeof supplied.toolUses === "number" && Number.isFinite(supplied.toolUses) &&
        typeof supplied.tokens === "string" && typeof supplied.durationMs === "number" && Number.isFinite(supplied.durationMs) &&
        (supplied.activity === undefined || typeof supplied.activity === "string") && (supplied.error === undefined || typeof supplied.error === "string")
        ? snapshot : undefined;
      // Legacy/foreign results retain the original readable renderer. Verified
      // snapshots supplement its existing status styles, never live state.
      const details = config && supplied ? { ...supplied, modelName: undefined, tags: undefined, tokens: clean(supplied.tokens),
        activity: supplied.activity === undefined ? undefined : clean(supplied.activity),
        error: supplied.error === undefined ? undefined : clean(supplied.error) } : supplied;
      const legacy = (expanded: boolean) => {
        // Pi reports pre-execution failures (extension block, abort, argument
        // validation) as `{ content: [reason], details: {} }` with isError set —
        // no status to render, so show the reason instead of inventing one (#199).
        if (renderContext.isError || !details?.status) {
          return new Text(text, 0, 0);
        }

        // Helper: build "haiku · thinking: high · ↻5≤30 · 3 tool uses · 33.8k tokens" stats string
        const stats = (d: AgentDetails) => {
          const parts: string[] = [];
          if (d.modelName) parts.push(d.modelName);
          if (d.tags) parts.push(...d.tags);
          if (d.turnCount != null && d.turnCount > 0) {
            parts.push(formatTurns(d.turnCount, d.maxTurns));
          }
          if (d.toolUses > 0) parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
          if (d.tokens) parts.push(d.tokens);
          if (showCost) {
            const costText = formatCost(d.cost ?? 0);
            if (costText) parts.push(costText);
          }
          return parts.map(p => fgPreservingNestedStyles(theme, "dim", p)).join(" " + theme.fg("dim", "·") + " ");
        };

        // ---- While running (streaming) ----
        if (isPartial || details.status === "running") {
          const frame = SPINNER[details.spinnerFrame ?? 0];
          const s = stats(details);
          return renderRunningAgentStatus(frame, s, details.activity ?? "thinking…", theme);
        }

        // ---- Background agent launched ----
        if (details.status === "background") {
          return new Text(theme.fg("dim", `  ⎿  Running in background (ID: ${details.agentId})`), 0, 0);
        }

        // ---- Completed / Steered ----
        if (details.status === "completed" || details.status === "steered") {
          const duration = formatMs(details.durationMs);
          const isSteered = details.status === "steered";
          const icon = isSteered ? theme.fg("warning", "✓") : theme.fg("success", "✓");
          const s = stats(details);
          let line = icon + (s ? " " + s : "");
          line += " " + theme.fg("dim", "·") + " " + theme.fg("dim", duration);

          if (expanded) {
            const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
            if (resultText) {
              const lines = resultText.split("\n").slice(0, 50);
              for (const l of lines) {
                line += "\n" + theme.fg("dim", `  ${l}`);
              }
              if (resultText.split("\n").length > 50) {
                line += "\n" + theme.fg("muted", "  ... (use agent_manage action=output with execution_id and verbose for full output)");
              }
            }
          } else {
            const doneText = isSteered ? "Wrapped up (turn limit)" : "Done";
            line += "\n" + theme.fg("dim", `  ⎿  ${doneText}`);
          }
          return new Text(line, 0, 0);
        }

        // ---- Stopped (user-initiated abort) ----
        if (details.status === "stopped") {
          const s = stats(details);
          let line = theme.fg("dim", "■") + (s ? " " + s : "");
          line += "\n" + theme.fg("dim", "  ⎿  Stopped");
          return new Text(line, 0, 0);
        }

        // Anything left ("queued", or a status added later) has no rendering of
        // its own — the turn-limit wording below must not be the catch-all.
        if (details.status !== "error" && details.status !== "aborted") {
          return new Text(text, 0, 0);
        }

        // ---- Error / Aborted (hard max_turns) ----
        const s = stats(details);
        let line = theme.fg("error", "✗") + (s ? " " + s : "");

        if (details.status === "error") {
          line += "\n" + theme.fg("error", `  ⎿  Error: ${details.error ?? "unknown"}`);
        } else {
          line += "\n" + theme.fg("warning", "  ⎿  Aborted (max turns exceeded)");
        }

        return new Text(line, 0, 0);
      };
      if (!config) return legacy(expanded);
      const status = renderContext.isError
        ? new Text(theme.fg("error", `✗ Error · observed ${details?.status ?? "unknown"}`), 0, 0)
        : legacy(false);
      return component(width => [
        ...status.render(width),
        ...wrap(`State: ${details?.status ?? "unknown"}`, width).map(row => theme.fg("muted", row)),
        ...executionConfigRows(config, expanded, width, theme),
        ...(expanded ? result.content.filter(block => block.type === "text").flatMap(block =>
          wrap(block.text, width).map(row => theme.fg(renderContext.isError ? "error" : "toolOutput", row))) : []),
      ]);
    },

    // ---- Execute ----

    execute: async (toolCallId, input, signal, onUpdate, ctx) => {
      assertActive();

      let params;
      try { params = parseAgentToolArguments(input, { nested: false, isolation: isWorktreeIsolationEnabled() }); }
      catch (err) { return errorResult(err instanceof Error ? err.message : String(err)); }
      reloadCustomAgents();
      const resumeTarget = params.resume === undefined ? undefined : manager.getRecord(params.resume);
      if (params.resume !== undefined) {
        if (!resumeTarget || !isTopLevelAgent(resumeTarget)) return errorResult(`Agent not found: "${params.resume}".`);
        if (!resumeTarget.session) return errorResult(`Agent "${params.resume}" has no active session to resume.`);
        if (manager.isRunActive(resumeTarget.id) || resumeTarget.status === "running" || resumeTarget.status === "queued") return errorResult(`Agent "${params.resume}" is still active — use subagent_message or agent_manage wait.`);
      }
      const rawType = (resumeTarget?.type ?? params.subagent_type) as SubagentType;
      const dispatch = resumeTarget ? { ok: true as const, type: resumeTarget.type } : resolveSpawnType(rawType);
      if (!dispatch.ok) return errorResult(dispatch.message);
      const subagentType = dispatch.type;
      const fellBackFrom = "fellBackFrom" in dispatch ? dispatch.fellBackFrom as string | undefined : undefined;
      const requestedType = fellBackFrom || subagentType;
      const fallbackNote = fellBackFrom !== undefined
        ? `Note: Unknown agent type "${fellBackFrom}" — using ${resolveType(subagentType) ? subagentType : "the fallback agent config"}.\n\n`
        : "";

      const displayName = getDisplayName(subagentType);

      // Get agent config (if any)
      const customConfig = getAgentConfig(subagentType);

      const resolvedConfig = resolveAgentInvocationConfig(customConfig, params, {
        worktreeAllowed: isWorktreeIsolationEnabled(),
        defaultRunInBackground: getBackgroundByDefault(),
      });

      // Resolve model from agent config first; tool-call params only fill gaps.
      let model = ctx.model;
      if (!resumeTarget && resolvedConfig.modelInput) {
        const resolved = resolveModel(resolvedConfig.modelInput, ctx.modelRegistry);
        if (typeof resolved === "string") {
          if (resolvedConfig.modelFromParams) return errorResult(resolved);
          // config-specified: silent fallback to parent
        } else {
          model = resolved;
        }
      }

      // Scope validation: the effective resolved model is checked against the
      // user's enabledModels list. Policy (hard error vs warn-and-proceed) lives
      // in model-scope.ts so the nested delegation tools apply the same rule.
      const scopeVerdict = checkModelScope({
        model,
        cwd: ctx.cwd,
        modelRegistry: ctx.modelRegistry,
        callerSupplied: resolvedConfig.modelFromParams,
        agentLabel: customConfig?.displayName ?? subagentType,
        modelInput: resolvedConfig.modelInput,
      });
      if (!resumeTarget && scopeVerdict.kind === "error") return errorResult(scopeVerdict.message);
      if (!resumeTarget && scopeVerdict.kind === "warn") ctx.ui.notify(scopeVerdict.message, "warning");

      assertActive();
      const thinking = resolvedConfig.thinking;
      const inheritContext = resolvedConfig.inheritContext;
      const runInBackground = cloneBackgroundParams.has(input) || resolvedConfig.runInBackground;
      const isolated = resolvedConfig.isolated;
      const isolation = resolvedConfig.isolation;
      // Whether this spawn writes its .output transcript. Per-agent
      // frontmatter (`output_transcript`) wins; otherwise the project/global
      // default applies. `attachTranscript` below is the SOLE gate — every
      // downstream consumer keys off record.outputFile being set, so no spawn
      // path can re-enable the transcript by accident.
      const outputTranscript = customConfig?.outputTranscript ?? getOutputTranscriptDefault();
      const attachTranscript = (rec: AgentRecord | undefined, agentId: string): void => {
        if (!rec || !outputTranscript) return;
        rec.outputFile = createOutputFilePath(ctx.cwd, agentId, ctx.sessionManager.getSessionId());
        writeInitialEntry(rec.outputFile, agentId, params.prompt, ctx.cwd);
      };

      // Unconditional, not "only when it differs from the parent": a thinking
      // level reads as a property of a model, and an agent that inherited the
      // parent's model used to show the level with nothing to attach it to.
      // This is the pre-session snapshot — agent-manager overwrites it with the
      // effective values the moment a session reports them.
      const { modelName, modelId } = model ? describeModel(model) : { modelName: undefined, modelId: undefined };
      // What the caller SPELLED, kept only if it names a different model than the
      // one that won. Model input is fuzzy — `"haiku"` and
      // `"anthropic/claude-haiku-4-5"` are the same model — so comparing the two
      // strings would disclose an override that never happened. A spelling that
      // resolves to nothing is still worth disclosing: it cannot have taken effect.
      const askedModel = ((asked: string | undefined) => {
        if (!asked) return undefined;
        const resolvedAsked = resolveModel(asked, ctx.modelRegistry);
        if (typeof resolvedAsked === "string") return asked;
        return resolvedAsked.provider === model?.provider && resolvedAsked.id === model?.id ? undefined : asked;
      })(resolvedConfig.overridden?.model);
      // Resume uses the stored type, not the required but ignored model type argument.
      const effectiveMaxTurns = params.resume
        ? resolveEffectiveMaxTurns(manager.getRecord(params.resume)?.type ?? subagentType)
        : normalizeMaxTurns(resolvedConfig.maxTurns ?? getDefaultMaxTurns());
      const agentInvocation: AgentInvocation = {
        modelName,
        modelId,
        thinking,
        // Only set where the agent file outranked the caller, so the surfaces can
        // disclose a parameter that was accepted but could not take effect (#182).
        requestedThinking: resolvedConfig.overridden?.thinking,
        requestedModel: askedModel,
        sessionRequestedThinking: params.thinking,
        sessionRequestedModel: params.model !== undefined && askedModel === undefined ? modelId : undefined,
        requestedRunInBackground: resolvedConfig.overridden?.runInBackground,
        requestedInheritContext: resolvedConfig.overridden?.inheritContext,
        requestedIsolated: resolvedConfig.overridden?.isolated,
        requestedIsolation: resolvedConfig.overridden?.isolation ?? (params.isolation === "worktree" && !isWorktreeIsolationEnabled() ? "worktree" : undefined),
        isolationDifferenceReason: !isWorktreeIsolationEnabled() ? "worktree-disabled" : undefined,
        maxTurns: effectiveMaxTurns,
        isolated,
        inheritContext,
        runInBackground,
        isolation,
      };
      // Tool-result render shows the mode label too; viewer's header already does.
      const modeLabel = getPromptModeLabel(subagentType);
      const { tags: invocationTags } = buildInvocationTags(agentInvocation);
      const agentTags = modeLabel ? [modeLabel, ...invocationTags] : invocationTags;
      const detailBase = {
        displayName,
        description: params.description ?? resumeTarget?.description ?? subagentType,
        subagentType,
        modelName,
        tags: agentTags.length > 0 ? agentTags : undefined,
      };

      /**
       * `detailBase` for a record that exists, which outranks it: the base is a
       * snapshot of what this call REQUESTED, and pi may have resolved a
       * different model or clamped the thinking level (agent-manager writes the
       * effective values back when the session reports them). Resume goes
       * further and ignores the model/thinking parameters outright — it runs on
       * the session it is reopening — so rendering the base there advertises
       * settings the run never used.
       *
       * The mode label is rebuilt rather than carried over: it hangs off the
       * agent TYPE, not the invocation, so tags taken straight from
       * buildInvocationTags would silently drop `twin`.
       */
      const detailBaseFor = (rec: AgentRecord | undefined) => {
        if (!rec) return detailBase;
        const identity = { executionConfig: copyAgentExecutionConfig(rec.executionConfig), runtimeLaunch: launchMetadata("subagent", rec.id, rec.runId ?? "1", rec.isBackground ? "background" : "foreground") };
        if (!rec.invocation) return { ...detailBase, ...identity };
        const type = rec.type;
        const { modelName: recModelName, tags } = buildInvocationTags(rec.invocation);
        const recModeLabel = getPromptModeLabel(type);
        const recTags = recModeLabel ? [recModeLabel, ...tags] : tags;
        return {
          ...identity,
          displayName: getDisplayName(type),
          description: rec.description,
          subagentType: type,
          modelName: recModelName,
          tags: recTags.length > 0 ? recTags : undefined,
        };
      };

      // Resume existing agent
      if (params.resume) {
        const existing = manager.getRecord(params.resume);
        if (!existing || !isTopLevelAgent(existing)) {
          return errorResult(`Agent not found: "${params.resume}". It may have been cleaned up.`);
        }
        if (!existing.session) {
          return errorResult(`Agent "${params.resume}" has no active session to resume.`);
        }

        if (manager.isRunActive(existing.id)) {
          return errorResult(`Agent "${existing.id}" is still running — wait or steer instead.`);
        }

        // Background resume: detached run that notifies on completion, mirroring
        // a background spawn. Previously run_in_background was silently ignored
        // on resume (this branch returned before the background branch below),
        // so a resumed agent always blocked the main loop until it finished.
        if (runInBackground) {
          const id = existing.id;
          // A detached resume hands control back while the record stays
          // "running", so nothing stops the model from resuming the same agent
          // again mid-run. manager.resume() refuses that (it would orphan the
          // live run's abort controller); say why here, where the model can act
          // on it, instead of letting it read as a generic failure.
          if (existing.status === "running" || existing.status === "queued") {
            return errorResult(
              `Agent "${params.resume}" is still ${existing.status} — it can only be resumed once its current run finishes.\n` +
              `Use subagent_message to send it a message mid-run, or agent_manage action=wait to wait for it.`,
            );
          }

          const record = await startBackgroundResume(ctx, existing, params.prompt, {
            outputTranscript,
            maxTurns: effectiveMaxTurns,
            toolCallId,
            requestedRunInBackground: resolvedConfig.overridden?.runInBackground,
          });
          assertActive();
          if (!record) {
            return errorResult(`Failed to resume agent "${params.resume}".`);
          }

          const isQueued = record.status === "queued";
          return textResult(
            `Agent ${isQueued ? "queued" : "resumed"} in background.\n` +
            `Agent ID: ${id}\n` +
            `Type: ${existing.type}\n` +
            (record.outputFile ? `Output file: ${record.outputFile}\n` : "") +
            (isQueued ? `Position: queued (max ${manager.getMaxConcurrent()} concurrent)\n` : "") +
            `\nYou will be notified when this agent completes.\n` +
            `Use agent_manage action=output to retrieve full results, or subagent_message to send it messages.`,
            { ...detailBaseFor(record), toolUses: record.toolUses, tokens: "", durationMs: 0, status: "background" as const, agentId: id },
          );
        }

        const id = existing.id;
        const { state, callbacks } = createActivityTracker(effectiveMaxTurns);
        state.session = existing.session;
        const anchor = existing.session.messages.length;
        if (outputTranscript) {
          existing.outputFile ??= createOutputFilePath(ctx.cwd, id, ctx.sessionManager.getSessionId());
          ensureOutputFile(existing.outputFile);
        } else existing.outputFile = undefined;
        existing.toolCallId = toolCallId;
        groupJoin.forgetAgent(id);
        cancelNudge(id);
        const resumed = manager.resumeRun(id, params.prompt, signal, {
          requestedRunInBackground: resolvedConfig.overridden?.runInBackground,
          maxTurns: effectiveMaxTurns,
          ...callbacks,
          onStarted: () => {
            assertActive();
            if (existing.session && existing.outputFile) existing.outputCleanup = streamToOutputFile(existing.session, existing.outputFile, id, ctx.cwd, anchor);
          },
        });
        assertActive();
        if (!resumed) return errorResult(`Agent "${id}" is still running — wait or steer instead.`);
        if (manager.isRunActive(id)) agentActivity.set(id, state);
        const run = manager.getRun(id)!;
        const lease = registerAgentWait(manager, coordinator, run, "launch", signal, () => reconsiderAgentNotice(existing));
        const outcome = await lease.result;
        assertActive();
        if (outcome.kind === "detached") {
          return textResult(`Agent resumed in background.\nAgent ID: ${id}\nExecution ID: ${executionId(run.identity, "subagent")}\nThe same session continues; you will be notified when it completes.`,
            { ...detailBaseFor(existing), status: "background" as const, agentId: id, toolUses: existing.toolUses, tokens: "", durationMs: 0 });
        }
        if (outcome.kind !== "completed") return errorResult(`Agent ${id} interrupted.`, buildDetails(detailBaseFor(existing), existing));
        const record = outcome.value;
        // A failed resume surfaces the error, plus any partial output THIS
        // resume produced (never the previous turn's answer, #144).
        if (record.status === "error") {
          return errorResult(`Agent failed: ${record.error}${partialOutputSuffix(record)}`, buildDetails(detailBaseFor(record), record));
        }
        return textResult(
          record.result?.trim() || "No output.",
          buildDetails(detailBaseFor(record), record),
        );
      }

      // Background execution
      if (runInBackground) {
        const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(effectiveMaxTurns);

        // Wrap onSessionCreated to wire output file streaming.
        // The callback lazily reads record.outputFile (set right after spawn)
        // rather than closing over a value that doesn't exist yet.
        let id: string;
        const origBgOnSession = bgCallbacks.onSessionCreated;
        bgCallbacks.onSessionCreated = (session: any) => {
          origBgOnSession(session);
          assertActive();
          const rec = manager.getRecord(id);
          if (rec?.outputFile) {
            rec.outputCleanup = streamToOutputFile(session, rec.outputFile, id, ctx.cwd);
          }
        };

        // A throw here means the agent never started. Let it out: pi marks a
        // tool call failed only when execute throws, and a returned message
        // reads to the model as a subagent that ran and reported this (#179).
        id = manager.spawn(pi, ctx, subagentType, params.prompt, {
          description: params.description,
          name: params.name as string | undefined,
          model,
          maxTurns: effectiveMaxTurns,
          isolated,
          inheritContext,
          thinkingLevel: thinking,
          isBackground: true,
          isolation,
          invocation: agentInvocation,
          rootSessionId: ctx.sessionManager.getSessionId(),
          ...bgCallbacks,
        });

        assertActive();
        // Set output file + join mode synchronously after spawn, before the
        // event loop yields — onSessionCreated is async so this is safe.
        const joinMode = resolveJoinMode(defaultJoinMode, true);
        const record = manager.getRecord(id);
        try {
          if (record) {
            record.toolCallId = toolCallId;
            if (joinMode) record.joinMode = joinMode;
            attachTranscript(record, id);
          }
        } catch (error) {
          // An unreturned launch has no background report owner. Stop it before
          // joining a batch or publishing activity, retaining generated files.
          if (record) rollbackUnreturnedRun(record);
          throw error;
        }

        assertActive();
        // Background invocation returns the original ID even during worktree
        // startup. Any later failure belongs to its normal backend notification.
        if (joinMode == null || joinMode === 'async') {
          // Foreground/no join mode or explicit async — not part of any batch
        } else {
          // smart or group — add to current batch
          currentBatchAgents.push({ id, runId: manager.getRecord(id)?.runId, joinMode });
          // Debounce: reset timer on each new agent so parallel tool calls
          // dispatched across multiple event loop ticks are captured together
          if (batchFinalizeTimer) clearTimeout(batchFinalizeTimer);
          batchFinalizeTimer = setTimeout(finalizeBatch, 100);
        }

        agentActivity.set(id, bgState);

        // Emit created event
        pi.events.emit("subagents:created", {
          id,
          type: subagentType,
          description: params.description,
          isBackground: true,
        });

        assertActive();
        const isQueued = record?.status === "queued";
        return textResult(
          `${fallbackNote}Agent ${isQueued ? "queued" : "started"} in background.\n` +
          `Agent ID: ${id}\n` +
          `Type: ${displayName}\n` +
          `Description: ${params.description}\n` +
          (record?.outputFile ? `Output file: ${record.outputFile}\n` : "") +
          (isQueued ? `Position: queued (max ${manager.getMaxConcurrent()} concurrent)\n` : "") +
          `\nYou will be notified when this agent completes.\n` +
          `Use agent_manage action=output to retrieve full results, or subagent_message to send it messages.\n` +
          `Do not duplicate this agent's work.`,
          { ...detailBaseFor(record), toolUses: 0, tokens: "", durationMs: 0, status: "background" as const, agentId: id },
        );
      }

      // Foreground (synchronous) execution — stream progress via onUpdate
      let inlineActive = true;
      let spinnerFrame = 0;
      const startedAt = Date.now();
      let fgId: string | undefined;
      // Set only while the spawn is parked on a foreground concurrency slot
      // (maxConcurrentForeground); undefined the rest of the time, including
      // always when the limit is unset.
      let queuedAhead: number | undefined;

      const streamUpdate = () => {
        if (!active() || !inlineActive) return;
        // Spend from the record, everything else from the live tracker. `fgId`
        // is set in onSessionCreated below, which fires before the first
        // assistant message — so nothing is spent while this reads zero.
        const fgRecord = fgId ? manager.getRecord(fgId) : undefined;
        const details: AgentDetails = {
          ...detailBaseFor(fgRecord),
          toolUses: fgState.toolUses,
          tokens: fgRecord ? formatLifetimeTokens(fgRecord) : "",
          cost: fgRecord ? getLifetimeCost(fgRecord.lifetimeUsage) : 0,
          turnCount: fgState.turnCount,
          maxTurns: fgState.maxTurns,
          durationMs: Date.now() - startedAt,
          // Deliberately still "running" while queued: the renderer routes any
          // status it doesn't know to raw text (see the catch-all below), which
          // would drop the spinner and read as hung. Only the activity line
          // changes — "thinking…" would be a lie for an agent that has not
          // started and may not for minutes.
          status: "running",
          activity: queuedAhead === undefined
            ? describeActivity(fgState.activeTools, fgState.responseText)
            : `queued — waiting for a foreground slot${queuedAhead > 0 ? ` (${queuedAhead} ahead)` : ""}`,
          spinnerFrame: spinnerFrame % SPINNER.length,
        };
        safely(() => onUpdate?.({
          content: [{ type: "text", text: `${agentExecutionSummary(details.executionConfig)}${fgState.toolUses} tool uses...` }],
          details: details as any,
        }));
      };

      const { state: fgState, callbacks: fgCallbacks } = createActivityTracker(effectiveMaxTurns, streamUpdate);

      // Wire session creation: register in widget + stream to output file.
      // The output file path is set synchronously after spawn (below),
      // before onSessionCreated fires — same pattern as background agents.
      const origOnSession = fgCallbacks.onSessionCreated;
      fgCallbacks.onSessionCreated = (session: any) => {
        origOnSession(session);
        assertActive();
        // It really started — stop reporting it as queued, and repaint now
        // rather than leaving the stale line up for the next spinner tick.
        // Guarded, so a spawn that never queued emits no extra update.
        if (queuedAhead !== undefined) {
          queuedAhead = undefined;
          streamUpdate();
        }
        for (const a of manager.listAgents()) {
          if (a.session === session) {
            fgId = a.id;
            agentActivity.set(a.id, fgState);
            break;
          }
        }
        // Stream conversation to output file (foreground agent logging)
        if (fgId) {
          const rec = manager.getRecord(fgId);
          if (rec?.outputFile) {
            rec.outputCleanup = streamToOutputFile(session, rec.outputFile, fgId, ctx.cwd);
          }
        }
      };

      assertActive();
      // Animate spinner at ~80ms (smooth rotation through 10 braille frames)
      const spinnerInterval = setInterval(() => {
        spinnerFrame++;
        streamUpdate();
      }, 80);

      let record: AgentRecord;
      try {
        streamUpdate();
        assertActive();
        fgId = manager.spawn(pi, ctx, subagentType, params.prompt, {
          description: params.description,
          name: params.name as string | undefined,
          model,
          maxTurns: effectiveMaxTurns,
          isolated,
          inheritContext,
          thinkingLevel: thinking,
          isolation,
          invocation: agentInvocation,
          signal,
          isBackground: false,
          blocking: true,
          rootSessionId: ctx.sessionManager.getSessionId(),
          // Queued/no-session runs already have identities and terminal handles.
          onQueued: (id, ahead) => { fgId = id; queuedAhead = ahead; streamUpdate(); },
          ...fgCallbacks,
        });
        assertActive();
        const live = manager.getRecord(fgId)!;
        live.toolCallId = toolCallId;
        const run = manager.getRun(fgId)!;
        const lease = registerAgentWait(manager, coordinator, run, "launch", signal, () => reconsiderAgentNotice(live));
        assertActive();
        try { attachTranscript(live, fgId); }
        catch (error) { manager.stopRun(run.identity); lease.interrupt(); throw error; }
        agentActivity.set(fgId, fgState);
        const outcome = await lease.result;
        assertActive();
        if (outcome.kind === "detached") {
          return textResult(`${fallbackNote}Agent continuing in background.\nAgent ID: ${fgId}\nExecution ID: ${executionId(run.identity, "subagent")}\n` +
            (live.outputFile ? `Output file: ${live.outputFile}\n` : "") + "The same execution continues; you will be notified when it completes.",
            { ...detailBaseFor(live), toolUses: live.toolUses, tokens: "", durationMs: 0, status: "background" as const, agentId: fgId });
        }
        if (outcome.kind !== "completed") return errorResult(`Agent ${fgId} interrupted.`, buildDetails(detailBaseFor(live), live));
        record = outcome.value;
      } finally {
        inlineActive = false;
        clearInterval(spinnerInterval);
        // Backend activity/transcript ownership continues after detach. Terminal
        // cleanup is exclusively the manager completion callback's job.
      }

      // Get final token count — from the record, like the cost below it, so the
      // two describe the same work when the agent delegated to nested children.
      const tokenText = formatLifetimeTokens(record);

      const details = buildDetails(detailBaseFor(record), record, fgState, { tokens: tokenText });

      if (record.status === "error") {
        // Error headline + any partial output the run produced before failing.
        return errorResult(`${fallbackNote}Agent failed: ${record.error}${partialOutputSuffix(record)}`, details);
      }

      const durationMs = (record.completedAt ?? Date.now()) - record.startedAt;
      const statsParts = [`${record.toolUses} tool uses`];
      if (tokenText) statsParts.push(tokenText);
      if (showCost) {
        const costText = formatCost(getLifetimeCost(record.lifetimeUsage));
        if (costText) statsParts.push(costText);
      }
      return textResult(
        `${fallbackNote}Agent completed in ${formatMs(durationMs)} (${statsParts.join(", ")})${getForegroundOutcomeNote(record.status)}.\n\n` +
        (record.result?.trim() || "No output."),
        details,
      );
    },
  });
  /**
   * Wrap a tool so its results carry back whatever subagent spend the parent
   * session has not been told about yet (see `PendingUsagePool`).
   *
   * Pi copies `AgentToolResult.usage` onto the persisted tool-result message and
   * folds it into `getSessionStats()`, which is what the footer, the statusline
   * and `/cost` read — so this is the whole of "report usage to the parent".
   *
   * Nothing is attached to a call with no tool-call id. That is the `@handle`
   * mention path (`mention-clone.ts`), which invokes this tool from a fork of the
   * conversation that is discarded moments later: the result never becomes a
   * message in the real session, so usage hung on it would be spend the user paid
   * for and nobody counted. Skipping leaves it pending for the next real result.
   */
  function withUsageReporting<T extends { execute: (...args: any[]) => any }>(tool: T): T {
    return {
      ...tool,
      execute: async (toolCallId: string | undefined, ...rest: any[]) => {
        assertActive();
        const result = await own<Awaited<ReturnType<T["execute"]>>>(() => tool.execute(toolCallId, ...rest));
        assertActive();
        if (!reportUsage || !toolCallId) return result;
        const usage = pendingUsage.drain();
        return usage ? { ...result, usage } : result;
      },
    };
  }
  options.onManagementResult?.((id, result) => {
    assertActive();
    const usage = reportUsage && id ? pendingUsage.drain() : undefined;
    return usage ? { ...result, usage } : result;
  });
  function registerToolReportingUsage(tool: any): void {
    pi.registerTool(withUsageReporting(tool));
  }

  // The mention path is handed THIS object, not the bare `agentTool` — see the
  // mention-clone header on why the clone must call the registered tool.
  const registeredAgentTool = withUsageReporting(agentTool);
  pi.registerTool(registeredAgentTool);
  // Private identity capability: only this dispatcher can force background.
  // Ordinary model parameters and frontmatter precedence remain unchanged.
  const cloneAgentTool: typeof registeredAgentTool = {
    ...registeredAgentTool,
    execute: async (id, params, ...rest) => {
      if (!params || typeof params !== "object") throw new Error("Invalid clone Agent parameters");
      cloneBackgroundParams.add(params);
      try { return await registeredAgentTool.execute(id, params, ...rest); }
      finally { cloneBackgroundParams.delete(params); }
    },
  };

  // ---- Workflow tool ----

  /**
   * Live runs, by task id. The tool returns before the run finishes, so its
   * result card looks the task up here on every render rather than freezing a
   * snapshot into `details` — that is what makes the inline card follow a
   * background run.
   */
  const workflowTasks = new Map<string, WorkflowTask>();
  const agentSource = createAgentTaskSource(manager, coordinator, workflowTasks);
  options.onManagement?.(createAgentManagement({ manager, coordinator, source: agentSource, active,
    owns: isTopLevelAgent, format: (record, verbose) => formatRetrievedAgent(record, verbose).content.map(block => block.text).join("\n"),
    cancelNotice: cancelNudge, reconsider: reconsiderAgentNotice,
  }));
  options.onManagement?.(createWorkflowManagement({ manager, coordinator, source: agentSource, tasks: workflowTasks, active,
    cancelNotice: cancelNudge, reconsider: notifyWorkflowFinished,
  }));
  // abort() exposes terminal state before the runner completion callback. All
  // stopped members must still close their group without sending a notice.
  const observedStops = new Set<string>();
  const offStopped = manager.subscribe(() => {
    if (!active()) return;
    for (const record of manager.listAgents()) {
      const key = `${record.id}:${record.runId}`;
      if (record.status === "stopped" && !observedStops.has(key)) {
        observedStops.add(key); reconsiderAgentNotice(record);
      }
    }
  });
  let unregisterSource: (() => void) | undefined;

  /**
   * Run a task to completion against the real manager, settling the record
   * either way. Never rejects: a run that cannot start (bad `meta`, oversized
   * source, non-JSON `args`) is a failed workflow, and both callers here are
   * detached — a rejection would surface as an unhandled one.
   */
  function workflowActive(task: WorkflowTask): boolean {
    return active() && workflowTasks.get(task.id) === task && !task.abortController.signal.aborted;
  }

  function runWorkflowTask(ctx: ExtensionContext, task: WorkflowTask): Promise<void> {
    return own(async () => {
      if (!workflowActive(task)) {
        if (workflowTasks.get(task.id) === task && task.abortController.signal.aborted) failWorkflowTask(task, "Workflow cancelled before runtime startup.");
        return;
      }
      try {
        const result = await runWorkflow({
          script: task.script,
          args: task.args,
          signal: task.abortController.signal,
          host: createWorkflowHost({
            pi,
            ctx,
            manager,
            signal: task.abortController.signal,
            rootSessionId: ctx.sessionManager.getSessionId(),
            workflowId: task.id,
            isActive: () => workflowActive(task),
            own,
          }),
          onProgress: entries => { if (workflowActive(task)) updateWorkflowProgressBatch(task, entries); },
          // The dialog's pause / skip / retry keys run through this; it is dropped
          // again when the task settles.
          onControl: control => { if (workflowActive(task)) { task.control = control; manager.notifyChanged(); } },
          journal: {
            ...(task.replay !== undefined ? { entries: task.replay } : {}),
            ...(task.journalPath !== undefined
              ? { append: (entry: WorkflowJournalEntry) => { if (workflowActive(task)) appendJournal(task.journalPath!, entry); } }
              : {}),
          },
        });
        if (workflowTasks.get(task.id) !== task) return;
        completeWorkflowTask(task, result);
      } catch (err) {
        if (workflowTasks.get(task.id) === task) failWorkflowTask(task, err instanceof Error ? err.message : String(err));
      }
    });
  }

  /**
   * Hand a finished run back to the model through the SAME channel a background
   * agent uses — held briefly by `scheduleNudge`, delivered as a follow-up that
   * triggers a turn, rendered by the existing `subagent-notification` renderer.
   */
  function notifyWorkflowFinished(task: WorkflowTask) {
    if (!workflowActive(task) || !task.terminalResolved || task.resultConsumed || task.notificationDelivered || coordinator.countWaits({ sourceId: "agent", taskId: task.id, runId: task.id }) > 0) return;
    assertActive();
    const result = workflowResultText(task);
    scheduleNudge(task.id, () => {
      if (!workflowActive(task) || task.resultConsumed || task.notificationDelivered || coordinator.countWaits({ sourceId: "agent", taskId: task.id, runId: task.id }) > 0) return;
      pi.sendMessage<NotificationDetails>({
        customType: "subagent-notification",
        content: formatWorkflowNotification(task),
        display: true,
        details: {
          id: task.id,
          description: `Workflow ${task.workflowName ?? task.id}`,
          status: task.status === "completed" ? "completed" : task.status === "killed" ? "stopped" : "error",
          toolUses: task.totalToolCalls,
          // A workflow has agents, not turns; rendering "↻0" would be noise.
          turnCount: 0,
          totalTokens: task.totalTokens,
          durationMs: elapsedMs(task, Date.now()),
          error: task.error,
          resultPreview: result.length > 500 ? `${result.slice(0, 500)}…` : result,
        },
      }, { deliverAs: "followUp", triggerTurn: true });
      task.notificationDelivered = true;
    });
  }

  // Defined unconditionally, registered only when the feature is on — the same
  // shape the subagent_run tool uses. Keeping the definition out of the `if` means the
  // switch changes exactly one thing: whether pi is ever told about the tool.
  const workflowTool = defineTool({
    name: SUBAGENT_TOOL_NAMES.WORKFLOW,
    label: "subagent_workflow",
    description: "Run a workflow script with explicit user orchestration authorization.",
    promptSnippet: "Run a deterministic script that orchestrates many subagents",
    promptGuidelines: workflowToolGuidance(),
    parameters: Type.Object({
      script: nullableControl(
        Type.String({
          maxLength: 524288,
          description: "Inline workflow source. Set null when using another source or replaying the prior script. Must begin with `export const meta = { name, description }`.",
        }),
      ),
      scriptPath: nullableControl(
        Type.String({
          description:
            "Workflow script file path; set null when unused. Mutually exclusive with non-null script and name.",
        }),
      ),
      name: nullableControl(
        Type.String({
          description:
            "Saved workflow name; set null when unused. Mutually exclusive with non-null script and scriptPath. Looked up in project .pi/workflows, .agents/workflows and the user's workflow directory.",
        }),
      ),
      args: Type.Any({
        description: "Required JSON data passed to the script as global args, verbatim. Null is data, not an unspecified control value.",
      }),
      resumeFromRunId: nullableControl(
        Type.String({
          pattern: "^wf_[a-z0-9-]{6,}$",
          description:
            "Set null for a new execution, or provide a run id of an earlier workflow in this session. Its unchanged leading agent() calls return their recorded results instantly; the first changed or failed call, and everything after it, runs live. Same script and args means nothing re-runs.",
        }),
      ),

    }, { additionalProperties: false }),

    renderCall(args, theme, context) {
      return createToolCallHeading({ name: "subagent_workflow", detail: workflowCallName({ script: args.script ?? undefined, scriptPath: args.scriptPath ?? undefined, name: args.name ?? undefined }), theme, context });
    },

    renderResult(result, options, theme, renderContext) {
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      const taskId = (result.details as { taskId?: string } | undefined)?.taskId;
      const task = taskId !== undefined ? workflowTasks.get(taskId) : undefined;
      // No task means the run predates this session (a reloaded transcript) or
      // the call never started one — show what `execute` said instead.
      if (renderContext.isError || !task) return new Text(text, 0, 0);
      return renderWorkflowCard(
        {
          progress: task.workflowProgress,
          task: {
            status: task.status,
            workflowName: task.workflowName,
            startTime: task.startTime,
            endTime: task.endTime,
            totalPausedMs: task.totalPausedMs,
          },
          meta: task.meta,
          agentCount: task.agentCount,
          totalTokens: task.totalTokens,
        },
        theme,
        options.expanded,
      );
    },

    execute: async (toolCallId, input, _signal, _onUpdate, ctx) => {
      assertActive();
      let params;
      try { params = parseWorkflowToolArguments(input); assertBoundarySafe(params.args, "args"); }
      catch (err) { return errorResult(err instanceof Error ? err.message : String(err)); }
      const resumeFrom = resolveResumeTarget(params.resumeFromRunId, workflowTasks);
      if (resumeFrom !== undefined && !resumeFrom.ok) return errorResult(resumeFrom.message);

      // A resume with no source of its own re-runs what that run ran. The
      // common case is an edited script, but "run that again, cheaply" should
      // not require repeating a path the run already knows.
      const resolved = resolveWorkflowScript(
        params.script === undefined && params.scriptPath === undefined && params.name === undefined
          && resumeFrom !== undefined
          ? { scriptPath: resumeFrom.scriptPath }
          : params,
        ctx.cwd,
      );
      if (!resolved.ok) return errorResult(resolved.message);

      // Parsed before anything is scheduled: a bad `meta` is an authoring error
      // the model can fix immediately, and reporting it as a background run
      // that failed a second later would just cost a turn.
      let meta: WorkflowMeta;
      try {
        meta = validateScript(resolved.script).meta;
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const runId = workflowRunId();
      // Every invocation lands on disk next to the agent transcripts, so
      // iterating is edit-the-file-then-rerun-with-scriptPath rather than
      // re-emitting the whole source. The journal sits beside it under the same
      // id, which is what makes a run id enough to resume from.
      let savedPath: string | undefined;
      let journalPath: string | undefined;
      try {
        const dir = sessionTaskDir(ctx.cwd, ctx.sessionManager.getSessionId());
        savedPath = join(dir, `${runId}.workflow.js`);
        writeFileSync(savedPath, resolved.script, "utf-8");
        journalPath = join(dir, `${runId}.workflow.jsonl`);
      } catch (err) {
        savedPath = undefined;
        journalPath = undefined;
        console.warn(`[pi-subagents] could not persist workflow script: ${err instanceof Error ? err.message : String(err)}`);
      }

      const replay = resumeFrom !== undefined ? readJournal(resumeFrom.journalPath) : undefined;

      const task = createWorkflowTask({
        id: runId,
        script: resolved.script,
        scriptPath: resolved.scriptPath ?? savedPath,
        args: params.args,
        meta,
        toolCallId,
        ...(journalPath !== undefined ? { journalPath } : {}),
        ...(replay !== undefined && replay.length > 0 ? { replay, resumedFrom: resumeFrom!.runId } : {}),
      });
      task.onChanged = () => manager.notifyChanged();
      workflowTasks.set(runId, task);
      manager.notifyChanged();
      assertActive();

      // Background, like Claude Code: the id comes back now and the run keeps
      // going without the tool call.
      void runWorkflowTask(ctx, task).then(() => notifyWorkflowFinished(task));

      return {
        content: [{
          type: "text" as const,
          text:
            `Workflow "${meta.name}" started in the background.\n` +
            `${launchText(launchMetadata("workflow", runId, runId, "background"))}\n` +
            (task.scriptPath ? `Script: ${task.scriptPath}\n` : "") +
            (task.resumedFrom !== undefined
              ? `Resuming ${task.resumedFrom}: ${task.replay?.length ?? 0} recorded call(s) available to replay.\n`
              : params.resumeFromRunId !== undefined
                ? `Nothing to replay from ${params.resumeFromRunId} — every agent runs live.\n`
                : "") +
            `\nYou will be notified when it finishes — do NOT poll or sleep waiting for it.\n` +
            `To iterate, edit the script file and call subagent_workflow again with scriptPath.`,
        }],
        details: { taskId: runId, runtimeLaunch: launchMetadata("workflow", runId, runId, "background") },
      };
    },
  });

  if (isWorkflowsEnabled()) pi.registerTool(withUsageReporting(workflowTool));

  /**
   * Act on {@link decideWorkflowCollision} — the half that needs the host.
   *
   * The policy (what counts as a conflict, what a pin changes, whether there is
   * anything left to withdraw) lives in `workflow/collisions.ts`; this is the
   * host-facing shell around it: read the registry, warn, and take our tool out
   * of the active set.
   *
   * ## Why this can only happen at session_start
   *
   * `getAllTools` throws during extension loading ("Action methods cannot be
   * called during extension loading"), and load order means a check at
   * registration time could not see an extension that has not loaded yet. So
   * the decision cannot gate `registerTool`; it has to undo it. `setActiveTools`
   * is what makes that real rather than cosmetic — pi rebuilds the system
   * prompt from the new set, and `session_start` runs before any turn, so the
   * model never sees a spec we withdrew. A later `_refreshToolRegistry` keeps
   * the active set it had and only adds names new to the registry, so ours does
   * not creep back.
   *
   * Best-effort and swallowed. A diagnostic that took the session down would be
   * worse than the collision it reports.
   */
  let collisionsChecked = false;
  function resolveWorkflowCollisions(ctx: ExtensionContext): void {
    if (collisionsChecked) return;
    collisionsChecked = true;

    const warn = (message: string) => {
      if (ctx.hasUI) ctx.ui.notify(message, "warning");
      else console.warn(`[pi-subagents] ${message}`);
    };

    try {
      if (!isWorkflowsEnabled()) return;

      const verdict = decideWorkflowCollision({
        tools: pi.getAllTools(),
        // Identifies our own registration: this extension does not know its
        // install path, and the description is the one field certainly ours.
        ownDescription: workflowTool.description,
        pinned: isWorkflowsPinned(),
      });
      if (verdict.kind === "none") return;
      if (verdict.kind === "report") {
        warn(verdict.message);
        return;
      }

      workflowsEnabled = false; // not setWorkflowsEnabled: this is not the user pinning it
      assertActive();
      warn(verdict.message);

      if (!verdict.withdraw) return;
      const active = pi.getActiveTools();
      if (active.includes(SUBAGENT_TOOL_NAMES.WORKFLOW)) {
        pi.setActiveTools(active.filter(name => name !== SUBAGENT_TOOL_NAMES.WORKFLOW));
      }
    } catch {
      // getAllTools/setActiveTools are unavailable in some hosts (print mode,
      // RPC). Not being able to check is not a reason to fail the session.
    }
  }

  /**
   * `--subagents-workflow-file=<path>` — run a script at startup, with no LLM
   * round-trip deciding whether to call the tool.
   *
   * Read here rather than at activation because that is the only place the real
   * value exists: the host activates extensions first and applies collected CLI
   * flags second, so `getFlag` during activation returns the registered default
   * and nothing else. `examples/extensions/ssh.ts` reads its flag from
   * session_start for exactly this reason.
   */
  let workflowFlagHandled = false;
  function runWorkflowFlag(ctx: ExtensionContext): void {
    if (!active()) return;
    if (workflowFlagHandled) return;
    const flag = pi.getFlag(WORKFLOW_FILE_FLAG);
    if (flag === undefined || flag === false) return;
    workflowFlagHandled = true;

    const report = (message: string, level: "info" | "warning") => {
      if (!active()) return;
      if (ctx.hasUI) ctx.ui.notify(message, level);
      else console.warn(`[pi-subagents] ${message}`);
    };

    // The flag is the same machinery by another door, so the master switch has
    // to close it too — silently ignoring a flag the user typed would be worse
    // than saying why nothing ran.
    if (!isWorkflowsEnabled()) {
      report(
        `--${WORKFLOW_FILE_FLAG} ignored: workflows are off. Turn them on in /agents-config → Settings → Workflows, ` +
          'or set `"workflowsEnabled": true` in .pi/agent-tasks.json.',
        "warning",
      );
      return;
    }

    // A bare `--subagents-workflow-file` parses to boolean `true`. Say what was
    // missing rather than reading a file called "true".
    if (typeof flag !== "string" || flag.trim() === "") {
      report(`--${WORKFLOW_FILE_FLAG} needs a path: --${WORKFLOW_FILE_FLAG}=<path>`, "warning");
      return;
    }

    const path = isAbsolute(flag.trim()) ? flag.trim() : join(ctx.cwd, flag.trim());
    let script: string;
    try {
      script = readFileSync(path, "utf-8");
    } catch (err) {
      report(`Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`, "warning");
      return;
    }

    let meta: WorkflowMeta | undefined;
    try {
      meta = extractMeta(script).meta;
    } catch (err) {
      report(err instanceof Error ? err.message : String(err), "warning");
      return;
    }

    const task = createWorkflowTask({ id: workflowRunId(), script, scriptPath: path, meta });
    task.onChanged = () => manager.notifyChanged();
    workflowTasks.set(task.id, task);
    manager.notifyChanged();
    assertActive();
    report(`Running workflow ${meta.name}…`, "info");

    // Detached: session_start is awaited by the host, and a workflow can run for
    // minutes — blocking here would hold the whole session's startup.
    void runWorkflowTask(ctx, task).then(() => {
      if (!workflowActive(task)) return;
      // No tool call to attach a result card to, so the card becomes a session
      // entry (same layout), and the outcome is handed to the model as context
      // for its next turn rather than forcing one.
      pi.appendEntry<WorkflowEntryData>(WORKFLOW_ENTRY_TYPE, workflowEntryData(task));
      pi.sendMessage({
        customType: "workflow-result",
        content: formatWorkflowNotification(task),
        display: false,
      }, { deliverAs: "nextTurn" });
      assertActive();
    });
  }

  function formatRetrievedAgent(record: AgentRecord, verbose?: boolean) {
      const displayName = getDisplayName(record.type);
      const duration = formatDuration(record.startedAt, record.completedAt);
      const tokens = formatLifetimeTokens(record);
      const contextPercent = getSessionContextPercent(record.session);
      const statsParts = [`Tool uses: ${record.toolUses}`];
      if (tokens) statsParts.push(tokens);
      if (showCost) {
        const costText = formatCost(getLifetimeCost(record.lifetimeUsage));
        if (costText) statsParts.push(`Cost: ${costText}`);
      }
      if (contextPercent !== null) statsParts.push(`Context: ${Math.round(contextPercent)}%`);
      if (record.compactionCount) statsParts.push(`Compactions: ${record.compactionCount}`);
      statsParts.push(`Duration: ${duration}`);

      let output =
        `Agent: ${record.id}\n` +
        `Type: ${displayName} | Status: ${record.status}${getStatusNote(record.status)} | ${statsParts.join(" | ")}\n` +
        `Description: ${record.description}\n\n`;

      if (record.status === "running" || record.status === "queued") {
        output += `Agent is still ${record.status}. Use agent_manage action=wait or check back later.`;
      } else if (record.status === "error") {
        output += `Error: ${record.error}${partialOutputSuffix(record)}`;
      } else {
        output += record.result?.trim() || "No output.";
      }

      // Verbose: include full conversation
      if (verbose && (record.terminalConversation !== undefined || record.session)) {
        const conversation = record.terminalConversation ?? getAgentConversation(record.session!);
        if (conversation) {
          output += `\n\n--- Agent Conversation ---\n${conversation}`;
        }
      }

      return textResult(output);
  }

  // ---- subagent_message tool ----

  registerToolReportingUsage(defineTool({
    name: SUBAGENT_TOOL_NAMES.STEER,
    label: "subagent_message",
    description: "Send additional guidance to a currently running agent; delivery does not confirm processing.",
    promptGuidelines: messageToolGuidance(),
    promptSnippet: "Send additional guidance to a running agent",
    parameters: Type.Object({
      agent_id: Type.String({
        description: "Real agent_id from launch/list; must identify a currently running agent owned by this session. Names and execution_id are not accepted.",
      }),
      message: Type.String({
        minLength: 1,
        description: "The non-blank steering message to send. This will appear as a user message in the agent's conversation.",
      }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      try { assertMessageToolArguments(params); }
      catch (err) { return errorResult(err instanceof Error ? err.message : String(err)); }
      const record = manager.getRecord(params.agent_id);
      if (!record || !isTopLevelAgent(record)) {
        return errorResult(`Agent not found: "${params.agent_id}". It may have been cleaned up.`);
      }
      if (record.status !== "running") {
        return errorResult(`Agent "${params.agent_id}" is not running (status: ${record.status}). Cannot steer a non-running agent.`);
      }
      if (!record.session) {
        // Session not ready yet — queue the steer for delivery once initialized
        if (!record.pendingSteers) record.pendingSteers = [];
        record.pendingSteers.push(params.message);
        pi.events.emit("subagents:steered", { id: record.id, message: params.message });
        return textResult(`Steering message queued for agent ${record.id}. It will be delivered once the session initializes.`);
      }

      try {
        await steerAgent(record.session, params.message);
        assertActive();
        pi.events.emit("subagents:steered", { id: record.id, message: params.message });
        const tokens = formatLifetimeTokens(record);
        const contextPercent = getSessionContextPercent(record.session);
        const stateParts: string[] = [];
        if (tokens) stateParts.push(tokens);
        if (showCost) {
          const costText = formatCost(getLifetimeCost(record.lifetimeUsage));
          if (costText) stateParts.push(costText);
        }
        stateParts.push(`${record.toolUses} tool ${record.toolUses === 1 ? "use" : "uses"}`);
        if (contextPercent !== null) stateParts.push(`context ${Math.round(contextPercent)}% full`);
        if (record.compactionCount) stateParts.push(`${record.compactionCount} compaction${record.compactionCount === 1 ? "" : "s"}`);
        return textResult(
          `Steering message sent to agent ${record.id}. Submitted to its session; this does not confirm it has been read or processed.\n` +
          `Current state: ${stateParts.join(" · ")}`,
        );
      } catch (err) {
        return errorResult(`Failed to steer agent: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  }));

  // ---- /agents-config and /agents-create ----

  // Directory resolution and the frontmatter edits live in agent-file-toggle.ts
  // so they are reachable from tests — this command handler is only registered
  // through `registerCommand`, which every test mocks.

  function getModelLabel(type: string, registry?: ModelRegistry): string {
    const cfg = getAgentConfig(type);
    if (!cfg?.model) return "inherit"; // no model configured → really inherits parent
    const label = getModelLabelFromConfig(cfg.model);
    if (!registry) return label;
    const resolved = resolveModel(cfg.model, registry);
    // Configured but unresolvable: the runtime silently falls back to the parent
    // model, so flag it (and the fallback) rather than hiding the config.
    if (typeof resolved === "string") return `${label} (unavailable, fallback: inherit)`;
    // Surface what it actually resolved to when that differs from the config —
    // e.g. a provider fallback or a looser version pin. Cosmetic separator/date
    // differences are normalized away so an effectively-identical match stays quiet.
    const resolvedFull = `${resolved.provider}/${resolved.id}`;
    const norm = (s: string) => s.toLowerCase().replace(/\./g, "-").replace(/-\d{8}$/, "");
    if (norm(cfg.model) === norm(resolvedFull)) return label;
    return `${label} (→ ${resolvedFull.replace(/-\d{8}$/, "")})`;
  }

  async function showAllAgentsList(ctx: ExtensionCommandContext) {
    const allNames = getAllTypes();
    if (allNames.length === 0) {
      ctx.ui.notify("No agents.", "info");
      return;
    }

    // Source indicators: defaults unmarked, custom agents get • (project) or ◦ (global)
    // Disabled agents get ✕ prefix
    const sourceIndicator = (cfg: AgentConfig | undefined) => {
      const disabled = cfg?.enabled === false;
      if (cfg?.source === "project") return disabled ? "✕• " : "•  ";
      if (cfg?.source === "global") return disabled ? "✕◦ " : "◦  ";
      if (disabled) return "✕  ";
      return "   ";
    };

    // One row per agent (name in the left column, model on the right); the
    // full description renders below the highlighted row via SettingsList,
    // exactly like the Settings menu — so long descriptions never wrap the list.
    const items: SettingItem[] = allNames.map(name => {
      const cfg = getAgentConfig(name);
      const disabled = cfg?.enabled === false;
      const model = getModelLabel(name, ctx.modelRegistry);
      return {
        id: name,
        label: `${sourceIndicator(cfg)}${name}`,
        currentValue: model,
        description: disabled ? "(disabled)" : (cfg?.description ?? name),
        // Single-value list so Enter "activates" the row (fires onChange with the
        // agent's id) without offering anything to actually cycle.
        values: [model],
      };
    });

    const hasCustom = allNames.some(n => { const c = getAgentConfig(n); return c && !c.isDefault && c.enabled !== false; });
    const hasDisabled = allNames.some(n => getAgentConfig(n)?.enabled === false);
    const legendParts: string[] = [];
    if (hasCustom) legendParts.push("• = project  ◦ = global");
    if (hasDisabled) legendParts.push("✕ = disabled");

    const selected = await ctx.ui.custom<string | undefined>((_tui, _theme, _kb, done) => {
      const slTheme = getSettingsListTheme();
      const list = new SettingsList(
        items,
        Math.min(items.length, 12),
        slTheme,
        id => done(id), // Enter/Space on a row → return that agent's name
        () => done(undefined), // Esc → cancel
      );
      const container = new Container();
      container.addChild(new Text("Agent types", 0, 0));
      if (legendParts.length) container.addChild(new Text(slTheme.hint(legendParts.join("  ")), 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(list);
      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => list.handleInput?.(data),
      };
    });
    assertActive();

    if (selected && getAgentConfig(selected)) {
      await showAgentDetail(ctx, selected);
      assertActive();
      await showAllAgentsList(ctx);
      assertActive();
    }
  }

  async function showAgentDetail(ctx: ExtensionCommandContext, name: string) {
    const cfg = getAgentConfig(name);
    if (!cfg) {
      ctx.ui.notify(`Agent config not found for "${name}".`, "warning");
      return;
    }

    const file = locateAgentFile(name, cfg.sourcePath);
    const isDefault = cfg.isDefault === true;
    const disabled = cfg.enabled === false;

    let menuOptions: string[];
    if (disabled && file) {
      // Disabled agent with a file — offer Enable
      menuOptions = isDefault
        ? ["Enable", "Edit", "Reset to default", "Delete", "Back"]
        : ["Enable", "Edit", "Delete", "Back"];
    } else if (isDefault && !file) {
      // Default agent with no .md override
      menuOptions = ["Eject (export as .md)", "Disable", "Back"];
    } else if (isDefault && file) {
      // Default agent with .md override (ejected)
      menuOptions = ["Edit", "Disable", "Reset to default", "Delete", "Back"];
    } else {
      // User-defined agent
      menuOptions = ["Edit", "Disable", "Delete", "Back"];
    }

    const choice = await ctx.ui.select(name, menuOptions);
    assertActive();
    if (!choice || choice === "Back") return;

    if (choice === "Edit" && file) {
      const content = readFileSync(file.path, "utf-8");
      const edited = await ctx.ui.editor(`Edit ${name}`, content);
      assertActive();
      if (edited !== undefined && edited !== content) {
        const { writeFileSync } = await import("node:fs");
        assertActive();
        writeFileSync(file.path, edited, "utf-8");
        reloadCustomAgents();
        ctx.ui.notify(`Updated ${file.path}`, "info");
      }
    } else if (choice === "Delete") {
      if (file) {
        const confirmed = await ctx.ui.confirm("Delete agent", `Delete ${name} from ${file.location} (${file.path})?`);
        assertActive();
        if (confirmed) {
          unlinkSync(file.path);
          reloadCustomAgents();
          ctx.ui.notify(`Deleted ${file.path}`, "info");
        }
      }
    } else if (choice === "Reset to default" && file) {
      const confirmed = await ctx.ui.confirm("Reset to default", `Delete override ${file.path} and restore embedded default?`);
      assertActive();
      if (confirmed) {
        unlinkSync(file.path);
        reloadCustomAgents();
        ctx.ui.notify(`Restored default ${name}`, "info");
      }
    } else if (choice.startsWith("Eject")) {
      await ejectAgent(ctx, name, cfg);
      assertActive();
    } else if (choice === "Disable") {
      await disableAgent(ctx, name);
      assertActive();
    } else if (choice === "Enable") {
      await enableAgent(ctx, name);
      assertActive();
    }
  }

  /** Eject a default agent: write its embedded config as a .md file. */
  async function ejectAgent(ctx: ExtensionCommandContext, name: string, cfg: AgentConfig) {
    const location = await ctx.ui.select("Choose location", [
      "Project (.pi/agents/)",
      `Personal (${personalAgentsDir()})`,
    ]);
    assertActive();
    if (!location) return;

    const targetDir = location.startsWith("Project") ? projectAgentsDir() : personalAgentsDir();
    mkdirSync(targetDir, { recursive: true });

    const targetPath = join(targetDir, `${name}.md`);
    if (existsSync(targetPath)) {
      const overwrite = await ctx.ui.confirm("Overwrite", `${targetPath} already exists. Overwrite?`);
      assertActive();
      if (!overwrite) return;
    }

    const content = serializeAgentFile(cfg);

    const { writeFileSync } = await import("node:fs");
    assertActive();
    writeFileSync(targetPath, content, "utf-8");
    reloadCustomAgents();
    ctx.ui.notify(`Ejected ${name} to ${targetPath}`, "info");
  }

  /** Disable an agent: set enabled: false in its .md file, or create a stub for built-in defaults. */
  async function disableAgent(ctx: ExtensionCommandContext, name: string) {
    const file = locateAgentFile(name, getAgentConfig(name)?.sourcePath);
    if (file) {
      // Existing file — set enabled: false in frontmatter (idempotent)
      const content = readFileSync(file.path, "utf-8");
      const { content: updated, outcome } = disableInContent(content);
      if (outcome === "already-disabled") {
        ctx.ui.notify(`${name} is already disabled.`, "info");
        return;
      }
      if (outcome === "no-frontmatter") {
        // Nothing to edit — say so rather than rewriting the file unchanged and
        // reporting success for a change that never happened.
        ctx.ui.notify(`Cannot disable ${name}: ${file.path} has no frontmatter block.`, "error");
        return;
      }
      const { writeFileSync } = await import("node:fs");
      assertActive();
      writeFileSync(file.path, updated, "utf-8");
      reloadCustomAgents();
      ctx.ui.notify(`Disabled ${name} (${file.path})`, "info");
      return;
    }

    // No file (built-in default) — create a stub
    const location = await ctx.ui.select("Choose location", [
      "Project (.pi/agents/)",
      `Personal (${personalAgentsDir()})`,
    ]);
    assertActive();
    if (!location) return;

    const targetDir = location.startsWith("Project") ? projectAgentsDir() : personalAgentsDir();
    mkdirSync(targetDir, { recursive: true });

    const targetPath = join(targetDir, `${name}.md`);
    const { writeFileSync } = await import("node:fs");
    assertActive();
    writeFileSync(targetPath, "---\nenabled: false\n---\n", "utf-8");
    reloadCustomAgents();
    ctx.ui.notify(`Disabled ${name} (${targetPath})`, "info");
  }

  /** Enable a disabled agent by removing enabled: false from its frontmatter. */
  async function enableAgent(ctx: ExtensionCommandContext, name: string) {
    const file = locateAgentFile(name, getAgentConfig(name)?.sourcePath);
    if (!file) return;

    const content = readFileSync(file.path, "utf-8");
    const { content: updated, changed } = enableInContent(content);
    if (!changed && !isEmptyStub(updated)) {
      // The file carries no `enabled: false` to remove, so it was never disabled
      // by us — reporting success here would hide a no-op.
      ctx.ui.notify(`${name} is not disabled in ${file.path}.`, "info");
      return;
    }
    const { writeFileSync } = await import("node:fs");
    assertActive();

    // If the file was just a stub ("---\n---\n"), delete it to restore the built-in default
    if (isEmptyStub(updated)) {
      unlinkSync(file.path);
      reloadCustomAgents();
      ctx.ui.notify(`Enabled ${name} (removed ${file.path})`, "info");
    } else {
      writeFileSync(file.path, updated, "utf-8");
      reloadCustomAgents();
      ctx.ui.notify(`Enabled ${name} (${file.path})`, "info");
    }
  }

  async function showCreateWizard(ctx: ExtensionCommandContext) {
    const location = await ctx.ui.select("Choose location", [
      "Project (.pi/agents/)",
      `Personal (${personalAgentsDir()})`,
    ]);
    assertActive();
    if (!location) return;

    const targetDir = location.startsWith("Project") ? projectAgentsDir() : personalAgentsDir();

    const method = await ctx.ui.select("Creation method", [
      "Generate with Claude (recommended)",
      "Manual configuration",
    ]);
    assertActive();
    if (!method) return;

    if (method.startsWith("Generate")) {
      await showGenerateWizard(ctx, targetDir);
      assertActive();
    } else {
      await showManualWizard(ctx, targetDir);
      assertActive();
    }
  }

  async function showGenerateWizard(ctx: ExtensionCommandContext, targetDir: string) {
    const description = await ctx.ui.input("Describe what this agent should do");
    assertActive();
    if (!description) return;

    const name = await ctx.ui.input("Agent name (filename, no spaces)");
    assertActive();
    if (!name) return;

    mkdirSync(targetDir, { recursive: true });

    const targetPath = join(targetDir, `${name}.md`);
    if (existsSync(targetPath)) {
      const overwrite = await ctx.ui.confirm("Overwrite", `${targetPath} already exists. Overwrite?`);
      assertActive();
      if (!overwrite) return;
    }

    ctx.ui.notify("Generating agent definition...", "info");

    const generatePrompt = `Create a custom pi sub-agent definition file based on this description: "${description}"

Write a markdown file to: ${targetPath}

The file format is a markdown file with YAML frontmatter and a system prompt body:

\`\`\`markdown
---
description: <one-line description shown in UI>
color: <optional agent name badge color: red, blue, green, yellow, purple, orange, pink, cyan, an Agency Agents alias, or quoted "#RRGGBB">
tools: <comma-separated built-in tools: read, bash, edit, write, grep, find, ls. Use "none" for no tools. Omit for all tools>
model: <optional model as "provider/modelId", e.g. "anthropic/claude-haiku-4-5". Omit to inherit parent model>
thinking: <optional thinking level: ${THINKING_LEVELS.join(", ")}. Omit to inherit>
max_turns: <optional max agentic turns. 0 or omit for unlimited (default)>
prompt_mode: <"replace" (body IS the full system prompt) or "append" (body is appended to default prompt). Default: replace>
extensions: <true (inherit all MCP/extension tools), false (none), or comma-separated names. Default: true>
skills: <true (inherit all), false (none), or comma-separated skill names to preload into prompt. Default: true>
disallowed_tools: <comma-separated tool names to block, even if otherwise available. Omit for none>
inherit_context: <true to fork parent conversation into agent so it sees chat history. Default: false>
run_in_background: <pin this agent to background (true) or foreground (false). Omit to follow the backgroundByDefault setting, which is background>
output_transcript: <false to write no transcript file or path for this agent. Independent of persist_session. Default: true>
isolated: <true for no extension/MCP tools, only built-in tools. Default: false>
memory: <"user" (global), "project" (per-project), or "local" (gitignored per-project) for persistent memory. Omit for none>${
      // Offering the field on a project that turned worktrees off would bake a
      // request that is refused at spawn time into a file that outlives the
      // session — the #231 pathology (models fill the fields they are shown)
      // one layer up. Built per invocation, so this read is live.
      isWorktreeIsolationEnabled()
        ? `\nisolation: <"worktree" to run in isolated git worktree; "off" to refuse one even when the caller asks. Omit for normal>`
        : ""
    }
---

<system prompt body — instructions for the agent>
\`\`\`

Guidelines for choosing settings:
- For read-only tasks (review, analysis): tools: read, bash, grep, find, ls
- For code modification tasks: include edit, write
- Use prompt_mode: append if the agent should keep the default system prompt and add specialization on top
- Use prompt_mode: replace for fully custom agents with their own personality/instructions
- Set inherit_context: true if the agent needs to know what was discussed in the parent conversation
- Set isolated: true if the agent should NOT have access to MCP servers or other extensions
- Set output_transcript: false to skip writing this agent's transcript; this alone doesn't keep the run off disk (persist_session, isolation: worktree commits, and memory still write) — set those too if that's the goal
- Only include frontmatter fields that differ from defaults — omit fields where the default is fine

Write the file using the write tool. Only write the file, nothing else.`;

    const { record } = await manager.spawnAndWait(pi, ctx, "general-purpose", generatePrompt, {
      description: `Generate ${name} agent`,
      maxTurns: 5,
      // Exempt from maxConcurrentForeground. This runs from a modal wizard, not
      // a tool call: it passes no signal, and Esc in `ctx.ui` never reaches the
      // manager — so a user waiting behind a full pool would have no way to
      // cancel at all. It is also one human action that cannot fan out, which
      // is what the limit exists to bound. It still counts once started.
      bypassQueue: true,
    });
    assertActive();

    if (record.status === "error") {
      ctx.ui.notify(`Generation failed: ${record.error}`, "warning");
      return;
    }

    reloadCustomAgents();

    if (existsSync(targetPath)) {
      ctx.ui.notify(`Created ${targetPath}`, "info");
    } else {
      ctx.ui.notify("Agent generation completed but file was not created. Check the agent output.", "warning");
    }
  }

  async function showManualWizard(ctx: ExtensionCommandContext, targetDir: string) {
    // 1. Name
    const name = await ctx.ui.input("Agent name (filename, no spaces)");
    assertActive();
    if (!name) return;

    // 2. Description
    const description = await ctx.ui.input("Description (one line)");
    assertActive();
    if (!description) return;

    // 3. Tools
    const toolChoice = await ctx.ui.select("Tools", ["all", "none", "read-only (read, bash, grep, find, ls)", "custom..."]);
    assertActive();
    if (!toolChoice) return;

    let tools: string;
    if (toolChoice === "all") {
      tools = BUILTIN_TOOL_NAMES.join(", ");
    } else if (toolChoice === "none") {
      tools = "none";
    } else if (toolChoice.startsWith("read-only")) {
      tools = "read, bash, grep, find, ls";
    } else {
      const customTools = await ctx.ui.input("Tools (comma-separated)", BUILTIN_TOOL_NAMES.join(", "));
      assertActive();
      if (!customTools) return;
      tools = customTools;
    }

    // 4. Model
    const modelChoice = await ctx.ui.select("Model", [
      "inherit (parent model)",
      "haiku",
      "sonnet",
      "opus",
      "custom...",
    ]);
    assertActive();
    if (!modelChoice) return;

    let model: string | undefined;
    if (modelChoice === "haiku") model = "anthropic/claude-haiku-4-5";
    else if (modelChoice === "sonnet") model = "anthropic/claude-sonnet-4-6";
    else if (modelChoice === "opus") model = "anthropic/claude-opus-4-6";
    else if (modelChoice === "custom...") {
      model = (await ctx.ui.input("Model (provider/modelId)")) || undefined;
      assertActive();
    }

    // 5. Thinking
    // "inherit" is a UI-only pseudo-choice (omit the field); the rest mirror pi.
    const thinkingChoice = await ctx.ui.select("Thinking level", ["inherit", ...THINKING_LEVELS]);
    assertActive();
    if (!thinkingChoice) return;

    // 6. System prompt
    const systemPrompt = await ctx.ui.editor("System prompt", "");
    assertActive();
    if (systemPrompt === undefined) return;

    const content = buildNewAgentFile({
      description,
      tools,
      model,
      thinking: thinkingChoice === "inherit" ? undefined : thinkingChoice,
      systemPrompt,
    });

    mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, `${name}.md`);

    if (existsSync(targetPath)) {
      const overwrite = await ctx.ui.confirm("Overwrite", `${targetPath} already exists. Overwrite?`);
      assertActive();
      if (!overwrite) return;
    }

    const { writeFileSync } = await import("node:fs");
    assertActive();
    writeFileSync(targetPath, content, "utf-8");
    reloadCustomAgents();
    ctx.ui.notify(`Created ${targetPath}`, "info");
  }

  /**
   * Every settings mutation writes this WHOLE object back to disk, so a field
   * missing here is erased from the user's agent-tasks.json the next time they
   * toggle something unrelated. `SubagentsSettings` has every field optional,
   * so a `: SubagentsSettings` return annotation would let a newly-added setting
   * be forgotten here and still type-check. `satisfies` instead: it still checks
   * each value's type and rejects a mistyped key, but leaves the return type
   * inferred so `_NoMissingSettingsKeys` below can check completeness.
   */
  function snapshotSettings() {
    return {
      maxConcurrent: manager.getMaxConcurrent(),
      // 0 = unlimited, and the default — see SubagentsSettings.
      maxConcurrentForeground: manager.getMaxConcurrentForeground(),
      // 0 = unlimited — per SubagentsSettings.defaultMaxTurns docstring and
      // normalizeMaxTurns() in agent-runner.ts (which maps 0 → undefined).
      defaultMaxTurns: getDefaultMaxTurns() ?? 0,
      graceTurns: getGraceTurns(),
      defaultJoinMode: getDefaultJoinMode(),
      backgroundByDefault: getBackgroundByDefault(),
      scopeModels: isScopeModelsEnabled(),
      strictAgentFiles,
      disableDefaultAgents: isDefaultsDisabled(),
      agentMentions: getAgentMentionMode(),
      rememberAgents: getRememberAgents(),
      outputTranscript: getOutputTranscriptDefault(),
      worktreeIsolation: isWorktreeIsolationEnabled(),
      // The user's answer, not the effective one. A stand-down for another
      // extension's workflow tool is scoped to the session it was detected in;
      // writing it here would let an unrelated settings change three menus away
      // freeze it into the file as an explicit `false`, which then survives
      // uninstalling the extension it was deferring to. undefined is dropped by
      // JSON.stringify, so unset stays unset — same reasoning as
      // `fallbackSubagent` below.
      workflowsEnabled: isWorkflowsPinned() ? isWorkflowsEnabled() : undefined,
      maxSubagentDepth: getMaxSubagentDepth(),
      // Deliberately NOT `?? "general-purpose"`: every settings change writes the
      // whole snapshot, and materializing the implicit default would turn it into
      // explicit configuration — which then fails loudly if general-purpose later
      // goes away. undefined is dropped by JSON.stringify.
      fallbackSubagent: getFallbackSubagent(),
      reportUsage: isReportUsageEnabled(),
      showCost: isShowCostEnabled(),
    } satisfies SubagentsSettings;
  }

  // Compile-time completeness guard for snapshotSettings(). If a field is added
  // to SubagentsSettings and not mirrored above, this Exclude is non-empty and
  // fails to satisfy `never` — turning a silent settings-erasure bug into a
  // typecheck error. `npm run typecheck` runs in CI.
  type _NoMissingSettingsKeys =
    Exclude<keyof SubagentsSettings, keyof ReturnType<typeof snapshotSettings>> extends never
      ? true
      : ["snapshotSettings() is missing a SubagentsSettings key"];
  const _settingsSnapshotIsComplete: _NoMissingSettingsKeys = true;
  void _settingsSnapshotIsComplete;

  const NUMERIC_IDS = new Set([
    "maxConcurrent", "maxConcurrentForeground", "defaultMaxTurns", "graceTurns", "maxSubagentDepth",
  ]);

  async function showSettings(ctx: ExtensionCommandContext) {
    function buildItems(): SettingItem[] {
      const mc = manager.getMaxConcurrent();
      const mcf = manager.getMaxConcurrentForeground();
      const dmt = getDefaultMaxTurns() ?? 0;
      const gt = getGraceTurns();
      const msd = getMaxSubagentDepth();
      // Label what unset actually does — it targets general-purpose even when
      // that is unregistered (the permissive hardcoded tier), so showing "none"
      // there would advertise strict dispatch for the most permissive state.
      // `values` still offers only resolvable targets, so the user cannot
      // persist a fallback that would hard-error on every dispatch.
      const fallbackValue = getFallbackSubagent() ?? "general-purpose";
      const fallbackValues = [...new Set([...getAvailableTypes(), NO_FALLBACK])];

      return [
        {
          id: "maxConcurrent",
          label: "Max concurrency",
          description: "Max concurrent background agents (Enter to type)",
          currentValue: String(mc),
          values: [String(mc)],
        },
        {
          id: "maxConcurrentForeground",
          label: "Max foreground concurrency",
          description: "Max concurrent foreground (blocking) agents (0 = unlimited, Enter to type)",
          currentValue: String(mcf),
          values: [String(mcf)],
        },
        {
          id: "defaultMaxTurns",
          label: "Default max turns",
          description: "Default max turns before wrap-up (0 = unlimited, Enter to type)",
          currentValue: String(dmt),
          values: [String(dmt)],
        },
        {
          id: "graceTurns",
          label: "Grace turns",
          description: "Grace turns after wrap-up steer (Enter to type)",
          currentValue: String(gt),
          values: [String(gt)],
        },
        {
          id: "maxSubagentDepth",
          label: "Nested depth",
          description: "Hard cap on nested delegation — main is 0, its subagents 1 (0/1 = nesting off, Enter to type)",
          currentValue: String(msd),
          values: [String(msd)],
        },
        {
          id: "joinMode",
          label: "Join mode",
          description: "Default join mode for background agents",
          currentValue: getDefaultJoinMode(),
          values: ["smart", "async", "group"],
        },
        {
          id: "backgroundByDefault",
          label: "Background by default",
          description: "A subagent_run call that doesn't say runs detached (off = blocks the turn and returns inline)",
          currentValue: getBackgroundByDefault() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "workflowsEnabled",
          label: "Workflows",
          description:
            "Scripted workflows, on unless another extension provides a workflow tool "
            + "(off keeps the subagent_workflow tool out of the tool spec; applies on next pi session)",
          currentValue: isWorkflowsEnabled() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "scopeModels",
          label: "Scope models",
          description: "Validate subagent models against scoped models (/scoped-models)",
          currentValue: isScopeModelsEnabled() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "strictAgentFiles",
          label: "Strict agent files",
          description: "Fail startup on an unreadable/unparseable agent .md instead of skipping it with a warning",
          currentValue: strictAgentFiles ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "disableDefaultAgents",
          label: "Disable defaults",
          description: "Hide built-in agents (general-purpose, Explore, Plan) — custom agents are unaffected",
          currentValue: isDefaultsDisabled() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "fallbackSubagent",
          label: "Fallback agent",
          description: `Agent used when subagent_type is unknown, disabled, or ambiguous; "${NO_FALLBACK}" rejects the call instead (strict dispatch)`,
          currentValue: fallbackValue,
          values: fallbackValues,
        },
        {
          id: "outputTranscript",
          label: "Output transcript",
          description: "Write each subagent's .output transcript by default. A custom agent's output_transcript frontmatter overrides this.",
          currentValue: getOutputTranscriptDefault() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "worktreeIsolation",
          label: "Worktree isolation",
          description:
            "Allow isolation: worktree to copy the repo. Off refuses worktrees on every path immediately — for repos where a copy costs too much time or disk — and drops the `isolation` param from the subagent_run tool spec on next pi session.",
          currentValue: isWorktreeIsolationEnabled() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "reportUsage",
          label: "Report usage to session",
          description:
            "Add subagent tokens and cost to this session's own totals, so pi's footer and /cost stop reading a delegating session as nearly free. Reported on the next tool result (agents that finish in the background are counted on the one after). Context-window % is unaffected.",
          currentValue: isReportUsageEnabled() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "showCost",
          label: "Show cost",
          description:
            "Show an estimated `~$0.0042` beside subagent token counts in the widget, Task Panel, results and notifications. Priced by pi from the model's rates — omitted entirely for a model it has no rates for.",
          currentValue: isShowCostEnabled() ? "on" : "off",
          values: ["on", "off"],
        },
        {
          id: "agentMentions",
          label: "Agent mentions",
          description: "Route `@handle message` at the prompt to that agent. model = an off-screen clone of this conversation calls the subagent_run tool, so the agent gets a context-written prompt, a transcript and per-tool detail, and the chat stays clean; direct = started here from your text, no model call. Messaging and resuming are direct either way.",
          currentValue: getAgentMentionMode(),
          values: ["model", "direct", "off"],
        },
        {
          id: "rememberAgents",
          label: "Remember agents",
          description: "Persist subagent sessions so `@handle` can resume one long after it finished (they also appear in /resume)",
          currentValue: getRememberAgents() ? "on" : "off",
          values: ["on", "off"],
        },
      ];
    }

    function applyValue(id: string, value: string) {
      if (id === "maxConcurrent") {
        const n = parseInt(value, 10);
        if (n >= 1) {
          manager.setMaxConcurrent(n);
          notifyApplied(ctx, `Max concurrency set to ${n}`);
        }
      } else if (id === "maxConcurrentForeground") {
        // 0 is meaningful here, unlike maxConcurrent above: it means unlimited.
        const n = parseInt(value, 10);
        if (n >= 0) {
          manager.setMaxConcurrentForeground(n);
          notifyApplied(ctx, n === 0
            ? "Max foreground concurrency set to unlimited"
            : `Max foreground concurrency set to ${n}`);
        }
      } else if (id === "defaultMaxTurns") {
        const n = parseInt(value, 10);
        if (n === 0) {
          setDefaultMaxTurns(undefined);
          notifyApplied(ctx, "Default max turns set to unlimited");
        } else if (n >= 1) {
          setDefaultMaxTurns(n);
          notifyApplied(ctx, `Default max turns set to ${n}`);
        }
      } else if (id === "graceTurns") {
        const n = parseInt(value, 10);
        if (n >= 1) {
          setGraceTurns(n);
          notifyApplied(ctx, `Grace turns set to ${n}`);
        }
      } else if (id === "maxSubagentDepth") {
        const n = parseInt(value, 10);
        if (n >= 0) {
          setMaxSubagentDepth(n);
          notifyApplied(
            ctx,
            n <= 1
              ? "Nested delegation disabled"
              : `Nested depth set to ${n}. Applies to agents started from now on.`,
          );
        }
      } else if (id === "joinMode") {
        setDefaultJoinMode(value as JoinMode);
        notifyApplied(ctx, `Default join mode set to ${value}`);
      } else if (id === "backgroundByDefault") {
        const enabled = value === "on";
        setBackgroundByDefault(enabled);
        notifyApplied(
          ctx,
          enabled
            ? "subagent_run calls run in the background unless they pass run_in_background: false"
            : "subagent_run calls block and return inline unless they pass run_in_background: true",
        );
      } else if (id === "workflowsEnabled") {
        const enabled = value === "on";
        if (enabled === isWorkflowsEnabled()) {
          ctx.ui.notify(`Workflows already ${enabled ? "enabled" : "disabled"}.`, "info");
        } else {
          setWorkflowsEnabled(enabled);
          // Runs already in flight keep going: the switch governs whether the
          // tool is offered, and killing live agents on a settings toggle would
          // lose work the user never asked to discard.
          notifyApplied(
            ctx,
            `Workflows ${enabled ? "enabled" : "disabled"}. Tool spec change takes effect on next pi session.`,
          );
        }
      } else if (id === "scopeModels") {
        const enabled = value === "on";
        setScopeModelsEnabled(enabled);
        notifyApplied(ctx, `Scope models ${enabled ? "enabled" : "disabled"}`);
      } else if (id === "strictAgentFiles") {
        const enabled = value === "on";
        strictAgentFiles = enabled;
        notifyApplied(ctx, `Strict agent files ${enabled ? "enabled" : "disabled"}. Takes effect on next pi session.`);
      } else if (id === "disableDefaultAgents") {
        const enabled = value === "on";
        setDisableDefaultAgents(enabled);
        notifyApplied(ctx, `Default agents ${enabled ? "disabled" : "enabled"}. Tool spec change takes effect on next pi session.`);
      } else if (id === "fallbackSubagent") {
        setFallbackSubagent(value);
        notifyApplied(
          ctx,
          value === NO_FALLBACK
            ? "Unknown or disabled agent types will now be rejected"
            : `Unknown agent types will fall back to ${value}`,
        );
      } else if (id === "outputTranscript") {
        const enabled = value === "on";
        setOutputTranscriptDefault(enabled);
        notifyApplied(ctx, `Output transcript ${enabled ? "enabled" : "disabled"} by default`);
      } else if (id === "worktreeIsolation") {
        const enabled = value === "on";
        setWorktreeIsolationEnabled(enabled);
        // The refusal is live, but the tool schema is built at registration, so
        // the isolation parameter only appears/disappears next session.
        notifyApplied(
          ctx,
          `Worktree isolation ${enabled ? "enabled" : "disabled"}. Tool parameter updates on next pi session.`,
        );
      } else if (id === "reportUsage") {
        const enabled = value === "on";
        setReportUsage(enabled);
        notifyApplied(
          ctx,
          enabled
            ? "Subagent usage now counted in this session's totals"
            : "Subagent usage no longer counted in this session's totals",
        );
      } else if (id === "showCost") {
        const enabled = value === "on";
        setShowCost(enabled);
        notifyApplied(ctx, `Cost display ${enabled ? "enabled" : "disabled"}`);
      } else if (id === "agentMentions") {
        const mode = value as AgentMentionMode;
        setAgentMentionMode(mode);
        notifyApplied(
          ctx,
          mode === "off"
            ? "Agent mentions disabled"
            : mode === "model"
              ? "Agent mentions on — a conversation clone starts a mentioned agent off-screen"
              : "Agent mentions on — a mentioned agent starts here, with no model call",
        );
      } else if (id === "rememberAgents") {
        const enabled = value === "on";
        setRememberAgents(enabled);
        notifyApplied(ctx, `Remember agents ${enabled ? "enabled" : "disabled"}`);
      }
    }

    let list: SettingsList;
    // Track current selection index directly (SettingsList doesn't expose it).
    // Updated on arrow keys so Enter knows which field is selected immediately.
    let currentIndex = 0;

    const result = await ctx.ui.custom<string | undefined>((_tui, _theme, _kb, done) => {
      const items = buildItems();

      list = new SettingsList(
        items,
        items.length + 2,
        getSettingsListTheme(),
        (id, newValue) => {
          applyValue(id, newValue);
        },
        () => done(undefined as undefined),
      );

      const container = new Container();
      container.addChild(new Text("⚙  Subagent Settings", 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(list);

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          // Track navigation so Enter knows the current field
          if (matchesKey(data, "up")) {
            currentIndex = Math.max(0, currentIndex - 1);
          } else if (matchesKey(data, "down")) {
            currentIndex = Math.min(items.length - 1, currentIndex + 1);
          }

          // Enter on numeric field → close and prompt for typed input
          if (matchesKey(data, Key.enter) && NUMERIC_IDS.has(items[currentIndex].id)) {
            done(items[currentIndex].id);
            return;
          }
          list.handleInput?.(data);
        },
      };
    });
    assertActive();

    // If a numeric field ID was returned, prompt for typed input
    if (result && NUMERIC_IDS.has(result)) {
      const current = result === "maxConcurrent"
        ? String(manager.getMaxConcurrent())
        : result === "maxConcurrentForeground"
          ? String(manager.getMaxConcurrentForeground())
          : result === "defaultMaxTurns"
            ? String(getDefaultMaxTurns() ?? 0)
            : result === "maxSubagentDepth"
              ? String(getMaxSubagentDepth())
              : String(getGraceTurns());

      const label = result === "maxConcurrent"
        ? "Max concurrency (1+)"
        : result === "maxConcurrentForeground"
          ? "Max foreground concurrency (0 = unlimited)"
          : result === "defaultMaxTurns"
            ? "Default max turns (0 = unlimited)"
            : result === "maxSubagentDepth"
              ? "Nested depth (0/1 = nesting off)"
              : "Grace turns (1+)";

      // Loop until user enters a valid integer or cancels (Esc / null).
      // Silently trims whitespace; rejects non-numeric input by re-prompting.
      let input: string | undefined = await ctx.ui.input(label, current);
      assertActive();
      while (input != null) {
        const trimmed = input.trim();
        const n = Number(trimmed);
        if (trimmed !== "" && Number.isInteger(n)) {
          applyValue(result, String(n));
          await showSettings(ctx);
          assertActive();
          return;
        }
        // Invalid — re-prompt with the user's last entry so they can edit it
        input = await ctx.ui.input(label, trimmed);
        assertActive();
      }
    }
  }

  // Persist the current snapshot, emit `subagents:settings_changed`, and surface
  // the right toast. Successful saves show info; persistence failures downgrade
  // to warning so users aren't silently reverted on restart. Event fires regardless
  // of outcome so listeners see the in-memory change.
  /**
   * Persist + broadcast the settings, silent on success — for a change whose
   * feedback is the UI it just changed: the viewer's `m` key, where a
   * notification per press would talk over the overlay it is describing.
   *
   * A *failed* write still speaks. Every other settings path warns when the
   * value is session-only, and swallowing it here would leave a preference
   * looking persisted when the next session will not have it.
   */
  function persistSettings(ctx: ExtensionCommandContext | undefined, changeMsg: string): void {
    assertActive();
    const { message, level } = saveAndEmitChanged(
      snapshotSettings(),
      changeMsg,
      (event, payload) => pi.events.emit(event, payload),
    );
    // `ctx` is absent only on the fleet path between sessions, where
    // `currentCtx` has been cleared and there is no UI to carry the warning to.
    // The write still happens.
    if (level === "warning") ctx?.ui.notify(message, level);
  }

  function notifyApplied(ctx: ExtensionCommandContext, successMsg: string) {
    const { message, level } = saveAndEmitChanged(
      snapshotSettings(),
      successMsg,
      (event, payload) => pi.events.emit(event, payload),
    );
    ctx.ui.notify(message, level);
  }

  /**
   * Configuration home: agent types and settings. Runtime agents, workflows and
   * their controls live in the Task Panel, not here.
   */
  async function showAgentsConfig(ctx: ExtensionCommandContext) {
    assertActive();
    reloadCustomAgents();
    const types = `Agent types (${getAllTypes().length})`;
    const choice = await ctx.ui.select("Agents config", [types, "Settings"]);
    assertActive();
    if (!choice) return;
    if (choice === types) await showAllAgentsList(ctx);
    else await showSettings(ctx);
    assertActive();
    await showAgentsConfig(ctx);
  }

  pi.registerCommand("agents-config", {
    description: "Configure agent types and agent settings",
    handler: async (_args, ctx) => {
      assertActive();
      await showAgentsConfig(ctx);
      assertActive();
    },
  });

  pi.registerCommand("agents-create", {
    description: "Create a new agent type",
    handler: async (_args, ctx) => {
      assertActive();
      await showCreateWizard(ctx);
      assertActive();
    },
  });

}
