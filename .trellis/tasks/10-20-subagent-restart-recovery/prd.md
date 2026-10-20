# 子 Agent 重启恢复

## 目标

以持久化的 `agent_id` 作为顶层及嵌套子 Agent 的唯一实例身份。Pi 重启后，工具可凭该身份重新定位已持久化的子 Agent session，并以新的 execution 继续既有对话。移除现有独立 `handle` / alias 身份模型，避免类型衍生且不易发现的名称与实例身份并存。

## 已确认事实

- 启用 `persist_session` / `rememberAgents` 时，Pi 会以 JSONL 持久化每个子 Agent 会话。
- 子 Agent 运行时的 Agent 记录、执行记录、handle tombstone、消息队列和实时会话所有权均保存在内存中。
- 宿主关闭及会话边界会停止实时任务并清除内存注册表；已持久化的 session file 不会自动重新水合为可寻址的子 Agent。
- 当前 `agent_id` 由截短 UUID 生成，仅在当前内存 registry 中有效；顶层实例另有由 type 推导的 `handle`，同名时以 `explore`、`explore-2` 编号。
- 当前代码意图让 `@handle` 定位和恢复实例，但该实例 handle 在真实交互中不可发现或不可用的原因尚未验证，不能作为新设计前提。
- 宿主进程停止后，进行中的模型请求不能原地恢复；恢复必须基于先前持久化的 transcript 创建一次新的 execution。

## 需求

- `agent_id` 必须成为唯一的、用户和工具均可使用的子 Agent 实例标识；不再维护独立 handle 或 alias。
- 新 `agent_id` 格式应可读地体现 Agent 类型、创建序号和截断为 8 位的 UUID 片段，例如 `agent_explore_0_550e8400`；创建时必须检查并重试碰撞，确保实际 ID 唯一。
- 创建序号必须遵循明确的作用域和递增规则；嵌套 Agent 的序号独立于其父级作用域重新计数。
- 持久化足以在后续 Pi 进程中按 `agent_id` 重新发现 Agent 的元数据，至少包括 Agent 类型、直属父级关系、session file 与恢复所需配置。
- 所有顶层和嵌套 Agent 必须持久化其 session 与恢复 registry；删除 `rememberAgents` 设置以及 Agent 配置中的 `persist_session` 开关，不支持不持久化实例。
- 无持久化主 session file（例如 `--no-session`）时，拒绝创建或恢复子 Agent，并说明子 Agent 需要持久化父会话；不提供不可恢复的降级运行。
- Pi session shutdown 时，所有仍在运行的 Agent 都标为 `interrupted`，原因统一为退出中断；用户显式 stop 的 Agent 保持 `stopped`。
- `subagent_run(resume: <agent_id>)` 在重启后可解析持久化实例并基于既有 transcript 创建新的 execution；所有公开**子 Agent**管理与等待操作均以 `agent_id` 定位当前实例，不暴露内部 execution 身份；workflow 的既有 execution 契约不在本任务范围内。
- 恢复或重新启动同一 Agent 时必须创建新的内部 `execution_id`，以隔离旧运行的异步回调、等待与消息；该字段不面向用户、不出现在 UI 或工具输入输出中，也不跨进程持久化。
- 明确顶层及嵌套子 Agent 的恢复范围、所有权、授权和 worktree 约束。
- 公开输入中的 Agent 路由使用显式命名空间：`@agent:resume:<type>_<index> <消息>`（例如 `@agent:resume:explore_0`）只在直属父级作用域中定位既有实例，`@agent:create:<已注册-Agent-类型> <消息>` 创建新实例；不再使用普通 `@handle` 或 type-derived 实例名称。UI、工具结果和公开工具参数保持完整 `agent_id`。

## 初始范围

- 为顶层与嵌套子 Agent 定义并生成新的持久化 `agent_id`。
- 用 `agent_id` 替换实例寻址、恢复注册表与恢复列表的主要身份。
- 以逐层方式恢复顶层与嵌套子 Agent：主会话恢复直属顶层 Agent，已恢复的 Agent 仅可恢复其直属子 Agent；不得自动恢复整棵树。
- 为中断任务提供清晰的状态及继续限制说明，并在父会话重新载入时将该状态交付给直属父级。
- 为 ID 生成、重启恢复和失败场景补充自动化测试。

## 初始非目标

- 对进行中的 provider 请求做 checkpoint，或从停止处精确继续。
- 恢复已经终止进程的 AbortController、工具进程、队列或父子消息通道。
- 兼容旧项目或旧扩展版本写入的持久化 Agent 数据；新实现可从新的元数据 schema 开始。
- 保留原有 type 派生的 `handle`、编号规则或 alias 作为实例身份。

## 验收标准

