# 运行任务管理接口拆分与 Monitor 契约设计

## 1. 已确认决策与授权

- process_manage 管理 bash/monitor；agent_manage 管理 subagent/workflow，不新增 workflow_manage。
- 进程管理用 task_id；委派管理用一个 execution_id。稳定 agent_id 只用于消息和 Agent 会话 resume，不要求管理调用组合 agent_id+run_id。
- Agent resume 后旧 execution_id 的新查询/控制调用失效；已开始的 wait 保持原实例绑定。不新增历史结果仓库，不删除对话文件。
- task_manage 直接移除，不保留别名、旧参数或配置映射；产品内引用统一迁移，外部由用户迁移。
- 保留共享 capabilities、coordinator、Task Panel、权限、结果消费、防重复和会话 fence。不重构插件目录，不改调度/worktree 协议。
- 主自行调查，不启动 Agent。完整方案已获实施批准，S1/S2 已实现并验证；用户已授权收尾。

## 2. 两组工具的接口

所有 schema 为闭合扁平对象，字段定义一次；action 必填。? 表示可选。组合校验在 facade admission 完成，错误必须带 isError，不调用后端、不消费结果。

### process_manage

| action | 允许参数（除 action） |
| --- | --- |
| list / stats | task_type? |
| status / stop | task_id |
| output | task_id, offset?, limit? |
| wait | task_id, limit? |
| search | pattern, task_id?, task_type?, ignore_case?, context? |

- task_type 仅 bash/monitor；task_id 非空。
- offset/context 为安全非负整数，limit 为安全正整数；schema 用 Number + multipleOf:1，不用 Integer，避免宿主截断。
- offset 是 output 日志字节起点；默认读尾页，offset=0 从头读。limit 是 output/wait 日志字节预算，默认使用既有后端预算，不添加宿主默认注入。
- pattern 为非空正则；ignore_case 默认 false，context 默认 0；正则实际错误保留后端纠错。
- 不接受 run_id、execution_id、verbose 或 Agent 类型。

### agent_manage

| action | 允许参数（除 action） |
| --- | --- |
| list | kind? |
| status / stop | execution_id |
| output / wait | execution_id, verbose? |

- kind 仅 subagent/workflow，仅筛选 list；省略列两类。其他动作从 execution_id 解析对象，不接受冗余 kind。
- execution_id 非空并符合句柄格式；不接受 task_id、agent_id、run_id、分页、search/stats。
- verbose 为可选 boolean，仅 subagent output/wait；workflow 显式传 verbose（即使 false）拒绝。不新增 workflow 对话详情。
- output：Agent 当前输出或最终回答；workflow 当前进度或脚本返回/错误。wait 等整个执行终态。
- list/status 不消费；成功终态 output/wait 消费本次结果以避免重复通知；正在运行 output 不消费。
- stop 请求取消，不保证返回时所有执行已 drain；workflow stop 沿用停止所属 Agent 的机制，不停独立兄弟。
- 消息用 subagent_message，Agent resume 用 subagent_run，workflow 重放用 subagent_workflow；不加入模型暂停/继续/跳过/重试。

## 3. execution_id 格式与生命周期

采用纯编码适配，不新增随机句柄索引或第二执行注册表：

- subagent：`exec_` + base64url(JSON.stringify([agentId, internalRunId]))，由共享小模块生成/解析。
- workflow：现有 `wf_...` ID 直接作为 execution_id（每次重放本来就生成新 ID）。
- 模型把句柄当不透明字符串复制，不解析/拼接。编码不是权限凭证；猜中/篡改句柄仍必须通过当前 scope、owner 和精确实例校验。
- 解析须严格：类型、两元素数组、非空字段、规范 base64url 与重编码一致；拒绝任意 source 注入。只映射至既有 Agent source TaskIdentity。
- 新 Agent 调用对旧实例句柄返回 stale；不能 fallback 到当前执行。未被 resume 的当前已完成执行正常可读。
- admission 一次解析/绑定精确身份；已经开始的 wait 持有原 terminal，可返回旧结果，不能消费或停止新实例。
- 记录回收、会话退出和权限仍依现有后端；不另承诺新的保留期限或历史检索。

