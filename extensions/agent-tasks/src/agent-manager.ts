import { resolvedExecutionConfig, sessionExecutionConfig } from "./execution-config.ts";
import { copyAgentExecutionConfig } from "../../runtime-tasks/execution-config.ts";
/**
 * agent-manager.ts — Tracks agents, background execution, resume support.
 *
 * There are two independent concurrency pools, never one:
 *
 * - Background (`maxConcurrent`, default 10) bounds detached agents.
 * - Foreground (`maxConcurrentForeground`, default 0 = unlimited) bounds
 *   agents a caller is blocking on inline — `spawnAndWait`.
 *
 * Independent by design: a foreground agent blocks the parent anyway, so
 * charging it to the background pool would let a saturated pool starve the main
 * session of work it could have done itself. Excess agents in either pool are
 * queued and auto-started as slots free up. Nested children take no slot in
 * either — see `occupiesPoolSlot` / `occupiesForegroundSlot`.
 */

import { getAgentConfig } from "./agent-types.ts";
import { normalizeAgentDescription } from "./spawn-input.ts";
import { createAgentManagement } from "./management.ts";
import { createAgentTaskSource } from "./source.ts";
import { getAgentConversation } from "./agent-runner.ts";
import { allocatePersistentAgent, loadSubagentRegistry, markRunningAgentsInterrupted, registryLocatorForRootSession, updatePersistentAgent, type PersistentAgentEntry, type RootRegistryLocator } from "./subagent-registry.ts";
import type { TaskIdentity, ToolCallState } from "../../task-ui/types.ts";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resumeAgent, runAgent, shutdownChildSession, stopChildSession, isChildSessionClosed, resolveEffectiveMaxTurns, type ToolActivity } from "./agent-runner.ts";
import { describeModel } from "./model-resolver.ts";
import type { AgentInvocation, AgentRecord, IsolationMode, SubagentType, ThinkingLevel } from "./types.ts";
import { addUsage, type LifetimeUsage } from "./usage.ts";
import { AgentMailbox, type AcceptedChildMessage, type MailboxResult, type ParentChannel, type ParentRequest } from "./parent-messaging.ts";
import type { CompiledSchema } from "./workflow/json-schema.ts";
import { cleanupWorktree, createWorktree, isWorktreeIsolationEnabled, } from "./worktree.ts";

/** Stable completion exists before queue admission or asynchronous startup. */
export interface AgentRunHandle {
  readonly identity: TaskIdentity;
  readonly terminal: Promise<AgentRecord>;
}
interface AgentRun extends AgentRunHandle {
  resolve: (record: AgentRecord) => void;
  resolveText: (text: string) => void;
  unlinkParent?: () => void;
  pool?: Pool;
  charged: boolean;
  settled: boolean;
  terminalResolved: boolean;
  sessions: Set<AgentSession>;
  pendingStops: number;
  toolCalls: Map<string, { state: ToolCallState; start?: number }>;
}
export interface AgentManagerDependencies {
  readonly runAgent?: typeof runAgent;
  readonly resumeAgent?: typeof resumeAgent;
  readonly createWorktree?: typeof createWorktree;
  readonly cleanupWorktree?: typeof cleanupWorktree;
  readonly worktreeEnabled?: () => boolean;
  /** Offline tests may shorten the production two-second shutdown budget. */
  readonly disposeTimeoutMs?: number;
}

export type OnAgentComplete = (record: AgentRecord) => void;
export type OnAgentStart = (record: AgentRecord) => void;
export type OnAgentCompact = (record: AgentRecord, info: CompactionInfo) => void;
/**
 * Fired once per assistant `message_end`, for EVERY agent this manager owns —
 * top-level and nested alike, spawns and resumes. The one place where each
 * message is seen exactly once: `AgentRecord.lifetimeUsage` is deliberately
 * double-booked into ancestors (see `nested-tools.ts`) so a hidden child's spend
 * shows up on the record a human can see, which makes those records useless as
 * a basis for anything that must not count a message twice — parent-session
 * accounting above all.
 */
export type OnAgentUsage = (record: AgentRecord, usage: LifetimeUsage) => void;
export type CompactionInfo = { reason: "manual" | "threshold" | "overflow"; tokensBefore: number };

/**
 * Default max concurrent background agents.
 *
 * Raised from 4 when top-level spawns started defaulting to background
 * (`backgroundByDefault`): foreground agents bypass this pool entirely, so
 * while foreground was the default a fan-out of six ran six. With background
 * as the default every top-level agent takes a slot, and a limit of 4 would
 * have silently queued the tail of exactly the parallel fan-outs the `subagent_run`
 * tool description tells the model to send.
 */
const DEFAULT_MAX_CONCURRENT = 10;

/**
 * Default max concurrent foreground (blocking) agents — `0` = unlimited, the
 * extension's existing convention for "no ceiling" (`defaultMaxTurns`).
 *
 * Off by default because nothing here ever bounded foreground work, and pi
 * dispatches a message's tool calls through `Promise.all`, so an unqualified
 * fan-out of blocking `subagent_run` calls has always run all at once. Users who want
 * it bounded — chiefly local models, where parallel agents thrash the prompt
 * cache (#253) — opt in; everyone else keeps today's behaviour exactly.
 */
const DEFAULT_MAX_CONCURRENT_FOREGROUND = 0;

/**
 * Validate a caller-supplied SpawnOptions.cwd. `undefined`/`null` mean "unset"
 * (parent cwd). Anything else must be an absolute path to an existing
 * directory — curated errors instead of TypeErrors from path/fs internals
 * (RPC callers send arbitrary JSON: null, numbers, file paths).
 */
function assertValidSpawnCwd(cwd: unknown): asserts cwd is string | undefined | null {
  if (cwd == null) return;
  if (typeof cwd !== "string" || !isAbsolute(cwd)) {
    throw new Error(`SpawnOptions.cwd must be an absolute path: "${String(cwd)}"`);
  }
  let isDirectory = false;
  try {
    isDirectory = statSync(cwd).isDirectory();
  } catch {
    throw new Error(`SpawnOptions.cwd does not exist: "${cwd}"`);
  }
  if (!isDirectory) {
    throw new Error(`SpawnOptions.cwd is not a directory: "${cwd}"`);
  }
}

/**
 * Whether a record occupies one of the `maxConcurrent` background slots.
 * Nested children don't: their parent already holds a slot, so counting (and
 * therefore queueing) them would deadlock a parent that waits on its own child.
 *
 * Note this bounds nothing horizontally — the depth cap limits how DEEP nesting
 * goes, not how WIDE. A parent's only limit on concurrent children is that each
 * spawn costs it a turn, which is unbounded when max turns is unlimited.
 */
function occupiesPoolSlot(
  record: Pick<AgentRecord, "isBackground" | "parentAgentId" | "workflowId">,
): boolean {
  return !!record.isBackground && isTopLevelAgent(record);
}

/**
 * Whether a record is one of the session's own agents, rather than something
 * another agent or a workflow owns.
 *
 * The single definition behind every user-facing surface — the fleet list, the
 * widget, the `/agents` menus, and the completion events
 * and session entries. An owned child reports through its owner, so surfacing
 * it separately would double-count the same work in the places a person reads.
 */
export function isTopLevelAgent(
  record: Pick<AgentRecord, "parentAgentId" | "workflowId">,
): boolean {
  return record.parentAgentId === undefined && record.workflowId === undefined;
}

/**
 * Whether a record occupies one of the `maxConcurrentForeground` slots.
 *
 * Keyed on `blocking` — a caller awaiting this record inline — rather than on
 * `isBackground === false`, because `spawn()` is also the funnel for DETACHED
 * starts (cross-extension RPC and the registry) that may pass
 * `isBackground: false` and are documented to run immediately regardless. Those
 * block nobody, so bounding them buys nothing and would park a record with no
 * one waiting to release it.
 *
 * Nested children are excluded for the same reason as `occupiesPoolSlot`, and
 * more sharply: their parent is blocked *awaiting them*, so queueing a child
 * behind its own parent is a guaranteed deadlock rather than a possible one.
 * Enforced here rather than at the call site so no caller can reintroduce it.
 *
 * A workflow's children go out through `spawnAndWait` and so are `blocking`
 * too, and are excluded on the same `isTopLevelAgent` test as the background
 * pool: the run already caps how many of its agents run at once, and charging
 * them here as well would let one fan-out queue behind a limit meant for the
 * session's own work.
 *
 * Like the background pool this bounds width at the top level only — a parent's
 * own fan-out is limited by nothing but its turn budget.
 */
function occupiesForegroundSlot(
  record: Pick<AgentRecord, "blocking" | "parentAgentId" | "workflowId">,
): boolean {
  return !!record.blocking && isTopLevelAgent(record);
}

/** Which concurrency pool a spawn is charged to, if any. */
type Pool = "background" | "foreground";

interface SpawnArgs {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  type: SubagentType;
  prompt: string;
  options: SpawnOptions;
}

