# Testing Guidelines

## Commands and SDK Setup

[package.json](../../../package.json) owns the commands:

```sh
pnpm install       # Checkout dependencies; not a validation step
pnpm link-sdk      # Rebuild SDK links after install or a pi update
pnpm typecheck     # link SDK, then tsc -p tsconfig.json
pnpm test          # link SDK, then node --test over extension/script tests
pnpm check         # typecheck + test; required before proposing a commit
```

[tsconfig.json](../../../tsconfig.json) uses strict, `noEmit`, type-only import enforcement and switch fallthrough checks, rooted at `extensions/**/*.ts` (including tests). Imported dependency `.ts` sources can also join the program; `.mjs` scripts are not typechecked. No build or separate lint command is currently defined. Do not use `any`/`@ts-ignore` to hide errors; document unavoidable suppressions/casts.

[link-pi-sdk.mjs](../../../scripts/link-pi-sdk.mjs) finds the installed `@earendil-works/*` SDK and links into checkout `node_modules`. Candidates include `PI_SDK_DIR`, releases under `PI_CODING_AGENT_DIR` (default agent installation), and the resolved `PI_BIN`/PATH executable. It does not download SDKs or write user configuration, leaves real installed directories alone, and exits unsuccessfully if no SDK is found. Report that as an environment blocker; do not install a second SDK version just to silence checks.

## Test Placement and Isolation Policy

Use `node:test` and `node:assert/strict`, without a third-party test framework. Tests live in `extensions/<ext>/__tests__/*.test.ts`, the existing `extensions/__tests__/*.test.ts` for standalone entries, or `scripts/*.test.mjs`; the package test glob covers both extension layouts.

**Project policy:** tests must be offline and must not read/write real `~/.pi` configuration or execute a real pi install. Use temporary agent/config/log directories, fake SDK/CLI surfaces, and clean up processes/timers/files in hooks or `finally`. Real local shell-process tests are allowed if they are isolated and identify only their own processes.

Some existing extension-factory tests call the default config loader. For a full check, redirect that loader rather than assuming it is inherently isolated. On a machine with the usual SDK links, an example is:

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

The SDK path intentionally reads an existing installation; the temporary agent path isolates user configuration. If links are absent, provide the actual SDK directory explicitly. Inject `loadConfig(agentDir, {})` for loader unit tests; do not silently inherit personal environment overrides when asserting defaults.

## Vendor 源码运行回归

`extensions/agent-tasks/__tests__/source-loader.mjs` 仅用于 node:test：通过 Node 的内存 TypeScript transform 处理 vendor 的参数属性，范围限于 agent-tasks/src，不生成 dist、不修改 SDK。测试先 import hook，再动态 import 被测源；生产仍走 Pi jiti。

`loading.test.ts` 在临时 cwd/agent-dir通过实际 host loader加载唯一顶层 [task-composition.ts](../../../extensions/task-composition.ts)，检查单一工具集、保留 `runInChildSessionContext` named bridge、独立 beautify renderer、根/子 guard和shutdown；不启动真实 session/model。`workflow.test.ts` 跑真实 inline worker的无agent脚本、stub RPC与abort，使用不带 force-exit的定向命令验证自然退出：

```sh
node --test extensions/agent-tasks/__tests__/*.test.ts
```

完整检查继续使用真实 SDK路径及临时 agent目录。`.npmrc` 禁止pnpm自动装peers，TypeBox本地开发解析与host运行提供分开；不可为了测试安装第二套SDK或读取个人配置。

## Beautify 验证

