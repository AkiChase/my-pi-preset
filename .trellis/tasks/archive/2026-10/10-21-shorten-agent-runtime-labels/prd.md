# Shorten agent runtime labels

## Goal

将运行中的 Agent 在 Task Panel、footer 和输入补全中的冗长标识替换为一致、可读的 `类别-index` 短名；将 `@agent:resume` 的用户输入同步改为连字符格式，同时不改变 Agent 的持久化或管理身份。

## Confirmed facts

- `extensions/agent-tasks/src/source.ts` 将 `record.id` 直接设为 Agent `TaskView.title`；Task Panel 行和 footer overview 都经由 `taskTitle()` 显示此标题。因此二者共享同一个展示源。
- 现有持久化 Agent ID 格式为 `agent_<规范化类型>_<index>_<uuid8>`，例如 `agent_general_purpose_2_bd90a600`；该 ID 仍用于管理工具、持久化和运行时寻址。
- 已存在父级作用域内的恢复短名，但当前格式是 `general_purpose_2`：`resumeKey()` 生成它，自动补全插入它，resume 查找按该字面值匹配。
- `@agent:resume` 的输入解析允许连字符；把生成和查找的规范统一为连字符格式即可实现新命令，不需要改变解析器的基本语法。
- 历史任务曾规定 Panel/公开 UI 显示完整 ID；本任务按用户确认更新该展示策略。完整 ID 不再是主要 UI 标签，但仍是公开工具和持久化的身份。

## Requirements

1. Agent 的 Task Panel 行、footer overview 和 `@agent:resume` 自动补全候选统一显示 `type-index` 短名，例如 `general-purpose-2`。
2. `@agent:resume:general-purpose-2 <message>` 是自动补全生成且唯一接受的恢复简写。
3. 旧的 `@agent:resume:general_purpose_2 <message>` 不再兼容，应按未找到直属 Agent 的既有失败路径拒绝。
4. 完整 `agent_id` 保留在管理工具参数/结果、持久化数据及诊断需要的详情中；不得改变 ID 生成、注册表或管理 API。
5. 更新用户文档与聚焦测试，避免界面、命令和文档的格式不一致。

## Out of scope

- 改变 `agent_id` 的生成格式、UUID 碰撞策略、注册表 schema 或恢复执行语义。
- 修改 `agent_manage`、`subagent_message` 等管理工具的完整 ID 参数契约。
- 为旧下划线恢复短名提供迁移、提示或兼容分支。
- 修改 workflow execution ID 或普通 shell/monitor 的显示。

## Acceptance criteria

- [ ] Task Panel 与 footer 对同一 Agent 一律显示相同的 `type-index` 短名，而不显示完整 `agent_id`。
- [ ] 自动补全候选标签及其插入值均为 `@agent:resume:type-index`；不显示完整 ID 作为候选主标签。
- [ ] `@agent:resume:general-purpose-2 <message>` 能定位相应直属 Agent，`general_purpose_2` 不能定位。
- [ ] 完整 `agent_id` 仍在既有管理工具、持久化和诊断路径中保持不变。
- [ ] 相关单元测试、类型检查和 diff 格式检查通过。

## Decisions

- UI 和恢复短名统一使用连字符：`general-purpose-2`。
- 旧下划线命令格式不兼容：只保留新格式。
- 输入自动补全的可见候选也使用短名；完整 ID 不在该主界面候选中展示。
- 详情/诊断与工具寻址继续使用完整 ID。

## Open questions

无。
