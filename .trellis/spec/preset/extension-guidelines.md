# Extension Guidelines

## Explicit Entries and Single Ownership

[package.json](../../../package.json) declares `"pi": { "extensions": ["extensions/*.ts"] }`. This glob loads every top-level `.ts`, not nested directories. Keep helper modules and tests nested; a new top-level helper would become an extension entry. Declare any future shipped skills/prompts/themes explicitly in `pi`; declaration disables their convention discovery too.

[pi-manifest.test.mjs](../../../scripts/pi-manifest.test.mjs) asserts complete top-level coverage, no nested entries and resource declarations. Do not remove it or replace the glob with recursive discovery: that would load nested vendor entry points twice.

[task-composition.ts](../../../extensions/task-composition.ts) 拥有每次 factory activation 的唯一 `TaskLifecycle`、coordinator 与共享 UI owner。关闭顺序是所有 participant 同步 `freeze()`（admission 与通知）→ close hooks → cancelWaits → silent `stop()` → 最多 2 秒 `drain()` → source/coordinator `dispose()`；异常逐项隔离，shutdown 返回稳定幂等 promise。process 和 agent 都已接入，完整验收仍须实际测试与独立审查。

## Beautify 与编辑器组合

[beautify.ts](../../../extensions/beautify.ts) 是独立美化入口，嵌套 [beautify](../../../extensions/beautify/index.ts) 仅通过公开 `registerToolRenderer` 接管 read/bash/find/grep，并保守适配可选 get_subagent_result/jobs 展示，不重注册执行、不改 result/content/structuredContent。其他工具调用 next；宿主负责图片。原四类和常规可选工具用 default host Box；组件仅使用 render(width) 传入内宽，不再减／补 outputPad，不用 stdout.columns 决定布局。call/result 用每调用 namespaced state 同步组合，收缩仅 call 一行，结果组件空行；expanded 保标题与正文。单行摘要按 SDK 显示列预算，offset 原子、关键状态优先，次要元数据逐字段省略。

可选工具只按固定参数／text-only 且 details undefined 信封识别，不读私有 registry，不额外执行或消费。只解析 get_result 头部及 jobs action 对应头部，attach partial 不扫描日志状态，final 覆盖 partial；released/cancelled retrieval 不表示任务停止。未知参数／结果委托 original renderer，state 与 call/result lastComponent 各自隔离，无 original 用 public 组件，收缩参数采用有界 key=value 预览，展开参数保字符串实际分行与已返回全文，结果为 10 行预览／展开全文。Pi 1.2 在 renderCall 前选 shell，renderShell 无 context；仅 original self 的可选分支使用公开 Box 做已知态外壳，未知态移除 Box 保原 self，无双框；已知态的 padding 点击通过 handled/no-render 阻止 host 外层 MouseRegion 误展开，正文命中仍交宿主切换。已有结果时 renderCall 延后组合至同轮 renderResult，不能把缓存 partial 按新 final context 解析并触发 original 生命周期。原 renderer 回调失败时一次无敏感信息诊断并显示当前参数／结果的通用回退，lastComponent 只保存该 original 成功返回的组件。get_result description 无空白分隔的多行可读，空 description 用请求 ID；分隔含歧义不猜正文，jobs terminal 合计也须 safe integer。SDK thrown tool error 的 details 为 {}，不扩大 undefined 信封 guard，走原／通用错误展示。证据见 [retrieval.test.ts](../../../extensions/beautify/__tests__/retrieval.test.ts) 与 [shell-collapse.test.ts](../../../extensions/beautify/__tests__/shell-collapse.test.ts)。Read 的 offset 按 1-based 输入，续读说明不作为代码行，高亮有界且迟到回调不能更新关闭后的 activation。

输入框 [owner.ts](../../../extensions/beautify/editor/owner.ts) 与 [appearance.ts](../../../extensions/beautify/editor/appearance.ts) 在已有活实例上装饰，保留 history、receiver、subclass、undo/paste/补全与 IME。只提供上下规则和首行 ❯，不接管鼠标/clipboard，不承诺原生复制恢复软换行。

- 不读取私有 history、不改原型链、不通过复制文字新建 editor；共享 [editor-handoff](../../../extensions/editor-handoff/index.ts) 保护宿主重复接线，避免同实例 setter 重置草稿、paste 或 actions。
- 装饰前检查 border/padding hooks 与可写 data methods；unsupported editor 保留原 UI。局部写入或 host setter 失败须事务回滚，实际 container/focus 可用不能仅凭方法恢复判断。
- 方法与 padding 恢复必须检查所有权，不覆盖后来插件；退休 wrapper 清引用并成为 inactive delegate。
- Pi reload 在 shutdown 前 reset UI；cleanup 不重装旧 factory。Beautify 与 Down 两种接线顺序及禁用 Down 都须测试，不依赖顶层文件排序。
- [editor.test.ts](../../../extensions/beautify/__tests__/editor.test.ts)、[TESTING.md](../../../extensions/beautify/TESTING.md) 记录实际 host 与离线 history fixture 验证范围；不能替代真实 input-history/终端验收。

