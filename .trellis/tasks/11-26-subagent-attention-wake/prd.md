# Subagent attention notices wake parent waits

## Goal

主 agent 处于 wait 时，子 agent 通过 `reply_to_parent` 发出的 notice 被暂存到 wait 结束（通常即执行结束）才交给模型。若 notice 需要父 agent 改变指令，父 agent 只能空等子 agent 沿错误方向跑完。

目标：notice 分级。`info` 保持现有暂存行为；`attention` 立即结束父 agent 对该执行的 wait，让父 agent 看到消息并决定 steer / stop / 再次等待。顶层与嵌套行为一致。

## Background（已确认事实）

- 顶层消息投递：`extensions/agent-tasks/src/parent-delivery.ts`。用户卡片（`appendEntry`）立即显示；模型侧消息在存在该执行的 wait 时暂存，wait 结束后经 `take()` 并入结果（`formatHeldMessages`），否则 200ms（`MESSAGE_HOLD_MS`）后以 steer 送达。
- wait 由 `extensions/task-ui/coordinator.ts` 的 `registerWait` 管理，lease 具备 `detach(reason)`；`DetachReason` 为 `"manual" | "timeout"`（`task-ui/types.ts:172`）。delivery 只能用 `countWaits` 查询，无法驱动 lease。
- 顶层三类 wait：
  - 前台 `subagent_run` / 前台 resume：`kind: "launch"`，detach 经 `manager.detachRun` 转入后台（`index.ts` 约 1702、1928 行）。
  - `agent_manage wait`：`kind: "retrieval"`，detach 仅释放等待（`management.ts:69`）；暂存消息经 `onManagementResult` 追加（`index.ts` 约 2003 行）。
  - `subagent_message reply:"wait"`：在 `index.ts` 约 2573 行注册 lease 等待 request 回复。
- 持久化的工具结果 details 校验 `detachReason` 仅允许 `manual`/`timeout`（`index.ts:279`），渲染文案见 `index.ts:326`；`activity.ts:18` 类型同。
- 嵌套 agent：
  - 前台启动走 `manager.spawnAndWait`，直接 await terminal，无 lease/detach；嵌套 delivery 在 `nested-tools.ts` `createNestedDelivery` 独立实现（hold/take/release），送达方式为向父 agent session steer。
  - 嵌套后台启动要求父 agent 拥有可用的 agent_manage（`nested-tools.ts:357` `canCollectBackground`），否则后台子 agent 的结果无法收集，父结束时会被 `abortOwnedChildren` 终止。
  - 嵌套 `agent_manage` 由 `agent-manager.ts` 约 983 行的 management 工厂按子 session 创建，使用子 session 自己的 coordinator。
  - 嵌套 `subagent_message reply:"wait"` 用 `nestedWait` 等待 mailbox waiter（`nested-tools.ts` 约 593 行）。
- workflow 子 agent 无 mailbox（`agent-manager.ts:776`）。
- 子侧工具 `reply_to_parent`（`parent-messaging.ts`）参数 `message`、`request_id`；每次执行最多 30 条消息、每条 4096 字节。

## Decisions

- D1 嵌套 agent 前台等待纳入本任务，行为与顶层一致。
- D2 attention 打断 `subagent_message reply:"wait"`（顶层与嵌套）：结果含 attention 消息，问题仍开放，回复稍后送达。
- D3 不单独限制 attention 次数，仅靠 guidance 约束；仍受每次执行 30 条消息总上限。
- D4 嵌套前台 launch 在父 agent 无可用 agent_manage 时无法安全转后台：此时 attention 不 detach 该 launch，按 info 暂存，并在子侧工具结果中说明未能唤醒。该限制只作用于前台 launch：嵌套 `subagent_message reply:"wait"` 始终可打断；嵌套 `agent_manage wait` 存在即意味着 agent_manage 可用，始终可打断。
- D5 嵌套 `agent_manage wait` 被打断后，attention 消息不并入 wait 结果，而是保持现有 steer 排队送达；结果文案提示消息随后送达。

## Requirements

- R1 `reply_to_parent` 新增 `urgency` 参数：`"info"`（默认语义）| `"attention"`；仅 notice（`request_id` 为 `"null"`）可用 attention，与 request_id 同时给出时拒绝。
- R2 attention 到达时，父侧所有正在等待该执行的 wait（前台 launch、`agent_manage wait`、`subagent_message reply:"wait"`）立即结束；结果包含此 attention 及之前暂存的消息，并说明执行仍在运行与后续选项。
- R3 info notice 行为不变；不在 wait 时 attention 与 info 均按现有 steer 送达。
- R4 前台 launch 被唤醒后执行转入后台，结果文案说明最终结果经完成通知（顶层）或 `agent_manage wait`（嵌套）获得，不显示为用户手动转后台。
- R5 `agent_manage wait` 被唤醒返回新的 `wait_outcome: "message"`，目标执行不变。
- R6 父/子 guidance 更新：attention 仅用于父 agent 很可能需要改变指令的情况；被唤醒后应如何处理。
- R7 持久化数据兼容：新字段可选，旧 session 卡片与工具结果正常渲染；卡片区分 attention。
- R8 子侧工具结果告知 attention 是否唤醒了父 agent 的等待（未唤醒不代表失败）。

## Acceptance Criteria

- [ ] 顶层前台 `subagent_run`（含前台 resume）wait 中收到 attention：调用立即返回且含该消息，子 agent 后台继续并最终触发完成通知。
- [ ] 顶层 `agent_manage wait` 收到 attention：立即返回 `wait_outcome: "message"`，含消息，执行不受影响。
- [ ] 顶层 `subagent_message reply:"wait"` 收到 attention：立即返回含消息，随后的回复照常送达。
- [ ] 嵌套前台 `subagent_run`（父有 agent_manage）收到 attention：立即返回，子 agent 后台继续，可用嵌套 `agent_manage wait` 取回结果；父无 agent_manage 时按 info 暂存。
- [ ] 嵌套 `agent_manage wait` 与嵌套 `subagent_message reply:"wait"` 同样被唤醒。
- [ ] info notice 在上述 wait 中仍暂存到 wait 结束。
- [ ] attention 与子 agent 完成竞争时只有一个结果生效，消息不丢失、不重复。
- [ ] 旧 session 中无新字段的卡片与工具结果正常渲染；`request_id` 与 `urgency:"attention"` 同时给出被拒绝。
- [ ] `pnpm run check` 通过。

## Out of Scope

- workflow 子 agent（无父消息通道）。
- attention 次数限制。
- 用户手动 detach、timeout 等现有 wait 行为的改变。
