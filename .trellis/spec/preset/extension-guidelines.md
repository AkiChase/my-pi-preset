# Extension Guidelines

## Explicit Entries and Single Ownership

[package.json](../../../package.json) declares `"pi": { "extensions": ["extensions/*.ts"] }`. This glob loads every top-level `.ts`, not nested directories. Keep helper modules and tests nested; a new top-level helper would become an extension entry. Declare any future shipped skills/prompts/themes explicitly in `pi`; declaration disables their convention discovery too.

[pi-manifest.test.mjs](../../../scripts/pi-manifest.test.mjs) asserts complete top-level coverage, no nested entries and resource declarations. Do not remove it or replace the glob with recursive discovery: that would load nested vendor entry points twice.

[bash-unified.ts](../../../extensions/bash-unified.ts) 拥有每次 factory activation 的唯一 `TaskLifecycle`、coordinator 与共享 UI owner。关闭顺序是所有 participant 同步 `freeze()`（admission 与通知）→ close hooks → cancelWaits → silent `stop()` → 最多 2 秒 `drain()` → source/coordinator `dispose()`；异常逐项隔离，shutdown 返回稳定幂等 promise。process 和 agent 都已接入，完整验收仍须实际测试与独立审查。

```ts
// Existing SDK-derived type; do not invent a parallel tool interface.
type ToolDef = Parameters<ExtensionAPI["registerTool"]>[0];
```

Its proxy captures process-tasks' `bash`, forwards other registrations with the original receiver, fails if capture is missing, then injects the captured definition into pretty. Only one final `bash` is registered. Preserve this ownership; do not also install pretty or patty as standalone pi packages ([manifest conflicts](../../../pi-preset.json)). Pretty's deep source import follows its pi entry, not a potentially stale `dist` build; revisit that boundary if its exports change.

## Pretty 编辑器组合

[bash-unified.ts](../../../extensions/bash-unified.ts) 通过 [pretty-compat/editor.ts](../../../extensions/pretty-compat/editor.ts) 局部适配 Pretty 的 start/shutdown editor factory，不全局劫持其他插件。已有 factory 时在其创建的原实例上装饰，保留 history、receiver 和 subclass 行为；没有 factory 时沿用 Pretty editor。仅注入已有 constructor 仍会新建实例，不能解决历史丢失。

- 不读取私有 history、不改原型链、不复制 Pretty 渲染算法；RenderBridge 复用运行时 `createPromptEditorClass`。
- 装饰前检查 embedded status、border hooks 与可写 data methods。不支持时保留原编辑器并可诊断降级，不能破坏输入区。
- 方法写入及 host setter 都可能部分成功后失败；回滚经正常 setter 恢复 factory/container/focus，原 factory 失效时尝试默认 editor。
- 方法与 padding 状态恢复均须检查所有权，不覆盖后来插件。每 slot 只保留一个 live lease，退休 factory 释放 builder 并透传。
- Pi reload 在 shutdown 前 reset UI；清理不能重新安装旧 factory。回归见 [editor.test.ts](../../../extensions/pretty-compat/__tests__/editor.test.ts)，版本与验证边界见 [TESTING.md](../../../extensions/pretty-compat/TESTING.md)。

## SDK Types and Configuration

- Use SDK types and `import type` for type-only imports; preserve strict/noEmit checking. Do not mask problems with `any` or `@ts-ignore`; explain any unavoidable suppression or boundary cast.
- Example of a justified cast: [controls.ts](../../../extensions/task-ui/controls.ts) hands configured chords to SDK registration and catches rejection, rather than duplicating the SDK key table. One invalid chord must not prevent other bindings.
- Built-in action IDs in `keybindings.json` and extension raw shortcut chords are different surfaces. task-ui's current defaults are exactly `ctrl+shift+b` and `shift+down`, asserted by [shortcuts.test.ts](../../../extensions/task-ui/__tests__/shortcuts.test.ts); no blind kill-latest shortcut exists.
- [config.ts](../../../extensions/process-tasks/config.ts) resolves file/environment input at load time and stores config on each registry. Reuse `DEFAULTS`, `envNameFor` and parser bounds; do not add an import-time mutable singleton. Malformed input warns/falls back, while registration uses resolved values. [config.test.ts](../../../extensions/process-tasks/__tests__/config.test.ts) covers defaults, malformed input and precedence.