Pi 1.1.0 的 new/resume/fork/import 在旧主会话 abort 后 shutdown，再建立新 factory；reload 也重新激活。before-switch 可取消或因 cwd 无效而无 shutdown，不能永久 freeze/dispose 当前 activation；旧 disposed factory 不复活，不引入 global mutable UI/coordinator。`process-tasks/index.ts` 在最终关闭后拒绝旧工具新执行，释放 foreground/pending/background/monitor/attach/ticker/sweep，保留磁盘日志；新 factory 从空 source 开始。证据见 [activation.test.ts](../../../extensions/process-tasks/__tests__/activation.test.ts)、[sdk-runtime.test.ts](../../../extensions/task-ui/__tests__/sdk-runtime.test.ts)。

Use [lifecycle.ts](../../../extensions/process-tasks/lifecycle.ts) for terminal transitions and cancellation, not tool-local copies. `markTerminal` is idempotent, freezes `endedAt` and releases runtime hooks; `completeJob` checks terminal state before notifying. This prevents a late exit after silent termination from notifying the new session. Retention belongs to [registry.ts](../../../extensions/process-tasks/registry.ts), not notification delivery or rendering.

Optional host effects must be gated and isolated. [blocked-signal.ts](../../../extensions/blocked-signal.ts) pairs prompt block/release, releases on shutdown, suppresses duplicate host notifications and bounds CLI calls. Its [tests](../../../extensions/__tests__/blocked-signal.test.ts) use fake SDK events/sinks, including late notification IDs and sink failure.

## @ 路径连续补全契约

### 1. 范围与触发
独立 [at-path-completion.ts](../../../extensions/at-path-completion.ts) 修复手动输入 `@path/` 与原生接受目录后续提示；不耦合 Beautify，不改搜索、ignore、递归、排序或20项上限。

### 2. 签名
公开 `addAutocompleteProvider(current => wrapProvider(cell, current))` 委托原 provider；活实例公开 handleInput/getText/getLines/getCursor 用于观察。唯一内部能力为 [compat.ts](../../../extensions/at-path-completion/compat.ts) 的 `tryTriggerAutocomplete(false)`，Pi1.2含义是普通、非显式Tab请求；这是已授权内部适配，不是稳定公开SDK合同。

### 3. 契约
真实slash先委托原receiver，再核全文/光标单字符插入及合法token；已有列表交原生更新。applyCompletion先委托原实现，目录须同时满足SDK label/value的 `/` 判据和返回路径光标，再微任务续请求。唯一候选只展示；文件接受、Enter submit、空目录保持原生。保活实例与handoff，不复制私有编辑状态。

### 4. 验证与错误矩阵
缺失能力/unsafe descriptor/安装失败→一次英文诊断并保原生Tab和实际container/focus。Escape、后续输入、文本替换、鼠标、失焦/overlay、换editor/关闭→待续请求失效；attachment请求在provider进入前和await后均核focus。附加候选过滤仅作用于 `@`，native Copy no-op保留候选请求但失效续提示微任务，不吞普通Tab或其他trigger。

### 5. 正常／基线／错误案例
正常接受目录→原生写入且cancel后自动开新列表；基线无增强→仍需Tab；错误模拟Tab→唯一候选会被接受。公开provider安装按host规则取消旧列表，但不丢活实例history/undo/paste。方法存在不能证明升级后语义相同，须实际SDK回归。

### 6. 必需断言
actual Editor/CustomEditor、host setter/reset、forceTab唯一目录、Tab/Enter/mouse、Escape debounce前/await后、focus/overlay、编码slash、history/Down/Beautify多顺序、partial rollback和GC；[check-regressions.test.ts](../../../extensions/at-path-completion/__tests__/check-regressions.test.ts) 保其他provider与later setter。真实PTY/IME/input-history原包未验证不能以fixture代称。

### 7. 错误与正确
错误：cleanup从后来顶层setter重放已转换provider，重复包装。正确：只在setter identity仍匹配时，把本观察层收到的exact public参数重放到其predecessor；nondelegating替换不回写旧链。退休cell/lease清引用并成为inactive delegate，不重装旧factory。token使用Pi1.2同等delimiter规则；host jiti alias不支持 `pi-tui/dist/utils.js`，Node-only import成功不能替代actual loader检查。

## Monitor 事件与停止

