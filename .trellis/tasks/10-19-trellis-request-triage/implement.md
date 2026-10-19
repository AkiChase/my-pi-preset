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

### S1 — `8555152`
- `node --test` 跑 trellis 全部测试：329/329 通过，exit 0。`pnpm run typecheck`：exit 0。
- 自查：workflow 模板 diff、`no_task` breadcrumb 抽取结果、baseline 哈希（agents-block `8197f245`、workflow `8803fe50`、trellis-start `b8668dc3`）。

### S2 — `859d132`
- 首次 `pnpm run check`：1521 个测试中 2 个失败，都在 `extensions/agent-tasks/__tests__/backend-waits.test.ts`。这个文件当时正被并行会话（task panel 重构）修改，不属于本任务范围，未处理。
- 第一次派发 `trellis-check` 遇到 provider 错误（thinking signature），重派后完成。
- 独立审查发现一处中等问题并已修复：`AGENTS.md`/`.gitignore` 是软链接、非普通文件、超大或不可读时，`reviewRootBlocks` 会抛异常，连带 `/trellis-init` 菜单、Update resources、Apply template 都无法使用。现在改为 "Unreadable file — preserved" 冲突状态。另有 3 处低等级问题已修复：模板损坏不再被误报成项目区块错误；字节与指纹改为一次读取；格式错误时提示改为先手工修复。新增软链接和 backup 标志篡改两个用例。
- 主会话复核：`pnpm run typecheck` exit 0；trellis 全部测试 + `scripts/*.test.mjs` 355/355 通过，exit 0。

### S3
- 已安装的扩展来自远程安装目录（`10357e1`），本地改动不 push 就无法通过 `/reload` 加载。经用户选择，改为用 node 直接调用本地源码的 `resourcePlan(root, "update")` + `applyResourcePlan`。
- 实际写入 4 个文件，0 个冲突：`.trellis/workflow.md`、`.pi/skills/trellis-start/SKILL.md`、`.pi/skills/trellis-brainstorm/SKILL.md`（部署副本原本就比包内旧）、`AGENTS.md`（先备份后替换）。`.gitignore` 区块已是最新。manifest 只更新了 3 个哈希，schema 未变。
- 核对结果：`AGENTS.md` 区块外内容与备份逐字节一致；区块、workflow、两个技能都与包内源一致；备份等于 HEAD 的 `AGENTS.md`，目录权限 0700，已被 gitignore；再次生成计划为 `unchanged`；`verifyRuntime` 通过；诊断中 `inventory:root-block`、`inventory:skill`、`inventory:runtime` 均为 pass；部署后的 `no_task` breadcrumb 已是新文本。
- 未验证：真实 TUI 中 `/trellis-init` 的菜单提示、Update resources 确认框和通知文案；新会话中实际注入的 breadcrumb。需要 push 并更新安装后补测。
- 备份保留在 `.trellis/.runtime/resource-backups/5547c7f1-3838-4a9c-be8f-867f99eb8781/`（不入库）。
