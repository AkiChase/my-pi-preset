# Monitor 会话级通知合并设计（已批准实施）

## 1. 范围与状态

用户已批准开始实施，并确认统一 200ms 短窗口、小间隔 min(200ms,F)、及时刷新带走其他源待发活动并重计普通间隔。

不迁移 agent 通知，不合并普通 bash 终态；不改 task-ui、不新增顶层扩展入口或依赖。在当前 main 工作区执行，现有 4 个 `.pi` 无关改动不得覆盖、提交或归入本任务。

## 2. 归属与数据流

新增 nested `extensions/process-tasks/monitor-notifications.ts`（建议名），由 BackgroundRegistry 持有一个会话范围实例。实例使用注入的投递能力，不在 state 模块 import SDK runtime 或设置全局单例。

```text
source 完整行／WS frame
  → monitor-session：lastActivity、deadline、silence、每源有界 pending
  → 会话调度器：按源登记待发活动／状态转换／有界终态
  → 一次 sendMessage：多来源正文与结构化 details
  → 成功后：消费本次快照、标记终态已告知、推进共享通知时间
```

source/session 继续拥有实际执行、fd、decoder 和停止；调度器只拥有通知订阅、待发载荷与一个刷新 timer，不等待源关闭，不调用 stop，不拥有 OS promise。delay 必须按 job 对象和 activation 身份校验。

## 3. 调度规则

设 F=monitorFlushMs、W=200ms、L=上一次成功 monitor 通知提交时间。

- F=0：保留源回调批次不延迟模式，跳过短窗口；仍走同一投递校验路径。
- 首次普通活动或已经超过普通间隔后收到活动：开启最多 W 的短窗口。窗口截止固定，后续事件不重新 debounce。
- 尚未达到 L+F：安排普通刷新，不额外叠加 W。采用 min(W,F) 作为首批短窗口，避免用户配置 F<200ms 时合并延迟大于普通间隔。
- 无待发事件不安排活动刷新，无空通知；timer 长延迟按 Node 上限分段。
- 及时事件（自然终态、失败、超时、oversize、absent、resumed）将刷新期限提前至事件发生后至多 W，不把既有更早期限延后。
- 及时刷新带走其他源有资格发送的 pending；成功后 L 更新，后续普通活动按新 L+F 调度。attach 抑制的终态不算已发送，也不阻塞其他源。
- 同批发送一个 steer+triggerTurn 消息；不承诺一个消息对应一次模型回复。

普通活动的 30 秒是节流目标，不是所有消息的硬下限；频繁 timely 事件仍可能频繁唤醒，不增加未经需求认可的速率丢弃。

## 4. 每源状态与终态

保留 lastActivity 和总 deadline 的每源判断。共享通知提交不改变 lastActivity；被预览省略的活动也更新实际事件到达时间。

短窗口内多个状态转换须保留顺序含义（如 absent→resumed），不能仅用最后 state 覆盖导致提醒／恢复消失。普通 progress 可以合并；自然 terminal 带走未发 progress/final，最多一个终态结果。

运行源的资格检查：registry 未 closed、job map 对象相同、源未显式取消。终态投递不可复用要求 job running 的 current 检查；自然结束引发的内部 abort 不能移除已构造尾批。显式 kill、结果已消费、shutdown 与 setup rollback 才取消对应通知资格。

## 5. Retrieval 与 exactly-once 边界

复用 notify.ts 的终态资格规则：发送前检查 outcomeSurfaced/attachCount/map identity。attach 中保存有界终态重查资格；最后 retrieval 取消后重新登记及时尾批，成功 inline 消费或显式 stop 取消资格。

只有 sendMessage 本地提交成功后设置本次终态 outcomeSurfaced。消息多来源必须一次筛选、一次构造、一次发送，不能内部调用多次 sendTaskNotification。可将既有资格／标记步骤拆为 notify.ts helper，但 shell 路径时机与正文不改变。