## Session and Resource Ownership

Pi 1.1.0 的 new/resume/fork/import 在旧主会话 abort 后 shutdown，再建立新 factory；reload 也重新激活。before-switch 可取消或因 cwd 无效而无 shutdown，不能永久 freeze/dispose 当前 activation；旧 disposed factory 不复活，不引入 global mutable UI/coordinator。`process-tasks/index.ts` 在最终关闭后拒绝旧工具新执行，释放 foreground/pending/background/monitor/attach/ticker/sweep，保留磁盘日志；新 factory 从空 source 开始。证据见 [activation.test.ts](../../../extensions/process-tasks/__tests__/activation.test.ts)、[sdk-runtime.test.ts](../../../extensions/task-ui/__tests__/sdk-runtime.test.ts)。

Use [lifecycle.ts](../../../extensions/process-tasks/lifecycle.ts) for terminal transitions and cancellation, not tool-local copies. `markTerminal` is idempotent, freezes `endedAt` and releases runtime hooks; `completeJob` checks terminal state before notifying. This prevents a late exit after silent termination from notifying the new session. Retention belongs to [registry.ts](../../../extensions/process-tasks/registry.ts), not notification delivery or rendering.

Optional host effects must be gated and isolated. [blocked-signal.ts](../../../extensions/blocked-signal.ts) pairs prompt block/release, releases on shutdown, suppresses duplicate host notifications and bounds CLI calls. Its [tests](../../../extensions/__tests__/blocked-signal.test.ts) use fake SDK events/sinks, including late notification IDs and sink failure.

## Monitor 事件与停止

修改 monitor 或共享任务面板的执行接入时，另读 [Monitor 契约](./monitor-contract.md)。源回调先于启动接线，stdout/stderr 默认合并但独立解析完整行；时间／缓冲归 session，面板只调用共享停止能力。absent/resumed 不变更 Job 运行状态或消费结果标记，不把实时进度再次回读成失败尾部。该文档记录接口、错误矩阵和必须保留的离线断言。

## Safe Terminal Rendering

Follow [TaskPanel](../../../extensions/task-ui/panel.ts): strip external terminal controls before SDK styling, bound source reads to 16K and show omitted ranges. Size with SDK `visibleWidth`/`truncateToWidth`, not string length; SDK-owned SGR resets are valid output, not external control leakage. [owner.ts](../../../extensions/task-ui/owner.ts) owns one overlay, closes before shared wait disposal, and releases subscriptions/timers even during synchronous host reentry. [panel.test.ts](../../../extensions/task-ui/__tests__/panel.test.ts) covers widths, instant detail, groups, retained snapshots and owner cleanup. The panel may hold immutable metadata and one bounded final preview, never runtime hooks or mutable records.

[status-bar.ts](../../../extensions/status-bar.ts) also uses display-column widths and returns its unsubscribe as `dispose`. New widgets must identify their cleanup owner; `unref()` alone is not disposal. Avoid unbounded full-log rendering, nested replacement dialogs and global listeners that outlive the interaction.

## 共享等待与阶段接入边界