修改 monitor 或共享任务面板的执行接入时，另读 [Monitor 契约](./monitor-contract.md)。源回调先于启动接线，stdout/stderr 默认合并但独立解析完整行；时间／缓冲归 session，面板只调用共享停止能力。absent/resumed 不变更 Job 运行状态或消费结果标记，不把实时进度再次回读成失败尾部。该文档记录接口、错误矩阵和必须保留的离线断言。

## Beautify 宿主与可选结果合同

### 1. 范围
原四类工具及 get_subagent_result/jobs 的展示层；不改变执行、结果或消费语义。

### 2. 签名
公开入口为 `registerToolRenderer((name, next) => ToolRenderers | undefined)`；`renderCall(args, theme, context)` 和 `renderResult(result, options, theme, context)` 共享 `context.state`，但 `lastComponent` 按 call/result 分槽。

### 3. 合同
宿主按 call→result→render 更新；已有结果时 optional call 不用新 context 解析旧 partial，等本轮 result 再组合。default shell 负责背景和 outputPad，render(width) 是内宽；self 兼容分支才自行提供 Box，padding 点击不切换。新增两工具仅识别合法参数、单 text block、details=undefined 和固定头部；状态是返回快照，attach release 不等于停止 job。

### 4. 验证与错误矩阵
工具缺席→无注册副作用；未知格式/details（包括 SDK thrown error 的 `{}`）→原 renderer 或通用预览；original 回调抛错→当前参数/结果可读 fallback＋一次脱敏诊断，成功原 lastComponent 不被替换；不安全计数/合计→降级或省略，不显示舍入统计。

### 5. 正常／基线／错误案例
正常已知信封→整块单行＋完整已返回正文展开；基线第三方未知 renderer→保留原展示和状态；错误 stopped following→仅结束跟随，不报 killed。空 description 回退请求 ID，多行 description 不扫描正文求统计。

### 6. 必需断言
actual-host 检查背景行尾填充、单行、一次 padding、正文/留白 mouse 边界、partial→final 原 callback 次数；actual registered tools 检查返回文本不变且无额外读取/消费；缺席/动态/历史/同名异形/原 renderer 抛错回归保留。

### 7. 错误与正确
错误：self 外壳只画前景色；default renderer 再减 outputPad；新 final context 解析旧 partial。正确：常规使用 host default Box 内宽，同轮结果更新唯一摘要，未知可选合同隔离原 call/result state 和 lastComponent 后委托。纯摘要截断需清除SDK对纯文本自动加入的full reset再加fg，不能让0m取消宿主背景；不要清除正文/Shiki合法样式。回归逐显示cell验证背景连续，不只验证48m存在。

## Safe Terminal Rendering

Follow [TaskPanel](../../../extensions/task-ui/panel.ts): strip external terminal controls before SDK styling, bound source reads to 16K and show omitted ranges. Size with SDK `visibleWidth`/`truncateToWidth`, not string length; SDK-owned SGR resets are valid output, not external control leakage. [owner.ts](../../../extensions/task-ui/owner.ts) owns one overlay, closes before shared wait disposal, and releases subscriptions/timers even during synchronous host reentry. [panel.test.ts](../../../extensions/task-ui/__tests__/panel.test.ts) covers widths, instant detail, groups, retained snapshots and owner cleanup. The panel may hold immutable metadata and one bounded final preview, never runtime hooks or mutable records.

[status-bar.ts](../../../extensions/status-bar.ts) also uses display-column widths and returns its unsubscribe as `dispose`. New widgets must identify their cleanup owner; `unref()` alone is not disposal. Avoid unbounded full-log rendering, nested replacement dialogs and global listeners that outlive the interaction.

## 任务底栏语义配色

### 1. 范围
共享 task-ui 摘要由 owner 按字段配色；status-bar 只对 `task-ui` 保留已有 SGR，其他扩展状态仍按原规则绘制，防止通用 muted 覆盖内部语义色。

### 2. 签名
`taskSummary(views: readonly TaskView[], theme?: Pick<Theme, "fg">): string | undefined`；省略 theme 时返回原纯文本文案。

### 3. 契约
类型与快捷键用 `accent`，数量用 `text`，active 用 `success`，queued 用 `warning`，冒号、斜线及点分隔符用 `dim`。只计非终态顶层工作，顺序固定为 shell、monitor、agent、workflow。owner 从 `ctx.ui.theme` 取色；例如 `theme.fg("accent", shortcut)`，不得硬编码 RGB。

### 4. 输入矩阵
无顶层活动／排队任务 → `undefined`；有 queued → 保留 `0 active / N queued` 文案；缺少快捷键 → owner 显示 `/tasks`。颜色不改变可见宽度，status-bar 继续清理非 SGR 控制字符并按 SDK 显示列截断。

