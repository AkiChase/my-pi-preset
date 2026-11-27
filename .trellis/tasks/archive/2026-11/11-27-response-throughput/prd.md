# 响应吞吐指标（TPS / TTFT）

## 目标

在 footer 中显示最近一次模型响应的生成速度（decode TPS）和首 token 延迟（TTFT）。

## 已确认的需求

- 指标：生成 TPS（decode TPS）+ TTFT。
  - decode TPS = `usage.output ÷ (message_end 时间 − 首个 delta 时间)`；`usage.output` 已包含 reasoning。
  - TTFT = 首个 `text_delta` / `thinking_delta` / `toolcall_delta` 时间 − `message_start` 时间。
- 展示：只在 footer 第 3 行（`usage` 组）新增一个 inline 槽位，显示最近一次响应的 TPS 与 TTFT。
- 不做：对话区每次回答后的汇总行（B）、平均值、持久化（不写 session 文件）。
- 状态只保存在内存；重启或恢复会话后在下一次响应前不显示数值。

## 已知事实（仓库证据）

- `extensions/status-bar.ts` 通过 widget-display 槽位渲染 footer；第 3 行（`usage` 组）由 `tokens`、`cache_metrics`、`task_summary`、`external_statuses` 组成（`extensions/shared/widget-display/contracts.ts`）。
- `tokens` 槽位的 `$` 仅在 `usage.cost.total > 0` 时显示。
- Pi SDK 可用事件：`message_start` / `message_update`（含 `assistantMessageEvent.type`）/ `message_end`。

## 排除的样本

- 中断、报错的消息不更新显示值；output 过少或 decode 时长过短时不计算 TPS（阈值在设计中确定）。

## 决策

- 已定：按一次提问（agent_start → agent_settled）汇总；不做流式估算。细节见 `design.md`。

## 验收标准

- 一次提问结束后，footer 第 3 行在 `↑ ↓ R W` 之后、缓存指标之前显示 `⚡<TPS> t/s · TTFT <秒>`，数值按 `design.md` 口径计算。
- 提问运行中暗色显示上一次的值（无则 `⚡ …`），不做流式估算。
- 报错/中断步骤不计入；短步骤不计入 TPS；无有效样本时保留上次值。
- 从未完成过提问时不占位、不产生多余分隔符。
- 不写 session 文件；会话切换后清空。
- 用户文档 `docs/extensions/status-bar.md` 与 widget-display spec 同步更新。
- 聚焦测试与隔离的 `pnpm check` 通过。
