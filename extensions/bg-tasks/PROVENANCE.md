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
`jobs` output, `monitor` streaming), which upstream's structure is not
converging on. Edit these files in place. Do not add `pi-patty-bg-tasks` back as a
dependency — it registers the same tool names and would conflict (see
`pi-preset.json` → `conflicts`).

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
    (These three moved into `config.ts` in the change below.)
- **A configuration file.** Upstream had no configuration surface at all: every knob was
  an `export const` in `types.ts`, every shortcut a hardcoded chord in `shortcuts.ts`, and
  the log directory a `const LOG_DIR = "/tmp/pi-bg"`. A preset that follows its owner onto
  several machines needs those to vary, and `pi.registerShortcut` takes a raw chord rather
  than an action id — so `keybindings.json` cannot reach these keys and a config file is
  the only way to move or release one.
  - New `config.ts`: `DEFAULTS` (frozen), `loadConfig(agentDir?, env?)`, `BgTasksConfig`.
    Precedence env > file > default, matching pi-pretty. `~/.pi/agent/bg-tasks.json`.
    Synchronous because shortcut registration happens during extension load, and total
    because a malformed config must never stop the extension loading: bad values fall back
    with a warning, unknown keys are reported, nothing throws.
  - The resolved config lives on `BackgroundRegistry` (`reg.config`) — `reg` already
    reaches every tool and helper. A module-level singleton read at import time would have
    made every test share one config and been uninjectable. Leaf helpers without a registry
    (`watchStalls`, `followLines`, `failureTail`) take the values as parameters, defaulting
    to `DEFAULTS`.
  - `logPathFor`/`errPathFor` now take the registry; `LOG_DIR` is gone.
  - `bash-params.ts` became a function of the config: two of its parameter descriptions
    quote the timeout and the log directory, and a stale literal there is a lie told
    straight to the model. Same for the `bash`/`bash_bg`/`monitor` tool descriptions.
  - `registerShortcuts` returns warnings instead of throwing, so one rejected chord does
    not cost the other three bindings.
  - New `/bg-config` command: shows the source file, the overridden keys with their
    defaults, and any load warnings.
  - New tests: `__tests__/config.test.ts`, `__tests__/shortcuts.test.ts`.
- **The `notified` latch is split into three fields.** Upstream had one boolean on `Job`
  carrying three unrelated meanings at once: "the agent has been told", "don't tell the
  agent" (`bash_bg notify: false`), and "a `jobs attach` is reading this right now". The
  consequences were real, not stylistic:
  - A `notify: false` job that FAILED was marked notified and evicted at exit, so its
    failure reached nobody — and `jobs list` showed only running jobs plus the recent-
    terminal ring, so it was visible nowhere at all.
  - `sendTaskNotification` set the latch BEFORE `pi.sendMessage`, so a send that threw
    lost the outcome permanently: the job sat terminal and "notified" with nothing
    delivered, and the only trace was a `console.error`.
  - `attachAction` wrote `job.notified = true` before its wait and `= false` on abort —
    the same field the exit callback reads. Two concurrent attaches had the first's
    return cancel the second's suppression, and a throw between the two writes left the
    job permanently unable to notify.

  Now `Job` has `outcomeSurfaced` (set only AFTER a delivery actually reached the agent),
  `attachCount` (a counter, scoped to the wait, decremented in a `finally`), and
  `notifyError` (why the last send failed). `completeJob`'s `shouldNotify?: boolean`
  became `notification?: "auto" | "self" | "suppressed"`, because upstream's single
  `false` covered both "a monitor already sent its own" and "never send one" — which want
  opposite handling. A failed-and-unreported job stays in the registry and `jobs list`
  lists it with `[notification failed: …]`; a suppressed job that merely *succeeded*
  still evicts, since a success nobody asked about is nothing to report.
- **The notification text is compact instead of XML.** Upstream emitted Claude Code's
  `<task-notification>` block verbatim — seven lines of tags around four short values,
  with `<summary>` duplicating `details.summary` exactly. CC needs the XML because its
  notification is injected as plain conversation text; here the message is a `customType`
  with a `details` payload and a dedicated renderer, so the structure already travels
  out-of-band. What is left is what `details` cannot deliver to the model: a one-line
  `[task <id> · <status>] <summary>`, a `log:` line, and the tail block for a failure.
  `escapeXml` is gone (nothing left to escape) and `toolUseId` moved to `details` only —
  nothing in pi lets the model address a tool-use id. The stall warning in
  `monitoring.ts` now routes its tail through the same `outputTail` parameter instead of
  appending its own `"Last output:"` header, so a stall and a failure look alike.
- **The background hint is derived, not ref-counted.** Upstream's `hint.ts` kept a
  module-level `activeHints` counter and required every caller to pair exactly one
  `showBackgroundHint()` with one `clearBackgroundHint()`. Any exception path between the
  two pinned `(ctrl+shift+b to run in background)` below the editor for the rest of the
  session, with no way to clear it — `session_shutdown` did not reset the counter either.
  The hint is now computed from the registry's foreground slots (`ForegroundSlot.hinted`),
  so it cannot outlive the commands it describes: the slot is deleted on every exit path
  and wholesale by `pauseAllForeground`, and the next render has nothing to show. Content
  is diffed before the widget write, like the sidebar.
- **The hint says what is running.** Upstream showed one static line regardless of state.
  Which command and how long it has been going is the entire basis for deciding whether to
  background it, so the hint now lists a row per command with its elapsed time, refreshed
  by the sidebar's existing 1 Hz ticker (a foreground command is itself a running job, so
  that ticker is always alive when the hint is up). The chord comes from
  `shortcutBackground` and falls back to `/bg` when unbound — advertising a key the user
  remapped away is worse than saying nothing.
