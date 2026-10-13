# Monitor 事件与生命周期契约

## 1. 适用范围

修改 monitor 源、通知、停止、配置、消息渲染，或把进程执行后端接入统一任务 UI 时，读取本规范。当前实现位于 `extensions/process-tasks/`，由顶层 wrapper 加载；内部 helper 不是独立扩展。

monitor 管理流事件，不替代后台 bash 的单次完成通知。任务 UI 只查看快照和调用后端停止能力，不拥有 monitor 定时器、缓冲或通知生产。

## 2. 接口

[monitor-source.ts](../../../extensions/process-tasks/monitor-source.ts) 定义：

```ts
interface MonitorSinks {
    event: (preview: MonitorPreview, arrivedAt: number) => void;
    finishing: () => void;
    final: (preview: MonitorPreview) => void;
}
type MonitorSourceFactory = (sinks: MonitorSinks) => MonitorSource;
interface MonitorSource {
    pid: number;
    label: string;
    exit: Promise<MonitorResult>;
    stop: () => MonitorResult | void;
}
```

- factory 拿到 sinks 后才启动，避免 source 先输出、session 后订阅。源构造及后续共享生命周期／UI 接线任一环节抛错都须回滚已启动的源、进程组、fd、timer、abort/completion 引用，再撤销任务注册；不能只删 registry。清理不产生收尾消息，不使用启动回放队列。
- `MonitorResult` 在退出码／信号基础上携带可选 `reason`、`observationNote`。
- [monitor-buffer.ts](../../../extensions/process-tasks/monitor-buffer.ts) 的 `MonitorPreview` 保存有界 `lines: {text, omittedChars}[]`、`omittedLines`、`omittedChars`、`truncatedLines`。消费、再次合并时保留省略元数据，不重复计数。
- [notify.ts](../../../extensions/process-tasks/notify.ts) 的 `MonitorNotificationPayload` 保存 `state`、`description`、`preview`、可选 `silenceMs`／`note`。`sendTaskNotification({ monitor })` 替代 monitor 的 failure-tail 回读；未提供载荷的 shell 路径保持原契约。
- [lifecycle.ts](../../../extensions/process-tasks/lifecycle.ts) 和 [monitoring.ts](../../../extensions/process-tasks/monitoring.ts) 的可选 `handleOversize` 由 monitor 拥有停止和合并通知；未提供时保留共享 shell 默认处理。

## 3. 行为与配置

### 源与日志

命令仍执行 detached `bash -c`，不重写用户 shell 表达式。stdout/stderr 使用两条 pipe 写同一原始日志，不标来源；各自独立增量解码 UTF-8／有界部分行，任一流完整行算进度。未换行片段只在最终读取时进入收尾。

工具合并输出不改变 shell 管道：`command | grep pattern` 的 stderr 绕过 grep，`command 2>&1 | grep pattern` 才过滤两流。stderr 有内容不代表失败；自然结果由主 shell 退出码／信号决定。不承诺跨流合并顺序等于事件发生顺序。

主 shell `exit` 是观察截止，不等 stdout/stderr EOF 或孙进程，也不增加 grace timeout。先进入 finishing，同步读取 Node 已缓冲输出到日志／收尾，再销毁 pipe、关闭 fd。任一流未结束时说明可能未记录后续输出，不能编造未知省略量；日志完整性限于观察范围内已接收内容。

WS message 是一次活动，空消息也算；内容可以多行。close/error 诊断只进入收尾，不触发恢复。二进制 message 沿用占位文本，不承诺保存二进制原始内容。

### 时间与通知

- 工具参数：可选 `timeout_ms` 是总截止；可选 `wake_absent_ms` 是静默提醒。省略前者持续监听，省略后者关闭提醒；没有 `persistent`。
- 活动计时从启动和事件到达起算，独立于通知提交时间；被省略的事件也算活动。
- 首批立即、普通通知至少间隔 `monitorFlushMs`；空缓冲不发空消息，已经过间隔后收到输出立即发。
- 每段静默最多提醒一次，源继续；恢复首次立即发，从恢复重新计算普通间隔。
- 同一决策入口优先已知终态／总截止，然后静默，再普通进度；同一批内容只消费一次，不追溯撤回已提交通知。
- 每条通知包含模型正文可读的 monitor ID、描述、状态、日志和省略情况，采用 `display: true` + `DELIVER_STEER`。Pi 1.1.0 在当前整批工具完成后接收 busy steering，不取消工具、不保证一条通知一条回复。提交 API 返回 void，不能当成端到端送达确认。

