# Pi Trellis Workflow

## Core Principles

Read before write. Project guidelines and task artifacts are authoritative.
Read-only exploration, research and explanation need no task and grant no implementation approval.
Create a task only after user consent; classify new work by Request Triage first. Never infer approval from status.
Do not cross an unapproved authorization boundary. Implementation, checking and verification may proceed
continuously within an explicitly approved plan; material scope changes require renewed approval.
Implementation approval includes scoped local commits by the main session unless the user explicitly opts out.
No separate commit approval or repeated checkpoint questions are needed. Commit each verified implementation stage
as it completes. This does not authorize push, rewriting existing history, archive, unrelated work, installation or dependency fetching.
Task creation or initialization alone is not implementation approval.
Choose research, implementation and review executors separately. Handle small lookups directly; delegate
independently useful code or technical research to `trellis-research`. Prefer direct main-session implementation for
well-scoped work; delegate when it meaningfully reduces context load, enables independent work or the user requests it.

## Planning Artifacts

### Task Material Boundaries

| Path | Purpose |
| --- | --- |
| `prd.md` | Goals, scope, acceptance criteria and authorization boundaries |
| `design.md` | Design decisions, interfaces and trade-offs |
| `implement.md` | Implementation stages, progress, commit checkpoints and evidence links |
| `research/*.md` | Research findings persisted by the research agent only |
| `evidence/` | Selected long-term evidence, not raw execution output |
| Role JSONL | Curated context references, not reports or logs |

`research/` is not a general task attachment directory. Do not write implementation summaries,
progress or authorization records, review reports, test logs, screenshots or temporary scripts there.
Implement/check agents and the main session must not write their own reports into `research/`.
The main session verifies research findings and integrates adopted conclusions into design/planning artifacts;
its own task analysis belongs in those artifacts, with retained supporting evidence under `evidence/`.
Read-only exploration without a task still requires neither task creation nor persistence.

Create an owned run directory outside the repository in the system temporary directory (for example,
with `mktemp -d`) before collecting execution output. Raw stdout/stderr, full event streams, bulk terminal
text/ANSI captures, temporary drivers/launch scripts, debug fingerprints and duplicate interim reports
belong there by default, not in task `evidence/` or a repository `.tmp/` directory.
Keep raw materials needed for diagnosis until main has checked the failure and any rerun. Children return
concise results, unresolved issues and temporary paths main needs to inspect; do not copy raw output into
the repository just for handoff. Reports are optional, not required per role or stage.
Main records final commands, environment, exit codes, results, failure causes and rerun relationships,
and unrun limitations preferably in `implement.md` (or the PRD for lightweight work). Preserve failure
facts; a later PASS must not erase earlier failures, but preserving those facts does not require permanent
retention of every raw output. Final records must be self-contained, not depend only on temporary links
that will be deleted. Only main-selected minimal, sanitized material for unresolved issues or valuable
long-term reproduction belongs in `evidence/`; state its purpose before authorizing persistence.
Within existing execution or wrap-up authorization, remove only this run's owned temporary directory
once main has verified the materials and no active process still uses it. If diagnosis is unresolved,
ownership/authorization is uncertain, or cleanup fails, retain the needed material and report why and
where; do not claim cleanup succeeded. Never broadly clean system temporary files or another session.
These rules govern new outputs. Do not move, delete, rename or repair references in historical tasks without
separate approval; report historical misclassification without automatically cleaning it up.
Authorized research writes use Markdown under `research/`; retained evidence uses existing textual formats under `evidence/`.
Format checks are not author authentication or semantic classification; historical reference reads remain supported.

### Planning and Dispatch Context

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
Session-scoped pointers never infer another session. `task.py active <task>` binds only the caller without
changing task status/branch or running hooks; multiple sessions may bind the same task. It is not implementation
approval. `deactivate` clears only your session binding, not task status.

## Phase Index

1. Plan: 1.0 orientation, 1.1 requirements, 1.2 design, 1.3 context, 1.4 review/start.
2. Execute: repeat 2.1 implement → 2.2 check (self-review or independent review) for each implementation stage; commit verified stages unless the user opted out.
3. Finish: 3.1 review, 3.2 verify, 3.3 assess spec updates, 3.4 final Git review/conditional remaining commit, 3.5 approved archive/journal.
Pull details on demand: `python3 .trellis/scripts/get_context.py --mode phase --step X.Y`.

### Request Triage

With no active task, classify each new request before changing anything.

- Read-only exploration, research or explanation: answer directly; no task is needed.
- Simple conversation or small task: ask only whether this turn should create a Trellis task. If the user says no,
  skip Trellis for this session and edit directly.
- Complex task: ask whether you may create a Trellis task and enter planning. If the user says no, do not do broad
  inline implementation; explain, clarify scope or suggest a smaller split.
- Consent to create a task is not implementation approval. Planning still happens first.