[editor.test.ts](../../../extensions/beautify/__tests__/editor.test.ts) 使用实际 SDK setter/reset/editor 和自有 appearance，历史插件是独立离线 fixture，不依赖本机 input-history 安装。[tools.test.ts](../../../extensions/beautify/__tests__/tools.test.ts) 验证原生工具结果、真实 renderer/component、Shiki 与宽度；shell-collapse/retrieval/registered-agent 增加主题背景、同轮单行、原 renderer 隔离委托与实际注册检索信封。retrieval 另以实际 host 对照 default/self 的上下／左右 padding 和正文鼠标命中，检查 partial→final 不触发缓存结果的 original 回调、空／多行 description、safe integer 合计、throwing original 的可读参数／结果 fallback，以及实际 SDK runToolCall 的 details={} 错误降级。来源与范围见 [TESTING.md](../../../extensions/beautify/TESTING.md)。定向执行不加 force-exit：

```sh
node --test extensions/beautify/__tests__/*.test.ts
```

覆盖同实例 transient state、history/Down 两种顺序、禁用 Down、安全降级、部分安装失败回滚、后来 wrapper/padding/factory 所有权、reset-before-shutdown 和真实 GC；验证 Read offset/notice、async stale、图片单次、Bash 后台 handle、grep literal/context，以及模型结果不被改写。局部移除行为后回归须失败。

真实 CLI/PTy 与实际 input-history 包另列验证，不以 fixture 推定终端/IME/任意插件兼容。SDK 极窄中文和聚焦光标异常必须对照记录，不能跳过后称为已修复。测试使用 Pi 1.2.0 实际 SDK 和临时配置目录，不安装第二 SDK，不访问个人配置。

## 有界 tmux 真实终端验收

适用于工具renderer/背景/键位/窗口变化任务；自动组件测试不能证明真实终端样式。用户明确授权后才运行，不访问个人认证/配置，不连接用户现有panes。

1. 使用唯一 `tmux -L <test-id>` 服务和临时配置、HOME、PI_CODING_AGENT_DIR、cwd、sessions/logs。`env -i` 提供必要PATH与终端变量；直接调用现有installed CLI并显式加载当前检出，禁用自动发现和在线请求。离线faux仅安排调用顺序，工具执行仍走真实CLI循环。
2. **先最小矩阵，再专项**：一个短Read成功、长标题Bash、错误返回、一个optional结果；验证收缩→真实Ctrl+O展开→收回、140/80/40列。目标是快速暴露问题，不先搭建完整agent/attach矩阵。模型/child专项不被需要时不运行。
3. 固定并记录主题。没有颜色应答时system可能无背景；dark结果不能代表system/light。用 `capture-pane -p -e` 保存文本屏幕及SGR；resize后必须等待原始CLI写流中完成的新宽度帧（完整border及帧结束），不能仅凭capture中的border长度判断，因为tmux可裁剪旧宽度画面。逐段验证整行背景连续，不能只搜索有无48m。标题省略后49m或0m也必须检查；hint空间不足应完整省略，不仅断言一行。
4. Ctrl+O用 `tmux send-keys ... C-o` 并用前后屏幕证实。SGR鼠标字节输入可验证实际CLI命中，但必须标为stdin模拟，不冒称物理鼠标/attached-client转发全链路。`/debug`不含所有overlay且不是截图；capture-pane文本也不是图片。
5. 每项记PASS/FAIL/NOT_RUN，同时审阅report.error、cases、exit code。driver捕获异常后exit0不代表通过；fixture问题与产品失败分开记录，不能改产品或预期迁就失败。
6. 等待使用有界条件循环/monitor，不用固定sleep等待。搭建或专项受阻时及时给状态，收敛最小证据，把剩余项标NOT_RUN，不持续扩建harness。
7. finally发送自身/quit，确认CLI及自有child真实退出；必要时只TERM/KILL测试PID/group，停止自己的唯一tmux服务，删除临时config。禁止不带-L的kill-server或触碰用户pane。保留有界证据到task research，检查无凭证。

已跑通参考：[tmux-validation](../../tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/research/tmux-validation.md)及其tmux-harness脚本（仅测试材料，不是产品入口）。本轮验证发现自动测试遗漏的背景reset；最初残缺hint经raw frame复核属于tmux裁剪旧帧的夹具误判，等待真实resize frame后通过。流程有效不代表所有矩阵通过；定向复验见[terminal-fix-report](../../tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/research/terminal-fix-report.md)。复用先读报告的夹具失败和启动命令，不盲跑全量driver。

