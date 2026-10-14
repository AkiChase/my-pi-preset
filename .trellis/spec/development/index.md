# Development Guidelines

## Before Development

Read the approved task artifacts, this document, [testing guidelines](../testing/index.md), and [shared guides](../guides/index.md). Read complete relevant source, callers and tests; search excerpts locate evidence but do not establish a contract. State the smallest behavior gap, actual owner, expected files/side effects and exclusions before nontrivial edits. Read-only findings and task status do not authorize changes. Preserve unrelated staged, unstaged and untracked work.

## Repository and Dependencies

This is one Pi preset, not an application or monorepo. `extensions/<name>.ts` is an independent entry; nested directories contain helpers, tests and provenance. `package.json` declares `extensions/*.ts`: nested index files are libraries. Preserve `scripts/pi-manifest.test.mjs`; explicitly declare shipped skills, prompts and themes because a manifest disables convention discovery for undeclared resource types. `.pi/` and `.trellis/` are development infrastructure, not preset resources; `local/` is disposable, not maintained product documentation.

There is no build step: Pi loads TypeScript through its host loader; static checks use strict no-emit TypeScript. Do not hide errors with `any` or blanket suppressions. Use the declared pnpm version and lockfile. SDK imports use host-provided public contracts and existing installed declarations; Node import success does not prove host-loader compatibility. Keep SDK peers peer-based and use `scripts/link-pi-sdk.mjs` for local checks, not another downloaded SDK. Required runtime imports belong in dependencies, not only dev dependencies or manifest packages. Keep justified permissive dependency ranges; dependency fetching and personal installation need authorization. Installer/sync code stays dependency-free and must not import SDK/extension code for incidental reuse.

Preserve vendor originals, exact baselines, licenses and intentional local deviations in owning provenance files. Repository-owned forks may be edited in place; do not invent an upstream sync obligation or duplicate their standalone tool registration. Declare conflicting standalone sources when this preset owns registration. Do not hand-edit generated runtime, roles or managed AGENTS blocks to change project conventions.

## Extension Execution and State

- Keep one execution owner per tool. Appearance adapters do not re-register execution or alter model-visible results. Recognize narrow verified optional renderer envelopes and delegate unknown formats; preserve execution/result state, partial-to-final behavior and host shell/background contracts.
- Validate schemas and untrusted input before effects. Use actual tool-error contracts rather than successful text describing failure. Bound output and expose truncation/continuation.
- Distinguish execution, result delivery and UI snapshots. Ending a wait is not stopping execution; terminal metadata is not proof of process/promise exit.
- Scope mutable state to a factory activation or operation, not import-time singletons. Capture asynchronous origin identity and recheck after awaits and before side effects. Gate optional integrations by capability/environment, isolate sink failures and preserve ordinary behavior when absent.
- Reuse the actual owner only when semantics match; similar parsing or state shapes do not establish shared invariants. An explicitly authorized internal compatibility seam must remain narrow, guarded and actual-host regression-tested; record its maintenance contract in specs, not a user implementation manual. Never silently widen it or modify the SDK.

## Lifecycle and Resource Ownership

Factories may load without sessions: start long-lived processes, watchers, sockets and timers only in the owning session/command/tool. Every process, listener, timer, worker, dialog and pending callback needs a cleanup owner; `unref()` is not disposal.

Close admission and old notifications before cancelling waits/stopping execution. Cleanup is idempotent, isolates failures and retains late-cleanup ownership. Partial setup failure releases already-created resources, not just registry entries. Synchronous callbacks can reenter shutdown: recheck admission and identity after publishing/wiring callbacks. A cancellable before-switch event is not final shutdown. Never revive a closed activation, reopen its dialog, send late results to a new session or reinstall an old UI after reload.

Cancel owned execution and verify actual exit. Bound shutdown waits and report non-cooperative in-process provider limitations honestly; promise cancellation cannot forcibly stop it and does not excuse owned process/worker/socket/timer leaks. Preserve logs and unknown/uncommitted worktree output on cancellation or save failure; no force-removal or detached cleanup to bypass ownership.

## Editor, UI and Rendering

Prefer public `ctx.ui` dialogs and host components; terminal-only screens require TUI mode, not merely dialog-capable RPC. Bind each custom instance to one interaction and finish through its completion callback; do not nest replacement dialogs or manually hide SDK-owned interactions.

Preserve the live editor receiver, history, undo, paste, cursor and focus. Do not recreate it by copying text or reading private editing state. Preflight capabilities, roll back partial installation and restore only still-owned properties. Later wrappers remain usable; retired delegates must not retain session resources. Respect application keybindings, delegate unowned keys, use local component input handling, and propagate focus/cursor markers for IME.

Use injected themes and SDK terminal-column helpers, not string length/hard-coded colors. Honor `render(width)` and host padding. Strip external controls before styling without indiscriminately stripping host-generated resets. Rendering has no file I/O or expensive repeated layout; cache by content/width, invalidate for theme/content, clamp selection/scroll on resize. Previews read bounded data; retain immutable metadata/bounded snapshots, not controllers/full logs, and expose paths/ranges for full data.