Direct edits without a task: the user's explicit request approves only that change. Still read relevant specs,
self-review and run relevant checks. Leave changes uncommitted unless the user explicitly asks for a commit.
If scope grows, design trade-offs appear, or the change touches permissions, destructive data operations, public
compatibility or cross-module contracts, stop and ask again whether to create a Trellis task.

## Phase 1: Plan

#### 1.0 Orient [required]
Use `/skill:trellis-start`; inspect identity, Git state and current session task.
If scripts are absent, explicitly use `/trellis-init`. Unsupported runtime is read-only, not auto-upgraded.

#### 1.1 Requirements [required]
Use `/skill:trellis-brainstorm`. Read-only questions do not need task creation.
For work routed to a task by Request Triage, get task-creation consent first. Save goals, scope and acceptance in PRD.

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

Dispatch uses the host-validated exact four-line header: `Active task: <path>`, `Trellis context id: <id>`,
`Trellis agent: <role>`, `Trellis authority: <JSON>`, then a blank line. Authority JSON contains only
sourceRoot, executionRoot and requirementsFingerprint; text alone does not authorize them. The host
re-queries native source materials and binding facts to verify task, role, roots and fingerprint, retaining
complete material paths/references internally. Derive task materials from sourceRoot + taskDir, workflow
from sourceRoot/.trellis/workflow.md, specs from sourceRoot/.trellis/spec, and the role manifest from the
source task path. The manifest is the only complete model-facing reference selection list.
Bind the child to its independent source runtime session key without calling start or hooks. No task/spec
execution copy is prepared. Git-checkout `.trellis` stays unchanged and is never a material fallback.
Every role fully reads source PRD, optional design/implement and workflow, then implement/check reads its
selected source JSONL and all references (research has no implement/check manifest requirement).
Resolve relative material rows from sourceRoot and code/tests from executionRoot. Paginate until complete;
paths/hashes are not bodies, full-read proof or a complete-injection shortcut. Missing/invalid source paths
are blockers, never permission to use target copies. Main verifies obsolete references and repairs them
within existing material-maintenance authorization before requery/re-dispatch; no material synchronization
or old-binding conversion. Actual conflicts, scope changes or unapproved writes require a decision.
Source task/spec/workflow materials are read-only for children by default. Main owns integration/lifecycle;
children return results/evidence. Explicit path-scoped authorization may allow implement/check evidence
under the source task evidence/ or research findings under source research/, not arbitrary source writes.
For every delegated execution, including ordinary agents, specify repository-external temporary output
and concise returned results; evidence write permission is not a request to persist every intermediate file.
Prefer `trellis_dispatch` from the source host: unbound tasks execute in the shared source directory,
with a short concurrency warning and main-coordinated file scope. Bound tasks require approved managed
preparation and must not use ordinary subagent_run or temporary isolation to bypass their binding. Read the
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
Preserve unrelated staged work. Before any commit that includes a task directory, inspect tracked and
untracked new materials, keep the minimum useful retained set and consolidate duplicate summaries;
being inside this task does not make a file worth committing. Apply the Task Material Boundaries above.
Approval of task implementation includes its scoped local commits, not unrelated changes.
Never push without explicit approval. Task creation and initialization alone do not authorize implementation or commits.
If the user requested no commits, leave changes uncommitted and report their state; implementation and verification can still be delivered.

#### 3.5 Archive and Journal [conditional]
Use `/skill:trellis-finish-work` for approved lifecycle actions. Only main performs finish/archive/session recording.
Unfinished tasks stay active; deactivation alone does not complete status. Archive only accepted completed work.
Session end does not imply task completion or lifecycle approval. Authorization to run `trellis-finish-work`
covers applicable archive, deactivation, journal recording and local commits of those wrap-up changes;
do not ask for each action separately or repeat already-granted finish-work authorization. Respect explicit
user restrictions; archive only after acceptance. Journal records deliberate summaries, respecting configuration.
Lifecycle commands may include the whole task directory: perform the same retention review before
journal or archive, including untracked files, and authorized cleanup of owned temporary output.
Lifecycle commands auto-commit according to `session_auto_commit` by default; never implicitly commit product
code or unrelated changes. Use `--no-commit` for an explicit no-commit instruction or an unsafe mixed parallel
scope; safely separate authorized wrap-up changes or report the blocker. Do not bypass disabled auto-commit
configuration with manual commits. Inspect complete command commit scopes before execution and verify resulting
commits/remaining changes afterwards; report configured skips and failures accurately. No implicit push or history rewriting.

## Breadcrumbs

[workflow-state:no_task]
No active task. Read-only exploration needs no task. Classify new work by Request Triage before changing anything.
Simple conversation / small task: ask only whether this turn should create a Trellis task. If the user says no, skip Trellis for this session: edit directly within the request, self-check, and leave changes uncommitted unless asked.
Complex task: ask whether you may create a Trellis task and enter planning. If the user says no, explain, clarify scope or suggest a smaller split.
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
