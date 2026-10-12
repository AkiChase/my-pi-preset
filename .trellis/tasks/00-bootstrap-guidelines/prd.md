# Bootstrap Project Guidelines

## Goal
Replace the frontend bootstrap scaffolding with source-backed engineering guidelines for this personal pi preset. Make Trellis specs the sole home of project conventions; keep AGENTS.md as the unmodified Trellis managed entry point.

## Requirements
- Preserve all substantive project constraints from the pre-migration AGENTS.md, including README synchronization, runtime/package boundaries, vendor provenance, dependency management, extension discovery, offline tests, and sync/dev safety.
- Remove frontend-only scaffolding and irrelevant Trellis-upstream advice from thinking guides.
- Specs must describe the existing repository, with concrete source/test paths, useful examples, and anti-patterns; no product redesign or hypothetical framework conventions.
- New guidelines must be discoverable and usable by future task context manifests.
- README remains user-facing: remove stale claims that AGENTS.md contains the detailed rules without adding Trellis internals or spec-tree documentation.
- Retain existing unrelated work and other tasks. Do not modify extension code, install/sync behavior, manifests, or the workflow state machine.
- Follow-up approved scope: remove unused `.cursor/`, preserve and include project `.pi/` integration/configuration and `.gitattributes` in the same commit. Never include ignored package clones or session runtime state.

## Acceptance Criteria
- [x] AGENTS.md contains exactly the existing TRELLIS:START/END managed block, with no custom project rules.
- [x] All substantive original rules have destinations in the new specs; documented runtime claims are checked against source/tests or identified as project policy.
- [x] No frontend spec directory, placeholder prose, duplicate template sections, or Trellis-upstream source-path advice remains in the spec tree.
- [x] The single-repo preset layer is discoverable; its index has Pre-Development Checklist, Quality Check, and working links.
- [x] Task metadata and implement/check manifests no longer depend on removed frontend specs; all real manifest entries exist.
- [x] README no longer claims project rules or the synchronization matrix live in AGENTS.md, and does not document Trellis internals.
- [x] Markdown links, migration coverage, context validation, whitespace checks, and pnpm check pass (or environment blockers are explicitly reported).

- [x] Unused `.cursor/` is removed; project policies reflect pi-only integration, and selected `.pi/` files plus `.gitattributes` are included without clones/runtime state.

Verification evidence: `research/final-verification.md`.

## Approval
The user approved the migration plan and implementation in this session. This existing bootstrap task was already activated; complete its missing planning artifacts before dispatching implementation.
