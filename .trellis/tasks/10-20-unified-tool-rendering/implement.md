# 实施与验证计划

## 状态与前提

本计划已获用户批准分阶段实施。S1 已完成并提交；S2 已完成实现、独立检查并提交为 `221b358`。任何涉及产品语义、公共接口边界、范围扩大或无法安全适配的设计问题，先暂停并向用户反馈，不自行延伸。

开始 S1 前，主会话必须重新读取本任务的 `prd.md`、`design.md`、本文档、实际将修改的完整源文件和相关测试。遵循 development/testing specs：保持 execution owner 不变、保留平行改动、用实际 SDK renderer fixture 验证、所有临时输出写入 owned repository-external run directory。

## 实施前检查

- [ ] 复核公共 factory 的实际 SDK `ToolRenderers`、self shell、mouse/invalidation 和 HTML 边界；不使用未批准的私有 host seam。
- [ ] 复核将迁移的自有工具是否能提供 header-free body；无法安全提供时停止该工具子阶段并报告，不强制包装。
- [ ] 复核 `tool_execution_start/end` 生命周期与最终 `durationMs`，包含拒绝、并行、partial、reload 和 shutdown。
- [ ] 复核 reply identity、entry append、`buildContextEntries()` 可见性和 all-text-block 消费边界。
- [ ] 为独立 check 角色准备真实 `check.jsonl` 规范/任务引用；实施角色若不派发，不伪造 implement manifest。
- [x] 最终计划已获用户明确实施授权；本轮限定为 S1，直接由主会话执行，因此 role manifests 暂时保持为空。

## 阶段

每阶段完成后先做本阶段检查和 review，再进入下一阶段；提交仅在实施授权后、阶段已验证时进行。实际文件范围以该阶段 source/test evidence 为准，不能触及 Task Panel 或其他任务文件。

### S1：公共 card primitive 与标题/文本正文行为

**目的**：在 Beautify 建立无注册副作用的标题+正文 primitive、受约束 summary、统一宽度降级、文本三行预览与展开提示。

**预期文件**：

- `extensions/beautify/` 下新增/调整公共 card、title、body 组件；
- `extensions/beautify/layout.ts`、`tool-call-heading.ts` 的共享布局使用者；
- `extensions/beautify/__tests__/` 的新旧相关测试。

**S1 开始前的变更边界**：最小缺口是 Beautify 缺少一个无注册副作用、可被后续工具/通知适配器复用的标题+文本正文 primitive；实际所有者在 `extensions/beautify/` 的布局与标题组件。S1 预计只改 Beautify primitive、现有共享 layout/heading 的必要调用点及其测试，不接管 tool resolver、clock、执行 owner、通知 owner、Task Panel 或任何外部/原生 custom renderer。若抽取会改变既有 Bash/read/find/grep 展示或必须先设计 adapter 合同，暂停并报告。

**验证重点**：Unicode/控制字符、窄/宽终端、摘要 renderer 约束、错误优先、空正文、展开提示、3 个真实物理行、图片例外合同。

**提交检查点**：primitive 与直接测试同一提交；不留下仅被将来 adapter 使用、但无测试的公共接口。

**S1 结果（已完成，待 scoped commit）**：新增 `card-primitives.ts`，提供无副作用的 `createCardHeading`（identity、受约束 summary、marker/statistics、宽度降级）和按真实物理行裁剪的 `textPreview`。`createToolCallHeading` 改为首个标题消费者；management unknown-format 的自有文本 fallback 改为正文 3 行加独立 hint 行。未修改 resolver、shell、时钟、执行/交付 owner、Task Panel 或原生/外部 renderer。

**S1 验证**：新增测试先在缺失 primitive 时以 `ERR_MODULE_NOT_FOUND` 失败（exit 1），实现后通过。使用临时 `PI_CODING_AGENT_DIR` 运行 `node --test extensions/beautify/__tests__/card-primitives.test.ts extensions/beautify/__tests__/tool-call-heading.test.ts extensions/beautify/__tests__/retrieval.test.ts extensions/beautify/__tests__/registered-agent.test.ts extensions/beautify/__tests__/shell-collapse.test.ts`（28/28 PASS，exit 0）；`node --test extensions/beautify/__tests__/*.test.ts`（87/87 PASS，exit 0）；`pnpm typecheck`（exit 0）；tracked 与新增文件 whitespace 检查通过。真实终端视觉复验、self-shell/mouse factory、clock 与通知/entry 适配属于后续阶段，NOT_RUN。