workflow 的 resumeFromRunId 保持原字段，因为它确实选择旧 workflow 执行以重放 journal；值就是返回的 workflow execution_id（wf_...），不再要求另记管理用 run_id。Agent 的内部递增 runId 不在公开管理参数暴露。

## 4. 启动/返回/通知身份

模型可见文本、list 和新公开结构化 envelope 必须一致：

| 来源 | 公开身份 |
| --- | --- |
| bash / monitor | task_type: bash/monitor, task_id, mode |
| subagent | kind: subagent, agent_id, execution_id, mode |
| workflow | kind: workflow, execution_id, mode |

- launch envelope 使用 version:2 的明确判别结构；新管理结果使用 version:2，包含管理组、action、状态/错误及该组身份。未知版本 renderer 安全回退。
- source/coordinator 与内部 capability 的 TaskIdentity 和 runtime metadata 保持既有精确 runId；公开适配负责转换，不破坏内部身份匹配。不要把内存控制器/session 泄露至结果。
- Agent 通知必须在调度时捕获本次 execution_id，不能发送时读取已恢复的新实例；workflow 使用自身 ID。前台结果也提供正确身份，不改变既有结果消费。
- bash 继承 structuredContent/outputSchema 的 output/truncated/exit_code/wall_time_seconds 不改变；公开启动身份适配与该输出契约独立。
- Trellis dispatch RPC 实际已能取到 Agent record；返回 agent_id 与 execution_id，新指导指向 agent_manage。消息仍用 agent_id，托管执行协议/占用规则不变。
- 不增加稳定 Agent 历史结果索引；历史展示可保留安全旧 envelope renderer，但没有旧 task_manage 执行入口。

## 5. composition 与嵌套权限

- task-composition 继续拥有注册与生命周期，按对象类型接入两 facade；复用既有 process、Agent、workflow capabilities。
- process_manage 只路由 process capability；agent_manage 只路由 Agent/workflow 和当前 retained-child 委派 capability。错组 ID 明确拒绝，不跨工具自动路由。
- child-handoff 注册回调改为确认 agent_manage，不能拿 process_manage 的存在证明能收集后台孩子结果。
- agent-runner 的 factory/fallback/active/narrowing/disallowed gates 全面迁至 agent_manage。仅允许拥有的嵌套执行；父实例 admission fence 保持。
- extensions:false、isolated、显式禁用、新 ext narrowing 和 depth cap 的行为按现有权限保持；fallback 不复活本地进程工具，不覆盖已注册工具。
- 无兼容映射：用户旧 task_manage 允许/禁用配置不自动转换；仓库维护的默认/角色资源与测试改用新名称，明确禁用 agent_manage 时后台嵌套启动必须拒绝。

## 6. Monitor 与输入校验

- 保持 command/ws/description/timeout_ms/wake_absent_ms；source 恰好二选一，description 非空。
- 时间为有限正数毫秒，schema exclusiveMinimum:0；允许小数和现有较大有限时间分段定时，不新增默认截止。
- 直接 execute 检查未知顶层/ws 字段、基本对象/字符串数组形状；effect 前拒绝。host 转换后调用保持现有语义，不重做 coercion、不新增 URL 或协议政策。
- 不改通知 cadence/省略清单/静默恢复/截止/source exit/后代输出/session 行为。cadence 动态按配置输出，0 说明按来源回调批次发送。

## 7. 最终英文指导草案

tools 使用各工具一句简介；rules 使用一个多行具名条目，替换原指导。默认/间隔用实际配置生成，模型提示不介绍旧接口迁移。

### process_manage

Snippet: Manage command and observation tasks started by bash and monitor.