- [bash-unified.ts](../../../extensions/bash-unified.ts) 创建唯一 `TaskCoordinator`，向 process factory 和 agent factory 的 typed options 传入同一个实例；不能用 global UI singleton 或在生产 backend 中再创建实例。直接 process factory 的离线 fixture 可省略 options，由其创建局部实例及共享 controls。
- [types.ts](../../../extensions/task-ui/types.ts) 定义 namespaced `TaskIdentity`、`TaskView`、`TaskSource` 和有限 detail/stop 能力。adapter 复制冻结读模型，不向 UI 返回 mutable Job、promise、controller 或 session。订阅／revision 覆盖后台状态及 waitCount；wait 与 executionMode 分开。
- coordinator 的 launch/retrieval lease 仅完成、detach、interruption、dispose 中一个胜出，先移除父 signal listener；`onComplete` 在释放抑制前消费结果。`onDetach`／`onInterrupt` 仅 launch 调用，retrieval 不停止执行。`cleanup` 幂等；共享 `/bg` 对所有 lease 操作但不调用 `ctx.abort`。
- 前台 bash 首次 await 前注册 lease，显式 detach 不等两秒 UI 窗口；backend 保持 exit 归属、terminal metadata 和 log，不 finally unlink。计数包含前台，promotion 不重复 started。
- retrieval 各自减少 attachCount，取消后重查 terminal 未消费结果；monitor 只保留已构造的有界终态 payload用于重查，显式 stop 不 flush pending。回归见 [waits.test.ts](../../../extensions/process-tasks/__tests__/waits.test.ts)、[monitor-session.test.ts](../../../extensions/process-tasks/__tests__/monitor-session.test.ts)。
- 普通 input 不参与协调，不 detach／abort／resubmit；agent mentions 仍属 agent backend。`/tasks` 与 Shift+Down 打开共享双栏面板，coordinator 只按 identity 路由 finite detail/stop，拒绝旧 run 或 closed activation。分类底栏只计算真实顶层工作，包含前台-only；旧 AgentWidget/FleetView 及其配置/监听已删除，不保留 no-op 兼容壳。裸 Down 使用 [editor.ts](../../../extensions/task-ui/editor.ts) 的实例handleInput装饰，`downOpener` 默认true，false不安装。只有严格空文本、真实focused/getFocusedComponent、nooverlay/noautocomplete、press非repeat、有freshmodel可查看task且无面板时处理，其余委托原receiver；无globalrawlistener。

## 编辑器本地 Down 所有权

Pi1.1.0的publicEditor.isShowingAutocomplete与TUI.getFocusedComponent/hasOverlay可用，不读取privateeditingstate。初次安装先用publicui.custom的同步完成、不挂载probe获得realTUI，在destructivehostsetter之前完成focusedliveeditor检查与publicdescriptor预检。已有overlay时不done以免SDKhide其他overlay，unsupportedaccessor/nonconfigmethod失败不调用setter，不卸载原UI。随后factory仅返回原liveeditor；host对同一instance仍会setText并重复接线，preserveHandoff仅在同步交接期间暂时屏蔽publicsetters/callback/actionMap，finally恢复仍owned属性。不能再次newEditor并以copytext声称保undo/history/paste。后续factorycall正常delegatepredecessor，实例lease用WeakSet防叠加；不支持安全装饰的editor应diagnose并保留原可用UI。

关闭先清cell.resources/access、screen/target，再恢复自己仍ownedmethod；lateropaquewrapper保持inactiveforwarder，不通过hostsetter重建丢state。capturedwrapper必须不保旧ctx/TUI/coordinator/panel；测试opaque包装在独立module-scope创建，不能让fixture本身共享create环境保这些资源。独立未来不delegate原factory的editor不自动继承Down，显式入口仍可用。无globalrawinputs，actualSDKsetter/TUI分发/Pretty顺序自动测试已通过；另有用户授权的隔离installedCLI140x40PTY核心冒烟，不覆盖任意插件/尺寸或在线模型自主质量。

## 子代理轮次预算接口

### 1. 范围
模型不得猜测委派的轮次预算；主／嵌套 `Agent` 删除 `max_turns`，用户配置和可信程序入口仍支持限制。

