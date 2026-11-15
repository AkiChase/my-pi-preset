# Implement: 手动转后台对 Agent 可见

执行者：主会话直接实现，主会话自审（范围清晰、改动集中）。不派发子 Agent，role JSONL 有意留空，start 使用 `--allow-empty-context`。

## Stage 1 — subagent_run 手动转后台（R1、R2、R4 子 Agent 卡片）

- [ ] `runtime-tasks/execution-config.ts` 新增 `manual-detach` reason
- [ ] `agent-tasks/src/waits.ts`、`agent-manager.ts detachRun` 传递并记录 reason
- [ ] `agent-tasks/src/index.ts` detached 分支文本与 details；卡片 background 分支
- [ ] 测试：`extensions/agent-tasks/__tests__/backend-waits.test.ts`（或相邻文件）断言文本与 difference；`extensions/beautify/__tests__/registered-agent.test.ts` 增加前台 → `detachAll()` 的卡片断言（统计行、manual 正文、展开 Differences），后台启动卡片不变
- 验证：`node --test extensions/agent-tasks/__tests__/*.test.ts extensions/beautify/__tests__/registered-agent.test.ts`，`pnpm typecheck`
- 提交：`feat(agent-tasks): surface manual detach of foreground agents`

## Stage 2 — 等待释放与 bash 卡片（R3、R4 其余）

- [ ] released 文本：`agent-tasks/src/management.ts`、`agent-tasks/src/workflow/management.ts`、`agent-tasks/src/index.ts`（subagent_message）、`process-tasks/management.ts`
- [ ] beautify：`tools/management.ts`、`tools/task-manage.ts`、`tools/bash.ts`
- [ ] 更新受影响断言：`beautify/__tests__/registered-agent.test.ts`、`beautify/__tests__/retrieval.test.ts`、`beautify/__tests__/shell-collapse.test.ts`、`process-tasks/__tests__/waits.test.ts`、`task-ui/__tests__/mixed-waits.test.ts`、`agent-tasks/__tests__/parent-delivery.test.ts` 等（以实际失败为准）
- 验证：聚焦测试 + `pnpm typecheck`
- 提交：`feat(runtime-tasks,beautify): mark user-released waits and manual bash detach`

## Final

- 隔离运行全量检查：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check; result=$?; rm -rf "$agent_dir"; (exit "$result")
```

- 检查 `docs/extensions/task-composition.md` 是否需补一句手动转后台/释放的可见性说明；需要则随最后阶段提交。
- 记录命令、结果与失败/重跑关系于本文件。

## 执行记录

### Stage 1

- 范围补充：前台 `resume` 转后台同样存在问题（`agent-tasks/src/index.ts` resume detached 分支），按 R1/R4 一并处理，文本为 `Agent resume was manually backgrounded by user.`。
- mode difference 的 `requested` 取转后台前的生效 mode（通常为 `foreground`）。
- 卡片：仅当 details 带 `detachReason` 时渲染统计行，显式后台启动卡片不变（测试断言）。
- 验证：
  - `pnpm typecheck` → exit 0（首次 exit 1 来自同一管道里的 `rg` 无匹配，非类型错误；单独重跑 exit 0）。
  - 新增 `tool-waits.test.ts` “manual foreground detach is model-visible …” → pass。
  - `registered-agent.test.ts` 新增手动转后台卡片断言 → pass。
  - agent-tasks、beautify、runtime-tasks、task-ui 测试（隔离 `PI_CODING_AGENT_DIR`）→ 616/616 pass。

### Stage 2

- released 文案：`agent-tasks/src/management.ts`、`agent-tasks/src/workflow/management.ts`、`agent-tasks/src/index.ts`（subagent_message wait）、`process-tasks/management.ts` → `Wait released by user; …`；`wait_outcome` 仍为 `released`。
- 卡片：`beautify/tools/management.ts`、`beautify/tools/task-manage.ts` → `wait released by user · target unchanged`；`beautify/tools/bash.ts` 手动 → `manually backgrounded · ID: …`，非手动保持 `background ID: …`。
- 测试：更新 6 处既有断言；`tool-waits.test.ts` workflow pause 用例新增手动释放断言。
- 文档：`docs/extensions/task-composition.md` 补充手动解除后的可见性说明。
- 验证：
  - `pnpm typecheck` → exit 0。
  - agent-tasks、beautify、runtime-tasks、task-ui、process-tasks 测试（隔离）→ 1009/1009 pass。
  - 全量隔离 `pnpm check`（`PI_SDK_DIR` + 临时 `PI_CODING_AGENT_DIR`）→ exit 0，1876/1876 pass。
