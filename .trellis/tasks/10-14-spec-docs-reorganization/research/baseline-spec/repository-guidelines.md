# Repository Guidelines

## Layout and Ownership

| Location | Responsibility |
| --- | --- |
| `extensions/<name>.ts` | Independently loaded extension entry |
| `extensions/<name>/` | Helper modules, tests, and preserved upstream provenance |
| `pi-preset.json` | Desired packages, conflicts, settings, keybindings, and managed config leaves |
| `install.sh`, `scripts/sync.mjs` | Bootstrap and machine-state reconciliation |
| `package.json`, `pnpm-lock.yaml` | Resource declarations and dependencies |
| `README.md`, `docs/` | User overview and detailed plugin/development documentation |
| `.trellis/spec/` | Coding, testing, architecture, and maintenance constraints |
| `.trellis/tasks/` | Scoped plans and task-specific verification evidence |
| `.pi/`, other `.trellis/` files | Development infrastructure, not shipped preset resources |
| `local/` | Ignored disposable notes, not maintained product or task plans |

Do not add development infrastructure to the preset/resource manifest. Do not hand-edit generated runtime, role definitions, or the managed AGENTS block to change project conventions. Preserve unrelated staged and working-tree changes.

## Language Policy

- All documents under `.trellis/spec/preset/` must be written in English.
- All documents under root `docs/` must be written in Chinese.
- README, task plans/research, and deliberate project journals remain Chinese.
- Code, code comments, and commit messages remain English. Identifiers, paths, commands, JSON keys, and quoted upstream material retain their original spelling.
- Preserve third-party/license originals and generated materials; this policy does not authorize translating them.

This replaces the former rule requiring preset specifications to be Chinese. See [documentation maintenance](documentation.md) for content placement.

## Runtime and Dependencies

- There is no build step. Pi loads TypeScript through its host loader; checks use strict, no-emit TypeScript. Do not hide type errors with `any` or blanket suppressions.
- Use the pnpm version declared in `packageManager`; maintain `pnpm-lock.yaml`, not npm lockfiles.
- Keep host SDK packages peer-based. Use the existing `scripts/link-pi-sdk.mjs` to resolve an installed SDK for checks; do not fetch another SDK to silence validation failures.
- Required runtime imports belong in `dependencies`, not only dev dependencies or preset packages. Other machines install git-package runtime dependencies through Pi's package manager and do not use this checkout's pnpm lockfile.
- Keep runtime dependency ranges permissive unless a specific justified compatibility requirement says otherwise. Dependency fetching and personal installation require authorization; they are not validation steps.
- Keep installer/sync code dependency-free. Do not import extension/SDK code into it for incidental reuse.

## Vendor Code

Preserve upstream source, exact baseline, license, and intentional local deviations in the owning provenance file. Repository-owned forks may be edited in place; do not invent an upstream synchronization obligation or duplicate their standalone tool registration. Add conflicting standalone sources to the manifest when this preset owns their registration.

## Change Checklist

Before non-trivial edits, identify the smallest behavior gap, actual owner, required files, and exclusions. Trace affected boundaries: manifest → sync → config → load, or execution → delivery → view. Search existing owners before adding helpers; do not merge semantically distinct settings or state just because their syntax resembles each other.

Read relevant topic guidelines, not every plugin's history. Verify current code and tests rather than copying stale comments. Keep public behavior, tests, and documentation consistent; record unrelated refactoring opportunities without implementing them.
