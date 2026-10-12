# Monitor 通知与唤醒：技术设计

## 状态、范围与设计原则

本文件对应 [prd.md](prd.md)，用户已明确批准最新方案并要求派 Agent 开始实现。仓库事实及已确认决定见 [research/design-evidence.md](research/design-evidence.md)。

本次只调整 monitor 源事件、通知调度和相关收尾，不拆成多个可独立上线的任务。不设计通用告警框架、旧参数兼容层、额外唤醒队列或新的日志管理系统。

边界原则：

- 源负责准确报告事件到达和完整日志；session 负责何时通知、消费哪些待发输出；共享生命周期负责任务终态和清理。
- 通知频率限制唤醒提交，内容上限限制缓冲／上下文；二者都不替代日志大小保护。
- 同一批待发内容只有一个消费出口，可用于进度、静默、恢复或收尾。
- 已提交到 Pi 的消息不撤回；终态优先指已知终态，不能追溯合并此前提交的消息。

## 目标数据流

```text
命令 stdout + stderr / WebSocket message
    ├─ 原始输出写同一日志（不标来源）
    └─ 源事件入口：到达时间 + 有界内容预览 + 省略统计
             ↓
       monitor-session
       事件时间 / 通知时间 / 状态 / 有界待发缓冲
             ↓
       单一通知选择与消费
       progress / absent / resumed / terminal
             ↓
       Pi sendMessage：display: true + DELIVER_STEER

源结束 / 显式停止 / 显式截止 / 日志超限
             ↓
       同一收尾协调入口 → 共享终态、abort、注册表保留
```

原来的 `followLines` 无法提供事件到达时间，也会把一条多行 WS 消息拆成多个事件。本次 monitor 不再通过读日志重建事件；`jobs output/attach` 和面板继续读取日志，不改变它们。

## 工具与配置契约

### 工具参数

保留 `command` 与 `ws` 二选一、必填 `description`。

- `timeout_ms?: number`：有限正数，总时限；省略没有截止，不默认、不截到旧上限。
- `wake_absent_ms?: number`：有限正数，连续静默多久提醒；省略关闭，提醒不停止监听。
- 删除 `persistent`，不保留别名或冲突处理。

验证两项时间参数及已有源参数后再启动进程／WS。时间值按实际毫秒处理，不借用旧默认或用 truthy 判断绕过 0。超过 Node 单次定时范围的值按剩余截止时间分段等待，不能直接传入产生 1 毫秒溢出。分段逻辑留在 monitor 内，不引入调度库。

### 配置

- `monitorFlushMs` 默认 30000；现有文件和环境变量覆盖仍有效，现有合法 0 值继续支持。
- 保留 `monitorMaxLinesPerEvent`（默认 50）作为缓冲／通知的正文行数上限。
- 复用共享 `outputPreviewChars`（默认 12000）作为 monitor 缓冲／通知的正文字符上限。不加 `monitorMaxChars` 或独立策略配置。
- 所有 monitor 受共享 `maxLogBytes` 保护，沿用现有检查周期；命令源的同一日志现在包含 stdout 和 stderr，因此仅 stderr 增长也受保护。不新增单独 errPath、来源分类或合流开关。
- 删除 `monitorDefaultTimeoutMs`、`monitorMaxTimeoutMs`、`monitorRateWindowMs`、`monitorMaxLinesPerWindow`、`monitorMaxOverflowWindows`。
- 删除失去用途的 `monitorPollMs`、`monitor-follow.ts` 和专用 follower 测试。
- 不改写用户文件，不加迁移／弃用专用机制。配置加载器已有的普通未知键处理保持原样。

`monitorFlushMs: 0` 表示不延迟源回调批次；一次 stdout 输入块中的完整行仍作为同一回调批次处理，不能因为按行解析就强行逐行发消息。

## 有界输出契约

新增内部 `monitor-buffer.ts` 作为有界内容与省略统计的唯一实现；不放在顶层 `extensions/`，不声明为独立扩展。

### 保留方式

保留本批最先到达的内容，直到正文行数或字符预算用尽。之后只累计省略数，不保存余下正文、不停止源。每次消费返回一个有界快照并清空本批状态。

