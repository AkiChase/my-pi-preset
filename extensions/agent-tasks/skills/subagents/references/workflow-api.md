# Workflow API

## Authorization and invocation sources

Run only after explicit user opt-in: the user's own request for workflow/multi-agent orchestration, a user-invoked skill/slash command explicitly requiring subagent_workflow, or a request for a specific named/saved workflow. Reading Subagents is not authorization; potential benefit is not opt-in. Otherwise delegate individually or explain the purpose and approximate cost and ask. The user can say "use a workflow" next time.

Provide all top-level fields: script, scriptPath, name, args, resumeFromRunId. New execution requires exactly one non-null source; other sources and resumeFromRunId are null. Replay targets a finished run in the same session with at most one source; all sources null reuses the prior script. Empty strings are invalid. args is verbatim JSON data, including null, not an unspecified control; it does not inherit previous args. Title/description belong in meta, not tool parameters.

Pass the first script inline, not through Write first. Each invocation automatically saves the script in the session directory and returns its path. To iterate, edit that file and call with `{script: null, scriptPath: "<path>", name: null, args: null, resumeFromRunId: null}` instead of resending source. Reusable scripts belong in `.pi/workflows/<name>.js`, `.agents/workflows/`, or `<agent dir>/workflows/`; call via name with other sources/resumeFromRunId null and explicit args. File edits still require task authorization.

The tool runs in the background and immediately returns execution_id, not completion. Use agent_manage and /tasks for progress; completion is notified automatically. Do not sleep/poll solely to detect completion. Deterministic script control flow encodes fan-out, verification and synthesis.

## Source and meta

Every script begins with `export const meta = {...}`. meta must be a PURE LITERAL: no variables, calls, spreads or template interpolation. Required: name, description. Optional: whenToUse (workflow list), phases. Match meta.phases titles exactly to phase() calls; an unmatched phase gets its own progress group. Add model to a phase entry for a phase-specific override.

```js
export const meta = {
  name: 'find-flaky-tests',
  description: 'Find flaky tests and propose fixes',   // one-line, shown in permission dialog
  phases: [                                            // one entry per phase() call
    { title: 'Scan', detail: 'grep test logs for retries' },
    { title: 'Fix', detail: 'one agent per flaky test' },
  ],
}
// script body starts here — use agent()/parallel()/pipeline()/phase()/log()
phase('Scan')
const flaky = await agent('grep CI logs for retry markers', {schema: FLAKY_SCHEMA})
...
```

Teaching placeholders (schemas, helpers, ellipses) must be replaced with real definitions; they are not runnable scripts.

## Complete hooks

### agent

```text
agent(prompt: string, opts?: {label?: string, phase?: string, schema?: object, model?: string, effort?: string, isolation?: 'worktree', agentType?: string, gate?: string, resume?: string}): Promise<any>
```

- Without schema, returns final text as a string. With a JSON Schema, the child receives a StructuredOutput tool built from it and returns a validated object: no JSON.parse needed. A mismatched payload is rejected for correction; a child never answering through the tool gets one extra prompt, then fails and returns null. Filter null after every schema stage.
- Skipped agents and terminal API errors after retries also return null; use `.filter(Boolean)` and never treat null as success evidence.
- label overrides the display label. phase explicitly selects a progress group; use it in pipeline/parallel stages to avoid racing global phase() state. Identical strings share a group.
- Explicit model takes precedence over the agent definition's model. Omitted uses the definition, otherwise the parent session model. Prefer omission unless highly confident a different tier fits; when unsure, omit.
- Explicit effort takes precedence over the agent definition's thinking. Allowed: off/minimal/low/medium/high/xhigh/max. Omitted uses the definition, otherwise child session settings/defaults, not the parent's current thinking. Use low for cheap mechanical steps and higher effort for the hardest verify/judge stages.
- isolation:'worktree' creates a fresh Git worktree: expensive setup/disk per agent. Use only for parallel file mutations that would conflict, following project protocol. On settle the copy is removed and changes preserved on a branch.
- gate:'<command>' runs a shell command after completion and requires success. Nonzero exit fails the agent with command output as its error. Prefer gate:'npm test' over another model saying code looks right.
- resume:'<label>' continues the finished child at that label, preserving context. Cannot combine with agentType/model/effort/isolation/gate/schema.
- agentType uses a custom type instead of the workflow default, resolved from the same registry as subagent_run; it composes with schema. Read available types from the current tool/schema, not a fixed list here.
- Unlisted options are rejected by name. These are optional JavaScript options; do not migrate them to the top-level JSON all-fields/null contract.

