# 子 Agent 重启恢复实施计划

## 前置条件

- 本文档只记录计划，不构成实现启动。
- 实现前需执行 `trellis-before-dev`，读取与 `extensions/agent-tasks`、Task Panel、Pi session 集成有关的规范与检查清单。
- 实现前需为实际委派的角色准备 `implement.jsonl` / `check.jsonl`；如主会话直接实现且自检，可保持未使用清单为空并如实记录。
- 不兼容旧 handle / alias / tombstone 数据；无需迁移旧项目数据。

## 变更边界（实施前确认）

- **最小行为缺口**：Pi 子 Agent transcript 可落盘，但实例 identity、父子所有权、运行状态和恢复索引只在内存中；宿主退出后无法让直属父级用同一实例身份恢复会话。
- **实际所有者**：`extensions/agent-tasks` 的 `AgentManager`、runner/session lifecycle、nested tool ownership、工具管理和 Agent 输入路由；Task Panel 仅消费其投影，不应成为持久化所有者。
- **预期修改范围**：新增 registry 模块；修改 agent manager、runner、主入口、nested tools、management/source、types、mention UI/parser 和对应测试；必要时调整 Task Panel 对状态/身份的呈现测试。
- **显式排除**：不改 Pi 核心 session format；不恢复旧 provider/tool 进程；不兼容旧 handle/alias/tombstone 数据；不处理同一根会话的多进程并发写；不修改项目仓库中的用户 session 数据。
- **局部重构证明**：保留内部 execution 隔离，通过竞争 wait/message、shutdown、恢复和直属所有权测试证明公开 ID 迁移没有让旧回调误作用于新运行。


### 工作项

1. 新建 registry 模块，定义 versioned schema、Agent 条目、状态转换、根 session registry 路径和原子读写。
2. 在创建顶层 Agent 时从实际主 session file 确定 root registry，并沿全部嵌套上下文显式传递；没有持久化主 session 的调用直接失败。
3. 为顶层与嵌套 Agent 分配 `agent_<type>_<index>_<uuid8>` 格式 ID；按直属父级范围维护单调 index，检测 8 位 UUID 碰撞并重试。
4. 将创建、session file 绑定、正常终态和 session_shutdown 中的 `interrupted(pi_exit)` 写入 registry；原子写仅保证单进程崩溃安全，不支持同一根会话多进程并发写。
5. 将顶层和嵌套 Agent 改为无条件持久化 Pi session，并删除 `rememberAgents` / `persist_session` 的配置、设置和运行时分支。
6. 从类型与记录中移除 handle / alias 及 tombstone 所需字段和分配逻辑。

### 验证

- 单元测试：schema 校验、原子读写、损坏文件、孤立 registry、缺失 root/child session、无 session 主会话拒绝、ID 结构、局部 index、UUID 碰撞重试。
- 单元测试：顶层和多层嵌套 Agent 的 index 独立，且 registry 中 parent 关系准确。
- 运行相关 `extensions/agent-tasks` 测试子集及 TypeScript 检查。

### 提交检查点

持久化 registry、ID 生成和嵌套 session 持久化的实现、测试在同一提交中完成。

### 阶段 1 执行记录

- 状态：已实现并通过独立检查；等待本阶段 scoped commit。
- 关键实现：新增 `subagent-registry.ts`；根 session locator 沿嵌套 Agent 传递；所有 Agent session 强制持久化；移除 `rememberAgents` / `persist_session`；在 shutdown 取消前将活动实例写为 `interrupted(pi_exit)`；无持久化父 session 时拒绝创建。
- 发现并修复：registry schema 对状态、interruption reason、ID、parent、session 路径和 index scope 的校验不足；外部 RPC 可伪造 registry locator；均已修复并增加回归覆盖。
- 初次完整 Agent 测试失败：强制持久化后，大量成功启动 fixture 未提供临时 root session file。已将成功路径 fixture 迁移到临时持久化 session，并保留无 session 拒绝回归。
- 验证：`PI_SDK_DIR=<installed SDK> PI_CODING_AGENT_DIR=<owned temp> pnpm typecheck` 通过；`PI_SDK_DIR=<installed SDK> PI_CODING_AGENT_DIR=<owned temp> node --test extensions/agent-tasks/__tests__/*.test.ts` 通过（297 passed, 0 failed）；`git diff --check` 通过。
- 原始输出：`/tmp/pi-subagent-restart-recovery.5Pj0Lq`、`/tmp/pi-subagent-restart-stage1.TehTrA`、`/tmp/trellis-check-subagent-restart.EY2iUx`、`/tmp/agent-tasks-restart-recovery.iL5fOe`；在最终验证后按本次任务临时目录清理策略处理。

