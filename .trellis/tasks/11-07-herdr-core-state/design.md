# 设计：Herdr Core 问卷等待状态补齐（A）

> 用户已批准按当前 task 的 A 方案实施，包括 PRD 的未知快照安全回退。

## 1. 责任与边界

- Pi 原生 ProgramStatusReporter 继续计算模型执行、完成、错误、取消、压缩、标准对话框及登录状态。
- 扩展仅补 `rpiv:ask-user:blocked` 明确声明的问卷等待；不从任意 custom UI 猜测等待，不关闭原生 reporter，不写第二套 lifecycle 状态机。
- core 分支通过公开 terminal receiver 合并问卷注意力；无问卷时原生值原样透传。socket 分支保留现有实现与状态语义。
- 不读 Pi 私有 `programStatus`、`lastReport`、`blocked` 等字段，不从 core 查询状态作为快照，不代理全局 stdout，不修改 `PI_PROGRAM_STATUS`。

## 2. 已验证的技术事实

### 升级后的 Herdr TUI 协议基线

本机稳定版已升级至 0.9.5。固定 release `src/pane/osc.rs:488–528` 的 agent tracker 只处理 OSC 0/2 title 与 OSC 9 progress；实际隔离 0.9.5 server/PTY probe 收到正常 DA 回复但无 OSC 7501 回复，直接 Blocked 无 agent，socket 正向对照为 Blocked。不能把“升级”当成“已有通用 OSC 接口”。本设计保留 socket 分支有当前稳定版证据支持，而不是假设 TUI 永远不支持 OSC；详见实施记录第 8 节。

### 原生接口与顺序

安装的 Pi 1.4.0 / pi-tui 1.4.0：

- `pi-coding-agent/dist/modes/interactive/interactive-mode.js:705–708`：启动 UI 后，原生状态已经 report；扩展 session_start 在后续绑定阶段。
- 同文件 `1592–1598`：真正 session replacement 的 reset 在绑定扩展前。
- `dist/modes/interactive/program-status-reporter.js:90–96`：相同状态去重，不调用 terminal receiver。
- `pi-tui/dist/terminal.d.ts:25–62`：公开 Terminal 提供 `setProgramStatus`，不提供当前状态 getter；缓存字段标为 private。
- `pi-coding-agent/dist/core/agent-session.js:709–713,751–753`：agent_start 在首次模型请求前等待；先派发扩展事件，再通知 interactive observer。
- `dist/modes/interactive/interactive-mode.js:2699–2708`：observer 在初始化后同步调用原生 reporter。
- `pi-tui/dist/terminal.js:159,211,477–486`：能力回复/terminal restart 会重播 terminal 缓存。虽然 replay 不经过装饰方法，但缓存是此前经原 setter 接收的合并值；恢复必须通过原 setter 同步更新缓存。
- `pi-coding-agent/dist/core/agent-session.js:2998–3032`：reload 替换 extension runner，不保证产生新的原生状态调用。

### 问卷 peer 合同

当前安装的 `@juicesharp/rpiv-ask-user-question@2.15.0`：

- `events.ts:23–49`：prompt 和 blocked 均携带 `toolCallId`，字段可选是向旧版本兼容，不是当前生产方缺 ID。
- `ask-user-question.ts:47–66,520`：先发 prompt 和 ID，再进入等待。
- 同文件 `353–414`：blocked true 在 lazy load/custom mount 前；finally 发对应 false，涵盖回答、取消和失败。
- 同文件 `491` 附近：工具 exposure 为 model-only。普通首次模型提问前，已安装 receiver 应观察到 Idle→Working 的真实原生变化。
- 本仓库 `extensions/beautify/editor/phase-state.ts:66–72` 已有 ID 幂等配对与匿名有界计数先例；不把其展示状态机耦合进 core 适配。

父级已用实际原生 reporter + terminal sink fixture 验证启动 baseline 不可补读、下一轮 Working/Done/Error 可观察。该验证不是实际 Pi TUI/core 的端到端证据。

## 3. 分支与文件边界

预期文件：

- `extensions/herdr-state.ts`：保留 socket reporter/watch；增加互斥 core 路由及复用 label helpers。完整既有 `HERDR_*` 环境优先，以保持原通道行为；仅无完整 pane 环境且具有 `HC_TERMINAL_ID`、`HC_TERMINAL_SOCKET` 时启用 core 分支。
- `extensions/herdr-state/core.ts`：core activation、公开 receiver lease、问卷 tracker 与合并。辅助模块放嵌套目录，避免 `extensions/*.ts` 把它发现为另一个入口。
- `extensions/herdr-state/__tests__/core-state.test.ts`：确定性 receiver/attention/cleanup 回归。
- `extensions/herdr-state/__tests__/core-sdk.test.ts`：实际安装 SDK 的 reporter/terminal 边界验证，测试专用内部 introspection 不能进入产品 imports。
- `extensions/__tests__/herdr-state.test.ts`：仅补路由/旧通道不回归证据，不顺手更改旧 socket 问卷计数语义。
- `docs/extensions/herdr-state.md`：两条宿主通道的用户可见行为与限制。
- `.trellis/spec/development/herdr-state.md`：新增 core 公开 receiver、回退与测试合同；不推广为通用宿主抽象。