interface SpawnOptions {
  description?: string | null;
  /** Existing persisted transcript to reopen during recovery. */
  resumeSessionFile?: string;
  model?: Model<any>;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  thinkingLevel?: ThinkingLevel;
  isBackground?: boolean;
  /**
   * Skip whichever pool's queue check applies to this spawn — start immediately
   * even if the configured concurrency limit would otherwise queue it. The slot
   * is still COUNTED once the run starts, so a bypassing spawn transiently
   * exceeds the limit rather than being invisible to it.
   *
   * Used by the `/agents-create` agent-file generator, which has no way to
   * cancel a wait (see its call site).
   */
  bypassQueue?: boolean;
  /**
   * A caller is awaiting this record inline (`spawnAndWait`) — what
   * `maxConcurrentForeground` bounds. Set only by `spawnAndWait`; stripped from
   * caller-supplied options by `spawnTopLevel`, since a forged `blocking` would
   * defer a detached start behind a queue its caller cannot see or release.
   */
  blocking?: boolean;
  /**
   * The workflow run this child belongs to, when a workflow spawned it.
   *
   * Ownership, not decoration. A workflow's children are the workflow's — they
   * report through its card, its notification and its dialog, so they are
   * filtered out of every top-level surface exactly as nested children are, and
   * they take no `maxConcurrent` slot: the run has its own concurrency cap, and
   * counting them twice would let one workflow starve the whole session.
   */
  workflowId?: string;
  /**
   * Make the child report through a `StructuredOutput` tool built from this
   * compiled schema. Set only by the workflow host, for `agent({ schema })`.
   */
  structuredOutput?: CompiledSchema;
  /** Isolation mode — "worktree" creates a temp git worktree for the agent. */
  isolation?: IsolationMode;
  /**
   * Working directory for the agent (absolute path). Default: parent session
   * cwd. The agent's tools operate here, but .pi config (extensions, skills,
   * settings, memory) still loads from the parent session's project — the
   * target directory's `.pi` extensions never execute. With isolation:
   * "worktree", the worktree is created FROM this directory and the result
   * branch lands in that repo.
   */
  cwd?: string;
  /**
   * Last chance to look at an isolated agent's worktree, awaited immediately
   * before it is committed to a branch and removed.
   *
   * Exists because that removal happens inside the settle path, before
   * `spawnAndWait` resolves: by the time a caller has the finished record, the
   * directory the child actually wrote in is gone. Anything that must inspect
   * or verify that tree — a workflow `gate` is the motivating case — has to run
   * here or it silently inspects the main tree instead.
   *
   * Fires only on the normal settle path, and only when a worktree was created.
   * Not on the error path and not on the stop-during-copy guard: those are
   * already failing, and delaying cleanup there would leak a copy for no gain.
   * A rejection is swallowed — the hook can never keep the worktree alive.
   */
  onBeforeWorktreeCleanup?: (worktreePath: string) => Promise<void>;
  /** Resolved invocation snapshot captured for UI display. */
  invocation?: AgentInvocation;
  /** Parent abort signal — when aborted, the subagent is also stopped. */
  signal?: AbortSignal;
  /**
   * Called synchronously once the record is in the map and its promise is set,
   * before `onSessionCreated` fires — where callers attach the output file.
   *
   * Carried on the options rather than parked on the manager for the duration
   * of a spawn: with a foreground queue, `startAgent` can run at drain time,
   * long after any such field would have been restored, and the callback would
   * silently never fire (or fire into an unrelated caller's closure).
   */
  onSpawned?: (id: string) => void;
  /**
   * Called synchronously when the spawn is queued instead of started, with how
   * many entries in its own pool are ahead of it. The foreground UI uses it to
   * say so while it waits; nothing else needs it.
   */
  onQueued?: (id: string, ahead: number) => void;
  /** Called on tool start/end with activity info (for streaming progress to UI). */
  onToolActivity?: (activity: ToolActivity) => void;
  /** Called on streaming text deltas from the assistant response. */
  onTextDelta?: (delta: string, fullText: string) => void;
  /** Called when the agent session is created (for accessing session stats). */
  onSessionCreated?: (session: AgentSession) => void;
  /** Called at the end of each agentic turn with the cumulative count. */
  onTurnEnd?: (turnCount: number) => void;
  /** Called once per assistant message_end with that message's usage delta. */
  onAssistantUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
  /** Called when the session successfully compacts. */
  onCompaction?: (info: CompactionInfo) => void;
  /** Nesting depth: top-level subagent = 1. */
  depth?: number;
  /** Parent agent ID for ownership-scoped nested controls. */
  parentAgentId?: string;
  /** Effective inherited nesting cap for this branch. */
  maxSubagentDepth?: number;
  /** Config-discovery root inherited by nested launches when it differs from the working directory. */
  configCwd?: string;
  /** Root registry location explicitly inherited by nested descendants. */
  registryLocator?: RootRegistryLocator;
  /** Internal recovery path: reuse a validated persistent identity, never allocate another one. */
  persistentEntry?: PersistentAgentEntry;
  /** Root session id, inherited by nested launches so transcripts stay grouped. */
  rootSessionId?: string;
}

interface ResumeOptions {
  /** Only this run's evidenced mode override, never prior spawn requests. */
  requestedRunInBackground?: boolean;
  maxTurns?: number;
  onTurnEnd?: (turnCount: number) => void;
  /**
   * Run the resumed turn detached in the background: return immediately with
   * the record still "running" (or "queued" at the concurrency limit) and
   * notify on completion via onComplete, exactly like a background spawn.
   * Default (false/undefined) runs the resume inline and returns the settled
   * record — the historical behavior.
   */
  isBackground?: boolean;
  /** Called on tool start/end with activity info (for streaming progress to UI). */
  onToolActivity?: (activity: ToolActivity) => void;
  /** Called once per assistant message_end with that message's usage delta. */
  onAssistantUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
  /** Called when the session successfully compacts. */
  onCompaction?: (info: CompactionInfo) => void;
  /**
   * Background resume only: called synchronously when the run actually starts —
   * immediately, or later from drainQueue. Callers wire per-run side effects
   * (output-file streaming) here rather than at the call site, so a resume that
   * is stopped while still queued never leaves a subscription behind: `abort()`
   * drops a queued record without reaching `settle()`, which is what would have
   * torn that subscription down.
   */
  onStarted?: () => void;
}

/** Observes accepted child messages; delivery belongs to the record's owner. */
export type ParentMessageListener = (record: AgentRecord, accepted: AcceptedChildMessage) => void;

