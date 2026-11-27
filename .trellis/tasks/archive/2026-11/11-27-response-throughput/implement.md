# 实施计划

单阶段实现，验证通过后一次提交。

## 阶段 1：追踪器 + footer 槽位 + 文档

1. 新建 `extensions/shared/response-throughput.ts`：追踪器（事件输入、每步时间点、有效性过滤、按 token 加权汇总、运行状态）。
2. `extensions/shared/widget-display/contracts.ts`：新增 `throughput` 条目（usage 组，order 15）。
3. `extensions/status-bar.ts`：事件接入、会话切换清空、`throughput` 槽位渲染（暗色/正常色、`⚡ …`、`–` 占位）。
4. 测试：
   - `extensions/shared/__tests__/response-throughput.test.ts`：TTFT 起点为 `before_provider_request`、缺失时回退 `message_start`；加权汇总；短步骤只计 TTFT；error/aborted 丢弃；重试/续跑归入同一次提问；无有效样本保留上次值；只有 TTFT 时的结果。
   - `extensions/__tests__/status-bar.test.ts`：各显示阶段文本与样式；空槽位不产生分隔符；会话切换清空。
   - widget-display 现有顺序测试覆盖新条目顺序（tokens → throughput → cache_metrics）。
5. 文档与规范：
   - `docs/extensions/status-bar.md`：第三行说明 `⚡ t/s` 与 `TTFT` 含义、只在提问结束后更新、运行中暗色显示上次值、不跨重启。
   - `.trellis/spec/development/widget-display.md`：usage 组顺序加入 throughput。

## 验证命令

```sh
node --test extensions/shared/__tests__/response-throughput.test.ts extensions/__tests__/status-bar.test.ts extensions/shared/widget-display/__tests__/*.test.ts
sdk_dir=...; agent_dir="$(mktemp -d)"; PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check; rm -rf "$agent_dir"
```

（完整隔离写法见 `.trellis/spec/testing/index.md`。）

## 提交检查点

- 阶段 1 验证通过后提交：`feat(status-bar): show per-prompt decode TPS and TTFT`。

## 进度与证据

- 阶段 1 已完成（主会话直接实现 + 自审）。
- `pnpm typecheck`：通过。
- `node --test extensions/shared/__tests__/response-throughput.test.ts extensions/__tests__/status-bar.test.ts`（无 force-exit，自然退出）：16/16 通过。
- 隔离 `PI_CODING_AGENT_DIR=$(mktemp -d) pnpm check`：exit 0，1972/1972 通过。
- 未做：真实 TUI 与在线 provider 的人工观察（需用户在实际会话中确认数值与样式）。
- `pnpm-lock.yaml` 的工作区改动在本任务开始前已存在，未纳入提交；收尾时按用户要求撤回。
