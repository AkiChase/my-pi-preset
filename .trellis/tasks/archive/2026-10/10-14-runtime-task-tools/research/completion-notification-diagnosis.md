# 完成通知丢失诊断

研究会话 `01a13617-fc07-7458-a937-3e2950b431e5` 中，代理 `84081a1f-fd1d-4ec`、`83c0ee69-596b-40b` 已完成，但 record 缺 description，未找到对应完成通知。

根因链：

1. pi-trellis RPC spawn 只传 cwd/isolation。
2. manager 直接保存 `options.description`。
3. 通知 formatter 调用 `escapeXml(undefined)`，实际复现 `.replace` TypeError。
4. scheduleNudge catch 静默吞掉构造异常。

普通研究代理 `7249ddc3-a6f9-499` 有 description，通知延后约15分钟；延迟原因未确定，不能归为同一异常。

此诊断归通知专项 `10-14-subagent-completion-notification`。其正式修复后来提交到 main，本任务三方整合保留；不在工具迁移中重复实现。最终保留检查见 [集成独立报告](final-integration-independent-check.md)。
