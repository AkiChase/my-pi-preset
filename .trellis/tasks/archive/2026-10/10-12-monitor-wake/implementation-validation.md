# Monitor 实施与验证交付记录

## 结论

已按批准的五步顺序完成产品代码、离线测试、中文 README 和本地来源记录。首次实现检查为 **312/312**、无 force-exit 回归为 **295/295**，但独立审查随后发现并由主会话复现三项契约缺口，因此首次全绿不代表交付完成。本次已定向修复并增加 13 个回归；最新隔离 `pnpm check` 为 **325/325 通过**，无 force-exit 的 bg-tasks／manifest 回归为 **308/308 通过**。三项修复分别补齐 AC18 启动资源回滚、AC10 通知异常隔离、AC12 预览再次合并统计；PRD 19 条验收对应的其余原断言继续通过。没有安装或同步真实 pi，没有修改真实用户配置，没有提交、切换或结束任务。

本次修复已获主会话及独立 reviewer 复核；首轮三项产品缺陷和后续截止测试覆盖问题都已闭合，最终结论见 [review-validation.md](review-validation.md)。没有修改 task 状态或自动提交。

这是 implement 子 Agent 的实现报告，不代替主会话的独立 `trellis-check` 审查。按子 Agent 自豁免规则没有再派 implement/check；主会话仍应完成独立审查、必要 spec 更新和提交决策。

## 按文件交付

| 文件 | 变化与原因 |
| --- | --- |
| `extensions/bg-tasks/monitor-buffer.ts` | 新内部有界前缀缓冲；正文行数／字符数及整行／字符／截断行省略量在接收时计入，UTF-16 截断不拆代理对；第一次省略后不再填补后续较短内容。 |
| `extensions/bg-tasks/monitor-source.ts` | monitor 专用 detached `bash -c` 双 pipe；原始 bytes 短写处理，同日志、独立 UTF-8／有界部分行；主 shell exit 同步 finishing、读取 Node 缓冲、双流关闭和 fd 关闭，写入／pipe 错误失败收尾。 |
| `extensions/bg-tasks/monitor-ws.ts` | 按 WS message 交付一次活动（含空消息），有界预览；诊断只进入收尾，构造失败及 close/error/显式 stop 关闭 fd，忽略迟到事件。 |
| `extensions/bg-tasks/monitor-session.ts` | 用事件到达与通知提交时间替代 follower／速率窗口；单 timer 决策首批、普通、静默、恢复和总截止，有意义截止点分段等待；单次 pending 消费与静默显式停止。 |
| `extensions/bg-tasks/monitor-follow.ts` | 删除仅供 monitor 使用的轮询 follower，不改 output/attach 的日志读取。 |
| `extensions/bg-tasks/lifecycle.ts` | 增加 monitor 可用的 `handleOversize` 传递，已终态 late exit 不再调用自有 onExit；共享终态／计数／保留归属不变。 |
| `extensions/bg-tasks/monitoring.ts` | 全部 monitor 使用共享 maxLogBytes；自有超限回调拥有停止与合并通知，默认 shell warning 路径保持。 |
| `extensions/bg-tasks/notify.ts` | typed monitor payload 在收尾替代 failure-tail 回读，避免重复内联旧进度；保留 attach、outcomeSurfaced、同步发送失败记录及 shell 默认分支。 |
| `extensions/bg-tasks/index.ts` | 只增加 monitor 载荷 renderer 分支和 monitorEvent 注册；显示身份／状态／日志／省略量，控制符清理与 SDK 宽度截断，shell renderer 不变。 |
| `extensions/bg-tasks/tools/monitor.ts` | 新可选 wake_absent_ms；timeout_ms 真正可选、有限正数；源启动前验证，先准备 registry／sinks 再构造源，构造失败回滚计数；删除 persistent 和旧 prompt 承诺。 |
| `extensions/bg-tasks/config.ts` | 默认 monitorFlushMs 30000，保留 0／文件／环境优先；删除旧默认截止、上限、poll、速率配置及跨配置校正，不写用户文件。 |
| `extensions/bg-tasks/__tests__/monitor-buffer.test.ts` | 新增前缀／省略／空行／Unicode／超长部分行／双 decoder 测试。 |
| `extensions/bg-tasks/__tests__/monitor-source.test.ts` | 新增真实隔离 shell 管道／双流／重定向／孙进程和确定性 fake pipes exit/drain／短写／磁盘错误／编码尾部测试。 |
| `extensions/bg-tasks/__tests__/monitor-session.test.ts` | 用 node:test 假时钟／假源替代真实等待／速率杀监听断言，捕获时间和投递 options，增加实际 panel/jobs stop 及会话边界回归。 |
| `extensions/bg-tasks/__tests__/monitor.test.ts` | 工具 schema／非法时间／源构造回滚／WS 活动和迟到事件／真实 stderr-only 日志保护；测试日志改为隔离目录。 |
| `extensions/bg-tasks/__tests__/config.test.ts` | 30 秒默认／显式 2000／0／环境优先／删除字段普通 unknown warning 及文件不变断言。 |
| `extensions/bg-tasks/__tests__/index.test.ts` | 新 monitor renderer 身份、状态、日志、省略与安全宽度断言，保留 shell/session 原断言。 |
| `extensions/bg-tasks/__tests__/monitor-follow.test.ts` | 随弃用 follower 删除。 |
| `README.md` | 中文用户契约：双流及管道区别、事件到达、可唤醒合并、静默／恢复、无隐式截止、主 shell exit 观察边界、显式停止及周期日志保护、删除字段。 |
| `extensions/bg-tasks/PROVENANCE.md` | 保留上游 commit/v2.0.0/MIT，追加中文当前分叉行为；将旧 monitor batching 描述明确标为历史、已被新契约取代。 |
| 本文件 | 记录实际验证、验收证据及后续 API 接缝。 |

