# Pi Trellis Workflow

## Core Principles

Read before write. Project guidelines and task artifacts are authoritative.
Read-only exploration, research and explanation need no task and grant no implementation approval.
Create a task only when preparing changes and after user approval. Never infer approval from status.
Do not cross an unapproved authorization boundary. Implementation, checking and verification may proceed
continuously within an explicitly approved plan; material scope changes require renewed approval.
Implementation approval includes scoped local commits by the main session unless the user explicitly opts out.
No separate commit approval or repeated checkpoint questions are needed. Commit each verified implementation stage
as it completes. This does not authorize push, rewriting existing history, archive, unrelated work, installation or dependency fetching.
Task creation or initialization alone is not implementation approval.
Choose implementation and review executors separately. Prefer direct main-session implementation for
well-scoped work; delegate when it meaningfully reduces context load, enables independent work or the user requests it.

## Planning Artifacts

Lightweight tasks may use a PRD alone; complex tasks need `prd.md`, `design.md`, `implement.md`.
For multi-stage implementation, identify independently verifiable stages and commit checkpoints in `implement.md`;
a lightweight single-stage task can record its checkpoint in the PRD. Record any explicit no-commit instruction.
Keep coupled code, tests, documentation and resource hashes in the same stage when consistency requires it.
Every executor must read relevant specs and task artifacts. Before dispatch, curate real project-root-relative
references in the dispatched role's JSONL: `implement.jsonl` for implementation, `check.jsonl` for review.
Direct implementation does not require an implementation dispatch manifest. Self-review does not require a check dispatch manifest.
If unused role manifests are intentionally empty, use `task.py start <task> --allow-empty-context` explicitly;
this only bypasses the CLI's empty-manifest gate, not approval, spec reading or context preparation for a dispatched role.
`task.py validate` still reports empty manifests; do not describe that result as full validation success.
If dispatch becomes necessary later, curate that role's context before dispatching.
Parent/child links are organization, not a dependency scheduler. Execute in the approved order.
Session-scoped pointers never infer another session. `deactivate` clears only your session binding, not task status.

## Phase Index

1. Plan: 1.0 orientation, 1.1 requirements, 1.2 design, 1.3 context, 1.4 review/start.
2. Execute: repeat 2.1 implement → 2.2 check (self-review or independent review) for each implementation stage; commit verified stages unless the user opted out.
3. Finish: 3.1 review, 3.2 verify, 3.3 assess spec updates, 3.4 final Git review/conditional remaining commit, 3.5 approved archive/journal.
Pull details on demand: `python3 .trellis/scripts/get_context.py --mode phase --step X.Y`.

## Phase 1: Plan

#### 1.0 Orient [required]
Use `/skill:trellis-start`; inspect identity, Git state and current session task.
If scripts are absent, explicitly use `/trellis-init`. Unsupported runtime is read-only, not auto-upgraded.

#### 1.1 Requirements [required]
Use `/skill:trellis-brainstorm`. Read-only questions do not need task creation.
Before preparing changes, get task creation/planning approval. Save goals, scope and acceptance in PRD.

#### 1.2 Design [once]
For complex work, document ownership, interfaces, validation, failure/rollback and exclusions.
Write an ordered implementation plan with actual test commands. Do not implement during planning.

#### 1.3 Context [required]
Use `/skill:trellis-before-dev`. Discover relevant spec indexes, read their checklists and guides.
Choose implementation and review executors separately, based on scope, risk and the value of delegation.
For each role to be dispatched, curate real JSONL references; no placeholder rows or unrelated entire directories.
For direct work, read the materials yourself rather than creating dispatch manifests solely for ceremony.

#### 1.4 Review and Start [required]
Review required artifacts and obtain implementation approval before `task.py start <task>`.
Status changes and task-creation consent are not implementation approval. Respect already-granted bounded authorization:
an approved plan need not be approved again merely because it has been saved to task files.
Use `task.py start <task> --allow-empty-context` only when unused role manifests are intentionally empty;
prepare every dispatched role's JSONL first. The option does not bypass approval or required spec reading.

## Phase 2: Execute

#### 2.1 Implement [required]
The main session may implement directly or dispatch `trellis-implement`. Prefer direct implementation when
scope is clear and context is already available; delegate substantial or independently scoped work when useful.
Read relevant specs, PRD and optional design/implementation plan regardless of executor.
Only work the approved scope; preserve parallel changes.
Complete one independently verifiable implementation stage, then perform 2.2 before starting the next stage.
Do not accumulate all stages for a single final commit unless the user requested that approach or opted out of commits.

When dispatching, start with `Active task: <path>`, context id and role. Bind the child to its independent
session key without calling start or hooks. Load role JSONL references and artifacts unless a complete injection
marker is present in the task-context block. Read omitted materials within the task store boundary.
Prefer `trellis_dispatch` from the source host: unbound tasks execute in the shared source directory,
with a short concurrency warning and main-coordinated file scope. Bound tasks require approved managed
preparation and must not use ordinary Agent or temporary isolation to bypass their binding. Read the
package-local worktree protocol from the session overview on demand.
Delegation alone does not require creating a worktree; existing managed bindings retain their execution constraints.
An already-running role works directly, never recursively dispatches. Sub-agents must not commit, install or finish.

#### 2.2 Check [required]
Checking is mandatory; a separate check sub-agent is not mandatory for every task.
Implementation and checking are independent choices:

| Path | When to use |
| --- | --- |
| Main implements → main self-reviews | Well-scoped, low-risk changes with clear verification |
| Main implements → `trellis-check` independently reviews | Direct implementation is efficient, but a fresh review is valuable |
| `trellis-implement` implements → `trellis-check` independently reviews | Delegated implementation and independent review both add value |

Require independent review for high-risk changes (permissions, destructive data operations, public compatibility
or cross-module contracts), or significant uncertainty that self-review cannot adequately resolve.
Do not decide by file count alone. Explain the selected review path and any unavailable independent review;
self-review is never independent review. Starting a reviewer does not establish acceptance.

Use `/skill:trellis-check` for either review path. Inspect actual changes, run relevant focused tests and broader
checks according to impact. Before dispatching `trellis-check`, prepare `check.jsonl` and an explicit review scope;
the main session then verifies actual findings, scoped fixes and test evidence. No implement dispatch is needed first.
An already-running role self-checks without recursion; its self-check does not replace required independent review.
Fix only scoped findings. Record exact commands and unavailable checks; simulated UI is not real visual/provider validation.

At each completed stage, the main session reviews the actual diff, verifies stage-specific checks and any required
independent review, then immediately commits that stage unless the user explicitly opted out. Do not wait for
whole-task acceptance or split everything into commits retroactively at the end. Stage commits do not replace final integration checks.
Normally stage the stage's exact files, keeping coupled changes together. Select hunks only when a file mixes
stage changes with other work; preserve unrelated staged changes. If safe selection is uncertain, report the blocker
rather than committing mixed work. Record the checkpoint hash and checks, then continue to the next approved stage.
Sub-agents never commit; main verifies their returned changes before creating the checkpoint.

## Phase 3: Finish

#### 3.1 Review [required]
Compare actual changes with PRD acceptance. Inspect tracked, untracked and parallel hunks without reverting unrelated work.

#### 3.2 Verify [required]
Checks must cover the final relevant code and configuration. Reuse valid results when relevant inputs have not changed;
after edits, rerun affected checks and broader checks when the impact warrants them, rather than repeating every command mechanically.
Record failures and limits. No unrun check is Passed, and execution completion alone is not acceptance.

#### 3.3 Capture Specs [required]
Assess whether the task produced reusable evidence-backed contracts. Use `/skill:trellis-update-spec` when an update is warranted;
do not manufacture a spec edit for every task. Keep project rules in project specs.

#### 3.4 Commit [conditional]
This is the final Git review, not the first opportunity to commit. Inspect completed stage commits and remaining
task changes; commit verified final integration fixes or other scoped remaining work unless the user opted out.
Do not recreate, squash, rebase or amend earlier history without explicit approval. A single-stage task may need only one commit.
Preserve unrelated staged work. Approval of task implementation includes its scoped local commits, not unrelated changes.
Never push without explicit approval. Task creation and initialization alone do not authorize implementation or commits.
If the user requested no commits, leave changes uncommitted and report their state; implementation and verification can still be delivered.

#### 3.5 Archive and Journal [conditional]
Use `/skill:trellis-finish-work` for approved lifecycle actions. Only main performs finish/archive/session recording.
Unfinished tasks stay active; deactivation alone does not complete status. Archive only accepted completed work.
Session end does not imply task completion or lifecycle approval. Authorization to run `trellis-finish-work`
covers applicable archive, deactivation, journal recording and local commits of those wrap-up changes;
do not ask for each action separately or repeat already-granted finish-work authorization. Respect explicit
user restrictions; archive only after acceptance. Journal records deliberate summaries, respecting configuration.
Lifecycle commands auto-commit according to `session_auto_commit` by default; never implicitly commit product
code or unrelated changes. Use `--no-commit` for an explicit no-commit instruction or an unsafe mixed parallel
scope; safely separate authorized wrap-up changes or report the blocker. Do not bypass disabled auto-commit
configuration with manual commits. Inspect complete command commit scopes before execution and verify resulting
commits/remaining changes afterwards; report configured skips and failures accurately. No implicit push or history rewriting.

## Breadcrumbs

[workflow-state:no_task]
No active task. Read-only exploration needs no task. Before modifying code, ask for task/planning approval.
[/workflow-state:no_task]

[workflow-state:task_error]
Task binding or runtime is invalid. Inspect the diagnostic before reading task material or dispatching. Do not treat this as no_task or approval.
[/workflow-state:task_error]

[workflow-state:planning]
Stay in Phase 1. Review required artifacts and prepare context for any dispatched roles before approved start. Honor explicit approval of an unchanged plan; unused role manifests may be intentionally empty.
[/workflow-state:planning]

[workflow-state:in_progress]
Work within approved scope. Choose implementation and review executors separately; paired dispatch is not required. Check each completed implementation stage and commit it immediately unless the user opted out; do not defer all commits to final wrap-up. Push, history rewriting and lifecycle actions need explicit authorization. Sub-agents must not recursively dispatch or commit.
[/workflow-state:in_progress]

[workflow-state:completed]
Review acceptance and remaining scoped changes; honor no-commit instructions. Finish-work authorization covers applicable archive/deactivation/journal and their configured local commits; do not ask for each action separately or repeat granted authorization. Preserve unfinished work and parallel changes; verify commits or report pending paths. No implicit push or history rewriting.
[/workflow-state:completed]
