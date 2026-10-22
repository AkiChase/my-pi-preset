# 统一嵌套 Agent 任务展示

## 目标

通过在 Footer 和任务面板中呈现一致、静态且基于短名的 Agent 树，让用户能够一眼辨识嵌套 Agent 的父子关系。父子关系应优先于生命周期提示；生命周期提示不得使用动画 spinner。

## 已确认事实

- `extensions/agent-tasks/src/source.ts` 已通过 `parentKey` 暴露嵌套归属关系；存在 `registryIndex` 时，已使用 `general-purpose-3` 这类作用域内短标题。
- `extensions/task-ui/model.ts` 为任务面板构建完整父子树；`extensions/task-ui/overview.ts` 的紧凑概览目前只保留并渲染根任务。
- `extensions/task-ui/presentation.ts` 负责当前任务字形映射。向其传入帧序号时，`running` 和 `starting` 会显示动画化的盲文 spinner；`taskLine()` 把字形置于树前，并保留 `[running]` 等文本生命周期后缀。

## 需求

1. Footer 概览、任务面板行和选中任务状态展示共用一套静态生命周期字形。
2. 正在运行的 Agent（包括等待嵌套子 Agent 的父 Agent）统一使用静态活跃标记 `●`。
3. 这些界面中的 Agent 生命周期不得显示动画 spinner 帧。
4. 嵌套 Agent 层级应将标记置于树枝之后、短 Agent 名之前：

   ```text
   └─ ● general-purpose-3
      └─ ● general-purpose-0
   ```

5. UI 中存在作用域内短标题时，不展示内部 `agent_id`。
6. Footer 和任务面板行移除正常状态的冗余生命周期文本，例如 `[running]`、`queued` 或 `thinking`。布局有空间时，仍可展示时长、子项数量、工具调用次数和 token 数等运行信息。
7. 非 Agent 任务类型和错误诊断仍应易于理解；详情视图继续用文本展示错误细节。
8. Footer 空间保持有界；它应展示活跃 Agent 层级或经过明确设计的紧凑表示，不能因为子 Agent 是嵌套项而静默丢失。

## 范围外事项

- 修改 Agent 工具和管理 API 接受的真实 `agent_id`。
- 修改 Agent 调度、生命周期语义、嵌套深度限制或任务归属数据。
- 增加动画状态图案，或增加字形主题配置。
- 重做无关的 workflow 卡片或内联工具结果渲染；仅当共享状态辅助函数必然受影响时才调整。

## 验收标准

- [ ] Footer 可见正在运行的嵌套 Agent 及其相关父级层级；活跃子 Agent 不会仅因其为嵌套项而被静默隐藏。
- [ ] Footer 和任务面板都将静态生命周期标记放在树连接符后、作用域内 Agent 短名前。
- [ ] 正在运行的 Agent 与等待子 Agent 的父级都显示 `●`；两个界面均不为其渲染盲文 spinner 动画。
- [ ] 正常的 Footer 和任务面板行不重复展示 `[running]`、`queued`、`thinking` 或类似状态文本。
- [ ] 排队、暂停、完成、停止与失败仍通过稳定字形可区分；详情视图仍可读取失败详情。
- [ ] 现有树结构、窄宽度、动画刷新和 Agent 短名行为均保留测试覆盖，或补充聚焦自动化测试。

## 授权边界

用户已授权创建本规划任务，并认可本 PRD 中的 UX 方向。实现、会改变状态的测试执行以及提交，仍需在最终计划审阅后另行批准。