预存的 `.trellis/spec/preset/` 中文语言修改、未跟踪基础设施和后续任务文件均保留，没有纳入本次产品修改。

## 验收到真实测试映射

| AC | 已执行断言 |
| --- | --- |
| 1 | config：默认 30000、显式 2000、0、环境覆盖为 0、旧字段普通 warning、文件 bytes 不变。 |
| 2 | session：factory 同步首批、29999ms 不发／30000ms 发、安静间隔后到达立即、0 按回调整批，记录提交时刻。 |
| 3 | session：没有 wake 参数的静默源推进 10 个旧上限窗口仍无消息；普通无 pending 不空转发消息。 |
| 4 | session＋decoder＋WS：缓冲／省略的事件仍重置到达时间；未换行不活动，多行 WS 一次到达。 |
| 5 | session：启动 10000ms 一次 absent，之后 50000ms 不重复；内容明确监听继续。 |
| 6 | session：恢复即时；随后普通提交与恢复间隔恰为 5000ms。 |
| 7 | session：两轮 absent/resumed 各自一次，恢复不改变 Job.status／结果标记。 |
| 8 | session：静默和普通同点到期只提交 absent，并消费 pending 一次。 |
| 9 | session／source：completed/failed/signal/deadline/log-limit 一条合并 terminal；final 无 leading edge；known finishing 禁止 timer；jobs/panel/shared stop 不新增消息；late callbacks 无效。 |
| 10 | session：全部 progress/absent/resumed/terminal 捕获 display=true／DELIVER_STEER；模型正文含身份／描述／状态／日志，renderer 显示字段且宽度／控制符安全；没有 Agent abort 入口。 |
| 11 | tool：两项时间 0/-1/NaN/Infinity 在 registry／源前拒绝；session：超过 2147483647 的有限时间分段，不在 1ms 触发。 |
| 12 | buffer/source：巨量原始 bytes 保留、独立 UTF-8、确切省略统计、空 WS／多行；EOF 先到和 exit 先到，已缓冲双流同步排空，孙进程持 pipe 不等 EOF；未知后续输出只说明，不虚构数量；不完整 UTF-8 原 bytes 和边界说明。 |
| 13 | session：没有 timeout 参数推进超过旧默认和上限仍 running、未停止。 |
| 14 | session：总截止优先于同点 absent/progress，带原因和 drained final 一条；静默提醒本身不 stop。 |
| 15 | session/buffer：持续 100 个高频批次继续运行／无独立警告，入站和出站正文受限；前缀首次省略后封闭，省略量合入原通知。 |
| 16 | schema/config：无 persistent 和六个旧字段，无校正／兼容层；旧文件字段仅普通 warning，不写文件。 |
| 17 | session/tool：所有 monitor 走共享周期阈值，一条合并 wake 无 bg-stall；真实 stderr-only 增长也 stop；deadline／oversize 的 attach 抑制和 send failure 不错误标记结果。原 shell 超量／失败尾部测试原样通过。 |
| 18 | session/index＋现有回归：absent/resumed 仍 running、结果未消费；实际 BgTaskPanel 查看／关闭不改调度，x 和 jobs kill 静默；registry replacement/abort 不通知新 session；shell/foreground/attach/shortcut/input/registry/retention/session/manifest 原断言全部通过。 |
| 19 | source/tool/decoder：stderr-only exit 0 有活动、成功结果；默认同日志；独立编码与部分行；stdout-only grep、显式 2>&1 grep、分别 redirect 语义正确；仅 stderr 超限共享保护；两个流清理。 |

