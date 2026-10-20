# 实施与验证计划

## 状态与前提

本计划已获用户批准分阶段实施。S1 已完成并提交；S2 已完成实现与独立检查，当前待 scoped commit。任何涉及产品语义、公共接口边界、范围扩大或无法安全适配的设计问题，先暂停并向用户反馈，不自行延伸。

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

**S2 结果（已完成，待 scoped commit）**：新增 `tool-card.ts` 的公共 self-shell factory。全局 resolver 仅在 `next()` 缺失时创建 generic card；任意下游 custom renderer 完整原样委托。generic card 自有 Box/padding 并保留正文点击展开、三行文本预览与 host image 所有权；不拆分原生/外部 custom renderer。`tool-clock.ts` 改为观测所有顶层工具：运行中返回 `elapsed`，最终优先读取宿主 `durationMs` 并显示 `execution`，不持久化 call 时钟；nested call、session start/shutdown 均清理/忽略。read/bash/find/grep 的既有 owned adapter 接入相同计时显示，Bash 不再显示旧 `call` 标签。

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

### S4：通知、reply/notice、monitor batch 与 Trellis Check

**目的**：迁移后台通知、父会话消息和诊断报告；保留实际 delivery 粒度与消息语义。

**规则**：

- agent group：用户侧逐成员卡；
- monitor batch：实际 batch 一张卡，UI 不拆包/重组；
- reply/notice：结构化身份去重，已有可见 entry 不重复显示，matched reply 不丢；
- Trellis Check：复用安全校验/预算/计数，不改菜单/toast；
- process/monitor 的 absent/resumed/stall/overflow/manifest 语义不压成 completed/failed。

**验证重点**：entry append 失败、compaction/tree 可见性变化、held message、匹配 waiter、晚到消息、nested ownership、group partial/consumed/resumed run、monitor batch/overflow/manifest failure/input stall/absent/resumed、坏 entry/message details。

**提交检查点**：agent delivery 与 process/Trellis 范围可以分别提交；每个提交都有对应 renderer 及 owner 边界测试。

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