## Synchronization and Configuration Safety

`pi-preset.json` owns desired state; `install.sh` bootstraps and delegates to dependency-free `scripts/sync.mjs`, including downloaded installer use. User commands/action tables belong in README, not another sync manual.

- Packages reconcile user-scope `pi list` and install/update/remove only, never project entries. Settings use nested leaves and protect `packages`/`lastChangelogVersion`; keybindings use flat literal action IDs; files use nested leaves only in declared extension JSON files.
- Selection/pruning are independent per domain. Sync defaults to all; merge is default; bare prune owns selected domains only, and pruning an unselected domain errors. Unselected domains cannot read/write files, call Pi or switch sources. Dry-run may read selected state (including Pi list), never apply actions/writes.
- Merge aligns declared leaves and retains undeclared values; prune removes undeclared leaves except protected/preserved paths. Declared null is a tombstone even in merge; undeclaring alone does not propagate deletion. Arrays/scalars replace whole leaves; empty objects declare nothing; remove empty parent sections. No last-applied state is required.
- Preservation uses dotted paths or explicit segment arrays for literal dotted settings/file keys; keybinding preservation uses literal IDs. Reject declared/preserved overlap. Keybinding `[]` disables; null removes override; string and equivalent singleton list compare without rewriting representation.
- Files are plain declared `<name>.json`, never paths/traversal/another config root. Preservation names declared files only. Never manage `settings.json`, `keybindings.json`, `auth.json`, `trust.json`, `models-store.json` or `models.json`; preserve `UNMANAGEABLE_FILES` and `PI_OWNED_SETTINGS` boundaries.
- JSON reads tolerate BOM/blank but refuse malformed/non-object content. Lock each file, reread under lock after package actions, apply operations to fresh state, then rename a same-directory temporary file. Do not publish the planning snapshot and lose package changes. Preserve lock/cleanup and matching-file no-write behavior; existing format is two-space JSON without a trailing newline.
- Ordinary actions run install → update → remove and collect failures. Source-switch removal is a prerequisite and aborts before install/config writes on failure; ordinary conflict removal is not that prerequisite and occurs even in merge.

Local paths are not valid published sources or global aliases. `checkoutRoot` comes from the sync script's real location, not cwd/manifest. Dev mode verifies package identity/explicit Pi declaration, Git, required paths and exactly one self Git source, overriding only that source in memory. Piped/downloaded installers cannot select temporary dev packages. Remove the opposite source for this checkout before selected installation; refuse switching inside a managed clone that removal would delete, and preserve other checkouts. Normal install switches this checkout back to remote only when packages are selected. Installation, personal sync and reload are state-changing actions, not automatic validation.

Evidence: `scripts/sync.mjs` (`readManifest`, `leafEntries`, `buildConfigPlan`, `normalizeKeybinding`, `readJsonFile`, `applyConfigPlan`) and `scripts/sync.test.mjs`; entry ownership in `scripts/pi-manifest.test.mjs`.

## Documentation and Handoff

Specs are English; docs and task artifacts are Chinese; README retains Chinese. Code/comments/commits remain English. Identifiers, commands and quoted originals retain spelling; preserve vendor/license/generated originals.

`docs/` is for users: functionality, usage, commands, keys, configuration and visible limitations. Plugin page H1 titles use `Plugin Name: concise function` (the full-width Chinese colon in Chinese docs), matching the names in README and navigation. Use consistently capitalized display names for repository extensions and published package names for third-party plugins; avoid anonymous, ambiguous feature titles. Describe the current product directly; do not include obsolete configuration names, removed entry points, previous implementations or migration history in normal feature guides. Keep historical/migration evidence in tasks; express necessary current conflicts or limitations without requiring knowledge of former versions. All developer methods, test procedures and required constraints belong in specs, including plugin-specific checks. One-time designs/results/logs belong in tasks. A small feature does not require a new spec or an artificial user page. Explain user-visible behavior without copying internal algorithms into docs or concatenating them into a giant spec manual.

Keep root navigation short and layer indexes substantive. Preserve skill-required guides paths with short checklists, not repeated rules. Package discovery sees direct spec layers, not their prose; role JSONL explicitly selects material, not every index. Update current Markdown/JSONL links and anchors after moves; do not rewrite archived evidence en masse. README summarizes installation/configuration and lists every preset plugin with one sentence and a user-document link, without duplicate plugin detail/config tables. User docs cover all current package-manifest plugins and top-level extension entries; internal backend/UI modules share their owning feature page. Keep private development navigation out of the user entry.

Review actual staged/unstaged/untracked and relevant committed changes, preserve parallel work, verify discovery, consumers, cancellation/failure/cleanup and documentation accuracy. Self-review is not independent review. Record exact checks and limits under [testing guidelines](../testing/index.md); execution completion is not acceptance or authorization for lifecycle actions.