### S2：公共 self-shell factory、通用兜底与时间

**目的**：实现 self-shell factory、全局 resolver 的“无下游 renderer 才接管”规则、运行 elapsed 和最终 execution 显示。

**预期文件**：

- `extensions/beautify/index.ts`；
- `extensions/beautify/tool-clock.ts` 或替代 activation-owned clock；
- 公共 factory/adapter 文件与 actual-host tests。

**规则**：

- `next() === undefined` → 公共通用 self-shell；
- 任意下游 custom renderer → 原样委托；
- 不按 `renderShell`、名称、第一行或 ANSI 拆分；
- Pi 原生 `edit/write/read/ls/codemode` 原样保留；
- 运行中 `elapsed`，最终 `durationMs`→`execution`；无 execute 无 execution；不保存 call sidecar。

**验证重点**：实际 `ToolExecutionComponent`、default/self shell、partial→final、call-owned/result-owned body、并行调用、拒绝、未知工具、历史 duration、session switch/reload/shutdown、timer 自然退出、图片/mouse/invalidation。

**提交检查点**：公共 resolver、clock 与所有 lifecycle 回归同一提交；该跨模块公共合同需要独立 review。

**S2 结果（已完成，commit `221b358`）**：新增 `tool-card.ts` 的公共 self-shell factory。全局 resolver 仅在 `next()` 缺失时创建 generic card；任意下游 custom renderer 完整原样委托。generic card 自有 Box/padding 并保留正文点击展开、三行文本预览与 host image 所有权；不拆分原生/外部 custom renderer。`tool-clock.ts` 改为观测所有顶层工具：运行中返回 `elapsed`，最终优先读取宿主 `durationMs` 并显示 `execution`，不持久化 call 时钟；nested call、session start/shutdown 均清理/忽略。read/bash/find/grep 的既有 owned adapter 接入相同计时显示，Bash 不再显示旧 `call` 标签。

**独立检查与修复**：`trellis-check` 已审查 resolver delegation、self-shell mouse/padding/image、clock lifecycle 和 known adapters。审查提出 Bash 可能重复 timing；主会话复核发现 Bash 将 timing 作为本地 describe closure 传给 `renderers`，未传第四个 shared timing 参数，因此不存在重复 append；增加了同一 `elapsed`/`execution` 只出现一次的回归断言。审查指出 registered generic fallback 尚未和真实 clock 联测，已补实际 loader + `ToolExecutionComponent` 测试，覆盖 `elapsed → execution`、nested 忽略和 shutdown 后 late event。

**S2 验证**：clock/factory 测试先在新 API/module 缺失时分别失败（exit 1），实现后使用临时 `PI_CODING_AGENT_DIR` 运行 `node --test extensions/beautify/__tests__/tool-card.test.ts extensions/beautify/__tests__/tool-clock.test.ts extensions/beautify/__tests__/tools.test.ts`（17/17 PASS，exit 0）；`node --test extensions/beautify/__tests__/*.test.ts`（89/89 PASS，exit 0）；`pnpm typecheck`（exit 0）；`git diff --check` 通过。`pnpm check` 运行至 1596/1597 PASS 后因未改动的 `extensions/process-tasks/__tests__/jobs-read.test.ts` 期望 `task_id`、当前 committed runtime 返回 `agent_id`/`execution_id` 而失败；单独重跑该文件同样 18/19 PASS、1 个相同失败，记录为 S2 无关既有不一致，未越界修复。真实终端视觉、live reload/session switch 与第三方组合仍 NOT_RUN。

### S3：自有工具结果适配

**目的**：迁移能够安全提供 header-free body 的自有工具：顶层/嵌套 subagent、管理工具、workflow live card、monitor、`trellis_dispatch` 等；消除 legacy heading、裸文本回退、错误原因遗漏和重复时间。

**规则**：

- 调用状态和目标状态分层；
- 所有相关 text content blocks 参与正文；
- 保持 launch/management metadata 严格校验及模型可见内容；
- 无法安全迁移的自有专用 renderer 停止该子项并报告，不扩张到 private host seam。

**验证重点**：新建/恢复、背景 admission、wait/output、拒绝、启动失败、运行失败、stopped/aborted/steered、非法/历史 metadata、workflow 当前可达的 failed child/tolerated branch/gate/schema/skip/retry/replay/log/warning。

**提交检查点**：按 agent/process/workflow 可独立验证的子集拆分；任何 producer/consumer metadata 改动与消费测试同一提交。

