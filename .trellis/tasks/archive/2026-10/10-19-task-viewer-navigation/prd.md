# Refine task viewer navigation

## Goal

让 Task Viewer 以任务文档为主要入口：在阅读 PRD、Design 或 Implement 时持续保留必要任务上下文；完整元数据仍可按需查看。同时提供不干扰活跃任务浏览的归档任务只读入口。

## Confirmed Facts

- 现有 Task Viewer 位于 `extensions/trellis/lib/task-browser/`，详情页的 Tab 顺序为 `Overview | PRD | Design | Implement`；Overview 单独显示任务记录中的已知元数据。
- `readTasks()` 当前只枚举 `.trellis/tasks/` 的直接非归档目录；它会跳过 `archive/`，但能识别活跃任务与归档任务之间的层级引用，避免将归档任务错误报告为缺失。
- 已归档任务储存在 `.trellis/tasks/archive/YYYY-MM/<task>/`，并且 Reader 现有测试覆盖归档链接、符号链接和路径逃逸保护。
- Task Viewer 是只读 TUI；`/trellis-task-viewer` 在交互式终端中以全屏 overlay 打开。

## Requirements

1. 将详情 Tab 调整为 `PRD | Design | Implement | Metadata`；进入任务详情时默认打开 PRD。
2. PRD、Design、Implement 的每个文档页顶部显示紧凑、重复一致的任务摘要：标题、状态、当前任务标记，以及仅在有值时显示的优先级和 assignee。
3. Metadata 保留全部现有的低频任务元数据，包括 ID、名称、标题、描述、优先级、assignee、创建/完成时间、分支、父任务和子任务；信息可读且不因窄终端导致不可访问。
4. Task Viewer 默认只浏览活跃任务；归档任务必须通过明确、可发现的只读交互单独浏览，且不会与活跃任务树混排。
5. 归档任务详情复用相同的文档和 Metadata 页面；不提供恢复、编辑、重新激活或改变任务生命周期的操作。
6. 保留现有 Reader 的路径包含、常规文件、UTF-8、大小限制和归档符号链接安全保障；归档浏览不能弱化这些约束。
7. 补充 Reader 和 TUI 行为的自动化测试，并更新面向用户的 Trellis 文档说明入口与按键。

## Proposed Interaction

- 初始列表标题表明范围为 Active。
- 通过列表中的归档入口切换到 Archive 范围；归档范围按归档月份浏览，进入月份后显示该月任务。
- Archive 中打开任务后沿用 `PRD | Design | Implement | Metadata`；在 Archive 列表返回 Active，再返回才关闭浏览器。

## Acceptance Criteria

- [ ] 打开一个任务时，第一个可见页面为 PRD；Tab 顺序是 PRD、Design、Implement、Metadata。
- [ ] 三个文档页都显示相同规则的紧凑任务摘要，Metadata 不再承担日常导航中的唯一上下文来源。
- [ ] Metadata 页面可查看原 Overview 覆盖的所有已知元数据，缺失值不会制造空白或误导性字段。
- [ ] 默认列表只包含活跃任务，并提供可发现的归档浏览入口；归档任务不混入活跃任务树。
- [ ] 用户可以定位归档月份、打开该月任务，并读取其 PRD、Design、Implement 和 Metadata；归档浏览不允许修改任务。
- [ ] 归档存储、符号链接或任务文档异常时，错误以安全的诊断呈现，既不会越界读取也不会令浏览器崩溃。
- [ ] 相关自动化测试和 `docs/extensions/trellis.md` 已更新并通过。

## Out of Scope

- 搜索、过滤、按状态排序或全文检索任务。
- 从 Task Viewer 归档、恢复、编辑或启动任务。
- 将活跃任务与归档任务合并为同一棵父子树。
- 改变任务存储结构或既有归档生命周期。

## Key Decisions

- 归档入口采用活跃任务列表底部的 **Browse archive** 可见行；Enter 进入，确保不依赖用户记忆快捷键。
- 归档浏览按 `YYYY-MM` 月份分组，而非同活跃任务树合并；这样不会误导跨归档边界的父子关系。
- Archive 列表中 Esc 返回 Active 列表；只有在 Active 列表再按 Esc 才关闭浏览器。