export class AgentManager {
  private agents = new Map<string, AgentRecord>();
  private runs = new Map<string, AgentRun>();
  private listeners = new Set<() => void>();
  private admissionClosed = false;
  private drainingPaused = false;
  // Actual execution/cleanup outlives terminal waits and, on timeout, public maps.
  private executions = new Set<Promise<void>>();
  private disposePromise?: Promise<void>;
  private hostEffectsAllowed = true;
  private shutdownStopped = false;
  private cleanupController = new AbortController();
  private retainOwner?: (record: AgentRecord) => boolean;
  private parentMessageListeners = new Set<ParentMessageListener>();
  /** Entries marked interrupted before shutdown must not be overwritten by stop cleanup. */
  private shutdownInterrupted = new Set<string>();
  /** Recovery notices are once per newly created parent-session execution. */
  private recoveryNotices = new Set<string>();
  subscribe(listener: () => void): () => void {
    if (this.admissionClosed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  notifyChanged(): void {
    if (this.admissionClosed) return;
    for (const listener of this.listeners) {
      try { listener(); } catch { /* isolate read observers */ }
    }
  }
  setOwnerRetention(retain?: (record: AgentRecord) => boolean): void { this.retainOwner = retain; }
  getRun(id: string): AgentRunHandle | undefined {
    const run = this.runs.get(id);
    return run ? Object.freeze({ identity: run.identity, terminal: run.terminal }) : undefined;
  }
  isRunActive(id: string): boolean { return this.runs.get(id)?.settled === false; }
  /** Display metadata includes owned cancellation cleanup, not just the runner gate. */
  isRunSettling(id: string): boolean {
    const run = this.runs.get(id);
    return !!run && (!run.settled || run.pendingStops > 0);
  }
  /** Stage 3's epoch owner must call this BEFORE stopping old execution. */
  freezeAdmission(): void {
    this.admissionClosed = true;
    clearInterval(this.cleanupInterval);
    this.cleanupController.abort();
    // Release reply waiters and refuse late child sends from the old activation.
    for (const record of this.agents.values()) {
      record.mailbox?.closeAll("shutdown");
      const run = this.runs.get(record.id);
      if (run) this.freezeToolCalls(record, run);
    }
    this.parentMessageListeners.clear();
  }

  /** Finite diagnostics, never mutable execution/session references. */
  get executionCount(): number { return this.executions.size; }

  private ownExecution(work: () => Promise<void>): Promise<void> {
    let resolve!: () => void;
    const owned = new Promise<void>(done => { resolve = done; });
    // Register before invoking work: synchronous callbacks can close this owner.
    this.executions.add(owned);
    const finish = () => {
      this.executions.delete(owned);
      resolve();
    };
    try { void work().then(finish, finish); } catch { finish(); }
    return owned;
  }

  private current(record: AgentRecord, run: AgentRun): boolean {
    return !this.admissionClosed && this.agents.get(record.id) === record && this.runs.get(record.id) === run;
  }

  /** One bounded clock owner per run, shared by source sampling and lifecycle freezing. */
  getToolCalls(id: string): readonly ToolCallState[] {
    const now = performance.now();
    return Object.freeze([...(this.runs.get(id)?.toolCalls.values() ?? [])].map(call => Object.freeze({
      ...call.state,
      ...(call.start === undefined ? {} : { elapsedMs: Math.max(0, now - call.start) }),
    })));
  }

  private toolActivity(record: AgentRecord, run: AgentRun, activity: ToolActivity): void {
    const id = activity.toolCallId;
    if (!id || id.length > 200) return; // Setup diagnostics must not increment actual tool use or start clocks.
    const prior = run.toolCalls.get(id);
    if (activity.type === "start") {
      if (prior) return;
      // Prefer evicting old terminal calls; never replace a concurrent same-name call.
      if (run.toolCalls.size >= 128) {
        const old = [...run.toolCalls].find(([, call]) => call.state.status !== "running");
        if (old) run.toolCalls.delete(old[0]); else return;
      }
      run.toolCalls.set(id, { state: { toolCallId: id, name: activity.toolName.slice(0, 128), status: "running" }, start: performance.now() });
    } else {
      if (prior && prior.state.status !== "running") return;
      record.toolUses++;
      const durationMs = activity.durationMs;
      const valid = typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0;
      // Missing start is readable, but not an invented elapsed window.
      if (!prior && run.toolCalls.size >= 128) return;
      run.toolCalls.set(id, { state: Object.freeze({ toolCallId: id, name: activity.toolName.slice(0, 128),
        status: activity.isError ? "failed" : "completed",
        ...(valid ? { durationMs } : {}),
        ...(prior?.start === undefined ? {} : { elapsedMs: Math.max(0, performance.now() - prior.start) }),
      }) });
    }
    record.activity = [...run.toolCalls.values()].filter(call => call.state.status === "running").map(call => call.state.name).join(", ") || undefined;
  }

  private freezeToolCalls(record: AgentRecord, run: AgentRun): void {
    const now = performance.now();
    for (const [id, call] of run.toolCalls) if (call.state.status === "running") {
      run.toolCalls.set(id, { state: Object.freeze({ ...call.state, status: "interrupted",
        ...(call.start === undefined ? {} : { elapsedMs: Math.max(0, now - call.start) }),
      }) });
    }
    record.activity = undefined;
  }

  private ownSession(session: AgentSession, run: AgentRun): void {
    if (run.sessions.has(session)) return;
    run.sessions.add(session);
    if (this.admissionClosed || run.terminalResolved) this.stopSession(session, run);
  }

  private stopSession(session: AgentSession, run?: AgentRun): void {
    if (run) run.pendingStops++;
    void this.ownExecution(() => stopChildSession(session)).then(() => {
      if (!run) return;
      run.pendingStops--;
      if (this.runs.get(run.identity.taskId) === run) this.notifyChanged();
    });
  }

  private closeSession(session: AgentSession): Promise<void> {
    return this.ownExecution(async () => {
      await shutdownChildSession(session, { canEmitShutdown: () => this.hostEffectsAllowed });
    });
  }

  private async closeRunSessions(record: AgentRecord, run: AgentRun): Promise<void> {
    if (!this.admissionClosed) return;
    await Promise.all([...run.sessions].map(session => this.closeSession(session)));
    record.session = undefined;
    // Keep disk sessionFile/output/worktree paths; only live capabilities leave.
    run.sessions.clear();
  }

  private beginRun(record: AgentRecord, signal?: AbortSignal): AgentRun {
    record.runId = String(Number(record.runId ?? "0") + 1);
    record.resultConsumed = false;
    record.notificationDelivered = false;
    record.starting = true;
    record.abortController = new AbortController();
    let resolve!: AgentRun["resolve"];
    let resolveText!: AgentRun["resolveText"];
    const terminal = new Promise<AgentRecord>(done => { resolve = done; });
    record.promise = new Promise<string>(done => { resolveText = done; });
    const run: AgentRun = {
      identity: Object.freeze({ sourceId: "agent", taskId: record.id, runId: record.runId }),
      terminal, resolve, resolveText, charged: false, settled: false, terminalResolved: false, sessions: new Set(), pendingStops: 0, toolCalls: new Map(),
    };
    this.runs.set(record.id, run);
    record.mailbox?.startRun(record.runId);
    if (signal) {
      const stop = () => { if (this.runs.get(record.id) === run) this.abort(record.id); };
      signal.addEventListener("abort", stop, { once: true });
      run.unlinkParent = () => signal.removeEventListener("abort", stop);
      if (signal.aborted) stop();
    }
    return run;
  }
  private resolveTerminal(record: AgentRecord): void {
    const run = this.runs.get(record.id);
    if (!run || run.terminalResolved) return;
    this.freezeToolCalls(record, run);
    run.terminalResolved = true;
    run.unlinkParent?.(); run.unlinkParent = undefined;
    // A stop resolves the terminal long before actual exit; the channel already
    // refuses replies then, so close unanswered requests with the terminal.
    record.mailbox?.closeRun(run.identity.runId, record.status === "stopped" ? "stopped" : "execution_ended");
    // Snapshot outcome so a later resume cannot replace an earlier wait's text.
    let terminalConversation = "";
    try { if (record.session) terminalConversation = getAgentConversation(record.session); }
    catch { terminalConversation = "[Conversation unavailable at run completion.]"; }
    run.resolve({ ...record, terminalConversation, lifetimeUsage: { ...record.lifetimeUsage }, invocation: record.invocation ? { ...record.invocation } : undefined });
    run.resolveText(record.result ?? "");
  }
  private acquireSlot(record: AgentRecord): void {
    const run = this.runs.get(record.id)!;
    run.pool = this.poolFor(record);
    run.charged = true;
    if (run.pool === "background") this.runningBackground++;
    else if (run.pool === "foreground") this.runningForeground++;
  }
  private releaseSlot(record: AgentRecord, run = this.runs.get(record.id)): void {
    if (!run?.charged) return;
    run.charged = false;
    if (run.pool === "background") this.runningBackground--;
    else if (run.pool === "foreground") this.runningForeground--;
  }
  detachRun(identity: TaskIdentity): boolean {
    const record = this.agents.get(identity.taskId);
    const run = this.runs.get(identity.taskId);
    if (!record || !run || identity.sourceId !== "agent" || run.identity.runId !== identity.runId) return false;
    run.unlinkParent?.(); run.unlinkParent = undefined;
    record.blocking = false;
    record.isBackground = true;
    if (record.invocation) record.invocation.runInBackground = true;
    if (record.executionConfig) record.executionConfig = copyAgentExecutionConfig({ ...record.executionConfig, mode: "background", differences: record.executionConfig.differences?.filter(d => d.field !== "mode") });
    if (isTopLevelAgent(record)) {
      if (run.charged && run.pool !== "background") {
        if (run.pool === "foreground") this.runningForeground--;
        this.runningBackground++;
        run.pool = "background";
      }
      for (const entry of this.queue) if (entry.id === record.id) entry.pool = "background";
    }
    this.notifyChanged();
    this.drainQueue();
    return true;
  }
  consumeRun(identity: TaskIdentity): boolean {
    const record = this.agents.get(identity.taskId);
    const run = this.runs.get(identity.taskId);
    if (!record || identity.sourceId !== "agent" || run?.identity.runId !== identity.runId || !run.terminalResolved) return false;
    record.resultConsumed = true;
    this.notifyChanged();
    return true;
  }
  stopRun(identity: TaskIdentity): boolean {
    const run = this.runs.get(identity.taskId);
    return identity.sourceId === "agent" && run?.identity.runId === identity.runId && this.abort(identity.taskId);
  }
  private cleanupInterval: ReturnType<typeof setInterval>;
  private onComplete?: OnAgentComplete;
  private onStart?: OnAgentStart;
  private onCompact?: OnAgentCompact;
  private onUsage?: OnAgentUsage;
  private maxConcurrent: number;
  private maxConcurrentForeground = DEFAULT_MAX_CONCURRENT_FOREGROUND;

  /** Startup errors remain queryable via awaitStartup; terminal handles exist
   * independently, including queue/startup/failure. Dropped with the record. */
  private startups = new Map<string, Promise<void>>();

  /** One admission queue for both pools. A detach migrates the entry in place;
   * release wakes legacy startGate callers on start or removal, never rejects. */
  private queue: { id: string; pool: Pool; start: () => Promise<void>; release: () => void }[] = [];
  /** Number of currently running background agents. */
  private runningBackground = 0;
  /** Number of currently running foreground (blocking) agents. */
  private runningForeground = 0;

  constructor(
    onComplete?: OnAgentComplete,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    onStart?: OnAgentStart,
    onCompact?: OnAgentCompact,
    onUsage?: OnAgentUsage,
    private readonly dependencies: AgentManagerDependencies = {},
  ) {
    this.onComplete = onComplete;
    this.onStart = onStart;
    this.onCompact = onCompact;
    this.onUsage = onUsage;
    this.maxConcurrent = maxConcurrent;
    // Cleanup completed agents after 10 minutes (but keep sessions for resume)
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
  }

  /** Update the max concurrent background agents limit. */
  setMaxConcurrent(n: number) {
    this.maxConcurrent = Math.max(1, n);
    // Start queued agents if the new limit allows
    this.drainQueue();
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /** Update the max concurrent foreground (blocking) agents limit. 0 = unlimited. */
  setMaxConcurrentForeground(n: number) {
    // Floor 0, not 1: unlimited is a meaningful value here and the default.
    this.maxConcurrentForeground = Math.max(0, n);
    // Start queued agents if the new limit allows — including everything, when
    // the limit is cleared back to unlimited mid-run.
    this.drainQueue();
  }

  getMaxConcurrentForeground(): number {
    return this.maxConcurrentForeground;
  }

  /**
   * Which pool a spawn is charged to, or undefined for one that is charged to
   * neither (nested children, detached non-background spawns).
   *
   * Nothing here queues when the limit is unset — `poolHasRoom` reports an
   * unlimited pool as always having room, so that alone is what keeps the
   * default path identical. The `> 0` guard is belt and braces on top: it also
   * keeps the counter from churning and the settle path from calling a drain
   * that would find nothing to do. Both are unobservable, which is why no test
   * pins them; the observable half — that the default start stays synchronous —
   * is pinned in `test/foreground-concurrency.test.ts`.
   */
  private poolFor(record: AgentRecord): Pool | undefined {
    if (occupiesPoolSlot(record)) return "background";
    if (this.maxConcurrentForeground > 0 && occupiesForegroundSlot(record)) return "foreground";
    return undefined;
  }

  private poolHasRoom(pool: Pool): boolean {
    return pool === "background"
      ? this.runningBackground < this.maxConcurrent
      : this.maxConcurrentForeground === 0 || this.runningForeground < this.maxConcurrentForeground;
  }

  /**
   * Spawn an agent and return its ID immediately (for background use).
   * If the concurrency limit is reached, the agent is queued.
   *
   * The id comes back synchronously, but with `isolation: "worktree"` the agent
   * is not running yet when it does — the repo copy is an awaited git call.
   * Callers that must fail a tool call on a startup failure await
   * `awaitStartup(id)`; everyone else sees it on the record (status "error").
   */
  spawn(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: SubagentType,
    prompt: string,
    options: SpawnOptions,
  ): string {
    // Validate before the queue branch — a queued spawn should fail at the
    // call, not minutes later at drain. Throw (not warn): programmatic callers
    // can fix and retry; the RPC layer converts throws into error envelopes.
    if (this.admissionClosed) throw new Error("Agent admission is closed");
    const description = normalizeAgentDescription(options.description, type);
    options = { ...options, description };
    assertValidSpawnCwd(options.cwd);

    const inheritedLocator = options.registryLocator ?? (options.parentAgentId ? this.agents.get(options.parentAgentId)?.registryLocator : undefined);
    const rootSessionFile = inheritedLocator?.rootSessionFile ?? ctx.sessionManager?.getSessionFile?.();
    if (!rootSessionFile) {
      throw new Error("Subagents require a persisted parent session; start Pi without --no-session.");
    }
    const registryLocator = inheritedLocator ?? registryLocatorForRootSession(rootSessionFile);
    const persistent = options.persistentEntry ?? allocatePersistentAgent(registryLocator, type, options.parentAgentId);
    if (persistent.type !== type || persistent.parentAgentId !== (options.parentAgentId ?? null)) {
      throw new Error(`Persistent subagent identity does not match this recovery scope: "${persistent.agentId}".`);
    }
    const id = persistent.agentId;
    if (this.agents.has(id)) throw new Error(`Subagent "${id}" is already loaded.`);
    const abortController = new AbortController();
    const maxTurns = resolveEffectiveMaxTurns(type, options.maxTurns);
    const record: AgentRecord = {
      id,
      type,
      description,
      // Overwritten below when the spawn is actually queued; a foreground spawn
      // that queues flips to "queued" there rather than being guessed at here,
      // since the pool decision needs the finished record.
      status: options.isBackground ? "queued" : "running",
      toolUses: 0,
      turnCount: 0,
      maxTurns,
      startedAt: Date.now(),
      abortController,
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0, cost: 0 },
      compactionCount: 0,
      // Raw tri-state (not coerced to a boolean): true = background, false =
      // foreground (has an inline tool-result surface), undefined = caller never
      // declared it (e.g. a cross-extension RPC spawn). The widget's background-
      // only filter excludes only explicit `false`, so undefined agents — which
      // have no inline surface — stay visible instead of vanishing.
      isBackground: options.isBackground,
      // Whether anyone is awaiting this agent is a property of the agent, not
      // of the call that made it — and both settle paths need it long after
      // `options` has stopped being the interesting object.
      blocking: options.blocking,
      invocation: options.invocation ? { ...options.invocation, maxTurns } : undefined,
      executionConfig: resolvedExecutionConfig({ ...options.invocation,
        ...(options.model ? describeModel(options.model) : {}),
        thinking: options.thinkingLevel ?? options.invocation?.thinking,
        runInBackground: options.isBackground, inheritContext: options.inheritContext ?? false,
        isolated: options.isolated ?? false,
        isolation: options.isolation === "worktree" && (this.dependencies.worktreeEnabled ?? isWorktreeIsolationEnabled)() ? "worktree" : "off",
      }),
      depth: options.depth ?? 1,
      parentAgentId: options.parentAgentId,
      parentRunId: options.parentAgentId ? this.agents.get(options.parentAgentId)?.runId : undefined,
      workflowId: options.workflowId,
      maxSubagentDepth: options.maxSubagentDepth,
      registryLocator,
      // The persistent registry index is the user-facing runtime label
      // (`resumeKey`); without it the task panel falls back to the raw agent id.
      registryIndex: persistent.index,
      rootSessionId: options.rootSessionId,
      recoveredFromInterruption: persistent.status === "interrupted",
      // Workflow children answer to a script, not a conversation: no channel.
      mailbox: options.workflowId === undefined ? new AgentMailbox() : undefined,
    };
    this.agents.set(id, record);
    this.beginRun(record, options.signal);
    this.notifyChanged();
    if (record.status === "stopped") { this.settleRun(record); return id; }

    const args: SpawnArgs = { pi, ctx, type, prompt, options };

    const pool = this.poolFor(record);
    if (pool !== undefined && !options.bypassQueue && !this.poolHasRoom(pool)) {
      // Queue it — started when a running agent in the same pool completes.
      // Idempotent for background (already "queued"); the flip that matters is
      // a blocking foreground spawn, optimistically marked "running" above.
      record.status = "queued";
      // The per-run parent link already covers queue, startup and execution.
      let release!: () => void;
      record.startGate = new Promise<void>(resolve => { release = resolve; });
      this.queue.push({
        id,
        pool,
        start: () => this.launch(id, record, args),
        release: () => release(),
      });
      try { options.onQueued?.(id, this.queue.filter(e => e.pool === pool).length - 1); } catch { /* optional inline progress cannot strand admission */ }
      return id;
    }

    this.launch(id, record, args);
    return id;
  }

  /** Startup failure settles the same retained record and terminal handle. */
  private launch(id: string, record: AgentRecord, args: SpawnArgs): Promise<void> {
    const run = this.runs.get(id)!;
    return this.ownExecution(async () => {
      const startup = this.startAgent(id, record, args, run).then(
        () => { this.startups.delete(id); },
        async (err) => {
          if (record.status !== "stopped") record.status = "error";
          record.error = err instanceof Error ? err.message : String(err);
          record.completedAt ??= Date.now();
          await this.closeRunSessions(record, run);
          this.settleRun(record, run);
          this.drainQueue();
          throw err;
        },
      );
      this.startups.set(id, startup);
      // Retain rejected startup for awaitStartup; owned execution consumes it.
      await startup;
    });
  }

  /** Legacy startup-only callers can await failure; result waits use getRun().terminal. */
  awaitStartup(id: string): Promise<void> {
    return this.startups.get(id) ?? Promise.resolve();
  }

  /** Actually start an agent (called immediately or from queue drain). */
  private async startAgent(
    id: string,
    record: AgentRecord,
    { pi, ctx, type, prompt, options }: SpawnArgs,
    run: AgentRun,
  ) {
    if (!this.current(record, run) || record.abortController?.signal.aborted) { this.settleRun(record, run); return; }
    // Re-validate a caller-supplied cwd: queued spawns can start minutes after
    // spawn()'s check, and the directory may be gone by then (TOCTOU). Same
    // curated errors; drainQueue parks a throw on the record as an error.
    assertValidSpawnCwd(options.cwd);
    // Single resolution point for the caller-supplied cwd — the worktree base
    // repo and both cleanup calls below MUST agree on this value forever.
    const customCwd = options.cwd ?? undefined; // null (RPC "unset") → undefined
    const baseCwd = customCwd ?? ctx.cwd;

    // Take the running state — and with it the concurrency slot — BEFORE the
    // first await. Creating a worktree is an awaited git call, and drainQueue
    // reads the pool counters synchronously in a loop: incrementing after the
    // await would let it start every queued agent at once while the first is
    // still copying its repo. Claiming "running" here also keeps abort() and
    // abortAll() able to reach an agent whose worktree is still being created.
    //
    // Admission has one current pool lease. Detach transfers it in place;
    // settle releases that current lease, not a pool captured at launch time.
    this.acquireSlot(record);
    record.status = "running";
    updatePersistentAgent(record.registryLocator!, record.id, { status: "running" });
    record.startedAt = Date.now();
    record.startGate = undefined;
    this.notifyChanged();
    if (!this.current(record, run) || record.abortController?.signal.aborted) { this.settleRun(record, run); return; }

    // Worktree isolation: try to create a temporary git worktree. Strict —
    // fail loud if not possible (no silent fallback to main tree). Done BEFORE
    // the run is kicked off so a failure doesn't leave a half-running agent.
    // The project switch is enforced here as well as at the tool boundary
    // because cross-extension RPC forwards its options unvalidated — a schema
    // that omits the field can't stop a caller that never saw the schema.
    let worktreeCwd: string | undefined;
    if (options.isolation === "worktree" && (this.dependencies.worktreeEnabled ?? isWorktreeIsolationEnabled)()) {
      const wt = await (this.dependencies.createWorktree ?? createWorktree)(pi, baseCwd, id, {
        signal: record.abortController!.signal,
        onCreated: wt => { record.worktree = wt; },
      });
      if (!wt) {
        throw new Error(
          'Cannot run with isolation: "worktree" — not a git repo, no commits yet, or `git worktree add` failed. ' +
          'Initialize git and commit at least once, or omit `isolation`.',
        );
      }
      record.worktree = wt;
      // workPath preserves subdirectory scoping for caller-supplied cwds: a
      // cwd deep in a monorepo maps to the same subdir inside the copy, not
      // the copied repo's root. Plain worktree spawns keep the historical
      // behavior (agent at the copy's root) — moving them to workPath would
      // also move .pi config discovery when the parent session sits in a repo
      // subdirectory, silently dropping extensions/skills.
      worktreeCwd = customCwd !== undefined ? wt.workPath : wt.path;

      // No longer "running" means a stop landed while the copy was being made
      // (abort(), abortAll()) — a window that did not exist when creation was
      // synchronous. The record is already terminal, so launching the run would
      // burn tokens on work nobody is waiting for. Keep the tree as an artifact
      // rather than starting another command on a closing host.
      if (record.status !== "running") {
        // Cancellation preserves even partially added trees; never call stale pi.
        const preserved = { hasChanges: true, path: wt.path, preserved: true };
        record.worktreeResult = preserved;
        this.settleRun(record, run);
        return;
      }
    }

    try { if (this.current(record, run)) this.onStart?.(record); } catch { /* lifecycle observers cannot own admission */ }

    if (!this.current(record, run) || record.abortController?.signal.aborted) { this.settleRun(record, run); return; }
    this.notifyChanged();
    if (!this.current(record, run) || record.abortController?.signal.aborted) { this.settleRun(record, run); return; }

    let bindManagementSession: (session: AgentSession) => void = () => {};
    const promise = (this.dependencies.runAgent ?? runAgent)(ctx, type, prompt, {
      onSessionOwned: session => this.ownSession(session, run),
      onExecutionResolved: settings => {
        if (!this.current(record, run) || record.abortController?.signal.aborted) return;
        const previous = record.executionConfig;
        const resolved = { ...previous,
          ...(settings.model ? { model: `${settings.model.provider}/${settings.model.id}` } : {}),
          ...(settings.thinking !== undefined ? { thinking: settings.thinking } : {}),
        };
        record.executionConfig = copyAgentExecutionConfig({ ...resolved,
          differences: previous?.differences?.flatMap(d => {
            const actual = resolved[d.field];
            return actual !== undefined && d.requested !== actual ? [{ ...d, actual, reason: actual === d.actual ? d.reason : undefined }] : [];
          }),
        });
      },
      canEmitShutdown: () => this.hostEffectsAllowed,
      pi,
      agentId: id,
      model: options.model,
      // Admission already resolved this run's limit. Zero explicitly freezes
      // unlimited; undefined would let the runner re-read config after bind.
      maxTurns: record.maxTurns ?? 0,
      isolated: options.isolated,
      inheritContext: options.inheritContext,
      thinkingLevel: options.thinkingLevel,
      structuredOutput: options.structuredOutput,
      parentChannel: record.mailbox ? this.parentChannel(record) : undefined,
      resumeSessionFile: options.resumeSessionFile,
      nested: options.parentAgentId !== undefined,
      workflow: options.workflowId !== undefined,
      // Worktree wins for the working dir (the agent must run in the copy —
      // which, with a custom cwd, was created from that target). Config stays
      // with the parent project when a caller-supplied cwd is in play; it must
      // stay undefined otherwise so plain worktree runs keep resolving config
      // (incl. relative extension paths and memory) inside the worktree copy.
      cwd: worktreeCwd ?? customCwd,
      // Set iff a worktree was created (see above) — names the directory the
      // copy came from, so the prompt can tell the agent not to work there.
      worktreeBase: worktreeCwd ? baseCwd : undefined,
      configCwd: options.configCwd ?? (customCwd !== undefined ? ctx.cwd : undefined),
      signal: record.abortController!.signal,
      onToolActivity: (activity) => {
        if (!this.current(record, run) || record.status !== "running" || record.abortController?.signal.aborted || run.terminalResolved) return;
        this.toolActivity(record, run, activity);
        this.notifyChanged();
        try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onToolActivity?.(activity); } catch { /* isolate optional observer */ }
      },
      onTurnEnd: count => { if (!this.current(record, run) || record.status === "stopped") return; record.turnCount = count; this.notifyChanged(); try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onTurnEnd?.(count); } catch { /* isolate optional observer */ } },
      onTextDelta: (delta, text) => { if (this.current(record, run) && !record.abortController?.signal.aborted) { this.notifyChanged(); try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onTextDelta?.(delta, text); } catch { /* isolate optional observer */ } } },
      onAssistantUsage: (usage) => {
        if (!this.current(record, run) || record.status === "stopped") return;
        addUsage(record.lifetimeUsage, usage);
        try { if (this.current(record, run) && !record.abortController?.signal.aborted) this.onUsage?.(record, usage); } catch { /* isolate optional observer */ }
        this.notifyChanged();
        try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onAssistantUsage?.(usage); } catch { /* isolate optional observer */ }
      },
      onCompaction: (info) => {
        if (!this.current(record, run) || record.status === "stopped") return;
        record.compactionCount++;
        try { if (this.current(record, run) && !record.abortController?.signal.aborted) this.onCompact?.(record, info); } catch { /* isolate optional observer */ }
        this.notifyChanged();
        try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onCompaction?.(info); } catch { /* isolate optional observer */ }
      },
      nestedRuntime: {
        management: (() => {
          // This capability belongs to the retained child SESSION, not its first run.
          // Resume is legitimate only while that exact session remains on this record.
          let session: AgentSession | undefined;
          const currentOwner = () => {
            const owner = this.runs.get(id);
            return owner && session && record.session === session && owner.sessions.has(session) &&
              !isChildSessionClosed(session) && this.current(record, owner) && !record.abortController?.signal.aborted
              ? owner : undefined;
          };
          // Session creation occurs after the loader has requested the capability.
          bindManagementSession = value => { session = value; };
          return coordinator => {
            const owns = (candidate: AgentRecord, owner = currentOwner()) => owner !== undefined &&
              candidate.parentAgentId === id && candidate.parentRunId === owner.identity.runId;
            const source = createAgentTaskSource(this, coordinator, new Map(), { observe: false, filter: candidate => owns(candidate) });
            return {
              list: () => source.list().map(view => ({ view, manageable: true, rawStatus: this.agents.get(view.taskId)?.status ?? view.status })),
              execute: (identity, params, signal, onUpdate, context) => {
                // Freeze the exact owner at call admission. An old await cannot take
                // over children admitted by a subsequent resumed owner run.
                const owner = currentOwner();
                return createAgentManagement({ manager: this, coordinator, source,
                  active: () => owner !== undefined && currentOwner() === owner,
                  owns: candidate => owns(candidate, owner),
                  format: (child, verbose) => `${child.description}: ${child.status}\n${child.result ?? child.error ?? "No output."}${verbose ? `\n${child.terminalConversation ?? (child.session ? getAgentConversation(child.session) : "")}` : ""}`,
                  cancelNotice: () => {}, reconsider: () => {},
                }).execute(identity, params, signal, onUpdate, context);
              },
            };
          };
        })(),
        manager: this,
        parentAgentId: id,
        depth: record.depth ?? 1,
        maxSubagentDepth: record.maxSubagentDepth,
      },
      onSessionCreated: (session) => {
        this.ownSession(session, run);
        if (!this.current(record, run) || record.abortController?.signal.aborted) return;
        bindManagementSession(session);
        record.starting = false;
        record.session = session;
        // Capture now, while the session object exists: after eviction this
        // path is the only thing that can reopen the conversation, and an
        // in-memory session reports undefined, which correctly means
        // "nothing to come back to".
        // Optional chaining, not defensiveness for its own sake: this is the
        // only field read off the session at creation, so an older pi or a
        // stubbed session must degrade to "not resumable" rather than throw
        // and take the whole spawn down with it.
        record.sessionFile = session.sessionManager?.getSessionFile?.();
        if (!record.sessionFile) {
          throw new Error("Subagent persistence failed: the child session has no session file.");
        }
        updatePersistentAgent(record.registryLocator!, record.id, { sessionFile: record.sessionFile, status: "running" });
        this.notifyInterruptedChildren(record, session, run);
        // Same reason, different field: the model and thinking level are only
        // knowable once pi has resolved its defaults and clamped the level to
        // what the model supports. Writing them back here makes the record
        // authoritative, so every surface reads one place instead of each
        // re-deriving "session, else the request" for itself.
        if (session.model) {
          record.invocation ??= {};
          // Read the kept request first: a caller's level survives being clamped
          // AND, one line later, being replaced by the effective one.
          const requested = record.invocation.requestedThinking ?? record.invocation.thinking;
          Object.assign(record.invocation, describeModel(session.model));
          // Guarded for the reason above: a session that reports no level keeps
          // the request rather than losing it. Overwriting unconditionally would
          // turn an older or stubbed session into a blank `thinking:` tag, which
          // is worse than the stale-but-true value it replaced.
          if (session.thinkingLevel) {
            record.invocation.thinking = session.thinkingLevel;
            if (requested && requested !== session.thinkingLevel) {
              record.invocation.requestedThinking = requested;
            }
          }
        }
        record.executionConfig = sessionExecutionConfig(record.executionConfig, session, false, {
          thinking: record.invocation?.sessionRequestedThinking ?? (options.invocation ? undefined : options.thinkingLevel),
          model: record.invocation?.sessionRequestedModel ?? (!options.invocation && options.model ? `${options.model.provider}/${options.model.id}` : undefined),
        });
        // Flush any steers that arrived before the session was ready
        if (record.pendingSteers?.length) {
          const steers = record.pendingSteers;
          record.pendingSteers = undefined;
          for (const msg of steers) {
            if (!this.current(record, run) || record.abortController?.signal.aborted) break;
            try { void session.steer(msg).catch(() => {}); } catch { /* isolate steering sink */ }
          }
        }
        this.notifyChanged();
        if (this.current(record, run) && !record.abortController?.signal.aborted) options.onSessionCreated?.(session);
      },
    })
      .then(async ({ responseText, session, aborted, steered, failure, structuredJson, structuredRetried }) => {
        this.ownSession(session, run);
        // Don't overwrite status if externally stopped via abort()
        if (record.status !== "stopped") {
          // Precedence: a hard abort keeps "aborted"; then a failed final turn
          // (provider error that pi resolved instead of rejecting, #144) is an
          // honest "error" — not a completion with an empty or stale result.
          if (aborted) {
            record.status = "aborted";
          } else if (failure) {
            record.status = "error";
            record.error = failure;
          } else {
            record.status = steered ? "steered" : "completed";
          }
        }
        record.result = responseText;
        // Kept beside `result`, never inside it: `result` is prose meant for a
        // reader — it is previewed, transcribed, and appended to below — while
        // this is a machine-readable payload one caller asked for by schema.
        record.structuredJson = structuredJson;
        record.structuredRetried = structuredRetried;
        if (!isChildSessionClosed(session)) record.session = session;
        record.completedAt ??= Date.now();
        this.freezeToolCalls(record, run);
        this.notifyChanged();

        // Final flush of streaming output file
        if (record.outputCleanup) {
          try { record.outputCleanup(); } catch { /* ignore */ }
          record.outputCleanup = undefined;
        }

        // Clean up worktree if used
        if (record.worktree) {
          // The one moment the child's tree still exists and the child is done
          // writing to it. try/catch, not decoration: a hook that throws must
          // not leave the worktree behind.
          if (this.current(record, run) && options.onBeforeWorktreeCleanup) {
            try {
              await options.onBeforeWorktreeCleanup(record.worktree.path);
            } catch { /* ignore — never block cleanup */ }
          }
          const wtResult = this.admissionClosed
            ? { hasChanges: true, path: record.worktree.path, preserved: true }
            : await (this.dependencies.cleanupWorktree ?? cleanupWorktree)(pi, baseCwd, record.worktree, record.description, { signal: this.cleanupController.signal });
          record.worktreeResult = wtResult;
          if (wtResult.hasChanges && wtResult.branch) {
            // With a caller-supplied cwd the branch lives in THAT repo, not the
            // parent session's — say so, or the orchestrator merges in the wrong repo.
            const repoNote = customCwd !== undefined ? ` in \`${baseCwd}\`` : "";
            // Appended to the prose only. A structured child's caller parses
            // `structuredJson`, which stays untouched — but `result` is also
            // what a human reads, so the note still belongs on it.
            record.result = (record.result ?? "") +
              `\n\n---\nChanges saved to branch \`${wtResult.branch}\`${repoNote}. Merge with: \`git merge ${wtResult.branch}\`${customCwd !== undefined ? ` (run in \`${baseCwd}\`)` : ""}`;
          }
        }

        this.abortOwnedChildren(id);

        await this.closeRunSessions(record, run);
        this.settleRun(record, run);
        return responseText;
      })
      .catch(async (err) => {
        // Don't overwrite status if externally stopped via abort()
        if (record.status !== "stopped") {
          record.status = "error";
        }
        record.error = err instanceof Error ? err.message : String(err);
        record.completedAt ??= Date.now();
        this.freezeToolCalls(record, run);
        this.notifyChanged();
        // The runner closes only failed pre-prompt startup sessions. Keep
        // genuine prompt failures live for resume; discard only a matching
        // closed reference, not arbitrary failed runs or their disk artifacts.
        if (record.session && isChildSessionClosed(record.session)) {
          run.sessions.delete(record.session);
          record.session = undefined;
          record.sessionFile = undefined;
        }


        // Final flush of streaming output file on error
        if (record.outputCleanup) {
          try { record.outputCleanup(); } catch { /* ignore */ }
          record.outputCleanup = undefined;
        }

        // Best-effort worktree cleanup on error
        if (record.worktree) {
          try {
            const wtResult = this.admissionClosed
            ? { hasChanges: true, path: record.worktree.path, preserved: true }
            : await (this.dependencies.cleanupWorktree ?? cleanupWorktree)(pi, baseCwd, record.worktree, record.description, { signal: this.cleanupController.signal });
            record.worktreeResult = wtResult;
          } catch { /* ignore cleanup errors */ }
        }

        this.abortOwnedChildren(id);

        await this.closeRunSessions(record, run);
        this.settleRun(record, run);
        return "";
      });

    this.ownExecution(async () => { await promise; });

    // Notify caller that spawn is complete (record is in the map, promise is set).
    // Called synchronously — onSessionCreated fires asynchronously inside runAgent.
    // Used by spawnAndWait to let the caller set up output files before streaming
    // starts. Read off the options, so a spawn that started from a queue drain
    // still reaches the caller that queued it.
    try { if (this.current(record, run)) options.onSpawned?.(id); } catch { /* a reporting callback cannot orphan the active run */ }
  }

  /** Release the CURRENT admission lease once, even after a foreground transfer. */
  private settleRun(record: AgentRecord, run = this.runs.get(record.id)): void {
    if (!run || run.settled) return;
    this.freezeToolCalls(record, run);
    run.settled = true;
    record.starting = false;
    record.startGate = undefined;
    record.activity = undefined;
    this.releaseSlot(record, run);
    // Unanswered requests end with this execution; their waiters learn it now.
    record.mailbox?.closeRun(run.identity.runId, record.status === "stopped" ? "stopped" : "execution_ended");
    if (!this.shutdownInterrupted.has(record.id)) {
      updatePersistentAgent(record.registryLocator!, record.id, { status: record.status });
    }
    this.resolveTerminal(record);
    this.notifyChanged();
    try { if (this.current(record, run)) this.onComplete?.(record); } catch { /* isolate completion side effects */ }
    this.drainQueue();
  }

  /**
   * Stop the nested children a settled parent owns. Nested records are hidden
   * from the UI and only their owner can consume them, so a child outliving its
   * parent would burn tokens unseen with no way to reach it. Grandchildren are
   * covered transitively — each abort lands in that child's own settle path.
   */
  private abortOwnedChildren(parentId: string): void {
    for (const [id, record] of this.agents) {
      if (record.parentAgentId === parentId) this.abort(id);
    }
  }

  /**
   * Start queued agents up to each pool's concurrency limit.
   *
   * `findIndex` on the entry's OWN pool rather than `shift`: with one queue
   * serving two independent limits, a saturated foreground pool at the head
   * would otherwise stall every background agent behind it. Taking the earliest
   * eligible entry keeps FIFO within each pool, which is what callers see.
   */
  private drainQueue() {
    if (this.admissionClosed || this.drainingPaused) return;
    for (;;) {
      const i = this.queue.findIndex(e => this.poolHasRoom(e.pool));
      if (i === -1) return;
      const [next] = this.queue.splice(i, 1);
      const record = this.agents.get(next.id);
      // Stale entries (aborted while queued) are not started — but are still
      // released, since nothing else will.
      if (!record || record.status !== "queued") { next.release(); continue; }
      // Detached, and never rejects: a late failure (e.g. strict worktree
      // isolation) lands on the record inside `launch`, exactly as the
      // synchronous throw did here before, and draining continues either way.
      //
      // The release waits for that startup to SETTLE rather than firing here.
      // Startup is async now, so a release at drain time would wake a blocked
      // `spawnAndWait` while `record.promise` was still undefined, and it would
      // read a perfectly healthy agent as one that never ran.
      void next.start().then(() => next.release(), () => next.release());
    }
  }

  /**
   * Remove queued entries and wake anyone blocked on them. The single point
   * that enforces "leaving the queue releases the waiter" — a missed release is
   * an unbounded hang, not a failed call.
   */
  private dequeue(pred: (entry: { id: string; pool: Pool }) => boolean): void {
    const kept: typeof this.queue = [];
    for (const entry of this.queue) {
      if (pred(entry)) entry.release();
      else kept.push(entry);
    }
    this.queue = kept;
  }

  /**
   * Spawn an agent and wait for completion (foreground use).
   * Charged to the foreground pool (`maxConcurrentForeground`), which is
   * unlimited by default; never to the background one.
   * Returns { id, record } so callers can access the agent ID.
   *
   * @param onSpawned - Called synchronously once the run is kicked off, before
   *   onSessionCreated fires. Use this to set record.outputFile so
   *   streamToOutputFile can pick it up.
   */
  async spawnAndWait(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: SubagentType,
    prompt: string,
    options: Omit<SpawnOptions, "isBackground">,
    onSpawned?: (id: string) => void,
  ): Promise<{ id: string; record: AgentRecord }> {
    // `blocking` is what maxConcurrentForeground bounds, also set by the
    // root subagent_run tool when preparing its coordinator launch lease. onSpawned rides on the options rather than on a field of this
    // manager: a queued spawn starts at drain time, long after any install/
    // restore pair around this call would have put the field back — and it now
    // fires after an await (worktree creation) even on the immediate path.
    const id = this.spawn(pi, ctx, type, prompt, {
      ...options,
      isBackground: false,
      blocking: true,
      onSpawned,
    });
    const run = this.getRun(id)!;
    const outcome = await run.terminal;
    this.consumeRun(run.identity);
    return { id, record: outcome };
  }

  /**
   * Resume an existing agent session with a new prompt.
   */
  async resume(
    id: string, prompt: string, signal?: AbortSignal, options: ResumeOptions = {},
  ): Promise<AgentRecord | undefined> {
    const record = this.resumeRun(id, prompt, signal, options);
    if (!record || options.isBackground) return record;
    const run = this.getRun(id)!;
    const outcome = await run.terminal;
    this.consumeRun(run.identity);
    return outcome;
  }

  /** Synchronous preparation lets the subagent_run tool register its launch lease before awaits. */
  resumeRun(id: string, prompt: string, signal?: AbortSignal, options: ResumeOptions = {}): AgentRecord | undefined {
    const record = this.agents.get(id);
    if (this.admissionClosed || !record?.session || this.isRunActive(id)) return undefined;
    record.isBackground = !!options.isBackground;
    if (record.invocation) {
      const { requestedModel: _model, requestedThinking: _thinking, requestedRunInBackground: _mode,
        requestedInheritContext: _context, requestedIsolated: _isolated, requestedIsolation: _isolation,
        isolationDifferenceReason: _reason, sessionRequestedThinking: _sessionThinking, sessionRequestedModel: _sessionModel, ...retained } = record.invocation;
      record.invocation = { ...retained, runInBackground: record.isBackground,
        requestedRunInBackground: options.requestedRunInBackground,
        ...(record.session.model ? describeModel(record.session.model) : { modelId: undefined, modelName: undefined }),
        thinking: record.session.thinkingLevel,
      };
    }
    record.executionConfig = sessionExecutionConfig(record.executionConfig, record.session, true);
    const mode = record.isBackground ? "background" : "foreground";
    const requestedMode = options.requestedRunInBackground === undefined ? undefined : options.requestedRunInBackground ? "background" : "foreground";
    record.executionConfig = copyAgentExecutionConfig({ ...record.executionConfig, mode, inherit_context: undefined, isolation: undefined,
      differences: requestedMode !== undefined && requestedMode !== mode ? [{ field: "mode", requested: requestedMode, actual: mode, reason: "agent-configuration" }] : undefined,
    });
    record.blocking = !options.isBackground;
    record.result = undefined; record.error = undefined; record.completedAt = undefined;
    record.activity = undefined; record.turnCount = 0;
    record.maxTurns = resolveEffectiveMaxTurns(record.type, options.maxTurns);
    if (record.invocation) record.invocation.maxTurns = record.maxTurns;
    record.status = "queued";
    this.beginRun(record, signal);
    this.notifyChanged();
    if (record.abortController?.signal.aborted) return record;
    const start = async () => {
      await this.ownExecution(async () => {
        try { this.startResume(id, record, prompt, options); }
        catch (error) {
          if (record.status !== "stopped") record.status = "error";
          record.error = String(error); record.completedAt ??= Date.now();
          await this.closeRunSessions(record, this.runs.get(id)!);
          this.settleRun(record);
        }
      });
    };
    const pool = this.poolFor(record);
    if (pool && !this.poolHasRoom(pool)) {
      let release!: () => void;
      record.startGate = new Promise<void>(resolve => { release = resolve; });
      this.queue.push({ id, pool, start, release: () => release() });
    } else { void start(); }
    return record;
  }

  private startResume(id: string, record: AgentRecord, prompt: string, options: ResumeOptions): void {
    const session = record.session!;
    const run = this.runs.get(id)!;
    if (!this.current(record, run) || record.abortController?.signal.aborted) return;
    this.ownSession(session, run);
    this.acquireSlot(record);
    record.status = "running"; record.starting = false; record.startedAt = Date.now();
    updatePersistentAgent(record.registryLocator!, record.id, { status: "running" });
    record.startGate = undefined;
    this.notifyChanged();
    if (!this.current(record, run) || record.abortController?.signal.aborted) { this.settleRun(record, run); return; }
    try { if (this.current(record, run)) this.onStart?.(record); } catch { /* lifecycle observers cannot own admission */ }
    try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onStarted?.(); }
    catch (error) {
      record.abortController?.abort();
      try { record.outputCleanup?.(); } catch { /* wiring failure still releases */ }
      record.outputCleanup = undefined;
      throw error;
    }
    if (!this.current(record, run) || record.abortController?.signal.aborted) {
      this.ownExecution(async () => { await this.closeRunSessions(record, run); this.settleRun(record, run); });
      return;
    }
    const finish = async () => {
      try { record.outputCleanup?.(); } catch { /* isolate transcript teardown */ }
      record.outputCleanup = undefined;
      this.abortOwnedChildren(id);
      await this.closeRunSessions(record, run);
      this.settleRun(record, run);
    };
    this.ownExecution(async () => { await (this.dependencies.resumeAgent ?? resumeAgent)(session, prompt, {
      maxTurns: record.maxTurns ?? 0,
      onToolActivity: activity => {
        if (!this.current(record, run) || record.status !== "running" || record.abortController?.signal.aborted || run.terminalResolved) return;
        this.toolActivity(record, run, activity);
        this.notifyChanged(); try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onToolActivity?.(activity); } catch { /* isolate optional observer */ }
      },
      onTurnEnd: count => { if (!this.current(record, run) || record.status === "stopped") return; record.turnCount = count; this.notifyChanged(); try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onTurnEnd?.(count); } catch { /* isolate optional observer */ } },
      onAssistantUsage: usage => {
        if (!this.current(record, run) || record.status === "stopped") return;
        addUsage(record.lifetimeUsage, usage); try { if (this.current(record, run) && !record.abortController?.signal.aborted) this.onUsage?.(record, usage); } catch { /* isolate optional observer */ }
        this.notifyChanged(); try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onAssistantUsage?.(usage); } catch { /* isolate optional observer */ }
      },
      onCompaction: info => {
        if (!this.current(record, run) || record.status === "stopped") return;
        record.compactionCount++; try { if (this.current(record, run) && !record.abortController?.signal.aborted) this.onCompact?.(record, info); } catch { /* isolate optional observer */ }
        this.notifyChanged(); try { if (this.current(record, run) && !record.abortController?.signal.aborted) options.onCompaction?.(info); } catch { /* isolate optional observer */ }
      },
      signal: record.abortController!.signal,
    }).then(async ({ text, failure, aborted, steered }) => {
      // Same terminal priority as new runs; trusted older/fake runners may
      // omit the optional limit flags and keep their existing behavior.
      if (record.status !== "stopped") {
        record.status = aborted ? "aborted" : failure ? "error" : steered ? "steered" : "completed";
        record.error = failure;
      }
      record.result = text; record.completedAt ??= Date.now(); this.freezeToolCalls(record, run); this.notifyChanged(); await finish();
    }, async error => {
      if (record.status !== "stopped") record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
      record.completedAt ??= Date.now(); this.freezeToolCalls(record, run); this.notifyChanged(); await finish();
    }); });
  }

  /**
   * Send a steering message to an agent from the UI (mirrors the subagent_message
   * tool). A live session delivers it now — it interrupts the agent after its
   * current tool execution and appears as a user message. If the session isn't
   * ready yet, the message is queued on `pendingSteers` and flushed when the
   * session is created. Returns false if the agent can't accept steering
   * (unknown id, or no longer running/queued).
   */
  steer(id: string, message: string): boolean {
    const record = this.agents.get(id);
    if (this.admissionClosed || !record) return false;
    if (record.status !== "running" && record.status !== "queued") return false;
    if (record.session) {
      record.session.steer(message).catch(() => {});
    } else {
      if (!record.pendingSteers) record.pendingSteers = [];
      record.pendingSteers.push(message);
    }
    return true;
  }

  /** Observe child messages accepted from any owned record. */
  subscribeParentMessages(listener: ParentMessageListener): () => void {
    if (this.admissionClosed) return () => {};
    this.parentMessageListeners.add(listener);
    return () => { this.parentMessageListeners.delete(listener); };
  }

  /**
   * The child's only capability. Resolves the record's current execution on
   * every send, so a resumed run is addressed correctly and a settled or
   * superseded one is refused, without capturing the first run's identity.
   */
  private parentChannel(record: AgentRecord): ParentChannel {
    return {
      send: (text, requestId) => {
        const run = this.runs.get(record.id);
        const mailbox = record.mailbox;
        if (!mailbox || !run || run.settled || run.terminalResolved || !this.current(record, run)
          || record.status !== "running" || record.abortController?.signal.aborted) {
          return { ok: false, error: "The parent channel is closed for this execution." };
        }
        const result = mailbox.accept(run.identity.runId, text, requestId);
        if (!result.ok) return result;
        for (const listener of [...this.parentMessageListeners]) {
          try { listener(record, result.value); } catch { /* delivery failures belong to the owner */ }
        }
        this.notifyChanged();
        return result;
      },
    };
  }

  /**
   * Register a parent request against the agent's current execution. The
   * caller delivers the question afterwards and reports failure through
   * {@link failParentRequest}.
   */
  createParentRequest(id: string, question: string): MailboxResult<{ request: ParentRequest; identity: TaskIdentity }> {
    const record = this.agents.get(id);
    const run = this.runs.get(id);
    if (this.admissionClosed || !record || !run) return { ok: false, error: `Agent not found: "${id}".` };
    if (!record.mailbox) return { ok: false, error: "This agent has no parent message channel." };
    if (run.settled || (record.status !== "running" && record.status !== "queued")) {
      return { ok: false, error: `Agent "${id}" is not running (status: ${record.status}).` };
    }
    const created = record.mailbox.createRequest(run.identity.runId, question);
    return created.ok ? { ok: true, value: { request: created.value, identity: run.identity } } : created;
  }

  failParentRequest(id: string, requestId: string): void {
    this.agents.get(id)?.mailbox?.failRequest(requestId);
  }

  /**
   * Recreate only the small, non-executing projection for one ownership scope.
   * A root session passes null; a restored agent explicitly loads only its own
   * children. This never opens sessions or starts a descendant tree.
   */
  hydratePersistentAgents(locator: RootRegistryLocator, parentAgentId: string | null): AgentRecord[] {
    const registry = loadSubagentRegistry(locator);
    if (!registry) return [];
    const restored: AgentRecord[] = [];
    for (const entry of Object.values(registry.agents)) {
      if (entry.parentAgentId !== parentAgentId || this.agents.has(entry.agentId)) continue;
      const record: AgentRecord = {
        id: entry.agentId,
        type: entry.type,
        description: `Recovered ${entry.type} subagent`,
        status: entry.status,
        toolUses: 0,
        turnCount: 0,
        maxTurns: resolveEffectiveMaxTurns(entry.type),
        startedAt: entry.createdAt,
        completedAt: entry.status === "queued" || entry.status === "running" ? undefined : entry.updatedAt,
        sessionFile: entry.sessionFile,
        lifetimeUsage: { input: 0, output: 0, cacheWrite: 0, cost: 0 },
        compactionCount: 0,
        parentAgentId: entry.parentAgentId ?? undefined,
        registryIndex: entry.index,
        registryLocator: locator,
        mailbox: new AgentMailbox(),
      };
      this.agents.set(record.id, record);
      restored.push(record);
    }
    if (restored.length) this.notifyChanged();
    return restored;
  }

  /** Load just the direct children of an already restored parent. */
  hydratePersistentChildren(parentAgentId: string): AgentRecord[] {
    const parent = this.agents.get(parentAgentId);
    return parent?.registryLocator ? this.hydratePersistentAgents(parent.registryLocator, parentAgentId) : [];
  }

  /**
   * Resume a disk-only record by creating a fresh run through the normal runner.
   * The old execution has no live resources; no session is opened until this
   * call is explicitly admitted by the direct owner.
   */
  resumePersistent(pi: ExtensionAPI, ctx: ExtensionContext, id: string, prompt: string, signal?: AbortSignal, options: ResumeOptions = {}): AgentRecord | undefined {
    const previous = this.agents.get(id);
    if (this.admissionClosed || !previous || previous.session || this.isRunActive(id)) return undefined;
    if (!previous.registryLocator || !previous.sessionFile || !existsSync(previous.sessionFile)) {
      throw new Error(`Cannot resume subagent "${id}": its persisted session file is unavailable.`);
    }
    if (!getAgentConfig(previous.type)) {
      throw new Error(`Cannot resume subagent "${id}": agent type "${previous.type}" is no longer enabled.`);
    }
    const registry = loadSubagentRegistry(previous.registryLocator);
    const entry = registry?.agents[id];
    if (!entry || entry.parentAgentId !== (previous.parentAgentId ?? null) || entry.sessionFile !== previous.sessionFile) {
      throw new Error(`Cannot resume subagent "${id}": its persistent registry entry is invalid.`);
    }
    this.agents.delete(id);
    try {
      this.spawn(pi, ctx, previous.type, prompt, {
        description: previous.description,
        resumeSessionFile: previous.sessionFile,
        isBackground: options.isBackground,
        maxTurns: options.maxTurns,
        parentAgentId: previous.parentAgentId,
        maxSubagentDepth: previous.maxSubagentDepth,
        registryLocator: previous.registryLocator,
        rootSessionId: previous.rootSessionId,
        persistentEntry: entry,
        onTurnEnd: options.onTurnEnd,
        onToolActivity: options.onToolActivity,
        onAssistantUsage: options.onAssistantUsage,
        onCompaction: options.onCompaction,
      });
      return this.agents.get(id);
    } catch (error) {
      this.agents.set(id, previous);
      throw error;
    }
  }

  /** Deliver one hidden, structured recovery notice to a restored parent. */
  private notifyInterruptedChildren(record: AgentRecord, session: AgentSession, run: AgentRun): void {
    if (!record.recoveredFromInterruption) return;
    const key = `${record.id}\u0000${run.identity.runId}`;
    if (this.recoveryNotices.has(key)) return;
    const children = this.hydratePersistentChildren(record.id).filter(child => child.status === "interrupted");
    if (!children.length) return;
    this.recoveryNotices.add(key);
    void session.sendCustomMessage({
      customType: "subagent_recovery",
      content: JSON.stringify({ kind: "interrupted_children", children: children.map(child => ({ agent_id: child.id, type: child.type, status: child.status })) }),
      display: false,
      details: { kind: "interrupted_children", parentAgentId: record.id, children: children.map(child => child.id) },
    }, { triggerTurn: false }).catch(() => {});
  }

  getRecord(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  abort(id: string): boolean {
    const record = this.agents.get(id);
    if (!record || (record.status !== "queued" && record.status !== "running")) return false;
    const queued = record.status === "queued";
    const stoppingRun = this.runs.get(id);
    if (stoppingRun) this.freezeToolCalls(record, stoppingRun);
    record.status = "stopped";
    record.completedAt ??= Date.now();
    record.pendingSteers = undefined;
    try { record.outputCleanup?.(); } catch { /* stop output before late events */ }
    record.outputCleanup = undefined;
    record.abortController?.abort();
    const run = this.runs.get(id);
    for (const session of run?.sessions ?? []) this.stopSession(session, run);
    if (record.session && !run?.sessions.has(record.session)) this.stopSession(record.session, run);
    this.releaseSlot(record, run);
    this.abortOwnedChildren(id);
    this.resolveTerminal(record);
    this.notifyChanged();
    if (queued) { this.dequeue(q => q.id === id); this.settleRun(record); }
    return true;
  }

  /** Dispose a record's session and remove it from the map. */
  private removeRecord(id: string, record: AgentRecord): void {
    const session = record.session;
    // Detached before the shutdown starts, so the record leaves the map at once and
    // nothing can observe a session that is half torn down.
    record.session = undefined;
    record.mailbox?.closeAll("shutdown");
    this.agents.delete(id);
    this.runs.delete(id);
    this.notifyChanged();
    // A failed startup keeps its (rejected) entry so a late awaitStartup still
    // sees it; drop it with the record so the map can't grow unbounded.
    this.startups.delete(id);
    // Fire-and-forget is right here and only here: this runs from the 60s cleanup timer
    // and from `clearCompleted()` on session boundaries, with the process staying alive,
    // so handlers get their full window. The quit path awaits instead — see dispose().
    if (session) void this.closeSession(session);
  }

  private cleanup() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, record] of this.agents) {
      if (record.status === "running" || record.status === "queued") continue;
      if (this.isRunActive(id) || !record.resultConsumed || this.retainOwner?.(record)) continue;
      if ((record.completedAt ?? 0) >= cutoff) continue;
      this.removeRecord(id, record);
    }
  }

  /**
   * Remove all completed/stopped/errored records immediately.
   * Called on session start/switch so tasks from a prior session don't persist.
   * Pass skipUnconsumed=true to preserve records the LLM hasn't read yet
   * (resultConsumed=false). Sweep preserves unconsumed results and active-owner children.
   */
  clearCompleted(skipUnconsumed = false): void {
    for (const [id, record] of this.agents) {
      if (record.status === "running" || record.status === "queued") continue;
      if (this.isRunActive(id) || this.retainOwner?.(record)) continue;
      if (skipUnconsumed && !record.resultConsumed) continue;
      this.removeRecord(id, record);
    }
  }

  /** Whether any agents are still running or queued. */
  hasRunning(): boolean {
    return [...this.agents.values()].some(
      r => r.status === "running" || r.status === "queued",
    );
  }

  /** Persist the shutdown interruption before live executions are stopped. */
  markInterruptedForShutdown(): number {
    const locators = new Map<string, RootRegistryLocator>();
    for (const record of this.agents.values()) {
      if (record.status !== "queued" && record.status !== "running") continue;
      if (record.registryLocator) locators.set(record.registryLocator.registryFile, record.registryLocator);
      this.shutdownInterrupted.add(record.id);
    }
    let count = 0;
    for (const locator of locators.values()) count += markRunningAgentsInterrupted(locator);
    return count;
  }

  /** Abort all running and queued agents immediately. */
  abortAll(): number {
    let count = 0;
    this.drainingPaused = true;
    // Stop queued entries first so settling a run cannot admit them during teardown.
    for (const record of [...this.agents.values()].sort((a, b) => Number(b.status === "queued") - Number(a.status === "queued"))) {
      if (this.abort(record.id)) count++;
    }
    this.drainingPaused = false;
    return count;
  }

  /** Shutdown-stage stop, unlike abortAll's ordinary cancellation. Starts
   * completed/retained child hooks while the host is valid; active child hooks
   * remain deferred to their actual runner cleanup after cancellation.
   */
  stopForShutdown(): number {
    this.freezeAdmission();
    if (this.shutdownStopped) return 0;
    this.shutdownStopped = true;
    const count = this.abortAll();
    this.dequeue(() => true);
    for (const [id, record] of this.agents) {
      try { record.outputCleanup?.(); } catch { /* release every sibling */ }
      record.outputCleanup = undefined;
      const run = this.runs.get(id);
      // terminalResolved alone is not proof that prompt/bind has stopped.
      if (run && !run.settled) continue;
      const sessions = new Set(run?.sessions);
      if (record.session) sessions.add(record.session);
      for (const session of sessions) void this.closeSession(session);
    }
    return count;
  }

  /** Protocol final disposal must seal BEFORE calling dispose: its synchronous
   * phase is not awaited by the host. A standalone dispose owns its own budget.
   * Guarded again at the actual emit boundary, never reopened for late cleanup.
   */
  sealHostEffects(): void { this.hostEffectsAllowed = false; }

  /** Actual startup/prompt/output/worktree/session cleanup, not terminal gates.
   * No internal deadline: the lifecycle protocol owns its two-second drain budget.
   * After dispose timeout the retained private owner is still drainable.
   */
  async drainExecution(): Promise<void> {
    while (this.executions.size) await Promise.allSettled([...this.executions]);
  }

  /** Normal completion also follows queued admission and stopped actual runs. */
  async waitForAll(): Promise<void> {
    for (;;) {
      this.drainQueue();
      const queued = [...this.runs.values()].filter(run => !run.settled).map(run => run.terminal);
      if (!queued.length && !this.executions.size) return;
      await Promise.allSettled([...queued, this.drainExecution()]);
    }
  }

  /** Stable bounded close. Timeout drops public capabilities, NEVER late owners.
   * pi is kept only for call compatibility; no detached prune/stale host exec.
   */
  dispose(_pi?: ExtensionAPI): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    let resolve!: () => void;
    this.disposePromise = new Promise<void>(done => { resolve = done; });
    this.stopForShutdown();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([
      this.drainExecution(),
      new Promise<void>(done => { timer = setTimeout(done, this.dependencies.disposeTimeoutMs ?? 2_000); }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
      // Host may invalidate pi immediately after this promise resolves. Late
      // sessions only get local disposal, and trees stay as recovery artifacts.
      this.sealHostEffects();
      this.agents.clear(); this.startups.clear(); this.runs.clear();
      this.listeners.clear(); this.retainOwner = undefined;
      this.onStart = undefined; this.onComplete = undefined; this.onUsage = undefined; this.onCompact = undefined;
      resolve();
    });
    return this.disposePromise;
  }
}
