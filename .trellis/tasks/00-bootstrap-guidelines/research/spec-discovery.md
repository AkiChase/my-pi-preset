# Spec Discovery and Migration Evidence

## Confirmed Local Behavior
Read-only trellis-research inspected the local scripts and platform integration.

- `common/packages_context.py::_scan_spec_layers` lists immediate spec directories except guides for single-repo discovery. `get_context.py --mode packages --json` initially reported `frontend`. A preset/index.md layer is sufficient; no monorepo package mapping is needed.
- Cursor `session-start.py::_collect_spec_index_paths` discovers guides/index.md and immediate layer indexes, with package/layer fallback. Root-level common Markdown files are not automatically indexed.
- `common/task_context.py::_validate_jsonl` validates actual file/directory existence, not fixed frontend/backend names.
- Pi integration calls local context scripts; no independent hardcoded preset index requirement was found.
- Spec links aid navigation, but relevant task JSONL must explicitly curate context; directory discovery is not automatic full-file injection.

## References To Update
- Bootstrap PRD and task.json refer to frontend scaffolding.
- No concrete removed-spec dependency was found in platform integrations; keep those generated files unchanged.
- Other tasks have no real frontend JSONL entries at inspection time; recheck before completion.

## Inherited Issue (Out Of Scope)
`.trellis/workflow.md` refers twice to absent `.trellis/spec/cli/backend/workflow-state-contract.md`. These are upstream deep-contract references, not product conventions. Leave workflow runtime/managed files unchanged; do not add a fabricated local contract to make the reference resolve.

## Source Rules
`research/previous-agents.md` preserves the original project rules and managed Trellis block. `research/preexisting-agents.diff` preserves the AGENTS.md changes that predated this migration. These are research artifacts, not an additional long-term rule authority.

## Writing Contract
Specs should be source-backed, scoped to this repository, written in English, and point to actual symbols/files/tests. Preserve Chinese user-facing README wording. No React/hooks/pages/API/database or upstream Trellis-template conventions belong in this preset's spec layer. No product source changes or generated infrastructure changes are authorized.
