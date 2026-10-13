# 已确认的冲突与隔离边界

## 运行时根因
- 本机加载 `npm:pi-input-history` 早于 preset。
- input-history 1.1.3 的 `index.ts:93–109` 在 `session_start` 加载同目录历史，包装现有编辑器工厂并调用 `addToHistory`。
- 已安装 preset 的 `extensions/bash-unified.ts` 初始化 pi-pretty。
- pi-pretty `src/index.ts:212–224` 保存旧工厂，但安装新 `PromptEditor` 时不调用旧工厂。
- Pi 1.1.0 的 `dist/modes/interactive/interactive-mode.js:2242–2304` 替换编辑器时复制文字、回调和外观，不复制历史。
- Alt+R 读取 input-history 独立的 `historyCache`，因此仍可搜索。
- `/new` 的 UI 重置在新 runtime 的 `session_start` 之前，不是启动事件之后又被 core 清空。

证据来源是本机已安装包；路径与行号仅作为调查定位，不作为测试对个人配置的依赖。回归测试必须离线隔离。

## 排除只改安装顺序
`scripts/sync.mjs` 的 `buildPackagePlan` 对已安装包执行 update/keep，不重排用户的包列表。只修改本机 settings 或 manifest 顺序无法保证老用户迁移及任意加载顺序。

## 工作隔离
- 创建任务时已提交基线：`07ec6bc`（`chore: record journal`）。
- 当前 worktree 分支：`feat/unified-task-panel`，大量无关未提交改动正在进行。
- 本任务计划实现分支：`feat/pretty-editor-compat`。
- 实现前创建持久独立 worktree，使用明确提交基线；不得 stash、reset、移动或提交其他任务改动。
- 规划阶段只写本任务目录和任务元数据。转入独立 worktree 时仅复制本任务规划产物及必需开发上下文，不复制未提交运行时代码。
- 合并时 `extensions/bash-unified.ts` 和 README 可能与其他任务重叠；保持兼容改动局部，并明确记录合并检查项。
