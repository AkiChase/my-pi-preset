# Execution Plan

## Ordered Work
- [x] Inspect original AGENTS.md, scaffold specs, README, package/test setup, and task state; obtain user approval.
- [x] Preserve original project rules and record spec discovery research.
- [x] Rewrite PRD and add design/implementation artifacts; seed real implement/check research context and validate before re-running task start.
- [x] Read representative source/test files; create the five preset topics and their index.
- [x] Rewrite the three thinking-guide files with local examples and no upstream-template instructions.
- [x] Write research/migration-coverage.md mapping all original constraints; confirm coverage before replacing AGENTS.md.
- [x] Delete frontend scaffolding; replace AGENTS.md with exactly its previous managed block; adjust only README's two stale attribution references.
- [x] Update this task's metadata and search remaining task manifests for removed references.
- [x] Run discovery, task validation, Markdown link/placeholder checks, whitespace checks, and pnpm check.
- [x] Dispatch read-only trellis-check over the entire migration and original rule snapshot: PASS, no confirmed findings; main-session isolated full checks also passed.
- [x] Load trellis-update-spec and review durable migration lessons: already captured in preset index, repository/documentation and testing specs; see research/final-verification.md.
- [x] Follow-up user approval: delete unused `.cursor/`, update pi-only policy, include selected `.pi/` integration/config and `.gitattributes` in the same commit.
- [x] Approved task-scoped commit prepared with integration additions and successful follow-up review; main session executes the commit containing this record. Ignored clones/runtime and other pre-existing work remain excluded.

## Validation
- [x] `python3 .trellis/scripts/get_context.py --mode packages --json`: single-repo discovery reports only `preset`, not frontend.
- [x] `python3 .trellis/scripts/task.py validate 00-bootstrap-guidelines`: implement/check manifests each pass with two existing research entries. Original AGENTS snapshot and discovery research remain curated context instead of new specs.
- [x] Extract original managed block from research/previous-agents.md and compare it exactly with AGENTS.md: byte equality passed (1,073 bytes, including markers and final newline).
- [x] Walk links in .trellis/spec Markdown: all 95 local relative links across nine spec documents and migration coverage resolve; no duplicate headings.
- [x] Search .trellis/spec for template placeholders, upstream src/templates/packages/cli/docs-site references, frontend framework advice and duplicate headings: no semantic residue found.
- [x] Inspect all task JSONL for actual removed spec references: none; every real entry still exists. Other tasks were not edited.
- [x] `git diff --check` and explicit trailing-whitespace checks of new/untracked spec/coverage docs: passed.
- [x] `PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check`, with the installed SDK root and a fresh temporary agent directory: strict typecheck passed; 275 tests / 79 suites passed, zero failures/skips. No install/sync was run against user state; SDK setup linked zero new packages. The temporary agent directory was removed.

## Implementation Notes
- The main session corrected an initial file-count typo: the approved named layout is five topics plus their index, six preset files total. All named destinations are present and original constraints are mapped in research/migration-coverage.md; no extra topic is needed.
- Read-only file-hash audit confirms this implementation's changes are confined to AGENTS/README, preset/guides, this task's metadata/plan and migration coverage, plus exactly seven frontend scaffold deletions. Product sources, manifests, generated integrations, workflow, session pointers and research snapshots are unchanged.
- The audit detected a concurrent change to `.trellis/tasks/10-12-monitor-wake/prd.md` after the initial snapshot. This implementation did not write or revert it. No other out-of-scope drift was detected.
- The two inherited missing workflow contract references remain untouched, as recorded in research/spec-discovery.md. Independent review and spec-update judgment are complete; see research/final-verification.md. Commit approval remains pending.

## Review / Rollback Gates
- Do not remove original rules until migration coverage is complete.
- Full check must inspect actual new/untracked files, not just git diff.
- Workflow/platform infrastructure and product sources are outside this change. Note the inherited missing workflow-spec references without fixing them here.
- User approved including `.pi/` configuration/agent metadata/git ignore and `.gitattributes` in the single work commit and deleting unused `.cursor/`. Keep other tasks and generated Trellis scripts/config/workflow/workspace excluded; enumerate files instead of staging all of `.trellis/`.
