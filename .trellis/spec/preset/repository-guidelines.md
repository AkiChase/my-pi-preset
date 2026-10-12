# Repository Guidelines

## Repository Map

Paths below are relative to the repository root.

| Path | Responsibility |
| --- | --- |
| [pi-preset.json](../../../pi-preset.json) | Desired packages, conflicting standalone packages, settings, keybindings, extension config files and prune preservation |
| [install.sh](../../../install.sh), [scripts/sync.mjs](../../../scripts/sync.mjs) | Bootstrap and reconcile four machine-state domains; `--dev` overrides only this preset's source |
| [extensions/](../../../extensions/) | Directly loaded top-level TypeScript extensions; nested modules/tests are not standalone entries |
| [package.json](../../../package.json), [pnpm-lock.yaml](../../../pnpm-lock.yaml) | pi resource declaration and development/runtime dependency declarations |
| `local/` | Gitignored notes and disposable scripts, not maintained project code; PRDs/plans belong in `.trellis/tasks/` |
| [README.md](../../../README.md) | All user-facing documentation, in Chinese |
| [`.trellis/`](../../) | Workflow, real specs, tasks with PRDs/JSONL context, developer journals and task scripts |
| `.pi/` | Project-level development pi config; settings currently load only `git:github.com/AkiChase/pi-trellis` (integration and `trellis-*` subagents); `.pi/git/` clones are ignored |
| `.gitattributes` | Union merge for append-only developer journals; not regenerated workspace indexes |

**Project policy:** `.trellis/` and `.pi/` are development infrastructure, not preset resources. Never add them to `pi-preset.json` or the `package.json` `pi` declaration, and do not document those internals in README. Cursor integration is not used: do not restore `.cursor/` unless explicitly requested. AGENTS.md is only the managed Trellis entry point; keep project conventions in this spec layer.

## Runtime and Dependency Boundary

- There is no build step: pi loads extension `.ts` files directly. [tsconfig.json](../../../tsconfig.json) is strict, `noEmit`, and rooted at `extensions/**/*.ts`; scripts are plain `.mjs`.
- Use pnpm (version in `packageManager`); maintain `pnpm-lock.yaml`, never introduce `package-lock.json`.
- **Project policy:** keep runtime `dependencies` on permissive ranges. On other machines pi installs git-package runtime dependencies with its own package manager (default npm), not this checkout's pnpm lockfile; `devDependencies` are for checkout development, not distributed runtime requirements.
- pi supplies `@earendil-works/*` SDK imports at runtime. Keep the SDK peer-based rather than installing another runtime copy. [link-pi-sdk.mjs](../../../scripts/link-pi-sdk.mjs) links the locally installed SDK for checks; see [Testing Guidelines](./testing-guidelines.md).
- Put a required third-party runtime import in `dependencies`, not only `devDependencies` or preset `packages`. If this preset invokes another pi extension itself, declare its standalone package in `conflicts` to prevent duplicate registrations (example: [bash-unified.ts](../../../extensions/bash-unified.ts)). Local packages need `pnpm install` before `--dev`; pi does not install/update their dependencies in place.

## Vendored Ownership

[bg-tasks/PROVENANCE.md](../../../extensions/bg-tasks/PROVENANCE.md) records the upstream repository, exact commit, copy layout and license ([LICENSE.upstream](../../../extensions/bg-tasks/LICENSE.upstream)). Preserve provenance for new copies and record intentional deviations as they land. This fork is repository-owned code: edit it in place, without an upstream merge/sync obligation. Do not reinstall `pi-patty-bg-tasks` as a separate dependency or pi package.

A vendor directory with `index.ts` must stay behind the top-level wrapper. Explicit discovery and [pi-manifest.test.mjs](../../../scripts/pi-manifest.test.mjs) prevent it loading again independently; never remove that guard. See [Extension Guidelines](./extension-guidelines.md).

## Language and Comments

**Project policy:** code, comments, commit messages and specs are English; README is Chinese. The old Chinese custom AGENTS rules have moved here, not into a second rule file.

Explain **why**, not just what: identify the pi/third-party behavior and version where relevant, and what breaks without the workaround. [bash-unified.ts](../../../extensions/bash-unified.ts) explains pretty's source-entry import and shared bash ownership; [blocked-signal.ts](../../../extensions/blocked-signal.ts) documents host notification gaps. Verify current code/assertions when historical comments or provenance describe an older model; do not turn those comments into new contracts.