### 限制与归属

`monitorFlushMs` 默认 30000，合法 0 表示源回调批次不延迟；`monitorMaxLinesPerEvent` 和共享 `outputPreviewChars` 限制入站缓冲和通知正文。前缀保留，超出只累计省略量，不用输出速率杀监听。无默认截止、截止上限、轮询／速率窗口或连续溢出配置，不提供旧字段兼容层。

所有 monitor 遵守共享 `maxLogBytes` 周期检测，同一日志包含两流；这是超过阈值后停止，不是保证从不超过阈值的硬写入限额。

`Job.status` 仍只有现有运行／终态，absent/resumed 只属于通知。进度不消费 `outcomeSurfaced`；buffer、timer、source handler、fd 保留在 session 内部，不进入面板快照。计数／保留／会话归属仍由共享 registry/lifecycle 管理。

## 4. 验证与错误矩阵

| 条件 | 必须行为 |
| --- | --- |
| 时间参数为 0、负数、NaN、Infinity 或错误类型 | 启动源前拒绝，registry 不留假任务 |
| 合法时间超过 Node 单次 timer 范围 | 分段调度，不溢出成 1 毫秒 |
| 仅 stderr 输出，退出 0 | 算进度，完成状态仍为 completed |
| 源／日志错误 | 失败收尾、清理资源，不让回调异常使 pi 崩溃 |
| 本地通知提交抛错（包括 null/undefined） | 安全转换 unknown 并隔离记录；catch 本身不能再抛，不视为源错误，不因此停止监听，不标结果已告知 |
| 已启动源后 UI／生命周期接线抛错 | 回滚源／进程组／fd／timer／abort/completion 引用，再撤销注册；迟到回调不发送新消息 |

验证 deadline 与 oversize 异常时须独立触发：deadline 用未超限日志或晚于总截止的日志检查，oversize 不设先触发的截止；发送失败也在抛错前捕获通知正文并断言停止原因。不能只断言 killed／错误标记，否则测试可能走错停止路径仍通过。
| 显式 jobs/panel/session stop | 共享停止并释放资源，不新增尾批／收尾，不撤回旧通知 |
| 自然结束、外部信号、总截止、日志超限 | 待发输出与原因合成一条收尾，取消 timer，迟到回调不能重发 |
| active attach 或结果已告知 | 遵守共享收尾抑制，不重复回读 failure tail |
| session 换代 | 旧源／定时／退出不得通知或改写新 session |

## 5. 基础、正确与错误案例

- 基础：不传两个时间参数，持续输出产生首批和合并通知，安静期间没有空消息；主 shell exit 时收尾。
- 正确：`wake_absent_ms` 提醒一次后保持监听，stdout 或 stderr 的新完整行立即恢复，后续继续合并。
- 错误：把“刚提交了一条提醒”当成新源活动，导致定时重复提醒；或只看通知正文数量，把被省略的事件当成静默。

## 6. 必须保留的测试

- [monitor-buffer.test.ts](../../../extensions/process-tasks/__tests__/monitor-buffer.test.ts)：前缀／整行和字符省略、再次合并、空行、Unicode、不完整超长行有界。零预算下 `{text: "", omittedChars: 2}` 是完全省略的非空行，不可当作真实空行；原文摄入与 source preview 再合并的保留／省略分类一致。
- [monitor-source.test.ts](../../../extensions/process-tasks/__tests__/monitor-source.test.ts)：两流日志及独立解析、shell 管道／重定向、exit 的同步读取和双流关闭、继承管道不等待、短写／源错误。
- [monitor-session.test.ts](../../../extensions/process-tasks/__tests__/monitor-session.test.ts)：假时钟首批／间隔／空消息、两轮静默／恢复、边界合并、巨大时间、发送失败、共享显式停止／attach／session／日志保护。
- [monitor.test.ts](../../../extensions/process-tasks/__tests__/monitor.test.ts)、[config.test.ts](../../../extensions/process-tasks/__tests__/config.test.ts)：源启动前参数验证、旧字段删除、默认和覆盖、不写用户文件。
- [index.test.ts](../../../extensions/process-tasks/__tests__/index.test.ts)：monitor 模型／TUI 身份、状态、日志及省略说明，宽度／控制符安全；shell 原渲染和会话回归不变。
- 全量检查按 [Testing Guidelines](./testing-guidelines.md) 隔离用户配置；另跑不带 force-exit 的定向回归，不能用强退掩盖 fd／timer／process 泄漏。