在回调重入情况下，仅消费本次快照；发送期间新到事件留待下一批。关闭／换代后不得重新安排 timer，不向新 registry 更新旧字段。

## 6. 正文与 renderer

新增显式 monitor batch details 结构（字段名在实施前固定），包含逐来源 jobId/state/description/logPath/preview 及终态 summary。保留对旧单条通知的渲染支持。单来源可保持原正文形状；多来源使用 batch 标题及独立来源段落。

复用 MonitorBuffer 的省略元数据和 Unicode 前缀函数；正文与 details 使用同一裁剪后的预览，不把完整各源预览偷偷保留在 details。所有来源身份／状态／日志可追踪，不因正文裁剪丢终态。

用户已确认：整批共用 outputPreviewChars 的输出内容预算，普通输出按来源公平分配；来源 ID、状态、日志路径等简短 metadata 单独保留，不因输出预算耗尽丢失终态。完整详情可在 task 面板／日志查询，不在通知中重复携带全量输出。

独立审查确认 registry 的终态保留没有数量硬上限，不能用 maxConcurrentJobs 推导整批 metadata 有界。用户随后批准「有界通知＋完整清单」：正文和 details 的合计序列化容量采用明确硬上限（新增内部常量，不新增配置字段），仍共享 outputPreviewChars 输出预算；超量来源的完整 ID、状态、转换、日志路径和终态 summary 写入可查询的批次清单，通知必须保留清单路径及省略来源数量。允许不内联全部来源 ID，但不得丢记录、拆批或增加一次刷新内的外发次数。完整清单沿用日志保留语义，不作为外发 details 偷带全量载荷。容量回归必须同时覆盖正文/details 与大批终态来源，文件写入失败不得杀监听、谎称成功保留或标记未保存的终态已告知。

### 硬容量落地接口

`monitor-batch.ts` 固定64KiB上限，其中`JSON.stringify({content,details})` UTF-8最多63KiB、1KiB信封预留；按来源计量后只构造前缀。`details.monitorBatchOverflow`携带sourceCount/omittedSources及manifestPath或manifestError，正文同步展示。metadata清单为配置logDir下`monitor-batch-<uuid>.jsonl`，wx独占/0600，header后逐来源保存原metadata（转换仍遵守已有16次＋省略计数，不恢复已省略历史），字符串分块/短写处理/关闭fd。原日志存完整输出；清单与日志同样由用户清理，不归source或epoch资源释放。路径不能完整放进容量则写前失败；unavailable通知不得谎称保留成功，不消费未保存省略terminal，无自动retry/replay。新代码验证见research/capacity-results.md，仍需新的独立check。

## 7. 发送失败

不新增自动重试。记录各参与 job 的 notifyError，不杀源、不设置终态已告知，不在同步失败后安排立即重试循环。

用户已确认沿用现有提交失败消费语义：本次 progress 预览不自动重放，原始日志可查询；终态保留查询／既有 retrieval 重查能力。不把 enqueue 视作成功，不把提交成功视作模型已读，不新增自动重试。后续新事件仍正常参与通知。

## 8. Lifecycle 接入

freeze 同步清队列／刷新 timer并拒绝新增；session_start fallback 在清 jobs 前 reset 调度器（旧 epoch 失效）；setup exception/显式 stop 撤销本来源；自然终态移除源活动 owner，但尾批由调度器持有限载荷。

dispose 幂等，释放所有回调引用；unref 仅控制进程保活，不能代替 clearTimeout。沿用现有 actual execution shutdown 机制，不改 OS 取消协议。

## 9. 验证与发布

假时钟、多 fake sources、fake SDK sink 验证实际调度器和 monitor-session；实际 factory 测试校验 renderer、retrieval 和 lifecycle，不仅测试独立 helper。

同步 README、monitor tool description、config 注释、monitor-contract 与 provenance 的通知行为说明。不添加配置文件写入或安装步骤。回滚时整体恢复调度／渲染／规范，不保留双时钟并行运行。

完整规划已由用户批准实施；通过 validate/start 后执行，提交仍需另行授权。
