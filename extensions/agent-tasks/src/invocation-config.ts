import { nullableControl } from "../../shared/tool-arguments.ts";
import { Type, StringEnum } from "@earendil-works/pi-ai";
import type { AgentConfig, AgentInvocation, IsolationMode, JoinMode, ThinkingLevel } from "./types.ts";

/**
 * Advertised thinking levels, ordered to mirror pi-ai's EXTENDED_THINKING_LEVELS
 * (`off` + every `ThinkingLevel`). Single source for the subagent_run tool schema,
 * the nested delegation schema, the generated-agent template, and the
 * `/agents` wizard so these lists can't drift behind pi again (#147).
 * Availability of any level still depends on the host pi version and the
 * selected model — pi clamps unsupported levels down.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const thinkingParamShape = {
  thinking: nullableControl(
    StringEnum(THINKING_LEVELS, {
      description: `Thinking level: ${THINKING_LEVELS.join(", ")}. Null uses agent configuration, otherwise child session settings/defaults. Agent-file configuration takes precedence over calls.`,
    }),
  ),
};

/**
 * Build the `thinking` parameter for a tool schema.
 *
 * A closed `enum`, not a free string: with the old `Type.String` a typo like
 * `"hight"` passed validation and was then cast straight to `ThinkingLevel`,
 * so the level silently did nothing for the whole run. An enum makes the host
 * reject the value and list the accepted ones.
 */
export function thinkingParam(): Partial<typeof thinkingParamShape> {
  return thinkingParamShape;
}

/**
 * The model-facing `isolation` parameter, shared by the `subagent_run` tool and the
 * nested delegation tool so the two cannot drift.
 *
 * Shape matters more than wording here. As a single-value optional literal,
 * models that fill every optional parameter — the transcript on #231 shows one
 * emitting `resume: ""`, `schedule: ""` and `model: "default"` alongside it —
 * had only `"worktree"` available to fill it with, and kept spawning worktrees
 * across three turns while their own reasoning said to omit the field. Every
 * other optional parameter has an inert filler; this one did not. `"off"` is
 * listed first and described as the default so the harmless value is the
 * obvious one to reach for.
 *
 * The wording tracks Claude Code's own `isolation` parameter, whose phrasing
 * models have the most exposure to: one description on the union rather than
 * per-value ones, opening "Isolation mode.", then a sentence per value in
 * schema order, each with its caveats in a trailing parenthetical. Two clauses
 * are ours, because our shape is not theirs — `"off"` has no counterpart there
 * (their enum is `worktree | remote`, so both of their values do something),
 * and neither does the uncommitted-work warning, which is the specific trap
 * #231 fell into. Deliberately absent is any "only use a worktree when…"
 * restriction: Claude Code's `subagent_run` tool states the capability and stops, and
 * a second legal value is what lets a model decline one, not being told to.
 */
const isolationParamShape = {
  isolation: nullableControl(
    Type.Union([Type.Literal("off"), Type.Literal("worktree")], {
      description:
        'Isolation mode. Null uses configuration, otherwise "off". "off" runs the agent in the current checkout. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo (a copy cannot see uncommitted or staged changes in the main checkout).',
    }),
  ),
};

/**
 * Build the `isolation` parameter for a tool schema, or nothing when the
 * project disabled worktrees (`worktreeIsolation: false`).
 *
 * Dropping the field beats accepting it and quietly downgrading. The setting is
 * for a project whose model passes `"worktree"` on *every* call, so a
 * per-result "isolation was disabled" note would be noise on every result and
 * would keep raising the salience of a capability that isn't there. With no
 * field there is nothing to pass, nothing to drop, and nothing to explain, at
 * zero LLM-context cost. The resolver gate and the `agent-manager` check still
 * cover the paths a schema can't reach: agent files and cross-extension RPC.
 *
 * This is read once at tool registration — flipping the
 * setting needs a new pi session for the schema to change.
 */
export function isolationParam(enabled: boolean): Partial<typeof isolationParamShape> {
  return enabled ? isolationParamShape : {};
}

interface AgentInvocationParams {
  model?: string;
  /**
     * Untyped on purpose, like `isolation` below. `thinkingParam()` builds this
     * field with `StringEnum`, which is `Type.Unsafe` and erases TypeBox's
     * literal inference to `unknown` the same way the conditional spreads do.
     * The resolver narrows by comparison rather than trusting the declaration,
     * which also makes it safe for the cross-extension RPC path, where options
     * arrive unvalidated.
     */
  thinking?: unknown;
  run_in_background?: boolean;
  inherit_context?: boolean;
  isolated?: boolean;
  /**
   * Untyped on purpose. Both tool schemas now build this field conditionally
   * and spread it, which erases TypeBox's literal inference to `unknown`. The resolver below narrows by
   * comparison rather than trusting the declaration, which also makes it safe
   * for the cross-extension RPC path, where options arrive unvalidated.
   */
  isolation?: unknown;
}