```text
Process_manage usage:
  - bash runs finite commands; monitor observes ongoing event streams. Use process_manage to inspect, read, await, stop, or search their tasks. Use agent_manage for subagent/workflow executions.
  - Accepted arguments by action (? means optional; action is required):
    list/stats: task_type?
    status/stop: task_id
    output: task_id, offset?, limit?
    wait: task_id, limit?
    search: pattern, task_id?, task_type?, ignore_case?, context?
  - Copy task_id from launch/list. task_type filters only bash/monitor. Do not pass fields outside the selected action's list.
  - output reads a bounded tail page by default; offset=0 reads from the start. offset/limit count bytes; wait accepts limit for its final log page. Use returned ranges to continue reading. Search uses a regex, optional case-insensitivity, and context lines.
  - wait waits for the whole task; for monitor, observation must end, not merely emit an event. /bg or cancellation releases only the wait. stop requests execution cancellation; execution may still be draining afterward.
  - Successful terminal output/wait delivery reports the result and avoids a duplicate completion notification. list/status/search do not consume results. Completion is notified automatically; do not poll solely to detect completion.
  - Examples:
    Read log: {"action":"output","task_id":"<task_id>","offset":0}
    Await task: {"action":"wait","task_id":"<task_id>"}
    Search logs: {"action":"search","pattern":"ERROR","task_type":"bash"}
    Stop observation: {"action":"stop","task_id":"<monitor_task_id>"}
```

### agent_manage

Snippet: Manage subagent and agent-workflow executions: inspect, read, await, or stop.

```text
Agent_manage usage:
  - Manage executions started by subagent_run or subagent_workflow, not process logs or Agent conversation control. Use process_manage for bash/monitor; subagent_message for messages; subagent_run for Agent resume; subagent_workflow for workflow replay.
  - Accepted arguments by action (? means optional; action is required):
    list: kind?
    status/stop: execution_id
    output/wait: execution_id, verbose?
  - kind filters list to subagent/workflow. Copy execution_id from launch/list; do not construct it or substitute agent_id. agent_id identifies a conversation for messaging/resume; execution_id identifies one execution.
  - Agent resume produces a new execution_id. New calls with the previous execution_id fail as stale; they never operate on the resumed execution. A wait already admitted remains bound to its original execution. Workflow replay creates a separate execution with a new ID.
  - output returns current output/progress or a final result; wait awaits the whole execution. verbose is only for subagent output/wait and requests formatted detail, not an unlimited trace. Omit it for workflow.
  - /bg or cancellation releases a wait without stopping execution. stop requests cancellation; it may still be draining. Stopping a workflow also stops its owned agents, not independent siblings. Visible owned children cannot necessarily be managed directly by another owner.
  - Successful terminal output/wait delivery reports that execution's result and avoids duplicate completion notifications; list/status do not consume it. Completion is notified automatically; do not poll solely to detect completion.
  - Examples:
    List workflows: {"action":"list","kind":"workflow"}
    Read result: {"action":"output","execution_id":"<execution_id>"}
    Await execution: {"action":"wait","execution_id":"<execution_id>"}
    Stop execution: {"action":"stop","execution_id":"<execution_id>"}
```

### monitor

Snippet: Observe event streams; manage the returned task through process_manage.

```text
Monitor usage:
  - Use monitor for ongoing event streams and updates; use bash for a finite command or a condition loop that exits with one final result. process_manage manages both tools' tasks.
  - Provide exactly one source: command or ws. ws requires url and optional protocols in preference order. Provide a specific non-empty description, shown on every notification.
  - timeout_ms is an optional finite positive total observation deadline in milliseconds; omitted means no deadline. wake_absent_ms is an independent finite positive silence threshold: remind once per silent period, keep observing, and notify when events resume. Silence is not completion or success.
  - Startup returns task_id and the log path, not a completed result. Events arrive as batched notifications. Use process_manage output/search for logs, wait for observation to end, or stop to end it. Cancelling/releasing wait does not stop observation. Session closure stops owned tasks.
  - stdout and stderr are both observed; complete lines count as activity, partial lines do not wake the agent. stderr text alone is not failure. command | grep filters stdout only; command 2>&1 | grep filters both. Flush pipeline stages per line with grep --line-buffered or awk fflush().
  - WebSocket messages, including empty messages, count as activity. Notifications are batched, not one per message/line. Monitors share the configured cadence; first/timely events batch within min(200ms, configured interval). A zero interval sends source-callback batches without this delay.
  - Observation ends when the main command/source ends or fails, or the deadline is reached. It does not wait for descendant output after the main shell exits. Terminal reason and pending output are combined; explicit stop/session shutdown is silent, and an already reported result is not notified again.
  - Notifications are bounded previews. Read omitted output through process_manage or its log path. Oversized batches expose omitted-source counts and a JSONL manifest of source/log metadata; read it to locate omitted sources. Manifest failures are explicit, not automatic retries.
  - Examples:
    Command: {"command":"tail -f ./service.log | grep --line-buffered READY","description":"Service readiness events","wake_absent_ms":60000,"timeout_ms":600000}
    WebSocket: {"ws":{"url":"wss://example.com/events"},"description":"Service events","timeout_ms":600000}
```

