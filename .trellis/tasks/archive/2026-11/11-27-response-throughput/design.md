# 设计：响应吞吐指标

## 统计单位

"一次提问"= 从空闲状态下第一个 `agent_start` 到 `agent_settled`。自动重试、压缩后重试、排队消息续跑都算在同一次提问内。

一次提问包含多个"步骤"（每次模型请求对应一条 assistant 消息）。

## 每步采集的时间点

| 时间点 | 事件 |
|---|---|
| `t_req` | `before_provider_request`（请求即将发出）；缺失时回退到 `message_start` |
| `t_first` | 本步第一个 `message_update`，且 `assistantMessageEvent.type` ∈ `text_delta` / `thinking_delta` / `toolcall_delta` |
| `t_end` | assistant 的 `message_end` |
| `out` | 最终 `message.usage.output`（已包含 reasoning） |

说明：`message_start` 在 provider 流的 `start` 事件时发出，不代表请求发出时刻，所以 TTFT 起点用 `before_provider_request`。

## 每步指标

- `ttft = t_first − t_req`
- `decode = t_end − t_first`

有效性：

- `stopReason` 为 error / aborted 的步骤整体丢弃。
- 没有 `t_first`（没有任何内容 delta）的步骤丢弃。
- TTFT 样本：有 `t_first` 即计入。
- TPS 样本：另需 `out ≥ 8` 且 `decode ≥ 200ms`，避免一次性整块到达的短步骤（如只发一个工具调用）产生离谱的大数。

## 一次提问的汇总

- `TPS = Σout ÷ Σdecode`（只含 TPS 有效步骤，按 token 加权）
- `TTFT = mean(ttft)`（所有 TTFT 有效步骤）

## 显示阶段

不做流式估算：数值只在一次提问结束（`agent_settled`）后更新为准确值。

| 阶段 | 显示 | 样式 |
|---|---|---|
| 本次运行期间还没有完成过提问，也不在运行 | 不显示（槽位为空，不占分隔符） | — |
| 提问运行中，此前已有结果 | 上一次提问的值 `⚡68 t/s · TTFT 1.2s` | 暗色 |
| 提问运行中，此前没有结果 | `⚡ …` | 暗色 |
| 提问结束（settled），有有效样本 | `⚡71 t/s · TTFT 0.9s` | 正常色 |
| 提问结束但没有有效样本（中断、全部报错、步骤都太短） | 保留上一次的值；没有则不显示 | 正常色 |
| 只有 TTFT 有效、没有 TPS 有效样本 | `⚡– t/s · TTFT 1.2s` | 正常色 |

格式：TPS 取整；TTFT < 10s 保留一位小数（`1.2s`），≥ 10s 取整（`12s`）。

## 生命周期

- 状态只在内存中，不写 session。
- 会话切换（sessionManager 或 session ID 变化）时清空，与 status-bar 现有的 epoch 重置一致。
- 非 TUI 模式不显示（沿用 status-bar 的模式判断），但采集逻辑无副作用。

## 位置

footer 第 3 行（`usage` 组），新增 inline 槽位，排在 `tokens` 之后、`cache_metrics` 之前。

## 已知误差

- provider 隐藏或压缩 thinking 时，`t_first` 晚于真实首 token：TTFT 偏大、TPS 偏高。
- 第一个 chunk 中的 token 被计入 `out`，但不在 decode 时间内，TPS 略偏高，长回复中可以忽略。

## 代码组织

- `extensions/shared/response-throughput.ts`：纯逻辑追踪器（不依赖 TUI），接收带时间戳的事件，输出最近一次提问的汇总与运行状态。时间源可注入，便于测试。
- `extensions/shared/widget-display/contracts.ts`：`ITEMS` 新增 `throughput: { group: "usage", order: 15 }`。
- `extensions/status-bar.ts`：注册 `agent_start` / `before_provider_request` / `message_start` / `message_update` / `message_end` / `agent_settled` 事件喂给追踪器；新增 `throughput` 槽位渲染；状态变化时 `requestRender`。
- 不新增顶层扩展文件（`extensions/*.ts` 会被当作扩展入口加载）。
