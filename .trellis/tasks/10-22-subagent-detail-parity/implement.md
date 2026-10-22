# 实施计划

## 授权与执行策略

- 用户已批准最终整页方案并指示开工，授权以下分阶段实施、验证和主会话本地提交。
- 主会话协调；阶段 1 委托 trellis-implement 处理完整调用计时/顶部背景纵向切片，随后独立 trellis-check；阶段 2/3 按实际上下文选择执行者。子代理不提交，所有同目录编辑串行协调。
- 使用策划 implement/check manifests；不创建 worktree。
- 取得最终实施批准后，按以下阶段实施、验证及本地提交；不 push，不安装依赖，不修改个人配置，不自动 reload 或归档。
- 临时驱动/日志使用本次自建的仓库外临时目录。记录 PASS/FAIL/NOT_RUN 与失败原因，检查后只清理本次拥有且无活跃进程使用的材料。

## 阶段 1：调用级状态和计时

- [ ] 完整复核实际工具事件、准备阶段 activity、resume、并行调用及既有 cleanup。
- [ ] 扩展有界运行态快照与调用/结果关联；展示状态和工具耗时，保留独立 Agent 总耗时。
- [ ] 测试完成/失败/取消/同名并行/迟到事件/历史缺失计时，不使旧状态跨 run 泄漏。
- [ ] 自审与独立跨层审查后本地提交本阶段。

## 阶段 2：待处理消息与失败反馈

- [ ] 接入准备前 pendingSteers 与 session 公共队列事件，确保 handoff 连续可见。
- [ ] 详情页输入区域附近展示有界 pending 快照和失败反馈。
- [ ] 测试多条/重复/早期消息、异步拒绝、实际消费、历史浏览、重进页面、resize、stop/resume/shutdown。
- [ ] 自审与独立跨层审查后本地提交本阶段。

## 阶段 3：紧凑卡片与展开

- [ ] 合并可关联调用与结果，read/grep/find 默认摘要，通用结果默认 3 个视觉行。
- [ ] 展开当前已加载有界内容，不保留 40 行额外限制；准确展示源截断和折叠隐藏。
- [ ] 测试分页边界/缺失配对/稳定 ID/鼠标命中/锚点/中文 emoji/窄宽尺寸/主题。
- [ ] 更新必要用户文档，自审后提交本阶段；涉及新跨层配对契约时纳入独立审查。

## 检查入口

所有测试使用现有 SDK、隔离的临时 PI_CODING_AGENT_DIR；不得读取个人配置或下载依赖。最终命令根据实际改动选定，不把下面计划视为已运行。

```sh
node --test extensions/task-ui/__tests__/*.test.ts
node --test extensions/agent-tasks/__tests__/*.test.ts
node --test extensions/beautify/__tests__/*.test.ts
pnpm typecheck
pnpm check
git diff --check
```

- 聚焦测试不使用 --test-force-exit，验证 timers/subscriptions 的自然退出。
- cross-layer/SDK 测试必须驱动实际 runner/manager/source/panel 或真实 AgentSession 公共事件，而非复制算法。
- 最终回归包含 process/runtime-task wait/生命周期兼容性；完整 pnpm check 与聚焦自然退出结果分开记录。
- 检查链接、文档声明与最终 Git diff；独立审查的 summary 不是验收证据，主会话复核实际改动和测试。
- 隔离真实终端复现若缺少测试设施或需要额外外部资源，停止该验证并记录限制，不修改个人安装来绕过。

## 结果记录

### 阶段 2：已实施并独立审查

