# Preset Engineering Guidelines

## Applicability

This is one personal pi preset, not an application or a monorepo. This layer covers shipped extensions, the sync/installer scripts, their tests, dependencies and user documentation. Development-workflow files are separate from preset resources.

## Guidelines Index

| Guide | Read when changing |
| --- | --- |
| [Repository Guidelines](./repository-guidelines.md) | File placement, dependencies, language or vendor code |
| [Extension Guidelines](./extension-guidelines.md) | Extension entry points, tools, shortcuts, events or terminal rendering |
| [Sync Guidelines](./sync-guidelines.md) | Manifest domains, installer options, config writes or local source switching |
| [Testing Guidelines](./testing-guidelines.md) | Type checking, regression tests or validation commands |
| [Documentation](./documentation.md) | Any user-visible behavior or maintenance/check commands |
| [Thinking Guides](../guides/index.md) | Cross-boundary changes or reuse decisions |

## Pre-Development Checklist

- Read the active task's PRD, design and implementation plan before editing.
- Read repository guidelines and documentation, then the extension/sync/testing topics relevant to the change.
- For non-trivial work, follow [the workflow](../../workflow.md): use a task with a PRD and curated JSONL context; activation, finish and archive remain session-owner decisions.
- State the smallest behavior gap, its actual owner, necessary files and exclusions. Search representative sources/tests, not just comments or earlier plans.
- Read the shared thinking-guide index. Trace any manifest → sync → runtime → README boundary that changes.
- Keep specs concrete and English. Layer discovery exposes this index; it does not inject every linked file. Future implement/check manifests must explicitly include relevant specs. For migrations, preserve the old policy/discovery evidence as research rather than bootstrapping from documents being rewritten.

## Quality Check

- Confirm explicit extension discovery and absence of duplicate registrations.
- Cover behavior with offline, isolated tests; run `pnpm check` before proposing a commit.
- Apply the complete [README synchronization matrix](./documentation.md).
- Check local Markdown links and `git diff --check`; inspect new/untracked documents too.
- Keep development integrations and task artifacts out of the shipped preset. Do not hand-edit generated integrations or the managed AGENTS block.
- Report actual results and blockers. Update durable conventions here when evidence changes; do not leave scaffold prose or unrelated upstream instructions.
