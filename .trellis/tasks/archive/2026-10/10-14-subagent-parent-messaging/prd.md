# 子代理与父代理的中途消息

## 规划状态与授权

本任务于 2026-10-14 创建，原规划基于已被替换的 `task_manage` 接口。2026-10-19 经用户逐项讨论后整体重写，旧草案（`blocked` 类型、`task_manage` 消息动作、`task_id/run_id` 公开身份）全部作废。

用户已授权重写规划。**尚未授权实施、`task.py start`、提交、安装、同步、reload、push 或归档。** 实施前需用户审阅本 PRD、`design.md`、`implement.md` 并明确批准。用户已确认本任务可使用 `trellis-check` 做独立审查。

## 基线

以当前代码为准，相关前置任务已归档：

- `.trellis/tasks/archive/2026-10/10-16-runtime-tool-contracts`：`process_manage` / `agent_manage` 拆分；公开身份为 `agent_id`（会话）与 `execution_id`（单次执行）。
- `.trellis/tasks/archive/2026-10/10-16-agent-tool-contracts`：`subagent_message` 仅接受真实 `agent_id` 与非空 `message`；queued/sent 不代表已处理。
- `.trellis/tasks/archive/2026-10/10-17-agent-tool-nullable-contracts`：模型侧工具字段全部 required，可选控制字段为 `Union[null, T]`，在模式选择与副作用前归一化。

## 目标

1. 父代理可向运行中的顶层子代理提问，并取得与该问题精确关联的回复，不必等待整个执行结束。
2. 子代理可在未被提问时主动告知父代理重要进展或发现，并继续执行。
3. 子代理消息对用户即时可见，对父代理模型及时进入上下文。
4. 工具声明与 system prompt 在子会话整个生命周期内稳定，不因通信动态变化。

## 已确认决策

| 编号 | 决策 |
| --- | --- |
| D1 | 子侧只有一个固定工具 `reply_to_parent({message, request_id: string \| null})`：`request_id` 非 null 为回复，null 为主动告知。不设 `kind`，不设 `blocked`。 |
| D2 | 需要父代理决策、无法继续时，子代理**正常结束本轮**，在最终回复中说明阻塞点；父代理通过现有完成通知 / `agent_manage output` 读取结果，用现有 `subagent_run.resume` 续接。不新增阻塞状态或 outcome。 |
| D3 | 主动告知语义为"只是告知、子代理继续执行"。 |
| D4 | 父侧 `subagent_message`（主与嵌套）新增一个 nullable 字段 `reply: "wait" \| "notify" \| null`。null 保持现有 steering 语义。保留 `request_id` 关联。 |
| D5 | 请求在发送时由宿主绑定到目标 agent 的当前执行，返回 `request_id`（及 `execution_id`）；模型不提供 run 身份。 |
| D6 | 问题投递为两条消息：原正文作为普通 steering 不变；紧随其后在同一 steer 队列发送一条自定义消息 `<parent-request request_id="…" reply_tool="reply_to_parent" />`。会话未初始化时两条一起排队。 |
| D7 | `reply: "wait"` 不设超时：直到收到回复、该执行结束（返回"执行已结束、未回复"）或用户 Esc / `/task-detach`。后两种情况下请求仍有效，晚到回复照常送达。不新增设置项。 |
| D8 | 顶层送达规则（回复与主动告知统一）：父代理空闲时唤醒；正忙时以 steer 送达。例外：父代理正在前台 `subagent_run` 或 `agent_manage wait` 等待该执行时，等待期间的消息附在最终结果中返回，不另行送达；`reply: "wait"` 命中的回复只在该次工具结果中返回。 |
| D9 | 顶层展示：每条另行送达的子代理消息同时 (a) 通过 `pi.appendEntry` + `registerEntryRenderer` 在主对话中立即显示卡片（不进上下文）；(b) 通过 `pi.sendMessage(display: false)` 进入父代理上下文。另外，(c) 任务面板运行中条目显示最新消息一行；(d) 详情页新增 Messages 区块，列出该执行的消息全文与父侧问题及状态。附在等待结果中的消息仍显示卡片。卡片标题形如 `↩ <agent> · reply req_x` / `↩ <agent> · notice`，正文默认折叠，风格与完成通知一致。 |
| D10 | 适用范围：顶层子代理（含 isolated、只读、自定义工具列表）与嵌套子代理（其父为配置了 `allowedSubagents` 的子代理）都预置 `reply_to_parent`；工具作为宿主工具注入（同 `StructuredOutput`），不依赖扩展加载或工具列表，不扩大其他能力。workflow 启动的子代理不预置。 |
| D11 | 嵌套送达：父为子代理会话时无对话卡片；父子代理运行中以 `session.steer` 送达；父子代理已结束本轮时不唤醒（唤醒等同 resume，由主会话决定），消息仅记录、详情页可见。等待场景同 D8 例外。 |
| D12 | 上限：每次执行子代理最多发送 30 条消息（超出拒绝并告知子代理），全部在内存中保留；单条正文 4KB（超出拒绝，让子代理精简）；每个 agent 同时未完成请求最多 8 个，每次执行最多发起 30 个请求。 |
| D13 | 不考虑旧会话兼容：未预置工具的磁盘旧会话不热补，不设计专门路径。 |
| D14 | 本任务**不修改 `agent_manage` 的动作与 schema**（output/status/verbose/查询）；仅 `wait` 的结果按 D8 附带等待期间消息。输出与查询能力另开任务讨论，基于本任务的消息记录。 |