### 5. 正常与异常案例
正常：monitor 与 shell 共享字段语义色；基线：无 theme 与旧文案一致；错误：给整个 task-ui 再套 muted，导致字段 reset 后后续文本丢色。

### 6. 回归
[summary.test.ts](../../../extensions/task-ui/__tests__/summary.test.ts) 覆盖单／多类型、queued、子任务排除、空状态、配置快捷键与 fallback，以及实际 status-bar 组合后的 SGR 和窄宽度；owner fixture 必须提供 `ui.theme.fg`。

### 7. 错误与正确
错误：`paint("muted", sanitize(taskText))`；正确：仅 `task-ui` 分支使用 `sanitize(taskText)`，由 owner 提供语义样式，不扩展为任意外部状态免着色。

## 共享等待与阶段接入边界

- [task-composition.ts](../../../extensions/task-composition.ts) 创建唯一 `TaskCoordinator`，向 process factory 和 agent factory 的 typed options 传入同一个实例；不能用 global UI singleton 或在生产 backend 中再创建实例。直接 process factory 的离线 fixture 可省略 options，由其创建局部实例及共享 controls。
- [types.ts](../../../extensions/task-ui/types.ts) 定义 namespaced `TaskIdentity`、`TaskView`、`TaskSource` 和有限 detail/stop 能力。adapter 复制冻结读模型，不向 UI 返回 mutable Job、promise、controller 或 session。订阅／revision 覆盖后台状态及 waitCount；wait 与 executionMode 分开。
- coordinator 的 launch/retrieval lease 仅完成、detach、interruption、dispose 中一个胜出，先移除父 signal listener；`onComplete` 在释放抑制前消费结果。`onDetach`／`onInterrupt` 仅 launch 调用，retrieval 不停止执行。`cleanup` 幂等；共享 `/bg` 对所有 lease 操作但不调用 `ctx.abort`。
- 前台 bash 首次 await 前注册 lease，显式 detach 不等两秒 UI 窗口；backend 保持 exit 归属、terminal metadata 和 log，不 finally unlink。计数包含前台，promotion 不重复 started。
- retrieval 各自减少 attachCount，取消后重查 terminal 未消费结果；monitor 只保留已构造的有界终态 payload用于重查，显式 stop 不 flush pending。回归见 [waits.test.ts](../../../extensions/process-tasks/__tests__/waits.test.ts)、[monitor-session.test.ts](../../../extensions/process-tasks/__tests__/monitor-session.test.ts)。
- 普通 input 不参与协调，不 detach／abort／resubmit；agent mentions 仍属 agent backend。`/tasks` 与 Shift+Down 打开共享双栏面板，coordinator 只按 identity 路由 finite detail/stop，拒绝旧 run 或 closed activation。分类底栏只计算真实顶层工作，包含前台-only；旧 AgentWidget/FleetView 及其配置/监听已删除，不保留 no-op 兼容壳。裸 Down 使用 [editor.ts](../../../extensions/task-ui/editor.ts) 的实例handleInput装饰，`downOpener` 默认true，false不安装。只有严格空文本、真实focused/getFocusedComponent、nooverlay/noautocomplete、press非repeat、有freshmodel可查看task且无面板时处理，其余委托原receiver；无globalrawlistener。

## 编辑器本地 Down 所有权

Pi1.1.0的publicEditor.isShowingAutocomplete与TUI.getFocusedComponent/hasOverlay可用，不读取privateeditingstate。初次安装先用publicui.custom的同步完成、不挂载probe获得realTUI，在destructivehostsetter之前完成focusedliveeditor检查与publicdescriptor预检。已有overlay时不done以免SDKhide其他overlay，unsupportedaccessor/nonconfigmethod失败不调用setter，不卸载原UI。随后factory仅返回原liveeditor；host对同一instance仍会setText并重复接线，preserveHandoff仅在同步交接期间暂时屏蔽publicsetters/callback/actionMap，finally恢复仍owned属性。不能再次newEditor并以copytext声称保undo/history/paste。后续factorycall正常delegatepredecessor，实例lease用WeakSet防叠加；不支持安全装饰的editor应diagnose并保留原可用UI。

关闭先清cell.resources/access、screen/target，再恢复自己仍ownedmethod；lateropaquewrapper保持inactiveforwarder，不通过hostsetter重建丢state。capturedwrapper必须不保旧ctx/TUI/coordinator/panel；测试opaque包装在独立module-scope创建，不能让fixture本身共享create环境保这些资源。独立未来不delegate原factory的editor不自动继承Down，显式入口仍可用。无globalrawinputs，actualSDKsetter/TUI分发及Beautify两种接线顺序由自动测试覆盖；另有用户授权的隔离installedCLI140x40PTY核心冒烟，不覆盖任意插件/尺寸或在线模型自主质量。

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