- 行数上限包括空行和 WS 消息内容拆出的展示行；活动事件数与展示行数不同，不能从展示行反推活动。
- 正文字符包含正文内部换行，按 JavaScript 字符串长度计数；截断边界避免拆开 UTF-16 代理对。标识、状态、日志路径和省略标记不占正文预算，属于每条通知固定结构，不混入输出行数计数。
- 一个超长行允许保留前缀，但须标明该行被截断及省略字符数；完全未保留的行报告省略行数。两类计数不冒充“若干完整行全部保留”。
- 提示即使正文为空、全部省略也能生成一条带计数的进度通知；这不是没有活动的空通知。
- 不增加独立的“输出过多”通知。所有省略说明随原进度／静默／恢复／收尾批次发送，并指向完整日志。

### 源层内存

只限制 session 的 `pending` 不够，stdout 和 stderr 尚未出现换行的 remainder 也可能无限增长。每条输入 pipe 独立维护有界 UTF-8 decoder／未完成行预览，同样受字符上限约束，其他字节仍写同一日志。不要把两流部分行拼成一个活动；任一流换行才算完整行进度，最终未换行片段只进入收尾。

结构化载荷区分活动、正文和省略量：空 WS 消息或一个包含大量空行的消息也保留活动计数；接收／丢弃内容不能把它误当成没有进度。全部省略后仅保留有限计数和标识，不累计一个空字符串数组。

UTF-8 采用增量解码，不能把跨 chunk 的字符分别 `toString` 导致替换符。通知缓冲、未完成行预览及源向 session 交付的预览都必须有界；Node 输入 chunk 或已交付 WS 消息本身的瞬时内存不是这里能消除的，处理完不额外保留整条巨大消息。

## 源事件入口

### 共同契约

在 `monitor-source.ts` 统一定义源回调需要的类型和字段：

- 活动到达时间：在扩展收到 stdout/stderr 完整行或 WS message 时记录；不承诺发送端写入或网络发送的绝对时间。
- 预览和省略元数据：由同一有界逻辑产生，不把无界 `string[]` 交给 session。
- finishing 与最终结束：先禁止新普通／恢复通知，再交付最终未完成内容和终态结果。

工具先完成验证、分配 ID 和准备 job，再将回调连接到 session，然后启动源并完成 pid／label 等绑定。源构造可以使用一次工厂注入到 session 的方式，避免 source 已输出但无人订阅；不要为了启动间隙增加队列。构造失败回滚刚创建的 registry 条目和 started 计数，关闭 fd，不留下运行中假任务。

### 命令源

monitor 专用 spawn 的 stdout 和 stderr 都用 Node pipe。收到各自原始 Buffer 后，按扩展观察到的回调顺序写同一 `.log`，由同一 session 合并通知，不标来源。两条 pipe 分别解析 UTF-8／完整行，避免跨流部分行或编码错误拼接。进程仍为 detached 的 `bash -c`，共享 shell 的 `spawnWithFileOutput` direct-file 后端和 `exit` 行为不变。

工具合并不改变用户 shell 管道，不能通过给用户命令附加整体 `2>&1`、eval、嵌套 shell 或 tee 子进程来实现。`command | grep ...` 的 stderr 绕过 grep 但进入工具日志／事件；`command 2>&1 | grep ...` 才将两流交给 grep。用户显式 `>file 2>file` 仍可分别重定向。

命令源先安装两个 pipe、error、exit 处理器再返回，不靠轮询。原始写入处理短写，chunk 保存后再报告对应活动。日志失败清理两个 pipe／fd 并失败收尾，不能让回调异常逃逸。stderr 内容本身不改变退出结果；主命令 exit code／signal 决定自然终态。

日志是两流收到的原始 bytes 合并，不人为加换行，可能出现跨流片段交错。通知按各流完整行到达合并，不承诺跨流正文与日志 byte 排列完全相同，也不把合并接收顺序当成实际事件顺序。实现证据与测试边界见 [research/merged-output.md](research/merged-output.md)。

命令退出与 stdout 最终读取契约见本文件“命令源自然结束与观察截止”小节。该契约必须与 Node pipe 的真实事件顺序一致，不能照搬共享 direct-file spawn 的 `exit` 注释。

### WebSocket 源

现有全局 WebSocket 运行时和 clean／abnormal close 的结果映射保留。每个 message 只重置一次活动时间，消息正文可以有多行；空字符串也是活动。二进制 message 沿用现有占位表示，不在本任务中新增二进制落盘能力。

error／close 诊断仍可写入日志并用于收尾，但不触发“恢复进度”。settled 后的迟到 message、重复 close/error 均不能产生新通知。构造失败、显式关闭、异常结束都应关闭日志 fd。

## 通知状态与调度

session 保留必要状态：

