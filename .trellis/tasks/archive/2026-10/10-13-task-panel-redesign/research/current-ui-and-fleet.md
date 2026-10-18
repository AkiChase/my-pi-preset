# 已确认的任务 UI 与 FleetView 证据

## 来源
- `extensions/task-ui/model.ts`：TaskPanelModel 与根组终态保留规则。
- `extensions/task-ui/types.ts`：TaskView、TaskExecutionMode、waitCount 与 stats。
- `extensions/task-ui/panel.ts`：现有双栏与 selected 有界详情。
- `extensions/task-ui/owner.ts`：共享 footer、subscription、overlay owner。
- `extensions/task-ui/coordinator.ts`：wait lease 注册、按 identity 计数、全局 detachAll。
- `extensions/agent-tasks/src/source.ts`、`extensions/process-tasks/source.ts`：真实归属及只读投影。
- 原插件本机只读副本 `/tmp/pi-trellis-provider-check.3sPC01/node_modules/@tintinweb/pi-subagents/src/ui/fleet-list.ts`：已完整阅读；临时路径不是运行依赖，落地不得依赖它。

## 实际语义
- 普通父子 agent 绑定 parentAgentId 与启动时 parentRunId，workflow 通过 workflowId 归属；嵌套 parent 优先于 workflow。
- background join group 仅合并完成通知，不创建 TaskView.parentKey，不应画成任务父组。
- 活跃根组保留后代；根组终态后按根 endedAt 保留四秒。选中 final snapshot 可保留到切换选择或关闭。
- executionMode 与 waitCount 独立：background + retrieval wait 可以共存；detachAll 只解除现有等待，launch wait 回调才改变执行归属。
- Agent title 目前为 alias/handle/type，description 才是用户委派任务描述；workflow meta.description 尚未投影。
- Agent stats 已有 tokens/input/output/cost/tools/turns/activity/model/thinking 等；上下文占比与 compaction 尚未暴露。

## 原 FleetView 的视觉与交互边界
- 使用 belowEditor widget，位于输入框下方、footer 上方。
- 单行 agent：左侧圆点、类型名称与任务描述，右侧整数秒耗时、`↓ compact tokens` 和可选费用。
- workflow 行使用相同结构，并添加 done/total agents。
- rightAlign 先预留右侧 visibleWidth，再截断左侧，最终 clamp 防止换行。
- 默认最多五个任务行；上方/下方隐藏数量用 `↑ N more` / `↓ N more` 表达，末尾空行与 footer 分开。
- 原圆点表示选择；本任务改变为两处统一的运行情况语义，面板背景承担选择。
- 原交互依赖空编辑器条件、onTerminalInput、main 行和独立 conversation/workflow overlays；本任务明确全部不恢复。
- 原 roster 包含 workflow 与顶层 agent，但完整父子树及汇总口径需要以共享 TaskView 为准，不能简单照搬 roster 后重复计算。

## 当前工作区风险
本任务创建时存在 monitor-session-batching 与 .pi 生成文件的无关改动。实施应在独立分支/worktree 或明确串行归属后执行，尤其 README、testing 规范、process harness 等潜在交叉文件不得覆盖既有修改。当前研究只读，没有修改产品代码。
