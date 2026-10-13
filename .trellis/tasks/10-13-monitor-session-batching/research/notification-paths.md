# 通知路径与既有契约调查

## 已核查的实现

- `extensions/agent-tasks/src/group-join.ts`：同批有限任务的终态 join，首个完成起 30 秒 partial，剩余任务下一次完成起 15 秒；全组完成提前释放。
- `extensions/agent-tasks/src/index.ts:499–594,1290–1328`：启动 100ms debounce 组批；释放后 200ms 可取消 hold；发送前校验 run、消费、通知及等待状态；采用 followUp。
- `extensions/process-tasks/monitor-session.ts`：每个 source 独立 buffer、lastActivity、lastProgress 与 timer；首批立即、默认 30 秒普通活动节流；静默一次／恢复立即；自然终态带走 pending；显式停止静默清理。
- `extensions/process-tasks/notify.ts`：monitor progress 直接发送，终态走 sendTaskNotification；attach 时保存有界终态重查 closure；outcomeSurfaced 在成功提交后设置。提交失败记录 notifyError，不自动重放。
- `extensions/process-tasks/state.ts`：BackgroundRegistry 是 activation 内的后端可变状态 owner；没有共享 monitor 调度器。
- `extensions/process-tasks/index.ts`：已有 taskNotification/monitorEvent renderer；session_start fallback 清旧 registry，必须同步清新增通知调度。
- `extensions/process-tasks/lifecycle.ts`：freeze 同步关闭 admission/通知，随后 silent stop、actual execution drain、dispose。
- `extensions/process-tasks/monitor-buffer.ts`：可重复合并的有界前缀与省略元数据；不能用简单字符串截断代替，否则省略计数及 Unicode 边界会退化。

## 结论

共享 UI/coordinator 不拥有通知生产。Agent 的有限任务组结果与 monitor 的持续源活动不同，不直接复用 GroupJoinManager，不迁移 agent，不改变普通 shell 完成通知。

新机制归 process backend，由 registry 持有会话级活动调度器；源状态机保留实际事件到达与截止／静默定时，通知刷新使用共享时间基准。无需全局 singleton 或新 SDK 包。

## 必须显式改变的旧契约

`.trellis/spec/preset/monitor-contract.md` 当前要求首批立即、恢复立即以及每个 monitor 的普通间隔。本任务获认可的设计将其改为至多 200ms 短窗口与会话级普通间隔；这不是无行为变化的重构。monitorFlushMs=0 保留不延迟语义。正式实现时同步 README、工具描述、规范与相关测试，不修改不相关 source/decoder/OS ownership 契约。

## 已确认决策

用户结构化确认：
1. 首批及及时事件均允许至多 200ms 短窗口。
2. 及时事件提前刷新时带走其他源待发活动，并从成功提交重新计算普通间隔。

## 风险

- 将 current 的非终态检查直接用于延迟终态通知，会错误丢弃已正常完成的 job。
- 自然结束时 lifecycle 会 abort job controller；通知尾批必须独立于仍运行的 source owner，否则被当显式 stop 取消。
- detach/retrieval 与迟发终态竞争，发送前仍需 recheck attach/outcome，不能仅 enqueue 时检查。
- session_start fallback 与正式 freeze 都需清 timer/queue，旧 job map identity 不可复活。
- sendMessage 返回 void，仅表示本地提交；提交成功不能证明模型已处理。不能隐式重试制造重复唤醒。
- 短窗口内静默后恢复不能仅以最后 state 覆盖前一状态，需明确转换信息保留。
- 多来源各自 12KB 并不等于合并消息有界；正文与 details 必须一起制定总预算，容量策略待评审。

## 相关规范

`.trellis/spec/preset/{repository-guidelines,extension-guidelines,monitor-contract,testing-guidelines,documentation}.md`；`.trellis/spec/guides/{cross-layer-thinking-guide,code-reuse-thinking-guide}.md`。

本记录来自只读源码检查；未运行模型／网络／真实配置写入，未实施产品改动。
