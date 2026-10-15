# 研究与验证证据

本目录不维护授权、决策或任务状态：需求见 [PRD](../prd.md)，合同见 [design](../design.md)，阶段、验收和提交见 [implement](../implement.md)。

## 源码研究

- [runtime-interface-map.md](runtime-interface-map.md)：迁移前后端能力、身份、等待、child 接线和外部耦合；旧名／行号是研究快照。
- [beautify-migration.md](beautify-migration.md)、[migration-surface.md](migration-surface.md)：展示与迁移耦合点。
- [completion-notification-diagnosis.md](completion-notification-diagnosis.md)：通知异常根因，后来由通知专项修复。
- [worktree-preparation.md](worktree-preparation.md)：首次 prepare 拒绝与恢复过程。

## 修复与独立检查

| 证据 | 作用 |
| --- | --- |
| [stage-2-implementation-report.md](stage-2-implementation-report.md) | 接续实现、自检与当时未覆盖项 |
| [stage-2-independent-check.md](stage-2-independent-check.md) | R1–R4 缺陷复现，历史 BLOCKED |
| [stage-2-fix-report.md](stage-2-fix-report.md) | 四项修复及红绿回归 |
| [stage-2-independent-recheck.md](stage-2-independent-recheck.md) | R1–R4 resolved，发现 N1 崩溃 |
| [stage-2-log-error-fix-report.md](stage-2-log-error-fix-report.md) | N1 修复、原始红测和 725 项自检 |
| [stage-2-log-error-independent-check.md](stage-2-log-error-independent-check.md) | N1 独立 20/20，通过 |
| [final-integration-independent-check.md](final-integration-independent-check.md) | 三方保留检查，独立 82/82，通过 |

BLOCKED 和旧测试计数是当时结果，不是当前状态；不回写失败为通过。

## 最终验证

- [source-integration-validation.md](source-integration-validation.md)：main strict、119 focused、773 full natural 与整合首败。
- [tmux-validation-2026-10-15.md](tmux-validation-2026-10-15.md)：隔离 CLI 方法、8 项功能和逐 cell 背景检查。
- [tmux-preparation.md](tmux-preparation.md)：夹具位置与准备限制。
- `tmux-runtime/`：首轮失败、四项修复后和最终 source 的 JSON 结果；最终目录包含事件与背景检查。
- `spec-baseline/`：角色执行时的规范快照，不是当前规范入口。
- `final-product-fingerprints.json`：验收时文件指纹；提交前仅修 `search.ts` 末尾空行，故该文件的验收指纹不是提交后的精确字节指纹。

完整脚本、raw ANSI、屏幕与阶段1日志仍保留在原 worktree。临时 `integration-review/` 候选、重复进度／验收草稿已删除，实际整合成果由 Git 提交保存。
