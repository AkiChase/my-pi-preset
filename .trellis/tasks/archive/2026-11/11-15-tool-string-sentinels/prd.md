# 工具参数去除 null，改用字符串哨兵

## 目标

模型可见的工具参数 schema 不再出现 JSON `null` 类型。"不适用 / 没有"统一用字符串 `"null"`，"使用配置或默认值"统一用字符串 `"default"`，原布尔控制字段改为语义枚举。修复 Anthropic Messages 及部分 Chat Completions 渠道把 JSON `null` 编码成字符串 `"null"` 后的静默误判（例：`subagent_run.resume: "null"` 被判为恢复模式）和数字/布尔字段校验失败。

## 背景与已确认事实

- 现有设计：`extensions/shared/tool-arguments.ts` 的 `nullableControl()` 生成 `anyOf[null, T]`；`parseControlArguments()` 只删除真 `null` 的控制字段，再由各工具按模式/动作白名单拒绝不适用字段（`agent-tasks/src/tool-contract.ts`、`runtime-tasks/tools.ts:93-147`、`process-tasks/tools/monitor.ts:35-58`、`trellis/lib/subagent-rpc.ts:21-38`）。字符串 `"null"` 不被删除，是 bug 的直接原因。
- pi 工具参数校验使用 `pi-schema` 并开启 `coerce: true`（`pi-ai/dist/utils/validation.js:12`）。`pi-schema/dist/coerce.js` 会把真 `null` 转成字符串 `"null"`（string 或字符串 enum 目标）、把布尔转成 `"true"/"false"`、把数字转成十进制字符串。因此 `"null"` 作为哨兵时，模型写真 `null` 或字符串 `"null"` 都会收敛为同一个值。
- 需求说明中的探测材料 `/tmp/tool-null-probe/` 在本机已不存在；其结论只覆盖 `"none"` 方案，本方案需重新端到端验证。
- 跨扩展读取原始工具参数：`trellis/index.ts:1186-1281` 的 `tool_call` 钩子读取 `subagent_run` 的 `subagent_type`/`prompt`/`isolation`/`isolated` 以及 `bash`/`monitor` 的 `command`，看到的是解析前的原始参数。
- `memory_list` 不用 null（`query: ""` 是真实数据：空查询），不修改。
- WebSocket 构造时 `protocols` 为 `undefined` 与 `[]` 都表示不请求子协议（`process-tasks/monitor-ws.ts:20`）。

## 决策记录

| # | 决策 |
|---|---|
| D1 | 哨兵词汇仅两个：`"null"`（不适用/没有/不设置）、`"default"`（使用配置或默认值）。不引入 `"none"`、`"all"`、`"tail"`、`"new"` 等字段专用哨兵；`""` 不作哨兵。 |
| D2 | 不拆分工具。保持现有按模式/动作分发。 |
| D3 | 字段在当前分支**不适用**时只接受 `"null"`；`"default"` 或任何真实值都报错并指向该字段。 |
| D4 | 字段在当前分支**必填**时，收到 `"null"` / `"default"`（若该字段声明了该哨兵）按"缺失"报错，绝不作为字面值。哨兵词只在声明了它的字段上有特殊含义，其他字段按字面值处理。 |
| D5 | 原布尔控制字段改名并改为语义枚举，字段名为维度名词、值为该维度取值（见 R3）。工具外的契约（agent 文件 frontmatter、内部 manager/RPC/workflow 选项、持久化配置）保持原名，由工具解析层映射。 |
| D6 | `subagent_message.reply` 改为必填业务枚举 `"skip" \| "wait" \| "notify"`，`"skip"` 即原 null（普通引导，不等回复）。 |
| D7 | `thinking`、`isolation` 使用 `"default"` 表示按配置，解决与 `"off"` / OpenAI `reasoning_effort: "none"` 的语义重叠；不改业务值名。 |
| D8 | 不保留 `nullableControl` 作为模型工具 schema 构造；真 `null` 由 pi 转换为 `"null"`，无需额外兼容分支。 |
| D9 | 顺带修复 `agent_manage` 解析层两个现有漏洞：同时提供 `agent_id` 与 `execution_id`；workflow 目标的 `output`/`wait` 带非默认 `detail`。 |
| D10 | 有默认语义的字段（`model`、`thinking`、`execution`、`tools`、`context`、`isolation`、`limit`、process `context`、`case`、`detail`、`trellis_dispatch.task`）在**适用**分支收到 `"null"` 时视同 `"default"`（原 null 即默认语义，模型习惯性写 null 不应触发重试）。这些字段在**不适用**分支仍只接受 `"null"`（D3 不变）。 |

