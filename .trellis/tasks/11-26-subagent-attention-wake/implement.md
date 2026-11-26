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
- 执行命令、结果与失败原因在此追加。