### pipeline

`pipeline(items, stage1, stage2, ...): Promise<any[]>` runs each item through the entire chain independently, with NO stage barrier. Item A may be at stage 3 while B is at stage 1. This is the default for multi-stage work: wall-clock is the slowest single-item chain, not the sum of each stage's slowest item. Stage callbacks receive `(prevResult, originalItem, index)`; use originalItem/index for later labels without carrying them through stage1 results. A throwing stage drops that item to null and skips remaining stages.

### parallel

`parallel(thunks: Array<() => Promise<any>>): Promise<any[]>` runs concurrently and awaits every thunk: a BARRIER. Genuine thunk/agent failure becomes null; filter(Boolean) before use. Fatal run errors (cap breach, unloadable nested workflow, library validation such as an unknown agent option or out-of-range effort) propagate instead of becoming null. Arguments are shape-validated; typos fail the run naming the field. Use only when all results truly must arrive together.

### log and phase

- `log(message: string): void` emits a narrator line above the progress tree.
- `phase(title: string): void` starts a phase; subsequent agent() calls enter its progress group.

### args

`args: any` is the tool input verbatim, including null; internal workflow() may pass undefined. Previous args are not automatically inherited. Pass actual JSON arrays/objects, not encoded strings: `args: ["a.ts", "b.ts"]`, not `args: "[\"a.ts\", ...]"`. The latter arrives as one string, so args.filter/map throw. Parameterize named workflows with questions, paths/config directly, not side-channel files.

### budget

`budget: {total: number|null, spent(): number, remaining(): number}`. total is always null here (Pi has no token-target directive), so `while (budget.total && budget.remaining() > 50_000) { ... }` correctly does not fire, rather than failing on a missing global. spent() counts this run's agents' output tokens; remaining() is Infinity without a target.

### workflow

`workflow(nameOrRef: string | {scriptPath: string}, args?: any): Promise<any>` runs another workflow inline and returns its result. Names use the same registry as top-level name; {scriptPath} can reference an earlier written file. The child shares concurrency cap, agent count, abort signal and token budget, appears under a `▸ name` group, and contributes to spent(). args becomes the child's global. Only one nesting level: workflow() inside a child throws. Unknown name, unreadable path or child syntax error throws; catch to handle gracefully. Reads and orchestration still require authorization.

## Runtime boundaries

Children are told final text IS their return value, not a human-facing message, so they return raw data. For structure use schema: tool-call validation enables correction on mismatch.

Scripts are plain JavaScript, NOT TypeScript. Type annotations (`: string[]`), interfaces and generics fail to parse. The body runs asynchronously; await directly. Standard built-ins (JSON/Math/Array/etc.) are available except Date.now(), Math.random() and argumentless new Date(), which throw because they break replay. Supply timestamps through args, stamp results after return, and vary prompts/labels by index for variation. eval and Function(...) throw; no filesystem or Node API access.

Concurrent agent() cap per workflow is `max(1, min(16, available CPUs - 2))`; excess queues until slots free. All 100 items can be processed, with only about 10 active at once (CPU-dependent). Total agent count is capped at 1000; one parallel/pipeline call accepts at most 4096 items. Exceeding caps errors explicitly, never silently truncates.

## Replay

Results include execution_id. After pause, kill or script editing, relaunch a finished same-session run with scriptPath/resumeFromRunId, script/name null and explicit args. The longest unchanged agent() prefix returns recorded results instantly; the first edited/new call and everything after runs live. Same script + same args → 100% cache hit. This is a prefix, not a lookup: later matches are not reused after an earlier change. Journaled failure ends the prefix; failure at agent 5 retries from agent 5. The run must be finished in the same session; stop it first (agent_manage stop or x in /tasks). Replay gets a new execution_id.

Before diagnosing an empty/unexpected completed result, read `<run id>.workflow.jsonl` beside the script: it records each agent's actual return. Do not assume cached results are non-empty. Time/random globals are unavailable; supply timestamps via args or stamp after return. These are the existing replay semantics, not a replacement for result verification.