## 需求

### R1 公共层

- `extensions/shared/tool-arguments.ts` 提供哨兵控制字段的 schema 构造与解析辅助，替代 `nullableControl()` / 现有 `parseControlArguments()` 的 null 删除逻辑，供所有受影响工具复用。
- 解析分两步：先校验完整字段集合与哨兵合法性，再由各工具按分支白名单处理；`"default"` 必须在白名单检查之后才转为"未提供"，确保不适用字段收到 `"default"` 会被拒绝（D3）。
- 可选数字字段：schema 为字符串 + `pattern`，解析层转为整数并做原有 minimum / 整数约束，错误指向字段。
- 错误文案：指向具体字段，说明该字段在当前分支应填 `"null"`、`"default"` 或真实值。

### R2 各工具字段契约

| 工具 | 字段 → 新契约 |
|---|---|
| `subagent_run`（顶层 `agent-tasks/src/index.ts:1419-1450`，嵌套 `nested-tools.ts:280-294`） | `description`/`subagent_type`：string，恢复模式填 `"null"`；`resume`：agent_id 或 `"null"`（新建）；`model`：string 或 `"default"`；`thinking`：`"default"` + 级别；`execution`、`tools`、`context`、`isolation`（仅顶层且启用时）：见 R3 |
| `subagent_workflow`（`index.ts:2210-2235`） | `script`/`scriptPath`/`name`/`resumeFromRunId`：string 或 `"null"`；来源三选一规则不变；`args` 保持任意 JSON 数据 |
| `subagent_message`（`index.ts:2568`、`nested-tools.ts:566`） | `reply`：`"skip" \| "wait" \| "notify"` |
| 回复父代理（`parent-messaging.ts:273,292`） | `request_id`：string 或 `"null"`（主动通知） |
| `process_manage`（`runtime-tasks/tools.ts:165-170`） | `task_id`/`pattern`：string 或 `"null"`；`task_type`：`"null"`（不过滤）/`"bash"`/`"monitor"`；`offset`：数字字符串或 `"null"`（尾部/不适用）；`limit`/`context`：数字字符串、`"default"`（适用时）或 `"null"`（不适用时）；`case`：见 R3 |
| `agent_manage`（`runtime-tasks/tools.ts:172-174`） | `agent_id`/`execution_id`：string 或 `"null"`；`kind`：`"null"`（不过滤）/`"subagent"`/`"workflow"`；`detail`：见 R3 |
| `monitor`（`process-tasks/tools/monitor.ts:104-126`） | `command`：string 或 `"null"`；`ws`：对象或 `"null"`；`ws.protocols`：字符串数组，`[]` 表示无偏好；`timeout_ms`/`wake_absent_ms`：正整数字符串或 `"null"`（不设置） |
| `trellis_dispatch`（`trellis/lib/subagent-rpc.ts:117`） | `action`：必填 `"dispatch" \| "stop"`（去掉 null 与 `""`）；`agent`：角色或 `"null"`（stop）；`task`：string 或 `"default"`（当前/本地任务，去掉 `""`）；`prompt`：string 或 `"null"`（stop） |
| `memory_write`（`memory/tools.ts:70`） | `expectedRevision`：revision 或 `"null"`（创建） |

### R3 语义枚举（替代布尔）

