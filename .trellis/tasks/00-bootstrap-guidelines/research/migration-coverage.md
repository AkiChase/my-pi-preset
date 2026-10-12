# Migration Coverage

## Baseline and Approval Boundary

[previous-agents.md](./previous-agents.md) is the authoritative pre-migration AGENTS snapshot; [preexisting-agents.diff](./preexisting-agents.diff) preserves the inherited worktree change. These and [spec-discovery.md](./spec-discovery.md) are curated task context, not new permanent specs. Implement/check JSONL bootstrap from those immutable inputs rather than destination files being rewritten.

Every substantive original constraint is mapped below before AGENTS replacement. Normative project rules remain policy; descriptive behavior was checked against the named sources/assertions. The approved migration replaces the old instruction to keep custom rules outside the managed block with a single permanent home under `spec/preset/`. The existing managed block itself is preserved exactly.

## Original Section → Destination and Evidence

Destinations are relative to `.trellis/spec/preset/` unless stated otherwise.

| Original section / constraint | Destination | Policy or verified evidence |
| --- | --- | --- |
| Opening: personal preset, not an app; pi directly loads TS, no build | `index.md` Applicability; `repository-guidelines.md` Runtime | `package.json` pi entries; `tsconfig.json` noEmit/include; `extensions/bash-unified.ts` direct TS imports |
| Map: manifest packages/conflicts/settings/keybindings/files/preserve | `repository-guidelines.md` Repository Map; `sync-guidelines.md` | `pi-preset.json`; `scripts/sync.mjs` `readManifest`, planners |
| Map: installer + sync reconcile four domains; dev only this repo | `repository-guidelines.md` Repository Map; `sync-guidelines.md` Ownership/Local Development | `install.sh` delegation; sync selection/self override; `scripts/sync.test.mjs` mock action assertions |
| Map: explicit top-level extension loading, no nested discovery | `extension-guidelines.md` Explicit Entries | `package.json`; all assertions in `scripts/pi-manifest.test.mjs` |
| Map: local drafts ignored, no maintained code; PRDs/plans in tasks | `repository-guidelines.md` Repository Map | `.gitignore` confirms `local/`; placement is policy |
| Map: README is all user-facing docs | `documentation.md` Project Policy; repository map | Policy; existing README sections inspected |
| Map: Trellis workflow/spec/tasks JSONL/workspace/scripts responsibilities | `repository-guidelines.md` Repository Map; `index.md` checklist | Policy/navigation; paths exist; discovery verified in research |
| Map: project `.pi/settings.json` only pi-trellis integration/subagents, ignored clones | `repository-guidelines.md` Repository Map | `.pi/settings.json` read; clone ignore behavior is development policy, not a shipped runtime contract |
| Map: generated Cursor integrations maintained by trellis update, no hand edits | `repository-guidelines.md` Repository Map; index quality gate | Policy; no generated/platform edits in this task |
| Map: `.trellis/`, `.pi/`, `.cursor/` not preset/manifest/pi resources/README | repository Project policy; `documentation.md` Keep Developer Workflow Out | Policy; `package.json` and `pi-preset.json` contain no development resources |
| README matrix: extension add/remove | `documentation.md` matrix row 1 | Complete overview + bundled-extension destinations retained |
| README matrix: `pi.extensions` | `documentation.md` matrix row 2 | 「添加扩展」 retained |
| README matrix: behavior/commands/keys/config | `documentation.md` matrix row 3 | Corresponding subsection + key conflict audit retained |
| README matrix: packages | `documentation.md` matrix row 4 | Overview + third-party section retained |
| README matrix: conflicts / repo-mediated loading | `documentation.md` matrix row 5 | Repo-mediated package section retained |
| README matrix: settings/keybindings/files/preserve | `documentation.md` matrix row 6 | Overview declaration + both declaration sections + key conflict audit retained |
| README matrix: sync semantics | `documentation.md` matrix row 7 | Situation → action table retained |
| README matrix: installer/sync options | `documentation.md` matrix row 8 | Installation + option sections retained |
| README matrix: scripts/checks + maintenance of original file | `documentation.md` matrix row 9; `testing-guidelines.md` | 「开发」 retained; maintenance authority moved from “this file” to actual preset spec location |
| Vendor: preserve source/version provenance; repo-owned fork, edit directly, no upstream merge | `repository-guidelines.md` Vendored Ownership; `documentation.md` Verify Before Describing | `extensions/bg-tasks/PROVENANCE.md`, `LICENSE.upstream`, wrapper comment confirm exact upstream commit/local deviations; ownership remains policy |
| Vendor: nested index would double load tools/shortcuts; keep manifest and guard | `extension-guidelines.md` Single Ownership | Wrapper imports nested index; manifest assertions exclude it. Current `shortcuts.ts` + `shortcuts.test.ts` prove **two**, not stale four-shortcut prose in manifest-test comment |
| Commands: pnpm install/check/link-sdk; dry-run/dev/dev dry-run/settings dry-run | `testing-guidelines.md` Commands; `sync-guidelines.md` Local Development/selection | `package.json` scripts; installer passthrough and sync parse options inspected. Tests replace actual install/sync validation |
| Dependencies: pnpm, no package-lock; permissive runtime ranges; pi's own package manager/default npm/no pnpm lock/dev-only separation | `repository-guidelines.md` Runtime and Dependency Boundary; testing setup | Policy explicitly labeled; current `dependencies`/`devDependencies`/peers and packageManager inspected. Local SDK package-manager implementation confirms own command/default npm; not a new product contract |
| Dev: manifest unchanged, executing script's absolute checkout, valid self package/pi/git root | `sync-guidelines.md` Local Development | `checkoutRoot`, `selfPackageMode`; tests assert unchanged manifest, script-root choice, invalid package/git/declarations |
| Dev: refuse removing current pi-managed clone; third parties remote; local deps installed by owner | same | `buildPackagePlan`; tests assert managed-clone refusal and unchanged third-party operations; local source marked keep |
| Dev: reload, bg-version path check, ordinary install same checkout returns remote | same | Operational policy; stateful tests prove reverse switch; `extensions/bg-tasks/commands.ts` path/version implementation referenced by existing provenance, not changed |
| Dev: remove opposite source first, failure aborts, package-domain only, dry-run no changes | same; Safe Writes and Failure Semantics | Tests assert ordered calls, abort/no config writes, skipped-domain no pi calls, both-direction dry-run |
| Dev: never admit arbitrary manifest paths or globally alias git/local | same | `readManifest` rejects local paths; `identityOf` keeps local separate; tests cover unrelated local checkout and source spellings/refs |
| Checks: SDK peers supplied by pi, offline local links, PI_SDK_DIR/PI_BIN overrides, typecheck/test link first | `testing-guidelines.md` Commands/SDK Setup; repository runtime | `package.json`; full `scripts/link-pi-sdk.mjs` candidate/link logic inspected. SDK reads installed package files, not user config |
| Checks: strict noEmit extensions scope, no any/ts-ignore patches without explanation | testing Commands; extension SDK Types | `tsconfig.json` rooted extensions glob; imported TS caveat recorded; suppression restriction is policy |
| Checks: node:test placement, offline, no real ~/.pi | testing Placement and Isolation Policy | Current package test glob includes existing `extensions/__tests__`; config tests inject directories/env. Some factory tests use default loader: full check redirects agent config via temporary PI_CODING_AGENT_DIR; no blanket inherent-isolation claim |
| Checks: sync regression breadth (four domains, both dev directions, repeat/coexistence, ref/style/space paths, removal fail, dry-run/selection/invalid/piped refusal) | testing evidence table; sync descriptions | Entire `scripts/sync.test.mjs` inspected; fake CLI and temporary state, no real installs |
| Checks: manifest covers all top-level extensions/no nested; new resource types declared | extension Explicit Entries; testing evidence table | `scripts/pi-manifest.test.mjs` four assertions inspected |
| Conventions: comments explain why/version/failure, code/comments/commits English, README Chinese | repository Language and Comments; documentation | Policy; wrapper/blocked-signal examples verified. Old Chinese custom AGENTS prose superseded by approved English specs/managed-only entry |
| Trellis: non-trivial task/PRD/activation/finish/archive workflow | index Pre-Development Checklist; repository map | Policy; link to existing workflow; session owner retains lifecycle authority, no commands executed here |
| Trellis: specs are real injected context, no scaffold; managed entry ownership | index checklist/quality; documentation Developer Workflow | Local discovery/task validator research; explicitly curated future manifests, not automatic injection of all links; managed block unchanged |

