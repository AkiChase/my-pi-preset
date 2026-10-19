import { copyAgentExecutionConfig, agentExecutionSummary } from "../../runtime-tasks/execution-config.ts";
import { nullableControl } from "../../shared/tool-arguments.ts";
import { createToolCallHeading } from "../../beautify/tool-call-heading.ts";
import { launchMetadata, launchText } from "../../runtime-tasks/launch.ts";
import { executionId } from "../../runtime-tasks/execution-id.ts";
import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  buildAgentRegistry,
  getAgentConfigIn,
  getAvailableTypesIn,
  resolveEnabledTypeIn,
  resolveTypeIn,
} from "./agent-types.ts";
import { loadCustomAgents } from "./custom-agents.ts";
import { isolationParam, resolveAgentInvocationConfig, thinkingParam } from "./invocation-config.ts";
import { describeModel, resolveModel } from "./model-resolver.ts";
import { runToolGuidance, messageToolGuidance } from "./tool-guidance.ts";
import { parseAgentToolArguments, parseMessageToolArguments, type MessageToolParams, MESSAGE_REPLY_MODES } from "./tool-contract.ts";
import { formatHeldMessages, formatSubagentMessages, SUBAGENT_MESSAGE_TYPE } from "./parent-delivery.ts";
import type { ChildMessage, ReplyWaitOutcome } from "./parent-messaging.ts";
import { checkModelScope } from "./model-scope.ts";
import {
  createOutputFilePath,
  getOutputTranscriptDefault,
  streamToOutputFile,
  writeInitialEntry,
} from "./output-file.ts";
import { getForegroundOutcomeNote, getStatusNote, partialOutputSuffix } from "./status-note.ts";
import type {
  AgentConfig,
  AgentInvocation,
  AgentRecord,
  IsolationMode,
  ThinkingLevel,
} from "./types.ts";
import { addUsage } from "./usage.ts";
import { isWorktreeIsolationEnabled } from "./worktree.ts";

/**
 * Hard ceiling on nesting for every branch: main session = 0, its subagents = 1,
 * their children = 2. `0`/`1` disables nesting entirely. Set from
 * `agent-tasks.json` (`maxSubagentDepth`). Read when a subagent session is built,
 * so a change applies to sessions started after it.
 */
let maxSubagentDepth = 2;

export function getMaxSubagentDepth(): number { return maxSubagentDepth; }
export function setMaxSubagentDepth(n: number): void { maxSubagentDepth = Math.max(0, Math.floor(n)); }

const NESTED_TOOL_NAMES = ["subagent_run", "subagent_message"] as const;

interface NestedSpawnOptions {
  description: string;
  model?: Model<any>;
  maxTurns?: number;
  isolated?: boolean;
  inheritContext?: boolean;
  thinkingLevel?: ThinkingLevel;
  isBackground?: boolean;
  isolation?: IsolationMode;
  invocation?: AgentInvocation;
  signal?: AbortSignal;
  onAssistantUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
  onSessionCreated?: (session: AgentSession) => void;
  depth: number;
  parentAgentId: string;
  maxSubagentDepth: number;
  configCwd?: string;
  rootSessionId?: string;
}

export interface NestedAgentManager {
  spawn(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: string,
    prompt: string,
    options: NestedSpawnOptions,
  ): string;
  /** Resolves once the spawned agent is running; rejects on a startup failure. */
  awaitStartup(id: string): Promise<void>;
  spawnAndWait(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: string,
    prompt: string,
    options: Omit<NestedSpawnOptions, "isBackground">,
    /** Fires synchronously after spawn, before the session exists — where the transcript is attached. */
    onSpawned?: (id: string) => void,
  ): Promise<{ id: string; record: AgentRecord }>;
  getRecord(id: string): AgentRecord | undefined;
  /** Optional lifecycle subscription supplied by AgentManager; test doubles may omit it. */
  subscribe?(listener: () => void): () => void;
  subscribeParentMessages?(listener: (record: AgentRecord, accepted: { message: ChildMessage; deliveredToWaiter: boolean }) => void): () => void;
  resume(id: string, prompt: string, signal?: AbortSignal): Promise<AgentRecord | undefined>;
}

