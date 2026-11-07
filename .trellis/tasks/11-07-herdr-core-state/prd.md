# Herdr Core 问卷等待状态补齐

## 目标

补齐 `extensions/herdr-state.ts` 在 herdr-core（`hc`）中的问卷等待状态，让正常模型调用问卷时正确显示 Blocked 与简短标签；保留 Pi 原生生命周期上报与 Herdr TUI socket 通道。

## 授权与关键决定

- 用户最终选择 A：只补问卷等待，不关闭原生 reporter，不重写完整生命周期状态机。
- 用户在协议核查后明确要求“那就按task做吧”，批准按当前 A 方案实施，包括原生快照未知时不补报的安全回退、计划内 scratch 隔离验证、独立审查与 scoped 本地阶段提交。材料复核完成后按 workflow start；不把历史规划授权当成实施批准。
- 插件实施不修改已安装 Pi、Herdr 或第三方问卷包，不升级或安装依赖，不操作个人 Pi/core 实例。用户另行授权的 TUI binary 升级已执行，不扩展插件实施权限。
- 保留不相关未提交改动。目录沿用 `11-07-herdr-core-state`；标题与描述已改为当前 A 范围。

## 背景与证据

| 事实 | 证据 |
| --- | --- |
| 现有扩展只接受完整 `HERDR_ENV`/socket/pane 环境，core 的 `HC_TERMINAL_ID`/`HC_TERMINAL_SOCKET` 不激活扩展 | `extensions/herdr-state.ts:73,150–151,354` |
| socket watcher 已识别标准提示与问卷等待，generic custom UI 保持静默 | 同文件 `262–305,318–349` |
| Pi 1.4.0 原生上报常规生命周期、标准对话框、压缩和登录，不认识 rpiv 问卷 peer | 安装 SDK `dist/modes/interactive/program-status-reporter.js:28–111`、`interactive-mode.js:2130,5235` |
| 原生初始 Idle 在 extension session_start 前发出，相同状态去重；公开 Terminal 无当前状态 getter | 安装 SDK `interactive-mode.js:705–708,1592–1598`、`program-status-reporter.js:90–96`；pi-tui `dist/terminal.d.ts:25–62` |
| 普通首次模型 run 在问卷前提供真实 Working；reload 不保证重发已有状态 | 安装 SDK `dist/core/agent-session.js:709–713,751–753,2998–3032`、`interactive-mode.js:2699–2708` |
| 当前 rpiv prompt/blocked 均有 toolCallId；blocked 在 lazy mount 前开始并在 finally 解除 | 安装 `@juicesharp/rpiv-ask-user-question@2.15.0/events.ts:23–49`、`ask-user-question.ts:47–66,353–414,520` |
| 项目已有公开 descriptor lease 和问卷 ID 幂等处理先例 | `extensions/editor-handoff/index.ts`、`extensions/beautify/editor/phase-state.ts:66–72` |