## @ 路径连续补全验证

`node --test extensions/at-path-completion/__tests__/*.test.ts` 使用实际已安装SDK和临时agent目录，不加force-exit。覆盖实际Editor/CustomEditor/host setter/reset、无列表slash与目录接受续提示、唯一项只展示、Enter不误提交、Escape/后续键/鼠标/失焦/overlay/文本替换/关闭的迟到请求；保native Copy、普通Tab和非@ trigger。后装delegating setter只接收一次provider转换，nondelegating替换不回写旧链；GC检查退役wrapper不保editor/screen。native provider仅临时目录，`~/`使用隔离子进程HOME，不扫描个人目录，fd缺失不下载。

原生行为红测须证明两个触发缺口，增强断言另外保留；actual host loader防Node-only子路径import。internal接口存在不证明升级兼容；实际PTY/IME/input-history原包验收与离线fixture分开报告。真实终端：另已通过用户授权的隔离tmux、installedCLI dark/fullscreen固定140/80/40列最小路径交互矩阵，原生fd候选与公开观察probe，目录Enter无提交／唯一子项不自动接受。固定宽启动不代表动态resize，capture文本不是图片；两次夹具FAIL保留，修等待和可见项断言后通过。物理IME、实际input-history原包、regular/其他主题仍NOT_RUN。详见 [TESTING.md](../../../extensions/at-path-completion/TESTING.md) 与 [扩展契约](./extension-guidelines.md#-路径连续补全契约)。

## Representative Regression Evidence

| Test | Contract to preserve |
| --- | --- |
| [pi-manifest.test.mjs](../../../scripts/pi-manifest.test.mjs) | Every top-level extension declared; no nested module/test entry; resource-type declarations |
| [sync.test.mjs](../../../scripts/sync.test.mjs) | Fake pi + temporary agent state, four domains, protected leaves/files and stateful `--dev` switches without real installs/network |
| [config.test.ts](../../../extensions/process-tasks/__tests__/config.test.ts) | Fresh config directories, explicit environment input, precedence/warnings/defaults |
| [shortcuts.test.ts](../../../extensions/task-ui/__tests__/shortcuts.test.ts) | Exactly two defaults, remapping/unbinding, SDK rejection does not starve other bindings |
| [index.test.ts](../../../extensions/process-tasks/__tests__/index.test.ts), [lifecycle.test.ts](../../../extensions/process-tasks/__tests__/lifecycle.test.ts) | Empty session replacement, shutdown cleanup and idempotent terminal transitions |
| [panel.test.ts](../../../extensions/task-ui/__tests__/panel.test.ts) | Shared source/identity tree, immediate bounded details, scoped stop, final snapshot, safe widths, owner/overlay cleanup; mixed-waits adds actual two-backend interaction |
| [blocked-signal.test.ts](../../../extensions/__tests__/blocked-signal.test.ts) | Fake events and host sinks, shutdown release, late notification IDs, host gates/failure isolation |

Test observable outcomes, not copied implementation constants alone: assert mock action order, final JSON, rendered bounds, emitted messages and resource disposal. When updating a regression, check that reverting the behavior would make it fail. Do not run install/sync against personal state as a substitute for these tests.

## 共享核心与进程接入回归

```sh
node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts
```

同样使用实际 `PI_SDK_DIR` 和临时 `PI_CODING_AGENT_DIR`，不带 force-exit。`mixed-waits.test.ts` 使用同一个实际 coordinator、真实本地 shell 与 actual AgentManager/typed fake runner，断言四个 launch/retrieval lease 一次 detach，PID/session/run ID 不变、旧父信号失效、结果未消费和输出连续。`coordinator.test.ts` 执行实际 lease，`waits.test.ts` 执行实际 bash/jobs/source（隔离进程及可控退出），断言早期 detach、already-aborted retrieval、多 wait 抑制、completion/detach 同 tick、父信号解绑、fg 终态日志保留和计数。`ui.test.ts` 当前只验证过渡进程面板，不当作最终分组 UI／真实 TUI 的完成证据。

## Agent 等待与读模型离线回归

`node --test extensions/agent-tasks/__tests__/*.test.ts` 不带 force-exit。新增 `backend-waits.test.ts` 执行实际 AgentManager/source/coordinator（只注入 typed fake run/resume/worktree delays），`tool-waits.test.ts` 执行实际 factory/tool/通知闭包；fixture 使用临时配置、fake SDK sink、自己生成的 transcript 清理，不运行模型、git 或网络。覆盖 pool queued/running transfer、startup 成败、detach 后 Esc、true Esc、resume 同 session 新 run、多 retrieval/startup waits、completion/cancel 同 tick、冻结有界详情、实际 sweep owner retention、group delivery/run revision 及真实 host/worker stopped child 不 auto-retry。source-loader/child guard hard assertions 不得被 mock/string-grep 替换。


### 实际 runner 启动 seam 与故障回归

`runner-cancellation.test.ts` 通过局部 typed `AgentRunnerDependencies` 替换 env/loader/create 三项昂贵输入，执行真实 runner 的 awaited startup、bind、signal forwarding、prompt／structured retry 与订阅清理；不全局 mock SDK、不启动模型/git/网络、不生成 build。必须断言取消后 prompt 次数为 0、partial shutdown/dispose 各一次、正常与 parent detach 仍运行、resume 已取消和 setup 失败不遗留监听。

已注册 Agent 工具回归使用临时 artifact leaf 的 ENOTDIR（普通文件替代目录，避免 chmod 在 elevated user 下失效），覆盖 background new／resume 的 setup rollback、queued stream 错误、原异常、controller／queue／pool 清理和文件保留。完成通知测试使用不同 new/resume call ID（含 undefined）、等待 nudge 延迟后检查 finite turnCount/maxTurns 及 group others／consumed filtering。复核时局部恢复取消守卫、rollback、关联赋值、终态统计读取任一缺陷，测试均应失败；恢复代码后重新跑实际完整检查，不把反向失败计为通过。


## Activation 生命周期与实际 host seam

新增定向自然退出命令（同样提供真实 SDK 路径与临时 `PI_CODING_AGENT_DIR`）：

```sh
node --test extensions/task-ui/__tests__/{lifecycle,sdk-runtime}.test.ts extensions/process-tasks/__tests__/activation.test.ts
```

`process-harness.ts` 是 scoped backend fixture：实际注册工具/source/participant，只在 SDK host context/generic tool 边界解释 cast；不进生产、不复制执行。`activation.test.ts` 使用真实本地 child 验证忽略 TERM 的 fg/bg/monitor 有界退出、TERM-killed leader 的忽略 TERM 后代、pending pid0、attach/timer、throwing UI/stop hook、late actual exit、新 registry 计数/通知不串、WS fake transport 的 late frames、磁盘日志保留。不能拿 terminal `donePromise` 冒充 OS 已退出。

`sdk-runtime.test.ts` 执行实际 SDK `AgentSessionRuntime` new/resume/fork/import/quit 的方法，typed partial session/services 只替换昂贵服务；before-switch cancel、invalid cwd 不走 shutdown 时旧工具仍可执行。reload 调用实际 `AgentSession.prototype.reload`，只 stub 其资源输入和 `_buildRuntime` 创建 seam，不复制 host lifecycle/setter。无模型／网络／真实 pi reload／个人配置写入／SDK 修改。已有 hard root/child loader、worker、mixed-waits 必须继续运行，不能用本 harness 替代。当前 host seam 已同时注入 process/agent 到统一 protocol；clone/scheduler/worker 另以3B2 actual路径矩阵验证，不将SDK生命周期stub视作这些执行全部退出的证明。

monitor 同步启动重入可定向自然退出检查：

```sh
node --test extensions/process-tasks/__tests__/{activation,monitor-session,lifecycle,monitor}.test.ts
```

同样使用真实 SDK 和临时 agent-dir。新增回归必须先在未修复实现上运行失败，再修复：实际 add/source/UI 回调同步 shutdown（仅 fake WS transport），不得以复制启动状态机或 string-grep 替代。断言 cancelled 结果、socket/fd once、保留日志迟到 frame 不增长、执行 map／controller／wait／hooks 清空与无 timeout、started/terminal 计数一致；terminal source stop 抛错仍实际 stop 清理。保留原 monitor fake source group TERM 与正常批次 hard assertions。当前检查仍不替代 3B 全后端 G3 和真实 TUI。


## Agent 实际执行与 artifact 安全（3B1）

```sh
node --test extensions/agent-tasks/__tests__/{runner-cancellation,worktree-lifecycle}.test.ts
```

按前述临时 agent-dir／只读 SDK 路径运行，无 force-exit。actual manager+runner typed seam 覆盖 stopped terminal 先结束而 actual new/resume prompt 未退出、已 seal 的 late create/bind 只 local close、同步 onStart 关闭不再接 output/prompt、queue/nested、throwing observer/subscription/output 清理以及非协作 runner dispose 有界后保留私有 owner。fake pi.exec + 临时文件跑真实 create/cleanup，检查 exec signal、partial add 路径、迟到 runner 不 launch、cleanup await cancel 不 stage/commit/remove、保存失败/已生成 branch/active artifact 不被强删。不得运行真实 git、模型或写 SDK。完整 agent／三模块自然退出和 pnpm check 仍必须运行；production participant、clone/scheduler/workflow 的矩阵属 3B2，不将 backend 测试当 G3 全验收。


3B1 复核新增实际 extension-owned interval：bind 启动，仅 child session_shutdown hook stop，core dispose 不释放。断言 retained completed child 经 freeze/stopForShutdown/drain 在phase结束前 hook1/resource0、direct dispose同样释放、completed parent＋running nested child一起清理、throwing hook不挡sibling、direct budget timeout late create hook0/local dispose1并保留文件。另测试 hasHandlers中撤销permit必须阻止紧随的emit。先在旧实现跑两个completed/direct回归0/2，再修复；不可把coreDispose1或terminalresolved写成资源关闭证明。


## 实际 CLI/PTY 核心冒烟

用户明确授权后可在临时HOME/agentconfig/cwd/sessions用installedCLI直接加载本检出，不走install/reload现有会话。当前已运行140x40PTY核心冒烟：真实render/keydown、shell/monitorOS进程、fauxscriptedactualagent会话/本地bash、实际workflowworker、新会话关闭和自然quit。fakeprovider不是在线模型/自主执行质量。必须同时核report.error/cases/screens/events和exitstatus，drivercatcherror也可能exit0；19分段PASS与两次fixture标签/选行预期中断均如实记录，不能宣称一轮完整全矩阵。finally实际临时PID清理，个人配置/安装不写。自动测试仍是回归门，不被烟测取代。

## Down actual host/editor 回归

`node --test extensions/task-ui/__tests__/{editor,config,panel}.test.ts extensions/agent-tasks/__tests__/loading.test.ts`，隔离agentdir、只读installedSDK。editor-host.mjs动态加载actualInteractiveMode.setter/ui context和真实CustomEditor/TuiMainScreen/Beautify，不复制host接线。editor测试验证firstsame-instanceinstall保cursor/draft/undo/historybrowse/paste/emptyTabautocomplete；真实focus/overlaydispatch/release/repeat/no tasks和fg-only；appactions/nativeextensionshortcut/submitchange、laterfactory/instancewrapper顺序、关闭退役不资源保留。失败安装要断言实际container仍挂载、render非空、focus/factory/cursor和继续编辑保持，不以sameidentity/methodrestored冒充UIrollback；unsupportedaccessor/nonconfiginput和安装时已有overlay都必须覆盖。GC子进程--expose-gc只验证ctx/TUI/coordinator/panel四项WeakRef回收，opaque包装必须独立函数环境以免fixture自身保资源；不能跳过GC或把unref当释放。完整input-history原包所有加载顺序/任意futureeditor兼容和真实terminal尚不能由等价fixture宣称覆盖。

## 共享核心面板窗口回归

`backend-waits.test.ts` 的 fresh panel用例通过真实spawnAndWait消费child、actualdrain、workflow终态设置、managercleanup和新TaskPanel，检查group结束后0/3999ms仍完整、4000ms恢复sweep资格；fakeDate只推进时间，不复制retention算法。先旧实现1pass2fail，再窄修sourceownerretention。已有面板缓存用例不能替代freshpanel保证。

## Agent participant 辅助执行回归（3B2）

`node --test extensions/agent-tasks/__tests__/{auxiliary-lifecycle,tool-waits,workflow}.test.ts extensions/task-ui/__tests__/sdk-runtime.test.ts`，按上文临时 agent-dir/实际SDK，无 force-exit。actual clone 的 loader/create typed seam 不替换整个 clone；真实 temp ScheduleStore + captured timer callbacks 覆盖 interval/once/cron 与 late startup/finalize；实际 RPC callback、busy/paused worker、host pi.exec signal/late result、CLI workflow、保留 child extension interval和 old tools/input 保留。sdk-runtime 同时注入真实 process/agent 到一个 protocol，驱动实际 new/resume/fork/import/quit/reload；hard loader 的 root/child ALS 和 mixed-waits/monitor 全部断言继续执行。初始行为红证据至少覆盖 retained result tool 与 worker abort 后 late gate，fixture API/grammar 错误另记不冒充产品失败。定向绿色不替代 full strict/full tests/三模块 natural exit，不声明非协作 provider all-stop 或真实 TUI 已通过。

## Monitor 会话级通知调度回归

```sh
node --test extensions/process-tasks/__tests__/{monitor-notifications,monitor-session,monitor-buffer,monitor,config,index,activation,waits,monitor-setup-result}.test.ts
```

同样使用实际 SDK 和临时 agent-dir，不加 force-exit。monitor-notifications 直接执行 registry 拥有的真实调度器（fake clock/host sink）；session 执行两源，index factory 执行真实本地 command 与 fake WS transport，校验一次投递、共享节奏、及时竞争、自然 terminal abort、attach/retrieval、发送重入、公平预算、正文/details裁剪一致、epoch reset 和安全 renderer。必须覆盖决策订阅中 session_start fallback 同步 reset 后启动新源，以及 sendMessage 回调 reset 后 enqueue：旧快照不 commit，新 epoch 不因 flushing 守卫遗漏 timer；unknown 异常也须包含无法字符串化及抛错inspect.custom的对象，不mock掉console.error掩盖原对象检查；通过实际 command session 验证不变成源失败。短命令在200ms内退出可把首批折进终态，不要求额外 progress 消息。保留 F=0 的原同步启动重入断言，不用修改源 decoder 或放宽 OS 清理断言适应通知延迟。

硬容量回归必须运行 `monitor-notifications.test.ts` 与 `index.test.ts`：1500个终态及actual factory每批350个（并发上限1），同时测UTF-8 JSON正文/details≤64KiB、一次发送、全量manifest ID/log/summary、跨registry/session独占、partial-write/失败cleanup/fd0与listener继续。清单测试写临时logDir；builtin fs seam只在测试中scoped mock并用syncBuiltinESMExports恢复，不改SDK/生产依赖。容量红证据应局部禁用wire bound/manifest后实际两个测试失败，再立即恢复；无force-exit完整自然退出仍是资源门禁。临界普通batch须先精确计量，不应预留overflow提示而误判；实际message/options信封与content/details63KiB同时断言。JSONL测试覆盖跨字符串块的pair／孤立surrogate、0短写、close前后异常及NUL配置路径／失败终态显式retrieval重查。
