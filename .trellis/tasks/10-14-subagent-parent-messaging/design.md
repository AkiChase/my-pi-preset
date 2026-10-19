# 子代理中途消息设计

决策编号引用 `prd.md`（D1–D14）。

## 1. 范围与所有权

- 消息与请求状态归 agent backend（`extensions/agent-tasks`），不新增全局 registry；runtime-tasks facade 不改。`agent_manage` 仅 subagent `wait` 结果附带等待期间消息（D8、D14）。
- 子工具只拿到受限父通道（按 record 绑定的发送函数），拿不到 manager、root session 或其他 agent。
- 规划时代码事实（实施前复核行号）：
  - 子会话工具经 `agent-runner.ts` 的 `customTools` 注入（约 :1105），`StructuredOutput` 为先例；嵌套工具仅在 `agentConfig.allowedSubagents && nestedRuntime && !isolated` 时注入（约 :959）；workflow 子代理有 `options.workflow` 标识（约 :714）。
  - 主 `subagent_message` 在 `index.ts` 约 :2799；嵌套版在 `nested-tools.ts` 约 :417。会话未就绪时写 `record.pendingSteers`，`agent-manager.ts` 约 :993 flush。
  - 完成通知 `formatTaskNotification`（`index.ts` 约 :198），`deliverAs: "followUp", triggerTurn: true`；`scheduleNudge` 200ms hold。
  - `registerEntryRenderer` 先例：`WORKFLOW_ENTRY_TYPE`（`index.ts` 约 :462）。
  - 等待：`management.ts` 的 subagent `wait` 使用 `registerAgentWait`（`waits.ts`），支持 Esc / detach。
  - 任务面板详情：`task-ui/panel.ts` 通过 `coordinator.detail(selected)` 取 `TaskDetail`。
  - SDK `sendCustomMessage`：`nextTurn` 排队；streaming 且 `triggerTurn !== false` 时 `followUp` / `steer` 入队；非 streaming 且 `triggerTurn` 时立即开始新一轮。`appendEntry` 立即写入并发出 `entry_appended`，交互模式立即加入聊天区，且不进入上下文。

## 2. 接口

### 2.1 子侧 `reply_to_parent`

```ts
reply_to_parent({ message: string, request_id: string | null })
```

- 两字段 required；`request_id` 为 `Union[null, String]`，按 nullable 契约在副作用前归一化。
- 文案固定（英文）：`request_id` 来自 `<parent-request>` 消息；非 null 为回复，null 为主动告知且应继续执行；需要父代理决策时应正常结束并在最终回复中说明，不要调用本工具后等待。
- 成功结果仅表示宿主已接收，不表示父代理已读。
- 拒绝：空白 / 超 4KB message；超过每执行 30 条发送上限；`request_id` 不存在 / 已回复 / 已关闭 / 属于其他执行；通道关闭。
- 注入条件：非 workflow 子代理的新建会话。与 `StructuredOutput` 一样作为 customTool 并在工具 gate 中保活，不受 isolated / 扩展关闭 / 工具列表影响。

### 2.2 父侧 `subagent_message`（主与嵌套）

```ts
subagent_message({ agent_id: string, message: string, reply: "wait" | "notify" | null })
```

- `reply` required、nullable；null 保持现有行为与返回文本（回归测试锁定）。
- 非 null 时：
  1. 沿用现有目标 / owner / 运行状态校验。
  2. 检查请求上限（未完成 ≤ 8，每执行 ≤ 30）。
  3. 生成 `request_id`（宿主分配，`req_` + 短随机），登记请求并绑定 `agent_id` + 当前 `execution_id`。
  4. 投递：原 message 作为普通 steering；随后在同一队列发送自定义消息 `<parent-request request_id="req_…" reply_tool="reply_to_parent" />`（子会话 `sendCustomMessage`，`deliverAs: "steer"`）。会话未就绪时两条一起进入 pending 队列（`pendingSteers` 扩展为可区分普通 steer 与自定义消息，或新增并行队列，按序 flush）。
  5. 投递失败：请求标 `failed`，返回错误。
- `"notify"`：立即返回 `request_id`、`execution_id`、投递阶段。
- `"wait"`：注册 waiter，复用 `waits.ts` 的 Esc / detach 机制，无超时：
  - `replied`：返回回复正文；该回复不再另行送达，也不显示卡片（工具结果卡片已可见）。
  - `cancelled` / `released`：返回 `request_id` 与"等待已结束、请求仍有效"；之后的回复正常送达。
  - `execution_ended`：执行结束未回复，返回说明，提示查看完成结果。

## 3. 送达

### 3.1 顶层（父为主会话）

对每条已接收、未被 waiter 交付的子代理消息：