**S3a 顶层 `subagent_run`（已完成，commit `53ef147`）**：顶层 agent 工具改为在自身注册处直接使用公共 `createToolCardRenderers()`，提供不含旧标题/shell 的目标状态正文；所有 `text` content blocks 在 expanded 时保留。由于 Beautify 必须对未知 custom renderer 原样委托，agent 工具不能自行监听 `tool_execution_*` 或持有第二个 clock。改为公共 factory 的明确协作 timing adapter：它以可枚举字符串属性跨实际 loader 保留，Beautify activation 唯一持有 lifecycle/clock，只对显式 adapter 注入 timing；不透明 renderer 仍完整委托。collapsed 的结构化失败正文先显示真实 error reason 和 target state，窄宽以 clip 保持两行；普通自有正文按实际 `render(width)` 物理行裁至三行，溢出时替换末行为诚实 `… expand`，expanded 保留 config 与全部正文。

**S3a 检查、失败与修复**：早期宽范围 agent 回归曾在 `tool-waits.test.ts` 的两项 registered launch/management 断言报告 `executionConfig` 未定义；隔离重跑又出现一次 legacy background turn-limit `undefined !== 7`，后续同文件 54/54 通过。没有通过放宽断言或改变 agent 调度/交付语义掩盖问题；经实际 loader 路径复核，将错误的子扩展本地 clock 方案替换为协作 adapter。独立检查先发现失败卡 collapsed 未显示真正错误原因，补充 error-first 回归后，又发现窄宽 custom body 未受公共 text preview 限制；正文改为自身严格裁行。随后通过 malformed metadata 的多行 fallback 回归发现早期 fallback return 绕过了裁行，已将其纳入同一 `compactRows` 路径。最终独立检查确认 valid/foreign body 预算、renderer/loader ownership、计时 seam 与 expanded preservation；中间还报告了新测试的 `TS7006`，主会话已补 `string` 注解并重跑 typecheck。

**S3a 验证**：在临时 `PI_CODING_AGENT_DIR` 下，最终运行 `node --test extensions/beautify/__tests__/tool-clock.test.ts extensions/beautify/__tests__/tool-card.test.ts extensions/beautify/__tests__/tools.test.ts extensions/beautify/__tests__/registered-agent.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/agent-tasks/__tests__/loading.test.ts`（104/104 PASS，natural exit）；`pnpm typecheck`（exit 0）；`git diff --check`（exit 0）。最终独立 check 在实际 host/loader 集合 4/4、resolver delegation 15/15、typecheck 与 whitespace 检查均通过。完整 Beautify suite、process/workflow/notification scope、真实终端视觉仍属于后续 S3/S4/S5，NOT_RUN。

**S3b 嵌套 `subagent_run` / `subagent_message`（已完成，commit `9409042`）**：两个 nested 工具直接采用公共 cooperative self-shell，摘要分别保留 child 类型/描述及 child id/实际 guidance 或 question；正文以 `text(result)` 合并全部 text blocks，因此 expanded 不丢 held reply/message。未触碰 nested manager、registry、mailbox、delivery、wait、timer 或 lifecycle。独立检查发现 message 标题错误显示 `wait`/`notify` 控制模式而未显示用户消息；已改为实际 message 并加入 actual-host 标题断言。最终回归在临时 `PI_CODING_AGENT_DIR` 下运行 `node --test extensions/beautify/__tests__/nested-agent-card.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts extensions/agent-tasks/__tests__/parent-delivery.test.ts`（43/43 PASS，natural exit），`pnpm typecheck` 与 `git diff --check` 均通过。已检查的范围以外的 workflow/process/notification 适配仍 NOT_RUN。

**S3c `monitor` tool（已完成，commit `91eeed9`）**：仅将 monitor tool 的 legacy call heading 替换为公共 cooperative self-shell；标题使用 description，正文合并所有 text blocks，执行结果原有 source/deadline/log/config 内容保持在正文。没有修改 monitor source setup、registry、session lifecycle、batching、notification delivery、schema 或实际结果构造；monitor 自身不创建 timer，计时仍由 Beautify activation 注入。独立 check 与临时环境下的 `node --test extensions/beautify/__tests__/monitor-card.test.ts extensions/process-tasks/__tests__/monitor.test.ts extensions/process-tasks/__tests__/monitor-setup-result.test.ts extensions/process-tasks/__tests__/monitor-session.test.ts extensions/process-tasks/__tests__/monitor-schema.test.ts`（87/87 PASS，natural exit）、`pnpm typecheck`、`git diff --check` 均通过。通知 renderer/monitor batch UI 属于 S4，NOT_RUN。

