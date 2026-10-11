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
- Type-checked under this repo's `tsconfig.json` (`verbatimModuleSyntax`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`), which upstream does not enable.
  `noUncheckedIndexedAccess` is deliberately *not* enabled: `bash-unified.ts` deep-imports
  pi-pretty's `src/*.ts`, so those sources join the program and `skipLibCheck` (which only
  covers `.d.ts`) cannot exclude them — the flag is not globally enableable here.
- `commands.ts`: `/bg-version` reads the preset's `package.json`. After flattening,
  upstream's `../package.json` pointed at a nonexistent `extensions/package.json`.
- `format.ts` `formatJobLine()`: dropped the duplicate duration suffix (upstream appended
  its own on top of the one `statusLabel()` already embeds, printing `▶ bg (12s) (12s)`),
  and routed the command through `oneLine()` so a multi-line command cannot break the
  one-job-per-line contract of `jobs list`. `__tests__/format.test.ts` had codified the
  doubled duration as an assertion; it now asserts the single-duration form.
- `tools/jobs.ts` `statsAction()`: labels aligned with `padEnd()` instead of hand-counted
  spaces (upstream's `Total started:` and `Currently running:` were in different columns),
  and `Total CPU time` renamed to `Total elapsed` — the underlying `totalDurationMs` is
  summed wall clock, not CPU time.
- **Failure notifications inline the log tail.** Upstream's `<task-notification>` for a
  failed job carried only `"... failed with exit code N"`, and `tools/jobs.ts`'s
  `promptGuidelines` told the model to *"call 'output' on a FAILED job"* — so every single
  failure cost a guaranteed extra `jobs output` round-trip just to learn the reason.
  Now:
  - `output.ts` gains `readTailLines(logPath, maxLines, maxChars)` — ANSI-stripped,
    blank-dropping, `\r`-collapsing tail reader (a progress bar would otherwise spend the
    whole budget and push the error out of the window).
  - `notify.ts` gains `failureTail(job, status)` and emits an `<output_tail>` element
    (upstream's XML had no such element) plus `details.outputTail`. Successful jobs get
    nothing, so a success costs no extra context.
  - `index.ts` `renderTaskNotification` renders the last `NOTIFICATION_TAIL_LINES_SHOWN`
    lines dimmed under the summary — a backgrounded job's output appears nowhere else in
    the TUI, so a bare failure line left the user with nothing to look at.
  - `promptGuidelines` inverted accordingly: do NOT call `output` just to learn why a job
    failed.
  - New constants in `types.ts`: `FAILURE_TAIL_LINES`, `FAILURE_TAIL_CHARS`,
    `NOTIFICATION_TAIL_LINES_SHOWN`. New tests in `__tests__/failure-tail.test.ts`.
