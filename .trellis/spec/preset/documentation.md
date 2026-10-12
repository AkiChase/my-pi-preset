# Documentation Maintenance

## Project Policy: Code Changes Require README Changes

[README.md](../../../README.md) is the complete user-facing reference, written in Chinese. Any changed preset behavior, command, keybinding, configuration, dependency or check command must update the relevant section in the same change. Do not hide a user-visible change in comments, provenance or task notes alone.

| Change | README sections to update |
| --- | --- |
| Add/remove an extension | 「这里有什么」 overview table + 「本仓库自带的扩展」 |
| `package.json` `pi.extensions` | 「添加扩展」 |
| Extension behavior/commands/shortcuts/config | Its extension subsection; for keys also audit 「键位冲突」 |
| Manifest `packages` | 「这里有什么」 overview table + 「第三方包」 |
| `conflicts` or loading a package through this preset instead | 「由本仓库代为加载的包」 |
| `settings` / `keybindings` / `files` / `preserve` | 「这里有什么」 manifest declaration paragraph + 「声明设置和键位」 + 「声明扩展的配置文件」; for keys also 「键位冲突」 |
| `sync.mjs` reconciliation semantics | 「工作方式」 situation → action table |
| `install.sh` / `sync.mjs` options | 「安装」 + 「命令行选项」 |
| New script or validation method | 「开发」 + the relevant preset spec (especially [Testing Guidelines](./testing-guidelines.md)); maintain this matrix in `.trellis/spec/preset/documentation.md` |

Multiple rows can apply. Example: moving a shortcut through a manifest `files` entry requires both declaration documentation and the extension/key-conflict explanation, not just the new JSON value.

## Verify Before Describing

Use [package.json](../../../package.json), [pi-preset.json](../../../pi-preset.json), actual extension registrations and source/test assertions to check descriptions. Historical comments can be stale: [shortcuts.test.ts](../../../extensions/bg-tasks/__tests__/shortcuts.test.ts) proves two defaults, even though an older manifest-test comment says four. [sync.test.mjs](../../../scripts/sync.test.mjs) proves source-switch removal precedes installation, while ordinary conflict removals retain their later order.

Specs distinguish project policy from implementation descriptions and cite concrete evidence. Preserve vendor source/version/license and intentional deviations in [PROVENANCE.md](../../../extensions/bg-tasks/PROVENANCE.md), but user behavior still belongs in README.

## Keep Developer Workflow Out of User Documentation

Do not add `.trellis/`, `.pi/`, `.cursor/`, task lifecycle instructions or spec-tree navigation to README or preset resource declarations. Keep AGENTS.md exactly its managed Trellis block; durable project rules live in the preset specs, not AGENTS custom sections. Migration snapshots are curated task research, not new long-term specs.

For docs-only maintenance, update stale user-facing claims without inventing runtime changes. Check relative Markdown links, headings and whitespace, including new/untracked files; never regenerate managed infrastructure simply to repair an unrelated reference.