export interface NestedToolContext {
  manager: NestedAgentManager;
  pi: ExtensionAPI;
  parentAgentId: string;
  depth: number;
  maxSubagentDepth: number;
  /** "all" = any enabled agent; string[] = only those types. Never empty. */
  allowedSubagents: "all" | string[];
  /** Root used for agent/config discovery; may differ from the agent's working directory. */
  configCwd: string;
  /** Loader-scoped availability; an explicit deny must reject detached admission. */
  canCollectBackground?: () => boolean;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError, details: {} };
}

/** A refusal, spelled without a positional boolean so the intent is visible. */
function errorResult(text: string) {
  return textResult(text, true);
}

function ownsRecord(record: AgentRecord | undefined, parentAgentId: string): record is AgentRecord {
  return record?.parentAgentId === parentAgentId;
}

/**
 * Inline returns already contain the full answer and a runtime identity. A
 * partial-outcome note describes the run's limit/cancellation, not hidden text
 * that can be recovered by another retrieval. Fetched background results retain
 * the original status wording.
 */
type ResultPosition = "inline" | "fetched";

function formatRecord(record: AgentRecord, position: ResultPosition): string {
  if (record.status === "error") {
    return `Agent failed: ${record.error ?? "unknown error"}${partialOutputSuffix(record)}`;
  }
  if (record.status === "queued" || record.status === "running") {
    return `Agent ${record.id} is ${record.status}.`;
  }
  // A truncated run must not read as a finished one. The top-level path carries
  // this in its result headline; a nested result has no headline, so the note
  // leads — appended, it would look like part of the child's own output.
  const text = record.result?.trim() || record.error?.trim() || "No output.";
  const note = position === "inline"
    ? getForegroundOutcomeNote(record.status)
    : getStatusNote(record.status);
  return note ? `Nested agent${note}.\n\n${text}` : text;
}


/**
 * Delivers grandchildren's mailbox messages into exactly one live parent-agent
 * session. Nested delivery deliberately has no root entry/card path: the root
 * session neither sees nor wakes for a grandchild's message.
 */
function createNestedDelivery(manager: NestedAgentManager, parentAgentId: string) {
  // Schema-only test doubles intentionally omit the runtime manager surface.
  // They cannot receive messages, so use an inert delivery rather than making
  // tool-definition construction itself an observable manager effect.
  if (typeof manager.getRecord !== "function") {
    return { hold() {}, take(): readonly ChildMessage[] { return []; }, release() {}, dispose() {} };
  }
  const ownerRunId = manager.getRecord(parentAgentId)?.runId;
  const held = new Map<string, ChildMessage[]>();
  const key = (id: string, runId: string) => `${id}\u0000${runId}`;
  const waiting = new Set<string>();
  let disposed = false;
  let offState: (() => void) | undefined;
  const owner = (): AgentRecord | undefined => {
    const record = manager.getRecord(parentAgentId);
    return record?.status === "running" && record.runId === ownerRunId && record.session ? record : undefined;
  };
  const dispose = () => { if (!disposed) { disposed = true; offMessages(); offState?.(); held.clear(); waiting.clear(); } };
  const deliver = (child: AgentRecord, messages: readonly ChildMessage[]) => {
    const parent = owner();
    if (!parent || !messages.length) return;
    // Session delivery is intentionally fire-and-forget: the child message is
    // already retained by its mailbox and a parent-session failure must not
    // alter its acceptance result.
    void parent.session!.sendCustomMessage({
      customType: SUBAGENT_MESSAGE_TYPE,
      content: formatSubagentMessages(child.id, messages[0]!.runId, messages),
      display: false,
      details: { agentId: child.id, executionId: executionId({ taskId: child.id, runId: messages[0]!.runId }, "subagent"), messages: messages.map(message => ({ requestId: message.requestId, seq: message.seq })) },
    }, { triggerTurn: true, deliverAs: "steer" }).catch(() => {});
  };
  const release = (record: AgentRecord, runId: string) => {
    const identity = key(record.id, runId);
    waiting.delete(identity);
    const messages = held.get(identity) ?? [];
    held.delete(identity);
    deliver(record, messages);
  };
  const offMessages = manager.subscribeParentMessages?.((record, accepted) => {
    if (disposed || record.parentAgentId !== parentAgentId) return;
    if (!owner()) { dispose(); return; }
    if (accepted.deliveredToWaiter) return;
    const identity = key(record.id, accepted.message.runId);
    if (waiting.has(identity)) {
      const messages = held.get(identity) ?? [];
      messages.push(accepted.message); held.set(identity, messages);
    } else deliver(record, [accepted.message]);
  }) ?? (() => {});
  offState = manager.subscribe?.(() => { if (!owner()) dispose(); });
  return {
    hold(record: AgentRecord, runId = record.runId) { if (runId) waiting.add(key(record.id, runId)); },
    take(record: AgentRecord, runId = record.runId): readonly ChildMessage[] {
      if (!runId) return [];
      const identity = key(record.id, runId); waiting.delete(identity);
      const messages = held.get(identity) ?? []; held.delete(identity); return messages;
    },
    release,
    dispose,
  };
}