**S3d 实时 `subagent_workflow` tool（已完成，commit `71addc6`）**：workflow tool 改为公共 cooperative self-shell；从原组件分离出 header-free `renderWorkflowBody()`，其中 collapsed 显示 target state 或 target error、description 与独立展开提示且最多三物理行，expanded 保留 tree/log/warning。tool 的 error/缺失 live task 仍走真实 result text fallback；调用状态/`execution` 由公共卡片所有，workflow 目标状态与运行信息留在正文。独立 CLI/history entry 继续使用 `renderWorkflowEntryCard()` / standalone `renderWorkflowCard()`，未用 ToolRenderers 包装，未改 scheduler、recovery、journal 或 snapshot。临时环境下 `node --test extensions/beautify/__tests__/registered-workflow.test.ts extensions/agent-tasks/__tests__/workflow-card-render.test.ts extensions/agent-tasks/__tests__/workflow-failures.test.ts extensions/agent-tasks/__tests__/workflow-failure-host.test.ts extensions/agent-tasks/__tests__/workflow.test.ts`（91/91 PASS，natural exit）、`pnpm typecheck`、`git diff --check` 均通过；独立 check PASS。完整 `pnpm check` 与真实终端视觉仍 NOT_RUN。

**S3 总结**：顶层/嵌套 agent、monitor tool 与实时 workflow tool 均已迁移；每个子项已独立实际 host/owner 验证、独立 check 和 scoped commit。`process` 消息/monitor batch、parent reply/notice 和 Trellis Check 不是 ToolRenderers surface，保留到 S4；任何接入须使用新的公共通知卡片 adapter，不能强塞进 tool factory。

### S4：通知、reply/notice、monitor batch 与 Trellis Check

**目的**：迁移后台通知、父会话消息和诊断报告；保留实际 delivery 粒度与消息语义。

**规则**：

- 新增无注册副作用的公共 notification-card adapter；message/entry adapter 不使用 ToolRenderers、不拥有工具 clock 或调用状态；
- agent group：用户侧逐成员卡；
- monitor batch：实际 batch 一张卡，UI 不拆包/重组；
- reply/notice：保留独立 entry 与 held result 的既有双通道；两者同时可见时允许重复，不引入 presentation metadata，不改模型 content、wait、投递或消费语义；匹配 waiter reply 不丢；
- Trellis Check：复用安全校验/预算/计数，不改菜单/toast；
- process/monitor 的 absent/resumed/stall/overflow/manifest 语义不压成 completed/failed。

**S4 已确认边界（用户授权）**：用户批准完整 S4 的独立 notification-card adapter；经消息双通道数据流复核后，明确拒绝为 reply/notice UI 去重扩展 persisted result/details metadata。此处优先保留既有交付和模型语义，接受偶发视觉重复；monitor 没有 entry + held-result 的同类路径，不适用该 metadata。

**验证重点**：entry append 失败、held message、匹配 waiter、晚到消息、nested ownership、group partial/consumed/resumed run、monitor batch/overflow/manifest failure/input stall/absent/resumed、坏 entry/message details；验证重复 entry/result 不改变模型/投递语义，而不是要求消除重复。

**提交检查点**：agent delivery 与 process/Trellis 范围可以分别提交；每个提交都有对应 renderer 及 owner 边界测试。

**S4a notification primitive + parent entry（已完成，提交 `5d2e6a5`）**：新增无注册副作用的 `createNotificationCard()`，只拥有 `customMessageBg` shell、共享标题、`outputPad` 与 plain-text 的真实物理行预览；rich body 原样交由 producer。`renderSubagentMessageCard()` 改用该 adapter，标题为 `subagent_message` + label + reply/notice marker。未修改 `appendEntry`、hold/timer、`take`、`sendMessage`、wait 匹配或 `formatHeldMessages`；用户已接受 entry 与 held result 同时可见时的重复。`node --test extensions/beautify/__tests__/notification-card.test.ts extensions/agent-tasks/__tests__/parent-delivery.test.ts`（14/14 PASS，natural exit）、`pnpm typecheck`、`git diff --check` 通过；独立 check PASS。真实终端视觉 NOT_RUN。

