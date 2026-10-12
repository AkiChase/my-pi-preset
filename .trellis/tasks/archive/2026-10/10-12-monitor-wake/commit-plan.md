# 提交计划（用户已确认）

当前分支 `feat/monitor-wake`。测试和独立审查已通过，用户已确认以下两个提交，并要求合并回 `main`；只纳入本任务相关的文档和改动，不 push。

按以下两个逻辑单元执行。不使用 `git add .`，不 amend，不纳入其他 task 或未改动基础设施。

## 1. `docs: use Chinese for project and task documentation`

用户本会话明确要求的文档语言调整：

- `.trellis/spec/preset/repository-guidelines.md`
- `.trellis/spec/preset/documentation.md`

`index.md` 同时包含语言规则链接和新 monitor 契约索引，整文件放在下一条提交，避免第一条提交引用尚未提交的新规范。

## 2. `feat: add batched monitor wakes and unified output handling`

### 用户文档与规范

- `README.md`
- `extensions/bg-tasks/PROVENANCE.md`
- `.trellis/spec/preset/index.md`
- `.trellis/spec/preset/extension-guidelines.md`
- `.trellis/spec/preset/monitor-contract.md`

### 实现

- `extensions/bg-tasks/config.ts`
- `extensions/bg-tasks/index.ts`
- `extensions/bg-tasks/lifecycle.ts`
- `extensions/bg-tasks/monitor-buffer.ts`（新增）
- `extensions/bg-tasks/monitor-follow.ts`（删除）
- `extensions/bg-tasks/monitor-session.ts`
- `extensions/bg-tasks/monitor-source.ts`
- `extensions/bg-tasks/monitor-ws.ts`
- `extensions/bg-tasks/monitoring.ts`
- `extensions/bg-tasks/notify.ts`
- `extensions/bg-tasks/tools/monitor.ts`
- `extensions/bg-tasks/types.ts`（投递注释）

### 离线测试

- `extensions/bg-tasks/__tests__/config.test.ts`
- `extensions/bg-tasks/__tests__/index.test.ts`
- `extensions/bg-tasks/__tests__/monitor-buffer.test.ts`（新增）
- `extensions/bg-tasks/__tests__/monitor-follow.test.ts`（删除）
- `extensions/bg-tasks/__tests__/monitor-session.test.ts`
- `extensions/bg-tasks/__tests__/monitor-source.test.ts`（新增）
- `extensions/bg-tasks/__tests__/monitor.test.ts`
- `extensions/bg-tasks/__tests__/notify.test.ts`

### 当前 task 的需求、设计与验证记录

- `.trellis/tasks/10-12-monitor-wake/task.json`
- `.trellis/tasks/10-12-monitor-wake/prd.md`
- `.trellis/tasks/10-12-monitor-wake/design.md`
- `.trellis/tasks/10-12-monitor-wake/implement.md`
- `.trellis/tasks/10-12-monitor-wake/implement.jsonl`
- `.trellis/tasks/10-12-monitor-wake/check.jsonl`
- `.trellis/tasks/10-12-monitor-wake/implementation-validation.md`
- `.trellis/tasks/10-12-monitor-wake/review-findings.md`
- `.trellis/tasks/10-12-monitor-wake/review-validation.md`
- `.trellis/tasks/10-12-monitor-wake/research/original-plan.md`（原始历史输入）
- `.trellis/tasks/10-12-monitor-wake/research/design-evidence.md`
- `.trellis/tasks/10-12-monitor-wake/research/source-drain.md`
- `.trellis/tasks/10-12-monitor-wake/research/merged-output.md`
- `.trellis/tasks/10-12-monitor-wake/research/follow-up-boundary.md`
- 本文件 `commit-plan.md`

## 未纳入本次提交的预存／其他会话文件

这些路径没有由本会话修改，不静默加入：

- `.trellis/.gitignore`
- `.trellis/.template-hashes.json`
- `.trellis/.version`
- `.trellis/config.yaml`
- `.trellis/workflow.md`
- `.trellis/workspace/index.md`
- `.trellis/agents/check.md`
- `.trellis/agents/implement.md`
- `.trellis/scripts/` 下全部未跟踪基础设施文件
- `.trellis/tasks/10-12-subagents-task-ux/` 下全部规划、研究及任务元数据

本次两条提交均不包含这些文件，不提交后续 task 的规划，也不提前改名或启动其实现。

## 确认与收尾

用户已回复“行”，随后明确“和本任务相关的文档”。执行以上两个提交后合并回 `main`，不 push；无关预存文件和后续任务仍排除。收尾／归档和会话日志是产品工作提交后的独立流程，不混进这两条提交。