## 7. 常见错误与正确边界

**错误：** 在面板 x 回调里额外发“已停止”事件，或把 monitor pending 刷新为独立尾批。

**正确：** 面板只调用后端共享显式停止能力；后端处理抑制与资源清理，pending 留在日志，停止操作本身反馈结果。

**错误：** 为了双流都进日志，把用户命令改写为 `command 2>&1 | ...`，意外改变过滤器和退出行为。

**正确：** 执行原始命令，在工具接收端合并两流；用户自行决定 shell 内部重定向。

执行后端迁移／改名时整组保留以上源、通知和停止契约，不恢复旧 follower、被动通知、`persistent` 或速率终止。不要求 UI 和各执行后端变成同一个引擎。

## 8. 共享 retrieval 接入补充

`jobs attach` 取消／显式 detach 后须重查已终态且未消费的结果，不能只依赖 source exit 时的一次发送。`notify.ts` 遇 attachCount>0 保存本次已构造的有界终态 payload，最后一个 wait 取消后可重新发送原收尾；不保存或重启 monitor source／buffer，不改源活动、timer 或 batching。成功 inline 消费或显式 stop 清除该重查资格。`monitor-session.test.ts` 的 shared retrieval terminal tick 案例验证 pending/final 合成内容只交付一次且不回读 failure tail。


## 9. Activation shutdown 的实际执行边界（阶段 3A）

`MonitorSource.execution?: OwnedExecution` 只归 backend，command source 以真实 child `exit`/spawn error 建立 execution；`source.exit` 仍是既有观察截止／同步 stop 的 result，二者不得混用。`startBackgroundJob` 追踪 actual execution，silent stop 同时关 source、fd/timer 并按实际退出 identity 进行 TERM→KILL，不把 OS 引用放进 task-ui 快照。WS/pending pid0 不 signal。此补充不改变活动判定、decoder、buffer、deadline、stderr 或首批/合并语义；旧 hard source/session tests 继续保留。

composition 在 process 的 freeze 后再取消 wait/stop；冻结时旧 monitor 的 current 检查禁消息，清理不新增尾批。`activation.test.ts` 的真实 command 与 fake WS transport 覆盖有界退出／late frames／日志保留。agent participant 尚属 3B，不把当前协议接入写作全后端隔离已完成。

### 同步启动重入守卫

`add(reg, job)` 和 sidebar 发布会同步调用订阅／UI，不能把首次 `assertJobSlot` 当成整个 setup 的 admission 保证。monitor 工具发布后、直接 `startMonitorSession` 创建源前必须同时检查 `reg.closed`、terminal 和 `reg.jobs.get(job.id) === job`；session 返回 `"started" | "cancelled"`，取消不得报告启动成功。末次初始 `decide()` 的静默提醒／收尾也可能同步触发 shutdown，返回前须复查 closed／map identity；正常即时 deadline 使 job 终态但 activation 仍有效，不应按启动失败处理。回归见 `monitor-setup-result.test.ts` 的实际工具与 clock/transport seam。

factory 返回源后或共享接线中同步 shutdown，session 的 once stop owner 必须关闭已构造 source／fd 并停止 actual execution；不能只 stop pid0 或在已 abort controller 上补一个不会触发的 listener。共享 terminal setup 分支也须调用 source hook，hook 抛错仍执行 actual stop／清理。明确取消和 setup exception 分开：shutdown 已计入的 stopped 元数据／started/terminal 统计保留，只有非终态 failed admission 撤销计数，不能产生 killed 大于 totalStarted。日志保留，静默清理不发尾批。

`activation.test.ts`／`monitor-session.test.ts` 的实际工具、source、session 只替换 WS transport，覆盖发布前无源、factory 返回前、sidebar／wire callback、shutdown 后再抛错、already-aborted 和 terminal throwing-stop；断言 socket 仅创建时关闭一次、actual execution map／wait／controller／runtime hooks 清空、无 cleanup timeout／旧通知、迟到 frame 不改变保留文件。原 fake source 一次 TERM、首批／事件／时间回归不能放宽。
