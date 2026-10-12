# Guideline Migration Design

## Boundary
This is a documentation/context migration, not a runtime change. The current gap is that AGENTS.md contains the real project rules while .trellis/spec contains irrelevant frontend and upstream-template advice. Move those rules to a discoverable spec layer before removing them from AGENTS.md.

## Final Layout
One single-repo layer under .trellis/spec/preset/:
- index.md: applicability, navigation, Pre-Development Checklist, Quality Check.
- repository-guidelines.md: repository map, development/distribution boundaries, pnpm/peer/runtime dependencies, no-build TS, language/comment policy, vendor provenance.
- extension-guidelines.md: explicit top-level entries, no duplicate tool/shortcut registration, SDK types, lifecycle/cleanup and safe rendering patterns backed by real examples.
- sync-guidelines.md: four domains, merge/prune/preserve/tombstones, protected files/settings, safe writes and --dev source-switch constraints; reference implementation/tests rather than duplicating the full README.
- testing-guidelines.md: strict noEmit extensions scope, SDK linking, node:test locations (including existing extensions/__tests__), offline/temp-directory isolation, representative regression tests and commands.
- documentation.md: migrate the full change-to-README-section matrix and update its maintenance reference from 'this file' to the new spec location. Development workflow internals remain excluded from README and preset resources.

Keep guides/index.md plus two focused guides. Replace generic/upstream-specific examples with the preset's actual boundaries and reuse patterns; remove repeated sections and unsupported absolute advice.

## Entry and Injection
AGENTS.md must be byte-for-byte the existing managed block, extracted from research/previous-agents.md, including the start/end markers. Do not regenerate a different Trellis template.

Local research confirms immediate .trellis/spec/preset/index.md is recognized in single-repo mode. No package config or platform edits are required. New layer visibility does not automatically inject every linked document; future tasks must curate relevant spec files in their implement/check manifests. This task bootstraps from immutable research snapshots because the destination specs do not exist yet and files being rewritten should not be its initial context.

## Coverage and Evidence
research/previous-agents.md is the authoritative migration snapshot. Create research/migration-coverage.md mapping each original section and substantive constraint to its destination. Treat explicit project rules as policy; verify descriptive runtime claims using source/test files. Useful existing evidence: package.json, tsconfig.json, scripts/pi-manifest.test.mjs, extensions/bash-unified.ts, scripts/sync.mjs and scripts/sync.test.mjs, scripts/link-pi-sdk.mjs, extensions/bg-tasks/PROVENANCE.md, extensions/blocked-signal.ts and its tests.

## README
Edit only the two stale references near '添加扩展' and the final paragraph. Keep the README rule itself in user-facing wording without replacing the links with .trellis paths or adding Trellis documentation.

## Compatibility / Exclusions
Remove .trellis/spec/frontend/ only after new content is written. Update this task's relatedFiles/notes. Search other task JSONL for actual removed paths and adjust only real broken dependencies, not unrelated PRDs. Do not edit .trellis/scripts/, config.yaml, or workflow state blocks.

Follow-up user approval: delete unused .cursor/ rather than maintain its generated integration. Update repository policy to pi-only development integration. Include existing .pi/settings.json, subagents.json, three agent definitions, their template-hash metadata and git/.gitignore, plus .gitattributes in the same migration commit. Do not include ignored pi package clones or runtime files. Remove the inherited .gitattributes comment pointing to a nonexistent upstream spec, preserving its merge rule.

The workflow contains two absent upstream spec references. Record this inherited issue in research/spec-discovery.md; leave workflow.md untouched in this migration rather than inventing a local runtime contract or modifying managed infrastructure.

## Rollback
The original AGENTS.md and its pre-session diff are preserved in research/. On a failed migration, restore only this task's document changes from the snapshot; do not reset the working tree or delete unrelated untracked scaffolding. Delete no original spec until replacement content is available.