| 工具 | 原字段 | 新字段 | 取值（`"default"` 的含义） |
|---|---|---|---|
| `subagent_run` | `run_in_background` | `execution` | `"foreground" \| "background" \| "default"`（按配置） |
| `subagent_run` | `isolated` | `tools` | `"full" \| "builtin" \| "default"`（按配置，否则 full） |
| `subagent_run` | `inherit_context` | `context` | `"fresh" \| "inherit" \| "default"`（按配置，否则 fresh） |
| `subagent_run` | `isolation` | `isolation` | `"off" \| "worktree" \| "default"`（按配置，否则 off） |
| `subagent_run` | `thinking` | `thinking` | 级别 + `"default"`（按配置/会话） |
| `process_manage` | `ignore_case` | `case` | `"sensitive" \| "insensitive" \| "default"`（sensitive） |
| `agent_manage` | `verbose` | `detail` | `"summary" \| "full" \| "default"`（summary） |

### R4 模型可见文案与文档

- 同步所有工具描述、字段描述与示例：`agent-tasks/src/tool-guidance.ts`、`runtime-tasks/tools.ts` 使用说明、`process-tasks/tools/monitor.ts` 使用说明、`parent-messaging.ts` 说明、`agent-tasks/skills/subagents/references/{workflow-api,delegation,patterns}.md`、`agent-tasks/src/index.ts` 中引用工具参数的提示（如 3369-3370）、`trellis/protocol/worktree-execution.md:53` 的 stop 示例。模型可见文案中不再出现以 JSON null 填写工具参数的引导。
- 用户文档只做字段名同步（`docs/extensions/beautify.md:17` 的 `verbose`、`docs/extensions/task-composition.md:101` 的 `ignore_case`），不加入工具参数调用教学。
- 改写 `.trellis/spec/development/sdk-compatibility.md` 中"required-nullable controls"约定为新哨兵约定。

### R5 渲染与跨扩展读取

- beautify 读取原始管理/监听参数处同步哨兵：`beautify/tools/management.ts:10`（`task_id ?? agent_id ?? execution_id` 会选中 `"null"`）、`beautify/tools/monitor.ts:17`（`timeout_ms`/`wake_absent_ms` 变为字符串）；agent 卡片渲染器读取 `subagent_run` 原始参数处同步新字段。`task-ui/detail-view.ts` 读的是内部执行配置，不改。
- `trellis/index.ts` 的 `tool_call` 钩子：`isolation === "worktree"` 拦截保持有效；`isolated` 改读 `tools`；`"null"` 等哨兵不得被误判为角色或运行时命令。

## 验收标准

1. 所有受影响工具的模型可见 schema（含嵌套对象）不出现 `type: "null"`；新增一个遍历已注册工具 schema 的测试保证这一点。
2. 解析层：`"null"` / `"default"` 在声明它们的适用字段上映射为原"未提供"语义（含 D10：默认语义字段在适用分支收到 `"null"` 等同 `"default"`）；不适用字段只接受 `"null"`；必填字段收到哨兵按缺失报错；所有错误指向具体字段并给出应填值。数字字符串的边界与原 number 约束等价。
3. `subagent_run` 的 `resume: "null"` 进入新建模式；恢复模式下 `description` 等字段填真实值或 `"default"` 均被拒绝。
4. `agent_manage` 同时给出 `agent_id` 和 `execution_id`、workflow 目标带 `detail: "full"` 均被拒绝（D9）。
5. 现有行为测试改写后通过，新增拒绝路径测试；`pnpm check`（隔离 `PI_CODING_AGENT_DIR`）通过。
6. 端到端：在 `mp-messages-2/claude-opus-5.5` 下实际完成：新建只读 Explore 子代理并拿到结果；`process_manage` 的 `wait` 与 `output`；`agent_manage` 的 `list`；`monitor` 启动与停止。
7. 至少一个 GPT Responses 渠道复验子代理新建与 `process_manage wait`。

## 不在范围

- 上游网关把 null 编码为 `"null"` 的根因；渠道改写工具名、注入额外工具。
- 拆分工具（D2）。
- 工具外契约：agent 文件 frontmatter 字段名、workflow 脚本 `agent()` 选项、跨扩展 RPC 与内部 manager 选项、持久化数据。
- `memory_list`、`bash` 等未使用 null 的工具。