## Added Source-Backed Guidance (Not Product Changes)

- Session/cleanup/rendering patterns cite `bg-tasks/index.ts`, `lifecycle.ts`, `registry.ts`, `ui.ts`, `status-bar.ts` and corresponding lifecycle/UI tests.
- Host-boundary examples cite `blocked-signal.ts` and `extensions/__tests__/blocked-signal.test.ts`; config/reuse examples cite `config.ts`, `format.ts`, `output.ts` and their consumers/tests.
- Thinking guides now trace this preset's data/ownership boundaries, without copied upstream template registration, versioned docs, CLI marketplace probes, Python platform-switch rules or duplicate sections.

## Count Discrepancy and Out-of-Scope References

The main session reconciled the initial count typo with the approved named layout: **five** topics (repository, extension, sync, testing and documentation) plus their index, six preset files total. Every named destination and original rule is covered; no seventh document is needed.

The inherited workflow has exactly two absent `.trellis/spec/cli/backend/workflow-state-contract.md` references, recorded in [spec-discovery.md](./spec-discovery.md). They remain untouched; no fabricated contract or workflow/platform/source change is included. The removed frontend scaffold has no actual dependency in other task JSONL manifests. Independent review and spec-update judgment passed; see [final-verification.md](./final-verification.md). User approved the single work commit with pi-only integration additions.