## 实际运行命令与结果

SDK 仅复用已安装的 Pi 1.1.0。`pnpm link-sdk` 显示从现有安装链接 **0 new of 8**，没有下载／安装。后续调用用 SDK override 和 mktemp agent 目录隔离配置：

```sh
pnpm link-sdk
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
trap 'rm -rf "$agent_dir"' EXIT
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
```

- 首次严格 typecheck 暴露旧测试／旧 config 校正引用，随后修复。
- 首次 directed node:test 暴露 TypeScript 参数属性虽可 typecheck、但 Node strip-only 无法加载，改为普通字段；另修正一个字符预算测试预期（没有预算保留下一行时正文长度为 3，不是 4）。没有用 transform flag 隐藏问题。
- 中间 focused `node --test extensions/bg-tasks/__tests__/monitor{,-buffer,-source,-session}.test.ts extensions/bg-tasks/__tests__/config.test.ts` 最后记录为 **76/76 通过**，无 force-exit。之后又新增 5 个边界测试并纳入最终全量／定向回归。
- 最终 `pnpm check`：typecheck 通过；**312 tests / 77 suites，全通过，0 skipped/cancelled**，约 16.8 秒。项目脚本自身带 `--test-force-exit`，因此另做下项。
- 最终隔离配置的 `node --test extensions/bg-tasks/__tests__/*.test.ts scripts/pi-manifest.test.mjs`：**295 tests / 72 suites，全通过，0 skipped/cancelled**，约 6.3 秒；未使用 force-exit，进程正常退出。
- 测试注入的通知 sink unavailable 错误日志属于预期断言，证明 progress／terminal／forced-stop 发送失败被隔离且不将结果标为已告知；不是测试失败。
- `python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-monitor-wake`：implement/check JSONL 各 11 条，全部通过。
- `git diff --check`：通过。修改／新增 Markdown 相对链接检查和 JSONL 实际路径检查：49 项通过（下次主会话可重跑）。
- 旧字段和 passive monitor 描述搜索：产品实现已无旧配置；剩余是 README 删除说明、config/schema 删除验证及 PROVENANCE 明确历史段落。

没有真实执行 install.sh、sync.mjs 或 pi 安装；全量中的 sync tests 只运行仓库隔离 fake-pi 测试。

## 独立审查三项修复与最新复验

修复按原实施计划的源／缓冲、session、共享通知归属处理，没有改变计划顺序或需求；没有扩大 shell 生命周期、目录／UI／快捷键／input／registry／依赖范围。

| 本次文件 | 修复与新增证据 |
| --- | --- |
| `extensions/bg-tasks/monitor-buffer.ts` | 零可用字符且 `missingChars > 0` 的行计为完全省略非空行，不把 source 的空前缀误当真实空行。 |
| `extensions/bg-tasks/monitor-session.ts` | monitor 本地 catch 覆盖共享启动接线及初始调度；sidebar 抛错时先 finishing，再用共享 terminateJob／abortJob 停源、终止进程组、清 timer，并释放 completion hooks，不计终态或发送启动失败通知。emit 将 unknown 异常安全转文本。 |
| `extensions/bg-tasks/notify.ts` | 同样安全转换 unknown；null／undefined 不再令 catch 二次抛错，保持成功才标记 outcomeSurfaced。 |
| `extensions/bg-tasks/__tests__/monitor-buffer.test.ts` | 合法 50 行／200 字符：空 WS 预览后合并 `x.repeat(198)+'\\n😀'` 与直接输入完全相等；2 显示行、1 整行省略、2 字符省略、0 截断行；原 source 截断元数据仍相等。 |
| `extensions/bg-tasks/__tests__/monitor-session.test.ts` | 假源启动 UI 失败验证 stop 一次、进程组 SIGTERM、零 abort／timer、completion 释放、零终态计数／通知及迟到回调无效。null／undefined 各覆盖 progress／absent／resumed／terminal 和 deadline／oversize；实际 spawnCommandSource 配合确定性双 pipe 验证 receive 不误报源失败，两个流继续 running 并保留原始日志，最终正常 exit 0。 |
| `extensions/bg-tasks/__tests__/monitor.test.ts` | 实际 WS 源配合假 WebSocket：工具启动 UI 失败关闭 socket／日志 fd 各一次、回滚 jobs／started／abort，迟到 message／error／close 不通知。 |
| `extensions/bg-tasks/__tests__/notify.test.ts` | null／undefined 收尾失败不抛且不锁定结果；后续显式成功调用清错误、锁定成功、重复调用不再发送。未增加自动重试机制。 |
| `README.md`、`extensions/bg-tasks/PROVENANCE.md` | 补充通知失败隔离、无自动重试、启动接线失败清理／无收尾及本地修复说明，不改变主会话规范编辑或上游来源记录。 |

