# Implementation Plan

执行者：主会话直接实现；每阶段自查后提交。阶段 3 完成后派 `trellis-check` 独立审查（需届时整理 check.jsonl）。

## 阶段 1：消息模型与 wait 唤醒原语（顶层）
- `parent-messaging.ts`：`urgency` 参数解析/校验、`ChildMessage.urgency`、`woke` 回填、guidance。
- `agent-manager.ts`：`parentChannel.send` 传递 urgency 与唤醒收集；`detachRun` 支持 `"message"`。
- `task-ui/types.ts`、`task-ui/coordinator.ts`：`DetachReason` 加 `"message"`，`detachWaits`。
- `parent-delivery.ts`：attention 立即唤醒；卡片 urgency。
- `index.ts`、`management.ts`、`activity.ts`：三类顶层 wait 的结果文案、`wait_outcome: "message"`、`detachReason` 校验/渲染。
- 测试：`parent-messaging.test.ts`、`parent-delivery.test.ts`、`tool-waits.test.ts`、`backend-waits.test.ts`、task-ui coordinator 测试。
- 验证：`pnpm run typecheck`；`node --test extensions/agent-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts`。
- 提交：`feat(agent-tasks): wake parent waits on attention notices`。

## 阶段 2：嵌套等待
- `agent-manager.ts`：可唤醒的 `spawnAndWait`；management 工厂订阅 attention 并 `detachWaits`。
- `nested-tools.ts`：waker 注册表、前台 launch 唤醒（受 `canCollectBackground` 约束）、`nestedWait` 唤醒、文案。
- 测试：嵌套前台 launch（有/无 agent_manage）、嵌套 agent_manage wait、嵌套 reply wait、竞争。
- 验证同上。提交：`feat(agent-tasks): wake nested waits on attention notices`。

## 阶段 3：Guidance 与收尾
- `tool-guidance.ts` 父侧说明；核对子侧 guidance。
- `pnpm run check` 全量通过。
- 提交：`docs(agent-tasks): guide attention notice handling`（若与前阶段耦合则并入）。

## 风险点
- lease complete/detach 竞争与消息不重复：重点测试。
- `detachReason` 持久化校验遗漏导致新结果渲染降级。
- 嵌套无 agent_manage 时误转后台导致结果丢失。

## 记录

### 阶段 1（顶层）— 提交 7ad0fff
- 基线：HEAD 上 `tsc -p tsconfig.json` 已有 11 个与本任务无关的错误（memory/panel、task-ui/conversation、detail-tool-card、trellis task-browser、beautify title-tones 测试、agent-tasks index.ts:362，均为 readonly string[]，来自已链接的 SDK 1.6.1）。本阶段没有新增类型错误。
- 下面这条命令在隔离的 `PI_CODING_AGENT_DIR` 下运行，未使用 force-exit：
  `node --test extensions/agent-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts`
  结果为 1027 条用例，1026 通过，1 失败。失败用例是 `process-tasks/__tests__/bash-schema.test.ts` 的 outputSchema 字段列表（SDK 新增 `full_output_error`）。已在干净的 HEAD worktree 复现同一失败，与本任务无关。
- 新增测试：parent-messaging（urgency 校验、woke 聚合）、parent-delivery（前台 launch、agent_manage wait、reply wait 被唤醒；无 wait 时按 notice 送达；竞争时只送达一次；卡片 attention 标记）、task-ui coordinator（`detachWaits`）。

### 阶段 2（嵌套）
- `AgentManager.spawnAndWait` / `resume` 支持 `wake` 信号：信号先于结束时调用 `detachRun(identity, "message")` 并返回未消费的记录；若执行已结束则按普通结果返回。
- 嵌套 delivery 新增一次性 waker 注册：消息先暂存，再调用 waker。前台 launch 与 live-session resume 只在 `canCollectBackground() !== false` 时注册；reply wait 始终注册。嵌套 agent_manage wait 通过 `wakeOnAttention` 订阅 attention 并 detach lease，消息仍按 steer 送达。
- 行为调整：嵌套 live-session 前台 resume 现在与前台 launch 一样，等待期间收到的消息先暂存，结束时并入结果。此前这些消息会立即 steer 进父会话，但父会话在调用返回前同样看不到。因此改动只影响消息出现的位置（工具结果内，或结果之后的独立消息），送达时机和内容都不变。
- 同一组受影响套件（隔离、无 force-exit）：1032 条，1031 通过，1 失败。失败仍是阶段 1 已记录的 `bash-schema` 用例，未出现新的失败。

### 阶段 3（guidance 与全量验证）
- 父侧 guidance：`subagent_run`（顶层/嵌套）说明前台等待可被 attention 提前结束；`subagent_message` 说明 reply wait 会因 attention 结束，并说明 attention 标记；`agent_manage` 说明 `wait_outcome: "message"`。
- `pnpm run typecheck`：共 11 个错误，与 HEAD 基线相同，均为既有错误。
- `pnpm run test`（隔离 `PI_SDK_DIR`、`PI_CODING_AGENT_DIR`，配置为 force-exit）：1958 条，1957 通过，1 失败。失败仍是既有的 `bash-schema` outputSchema 用例。
- 自然退出（不使用 force-exit）的受影响套件结果见阶段 1、2。

### 独立审查（trellis-check，agent_trellis_check_0_a623b7b7）
- 结论：无阻塞问题。审查方运行的聚焦套件（自然退出）639 条全部通过；tsc 只有 11 个既有错误。
- 发现 1（低）：`subagent_message` guidance 为顶层和嵌套共用，对嵌套场景的描述不准确。已修复：`messageToolGuidance` 增加 `nested` 选项，嵌套文案写明 D4、D5 的例外。
- 发现 2（低，需决定）：`urgency` 比 PRD 字面要求更严格，notice 必须填 info 或 attention，reply 必须填 "null"。决定保留：项目约定控制字段必须给出明确的哨兵值，guidance 和测试与此一致。R1 的“默认语义”指 info 行为，不代表可以省略该字段。
- 发现 3（信息）：嵌套 live resume 原先根据记录状态推断是否已转后台。已修复：`resume` 通过 `onDetached` 回传 `awaitForeground` 的 detached 标志。
- 修复后复跑：`node --test extensions/agent-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts`（隔离环境，自然退出），639/639 通过，exit 0；tsc 仍只有 11 个既有错误。
