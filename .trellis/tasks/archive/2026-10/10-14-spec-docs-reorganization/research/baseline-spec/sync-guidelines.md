# Sync Guidelines

## Ownership and Domain Selection

[pi-preset.json](../../../pi-preset.json) declares desired state; [install.sh](../../../install.sh) only bootstraps and delegates to [scripts/sync.mjs](../../../scripts/sync.mjs). Keep the sync script runnable without project dependencies, including the downloaded installer path. User examples and the complete action table belong in README's synchronization section; apply [Documentation](./documentation.md) when behavior changes.

| Domain | Existing implementation boundary |
| --- | --- |
| `packages` | User-scope `pi list`, then `pi install` / `update` / `remove`; never reconcile project-scope entries |
| `settings` | Nested leaves in agent `settings.json`; protect `packages` and `lastChangelogVersion` |
| `keybindings` | Literal, flat action IDs in `keybindings.json`, even when IDs contain dots |
| `files` | Nested leaves only in named extension JSON files in the agent directory |

Selection and pruning are independent per domain. `--sync` defaults to all; merge is default; bare `--prune` owns only selected domains; pruning an unselected domain is an error. Unselected config domains must not read/write their files; unselected packages must not call pi or switch sources. `--dry-run` may read selected state (including `pi list`) but performs no package actions or config writes.

## Merge, Prune and Protected Data

- Merge aligns declared leaves and keeps undeclared values. Prune removes undeclared leaves except preserved paths and pi-owned settings.
- A declared `null` is a tombstone: remove that key even in merge mode. Removing its declaration alone does not propagate deletion; keep the tombstone until machines have synced. No last-applied state file is needed.
- Arrays/scalars replace whole leaves, not elements. Empty manifest objects declare nothing; removal cleans emptied parent sections.
- `preserve.settings` / `preserve.files` accept dotted paths or explicit segment arrays for literal dotted keys. `preserve.keybindings` takes literal action IDs. Declared/preserved path overlap is rejected, not silently prioritized.
- Keybinding `[]` disables an action; `null` removes its override. A string and a one-element list compare equal without rewriting the existing representation.
- `files` accepts plain `<name>.json` names, no paths/traversal/second config root. Never read, write or prune an undeclared file. `preserve.files` must name a declared file.
- `files` rejects `settings.json`, `keybindings.json`, credentials (`auth.json`), machine state (`trust.json`, `models-store.json`) and `models.json` (another extension owns its transaction). Do not weaken `UNMANAGEABLE_FILES` or `PI_OWNED_SETTINGS` casually.

Source owners: `readManifest`, `leafEntries`, `buildConfigPlan` and `normalizeKeybinding` in [sync.mjs](../../../scripts/sync.mjs). [sync.test.mjs](../../../scripts/sync.test.mjs) asserts domain selection, tombstones, array replacement, preservation, protected names, invalid files and idempotent matching.

## Safe Writes and Failure Semantics

`readJsonFile` accepts BOM/blank files but refuses invalid JSON/non-object content rather than overwriting it. `applyConfigPlan` locks via `<file>.lock`, rereads under the lock after package operations, applies path operations to fresh content, and renames a same-directory temporary file. Preserve the lock, reread and cleanup: writing the planning snapshot would lose pi's package changes. Existing formatting is two-space JSON without a trailing newline; a matching file is not rewritten.

Ordinary package operations are grouped install → update → remove; source-switch removals are the exception below. Ordinary failures are collected; a source-switch removal failure aborts before any install or config write. Do not describe all conflict removals as prerequisites: current conflicts are removed even in merge mode, but after ordinary installs/updates.

## Local Development Source Switching

**Project policy:** arbitrary local paths remain invalid published manifest sources; git and local identities are not global aliases.

`checkoutRoot` derives the absolute real checkout from the executing sync script, not cwd or `--manifest`. `--dev` requires this repository's package name/explicit pi declaration, `.git`, expected extension/installer/manifest paths and exactly one self git source. It overrides only that source in memory, never the manifest or third-party sources. A downloaded/piped installer cannot select a temporary directory as a dev package.

Remove the opposite source for this checkout before installing the selected one, even in merge mode; abort on removal failure to avoid duplicate registrations. Refuse switching from inside the pi-managed clone that removal would delete. Preserve unrelated local checkouts. Normal `./install.sh` from the same checkout switches back to remote; switching only happens when packages are selected.

For intentional local testing: `pnpm install`, inspect `./install.sh --dev --dry-run`, then run `./install.sh --dev`, `/reload` and `/process-tasks-version` to confirm the path. These are user-state-changing operations, not automated validation. [sync.test.mjs](../../../scripts/sync.test.mjs) uses stateful mocks for both directions, repeats/coexistence, git spellings/refs, space-containing paths, removal failure, dry-run, selection, invalid checkouts and piped-install rejection.