最新命令均以已安装 SDK override 和临时 `PI_CODING_AGENT_DIR` 执行：

- `pnpm check`：严格 typecheck 通过；**325 tests / 77 suites，全通过，0 skipped/cancelled**，约 16.1 秒。链接 **0 new of 8**，未下载依赖。首次修复复验曾发现新测试遗漏必填 toolCallId 和 override，已修正后重复全量通过。
- `node --test extensions/bg-tasks/__tests__/monitor{,-buffer,-source,-session}.test.ts extensions/bg-tasks/__tests__/notify.test.ts`：**94/94**，8 suites，约 0.8 秒；无 force-exit，正常退出。
- `node --test extensions/bg-tasks/__tests__/*.test.ts scripts/pi-manifest.test.mjs`：**308/308**，72 suites，约 6.7 秒；无 force-exit，正常退出。
- `python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-monitor-wake`：implement／check JSONL **各 12 条**全部通过；未修改清单或 task 状态。
- `git diff --check`：通过。README／PROVENANCE／本文件的本地 Markdown 链接检查通过。

上述错误注入为测试契约证据，不声称当前 SDK 会抛 null／undefined。仍没有真实 Agent 回复端到端验证；本地投递与源清理由离线断言验证。未派 implement/check，主会话应让原独立 reviewer 复核三项并更新自己负责的审阅记录；commit／finish／archive 留给主会话。

## 最后一次测试覆盖修复

独立复核确认三项产品修复，但原 deadline 错误回归与超限日志在 1000 毫秒同时满足，实际先命中 oversize。主会话只调整测试：deadline 使用正常日志上限，oversize 不设总截止；通知抛错前保存正文，断言具体 timeout／log-size 原因并覆盖 999/1000 毫秒边界。null／undefined 和 attach 抑制分支也独立触发。产品代码没有因此变化。

主会话后台检查 `bs8usyid8`：monitor-session 33/33、`pnpm check` 325/325、无 force-exit 的 bg-tasks＋manifest 308/308，全部通过。最终独立覆盖复查和当前审阅结论见 [review-validation.md](review-validation.md)。

## 后续迁移接缝

后续 subagents-task-ux 应先重读本交付后的 baseline，整组迁移而不是恢复旧 follower／persistent：

1. `MonitorPreview`：有界 `lines: { text, omittedChars }[]`，总 omittedLines/omittedChars/truncatedLines。部分保留的行通过 per-line metadata 在 source→session 重合并时避免重复计数；一次 take 是唯一批次消费。
2. `MonitorSinks`：`event(preview, arrivedAt)`、`finishing()`、`final(preview)`；`MonitorSourceFactory` 必须先拿到 live sinks 再启动。`MonitorResult` 在 SpawnExit 上增加 reason/observationNote；stop 同步清理，可返回观察边界说明。spawnProcess 只是确定性本地测试接缝。
3. `startMonitorSession`：createSource、可选 timeoutMs/wakeAbsentMs；buffer/timer/source/fd 都是闭包私有，不入 Job／panel 快照。
4. `MonitorNotificationPayload`／`sendTaskNotification({ monitor })`：已有 EVENT.monitorEvent 和 EVENT.taskNotification，进度不消费结果标记；terminal 保持共享抑制。renderer 只识别 payload，不依赖 panel。
5. `startBackgroundJob`／`watchStalls` 的 `handleOversize`：有回调就由调用方拥有停止和通知；无回调的 shell 路径仍停止＋原 warning，不再有 monitor 豁免。
6. 保持 kind=monitor、Job.status／ID／pid／logPath、计数／保留、terminateJobSilently、顶层 wrapper。不新增 absent/resumed 任务状态，不让 shared panel 生产第二份通知。

## 有意未做与审阅边界

- 没有改名 bg-tasks、引入 agents/task-ui/adapter/framework、新依赖、额外配置、日志轮转、shortcut/input/panel 交互或 shell spawn 后端；未修改后续任务。
- `registry.ts` 的既有 errPathFor helper 虽不再由 monitor 使用，未顺带删掉（公共旧文件和 shell split-output 能力不属本次整理）。
- 不承诺主 shell exit 后无限 descendant 输出或跨流真实顺序；已明确观察随 exit 截止。周期日志保护不是硬磁盘上限。
- sendMessage void 只验证本地提交尝试及 SDK options；没有真实 Agent 回复端到端测试，也不承诺每条消息独立回复。独立审查应核对 Pi 安全边界语义与文档一致。
- 主会话负责独立 trellis-check、可复用 spec 更新、提交及 finish；本次不运行任务生命周期命令、不自动勾改 implement 计划或改变状态。