### 2. 签名
模型 schema 不含 `max_turns`；`resolveAgentInvocationConfig` 只从 agent 配置读取上限。可信 manager/RPC 的 `maxTurns` 与 scheduler 的 `max_turns` 保留。

### 3. 契约
旧模型参数忽略，模型 schedule 不保存预算，触发时读用户配置。每个 run 在 admission 解析一次有效值；record、invocation、activity 和 source 使用同一上限。manager → runner 以 `0` 显式冻结无限制，不能传 `undefined` 让异步 bind 后重读默认值；resume 同样处理。

### 4. 输入矩阵
未配置／用户 `0` → 无限；全局有限 → 该次运行有限；frontmatter `0` → 覆盖全局；旧模型字段 → 无效；启动后配置变化 → 仅影响后续 run。不新增历史数据迁移或来源标记。

### 5. 示例
正常调用省略预算；用户通过 `agent-tasks.json`／agent 文件设置限制；可信 scheduler 保存显式预算属于程序接口。模型传 `max_turns: 1` 不得改变 execution 或 schedule。

### 6. 回归
[tool-waits.test.ts](../../../extensions/agent-tasks/__tests__/tool-waits.test.ts) 验证实际 schema／旧参数／通知；[backend-waits.test.ts](../../../extensions/agent-tasks/__tests__/backend-waits.test.ts) 验证嵌套及可信持久化／RPC；[runner-cancellation.test.ts](../../../extensions/agent-tasks/__tests__/runner-cancellation.test.ts) 用真实 runner 延迟 bind，覆盖有限→另一限额、无限→有限及 resume。

### 7. 错误与正确
错误：只删 schema，resolver 仍读模型参数；或 `maxTurns: record.maxTurns` 在无限制时变成 `undefined`。正确：删除模型解析／schedule 写入，并向 runner 传 `maxTurns: record.maxTurns ?? 0`，读模型继续以 undefined 表示无限。

### Agent backend 等待与 source 约束

- [agent-manager.ts](../../../extensions/agent-tasks/src/agent-manager.ts) 每次新建/resume 立即创建 namespaced terminal handle（queue/startup/failure 均有），resume 复用 session 但 runId 换代且旧执行未 settle 时拒绝重入。父 signal 只有一个 tracked link；detach 同步注销并转移当前 admission pool，完成幂等释放当前 lease，不由 `isBackground` 临时推断旧 acquire。
- [waits.ts](../../../extensions/agent-tasks/src/waits.ts) 沿用注入 coordinator：launch 赢得 detach/interrupt 才转移/停止，retrieval 不停止；completion callback 在 wait 抑制释放前消费。后台通知用独立 consumed/delivered latch，held individual/group delivery 重查当前 record/runId 与 waitCount，所有 terminal group members 都须关闭组。
- [source.ts](../../../extensions/agent-tasks/src/source.ts) 暴露冻结读模型（含 owned children 与 no-session queue/startup），只订阅 manager lifecycle/activity/metadata 与 `subscribeWaits`，不订阅 general coordinator 再回发 source 变化。详情每次最多 16K transcript bytes，memory/log preview明确省略；inspect 不消费。真实 parent run 与 workflow owner 不能改成顶层 flat row，active owner children 和未消费结果不可提前 sweep。workflow终态后ownerretention继续覆盖共享四秒窗口，保证sweep后新打开的panel仍看到完整组；窗口外恢复原回收资格，不保超期controller。
- Agent tool finally 只结束 inline timer，不删除 detach 后仍运行的 activity/transcript；可选 UI sink 失败不得挡住强制 controller/lease 清理或已消费结果返回。完整 epoch 隔离由统一 lifecycle owner 控制，先冻结再 stop/drain/seal。回归见 [backend-waits.test.ts](../../../extensions/agent-tasks/__tests__/backend-waits.test.ts)、[tool-waits.test.ts](../../../extensions/agent-tasks/__tests__/tool-waits.test.ts)。