- `active`、`absent`、`finishing`、`terminal`；首次通知由“尚无进度提交时间”表示，不另加状态。
- 最近活动到达时间，启动时初始化。
- 最近进度通知提交时间，首批／普通／恢复通知后更新。
- 有界待发缓冲、省略计数。
- 一次 session 内部唤醒定时器，以及可选的显式截止点。

到达、定时和结束都走同一决策入口。下一次 timer 取有意义截止点的最早值，没有待发内容不为普通进度反复空转，静默提醒已经发过就不重复安排静默 timer。

| 输入／条件 | 状态与输出 |
| --- | --- |
| 首次活动 | 更新到达时间；接受该次源回调批次；立即提交 progress |
| `active` 下活动，间隔未满 | 更新到达时间；只缓冲并重排静默截止 |
| `active` 下活动，间隔已满 | 接受该次批次后立即提交 progress |
| 普通截止到时且有待发内容 | 消费一次，提交 progress |
| 普通截止到时但无待发内容 | 不发送、不改变活动时间 |
| 静默到时且 `active` | 消费待发内容并提交 absent，转 `absent`；通知明确监听继续 |
| `absent` 下首次活动 | 更新活动时间；立即提交 resumed，转 `active`；重启普通间隔和静默计时 |
| 显式截止／已知源终止／日志超限 | 转 `finishing`，取消 timer，走统一收尾 |
| 显式停止／会话退出 | 同样清理，但不提交尾批或收尾 |
| `terminal` 下迟到回调 | 忽略，不重新安排 timer |

同一轮决策优先级：已知终态／到期总截止 → 静默提醒 → 普通进度。静默和普通批次同点到期时只发 absent；末批输出并入它，不紧接一条 progress。恢复通知视为新的进度提交，静默提醒本身不算源活动。

同点竞争只能基于当前已观测的回调处理；源结束尚未被观察到时已提交的 progress 不撤销。测试覆盖不同 callback 顺序，保证不重复消费和终态之后没有通知，不承诺事件循环能预知进程退出。

## 通知投递与可见内容

沿用 `EVENT.monitorEvent` 表示 progress／absent／resumed；沿用 `EVENT.taskNotification` 表示终态。统一投递为 `display: true` 和 `DELIVER_STEER`。

正文至少包括：monitor ID、description、状态、日志路径、有界输出、省略说明；absent 还带静默时长和“监听继续”。结构化 details 记录对应字段，不能把模型必须知道的字段只放 details。

Pi 1.1.0 已核对行为：空闲启动 Agent；忙碌 steer 排队，当前整批工具完成后接收，不调用 Agent abort。API 返回 void，仅保证本地提交尝试，不新增重试队列或独立回复承诺。进度提交的同步异常也须在通知出口隔离并记录，不能从 stdout／WS 回调逃逸；失败不算源失败、不停止监听，完整数据仍在日志。

`index.ts` 当前 task renderer 只画摘要和少量 failure-tail，会把 monitor 的日志路径／省略说明藏掉。对 monitor 载荷增加小范围渲染分支，按现有 SDK 宽度处理和控制符清理展示状态、日志路径、有限输出和省略说明；不改 shell 默认渲染，不新增 widget 或面板交互。

## 统一收尾与共享生命周期

### 载荷与抑制

`notify.ts` 接受一个可选 monitor 输出载荷：已经消费的有界正文和省略元数据。有载荷时直接构造收尾，不再调用共享 `failureTail` 回读同一日志，避免失败／killed 又重复内联已提交的进度。未传载荷的 shell 调用保持原行为。

所有收尾仍由 `sendTaskNotification` 处理 `outcomeSurfaced`、`attachCount` 和同步提交失败记录。attach 等待时不另发收尾，attach 结果仍是结果入口；不因此改变正常监听期间的通知规则。

### 原因与结果

| 原因 | 结果与通知 |
| --- | --- |
| 自然成功 | completed，待发输出 + stream ended |
| 非零退出／WS 错误／日志写入失败 | failed，待发输出 + 失败原因 |
| 外部信号 | killed，待发输出 + stopped／signal 原因 |
| 显式 `timeout_ms` 到时 | killed，待发输出 + 总时限原因 |
| 共享日志检测发现超限 | killed，待发输出 + 日志大小阈值原因 |
| `jobs kill`／面板停止／会话退出 | suppressed，不新增任何尾批或收尾 |

finishing 开始后先禁用定时通知，最终排空只添加到待发缓冲；消费完成后变为 terminal。清理幂等，源 late exit 不重复发送、改状态、计数或覆盖 `endedAt`。

