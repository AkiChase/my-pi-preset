# Provenance

The files in this directory started as a one-time copy of the `src/` tree of
[`patty-io/pi-patty-bg-tasks`](https://github.com/patty-io/pi-patty-bg-tasks).

| | |
|---|---|
| Upstream commit | [`697010eaa88ca1b861fce554a149a5f019a7439a`](https://github.com/patty-io/pi-patty-bg-tasks/commit/697010eaa88ca1b861fce554a149a5f019a7439a) |
| Upstream subject | `feat!: Claude Code parity re-architecture — v2.0.0` |
| Upstream date | 2026-08-01 |
| Copied from | `src/**` (including `src/__tests__`), flattened to this directory |
| Licence | MIT, see `LICENSE.upstream` |

## This is a fork, not a vendored dependency

There is no sync path back to upstream, and that is deliberate: the point of the copy
is to rework the interaction model (notification timing, `Ctrl+B` and the hint line,
`jobs` output, `monitor` / `agent_bg` streaming), which upstream's structure is not
converging on. Edit these files in place. Do not add `pi-patty-bg-tasks` back as a
dependency — it registers the same tool names and would conflict (see
`pi-packages.json` → `conflicts`).

## Note on the version chosen

npm's `pi-patty-bg-tasks@1.1.6` and this commit (`2.0.0`, one commit later) are not the
same architecture. `2.0.0` was taken because that commit is a −1792/+1772 cleanup that
deletes `notice.ts`, `proc.ts` and `tools/job-decide.ts`, and cuts `lifecycle.ts` by 293
lines — a better base to rework than `1.1.6`.

Consequence: the `job_decide` tool no longer exists. Upstream's rationale is that a
foreground command exceeding its timeout should background silently rather than forcing
a tool-call round-trip to ask the model what to do.

## Local deviations from the copied commit

Record every intentional divergence here as it lands, so the diff against upstream stays
explainable.

- Flattened `src/**` → `extensions/bg-tasks/**`; upstream's root `index.ts`
  (`export { default } from "./src/index.ts"`) was dropped as redundant.
- Not registered as a pi extension directly. `extensions/bash-unified.ts` imports it and
  re-registers its `bash` tool through `@heyhuynhgiabuu/pi-pretty`'s renderers.
- Type-checked under this repo's stricter `tsconfig.json` (`noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `noImplicitOverride`, `noFallthroughCasesInSwitch`), which
  upstream does not enable.
