---
name: trellis-check
description: "Comprehensive quality verification: spec compliance, lint, type-check, tests, cross-layer data flow, code reuse, and consistency checks. Use when code is written and needs quality verification, before committing changes, or to catch context drift during long sessions."
---

# Code Quality Check

Comprehensive quality verification for recently written code. Combines spec compliance, cross-layer safety, and pre-commit checks.

This skill supports main-session self-review and independent `trellis-check` review. Follow the project workflow
for reviewer selection and required independence; self-review must not be reported as independent review.
Before dispatching a reviewer, prepare its context and exact review scope. Main verifies actual findings, fixes
and evidence before acceptance; report unavailable review or checks honestly.

---

## Step 1: Identify What Changed

```bash
git diff --name-only HEAD
git status
```

## Step 2: Read Task Artifacts and Applicable Specs

Read the current task artifacts in order:

- `prd.md`
- `design.md` if present
- `implement.md` if present

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

For each changed package/layer, read the spec index and follow its **Quality Check** section:

```bash
cat .trellis/spec/<layer>/index.md
```

Read the specific guideline files referenced — the index is a pointer, not the goal.

## Step 3: Run Project Checks

Run relevant focused checks, plus project lint, type-check and broader tests according to impact and availability. Fix scoped failures before acceptance. Record unavailable commands rather than inventing them. Existing results can be reused only if they cover the final relevant code/configuration; rerun affected checks after fixes.

## Step 4: Review Against Checklist

### Code Quality

- [ ] Linter passes?
- [ ] Type checker passes (if applicable)?
- [ ] Tests pass?
- [ ] No debug logging left in?
- [ ] No suppressed warnings or type-safety bypasses?

### Test Coverage

- [ ] New function → unit test added?
- [ ] Bug fix → regression test added?
- [ ] Changed behavior → existing tests updated?

### Spec Sync

- [ ] Does `.trellis/spec/` need updates? (new patterns, conventions, lessons learned)

> "If I fixed a bug or discovered something non-obvious, should I document it so future me won't hit the same issue?" → If YES, update the relevant spec doc.

### Task Material Boundaries

- [ ] New `research/` files are research-agent findings, not implementation summaries, progress/authorization records, review reports, test logs, screenshots or temporary scripts?
- [ ] Raw logs, full events, bulk terminal text/ANSI, temporary drivers and debug fingerprints use this run's owned system temporary directory outside the repository, not task `evidence/` or repository `.tmp/`?
- [ ] Results were checked before discarding diagnostic materials; failure facts, causes and rerun relationships remain honest even after a later PASS?
- [ ] Children return concise results and needed temporary paths without copying raw output into the repository for handoff? Separate reports are optional, not required per role or stage.
- [ ] Main selected only minimal, sanitized evidence with an explicit long-term purpose; only reports worth retaining use `evidence/`, never `research/`?
- [ ] Final commands, environment, exit codes, results and limitations are preferably recorded in `implement.md` (or a lightweight PRD), without duplicate reports or reliance only on temporary links that will be deleted?
- [ ] Before committing task-directory contents, tracked and untracked new materials have passed retention review rather than being included merely because they belong to the task?
- [ ] Historical misclassification is reported without moving, deleting, renaming files or repairing references without separate approval?

Collection format checks do not prove authorship or research semantics. Review the actual new materials;
keep raw execution materials in repository-external owned temporary directories, and follow the source
workflow's Task Material Boundaries for selection, authorized cleanup and honest retention reporting.

### Scope Discipline

- [ ] Any tidying of code the task did not require?
- [ ] Any abstraction, config or extension point added for a case that does not exist yet?
- [ ] Any speculative fallback for a state that cannot occur?
- [ ] Any file changed that the acceptance criteria do not mention?
- [ ] Any workaround added at the caller instead of a fix where the behavior actually lives?

## Step 5: Cross-Layer Dimensions (if applicable)

Skip this step if your change is confined to a single layer.

### A. Data Flow (changes touch 3+ layers)

- [ ] Read flow traces correctly: Storage → Service → API → UI
- [ ] Write flow traces correctly: UI → API → Service → Storage
- [ ] Types/schemas correctly passed between layers?
- [ ] Errors properly propagated to caller?

### B. Code Reuse (modifying constants, creating utilities)

- [ ] Searched for existing similar code before creating new?
  ```bash
  grep -r "pattern" src/
  ```
- [ ] If the same value repeats, does it represent one stable concept whose callers must change together? Extract only then — two literals that merely happen to match today should stay separate.
- [ ] After batch modification, all occurrences updated?

### C. Import/Dependency (creating new files)

- [ ] Correct import paths (relative vs absolute)?
- [ ] No circular dependencies?

### D. Same-Layer Consistency

- [ ] Other places using the same concept are consistent?

---

## Step 6: Report and Fix

Report every violation you find. Then:

- Mechanical and local (lint nit, missing type, wrong import, dead branch, failing assertion) → fix in place, then re-run project checks.
- Design or judgment (naming a shared concept, moving a module boundary, changing a public interface, reassigning where behavior lives) → record the evidence and your recommendation, and stop. Do not rewrite it silently.

If a fix would touch files outside the current task's scope, say so and stop instead of widening the change.

## Pi Execution Boundary

In the main session, `.trellis/...` material paths resolve from the source project root, not this skill directory. Dispatched roles derive absolute source material paths from host-verified sourceRoot, taskDir and role manifest; code/tests and their execution cwd stay at `executionRoot`. Do not use execution-root `.trellis` as a fallback or copy/synchronize materials there. Role dispatch supplies minimal root/fingerprint authority, not reference lists or material bodies: paginate reads until complete; paths and fingerprints are not actual-read proof. Source read authority grants no write or lifecycle permission. Read-only work needs no task; modifications require approval. Follow the source project workflow for execution and review routing. Sub-agents must not recursively dispatch. Managed worktrees follow the package protocol referenced in the session overview. Do not modify deployed runtime to bypass release hashes.
