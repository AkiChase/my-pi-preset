---
name: trellis-start
description: "Initializes an AI development session by reading workflow guides, developer identity, git status, active tasks, and project guidelines from .trellis/. Classifies incoming tasks and routes to brainstorm, direct edit, or task workflow. Use when beginning a new coding session, resuming work, starting a new task, or re-establishing project context."
---

# Start Session

Initialize a Trellis-managed development session. Pi supplies a session overview. Reuse it and refresh missing or stale context on demand.

## Dispatched Role: Source Materials, Execution Code

A dispatched role requires the host-validated exact four-line header (`Active task`, `Trellis context id`,
`Trellis agent`, `Trellis authority`), followed by a blank line. Authority JSON contains only absolute sourceRoot,
executionRoot and requirementsFingerprint. The host re-queries native materials and binding facts;
complete paths/references remain host-internal. Derive task materials from sourceRoot + taskDir,
workflow from sourceRoot/.trellis/workflow.md, specs from sourceRoot/.trellis/spec and the selected
role manifest from the source task path. Missing or invalid authority is a blocker;
report to main and stop, with no local `task.py current` or execution-checkout `.trellis` fallback.
Fully read source PRD, optional design/implement, workflow and the selected implement/check JSONL plus
all references; research has no implement/check manifest requirement. Resolve relative materials from
sourceRoot, inspect/edit product code/tests at executionRoot, and paginate read offset/limit until complete.
Paths/hashes are not injected bodies or actual-read proof; no complete-injection shortcut applies.
Source task/spec/workflow are read-only by default. Main owns integration, reference repair and lifecycle.
Return results/evidence; source evidence/research writes require explicit path-scoped authorization.
An already-running role works directly: never dispatch recursively, start/hooks, commit or finish.
For the main-session CLI steps below, use the source root. For a dispatched role, use absolute source
reads first; if a read-only CLI is needed, invoke the verified source `.trellis/scripts/` separately with
its independent child context. Product shells retain execution cwd; do not mix source CLI and product commands.
Main verifies obsolete source references and repairs them within existing authorization, then requeries
and redispatches. No target material synchronization, binding migration or automatic source fallback.

---

## Step 1: Current state
Identity, git status, current task, active tasks, journal location.

```bash
python3 ./.trellis/scripts/get_context.py
```

## Step 2: Workflow overview
Compact Phase Index, request triage rules, planning artifact contract, and the step-detail command.

```bash
python3 ./.trellis/scripts/get_context.py --mode phase
```

Full guide in `.trellis/workflow.md` (read on demand).

## Step 3: Guideline indexes
Discover existing spec layers, then read each relevant index file.

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
cat .trellis/spec/guides/index.md
cat .trellis/spec/<layer>/index.md   # for each relevant layer
```

Index files list the specific guideline docs to read when you actually start coding.

## Step 4: Start or resume the task

Read the current task's PRD and available design/implementation record, then choose the actual unfinished step. Document presence alone is not proof that a stage passed checks. This skill restores context; it does not approve implementation.

- **No active task** → Read-only conversation needs no task. If the user explicitly selects an existing task, bind it with `python3 .trellis/scripts/task.py active <task>` and reload context. Do not guess another session's task. Route new work by the workflow's Request Triage: a small task the user declines to track goes to direct edit (read relevant specs, self-check, leave changes uncommitted unless asked); complex work asks for task-creation consent and enters **1.1**.
- **Invalid binding** → Report task_error; inspect or deactivate the invalid binding before selecting a task. Never treat corruption as no_task.
- **Planning, no PRD** → **1.1**, load `trellis-brainstorm`.
- **Planning, PRD only** → Lightweight work can go to **1.4**; complex work needs design/implement first.
- **Planning, artifacts ready but selected dispatch context missing** → **1.3**.
- **Planning, artifacts and selected context ready** → **1.4**. Start only within explicit implementation approval; `active` is not `start`.
- **In progress, current stage not implemented** → **2.1**.
- **In progress, current stage implemented but not checked** → **2.2**.
- **In progress, current stage checked** → Follow the **2.2** checkpoint rules (including the pending commit), then return to **2.1** for the next approved stage.
- **In progress, all stages checked** → **3.1–3.4** for final review, verification, spec assessment and Git review.
- **Completed** → Review acceptance and use existing finish-work authorization, or obtain it if absent.

Load the chosen step, rather than automatically restarting Phase 2:

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.X>
```

Follow the loaded project workflow within approved scope, honoring existing authorization and opt-outs. Do not turn each resume step into a fresh approval question. `active` changes only this session's pointer; multiple sessions can bind the same task, and other bindings/operations are not cancelled.

---

## Skill routing (quick reference)

| User intent | Skill |
|---|---|
| New feature / unclear requirements | `trellis-brainstorm` |
| About to write code | `trellis-before-dev` |
| Done coding / quality check | `trellis-check` |
| Stuck / fixed same bug multiple times | `trellis-break-loop` |
| Learned something worth capturing | `trellis-update-spec` |

Full rules + anti-rationalization table in `.trellis/workflow.md`.

## Pi Execution Boundary

Main-session `.trellis/...` paths are relative to the source project, not this skill directory. Dispatched roles use verified absolute source material paths and separate executionRoot for code/tests. Read-only work needs no task; modifications require approval. Follow the project workflow for execution and review routing. Sub-agents must not recursively dispatch. Managed worktrees follow the package protocol referenced in the session overview. Do not modify deployed runtime to bypass release hashes.