bash 指导仅迁移身份/管理工具名，不改已批准执行语义。Agent/workflow 原长说明仅修正身份、结果管理与必要引用，不整体改写脚本 API。

## 8. 公共工具调用标题

用户已确认从 extensions/beautify 导出可独立使用的公共标题组件（如 tool-call-heading.ts），复用 layout.ts 的 toolHeading，而非各插件手拼标题。拟接口 createToolCallHeading({ name, detail, theme, context })；返回 Pi Component，原始工具名为 lowercase snake_case 首项，业务类型/说明为次级摘要。最终类型以现有 SDK Component/RenderContext 为准。

公共模块无初始化、副作用或高亮依赖，不导入 beautify/index.ts；即使 Beautify 扩展未启用也可使用。仅负责标题、终端宽度与文本安全；不注册执行、不消费结果、不另包背景 Box。可信 Agent 徽标样式与外部文本分开处理，不为了统一标题改动结果渲染、通知和生命周期。

本任务接入 subagent_run 及新管理入口的自定义标题，并检查与现有 read/bash 的一致性、宽度/中文/折叠展开/无 Beautify 场景；其他插件不全面迁移。开发 spec 记录公共入口和首项工具原名规范，测试 spec 记录真实 Component 与安全回归。

此增量已获用户认可，包含当前批准的实现范围，无新增未解决用户决策。

## 9. 文件与资源边界

- runtime-tasks：contracts/facade/launch/child-handoff，新纯句柄模块及测试；去掉旧公开注册，保留内部 metadata 路由所需定义。
- task-composition：两个入口、capability 分组、生命周期 closure 与注册回调。
- process-tasks：bash/monitor/management 的公开文本与身份投影，monitor 校验及 prompt；不改变进程执行/通知 backend。
- agent-tasks：index、nested-tools、agent-runner、status/通知以及 management/workflow 输出投影，SUBAGENT_TOOL_NAMES 和 loader gates；不改执行调度与会话存储。
- Beautify：新工具注册/判别与新 launch/result envelope，旧未知/历史安全 fallback。
- Trellis：dispatch 返回身份与指导，以及包内相关 roles/skills/protocol 中当前工具调用引用。包资源变更需同阶段更新 adapted hashes，不手改历史基线或项目生成拷贝；不改托管执行策略。
- docs：task-composition/monitor 与现行相关工具配置说明；spec 记录新接口、句柄、零副作用拒绝和最终 prompt 测试。
- 测试：实际注册/SDK schema、两 facade 分流、current/stale/admitted wait、consume/stop、nested loader scope、Trellis fake-pi、renderer 和资源 hashes。

## 10. 阶段与执行授权

两个阶段：S1 完成两管理入口、身份、所有运行消费者/提示/资源/测试同步；S2 完成 monitor 严格输入与成组指导，并验证集成。每阶段验证后精确本地提交，避免混入并行 hunk。

当前无额外用户偏好问题；用户已批准开始实施，并认可公共标题组件增量。继续在批准范围自行实施与验证，不重复请求相同计划批准。遵守不启动 Agent：主实现并自审；公开接口/权限通常需独立审查，但本次无法提供独立 Agent 审查，明确这一限制，使用严格边界/实际 loader 测试，不把自审称独立审查。若用户另行允许再派发 reviewer。
