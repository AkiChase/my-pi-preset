# 设计：Agent 短标签与恢复命令

## 标签模型

新增一个由 Agent 类型与直属父级范围内 registry index 派生的展示/恢复短名：

```text
<normalized-type>-<index>
```

例如 `general-purpose` 类型、index 为 `2` 的 Agent 显示为 `general-purpose-2`。

类型规范化沿用已有恢复短名的安全规则：小写、非字母数字分隔符归一；仅将最终连接符从下划线调整为连字符。该短名不是持久身份，不能替代 `agent_id` 用于管理工具或 registry。

## 复用边界

将短名派生逻辑保留在 `extensions/agent-tasks/src/mention.ts` 的共享 helper 中，使以下路径使用完全相同的格式：

1. `@agent:resume` 的直属 child 查找；
2. 编辑器自动补全插入值与可见候选标签；
3. Agent `TaskView.title`，从而覆盖 Task Panel 与 footer overview。

TaskView 仍使用完整 `taskId`/`key` 维护选择、控制、详情和生命周期身份；只改 `title`。详情与管理工具不从短名反推完整 ID。

## 命令兼容性

新格式为唯一格式：

```text
@agent:resume:general-purpose-2 继续工作
```

旧的 `general_purpose_2` 不做兼容。resume handler 继续使用既有“无直属匹配项”的通知路径，避免额外隐式迁移或双格式歧义。

## 诊断与公开身份

`agent_id` 的生成、registry 保存和 `agent_manage` / `subagent_message` 参数保持不变。任何现有需要完整 ID 的工具输出或诊断文本继续保留该值。自动补全、Task Panel 与 footer 仅作为面向人阅读的主要展示面，使用短名。

## 验证

- 更新 `mention.ts` 的格式断言，以及 resume 查找的新格式/旧格式拒绝测试。
- 更新自动补全测试，验证候选的 label 与插入值都使用短名。
- 更新 agent TaskSource/Task UI 相关测试，验证 Task Panel 与 footer 从 `TaskView.title` 获得短名而不影响 TaskIdentity。
- 运行聚焦 agent-tasks 与 task-ui 测试、TypeScript typecheck、`git diff --check`。

## 风险与回滚

唯一有意的兼容性破坏是旧恢复简写被拒绝；文档须与代码同一变更提交。实现局限在 label 派生与 UI title，不触及 Agent ID、registry 或运行时管理，因此可通过回滚该提交恢复旧命令和显示格式。
