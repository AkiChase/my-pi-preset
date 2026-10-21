# 实施计划：Agent 短标签与恢复命令

## 授权状态

- 已获授权：创建任务、调查现状、讨论并完成本计划，以及按本计划实现、验证并创建本地 scoped commit。
- 未获授权：推送、发布、安装或下载依赖。
- 用户已确认的产品决策：主 UI、补全候选和恢复命令采用 `general-purpose-2`；旧 `general_purpose_2` 不兼容；完整 ID 保持为工具与诊断身份。

## 实施与检查路径

预计由主会话直接实施并自检：范围小、修改集中，且现有测试可覆盖跨 UI/命令契约。开始实现前读取适用 spec，并在一个阶段完成代码、文档和测试；不派发子代理，`implement.jsonl` 与 `check.jsonl` 保持未使用。

## Stage 1：统一短名格式

### 变更边界

- **行为差距：**主要 UI 与 `@agent:resume` 仍使用下划线/完整 ID，而非已批准的 `type-index` 格式。
- **权威 owner：**`mention.ts` 负责短名派生；`index.ts`、自动补全 provider 与 Agent TaskSource 只消费它。Task UI 只渲染 TaskSource title，无须新增 formatter。
- **预期文件：**共享短名派生及消费者、其聚焦测试和用户命令文档。
- **排除项：**持久化 ID、registry schema、管理工具、workflow identity 与非 Agent task title。
- **保持性证明：**测试将验证 TaskIdentity/完整管理 ID 仍稳定，只有展示 title 与显式 resume 简写改变。

### 执行记录

- 将 `resumeKey()` 统一为 `type-index`，新增同一 owner 的 `matchesResumeKey()`，使 resume 查找严格接受新格式且旧下划线格式不匹配。
- 自动补全的插入值和可见 label 均使用共享短名；Agent TaskSource 在有有效 registry index 时把 `TaskView.title` 设为同一短名，TaskIdentity/taskId 仍是完整运行时身份。异常缺失 index 的记录保留完整 ID，避免伪造短名。
- 更新中文用户文档和聚焦断言，覆盖新格式、大小写匹配、旧格式拒绝、TaskSource 短 title 与 taskId 保持不变。
- 验证（现有 SDK、隔离 `PI_CODING_AGENT_DIR`，未安装/下载依赖）：
  - `node --test extensions/agent-tasks/__tests__/agent-mention.test.ts extensions/task-ui/__tests__/panel.test.ts extensions/task-ui/__tests__/overview.test.ts`：PASS，44 tests。
  - `pnpm typecheck`：PASS。
  - `node --test extensions/agent-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts`：PASS；随后 `pnpm check`：PASS，1623 tests / 79 suites。
  - `git diff --check`：PASS。
- Stage 1 提交：`0921d85 feat(agent-tasks): shorten runtime agent labels`。
- 检查路径：该变更局部、低风险且有聚焦的 parser/TaskSource/UI 覆盖，因此采用主会话自检而非独立 reviewer；这不是独立审查。
- 最终任务校验：`task.py validate` 按预期因未使用的空 `implement.jsonl` 和 `check.jsonl` 返回 exit 1；任务已通过 `--allow-empty-context` 直接启动，未将其描述为完整 validation PASS。

### 修改范围

- `extensions/agent-tasks/src/mention.ts`
- `extensions/agent-tasks/src/index.ts`
- `extensions/agent-tasks/src/ui/agent-mention.ts`
- `extensions/agent-tasks/src/source.ts`
- 相关 `extensions/agent-tasks/__tests__/…`
- 相关 `extensions/task-ui/__tests__/…`
- `docs/extensions/task-composition.md`

### 工作项

1. 将共享短名 helper 改为连字符 `type-index` 格式，并保持确定性类型规范化。
2. 让 resume 查找仅使用新 helper 的结果；不增加旧下划线 fallback。
3. 让自动补全插入值与候选 label 都使用短名。
4. 让 Agent TaskView title 使用同一短名；Task Panel 和 footer 自动沿用，不改 TaskIdentity 或控制操作。
5. 更新文档与测试，覆盖新格式、旧格式拒绝、Panel/footer 显示及完整 ID 契约未变。

### 验证

```sh
node --test extensions/agent-tasks/__tests__/agent-mention.test.ts \
  extensions/agent-tasks/__tests__/*.test.ts \
  extensions/task-ui/__tests__/presentation.test.ts \
  extensions/task-ui/__tests__/overview.test.ts \
  extensions/task-ui/__tests__/panel.test.ts
pnpm typecheck
git diff --check
```

执行时会按实际相关测试文件收敛命令，保留所有真实失败及其原因；不安装或下载依赖。

### Commit checkpoint

短名 helper、resume 命令、自动补全、TaskSource、文档和同一契约的测试必须作为一个提交，避免发布状态出现输入、面板与文档格式不一致。用户未要求不提交，因此验证完成后按项目工作流创建 scoped local commit；不 push。

## 风险与回滚

- **预期破坏：**旧下划线恢复短名会被拒绝。以文档和回归测试锁定这一已确认决策。
- **身份误用：**仅修改 `TaskView.title`，不修改 task key、record ID、registry 或工具参数；测试验证控制/身份路径仍使用完整 ID。
- **显示漂移：**Panel 与 footer 都使用共享 title；测试覆盖两处，避免单独格式化造成偏差。
- **回滚：**回滚此阶段提交即可恢复旧 UI 和恢复命令，不影响持久化 Agent 数据。