复用 `extensions/editor-handoff/index.ts` 的 `interpose` descriptor lease（公开对象方法）时先验证终端对象能力；不调用等待 editor focus 的安装流程。本任务不需要替换 editor 或创建可见 widget/footer。

## 4. Activation 与 receiver

1. 仅 `ctx.mode === "tui"` 安装，session-owned closure 保存 context、订阅释放函数、receiver lease、native snapshot 和问卷 tracker。
2. 使用一次即时 `done()` 的公开 `ctx.ui.custom(..., { overlay: true })` 捕获 TUI；返回 inert component，不真实挂载，不抢占焦点或引发 Blocked。
3. 校验 `tui.terminal.setProgramStatus` 与可安全装饰的 descriptor。失败即保持原生行为，不降级为 raw stdout 竞争写入。
4. session_start 不等待 editor readiness；捕获失败、shutdown 胜出或重入时不迟到安装。
5. 采用未知快照状态，直到收到实际原生 setter 调用才 armed。每次原生调用先记录完整新状态，再按下节规则调用原 setter；插件自己的恢复/覆盖调用直接走捕获的原 setter，不当作 native baseline。
6. 不缓存无关对象，不跨 activation 借用旧快照。若 terminal 真正替换，新 receiver 从 unknown 重新开始；能力不符合时退回原生。
7. shutdown 先关闭注意力 admission，恢复仍由本 lease 控制的最新原生状态，再释放 descriptor 与订阅。若后来的 wrapper 仍持有本 wrapper，本 wrapper 退役后仅透传，清空本 activation 资源，不覆盖后来 owner。
8. `clear` 是清理，不把它覆盖成 Blocked，也不复活清除后的旧快照；具体 shutdown/restore 次序通过实际 terminal 回归验证。

## 5. 合并规则

| 原生快照 / 注意力 | 发出行为 |
| --- | --- |
| 尚无真实 native snapshot | 问卷事件只记录，不注入状态；native setter 原样/按收到当次真实值处理 |
| 没有问卷 | 完整原生值透传 |
| 原生已 Blocked | 保留原生 kind/message，避免问卷掩盖权限或登录提示 |
| 有问卷，原生非 Blocked/non-clear | 基于原生 app 发 Blocked、kind=question、最早仍活跃问卷的短标签 |
| 问卷全部解除 | 调原 setter 恢复最新 native snapshot，保留 Done/Error/message/kind |
| shutdown/native clear | 释放或透传清理，不保持问卷覆盖 |

标签复用 `sanitizeLabel` / `askUserLabel` 的单行、60 字符策略。不要把用户回答或模型输出写进状态标签。

## 6. 问卷配对

- prompt label 按 toolCallId 暂存，blocked true 消费本 ID 的 label。
- active ID 重复 true 幂等；false 只关闭匹配 ID，未知/重复 false 不会释放其他问卷。
- 最早仍活跃问卷提供标签，关闭后使用下一活跃问卷标签。
- 无 ID 的旧 peer 使用独立有界计数和一次性 label fallback；匿名 false 不关闭具名 ID。
- malformed payload 忽略，不把 prompt 或 ui_prompt_start(custom) 本身当作 blocked。
- 所有订阅是 activation-owned，shutdown 清空 labels、waits 和 baseline。

## 7. 已接受的覆盖空窗

公开 API 无法读取安装前缓存的原生状态。推荐安全回退：没有真实快照时不注入，等待下一次原生状态变化。

普通首次模型问卷、空闲 reload 后下一轮模型问卷预计能够覆盖，因为原生会发 Working。安装时已经 Working/Blocked 且后续去重、既有问卷跨 reload、真正 terminal replacement 时可能漏报；不会猜成 Idle 或污染 Done/Error。

无法保证“热加载到一个已打开问卷立即补报”。用户按当前 task 的实施批准已接受此边界；它是明确的 MVP 限制，不冒充任意既有等待的完整覆盖。

## 8. 回滚与不做的事

禁用/卸载扩展后原生行为保持；所有 descriptor 修改按仍拥有原则恢复。捕获或装饰不安全时原生可继续运行。整合失败不修改 SDK、不关闭内置 reporter、不借用私有状态、不发送并行 raw OSC。

嵌套宿主且两套完整环境同时存在，保留原 pane 通道优先；不在本任务推断真实最内层宿主。core 不实现旧 socket session-reference/restore 接口。任意未知后来 wrapper、所有 Pi 版本或所有问卷版本不在兼容承诺内。