**S4b process/monitor notifications（已完成，待 scoped commit）**：`extensions/process-tasks/notification-renderer.ts` 作为 presentation-only adapter 接入已存在的 custom-message renderer。正常 process terminal 保留现有 `failureTailLinesShown` collapsed 预算、expanded 下保留全部已交付 tail；monitor 单源和 stall 使用公共三物理行 preview；monitor batch 仍是一张中性 batch card，不虚构 aggregate terminal state，body 保留每个 source 的原状态与 manifest/overflow 文本。未改 `notify.ts`、`monitor-notifications.ts` 或 `monitoring.ts` 的 delivery、batch、manifest、`outcomeSurfaced`、retry/wait 语义。`node --test extensions/process-tasks/__tests__/notification-renderer.test.ts extensions/process-tasks/__tests__/index.test.ts`（12/12 PASS，natural exit）、`pnpm typecheck`、`git diff --check` 通过；独立 check PASS。真实终端视觉 NOT_RUN。

### S5：集成、独立检查与收尾评估

**目的**：审阅跨层一致性，执行全量检查，记录可覆盖/不可覆盖边界；不扩大到 CLI/history workflow snapshot、Task Panel 或外部 custom renderer 迁移。

**检查**：

- 复审实际 diff、平行改动和每个迁移工具的 caller；
- 独立 `trellis-check` 审查公共 renderer 合同、计时/资源清理、delivery 语义和测试缺口；
- 运行 selected focused checks、typecheck/full suite、`git diff --check`；
- 评估是否需更新开发 spec 或用户文档。仅在实际用户可见行为需要说明时修改文档；不添加内部测试教程。

## 验证命令

实施后以 testing spec 的 isolated existing-SDK 环境运行；禁止 dependency fetching。测试命令应在 owned temporary agent directory 中执行，原始 stdout/stderr 留在 owned external run directory。

预期 focused 覆盖：

```sh
node --test extensions/beautify/__tests__/*.test.ts
node --test extensions/agent-tasks/__tests__/parent-delivery.test.ts extensions/agent-tasks/__tests__/workflow-card-render.test.ts extensions/agent-tasks/__tests__/workflow-failures.test.ts extensions/agent-tasks/__tests__/workflow-failure-host.test.ts
node --test extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts extensions/agent-tasks/__tests__/auxiliary-lifecycle.test.ts
node --test extensions/process-tasks/__tests__/index.test.ts extensions/process-tasks/__tests__/monitor-notifications.test.ts extensions/process-tasks/__tests__/monitor-buffer.test.ts extensions/process-tasks/__tests__/lifecycle.test.ts
node --test extensions/trellis/__tests__/dispatch.test.mjs extensions/trellis/__tests__/init-review.test.mjs scripts/pi-manifest.test.mjs
pnpm check
git diff --check
```

新增 card/clock/adapter 测试应加入相应 focused 命令。计时和 activation cleanup 必须通过不含 `--test-force-exit` 的 natural-exit focused tests；全仓强制退出 PASS 不能证明 timer/listener 清理。

Trellis 保持 fake-pi `.mjs` 测试约束，不增加真实 Trellis TUI/menu 测试。真实终端、外部包组合和不可达 HTML 路径若未运行，明确记录 `NOT_RUN`，不以 source probe 代替视觉验收。

## 已有只读证据与限制

范围审查使用 Node v24.14.1 报告：focused suites 42/42 PASS、monitor/batch/lifecycle 45/45 PASS。这些仅证明修改前既有行为，不是本任务实现验收。

探针首次因未初始化 SDK theme 失败；复用已有 `renderer-host.mjs` fixture 后通过，确认两件既有问题：CLI workflow entry 不显示特定错误/返回值，长 notice 在窄宽度可产生 14 个实际行。workflow entry 问题按已批准范围保持不扩张；notice 行数由 S1/S4 覆盖。

临时审查材料在 `/tmp/pi-tool-card-audit.nhIg4B/`；它不是唯一证据。主会话在实施阶段须记录实际命令、环境、exit code、失败和 rerun 关系。

## 停止与回滚条件

- 必须修改 Pi 宿主、外部包或引入未批准私有 renderer seam 才能接入：停止该项，报告边界。
- 无法可靠标识 reply/notice、会丢模型消息或改变 delivery/wait 语义：停止该子阶段，保留原交付。
- 实现需要触及 Task Panel、workflow recovery/source、执行控制或其他任务文件：重新确认范围。
- renderer 回归：仅定位和回滚本任务 scoped 提交，不 reset 其他会话内容或整个工作树。
