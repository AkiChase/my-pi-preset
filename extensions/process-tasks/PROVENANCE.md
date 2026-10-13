# 来源与本地分叉记录

The files in this directory started as a one-time copy of the `src/` tree of
[`patty-io/pi-patty-bg-tasks`](https://github.com/patty-io/pi-patty-bg-tasks).

| | |
|---|---|
| Upstream commit | [`697010eaa88ca1b861fce554a149a5f019a7439a`](https://github.com/patty-io/pi-patty-bg-tasks/commit/697010eaa88ca1b861fce554a149a5f019a7439a) |
| Upstream subject | `feat!: Claude Code parity re-architecture — v2.0.0` |
| Upstream date | 2026-08-01 |
| Copied from | `src/**` (including `src/__tests__`), flattened to this directory |
| Licence | MIT, see `LICENSE.upstream` |

## 基础整理：process-tasks

当前目录从 `extensions/bg-tasks/` 改为 `extensions/process-tasks/`，相对源码与测试一同迁移。配置使用 `process-tasks.json`、环境变量前缀 `PROCESS_TASKS_*`，诊断命令改为 `/process-tasks-version` 和 `/process-tasks-config`；不读取旧配置名或旧前缀，错误/报告输出也使用当前模块名。独立 upstream 标识和以下历史 provenance 仍保留原名。

此阶段只完成后端命名、加载和验证，尚未实现新的 task-ui；原 process 面板/输入交接/快捷键暂时保留，后续阶段再按共享交互替换。Monitor 的新源、缓冲、通知和停止语义不变。全量 `pnpm check` 当前 331 tests通过，vendor loading/worker定向5 tests无force-exit通过；这些是基础加载门，不代表新等待与面板验收完成。

## 当前 Monitor 行为（本地分叉）

以下变更在原上游 v2.0.0／上表提交及 MIT 来源基础上实现，不改变来源或许可证。后文较早英文记录保留为历史，不是当前 monitor 契约。

- monitor 不再从日志轮询重建活动；命令使用 detached `bash -c` 和 stdout/stderr 双 pipe，收到的原始 bytes 写同一日志，两流独立增量 UTF-8／有界部分行解析。没有整体 `2>&1`、eval、嵌套 shell 或 tee 改写，用户的管道／重定向语义保持；stderr 不代表失败，跨流接收顺序不是实际发生顺序。
- 新内部 `monitor-buffer.ts` 统一有界前缀与省略计数，复用行数和共享字符预算。源事件先接入 session 再启动，无启动回放队列；WebSocket 保留消息边界，空消息算活动，诊断只进入收尾。
- `monitorFlushMs` 默认 30 秒，保留显式值及 0；首批和静默后恢复立即发送。进度／静默／恢复使用用户可见的 `DELIVER_STEER`，没有批次之间的 passive 消息。可选 `wake_absent_ms` 从启动／事件到达计时，每段静默只提醒一次，提醒不停止监听。普通合并和静默只由 session 决策，面板不参与。
- 删除 `persistent`、隐式默认截止／上限、速率窗口／连续溢出停止及配置、日志 follower 与轮询配置。可选有限正数 `timeout_ms` 才安排总截止；超出 Node 单次定时范围时分段等待。没有旧参数兼容、迁移或用户配置写入。
- 主 shell `exit` 同步进入 finishing，暂停并读取 Node 已缓冲的两流 bytes，只加入日志／同一收尾，再销毁 pipes 和关闭 fd。不等待 EOF／孙进程，不加 grace timeout；任一流未结束时说明后续输出可能未记录，未知数量不计入通知省略统计。
- 自然结束、失败、外部信号、显式截止及共享日志大小保护由一个合并 terminal 通知消费 pending。`notify.ts` 的可选 typed monitor payload 替代 monitor 的 failure-tail 回读，保留 shell 原行为、attach／outcome 抑制及发送失败记录。显式 jobs／panel／session stop 仍静默。进度与 absent/resumed 不修改 Job.status 或结果标记。
- 所有 monitor 启用共享 `maxLogBytes` 周期保护；`handleOversize` 小范围回调拥有 monitor 停止和通知，不再附加被动超量 warning，shell 默认路径不变。消息 renderer 仅适配 monitor 载荷和安全宽度／控制符，不改 panel、shortcut、input、注册表保留或顶层 wrapper。
- 启动接线／sidebar 渲染失败时，monitor 自己停止源和进程组、取消共享 abort／timer、释放 completion hooks，工具继续负责注册／started 回滚，不改变后台 shell 启动行为。进度与收尾提交抛出的 null／undefined 也被隔离记录，不误判源失败或标记结果；空 WS 预览后再合并 Unicode 预览时，零字符预算下完全省略的非空行计为整行省略，不误计截断行。
- 离线证据：`monitor-buffer.test.ts`、`monitor-source.test.ts`、`monitor-session.test.ts`、`monitor.test.ts`、`config.test.ts` 及共享通知、日志保护、会话、面板、shell、manifest 回归。调度使用 node:test 假时钟／假源，源使用隔离 subprocess／pipe／stub WS；无新依赖。

## 2026-10：进程错误路径补修（阶段 2A）

- `tools/bash.ts` 将启动接线与前台等待纳入同一 `try/finally`；hint 首次显示抛错时保留原异常，先 dispose launch 租约并调用既有 silent stop，等待 shell exit 后再拒绝。已完成／已 detach 的租约不重新停止任务。
- 前台 display teardown 按独立步骤停止 poller、取消 timeout／quick timer、删 foreground slot、清 hint；poller stop 或 clear widget 抛错都不阻断其余清理。清理阶段的 hint／最终 status 仅为可选显示，不覆盖 inline 结果或执行异常；最终 status 抛错时显式停止 duration ticker。
- `tools/jobs.ts` 只隔离完成 toast 的 `ui.notify` 异常，保证 lease 已原子消费的结果仍 inline 返回；不改变 `onComplete` 先消费、cleanup 后释放 attachCount 的顺序，也不消费 source snapshot/detail。
- `bash run_in_background=true` 与 `bash_bg` 的生命周期接线失败都调用 `terminateJobSilently`，等待 exit 后原样抛出启动错误。保留 terminal metadata／log、started 和 killed 各计一次；清除 controller、stall timer、completion hooks 和 notification retry，迟到 exit 不发正常完成通知。
- `__tests__/error-paths.test.ts` 使用实际工具入口、lifecycle、coordinator，以及隔离 subprocess／可控 exit；假时钟推进两秒 hint，分别触发 show+clear、clear-only、poller stop 和 final status 错误。两条后台入口都强制 `lastSidebarContent` 首次 diff，防止 fixture 未触发真实 `setStatus`。另覆盖 throwing completion toast、已终态 retrieval、两个并发 wait 取消一个及只读结果快照。
- Monitor source／buffer／timer／pending 及显式 stop 契约没有修改；本修补不扩大 SDK 异常策略，也不实现 agent、epoch 或最终面板阶段。

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

### Current interaction and retention model

- Replaced the select → action menu → editor chain with one themed, width-safe
  `ctx.ui.custom` overlay. The left roster selects immediately; the right side
  shows metadata and live log output. Tab **switches** list/output focus,
  arrows/jk select or scroll, PageUp/PageDown page, x stops only the selected
  running job, c copies its absolute log path through Pi's public
  `copyToClipboard`, and Esc closes the interaction. No persistent terminal
  input listener and no rerun/dismiss/open-file actions are registered.
- Removed the above-editor job pills. Only the footer counts running background
  shell jobs and monitors separately; foreground shell jobs are excluded. The
  existing foreground hand-off hint remains below the editor.
- The only default shortcuts are Ctrl+Shift+B (background) and Shift+Down
  (panel). `shortcutKillLatest` and the blind kill-latest handler are removed.
- Completed/failed/killed rows hide after four seconds, except the selected
  record stays readable during that interaction. Terminal metadata is retained
  for ten minutes, then swept every sixty seconds. Sweeping does not delete
  logs. Notification delivery and `jobs list` no longer evict records;
  `recentTerminal`, `forget`, `jobs cleanup` and its disk deletion are removed.
  Beyond retention, ID lookup is unknown; transcript log paths remain usable.
- `endedAt` and lifetime metrics are frozen/count once on terminal transition,
  including a silent kill followed by a late process exit. Runtime proc/stop/
  completion hooks are released then. Sweep, hint and panel timers are stopped
  at shutdown/session replacement; stale exit callbacks cannot notify a new
  session. The open viewer retains only its selected metadata, so a sweep does
  not blank final output.
- Live output is a bounded tail using `outputPreviewChars`; it explicitly shows
  the byte range and omitted early bytes. Full logs remain accessible via the
  copied path or the existing paged `jobs output` API. Width calculations use
  Pi's display-column utilities and rendered logs strip terminal controls.
- Added fake-UI/offline tests for navigation, focus, real-time tail following,
  clipboard paths, selection-specific kill, expiry and timer disposal, narrow/
  wide-character rendering, and a single-overlay lifecycle.

The entries below describe earlier changes. Where they mention immediate
notification eviction, the recent-terminal ring, sidebar pills, or four default
chords, the current model above supersedes those historical details. Tool naming
and monitor stdout/stderr semantics are intentionally unchanged in this redesign.

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
- **Historical monitor batching (superseded by the Chinese current-behavior section above).**
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

## 2026-10：共享等待核心接入（阶段 2A）

- `extensions/task-ui/` 提供不可变 task/source/run 读模型、launch/retrieval 租约、共用 `/bg`、`/tasks` 与配置；composition 创建唯一 coordinator，进程 factory 接受注入，直接测试 factory 才创建局部实例。
- `bash` 在第一次 await 前登记 launch 租约；显式 detach 参与原两秒快速完成窗口，父 abort listener 同步解绑。真正取消停止进程，转后台不重启、不重复计数；超时规则保持。
- 前台终态保留记录和原日志，不再 finally 删除／unlink；共享 terminal transition 幂等释放 hooks，指标包含前台执行。
- `jobs attach` 使用 retrieval 租约，各 wait 分别减少抑制计数；取消后重查未消费终态。monitor 被抑制的终态仅保存已构造的有界 payload，不保留 source/buffer，不在显式 stop 刷尾。
- 普通 input 不再 detach／abort／resubmit，原进程 shortcuts 和 `/bg-list` 注册删除，键位只读 `task-ui.json`，无旧键／环境变量回退。
- 新 `source.ts` 仅复制显示元数据，提供有界日志详情与后端 silent stop；过渡进程面板可查看前台并使用 shared background chord。未实现 agent detach 或最终统一 UI。


## 2026-10：Activation 关闭与实际进程退出（阶段 3A）

- composition 创建 `TaskLifecycle`；process 注册 `createProcessLifecycleParticipant`，单独 backend fixture 可 scoped own。同步关闭 admission/通知先于释放等待，silent stop 后等待实际 execution，再注销 source/coordinator。production agent 只新增 typed lifecycle option，旧 agent handler 仍待 3B 迁入，不宣称所有后端统一关闭。
- `BackgroundRegistry.closed` 禁旧 tool 新执行；新 host factory 空注册表，不 resurrect 旧 factory。不在可取消 before-switch 永久关闭。
- `OwnedExecution` 独立于 Job terminal/donePromise，追踪 shell 与 command monitor 真实 OS exit。TERM→250ms KILL 有 identity/timer 清理，停止中的 group leader exit 不遗留忽略 TERM 的后代；pid0 安全。前台 abort 同用能力，避免 host await abort 在 shutdown 前卡住。
- command monitor 新增 backend-only 可选 actual execution，观察截止／同步 source stop 仍维持原 stream/buffer/批次语义。pending 不刷新、显式 stop 不发尾批，logs 保留。
- 关闭/stop/UI/exit callback 逐项隔离，actual drain 最多 2 秒；运行日志、结果关联与原 bash timeout/通知 latches 不改。离线 actual backend 与 SDK runtime seam 覆盖 new/resume/fork/import/reload/quit/cancel/invalidcwd，不运行模型、SDK 改动或真实 pi reload。

### 阶段 3A 同步启动重入修复

- `add()`／sidebar 的同步订阅或 UI callback 可以在 monitor 源尚未创建／接线尚未返回时关闭 activation。工具发布后与直接 `startMonitorSession` 调用均检查 closed／terminal／map identity；session 返回 `"started" | "cancelled"`，旧工具取消时不报告“已启动”。初始静默通知的发送回调也可同步 shutdown，末次决定后再次检查 closed／identity；正常即时 deadline 保持已启动收尾，不仅因 terminal 就回报启动失败。

## 共享 Task Panel 核心切片

- 删除原 `ui.ts` 与私有进程panel所有权；composition／直接factory的局部fixture使用 `task-ui/owner.ts`，以同一coordinator读取进程及agent/workflowsource。进程注册表不再保存closePanel/panelOpen或共享footer状态。
- `registry.renderSidebar` 现在只发布source变化及维持前台handoff hint计时，不再写竞争的 `background-jobs` 底栏。foreground hint与实际进程/monitor清理、日志、通知和sweep语义保留。
- 旧UI写入失败／同步关闭测试迁到实际registry发布和启动接线边界，仍断言source/socket/fd只关闭一次、已停止元数据/计数保留、迟到日志不增长、无重复通知、hook/controller/timer清空。实际hostloader保留根/child工具/命令/ALS断言，并明确旧widget的tool_execution_start监听不存在。
- shared panel按TaskIdentity即时detail/stop，包含前台/后台/pending和短暂终态；查看/关闭不改变执行，panel的后台键解除两后端所有wait。selectedsnapshot与wholegroupretention归UI，不消费backend结果。
- 后续用户授权独立installedPi CLI、140x40PTY与temporaryHOME/config/cwd的真实交互冒烟：19项分段PASS，actualshell/monitor进程、fauxscriptedactualagent session、本地childtool和workflowworker，验证Down/查看/解除等待/x/new/quit；最后CLI自然退出，日志保留。首两轮临时label/选行预期错误如实记录，不据driverexit0冒称全部PASS；没有修改产品来迁就预期、没有个人安装/配置/在线模型。
- 主会话strict/full466/466、三模块444/444无forceexit自然退出，日志 `/tmp/pi-bg/b0dk3e0hq.log`；之后核心window/Down增量最终483/461通过。集中审查与窄修已关闭原finding，当前核心PTY已验，前文旧panel/sidebar或Down待验描述为历史偏离记录。
- source stop 的 once closure 由 monitor session 持有，不依赖可能被 terminal 清掉的 `job.stop`。共享 `startBackgroundJob` 的已取消分支先调用 source hook，再保证 actual execution.stop 和清理；返回已 abort 的 controller 时立即执行静默接线，不等待不会再次触发的 listener。正常批次／wake／decoder 不改。
- 真正非终态 setup exception 仍撤销 started admission；shutdown 已计入的 stopped metadata／统计保留，日志不删。实际工具／session／WS source（仅 socket transport fake）的重入回归和 terminal throwing-stop 测试覆盖此差异；原 fake command source rollback 的一次 group TERM 断言未弱化。全后端 G3 仍待 3B 与主会话核验。
