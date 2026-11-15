# 手动转后台对 Agent 可见

## Goal

用户用 `/task-detach` 或 `Ctrl+Shift+B` 手动把前台任务转后台、或手动结束一次等待时：
- 模型从工具结果里能看出“这是用户手动操作”，不会误以为是配置或默认行为导致；
- 用户在工具卡片上也能看出是手动转的，并保留转后台那一刻的进度统计。

## Background / Confirmed Facts

- 触发来源：`task-ui/controls.ts:14` 与 `task-ui/panel.ts:266` 调用 `coordinator.detachAll()`，默认 `reason = "manual"`（`task-ui/coordinator.ts:74,89`）。`DetachReason = "manual" | "timeout"`（`task-ui/types.ts:172`）；`timeout` 目前只有 `bash` 的 `background_after_seconds` 产生（`process-tasks/tools/bash.ts:223,238`）。检索类等待只会被 `detachAll()` 释放，Esc/abort 走 `interrupted`（显示为 `cancelled`）。
- 模型可见文本：
  - `bash` 已区分：手动时返回 `Command was manually backgrounded by user ...`（`process-tasks/tools/bash.ts:300-303`）。
  - `subagent_run` 未区分：`agent-tasks/src/index.ts:1933-1936` 只返回 `Agent continuing in background.`。
  - `AgentManager.detachRun`（`agent-tasks/src/agent-manager.ts:573`）把 `executionConfig.mode` 改为 `background` 并删掉 mode difference，结果头部显示 `Execution config (session-effective): ... mode=background.`（`runtime-tasks/execution-config.ts:56-61`），看起来像配置生效值；后续 `agent_manage` 结果沿用该摘要（`agent-tasks/src/management.ts:11`）。difference reason 白名单在 `runtime-tasks/execution-config.ts:9,45`。
  - 检索类等待被释放只返回 `Wait released; ...`：`agent-tasks/src/management.ts:69`、`process-tasks/management.ts:88`、`agent-tasks/src/workflow/management.ts:54`、`agent-tasks/src/index.ts:2605`（`subagent_message wait`）。
- 卡片（离线探针实测：真实注册的 `subagent_run` + beautify 渲染器，前台启动 → 2 次子工具调用 → `detachAll()` → 继续活动 → 完成；探针与临时目录已删除）：
  - 转后台前（partial）：`Running` + `⠹ ↻1 · 2 tool uses` + `⎿ thinking…`。用户看到的 `↻1 · 2 tool uses · 16.4k token` 就是这一帧。
  - 转后台后（final）：标记 `Completed`，正文 `⎿ Target: running in background (ID: …)` + `Target state: background`（`agent-tasks/src/index.ts:316`）；统计行消失，因为 detached details 写死 `toolUses: live.toolUses`（前台路径计数实际在 `fgState`）、`tokens: ""`（`index.ts:1934-1936`），且未带 `turnCount`。展开后执行配置只有 `mode: background`。
  - 之后子 Agent 继续或完成，卡片不变（工具结果是快照；完成由通知卡片展示）。
  - bash 卡片手动/非手动都只显示 `background ID: …`（`beautify/tools/bash.ts:17-18`）。
  - 等待释放卡片显示 `wait released · target unchanged`（`beautify/tools/management.ts:28`、`beautify/tools/task-manage.ts:21`）。
- `↻N` 轮数显示由 `fe8d0f6` 引入，`53ef147` 仅迁移到公共卡片，非本次问题。

## Requirements

- R1 `subagent_run` 手动转后台时，返回文本明确是用户手动转后台（措辞与 bash 一致，如 `Agent was manually backgrounded by user.`），保留 Agent ID、输出文件、继续执行与完成通知说明。
- R2 手动转后台后，执行配置保留 `mode=background`，并记录 mode difference：requested 为原前台模式，effective 为 `background`，reason 为新增的 `manual-detach`。该 difference 在之后的 `agent_manage` 结果与展开卡片中同样可见。
- R3 检索类等待（`agent_manage`、`process_manage`、workflow、`subagent_message`）被手动释放时，文本说明由用户释放（如 `Wait released by user; target unchanged.`）；`wait_outcome` 元数据保持 `released`。
- R4 卡片（方案 A，用户已选）：顶部标记保持 `Completed` 不变；
  - `subagent_run` 转后台卡片保留转后台那一刻的统计行（`↻N · N tool uses · tokens`），正文改为 `⎿  Target: manually backgrounded by user (ID: …)`；
  - bash 手动转后台卡片显示 `manually backgrounded · ID: …`，非手动保持 `background ID: …`；
  - 等待释放卡片显示 `wait released by user · target unchanged`。
- R5 不改变任何执行语义：同一执行继续、ID 不变、完成通知照旧。

## Acceptance Criteria

- [ ] 前台 `subagent_run` 被 `detachAll()` 释放后，结果文本包含 `manually backgrounded by user`，执行配置摘要带 `mode requested "foreground", effective "background" (manual-detach)`；之后 `agent_manage status` 结果同样带该 difference；`isAgentExecutionConfig` 接受 `manual-detach`。
- [ ] 该结果的卡片：标记 `Completed`，有 `↻N · N tool uses` 统计（与转后台前一致），正文 `Target: manually backgrounded by user (ID: …)`，展开后 Differences 显示 mode 差异。
- [ ] bash 手动转后台卡片显示 `manually backgrounded · ID: …`；超时转后台仍为 `background ID: …`；模型文本不变。
- [ ] 四类等待被手动释放时文本含 `released by user`，卡片显示 `wait released by user · target unchanged`；`wait_outcome` 仍为 `released`；取消路径不变。
- [ ] 后台启动（`execution: "background"`）卡片与文本不变。
- [ ] `pnpm check`（隔离 `PI_CODING_AGENT_DIR`）通过；新增/更新测试覆盖 R1–R4。
- [ ] 若 `docs/extensions/task-composition.md` 相关描述受影响，同步更新中文文档。

## Out of Scope

- 新的卡片顶部状态（如 `Backgrounded`）或修改 `tool-card.ts` 公共标记逻辑。
- 转后台后卡片实时刷新到完成。
- bash 模型可见文本（已正确）。
- nested-tools 中由父级 abort 引起的 `released`（`agent-tasks/src/nested-tools.ts:604`）。
- 新的 `wait_outcome` 枚举值或新的结构化字段。
- `↻N` 来源调整。
