# 子 Agent 最近请求用量与累计用量展示

## Goal

修正外层 `↓ 625.4k` 将跨轮混合累计用量误标为输出、详情 `in/out` 与总数口径不一致的问题。区分最近一次已完成请求和跨轮累计计费用量。

## Confirmed Facts

- `extensions/task-ui/presentation.ts` 的 `taskLine` 将 `stats.tokens` 放在 `↓` 后面。
- `extensions/agent-tasks/src/source.ts` 将 `getLifetimeTotal(lifetimeUsage)` 作为 `stats.tokens`，将累计 fresh input/output 作为详情分项。
- `getLifetimeTotal` 当前为累计 `input + output + cacheWrite`，不含 `cacheRead`，压缩后也不清零。它不是当前上下文大小。
- `extensions/agent-tasks/src/agent-runner.ts` 在 assistant message_end 读取 usage 并通过 onAssistantUsage 上报；已有新请求与 resume 两条路径。
- 输入语义包括 `input + cacheRead + cacheWrite`。累计 cacheRead 是实际多次读取用量，不是当前上下文占用；cacheWrite 也不能保证永远只对应新增文本。
- `taskTokens` 对小于 1000 的值显示整数，`174` 代表 174 个 token，不是缺失 k。
- `extensions/status-bar.ts` 已按 `↑ fresh input / ↓ output / R cacheRead / W cacheWrite` 展示父会话累计分类用量。
- `PendingUsagePool` 已通过工具结果 usage 将子 Agent 用量汇入父会话。父会话 Footer 不是某个子 Agent 的独立累计视图，且汇入随工具结果交付发生。
- 尚未读取用户示例 Agent 的原始 usage。此前关于其代理记账、确切缓存数和缓存写入仅包含新增内容的断言不是已验证事实。

## User Decisions

- 不在外层显示输入、输出、缓存混合的跨轮累计总数。
- 外层显示最近一次已完成请求的输入和输出；新请求期间继续保留上一轮实际值，不估算、不引入请求中的差异状态。
- 详情的请求 in/out 同样显示最近一次已完成请求。
- 用户已批准在详情单独增加 `Usage Σ` 行，展示该子 Agent 独立累计分类用量。

## Proposed Display

```text
● trellis-implement-10 26m55s · ↑286.1k ↓3.2k

Last req  ↑286.1k ↓3.2k
Usage Σ   ↑53k ↓19k R1.5M W55k
```

- Last req 的 ↑ 包含该次请求 input + cacheRead + cacheWrite，↓ 为该次请求 output。
- Usage Σ 沿用 Footer 分类含义：↑ 为累计 fresh input，R/W 单列累计缓存读取/写入，↓ 为累计 output；避免缓存重复计入 ↑。
- 在没有已完成请求用量前使用缺失状态，不把未知伪装为零。
- 请求用量不是上下文占用指标，不与 400k 上限直接比较。

## Scope and Authorization

用户回复「行，就按这样吧」已批准上述完整方案的实施与验证。单阶段实施，实施委派 trellis-implement，审查委派 trellis-check；主会话核对实际差异、验证记录并提交。

拟涉及 agent usage 状态、source/TaskView 透传、外层与详情渲染及测试。保留计费用量累加、父会话上报、getLifetimeTotal 及兼容工具 payload 口径；不自动扩展到 workflow 汇总、其他工具卡片或父 Footer 重构。

## Acceptance Criteria

- 外层 ↑/↓ 分别为最近一次已完成请求的完整输入与输出，详情同口径。
- 下一请求进行期间保留最近结果，不显示估算或伪实时值。
- 新请求与 resume 都刷新最近请求数据；压缩不将累计用量错误用作最近值。
- 详情提供该子 Agent 的四类累计用量，并明确与最近请求区分。
- 覆盖缓存占多数、无缓存、无 usage、多轮更新、resume、窄宽度与现有详情布局回归。
- 不改变计费上报、累计账本或其他未批准表面的口径。

## Implementation Checkpoint

方案批准后单阶段实现、主会话自检并运行相关测试，核对 Git 差异后按项目流程提交该阶段；保留并行改动。实际命令、失败及重跑结果在实施时记录。
