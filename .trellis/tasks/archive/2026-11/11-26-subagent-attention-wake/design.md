# Design

## 数据模型

- `ChildMessage` 增加 `urgency?: "attention"`（缺省即 info，旧数据天然兼容）。
- `AgentMailbox.accept(runId, text, requestId, urgency)`：`requestId !== null && urgency === "attention"` 返回错误。
- `AcceptedChildMessage` 增加 `woke: boolean`，由投递层在同步回调中回填，供子侧工具结果使用（R8）。实现方式：`parentChannel.send` 在调用 listeners 时传入可变的 `{ woke }` 收集器，listener 返回是否唤醒。
- `SubagentMessageEntryData` 增加可选 `urgency`；卡片 marker 用 `attention`（warning tone）区分。

## Wait 唤醒原语

- `task-ui/types.ts`：`DetachReason` 增加 `"message"`。
- `TaskCoordinator.detachWaits(identity, reason): number`：同步 detach 该 identity 的全部 wait，返回数量。
- `registerAgentWait` 的 `onDetach` 已把 reason 传给 `manager.detachRun`；`detachRun` 的 executionConfig 差异仅对 `manual` 记录，`message` 记录为 `reason: "attention-detach"`（新增 difference reason）以便模型知道为何转后台。
- `detachReason` 校验与渲染（`index.ts:279/326`、`activity.ts`）接受 `"message"`，文案 “backgrounded after an attention message”。
- workflow 侧 `workflow/management.ts:54` 等现有文案只处理 manual/timeout；workflow 无 mailbox，不会收到 `message`，但类型扩展后需保证分支穷尽（编译检查）。

## 顶层投递（parent-delivery.ts）

attention 到达（`accepted.deliveredToWaiter` 为 false 的 notice）：
1. `appendEntry` 卡片（同现状）。
2. 消息放入 pending（同现状）。
3. 若 `waiting(agentId, runId)`：同步调用 `coordinator.detachWaits(identity, "message")`。各 wait 的结束路径已经在返回前调用 `take()`，因此消息随结果返回；`subscribeWaits` 会重排剩余 pending，不会重复。
4. 无 wait：走现有 200ms 调度 steer。

竞争：lease `finish` 以 `settled` 保证 complete/detach 只有一个生效。若 complete 先赢，消息随完成结果返回；detach 先赢则走后台路径，完成通知照常。

## 顶层各 wait 结果

- 前台 launch（`index.ts` ~1702/1928）：`outcome.reason === "message"` 时文案：子 agent 发来 attention 消息，执行已转入后台继续；可用 `subagent_message` 引导、`agent_manage stop` 停止或 `agent_manage wait` 继续等待；完成后会通知。消息经 `withHeldMessages` 追加。
- `agent_manage wait`（`management.ts`）：`detached` + `reason === "message"` → `wait_outcome: "message"`，文案 “Wait ended by an attention message; target still running.” 消息经 `onManagementResult` 追加。需让 management 的结果路径能拿到 detach reason（WaitOutcome 已含 reason）。
- `subagent_message reply:"wait"`（`index.ts` ~2573）：其 lease 的 identity 与该执行一致，`detachWaits` 一并结束；文案复用 released 路径但说明原因是 attention，消息需显式 `delivery.take()` 追加（核实现有路径是否已 take）。

## 嵌套

### 唤醒注册表
在 `createNestedDelivery` 内维护 `wakers: Map<key(id, runId), Set<() => void>>`。三种嵌套等待注册 waker；attention 到达且 identity 在 `waiting` 中时，消息先入 `held`，再同步调用所有 waker。

### 嵌套前台 launch
- `AgentManager` 新增 `spawnAndWaitDetachable(...)`（或给 `spawnAndWait` 加 `wake` 选项）：`Promise.race(run.terminal, wakeSignal)`；被唤醒时调用 `detachRun(identity, "message")`，不 `consumeRun`，返回 `{ kind: "detached", record }`。
- 只有 `context.canCollectBackground?.() !== false` 时注册 waker（D4）；否则 attention 只暂存，子侧结果 `woke=false`。
- 被唤醒的结果文案：执行已转入后台，需在结束前用 `agent_manage wait` 收集结果；附 held 消息。
- 竞争：terminal 与 wake 同时就绪时优先 terminal（检查 `run.terminalResolved`），detachRun 前再确认未结束。

### 嵌套 agent_manage wait
management 工厂（`agent-manager.ts` ~983）中的 coordinator 属于子 session。在工厂内订阅 `subscribeParentMessages`，对 owned 子 agent 的 attention 调用 `coordinator.detachWaits(identity, "message")`；结果追加该消息需要嵌套 delivery 的 held 消息——嵌套 management wait 目前不 hold 消息（消息直接 steer 到被阻塞的父 session，wait 结束后可见）。保持此方式：唤醒后消息已作为 steer 排队，结果文案提示“见随后消息”即可，避免跨对象 take。

### 嵌套 subagent_message reply:"wait"
`nestedWait` 增加 wake promise；唤醒结果复用 released 路径，追加 `nestedDelivery.take()` 的消息。

## Guidance

- `reply_to_parent`：新增 urgency 说明与示例；attention 仅用于父 agent 很可能需要改变指令（方向错误、范围显著变化、需要决策但可继续）；常规进展不用 notice。
- 父侧 `subagent_run`/`agent_manage`/`subagent_message` guidance：wait 可能因 attention 提前结束，执行仍在运行，需决定 steer/stop/再次 wait。前台 launch 被唤醒后转为后台。
- 遵循 agent-only-tool-usage：教学只在 tool guidance 中，不写入用户 docs 或长期 spec。

## 兼容与回滚

- 全部新字段可选；旧 session 数据渲染不变。
- 单次提交可整体 revert，无数据迁移。
