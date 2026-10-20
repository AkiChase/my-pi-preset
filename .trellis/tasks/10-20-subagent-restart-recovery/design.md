# 子 Agent 重启恢复设计

## 1. 设计目标

本设计将 `agent_id` 作为唯一公开的 Agent 实例身份，并使已持久化的 Agent 在 Pi 进程重启后可被其直属父级恢复。一次具体运行仅由内部 `execution_id` 追踪；该字段不进入用户界面、工具参数或工具结果。

设计必须满足：

- 恢复后仍使用原 `agent_id` 和原 session transcript；
- 任何新的运行都使用新的内部 `execution_id`；
- 管理权限严格限于直属父子关系；
- 中断状态可被直属父级感知；
- 嵌套 Agent 默认可持久化，且可逐层恢复；
- 删除旧 `handle` / alias 寻址模型。

## 2. 持久化边界

### 2.1 文件布局

子 Agent 对话继续使用 Pi 的原生 `SessionManager` JSONL 文件。扩展为每一个根主会话在根主会话文件同目录创建一份独立 registry：

```text
<root-session-dir>/<root-session>.jsonl
<root-session-dir>/<root-session>.subagents.json
<possibly-other-session-dir>/<child-a>.jsonl
<possibly-other-session-dir>/<child-b>.jsonl
```

创建顶层 Agent 时，扩展从主会话的实际 session file 确定不可变的 `rootSessionFile` 与 `rootRegistryFile`；二者沿全部嵌套层显式传递。子 Agent 自己可因现有 `sessionDir` 配置写入其他目录，但绝不能据自身目录猜测 registry 位置。registry 不写入项目仓库。

若主会话没有持久化 session file（例如 `--no-session`），无法建立合法根 registry 和可恢复父级；所有创建/恢复子 Agent 的公开工具必须直接失败，并说明需要持久化父会话。

### 2.2 Registry 数据模型

registry 是根会话整棵 Agent 树的权威元数据。它使用 schema version，包含根 session 定位信息、Agent 映射和每个父级的下一个局部序号。每个 Agent 条目至少保存：

```json
{
  "agentId": "agent_explore_0_a1b2c3d4",
  "type": "Explore",
  "index": 0,
  "parentAgentId": null,
  "sessionFile": "/absolute/path/to/child.jsonl",
  "status": "completed",
  "createdAt": 0,
  "updatedAt": 0
}
```

`parentAgentId: null` 表示直属根主会话；嵌套项保存直属父 Agent 的 `agent_id`。Agent ID 的格式为：

```text
agent_<规范化-agent-类型>_<父级作用域内序号>_<uuid8>
```

局部 index 在同一直属父级下跨 Agent 类型单调递增，从 `0` 开始。UUID 后缀仅为短可读随机消歧；分配时在 registry 中检查冲突并重试。

### 2.3 原子性与损坏处理

每次创建、session file 确认或状态转换都通过“写同目录临时文件 → fsync/关闭 → rename 覆盖”的方式更新 registry。用户已明确不支持多 Pi 进程同时操作同一根会话；原子写入的目标是防止单进程退出或崩溃留下半写 JSON，而非提供多写者并发控制。读取时验证 JSON、版本、字段类型、路径和 parent 引用：

- 不可读或不合法的 registry 不创建猜测性的 Agent；恢复失败并提供明确错误；
- 不可读的子 session file 只使对应实例不可恢复；
- root session file 已删除时不加载其 registry；启动时可安全清理已确认孤立的 sidecar，但绝不猜测删除仍有关联 root session 的 registry；
- 无法原子写入 registry 时，创建/恢复必须失败或回滚，不能产生只存在于内存中的“可恢复”承诺。

## 3. 生命周期

### 3.1 创建

1. 父级取得在顶层创建时确定、并由嵌套上下文传递的 root registry 和自己的 parent scope。
2. 从 registry 分配局部 index 与唯一 `agent_id`。
3. 创建 AgentRecord，并立即写入 `queued` / `running` registry 条目。
4. 创建子 Agent 的 Pi session；session file 已确定后写回条目。
5. Agent 正常完成、用户显式停止或失败时更新终态与时间。

顶层和嵌套 Agent 一律持久化 Pi session，并且一律写入恢复 registry；不再读取或提供 `rememberAgents`、`persistSession`、`persist_session` 配置。

### 3.2 重启检测

在 Pi 的 `session_shutdown` 中，所有仍为 `queued` / `running` 的持久化 Agent 都必须先写为 `interrupted`，原因统一为 `pi_exit`，然后再停止内存中的执行。用户通过公开 stop 操作显式终止的 Agent 则保持 `stopped`。

新的根会话或已恢复父 Agent session 激活时加载 root registry；不再通过“上次状态是否 running”猜测中断。恢复后的直属父级收到一次隐藏/结构化运行时通知，其中列出其直属且状态为 `interrupted` 的子 Agent 的完整 `agent_id`、类型和状态。通知只提示“可调用 resume 继续既有 session”，不暗示旧执行仍然存在；投递状态需在当前父 session 生命周期内去重。

