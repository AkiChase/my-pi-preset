# Preset Engineering Guidelines

This is a single Pi preset, not an application or monorepo. These specifications contain development constraints, not a catalogue of plugin behavior or past task results.

## Read by Change Type

| Guide | Read when |
| --- | --- |
| [Repository](repository-guidelines.md) | Starting work; layout, dependencies, language, ownership |
| [Extensions](extension-guidelines.md) | Tools, events, SDK integration, lifecycle, rendering, editor/UI changes |
| [Testing](testing-guidelines.md) | Designing/running verification and reporting evidence |
| [Sync](sync-guidelines.md) | Manifest, installer, package switching, config writes |
| [Documentation](documentation.md) | User-visible changes or documentation organization |

All documents in this directory are English. Detailed plugin and testing documentation under root `docs/` is Chinese.

## Before Development

1. Read the approved task PRD/design/implementation plan and relevant guides above.
2. Identify the behavior gap, actual owner, required files, exclusions, and affected consumers.
3. Verify current sources and tests; do not rely on stale descriptions or previous task status.
4. Preserve unrelated changes. Curate actual context references before delegated execution.

## Before Delivery

Verify actual diffs, focused and affected broader tests, discovery/registration ownership, lifecycle cleanup, and documentation consistency. Check links and new/untracked files. Report unavailable checks and remaining limitations. Record task-specific evidence in task research; add a general specification only when a reusable constraint warrants it.
