# Design: 手动转后台对 Agent 可见

## 数据流

`detachAll(reason="manual")` → `WaitLease.detach(reason)` → launch 注册的 `onDetach(reason)` → 工具 `execute` 收到 `{ kind: "detached", reason }`。

原因在两端都已可得：`onDetach` 的参数（agent-tasks `waits.ts:15` 当前忽略）和 outcome 本身（`subagent_run` 当前忽略）。不新增跨模块字段。

## 改动点

### runtime-tasks/execution-config.ts
- difference `reason` 联合与校验白名单新增 `"manual-detach"`。旧数据不受影响（只是放宽）。

### agent-tasks
- `waits.ts`：`onDetach: (reason) => manager.detachRun(run.identity, reason)`。
- `agent-manager.ts` `detachRun(identity, reason?)`：仍把 `mode` 设为 `background`；当 `reason === "manual"` 且原 mode 不是 `background` 时，以原 mode 为 `requested` 写入 `{ field: "mode", requested, actual: "background", reason: "manual-detach" }`，替换已有的 mode difference。非 manual（目前不会出现）保持当前行为。
- `index.ts` `subagent_run` detached 分支：
  - 文本：manual → `Agent was manually backgrounded by user.`，否则保留 `Agent continuing in background.`；后续 ID/输出文件/通知说明不变。
  - details：`toolUses: fgState.toolUses`、`tokens: formatLifetimeTokens(live)`、`cost`、`turnCount: fgState.turnCount`、`maxTurns: fgState.maxTurns`、`durationMs` 为转后台时已运行时长，新增可选 `detachReason: "manual"`（仅 AgentDetails 渲染用，不进入 runtime 合约）。
  - 卡片 `status === "background"` 分支：有统计时先渲染统计行；正文 `detachReason === "manual"` 时为 `⎿  Target: manually backgrounded by user (ID: …)`，否则保持原文案。后台启动路径无 `detachReason`、统计为 0 → 外观不变。
- `management.ts:69`、`workflow/management.ts:54`、`index.ts:2605`：released 文本改为 `Wait released by user; …`。

### process-tasks
- `management.ts:88`：同上改 released 文本。
- bash 模型文本不变。

### beautify
- `tools/bash.ts`：正则按分支区分；manual 分支 stats 为 `manually backgrounded · ID: …`。
- `tools/management.ts:28`、`tools/task-manage.ts:21`：`released` 渲染为 `wait released by user · target unchanged`；`cancelled` 不变。

## 兼容性

- `wait_outcome`、`runtimeLaunch`、`structuredContent` 结构不变。
- 历史会话里的旧 detached 结果没有 `detachReason`，按旧文案渲染；旧 released 卡片会显示新措辞（只会来自手动释放，语义正确）。
- `AgentDetails` 卡片校验（`index.ts:271-286`）需允许可选 `detachReason` 字符串。

## 回滚

各阶段为独立提交，回退对应 commit 即可；无持久化迁移。