### 3.3 恢复

- 主会话仅可恢复 `parentAgentId: null` 的顶层 Agent。
- 已恢复 Agent 仅可恢复 `parentAgentId === caller.agentId` 的直属子 Agent。
- 任何越级恢复、查询、等待、停止或消息操作均返回明确的所有权错误。
- `resume(agent_id)` 验证 registry、session file 和当前 Agent type 配置后，以原 transcript 建立新的内部 execution。
- 不自动恢复任何子树；父级必须逐个主动恢复直属子 Agent。
- 对 `interrupted` 状态的显式 `resume` 直接执行，不要求二次确认，并在结果/UI 中保留“此前因 Pi 重启中断”的状态说明。

## 4. 身份与公开工具契约

### 4.1 身份与输入

- `agent_id`：唯一公开实例身份。UI、工具、恢复和所有权检查均使用完整值。
- `execution_id`：每次实际运行新建的纯内部令牌，用于隔离 wait、异步回调、mailbox 和 Task Panel 运行实例；不持久化，不展示，不作为公开参数或结果。
- `@agent:resume:<type>_<index> <消息>` 仅在直属父级的 registry scope 中解析既有实例，例如 `@agent:resume:explore_0 继续`；它是输入简写，不是第二种持久化身份。
- `@agent:create:<已注册 Agent 类型> <消息>` 创建新实例，例如 `@agent:create:Explore 检查 registry`。
- 普通 `@…` 完全交回 Pi 的原有输入和文件补全行为。
- UI、工具参数、工具结果、错误和日志始终显示/使用完整 `agent_id`。
- 删除 `handle`、`alias`、tombstone 及 type 派生编号的实例寻址逻辑。

### 4.2 工具

`subagent_run(resume: <agent_id>)` 保持以完整 Agent 身份恢复。`agent_manage` 对 subagent 的公开 `execution_id` 参数迁移为 `agent_id`；workflow 继续使用既有 `execution_id` 契约：

- `status` / `output`：对已持久化但未运行的 completed/interrupted 实例返回 registry 状态与可读取 transcript；
- `wait`：对 interrupted 且尚未恢复的实例立即返回“退出中断、请 resume”的结果，不会无限等待；
- `stop`：对 interrupted/completed 实例返回“已结束、无需停止”；
- `subagent_message` 保持 `agent_id`，仅允许发送给当前运行的直属 Agent；
- 对旧 `execution_id` 格式明确报参数错误，不尝试解释为 Agent ID。

内部 API 仍在管理调用开始时捕获当前 `execution_id`，以避免一次 wait/stop 在 Agent 恢复后误作用于新的执行。

## 5. UI 与 Task Panel

Task Panel 的稳定实例键和用户展示使用 `agent_id`；内部数据源可以将当前 `execution_id` 用于一次运行的临时事件隔离。条目标题显示 Agent 类型、`agent_id` 与状态，不再显示或依赖 handle/alias。

当根会话重新打开时，registry 中的 Agent 重新投影到相应直属父级；主面板不显示嵌套后代，已恢复 Agent 自己的上下文仅可看见直属孩子。中断状态必须与 completed/error/stopped 区分，并显示恢复提示。

## 6. 主要改动面

- `extensions/agent-tasks/src/agent-manager.ts`：Agent ID 分配、record 生命周期、所有权检查、恢复记录重建；删除 handle/tombstone 生命周期。
- `extensions/agent-tasks/src/agent-runner.ts`：嵌套 Agent 的默认 session 持久化，以及 session file 回传。
- 新增 registry 模块：schema、路径解析、读写、原子更新、加载与中断标记。
- `extensions/agent-tasks/src/index.ts`：session_start 加载/通知、shutdown 中断落盘、`@agent:create` / `@agent:resume` 输入路由与 autocomplete、更新工具契约。
- `extensions/agent-tasks/src/nested-tools.ts`：直属所有权下的持久化恢复和 `agent_id` 管理契约。
- `extensions/agent-tasks/src/management.ts`、`source.ts` 与 Task Panel 集成：公开 agent_id 管理、内部 execution 隔离和 interrupted 投影。
- `extensions/runtime-tasks/*` 与对应测试：将统一 `agent_manage` 的 schema/分派扩展为“subagent 使用 agent_id、workflow 保持 execution_id”，同时保留内部 execution 隔离。
- 相关 UI、类型、测试和说明文案。

## 7. 风险与回滚

- registry 写入失败可能造成 session 已建但不可恢复；创建阶段须在可恢复承诺前完成 registry 写入，失败则清理/报告。
- 用户删除 session JSONL、移动 sessionDir 或 Agent type 被禁用时，恢复只能安全失败，不得退回到其他类型。
- 不兼容旧 handle/tombstone 数据是已批准的范围外；新 schema version 不读取旧记录。
- 工作树、消息队列和 provider 请求均不尝试跨进程复活；恢复仅复用 transcript。
- 本次不进入实现或 start 阶段；后续实施需先完成 spec 注入、上下文清单和用户对计划的批准。
