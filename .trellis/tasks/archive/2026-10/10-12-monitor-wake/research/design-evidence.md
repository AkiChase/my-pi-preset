# Monitor 设计证据与已确认决定

## 仓库事实

- `monitor-session.ts` 管理待发缓冲、定时合并、收尾和资源清理。当前进度消息使用 `DELIVER_PASSIVE`，收尾走共享通知路径。
- 当前源数据经过日志轮询（`monitor-source.ts`、`monitor-follow.ts`）。命令 stdout 直接写文件，stderr 单独记录；WebSocket 内容和连接诊断都追加到同一日志（`monitor-ws.ts`）。日志轮询无法恢复源事件的到达时间或 WebSocket 消息边界。
- `monitor-session.ts:171–187` 先最终读取 follower 并调用 `flush()`，再执行 `sendTaskNotification()`。因此显式停止只抑制收尾，不能抑制最后的被动进度消息。
- `lifecycle.ts:202–208` 在显式停止前标记结果已告知。`tools/jobs.ts:239–246` 使用共享停止路径并返回结果；`ui.ts:105` 使用同一路径。后台 shell 不会额外发送 monitor 式尾批进度通知。
- `notify.ts:159–160` 对已告知结果或正在 attach 的任务抑制收尾；monitor 合并收尾时须保留共享规则。
- `config.ts:92–103` 当前默认设置为：5 分钟截止、1 小时上限、2 秒通知合并、50 行展示、10 秒速率窗口、每窗口 500 行、连续 3 个溢出窗口后停止。
- `tools/monitor.ts:104–111` 当前给截止时间设置默认值并截到上限；`monitor-session.ts` 中的 `persistent` 跳过截止。
- `startMonitorSession` 当前向共享 `startBackgroundJob` 传入 `disableOversizeKill: persistent`。`monitoring.ts` 独立检查 `maxLogBytes`，普通 monitor 受保护，persistent monitor 绕过保护。行数速率限制和磁盘保护是不同机制。
- `config.ts` 按默认值、文件、环境变量顺序解析，不改写用户配置。删除的文件键会得到普通未知键警告。用户已拒绝兼容／迁移机制，不新增被删除环境变量的专门警告路径。

这些路径和行号记录本次设计研究时的代码，描述的是旧实现，不代表目标行为；实现修改后须重新核对。

## Pi 1.1.0 投递语义

核对的本机 SDK 路径为 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/`：

- `pi-coding-agent/dist/core/agent-session.js:1782–1825`：空闲且 `triggerTurn: true` 时启动处理；忙碌时 steer 进入 steering 队列，followUp 等到当前工作链准备结束；false trigger 是被动消息，nextTurn 不立即唤醒。
- `pi-agent-core/dist/agent-loop.js:155–197`：steering 在当前整批工具和 `turn_end` 结束后消费，不在单个工具之间消费，也不会取消工具。
- monitor 唤醒复用仓库 `DELIVER_STEER`，不要另做一套 Agent 队列。
- `ExtensionAPI.sendMessage` 返回 void；提交不代表后续 Agent 处理或持久化已获确认。“只发送一次”描述本地提交／缓冲消费约束，不能承诺端到端处理恰好一次。

## 设计讨论中用户确认的调整

1. 显式停止与后台 shell 对齐：不新增尾批进度或收尾通知；输出留在日志，停止操作反馈结果。不撤回已提交的消息。
2. 自然结束、失败和外部信号终止仍产生一条合并了待发输出的收尾通知。
3. 取消隐式总截止。显式 `timeout_ms` 到时停止并说明原因，`wake_absent_ms` 只提醒。
4. 删除持续输出速率溢出停止，以及多余的速率窗口／计数。入站通知缓冲和出站通知按行数、字符数限制，明确报告省略，保留完整日志；省略事件仍算进度。
5. 所有 monitor 与后台 shell 一样遵守共享 `maxLogBytes`，没有豁免。达到限制后停止，使用一条带资源限制原因和待发输出的 monitor 收尾通知，保留共享抑制，不另发尾批或被动超量消息。不改变 shell 行为。共享检查是周期性的，不保证日志永不超过阈值。
6. 不考虑旧参数兼容：直接删除 `persistent` 和旧截止／速率配置，不加别名、迁移模式、专门弃用警告，不改写用户配置，也不再询问旧参数组合问题。
7. 项目文档改用中文，包括 task 的 PRD、设计、实施计划、研究记录；技术名称、路径、命令和结构键保持原样。代码、代码注释和提交信息仍用英文。
8. 命令 monitor 随主 shell `exit` 结束，不等 stdout/stderr EOF、不增加排空时限。同步读取两个流已缓冲输出合入收尾，随后关闭观察；任一流未结束时可能有后续未记录输出，说明这一边界但不编造数量。日志完整性承诺限定到已接收范围。
9. 命令 monitor 默认合并 stdout/stderr 到同一日志和通知，两流完整行均算活动、不标来源；stderr 内容不等于失败，按退出码／信号判断自然结果。工具合并不改变 shell 管道或重定向，不承诺跨流严格时间顺序。详见 [merged-output.md](merged-output.md)。

这些是规划决定，不是实现批准。与历史 `original-plan.md` 冲突时，以更新后的 PRD 为准。

## 技术方向

- 增加小范围的源事件入口，stdout/stderr 双 pipe 各自完整行或 WS 消息到达时记录进度，默认写同一日志、进入同一通知缓冲；两流 decoder／部分行独立，避免错误拼接。
- 通知状态留在 session 内：最近进度通知提交时间、最近事件到达时间、静默已提醒标记、有界待发输出及省略计数、收尾／终态标记。
- 按经过时间和截止点调度，不用“定时器是否存在”判断是否可以发送。首次和恢复进度绕过普通间隔，空缓冲不发送通知。
- 开始收尾后仍接收最终输出，但禁止普通进度／恢复通知；最终输出只消费一次，合进收尾或在显式停止时抑制。
- monitor 日志大小终止经过自己的收尾协调入口，复用共享阈值和检测。旧的共享 watcher 先静默停止再发被动 `bg-stall`；原样保留会违反 monitor 的单条可唤醒收尾要求。提供小范围的 monitor 自有停止／通知回调，不改变 shell 的超量投递。
- 保留结果已告知、attach 抑制和注册表保留规则。测试不同定时回调顺序以及已知终态优先；不要承诺能追溯合并终态被观察到之前已经提交的通知。
- 有限正数可能超过 Node 原生定时器范围。需要按截止点分段调度或明确支持范围，不能让大数溢出成立即触发。


源排空研究及用户确认的结束契约见 [source-drain.md](source-drain.md)，最终设计见 [../design.md](../design.md)。