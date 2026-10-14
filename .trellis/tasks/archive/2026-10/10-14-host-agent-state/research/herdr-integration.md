# Herdr Pi integration：压缩、busy 与输入就绪性

核验日期：2026-10-14。仅只读本地文件/CLI 版本与 integration status、直接获取官方 GitHub raw/API；未 clone、安装、连接 live pane/socket 或修改产品。唯一持久化产物为本文件。

## 版本与源码结论

- 官方 [latest release API](https://api.github.com/repos/herdrdev/herdr/releases/latest) 返回 `v0.9.4`、`prerelease=false`、发布时间 `2026-10-13T15:41:22Z`；[官方文档索引](https://herdr.dev/llms.txt) 同样标 stable 0.9.4。本地 CLI 为 0.9.1，`herdr integration status` 确认 Pi `outdated (v8 < v9)`。
- 准确源码路径是 `src/integration/assets/pi/herdr-agent-state.ts`。直接读取 [CLI 对应 v0.9.1 raw](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.1/src/integration/assets/pi/herdr-agent-state.ts) 和 [stable v0.9.4 raw](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.4/src/integration/assets/pi/herdr-agent-state.ts)：两者逐字节相同，均为 integration **v9**；SHA-256 `2c5272d732b475bbf91a027203b1f98d25fe43d2c1402530a442b288aeaca1e4`。
- 与本地 `~/.pi/agent/extensions/herdr-agent-state.ts` v8 比较，全部差异只有版本标记、增加 `node:path` import、将 `file.startsWith("/")` 改为 POSIX/Windows `isAbsolute`（v9 L5, L9, L74–84）。**v9 是 session 路径兼容修正，不是 compaction 修正；升级到当前 stable 也不会补齐此缺口。**

## 公共 hook 与单一发布器

[v9 源码](https://github.com/herdrdev/herdr/blob/v0.9.4/src/integration/assets/pi/herdr-agent-state.ts#L179-L261)：

- L191–199：`blockedCount > 0` 优先；否则仅 `agentActive` 决定 working/idle。
- L211–227：唯一 bus 入口 `herdr:blocked`，payload `{ active, label? }`，按计数增减；没有 `herdr:busy` / working 公共 hook。
- L229–260：仅注册 `session_start`、`agent_start`、`agent_settled`；settled 还要求 `ctx.isIdle() === true`。未注册 `session_before_compact`、`session_compact`、`session_compact_failed` 或 shutdown。
- L16, L134–177, L201–209：唯一 `source="herdr:pi"`、seq、发送队列和去重缓存都属于此集成；未导出发布器/状态更新接口。

因此 **preset sidecar 当前不能通过公共 hook 添加真正 working 并复用单一发布器**。把压缩映射到 `herdr:blocked` 只会制造提问/approval 状态，不满足需求。直接第二次 `pane.report_agent` 也不是可组合 busy：同 source 会竞争 seq/私有去重缓存；不同 source 会被拒绝或发生 authority takeover，而非 OR 聚合。[实际 authority 实现 L745–811](https://github.com/herdrdev/herdr/blob/v0.9.4/src/terminal/state.rs#L745-L811) 与 [seq 契约 L771](https://github.com/herdrdev/herdr/blob/v0.9.4/docs/next/website/src/content/docs/socket-api.mdx#L771) 支持此判断。

## Attention 与 input readiness 并未完整分离

- [report schema L362–379](https://github.com/herdrdev/herdr/blob/v0.9.4/src/api/schema/panes.rs#L362-L379) 只有一个 semantic `state`，没有独立 attention / UI-input-ready 写入字段；[state enum L151–166](https://github.com/herdrdev/herdr/blob/v0.9.4/src/api/schema/common.rs#L151-L166) 为 idle/working/blocked/unknown，读取另加 done。
- **确实存在**只读 `AgentInfo.interactive_ready` / `launch_pending`，[schema L215–218](https://github.com/herdrdev/herdr/blob/v0.9.4/src/api/schema/agents.rs#L215-L218)。但 [API 接线 L399–400](https://github.com/herdrdev/herdr/blob/v0.9.4/src/app/agents.rs#L399-L400) 和 [计算 L2190–2193](https://github.com/herdrdev/herdr/blob/v0.9.4/src/terminal/state.rs#L2190-L2193) 证明它仅表示 managed launch 已进入 Active，不是实时 Pi editor/overlay 焦点就绪性。
- Attention 排序由 state/seen 派生：[priority L1–8](https://github.com/herdrdev/herdr/blob/v0.9.4/src/app/api_helpers.rs#L1-L8)。不是可独立报告的“需要回答”信号。
- [agent.prompt 检查 L168–196](https://github.com/herdrdev/herdr/blob/v0.9.4/src/app/api/agents.rs#L168-L196) 拒绝 blocked、启动未就绪及非目标前台进程；不检查 Pi 浏览 overlay。L250–266 仍发送 terminal text + Enter，**working 也未被此检查拒绝**。取消浏览的 blocked 标记不等于允许安全聊天输入。
- [metadata 契约 L727–753](https://github.com/herdrdev/herdr/blob/v0.9.4/docs/next/website/src/content/docs/socket-api.mdx#L727-L753) 分离的是显示与 lifecycle：labels/tokens 不能改变 semantic waits、通知、rollup 或输入保护。

## 具体方案及边界

1. **推荐上游 Herdr 修复**：在该 Pi 集成内部纳入 compaction，或新增明确、可配对/幂等的 busy bus hook，由同一发布器聚合 agent/compaction/blocked。Pi 1.2 的三个公开 compaction 事件可用于实现，但按已核实本地时序，`session_compact` 成功发出时 manual busy 尚未清除，不能立即判 idle，也不能假定后续必有 agent_settled；须验证失败、取消、重试、reload/shutdown 与最终状态收敛。新增 hook 属于未来上游 API，当前 v9 没有。
2. **仅 preset 的有限缓解**：继续用 `herdr:blocked` 分类真实问答；可用 metadata 显示“压缩中”，但明确不修复 working/idle、通知语义或安全 prompt 门禁。
3. **本地完整自包含替代**：另行审批禁用/替换 Herdr 管理集成，保证只有一个完整 lifecycle publisher，承担 session 引用、seq、发送/重试、blocked 及压缩全部逻辑；不能与旧集成并存。文件头 L1–3 明确管理文件更新会覆盖，不能直接编辑已安装副本。
4. **完整浏览输入保护**：需要 Herdr/Pi 跨项目契约，独立描述实时 UI input readiness 与 attention，并让 agent.prompt 消费 readiness；不能把现有 `interactive_ready` 字段或 metadata 当成这个能力。未经该改动，浏览期间应禁止自动 prompt，或使用独立、经验证的调用方协调门禁。

验证限度：源码与协议研究，不是实际宿主颜色、压缩执行或 prompt 安全性验收；未运行上游测试或改变本任务状态。