- `lifecycle.ts` `takeControl()`: mid-turn with no foreground command and no queued
  message used to fall through to `"No running process to background."` — words that
  describe an idle session while the agent is visibly working, which reads as a broken key
  and invites a second press. That case now gets its own informational message.
- Keybinding audit: `shift+down` was unverified upstream. Checked against pi 1.1.0's
  action table — the built-ins are `down` (`tui.editor.cursorDown`, `tui.select.down`),
  `ctrl+shift+down` (`tui.altScreen.nextPrompt`) and `alt+down`
  (`app.models.reorderDown`). Nothing claims `shift+down`.
- **`jobs output` can page.** Upstream had `readBoundedTail(logPath, maxChars)` and no
  offset parameter at all, so the middle of a large log was simply unreachable through the
  tool — a job whose interesting output was not at the end could not be read. `output.ts`
  gains `readLogSlice(logPath, {offset, limit})` returning `{text, start, end, size}`;
  omitting `offset` keeps the tail default. Offsets are bytes, so paging stays O(limit) on
  a 100 MiB log; the cost is a possible U+FFFD at a range seam, which `readBoundedTail`
  already risked. Each result states its byte range, flags the bytes it skipped (a bare
  tail otherwise reads as the whole log), and names the offset to continue from.
- **`jobs` validates the parameters each action needs.** Upstream wrote `p.jobId!` and let
  the omission surface wherever it landed: `No task found with ID: undefined` for output, a
  TypeError for the others. The schema cannot express "required for these actions only"
  (one flat object is shared by all seven), so `required(value, name, action)` checks it
  explicitly and the parameter descriptions state the dependency.
- **`jobs search` can be narrowed, relaxed, and given context.** Upstream searched every
  log in the session, case-sensitively, returning bare matching lines. Added: `jobId` to
  scope the scan to one job (and a hard error on an unknown id, rather than silently
  scanning everything), `ignoreCase`, and `context` for surrounding lines. Context is
  collected by a `ContextCollector` sliding window during the existing single-pass stream,
  so a second read of the log is never needed; only DISPLAYED hits collect it, leaving the
  reported match count unaffected. Hits render in grep's convention — `:` for the match,
  `-` for context.
  - Note for future edits in this file: `ContextCollector` assigns its fields in the
    constructor body rather than using TypeScript parameter properties. pi and
    `node --test` both run these files through type stripping, which rejects
    `constructor(private readonly x)` outright — it typechecks and then fails at load.
- **Monitor stream events are coalesced, and a firehose is suppressed rather than fatal.**
  Upstream emitted one message per follower poll tick (200 ms), so a stream producing a
  line per second produced a message per second — ~600 separate transcript entries for a
  ten-minute watch, each repeating its own `◉ description` header. Its only brake was
  `>500 lines/10 s`, and the response was to kill the monitor — *after* `emitEvent(lines)`
  had already sent the whole overflowing batch, so a single burst cost the full context
  AND the watch.
  - `monitor-session.ts` now buffers lines and emits at most one event per
    `monitorFlushMs` window. The first lines after a quiet period go out immediately
    (leading edge), so a slow watch still reads live; everything after them batches. The
    window can afford to be long because these events never wake the agent — they are
    appended passively and read at its next turn — so latency costs the model nothing.
  - Over `monitorMaxLinesPerWindow`, the session stops spending context and starts
    counting instead, reporting one `[N more lines not shown — full output in <log>]`
    line. The watch keeps running. Only `monitorMaxOverflowWindows` consecutive
    over-budget windows kill it: a burst is a burst, but sustained overflow is a filter
    that does not work.
  - `monitorMaxLinesPerEvent` bounds a single event, since one poll tick can contain an
    arbitrarily large write; the excess folds into the same suppressed count.
  - Ordering trap, now covered by a test: on the exit path the buffer must be flushed
    EXPLICITLY (and the throttle timer cleared) between `follower.stop(true)` and the
    terminal notification. Waiting for the throttle would put the last lines after
    "stream ended", and the `terminalEmitted` guard would drop them outright.
- `DELIVER_FOLLOWUP` renamed to `DELIVER_PASSIVE`. The old name described a queue the
  constant never reaches: with `triggerTurn: false`, pi's `sendCustomMessage` skips the
  steer/followUp branch entirely and `deliverAs` is never read. The real behaviour is
  "append to the transcript passively" — immediately when the agent is idle, at agent-run
  settle when it is streaming. The comment now says that instead of describing
  `agent.followUp()`.
- `completionSummary`: a failed monitor said `script failed`. A ws monitor has no script,
  and the exit code there is our synthetic abnormal-close code — the real reason is in the
  inlined log tail (`[socket closed: code 1006]`). Now just `failed (exit N)`.
  - Note: a ws disconnect ending the watch is deliberate, not a gap. `settle(1)` resolves
    the source exit, which routes through `finishMonitor("failed", …)` to a steering
    `<task-notification>` that wakes the agent with the close code in its tail. Whether to
    reconnect is the agent's call, not the library's.
- **`agent_bg` removed.** It spawned a detached `pi -p` and rebuilt the session context by
  scraping the first user message and the last assistant message, each truncated to 2000
  characters — a guess at context. `@tintinweb/pi-subagents` (in this preset) does the same
  job properly in-process: `inherit_context` forks the real conversation, the result comes
  back structured instead of as a byte tail, and it supports steering, resume, worktree
  isolation and per-agent model selection. The one behavioural difference was that the
  detached child outlived the session, but nothing collects its result once the registry is
  gone, so that left an orphan writing to /tmp rather than a feature. `JobKind` lost its
  `"agent"` variant and `JOB_ID_PREFIX` its `"a"` prefix with it.
