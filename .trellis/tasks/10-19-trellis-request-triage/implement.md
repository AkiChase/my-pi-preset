# 实施计划

执行人：主会话直接实现。审查方式：S1 由主会话自查；S2 涉及资源发布路径（会写入用户文件，并新增备份逻辑），由 `trellis-check` 做独立审查，派发前先整理 `check.jsonl`。每个阶段验证通过后单独提交本地 commit，不 push。

## S1 文档资源与规则
- [ ] 重写 `extensions/trellis/resources/templates/agents-block.md`（design 1.1）
- [ ] 修改 `extensions/trellis/resources/templates/workflow.md`：Core Principles、Request Triage、`no_task` breadcrumb（design 1.2）
- [ ] 修改 `extensions/trellis/skills/trellis-start/SKILL.md` Step 4；grep 其他技能中的冲突措辞（design 1.3）
- [ ] 更新 `template-baseline.json` 和 `skill-baseline.json` 中的哈希
- [ ] 更新 `__tests__/workflow-policy.test.mjs` 的断言
- 检查：
  - `node --test extensions/trellis/__tests__/workflow-policy.test.mjs extensions/trellis/__tests__/skill-resources.test.mjs extensions/trellis/__tests__/initialization.test.mjs extensions/trellis/__tests__/apply-template.test.mjs`
  - `pnpm run typecheck`
- 提交：`feat(trellis): restore request triage and slim AGENTS block`

## S2 Update resources 刷新托管区块
- [ ] `resources.ts`：新增 `ROOT_BLOCKS`、`reviewRootBlocks`，`Change.backup`，`resourcePlan` 纳入区块评估，`applyResourcePlan` 先备份再写入并返回备份路径（design 2.3–2.4）
- [ ] `command.ts`：确认对话框的 Backup 行、区块变更标签、结果通知（design 2.5）
- [ ] `diagnostics.ts`：新增 `inventory:root-block` 诊断项（design 2.6）
- [ ] 测试：在 `resource-update.test.mjs` 中补 design 4 列出的 7 个用例，外加诊断用例
- [ ] 文档：`docs/extensions/trellis/initialization.md`、`.trellis/spec/development/index.md`
- 检查：
  - `node --test extensions/trellis/__tests__/resource-update.test.mjs extensions/trellis/__tests__/adopt-block.test.mjs extensions/trellis/__tests__/initialization.test.mjs`，以及诊断相关测试
  - `pnpm run check`（类型检查 + 全量测试）
  - `trellis-check` 独立审查
- 提交：`feat(trellis): refresh managed root blocks during Update resources`

## S3 刷新本项目的部署副本
- [ ] `/reload` 加载新扩展后，由用户在 TUI 中执行 `/trellis-init` → `Update resources`，走真实路径。确认预览中包含 `AGENTS.md`、`.gitignore` 区块、`.trellis/workflow.md` 和 `trellis-start` 技能。
- [ ] 核对：
  - `AGENTS.md` 区块与模板一致，区块外的 Language Conventions 逐字节不变；
  - `.trellis/workflow.md` 与模板一致；
  - `.pi/skills/trellis-start` 与包内一致；
  - 备份目录存在，且内容是旧文件；
  - 运行 Check project，`inventory:root-block` 为 pass。
- [ ] 下一次会话的 `no_task` breadcrumb 显示新文本。
- 提交：`chore(trellis): refresh deployed Trellis resources`（只包含部署副本和 manifest，不包括 `.trellis/.runtime/` 下的备份目录，因为它已被 gitignore）

## 记录
（每个阶段完成后，在这里补上命令、退出码和 commit hash）
