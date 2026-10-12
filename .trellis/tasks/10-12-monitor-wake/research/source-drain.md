# 命令源 stdout 排空与结束边界

## 问题

monitor 要从日志轮询切换为 stdout 源事件才能记录完整行到达时间。共享 shell 的 direct-file spawn 使用 child `exit`，不等待 child `close`；但 pipe 场景在 `exit` 时可能尚有未读数据，孙进程也可能继续持有 stdout。不能直接复制 shell 结束回调，也不能用固定延迟声称尾部必定完整。

## 研究证据

专项只读研究核对 Node v24.14.1，并在内存命令中做隔离实验，没有修改产品文件：

- `spawn.ts:57–76`：共享 shell 以 `exit` 为结束，不等继承 fd 的孙进程；这是 direct-file 写日志的契约。
- `monitor-source.ts:29–47`：旧 monitor 复用该后端，没有额外管道排空。
- `tools/monitor.ts:118–138`：旧的 source 构造先于 session 接线，切为回调时必须调整启动顺序。
- 本地 `bash -c 'printf "first\n"; sleep 0.35 &'` 的 pipe 实验中，数据约 3 毫秒收到，child exit 约 4 毫秒，stdout EOF 约 362 毫秒，child close 约 364 毫秒。child exit 和 stdout EOF 不是同一边界。
- 65536 字节的 readable-mode 实验在 child exit 时没有消费数据，但 `readableLength` 为 65536；手动排空可取回所有数据。退出后立刻 destroy 会丢这部分内容。
- 孙进程延迟 0.2 秒输出、exit 后约 25 毫秒 destroy stdout 的实验没有收到晚到的数据；短暂 grace period 不能保证继承输出完整。
- 已安装 Node 的 `internal/child_process` 实现先 emit exit，再安排 `flushStdio` 恢复 readable 流。该实现细节支持上述风险，但不能当成跨版本完整排空保证。

实验时间只是本地观测，不作为实现常量。在线 Node 文档获取失败，因此本文件只引用仓库、已安装 Node 实现和本地实验，不声称已核对在线官方文档。

## 方案比较

| 方案 | 好处 | 代价 |
| --- | --- | --- |
| child exit 后立即销毁 stdout | 结束时机接近旧 shell | 可丢已缓冲内容，不满足尾部完整性 |
| child exit 后增加固定排空时限 | 有限等待 | 时限是新策略，任意迟到输出仍会被截断；须新增截断契约，不能声称完整日志 |
| child exit 与 stdout EOF 都满足才自然结束 | 不添加时限，不任意截断，结束归流本身 | 孙进程持有 stdout 时 monitor 继续运行，即使主 shell 已退出；旧的单 child-exit 结束时机改变 |

源事件必须走 monitor 专用 stdout pipe，原始 Buffer 写日志后增量解码；direct-file 轮询／watch 不能恢复真实行到达。不要为双写增加 tee 子进程或改共享 shell 后端。

## 用户确认的结束契约

后续用户进一步确认 stdout/stderr 默认合并，以下退出和同步读取规则同样适用于两个 pipe：各自取走已缓冲 bytes 后写同一日志，任一流未结束时说明可能截断，两个流都关闭。之前只研究 stdout 的实验是风险证据，不是继续把 stderr 单独保存的理由；目标流契约见 [merged-output.md](merged-output.md)。

用户选择“随主 shell 退出结束”，否决等待 stdout EOF 的主会话建议；不添加固定 grace period。

- child exit 到达时先通知 session 进入 finishing，取消进度／静默定时，暂停普通数据入口。
- 同步读取 Node readable 已缓冲的 stdout，完整写日志，只进入待发收尾内容；随后销毁 pipe、关闭日志 fd、返回终态。不用 resume 等待未来 end／close。
- 若 stdout 此时未结束，收尾明确说明观察已随主命令退出结束、后续输出可能未记录。不知道尚未读到多少字节，不能编造省略行数／字节数。
- 日志完整性只覆盖观察范围内已收到／已缓冲读取的 bytes；尚在内核或孙进程以后产生的输出不作保证。既有通知正文截断的已知省略量仍须准确计数。
- stdout 先 end 时不早于主 shell exit 收尾；error、重复 exit／close 和 stop 都幂等。
- 自然 exit 关闭观察但不额外杀孙进程；继续写 pipe 的生产者可能收到 EPIPE。显式 stop／截止／日志保护仍使用共享进程组终止。逃离进程组的进程不在本次新增管理范围内。

## 验证要求

- 主进程退出时 stdout 在 Node 中已有缓冲：同步保存这部分 bytes，最终读取不触发首批／恢复通知。
- 孙进程持有 stdout 时，monitor 随主 shell exit 结束，不等 EOF；收尾含可能截断说明，之后没有 timer／活动消息。
- stdout EOF 先到、主进程 exit 先到两种顺序都只完成一次。
- 总截止／日志保护产生单条原因收尾，显式 kill 不新增通知，关闭 fd、timer 和订阅。
- 模拟未知未读输出时不伪造数量；源已收到部分 UTF-8 字节则原始日志准确，预览明确未完成编码边界。
- 不改变共享 shell direct-file 后端、不增加固定排空时限或无界启动队列。