`lifecycle.ts` 提供 monitor 可用的小范围超量处理入口，`monitoring.ts` 超限时若调用者提供完整处理回调，就由该回调拥有停止及通知；默认 shell 路径仍是现有停止和被动 warning。不以 `job.kind` 的隐式分支复制一套阈值检查，也不关闭 shared guard。

程序性截止／超量停止不能用会先把结果标为已告知的 silent-kill 来掩盖发送失败：先提交收尾，再使用共享物理终止、`markTerminal`、`abortJob` 组合；`outcomeSurfaced` 只有提交成功或明确显式停止才标记。注册表计数和保留仍归共享函数。

### 命令源自然结束与观察截止

用户明确选择命令 monitor 随主 shell 的 `exit` 结束；不等待 stdout EOF，不增加固定排空时限。证据与已否决的备选方案见 [research/source-drain.md](research/source-drain.md)。

exit 到达后同步切入 finishing，先取消通知 timer、停止普通／恢复入口，再暂停 stdout 和 stderr、同步读取各自 Node 已缓冲的数据。原始 bytes 写同一日志，完整行和最终未换行片段只添加到收尾缓冲；随后销毁两个 pipe、关闭日志 fd 并完成终态。不调用 resume 等将来的 end／close，不因最终读取制造首批通知。

输出流已先结束时仍等主 shell exit；任一流尚未 end，收尾附带“观察随主命令退出结束，后续输出可能未记录”的说明，不报告未知未读字节／行数。已读 bytes 完整保存，内核尚未交付或以后产生的内容不作保证；部分 UTF-8 编码停在观察边界时注明不完整尾部。

显式停止、总截止和日志保护也使用相同双流关闭步骤，显式停止不新增通知。自然 exit 不额外杀孙进程，继续写被关闭 pipe 的生产者可能收到 EPIPE；不新增孙进程管理。stop/error/late close 清理幂等，两流最终读取顺序不作保证。

## 取舍、风险与回退

- 源到达计时需要 monitor 两条输出 pipe 经过 JS，成本比 direct-file 高；这是准确行到达和 WS 事件边界的必要改动，shell 不付这项成本。
- 前缀保留可能省略本批最后的关键内容，通知明确计数和日志路径，Agent 可用现有入口读取完整日志；不加头尾采样策略。
- 日志大小检查仍是周期保护，不是硬写入上限。默认合并两流，不加来源／严重度标签；WS 二进制占位能力不扩展。
- 首批通知可能先于极快源的终态被观察到；已发通知不撤回，最终读取不能人为制造额外首批消息。主 shell 退出即关闭观察，尚未接收的输出可能缺失，通知说明这一边界。
- 无旧参数兼容是用户明确决定；只记录新契约，不新增迁移层。
- 回退需一起恢复源、调度、通知载荷和相关文档，不只把投递常量改回去。不修改用户配置，故不需要迁移回退脚本。

## 与后续任务的顺序和保护边界

用户要求先完成当前任务，再实施 `10-12-subagents-task-ux`。后续任务将 bg-tasks 重命名为 process-tasks，并以独立执行后端／adapter 接入共享 task-ui；当前不提前改名、抽面板或做统一执行框架。完整边界见 [research/follow-up-boundary.md](research/follow-up-boundary.md)。

- 继续使用现有 Job 运行／终态模型；monitor 通知的 absent/resumed 不修改 `Job.status`，不消费 `outcomeSurfaced`。timer、buffer、source/fd 不进入 UI 快照。
- 后续 shared panel 通过执行后端的显式 stop 能力调用共享停止入口，仍不新增尾批或收尾；不让 UI 依赖 monitor 内部状态。
- 当前只扩展有类型的 monitor 终态载荷和超量处理回调，保留 shell 默认行为、注册表字段／计数／保留、会话清理及已有消息类型。
- 不改当前快捷键、input detach、面板交互、公共 command/config 名称；这些属于后续任务。renderer 只适配通知载荷，不引用面板私有状态。
- 交付时记录源入口、通知载荷、共享回调和测试；后续以当前最终代码为基线迁移，不恢复旧 monitor 规则，也不重复生产通知。

## 验证与审阅

全部 19 条 PRD 验收的离线测试映射、文件清单和实施顺序见 [implement.md](implement.md)。普通定时行为用 `node:test` 假时钟和假源验证，真实命令只做隔离的源／排空集成测试；捕获投递选项、输出边界、日志完整性、停止调用和资源释放。

用户已批准本设计及最后的 stdout/stderr 合并调整，可按 Trellis 流程运行 `task.py start` 并进入实现。若实现中出现实质性需求变化，仍需回到用户审阅。