interface ResolveOptions {
  /**
   * Whether worktree isolation is permitted at all. False when the project set
   * `worktreeIsolation: false`, which drops a requested worktree rather than
   * failing the call: the fail-loud precedent covers spawns that *cannot* work,
   * while this one is the user opting out, and throwing would break exactly the
   * calls the `"off"` value exists to tolerate. Defaults to allowed.
   */
  worktreeAllowed?: boolean;
  /**
   * What an unqualified spawn means — neither the call nor the agent file said.
   *
   * Top-level callers pass the `backgroundByDefault` setting (default `true`,
   * following Claude Code). Nested callers pass `false` unconditionally: a
   * detached child is killed by `abortOwnedChildren` when its parent settles
   * and has no notification path of its own, so backgrounding one loses its
   * work. Both call sites pass it explicitly; the `false` fallback only covers
   * a caller that supplies no options at all, which in-tree means tests.
   */
  defaultRunInBackground?: boolean;
}

export function resolveAgentInvocationConfig(
  agentConfig: AgentConfig | undefined,
  params: AgentInvocationParams,
  opts?: ResolveOptions,
): {
  modelInput?: string;
  modelFromParams: boolean;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
  isolated: boolean;
  isolation?: IsolationMode;
  /**
   * Caller parameters an agent file's frontmatter outranked, so the surfaces can
   * say "(asked X)" instead of presenting the effective value as the requested
   * one (#182). Populated only where both sides named something and they
   * disagree — a caller who asked for what they got was still honored.
   *
   * Turn budgets are user/internal configuration, never model arguments.
   */
  overridden?: { thinking?: ThinkingLevel; model?: string; runInBackground?: boolean; inheritContext?: boolean; isolated?: boolean; isolation?: IsolationMode };
} {
  // Precedence first, collapse second — reversing these loses the veto, since
  // an agent file's "off" only outranks a caller's "worktree" while it is still
  // a value. Everything downstream then sees "worktree" or nothing at all.
  const requested = agentConfig?.isolation ?? params.isolation;
  const isolation = requested === "worktree" && opts?.worktreeAllowed !== false ? "worktree" : undefined;

  const overriddenThinking = agentConfig?.thinking != null && params.thinking != null
    && agentConfig.thinking !== params.thinking
    ? params.thinking as ThinkingLevel
    : undefined;
  const overriddenModel = agentConfig?.model != null && params.model != null
    && agentConfig.model !== params.model
    ? params.model
    : undefined;

  const overrides: NonNullable<ReturnType<typeof resolveAgentInvocationConfig>["overridden"]> = {
    thinking: overriddenThinking, model: overriddenModel,
    runInBackground: agentConfig?.runInBackground !== undefined && params.run_in_background !== undefined && agentConfig.runInBackground !== params.run_in_background ? params.run_in_background : undefined,
    inheritContext: agentConfig?.inheritContext !== undefined && params.inherit_context !== undefined && agentConfig.inheritContext !== params.inherit_context ? params.inherit_context : undefined,
    isolated: agentConfig?.isolated !== undefined && params.isolated !== undefined && agentConfig.isolated !== params.isolated ? params.isolated : undefined,
    isolation: agentConfig?.isolation !== undefined && params.isolation !== undefined && agentConfig.isolation !== params.isolation ? params.isolation as IsolationMode : undefined,
  };
  for (const key of Object.keys(overrides) as (keyof typeof overrides)[]) if (overrides[key] === undefined) delete overrides[key];

  return {
    modelInput: agentConfig?.model ?? params.model,
    modelFromParams: agentConfig?.model == null && params.model != null,
    thinking: (agentConfig?.thinking ?? params.thinking) as ThinkingLevel | undefined,
    maxTurns: agentConfig?.maxTurns,
    inheritContext: agentConfig?.inheritContext ?? params.inherit_context ?? false,
    runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? opts?.defaultRunInBackground ?? false,
    isolated: agentConfig?.isolated ?? params.isolated ?? false,
    isolation,
    // Undefined rather than an empty object when nothing was overridden: callers
    // spread this into the invocation snapshot, and an always-present key would
    // put `requestedThinking: undefined` on every record.
    overridden: Object.values(overrides).some(value => value !== undefined) ? overrides : undefined,
  };
}

/** Model-visible disclosure, using the same effective snapshot as the record. */
export function formatInvocationOverrideNote(invocation: AgentInvocation | undefined): string {
  if (!invocation) return "";
  const changes: string[] = [];
  if (invocation.requestedModel !== undefined) {
    changes.push(`model requested ${JSON.stringify(invocation.requestedModel)}, effective ${JSON.stringify(invocation.modelId ?? invocation.modelName ?? "inherited model")}`);
  }
  if (invocation.requestedThinking !== undefined && invocation.requestedThinking !== invocation.thinking) {
    changes.push(`thinking requested ${JSON.stringify(invocation.requestedThinking)}, effective ${JSON.stringify(invocation.thinking ?? "inherited")}`);
  }
  for (const [field, requested, effective] of [
    ["run_in_background", invocation.requestedRunInBackground, invocation.runInBackground],
    ["inherit_context", invocation.requestedInheritContext, invocation.inheritContext],
    ["isolated", invocation.requestedIsolated, invocation.isolated],
    ["isolation", invocation.requestedIsolation, invocation.isolation ?? "off"],
  ] as const) {
    if (requested !== undefined && requested !== effective) changes.push(`${field} requested ${JSON.stringify(requested)}, effective ${JSON.stringify(effective)}`);
  }
  return changes.length ? `Note: Agent configuration overrides requested values: ${changes.join("; ")}.\n\n` : "";
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
  return runInBackground ? defaultJoinMode : undefined;
}