安装 SDK root 为 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent`，pi-tui 为同 namespace 下相邻包。产品只能使用公开 API；上述内部文件是只读研究/测试证据，不是产品 import 合同。

父级离线 actual-native-reporter/sink fixture 已验证 baseline 不可补读及下一轮 Working/Done/Error 可观察。此前脚本 terminal 曾验证 core 可解析 Blocked，但不是本扩展端到端验收。规划期结果和未运行项见 `implement.md`。

## 需求与验收

| ID | 需求 | 可观察验收 |
| --- | --- | --- |
| R1 | 仅为 core 的明确问卷 peer 补 Blocked 与标签，普通 custom 不判为问题 | 正常新模型 run 的问卷开始为 Blocked/kind=question；第一题 header/question 被压成短单行；无关 custom 无新增 Blocked |
| R2 | 保留原生完整状态与原生 Blocked 优先级 | 问卷期间非 Blocked native 更新不会冲掉覆盖；native permission/auth 等提示保留 kind/message；问卷解除恢复最新 Done/Error/Working/Idle 与原生消息，不写死 Idle |
| R3 | 具名等待按 ID 幂等配对，兼容匿名事件，释放有清理 owner | 重复 true/false、交错 label、重叠问卷、取消/异常与 unknown ID 均不会提前结束其他等待；shutdown 释放 subscriptions/snapshot/descriptor，无迟到写入 |
| R4 | 不关闭原生 reporter，不修改环境开关，不竞争 raw stdout | 没有问卷时原生值透传；`PI_PROGRAM_STATUS=0` 或能力不支持不产生新增 OSC；原生压缩、登录、错误/取消仍由 Pi 负责 |
| R5 | 能力不安全或 native baseline 未知时 fail-open，不猜快照 | receiver 不可装饰/捕获失败保持原生；无 snapshot 的问卷不注入，收到真实状态后才允许补齐；不读私有缓存，不跨 activation 借旧值 |
| R6 | 原 socket 通道、模式及入口发现保持兼容 | 原 `herdr-state.test.ts` 继续通过，RPC/JSON/print 静默；完整旧 pane 环境优先，core helper 不成为独立 top-level extension |
| R7 | 用真实 SDK 与授权隔离终端证明 owner 与恢复，而非只靠 fake handler | focused 自然退出、actual SDK receiver/cached replay、首次新模型问卷、空闲 reload 后下一轮及退出验证分别记录；未运行的真实测试不记 PASS |

R5 的安全回退与下节覆盖边界已随用户“按task做”的批准纳入 MVP 验收合同。

## 技术选择

通过公开 `ctx.ui.custom` 工厂取得 TUI，用公开 `tui.terminal.setProgramStatus()` 的窄 receiver 装饰观察 native 状态。无问卷时透传；有真实快照及问卷时合并注意力；结束恢复最新原生值。使用原 terminal 的协商、编码与缓存，不代理 stdout 或访问私有 reporter。

明确区分 native 状态计算和 attention 补齐。本任务采用 A，不接管原生计算。完整数据流、owner/clear/descriptor 生命周期和文件边界见 `design.md`；验证及单阶段提交计划见 `implement.md`。

## 宿主版本与协议支持核查

升级前的只读 CLI 实测：Herdr TUI 为 `herdr 0.9.1`，core 为 `hc 0.1.18`。用户随后单独批准先升级 TUI；现已通过官方稳定渠道更新到 `herdr 0.9.5` 并核对发布清单 SHA-256，core 保持 `0.1.18`。没有执行 TUI 会话停止/重启、插件实现或额外 integration 安装；详见 `implement.md`。不能把当前二进制的能力差异视为永久的产品架构限制。

官方 [TUI releases](https://github.com/herdrdev/herdr/releases) 页面已列出 v0.9.5，抓取到的发布说明未找到 OSC 7501 支持条目。这不足以单独证明新版不支持。直接核对 [PR #5172](https://github.com/herdrdev/herdr/pull/5172) 的页面嵌入元数据：`state: DRAFT`、`mergedTime: null`、`closedTime: null`；其目标正是增加通用 OSC 7501 状态接收。因此不能将“有相关 PR”误报为“已合并/已发布”，也不能承诺升级即可去掉 socket watcher。

当前 A 设计的 TUI 协议基线已在升级后的 0.9.5 上重新核查：固定 release 源码的 `src/pane/osc.rs:488–528` 仅保留 OSC 0/2 title 与 OSC 9 progress，未接入 OSC 7501；隔离的实际 0.9.5 server/PTY 测试确认有普通 DA 回复、无 OSC 7501 能力回复，直接 Blocked 不创建 agent，同 pane 的 socket `pane.report_agent` 则产生 `agent_status: blocked`。三次驱动尝试及修正、最终退出 0 和正常清理见 `implement.md`。这是协议层实际测试，不是 Pi 问卷端到端验收。

因此升级到当前稳定版仍不能共用 OSC 接收路径，保留 TUI socket watcher、只为 core 补问卷的 A 分支仍适用。将来若确认 TUI 正式版提供同等 OSC 接收，可另评估共用原生状态加问卷补齐。状态协议一致不等于旧 socket 会话引用、状态优先级和恢复语义全部一致。隔离协议测试不构成插件实施批准，也不授权个人服务重启。

## 已接受的覆盖空窗

已接受安全回退：普通新模型问卷，以及空闲 reload 后下一轮模型问卷预计能补齐；安装时已存在的等待不追溯，尚无真实快照时保持原生上报，等下一次原生状态变化后启用补齐。

公开 API 无法保证“热加载进一个已经打开的问卷立即补报”。安装时已 Working/Blocked 且状态被去重、既有等待跨 reload 或真正 terminal replacement 时，可能安全漏报。若要求所有既有等待立即恢复，需要重新评估 SDK 能力/额外接线范围，不以读取私有缓存或猜测 Idle 代替决定。

## 范围外

不复制/接管 Pi 状态机，不增加通用终端宿主抽象，不改变 Herdr 服务、布局、任务调度、问卷展示或 Pi SDK，不实现 core 的旧 socket 会话恢复接口。不推断两套完整环境并存时的真实最内层宿主，不承诺任意未来 SDK/问卷版本或未知后来 wrapper 的兼容性。

## 材料状态

- 当前 A 阶段已实现、独立复查和隔离验证通过，产品检查点为 `55d1627`；证据与未运行限制见 `implement.md` 第 9 节。task 保持 in_progress，等待用户验收与单独生命周期授权，不执行归档。
- 主会话直接实现的 implement manifest 仍空；check manifest 已选实际规范引用，供批准后独立审查使用。
- task-validate 的空 implement manifest 诊断不能称为全部验证通过。