## 需求

### R1 子侧固定工具

- `reply_to_parent` 从子会话第一次模型请求起存在，名称、描述、schema 与通信说明固定；收到问题或 resume 时不注册、不激活新工具，不把 `request_id` 写进 schema 或 system prompt。
- 字段全部 required，`request_id` 为 `string | null`；空白 / 超长 message、超发送上限、未知 / 已关闭 / 已回复 / 不属于当前执行的 `request_id`、通道关闭均明确拒绝，错误返回给子代理。
- 工具通过受限父通道回调，宿主每次执行时解析当前合法执行，不在闭包中固化首次身份；模型不能选择发送者或收件人。

### R2 父侧提问

- `reply: null`：完全保持现有 `subagent_message`（主 / 嵌套）行为与返回文本。
- `reply: "wait"`：先登记请求，再按 D6 投递；本次调用等待对应回复，结束条件见 D7。
- `reply: "notify"`：登记并投递后立即返回 `request_id`，回复按 D8 / D11 送达。
- 投递失败时请求标为失败、释放等待。
- 返回内容明确 `request_id`、目标执行与阶段（queued / sent / replied / wait ended / execution ended），不宣称子代理已读。

### R3 送达与展示

- 按 D8、D9、D11 实施；同一消息不重复进入上下文。
- 执行结束前已接收的消息先于该执行的完成通知送达。
- 同一 agent 短时间内多条消息合并为一条上下文消息；卡片逐条显示。
- 送达失败可见，不无限重试，不阻塞子代理执行。

### R4 生命周期与边界

- 请求绑定 owner、agent、执行、`request_id`。执行结束时未回复的请求关闭为"执行已结束、未回复"，正在等待的立即结束并说明。最终结果不冒充回复。
- resume 产生新执行，旧请求不迁移；旧执行的迟到回调被拒绝，不污染新执行。
- stop / shutdown / reload / 会话切换释放 waiter 与回调，迟到消息不进入新 activation。
- 上限按 D12，超限明确拒绝，不静默丢失。

## 排除范围

- `agent_manage` 动作、schema 及 output/status/verbose 内容修改（另开任务），D8 的 wait 附带消息除外。
- 阻塞状态 / outcome、子侧挂起等待父答复、sibling 互发、自动 resume、唤醒已结束的嵌套父代理。
- workflow 启动子代理的通信。
- 旧会话兼容、跨主会话重启的消息恢复、磁盘重放。
- Pi SDK 修改、外部 pi-trellis RPC 协议变更、安装 / 个人同步 / reload。
- Task Panel 结构性重设计（仅追加最新消息与详情页 Messages 区块）。

## 验收标准

- [ ] AC1：子会话从创建到问答、普通 steering、resume，工具声明与 system prompt 字节一致；顶层（含 isolated / 只读 / 自定义工具列表）与嵌套子代理有 `reply_to_parent`，workflow 子代理没有。
- [ ] AC2：主 / 嵌套 `subagent_message` 新字段遵循 nullable 契约；`reply: null` 行为与返回文本回归不变；缺字段 / 非法枚举在副作用前拒绝。
- [ ] AC3：问题以两条消息按序投递（含会话未初始化路径）；`reply: "wait"` 拿到匹配回复时子执行仍在运行；连续多个问题不串；子代理普通文本不被当作回复。
- [ ] AC4：无请求时子代理可主动告知并继续执行。
- [ ] AC5：顶层送达在空闲 / 忙碌 / 前台 `subagent_run` 等待 / `agent_manage wait` 等待四种状态下符合 D8；消息先于完成通知；无重复进入上下文。
- [ ] AC6：对话卡片在父代理执行长工具期间即时出现且不进上下文；任务面板最新消息与详情页 Messages 区块正确；会话恢复后卡片可渲染。
- [ ] AC7：`reply: "wait"` 在回复、执行结束、Esc、`/task-detach` 下按 D7 结束；晚到回复照常送达。
- [ ] AC8：嵌套送达符合 D11；父子代理结束后消息不唤醒、仅记录。
- [ ] AC9：resume 后旧请求关闭、旧回调被拒；owner / 执行校验、并发回复 / 收尾 / resume / shutdown 竞态、D12 上限有定向测试，并经 `trellis-check` 独立审查。
- [ ] AC10：现有 `subagent_run` / `subagent_message` / `agent_manage` / 完成通知 / Beautify / 任务面板回归通过；`pnpm check` 实际结果如实记录；真实 provider 与终端未测部分如实列明。