- 完成固定高度 Pending 独立滚动区、Tab/鼠标区域切换、只读全文查看、Failed 原文恢复和手动重发，以及准备前/SDK 队列 handoff。
- 重启中断原代理，原 transcript 无法恢复；新执行者接续实际未提交代码和日志，不重做。原 stage2/natural-final.log 无最终汇总，NOT_PASS。
- 恢复第一轮自然检查暴露 2 个 resume rollback 回归及 minimal subscribe fixture 挂起，取消该失败运行保留日志，修复 observation 安装顺序/optional subscribe 后复跑；该取消还造成 worktree case cancellation，不抹去。第一次 full check 1636/1637 因旧标签断言失败，改为实际 view.title；并行标签工作随后由其他会话提交 `9cb4505`，本任务保留且不纳入其提交范围。
- reviewer 修复 omission 丢失、reentrant unsubscribe ownership、bounded duplicate identity/FIFO、原文 whitespace 被 trim、Failed reader 错误标题。
- reviewer 复现外部 queue 增长被误认成异步 UI 原文，消费后 Failed 记录丢失（correlation-before exit1）。采用公共队列真实文本，等待期间 Submitting 原文独立保留，只有 steer Promise 明确 queued 才移除原文/替换旧失败项；handled 中性提示，拒绝 Failed，不猜 transformed 归属。回归复现修复后 exit0；短暂 Submitting 与真实 Pending 并存如实区分，不隐藏外部入队事件。
- 最终现有 SDK 解析到 1.4.0（非本任务安装）；隔离配置自然 task-ui/agent-tasks/process-tasks/runtime-tasks 868/868 exit0，最后 stale guard 顺序调整后 affected focused6/6 exit0、pnpm typecheck exit0、git diff --check exit0。
- `pnpm check` 本轮 exit1：1641 中1627通过/14失败，为 at-path-completion/beautify/widget-display fixture 调用 SDK resetExtensionUI 时 interactive-mode.js:1899 读取 undefined.length。未在范围外修复，final full suite 未重跑，不引用较早 full PASS 作为当前最终结果。
- 日志 `/tmp/subagent-detail-parity.9eqCCh/stage2-recovery`、`review2`；真实终端/IME/在线 provider NOT_RUN。
- 本阶段提交待记录。阶段3共享组件复用与完整参数展示正进行只读评估，未实施。

### 阶段 1：已实施并独立审查

- 完成调用 ID/状态/计时跨层传播、128 项 run-scoped 有界工具快照、并行同名调用与 stop/resume/迟到事件隔离；未知历史时长不推算。
- 顶部固定单行身份/终态背景，底部独立总 runtime；取消仍未结束时保持 cleanup pending。
- 独立 reviewer 修复两项：主题语义前景叠在 tint 上仅约 3.0–3.4:1 对比度，改用 theme text 达到约 6.1–6.5:1；runner settled 但 session.abort 未结束时清理提示过早消失，增加仅用于显示的 run-scoped pending stop tracking。另补窄屏优先级与 activity 控制字符清理。
- 原实施失败已诊断：tiny-header 预期需调整；测试假定 getThemeByName 公共导出及 SDK event/settings 字段不成立；tool-waits 实际调用 fixture 缺少 ID。修复 fixture/预期后重跑，不抹去初始失败事实。
- 隔离环境：临时 PI_CODING_AGENT_DIR、现有已安装 SDK，无安装或个人配置读写。实施聚焦自然退出 180/180、Agent 全套自然退出 296/296、pnpm typecheck 均 exit 0；实施 pnpm check 1633/1633 exit 0。
- reviewer 最终 `node --test` task-ui/agent-tasks/process-tasks/runtime-tasks 自然退出 861/861 exit 0；`pnpm check`（含 strict typecheck）1635/1635 exit 0；`git diff --check` exit 0。主会话复核实际 diff、SDK 测试和结果日志，补齐本阶段用户文档。
- 日志暂存于本次拥有的 `/tmp/subagent-detail-parity.9eqCCh/stage1` 与 `review1`；真实终端外观与在线 provider NOT_RUN，组件/调色板测量不冒充视觉验收。
- 阶段 2 开始前确认内部预算：仅 UI 原文保留/恢复 admission 128 项、合计 512KiB UTF-8，上限前可见拒绝，不改变公开消息工具 delivery；外部队列有界投影如实标注省略，不伪称原文完整。SDK input handler 的 handled 结果不是失败，采用 muted 的 Handled by input extension · not queued，真实异步拒绝才为 Failed，不自动重试。初次 stage2 探索因这两项解释暂停，未改产品或跑测试；主会话澄清后继续。
- 本阶段提交：`1363940 feat(task-ui): show subagent tool timing and terminal surfaces`。阶段 2 开始；阶段 3 尚未实施。