### Agent 启动取消与完成数据复核

- manager 的 parent detach 和 runner 的 backend cancellation 分层：`runAgent` 必须在 env/reload/create/bind 的 await 后和 prompt 前检查已取消状态；只补 `session.abort()` listener 而继续无条件 prompt 无效。partial session teardown 由 runner 与 manager 共用幂等 owner；`starting` 到真实 session ready 才清除，不在调用 async runner 前清除。
- 后台 launch 返回 ID 前的 transcript 初始化是强制 setup：失败先 disarm 未返回 run 的通知资格并停止执行，再原样抛错，不能先加入 batch/activity。resume preflight 失败未创建 run，不能清掉上一 run 尚未交付的通知；返回后的 queued stream 失败是该 run 的正常失败结果，仍释放 controller/admission。
- 通知关联和有限终态统计保存在每 run record／snapshot；foreground new/resume 必须设置当前 toolCallId，无 ID 清旧值。延迟 individual/group 不从已删除的 activity map 读 turnCount/maxTurns，也不能为了通知保留 session runtime。回归见实际 [runner-cancellation.test.ts](../../../extensions/agent-tasks/__tests__/runner-cancellation.test.ts) 与已注册工具 [tool-waits.test.ts](../../../extensions/agent-tasks/__tests__/tool-waits.test.ts)。

- 已关闭的部分 startup session 必须从匹配 backend record 清除 session/sessionFile，不能让 resume 接受 disposed 实例；真正 prompt failure 的 live session 则保留。resume runner 的可选 aborted/steered 必须传到 manager terminal，优先级与新建相同（外部 stopped 优先），workflow host 继续用真实 status 判定成功，不以已执行 abort 副作用代替结果状态。


### Process 实际执行清理

`spawn.ts` 的 `OwnedExecution.done` 是真实 OS child exit；`BackgroundRegistry.executions` 仅在后端存储，与 `Job.donePromise` 的提前终态分离。shell/命令 monitor 共用 identity-scoped TERM→250ms KILL；真正 exit 清升级 timer，normal exit 后不再 signal，停止中的 leader exit 只补杀仍存在的 group，不向已退出 PID fallback。pid 0 的 pending/WS 不发 OS signal。`MonitorSource.execution` 是可选后端控制能力，不加入 TaskView/detail；命令 source 的同步 observation stop 和真实 OS exit 分开，silent stop 不 flush pending，不改 decoding/batching/deadline。自然完成通知和 bash 超时规则保持。


### Agent 实际执行关闭（3B1 backend，3B2 已接入并审查通过）

`AgentManager.freezeAdmission()` 同步关闭 admission、read observers/可选执行 callbacks 和 cleanup git signal；`abortAll()` 解除 terminal、关闭 output，取消 nested/queued/partial/running session，当前 pool lease 只释放一次。`drainExecution()` 等待私有实际 startup/new/resume/output/worktree/session stop/close promise，不按 status 或 terminal 判断实际结束；没有内置超时，供 composition protocol 有界 await。`dispose()` 稳定幂等、单独调用也先 freeze/stop，最多 2 秒后清公开 map/source observers，不能清掉唯一迟到清理 owner。生产 participant 已在3B2接入，后续完整核心切片的独立审查及定向修复已闭合G3，按修订后的PRD AC9协作式取消边界验收；测试仍不得声称强杀任意第三方代码。

runner 的 `onSessionOwned` 是 create 返回、bind 前的 cleanup-only callback，不是 UI ready；迟到 session 可 stop/local dispose，不调用旧 `onSessionCreated`/prompt/steer。manager 的 host-valid `stopForShutdown`／drain 和单独 dispose budget 内必须关闭包括 completed/retained 在内的 child hooks；protocol final dispose 前调用 `sealHostEffects`，已经开始的 hook 仍由原有限 owner 收尾；不得在 protocol 超时后使用旧 pi 启动 git/notification。非协作 provider 无法强制停止进程内 promise；保留 owner、关闭自身订阅/效果并报告限制，不把超时写成“全部关闭”。真实 prompt failure 仍保留 live session 供 resume，closed partial reference 清除，parent detach/硬限额/终态优先级不变。