function nestedWait(waiter: { promise: Promise<ReplyWaitOutcome>; cancel(): void }, signal: AbortSignal | undefined): Promise<ReplyWaitOutcome | { kind: "released" }> {
  if (!signal) return waiter.promise;
  if (signal.aborted) return Promise.resolve({ kind: "released" });
  return new Promise(resolve => {
    const abort = () => resolve({ kind: "released" });
    signal.addEventListener("abort", abort, { once: true });
    void waiter.promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); });
  });
}

/** Build child-safe orchestration tools scoped to one parent agent instance. */
export function createNestedSubagentTools(context: NestedToolContext): ToolDefinition[] {
  // Do not touch the manager while declaring schemas: host validation must be
  // side-effect-free even for invalid nested tool calls.
  let nestedDelivery: ReturnType<typeof createNestedDelivery> | undefined;
  const deliveryFor = () => nestedDelivery ??= createNestedDelivery(context.manager, context.parentAgentId);
  // Agents resolve from a registry built for THIS branch's config root (under
  // worktree isolation, the copy). Never via registerAgents — that is
  // process-global state shared with the main session and every other agent.
  const loadRegistry = () => buildAgentRegistry(loadCustomAgents(context.configCwd));
  const allowedTypesIn = (registry: Map<string, AgentConfig>): Set<string> | undefined =>
    context.allowedSubagents === "all"
      ? undefined
      : new Set(context.allowedSubagents.map(name => resolveTypeIn(registry, name) ?? name));
  const availableIn = (registry: Map<string, AgentConfig>): string[] => {
    const allowed = allowedTypesIn(registry);
    return getAvailableTypesIn(registry).filter(name => allowed === undefined || allowed.has(name));
  };

  const agentTool = defineTool({
    name: NESTED_TOOL_NAMES[0],
    label: "subagent_run",
    renderCall: (args, theme, context) => createToolCallHeading({ name: "subagent_run", detail: `${args.subagent_type ?? ""} · ${args.description ?? ""}`, theme, context }),
    description:
      "Launch a child-safe nested subagent for bounded delegated work. " +
      "Only use agent types allowed by this parent agent; nesting is depth-limited.",
    promptSnippet: "Start or resume an owned nested agent",
    promptGuidelines: runToolGuidance({ nested: true, isolation: isWorktreeIsolationEnabled(), agentTypes: availableIn(loadRegistry()).join(", ") || "none" }),
    parameters: Type.Object({
      prompt: Type.String({ description: "Self-contained task for the nested agent." }),
      description: nullableControl(Type.String({ description: "Required non-null for new agents; null with resume: short task description." })),
      subagent_type: nullableControl(Type.String({ description: `Required non-null for new agents; null with resume. Allowed types: ${availableIn(loadRegistry()).join(", ") || "none"}.` })),
      model: nullableControl(Type.String({ description: "Provider/model override; null uses agent configuration, otherwise the parent session model. Agent-file configuration takes precedence over calls." })),
      // Same enum as the top-level tool, from the same source: a typo here would
      // otherwise be cast straight to a ThinkingLevel and quietly do nothing.
      ...thinkingParam(),
      run_in_background: nullableControl(
        Type.Boolean({
          description: "Null uses agent configuration, otherwise nested new agents run foreground. Background requires an available owned agent_manage; collect results before finishing. With resume, set null; execution waits inline.",
        }),
      ),
      resume: nullableControl(Type.String({ description: "Real agent_id of a finished owned child; set null for new agents, not an empty string. With resume, set all other control fields to null; execution waits inline." })),
      isolated: nullableControl(Type.Boolean()),
      inherit_context: nullableControl(Type.Boolean()),
      ...isolationParam(isWorktreeIsolationEnabled()),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, input, signal, _onUpdate, ctx) => {
      let params;
      try {
        params = parseAgentToolArguments(input, { nested: true, isolation: isWorktreeIsolationEnabled() });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
      if (params.resume) {
        const existing = context.manager.getRecord(params.resume);
        if (!ownsRecord(existing, context.parentAgentId)) {
          return textResult(`Nested agent not found or not owned by this parent: "${params.resume}".`, true);
        }
        if (existing.status === "running" || existing.status === "queued") return errorResult("Nested agent is still active; wait or send a message instead.");
        const resumed = await context.manager.resume(params.resume, params.prompt, signal);
        return resumed
          ? (() => {
            const identity = launchMetadata("subagent", resumed.id, resumed.runId ?? "1", "foreground");
            return { ...textResult(`${launchText(identity)}\n${agentExecutionSummary(resumed.executionConfig)}${formatRecord(resumed, "inline")}`, resumed.status === "error"), details: { runtimeLaunch: identity, executionConfig: copyAgentExecutionConfig(resumed.executionConfig) } };
          })()
          : textResult(`Failed to resume nested agent "${params.resume}".`, true);
      }

      if (context.depth >= context.maxSubagentDepth) {
        return textResult(
          `Nested subagent call blocked (depth=${context.depth}, max=${context.maxSubagentDepth}). Complete the task directly.`,
          true,
        );
      }

      // Reloaded per call so new agent files are picked up without a restart.
      const registry = loadRegistry();
      const rawType = params.subagent_type!;
      // Strict resolve, never the fallback policy: a project-level
      // `fallbackSubagent` must not hand a nested caller an agent its allowlist
      // never named. The list stays allowlist-filtered so a typo can't enumerate
      // agents this parent may not reach.
      const resolvedType = resolveEnabledTypeIn(registry, rawType);
      if (resolvedType === undefined) {
        return textResult(
          `Unknown or disabled nested agent type: "${rawType}". Allowed: ${availableIn(registry).join(", ") || "none"}.`,
          true,
        );
      }
      const allowed = allowedTypesIn(registry);
      if (allowed !== undefined && !allowed.has(resolvedType)) {
        return textResult(
          `Nested agent type "${resolvedType}" is not allowed for this parent. Allowed: ${[...allowed].join(", ")}.`,
          true,
        );
      }

      const config = getAgentConfigIn(registry, resolvedType);
      // Foreground regardless of `backgroundByDefault` — see the reasoning on
      // ResolveOptions. An explicit `true` here still opts in.
      const invocation = resolveAgentInvocationConfig(config, params, {
        worktreeAllowed: isWorktreeIsolationEnabled(),
        defaultRunInBackground: false,
      });
      if (invocation.runInBackground && context.canCollectBackground?.() === false) {
        return textResult("Nested background launch requires an available owned agent_manage tool. Use foreground execution or allow agent_manage.", true);
      }
      let model = ctx.model;
      if (invocation.modelInput) {
        const resolvedModel = resolveModel(invocation.modelInput, ctx.modelRegistry);
        if (typeof resolvedModel === "string") {
          if (invocation.modelFromParams) return textResult(resolvedModel, true);
        } else {
          model = resolvedModel;
        }
      }

      // Same scopeModels policy as the top-level subagent_run tool — a nested spawn
      // must not escape the allowlist. A "warn" verdict proceeds silently:
      // child sessions have no UI surface to toast to.
      const scopeVerdict = checkModelScope({
        model,
        cwd: context.configCwd,
        modelRegistry: ctx.modelRegistry,
        callerSupplied: invocation.modelFromParams,
        agentLabel: config?.displayName ?? resolvedType,
        modelInput: invocation.modelInput,
      });
      if (scopeVerdict.kind === "error") return textResult(scopeVerdict.message, true);

      // The whole branch shares the root session's transcript directory; read it
      // off the owning parent rather than this child session's own id.
      const rootSessionId = context.manager.getRecord(context.parentAgentId)?.rootSessionId;
      const childDepth = context.depth + 1;
      const modelIdentity = model ? describeModel(model) : {};
      // Fuzzy aliases of the same effective model are not an override.
      const requestedModel = invocation.overridden?.model;
      const resolvedAsked = requestedModel === undefined ? undefined : resolveModel(requestedModel, ctx.modelRegistry);
      const askedModel = resolvedAsked !== undefined && (typeof resolvedAsked === "string"
        || resolvedAsked.provider !== model?.provider || resolvedAsked.id !== model?.id)
        ? requestedModel : undefined;
      const agentInvocation: AgentInvocation = {
        ...modelIdentity,
        thinking: invocation.thinking,
        requestedThinking: invocation.overridden?.thinking,
        requestedModel: askedModel,
        sessionRequestedThinking: params.thinking,
        sessionRequestedModel: params.model !== undefined && askedModel === undefined && model ? `${model.provider}/${model.id}` : undefined,
        requestedRunInBackground: invocation.overridden?.runInBackground,
        requestedInheritContext: invocation.overridden?.inheritContext,
        requestedIsolated: invocation.overridden?.isolated,
        requestedIsolation: invocation.overridden?.isolation ?? (params.isolation === "worktree" && !isWorktreeIsolationEnabled() ? "worktree" : undefined),
        isolationDifferenceReason: !isWorktreeIsolationEnabled() ? "worktree-disabled" : undefined,
        maxTurns: invocation.maxTurns,
        isolated: invocation.isolated,
        inheritContext: invocation.inheritContext,
        runInBackground: invocation.runInBackground,
        isolation: invocation.isolation,
      };
      const overrideNoteFor = (record: AgentRecord | undefined) =>
        agentExecutionSummary(record?.executionConfig);
      const options: NestedSpawnOptions = {
        description: params.description!,
        model,
        maxTurns: invocation.maxTurns,
        isolated: invocation.isolated,
        inheritContext: invocation.inheritContext,
        thinkingLevel: invocation.thinking,
        isolation: invocation.isolation,
        invocation: agentInvocation,
        // Nested children are hidden from every reporting surface, so their spend
        // would otherwise be unattributable. Fold it into every ancestor's record:
        // the top-level one appears in lifecycle events, completion notifications,
        // and `/agents`, and those all read `lifetimeUsage`. The whole chain is
        // walked, not just the immediate parent — a spawn callback only fires for
        // that child's OWN turns, so stopping at one level would hide a
        // great-grandchild from the only record anyone can see. (The live
        // widget/fleet counters read their own per-agent activity tracker, which
        // still sees only the top-level agent's own turns.)
        onAssistantUsage: (usage) => {
          for (let id: string | undefined = context.parentAgentId; id !== undefined; ) {
            const ancestor = context.manager.getRecord(id);
            if (!ancestor) break;
            addUsage(ancestor.lifetimeUsage, usage);
            id = ancestor.parentAgentId;
          }
        },
        depth: childDepth,
        parentAgentId: context.parentAgentId,
        maxSubagentDepth: context.maxSubagentDepth,
        configCwd: context.configCwd,
        rootSessionId,
      };

      // Transcript wiring, same gate as the top-level path: the child's
      // `output_transcript` frontmatter wins, else the project default. Without
      // it a nested run leaves no artifact but the string it returned — the
      // parent's own transcript records the call and the answer, never the tool
      // calls in between, which is exactly what a misbehaving child needs to
      // explain itself. Filed under the ROOT session and this branch's config
      // root, so a nested transcript lands in the same `tasks/` directory as its
      // ancestors' rather than in a directory of its own.
      const transcriptSessionId =
        rootSessionId !== undefined && (config?.outputTranscript ?? getOutputTranscriptDefault())
          ? rootSessionId
          : undefined;
      let childId: string | undefined;
      const attachTranscript = (id: string): void => {
        childId = id;
        if (transcriptSessionId === undefined) return;
        const rec = context.manager.getRecord(id);
        if (!rec) return;
        rec.outputFile = createOutputFilePath(context.configCwd, id, transcriptSessionId);
        writeInitialEntry(rec.outputFile, id, params.prompt, ctx.cwd);
      };
      options.onSessionCreated = (session) => {
        const rec = childId === undefined ? undefined : context.manager.getRecord(childId);
        if (rec?.outputFile && childId !== undefined) {
          rec.outputCleanup = streamToOutputFile(session, rec.outputFile, childId, ctx.cwd);
        }
      };

      // `ctx` is forwarded to the manager unmodified, never captured at tool-build
      // time: each AgentSession builds its own ExtensionRunner from that session's
      // cwd/sessionManager/modelRegistry, so this is the CHILD's context. Capturing
      // one earlier would silently give a grandchild the wrong worktree base, the
      // wrong conversation under inherit_context, and the wrong inherited model.
      //
      // spawn() throws on strict worktree-isolation failure and cwd validation —
      // report it as a tool error, like the top-level subagent_run tool does, instead of
      // letting it escape into the child's turn.
      try {
        if (invocation.runInBackground) {
          const id = context.manager.spawn(context.pi, ctx, resolvedType, params.prompt, {
            ...options,
            isBackground: true,
          });
          // Synchronous, before the event loop yields — onSessionCreated fires
          // asynchronously inside runAgent, so the file is attached in time.
          attachTranscript(id);
          // Worktree isolation starts the agent asynchronously; surface its
          // failure as a tool error, like the synchronous throw used to.
          await context.manager.awaitStartup(id);
          const identity = launchMetadata("subagent", id, context.manager.getRecord(id)!.runId ?? "1", "background");
          return { ...textResult(`${launchText(identity)}\n${overrideNoteFor(context.manager.getRecord(id))}Nested agent started in background.`), details: { runtimeLaunch: identity, executionConfig: copyAgentExecutionConfig(context.manager.getRecord(id)?.executionConfig) } };
        }

        const { record } = await context.manager.spawnAndWait(
          context.pi,
          ctx,
          resolvedType,
          params.prompt,
          { ...options, signal },
          (id) => {
            attachTranscript(id);
            const child = context.manager.getRecord(id);
            if (child?.runId) deliveryFor().hold(child, child.runId);
          },
        );
        const held = deliveryFor().take(record, record.runId);
        const identity = launchMetadata("subagent", record.id, record.runId ?? "1", "foreground");
        return { ...textResult(`${launchText(identity)}\n${overrideNoteFor(record)}${formatRecord(record, "inline")}${formatHeldMessages(held)}`, record.status === "error"), details: { runtimeLaunch: identity, executionConfig: copyAgentExecutionConfig(record.executionConfig) } };
      } catch (err) {
        const record = childId === undefined ? undefined : context.manager.getRecord(childId);
        const identity = record ? launchMetadata("subagent", record.id, record.runId ?? "1", invocation.runInBackground ? "background" : "foreground") : undefined;
        return { ...textResult(`${identity ? `${launchText(identity)}\n` : ""}${agentExecutionSummary(record?.executionConfig)}${err instanceof Error ? err.message : String(err)}`, true),
          details: identity ? { runtimeLaunch: identity, executionConfig: copyAgentExecutionConfig(record?.executionConfig) } : {},
        };
      }
    },
  });

  const steerChains = new Map<string, Promise<unknown>>();
  function sendInOrder(record: AgentRecord, texts: readonly string[], expectedRunId = record.runId): Promise<"queued" | "sent"> {
    // A request belongs to the execution that admitted it. Never let an
    // asynchronous steering chain leak it into a later resume of the same
    // session: that later execution must receive a newly-created request id.
    if (!expectedRunId || record.runId !== expectedRunId || record.status !== "running") {
      return Promise.reject(new Error("The nested agent execution ended before the message could be delivered."));
    }
    if (!record.session) { (record.pendingSteers ??= []).push(...texts); return Promise.resolve("queued"); }
    const previous = steerChains.get(record.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      for (const text of texts) {
        if (record.runId !== expectedRunId || record.status !== "running" || !record.session) {
          throw new Error("The nested agent execution ended before the message could be delivered.");
        }
        await record.session.steer(text);
      }
      return "sent" as const;
    });
    const settled = next.catch(() => {});
    steerChains.set(record.id, settled);
    void settled.then(() => { if (steerChains.get(record.id) === settled) steerChains.delete(record.id); });
    return next;
  }

  const steerTool = defineTool({
    name: NESTED_TOOL_NAMES[1],
    label: "subagent_message",
    description: "Send guidance or a question to a running nested agent owned by this parent.",
    promptSnippet: "Send guidance or a question to a running owned child",
    promptGuidelines: messageToolGuidance({ reply: true }),
    parameters: Type.Object({
      agent_id: Type.String(),
      message: Type.String({ minLength: 1, description: "Non-blank guidance or question for the running nested agent." }),
      reply: nullableControl(StringEnum(MESSAGE_REPLY_MODES, { description: "null sends guidance; wait waits for a reply; notify delivers a reply later." })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, input, signal) => {
      let params: MessageToolParams;
      try { params = parseMessageToolArguments(input); }
      catch (err) { return errorResult(err instanceof Error ? err.message : String(err)); }
      const record = context.manager.getRecord(params.agent_id);
      if (!ownsRecord(record, context.parentAgentId) || record.status !== "running") {
        return textResult(`Running nested agent not found or not owned by this parent: "${params.agent_id}".`, true);
      }
      if (params.reply === undefined) {
        try {
          const state = await sendInOrder(record, [params.message], record.runId);
          return textResult(state === "queued"
            ? `Steering message queued for nested agent ${params.agent_id}; processing is not confirmed.`
            : `Steering message sent to nested agent ${params.agent_id}; reading or processing is not confirmed.`);
        } catch (err) { return errorResult(`Failed to steer nested agent: ${err instanceof Error ? err.message : String(err)}`); }
      }
      const runId = record.runId;
      if (!runId) return errorResult("Nested agent has no active execution.");
      const created = record.mailbox?.createRequest(runId, params.message);
      if (!created?.ok) return errorResult(created?.error ?? "Nested agent has no parent mailbox.");
      const request = created.value;
      // Install the parent-session message observer for both notify and wait.
      // A notify has no local waiter but its later reply still needs delivery.
      const nestedDelivery = deliveryFor();
      const marker = `<parent-request request_id="${request.requestId}" reply_tool="reply_to_parent" />`;
      const waiter = params.reply === "wait" ? record.mailbox!.waitForReply(request.requestId) : undefined;
      const headline = (state: string) => `Question ${state} for nested agent ${record.id}.\nRequest ID: ${request.requestId}\nExecution ID: ${executionId({ taskId: record.id, runId }, "subagent")}`;
      if (waiter) nestedDelivery.hold(record, runId);
      let state: "queued" | "sent";
      try { state = await sendInOrder(record, [params.message, marker], runId); }
      catch (err) {
        record.mailbox!.failRequest(request.requestId); waiter?.cancel();
        if (waiter) nestedDelivery.release(record, runId);
        return errorResult(`Failed to send the question; request ${request.requestId} was closed. ${err instanceof Error ? err.message : String(err)}`);
      }
      if (params.reply === "notify") return textResult(`${headline(state)}\nThe reply will be delivered while you continue.`);
      const outcome = await nestedWait(waiter!, signal);
      waiter!.cancel();
      if (outcome.kind === "released") {
        nestedDelivery.release(record, runId);
        return textResult(`${headline(state)}\nWait released; the question stays open and a later reply will be delivered to you.`);
      }
      const held = nestedDelivery.take(record, runId);
      if (outcome.kind === "replied") return textResult(`${headline(state)}\nReply:\n${outcome.message.text}${formatHeldMessages(held)}`);
      if (outcome.kind === "failed") return errorResult(`${headline(state)}\nThe question could not be delivered.${formatHeldMessages(held)}`);
      return textResult(`${headline(state)}\nThe ${outcome.reason === "shutdown" ? "session closed" : outcome.reason === "stopped" ? "execution was stopped" : "execution ended"} without a reply.${formatHeldMessages(held)}`);
    },
  });

  return [agentTool, steerTool];
}
