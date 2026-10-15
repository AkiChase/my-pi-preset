# 完成通知丢失：只读诊断

用户询问为何实现／检查结束没有通知、是否有错误提醒。本次只读查源码与本会话JSONL，并直接调用纯escapeXml函数；未修改产品或当前执行代理。

## 两次managed派发：证据闭合

本会话日志：`~/.pi/agent/sessions/--Users-jyxc-dz-0101322-tools-my-pi-preset--/2026-10-13T16-28-23-945Z_01a13617-fc07-7458-a937-3e2950b431e5.jsonl`。

- 84081a1f-fd1d-4ec：2026-10-14T07:40:17.137Z保存subagents:record，status=completed，没有description字段。之后未找到该ID的custom_message subagent-notification。
- 83c0ee69-596b-40b：2026-10-14T08:42:33.453Z同样completed且description缺失，无对应通知。
- 普通研究代理7249ddc3-a6f9-499：记录含description=Research unified task interfaces；通知确实在2026-10-14T03:04:15.031Z持久化，较完成记录02:48:54延后约15分钟。此延迟原因未确定，不能与下面异常等同。

## 根因路径

- pi-trellis/lib/subagent-rpc.ts通过RPC spawn只传options.cwd/isolation，没有description。
- agent-tasks/src/index.ts spawnTopLevel/spawnResolved未补description；AgentManager.spawn直接record.description=options.description（源码约649行）。
- 同index约173行formatTaskNotification中escapeXml(record.description)；xml.ts escapeXml直接s.replace。
- 实际纯函数复现escapeXml(undefined)抛 `TypeError: Cannot read properties of undefined (reading 'replace')`。
- scheduleNudge约507行用 `try { send(); } catch { /* ignore stale completion side-effect errors */ }` 吞掉通知构造／投递异常，无日志或UI错误提醒。

因此两次managed结束事件和结果确实存在，失败发生于构造模型完成通知（在sendMessage之前），异常被静默吞掉；不只是主代理没接着执行。

## 边界与建议（尚未实施）

在可信programmatic spawn owner规范化缺省description（例如agent角色／类型）并验证RPC输入，而非让renderer临时拼undefined；通知异常需有安全可见诊断，不把所有异常当stale。加入实际RPC派发→completed→通知回归和throwing sink测试。属于当前运行工具迁移的后端通知完整性问题，但本次只诊断，不新增未经说明的修改。