- [ ] 每个新 Agent 都具有唯一且可读的 `agent_id`，格式包含规范化 Agent 类型、按既定作用域递增的 index 和 8 位 UUID 片段；碰撞会被检测并重试。
- [ ] 每个根主会话在 Pi sessionDir 中拥有独立的 `<root-session>.subagents.json` registry；该文件不进入项目仓库，且与根会话及子 Agent session JSONL 正确关联。
- [ ] registry 原子更新，包含恢复和直属所有权校验所需的字段；重启扫描会将未终态实例标为中断，并且不会损坏既有有效 registry。
- [ ] 顶层 Agent 与每个父 Agent 的嵌套子 Agent 均按既定规则独立编号；不会因跨层创建产生歧义或 ID 冲突，且所有管理操作均拒绝越级访问后代。
- [ ] `subagent_run(resume: <agent_id>)` 可以发现合格的持久化实例，并在对应既有 transcript 上创建新的内部 execution；调用方仅能恢复其直属子 Agent。
- [ ] 公开的查询、等待、停止与消息操作只接受 `agent_id`；等待中断实例会返回明确的中断状态，而不是无限等待或引用内部 execution ID。
- [ ] 恢复或重新启动会创建新的内部 `execution_id`，旧运行的异步事件不能影响新运行；该 ID 不会暴露给用户或出现在公开工具契约中。
- [ ] 所有顶层和嵌套 Agent 均会持久化 session 与 registry；代码、设置、Agent frontmatter、UI 和文档中不再存在 `rememberAgents` 或 `persist_session` 的不持久化分支。
- [ ] 无持久化主 session file 时，创建和恢复子 Agent 被明确拒绝；已确认孤立的 registry sidecar 可安全清理，缺失 root/child session file 不会损坏其他有效条目。
- [ ] `@agent:resume:<type>_<index> <消息>` 和 `@agent:create:<已注册-Agent-类型> <消息>` 分别只执行恢复既有实例和创建新实例；前者仅在直属父级作用域内解析，普通 `@…` 保留给 Pi 原有输入行为；UI、工具结果和公开工具参数完整展示/使用 `agent_id`。
- [ ] 因关闭而中断的 Agent 与正常完成的 Agent 有可见区分，并且具有明确的继续路径。
- [ ] 聚焦的自动化测试覆盖 ID 生成、重启恢复、嵌套作用域与失败场景。

## 已确定决策

- 删除独立 `handle` 与 alias；唯一 `agent_id` 同时是实例身份和用户/工具寻址标识。
- `agent_id` 使用可读格式：`agent_<规范化-agent-类型>_<index>_<uuid8>`；UUID 部分截断为 8 位，但生成时必须检测并重试碰撞。
- `execution_id` 是一次实际运行的纯内部令牌：恢复或重新启动时必须生成新值，用于隔离异步事件；不展示、不持久化、不作为工具参数或工具结果。
- 所有顶层和嵌套 Agent 都强制持久化 session 与恢复 registry；删除 `rememberAgents`、`persist_session` 及其配置/UI/文档分支。
- 实例输入使用 `@agent:resume:<type>_<index> <消息>`，例如 `@agent:resume:explore_0`；它仅是直属父级作用域内的用户友好简写。创建输入使用 `@agent:create:<已注册-Agent-类型> <消息>`。UI、工具结果和公开工具参数保持完整 `agent_id`，普通 `@…` 继续交由 Pi 原有行为。
- 使用根主会话同目录的 `<root-session>.subagents.json` 作为整棵 Agent 树的唯一持久化 registry；它保存 `agent_id`、类型、局部 index、直属父级、子 session file 与最近生命周期状态。顶层创建时确定 root session/registry 路径并沿嵌套层传递；不从子 sessionDir 推断 registry 位置。该文件不写入项目仓库，跟随根主会话的 sessionDir。
- registry 使用同目录临时文件写入后原子 `rename` 的 JSON 覆盖方式维护当前状态；不使用 append-only JSONL。原子写仅防止单进程退出时文件损坏，不支持同一根会话的多进程并发写入。子 Agent 对话仍由 Pi 原生 session JSONL 保存。
- 每一层均支持跨重启恢复，但恢复流程必须逐层进行：主会话只能恢复直属顶层 Agent；已恢复 Agent 只能恢复直属子 Agent；任何管理操作均不得越级。
- 因宿主关闭而中断的 Agent 被直属父级显式调用 `resume` 时，立即基于既有 session 创建新的 execution；结果和 UI 必须标明该 Agent 曾因重启中断。无需二次确认。
- 公开工具中的子 Agent 实例寻址、查询、等待、停止与消息操作统一接收 `agent_id`；内部 `execution_id` 只用于实现隔离，不能作为子 Agent 的公开参数或结果。workflow 的 execution 管理契约保持不变。

## 待决策

- 无。下一步需基于现有 session、扩展设置及任务 UI 的持久化机制完成技术设计。