1. **对话卡片**：`pi.appendEntry(SUBAGENT_MESSAGE_ENTRY, data)` + `registerEntryRenderer`。标题 `↩ <agent> · reply req_x` / `↩ <agent> · notice`，正文默认折叠可展开，风格与完成通知一致；会话恢复时重新渲染。
2. **上下文**，取决于父代理当前对该执行的等待状态：
   - 父代理正在前台 `subagent_run` 或 `agent_manage wait` 等待该执行：消息暂存，附在该等待的最终结果中返回（结果文本末尾 `Messages received during wait:` 区块），不另行送达。等待被 Esc / detach 释放时，暂存消息转为正常送达。
   - 否则：`pi.sendMessage({ customType: "subagent-message", content, display: false, details }, { triggerTurn: true, deliverAs: "steer" })`。空闲时唤醒；忙碌时在当前这批工具结果后进入上下文。
3. **任务面板**：agent TaskView 增加最新消息摘要字段（单行截断），运行中条目显示；详情页 Messages 区块见 §5。

细节：

- 同一 agent 的消息按 per-agent hold（约 200ms，与 nudge hold 一致）合并为一条上下文消息；卡片逐条显示。
- 上下文消息正文：`<subagent-message agent-id execution-id request-id|notice>` 包裹并转义正文，风格与 `<task-notification>` 一致。
- 顺序：执行收尾时先 flush 该执行的待送达消息，再允许完成通知发送。
- 失活后不发送；`sendMessage` 抛错时以固定文案 warning 提示（同 `reportNoticeFailure`），不重试、不影响子代理。

### 3.2 嵌套（父为子代理会话）

- 无对话卡片、无主会话上下文消息。
- 父子代理正在前台嵌套 `subagent_run` 等待该孙代理：暂存并附在结果中（同 3.1）。
- 父子代理运行中但未等待：通过父子代理 session 的 `sendCustomMessage(…, { deliverAs: "steer" })` 送达同格式消息。
- 父子代理已结束本轮：不唤醒；消息仅记录，详情页可见。
- 嵌套 `subagent_message` 的 `reply: "wait"` 同 2.2。

## 4. 数据与生命周期

每个 agent record 持有一个 mailbox（仅内存）：

- 请求：`request_id`、`execution_id`、问题摘要、状态（`pending` → `replied` / `failed` / `closed`；关闭原因 `execution_ended` / `stopped` / `shutdown`）、waiter。停止时在终态解析时即关闭，不等待不配合取消的 runner 实际退出。
- 消息：执行内递增序号、`execution_id`、`request_id | null`、正文、时间、交付方式（waiter / 等待结果附带 / 送达 / 仅记录）。
- 上限（D12）：每执行发送 ≤ 30 条且全部保留；单条 ≤ 4KB；未完成请求 ≤ 8；每执行请求 ≤ 30。超限拒绝并返回明确原因。另对同一 record 仅保留最近 5 次执行的记录（多次 resume 的内存上界，阶段 1 实施时确定）。

生命周期：

- 子工具执行时检查：通道 activation 有效、record 为同一实例、请求属于当前执行（回复）或存在当前执行（告知）。
- 执行结束（任何终态）：关闭 pending 请求，唤醒 waiter 返回 `execution_ended`；迟到调用被拒。
- resume：新执行不继承旧请求；通道按 record 解析当前执行，不刷新工具声明。上一执行的消息记录在上述 5 次执行上界内保留到 record 被回收。
- stop / shutdown / reload / 会话切换：关闭通道与 waiter；迟到消息丢弃，不进入新 activation。

## 5. 详情页 Messages 区块

agent 详情（`coordinator.detail` 的 agent 源）在现有内容后追加：

```
Messages (execution <execution_id>)
  12:01 ↑ question req_ab12 [replied]  Should I …
  12:03 ↓ reply    req_ab12            Yes, the schema …
  12:05 ↓ notice                       Found config drift …
```

- 列出当前执行的问题（含状态）与消息全文，按时间排序；仅读内存，不做额外 I/O、不消费结果。
- 遵守 detail 的现有 `limit` 预算，超出时标明省略。

## 6. 不变项

- `agent_manage` 动作 / schema / output / status / verbose 不变；仅 subagent `wait` 结果可能追加等待期间消息区块（无消息时文本不变）。
- `reply: null` 的 `subagent_message` 不变；完成通知格式不变；状态枚举、launch v2、`runtimeManagement` v2 不变。

## 7. 风险与验证要点

- appendEntry 卡片在父代理工具执行中插入时的视觉位置：tmux 真实终端验证。
- `display: false` + `triggerTurn` 空闲唤醒：SDK 级测试确认。
- 子会话 `sendCustomMessage` 的 steer 与普通 steer 同队列有序：SDK 级测试确认；若不成立，退回为单条 steer 并以 XML 尾注携带请求（需告知用户）。
- 模型是否稳定使用 `reply_to_parent` 与 `request_id`：只能真实 provider 验证，fixture 不宣称。

## 8. 回退

仅回退本任务 scoped changes；保留前置接口与并行修改，不删除磁盘会话或用户配置。