## 阶段 2：重启加载、权限和恢复

### 工作项

1. 在根会话及恢复父 Agent 激活路径加载 registry，重新创建最小可管理的持久化实例投影。
2. session_shutdown 时将仍运行的实例写为 `interrupted(pi_exit)`；新会话只读取既有中断状态，不通过残留 `running` / `queued` 猜测。
3. 在直属父级上下文注入且按父 session 生命周期去重的中断通知；禁止顶层看到嵌套后代，禁止任意越级操作。
4. 让 `subagent_run(resume: agent_id)` 从持久化 registry 查找直属实例、验证 session/type/config 后新建内部运行；为 completed/interrupted 的查询、输出、等待和停止定义无运行时的明确响应。
5. 使 interrupted Agent 的 `resume` 直接开始新运行，并保留中断标识；不可读 registry 或 session 时给出可执行错误。
6. 实现顶层 → 子 → 孙的逐层恢复测试；明确不自动恢复子树。

### 验证

- 重启模拟测试：completed、interrupted、queued、error、session_shutdown 标记、不可读 session、禁用 Agent type、无 session 主会话。
- 权限测试：主会话只能恢复顶层，父级只能恢复直属子级，祖先无法操作孙级。
- 通知测试：恢复父级仅收到直属中断子级的通知。

### 提交检查点

重启检测、逐层恢复、直属权限与中断通知在同一提交中完成。

## 阶段 3：公开工具与 UI/Task Panel 契约迁移

### 工作项

1. 修改统一 `agent_manage` schema/分派：subagent 操作使用 `agent_id`，workflow 保持 `execution_id`；迁移 agent management capability 时继续在内部捕获 execution identity。
2. 使 `wait` 对 interrupted 且尚未恢复的实例立即返回中断状态；对已恢复实例仅绑定调用开始时捕获的内部 execution，避免跨轮串线。
3. 保持 `subagent_message(agent_id)` 的直属所有权校验，并为非运行/中断实例给出明确结果。
4. 移除 `@handle` 输入与实例 roster；实现 `@agent:create:<type>` 新建和 `@agent:resume:<type>_<index>` 直属恢复，普通 `@` 保持 Pi 原有文件行为；autocomplete 展示完整 agent_id 但插入用户友好简写。
5. 更新 Task Panel / TaskSource：以 `agent_id` 作为稳定可见身份，内部保留 execution 令牌隔离事件；渲染 interrupted 状态和恢复提示。
6. 更新工具描述、错误消息和测试，使公开结果不包含 `execution_id`。

### 验证

- 工具契约与输入错误测试：subagent 的旧 `execution_id` 被拒绝且 `agent_id` 通过；workflow 现有 `execution_id` 流程保持通过。
- wait/stop/message 竞争测试：旧异步事件不会影响恢复后的新运行。
- UI/Task Panel 测试：完整 agent_id 展示、`@agent:` 输入/补全、状态、嵌套可见性和 interrupted 文字。
- 全量 `extensions/agent-tasks` 与相关 `task-ui` 测试、lint/typecheck。

### 提交检查点

公开工具契约、UI 迁移和回归测试在同一提交中完成。

## 最终验证

1. 执行项目规定的 lint、typecheck 和全量相关测试。
2. 人工/自动验证流程：创建嵌套 Agent → 让其中一个处于运行态 → 关闭/重启 Pi → 父级收到中断通知 → 逐层用完整 `agent_id` 恢复；使用 `@agent:resume:<type>_<index>` 输入时仅解析直属实例；旧运行不再可管理。
3. 检查 Git diff，确认不修改项目仓库内的 session 数据，也未引入旧 handle/alias 兼容分支。
4. 执行 `trellis-check` 自检或独立检查；高风险的生命周期与工具契约变更优先采用独立 `trellis-check`。
5. 所有阶段经验证后按项目工作流提交；不推送、不改写历史。

## 风险文件

- `extensions/agent-tasks/src/agent-manager.ts`
- `extensions/agent-tasks/src/agent-runner.ts`
- `extensions/agent-tasks/src/index.ts`
- `extensions/agent-tasks/src/nested-tools.ts`
- `extensions/runtime-tasks/*`
- `extensions/runtime-tasks/__tests__/*`
- `extensions/agent-tasks/src/management.ts`
- `extensions/agent-tasks/src/source.ts`
- `extensions/agent-tasks/src/types.ts`
- `extensions/agent-tasks/src/ui/agent-mention.ts` 及相关 UI
- `extensions/task-ui/*`

## 回滚

每个阶段独立提交。若后续阶段发现恢复语义或公开工具迁移不可接受，可回滚该阶段提交；registry schema 与新 ID 模型的已批准不兼容范围不承担旧数据迁移。