worktree creation/cleanup 的 `WorktreeOptions.signal` 传给 pi.exec，await 后取消不得继续下一条 git；`onCreated` 记住成功或 partial add 的候选路径。关闭或保存失败保留路径／未知更改／已生成 branch，正常保存才 non-force remove；不能强删正在执行的 tree、catch force-remove 或用 detached prune/外部进程绕过 host。证据见 actual runner 和 fake-exec worktree lifecycle tests。


3B2 shutdown participant 的确切 manager 顺序：`freezeAdmission()` → `stopForShutdown()` → 有界 `drainExecution()` → 同步 `sealHostEffects()` → `void dispose()`。`abortAll` 仅是普通取消，不能替代 shutdown stop：completed/retained child 仍可能持 extension resource，SDK core dispose 不 emit shutdown。stopForShutdown 忽略显示 retention，但不删文件；active prompt/bind 的 child close 必须等实际 runner取消结束，不按 terminalResolved 提前 dispose。standalone await dispose 自带同一 stop和2秒budget；到期 seal 后所有晚create/bind/end只 local dispose。runner `shutdownChildSession` 接受 `canEmitShutdown`，在 hasHandlers之后、emit之前读取permit。不得简单删 host guard 或用 sweep/clearCompleted 代替明确shutdown API。


### Agent participant 与异步辅助所有权（3B2）

composition 注入同一个 TaskLifecycle/coordinator；agent 无额外先执行 shutdown handler，direct factory 无注入才 own 局部 protocol。freeze 同步关闭所有通知/input/RPC/ctx，再 freeze manager，先于任何 shared wait cancel；stop 调 stopForShutdown（不能 abortAll 替代），取消 captured scheduler binding、clone signal、workflow/host gate。drain 返回 actual manager + full clone/fallback + worker/host promise；同步 dispose 第一动作 sealHostEffects，再 void dispose，后解除 source/subscriptions/自己占有的 registry entry。

每个异步调用捕获 origin ctx，await 后和 late callback 先验 activation 与 run/task-map 身份；旧 factory 不重启。before_switch 可以被取消，不永久停止 scheduler/清执行状态。scheduler interval/once/cron 与 startup/finalize 必须持 immutable binding，stop invalidates，不删除定义；普通 disable 不擅自取消已启动 child。resolveModel 同步。

clone typed seam 只替换 loader/create，实际 reload/create/prompt/tool callback 逐边界检查 signal/admission；一次 attempted flag 与成功 admitted flag 分开，已尝试 handler 失败不能 duplicate fallback。late create 只 local dispose（noExtensions），active prompt abort 并 own 完整 finally。workflow host gate signal + await 后检查；worker terminate 不证明 host promise 结束，必须独立 own/drain。runtime late host result 在 schema/gate/journal/action 前检查 settled/aborted，不改 pipeline/replay/retry 算法。显式 stopped 不额外发完成通知，但仍计 group terminal membership，不能吞自然完成 siblings。

用户已明确接受进程内 agent 的协作式取消边界：自有进程、monitor、workflow worker、队列、timer与订阅要停止/释放；非协作第三方 provider/create/shutdown hook 只保证发取消、有界等待、旧接口/通知封口与原 cleanup owner/文件保留，不保证强杀或停止其内部写入。不得将该例外扩展为自有 socket、worker 或 timer 泄漏的豁免，也不得将超时说成全部资源实际关闭。G3按修订PRD AC9和独立审查验收，测试绿色或用户边界选择本身均不能代替审查。
