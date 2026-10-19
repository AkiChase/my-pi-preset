# 设计：Task Viewer 文档优先与归档浏览

## 范围与所有权

- UI 状态、Tab、列表特殊行和键盘导航归 `extensions/trellis/lib/task-browser/component.ts`。
- 任务枚举、归档月份和文档读取归 `extensions/trellis/lib/task-browser/reader.ts`。
- 用户可见入口及按键说明归 `docs/extensions/trellis.md`。
- 不修改 `.trellis` 运行时脚本、任务存储布局或归档生命周期。

## 详情页

详情 Tab 固定为 `PRD | Design | Implement | Metadata`，进入详情时 section 为 PRD。

每个文档页面在 Markdown 正文之前渲染相同的紧凑摘要。摘要只包含稳定的导航上下文：任务标签、状态、当前任务标记，以及存在时的 priority 与 assignee。文本经过现有 `safeText()` 处理并按终端宽度换行；缺失可选字段不留占位。

Metadata 复用现有 Overview 的所有已知字段渲染规则，但作为最后一个 Tab。该页面保留完整字段可见性，窄窗口通过现有滚动与换行机制确保内容可达。

## 列表和 Archive 导航

Reader 显式接受浏览范围，而不是让 Component 自行拼接路径：

- `active`：现有默认行为，枚举非归档直接任务目录并投影活跃任务树。
- `archive-months`：只读取安全解析出的归档月份目录，按倒序展示月份。
- `archive-month`：只读取所选月份内的直接任务目录；不根据 parent/children 投影跨月或跨活跃边界的树，列表为该月稳定排序的扁平任务集。

活跃列表末尾追加一个非任务的 `Browse archive` 行。其视觉与真实任务行区分；Enter 将状态转到归档月份列表。月份列表 Enter 进入月内任务列表，任务 Enter 进入详情。Archive 中 Esc 沿层级回退至 Active；Active 中 Esc 保留原有关闭语义。刷新保持当前范围；当选择的月份或任务不再存在，选择和列表安全夹取。

标题、页脚位置计数和操作提示必须反映当前范围，避免把浏览月份或入口行误报为任务总数。

## 安全与兼容性

沿用 Reader 的 `realpathSync`、`containsPath`、`regularTaskFile`、UTF-8 和大小预算校验。归档枚举只接纳格式为 `YYYY-MM` 的直接目录，并验证其真实路径仍位于 archive 根内；月内任务与活跃任务使用相同的 task.json 和文档验证。符号链接、悬挂路径、损坏 JSON 或非法文件通过现有 bounded diagnostics 体现，不进行目录遍历扩大或越界读取。

归档详情中的 `dir` 保持项目相对路径，因而 `readDocument()` 可沿用原有身份复核和文档防逃逸约束。

## 验证策略

- Reader 测试：活跃默认不变、归档月份发现/排序、月内任务读取、异常/路径逃逸/符号链接拒绝和归档文档读取。
- Component 测试：若现有可测试 seam 支持，覆盖 Tab 默认值、Metadata 顺序和可见 Archive 入口/返回状态；不新增真实 Pi 或 TUI 测试，遵循 Trellis 测试规范。
- 完整性：Trellis MJS 测试、严格 typecheck、完整 package 检查、Markdown 链接和 diff whitespace 检查。

## 回滚

改动仅是读取与只读展示。若需要回滚，恢复 Component、Reader、测试和文档的同一提交即可；不会迁移或修改任何 task 目录。
