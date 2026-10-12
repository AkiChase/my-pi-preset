# Monitor 通知与唤醒：实施计划

## 状态与入口

本任务是同一条 monitor 数据链路的整体调整，不拆父子任务。源事件、通知调度和终态合并必须共同验证，拆开上线会出现事件计时不准或重复收尾。

用户已明确批准最新方案并要求派 Agent 开始实现。执行 `task.py start` 后按本计划实施；不提前启动后续 subagents-task-ux。

## 实施完成情况

产品实现、19 条验收对应离线测试、README／PROVENANCE 和可复用中文规范已完成。三项产品审查发现及截止测试覆盖缺口已修复并独立复核；`pnpm check` 325/325，无 force-exit 回归 308/308。详细记录见 [review-validation.md](review-validation.md)。下方保留原实施清单作为规划记录，不表示这些实现项尚未完成。

仍待用户确认的流程项：提交本任务改动，然后按工作流 finish／archive 和记录会话；不自动启动后续 task。

**收尾更新：** 用户已批准提交并合并，工作提交 `75e5278`、`85c6189` 已进入 `main` 并由用户 push。用户随后要求收尾，本任务已归档，单独记录归档与日志提交；后续 task 未启动。

## 实施顺序

先完成本任务并验证，再做 `10-12-subagents-task-ux`，不并行改相同产品文件。开始实现前读取 [research/follow-up-boundary.md](research/follow-up-boundary.md)，不提前改名 bg-tasks、抽共享面板或设计 agent backend。

### 1. 源事件与有界输出基础

- [ ] 对照 [design.md](design.md) 实现 monitor 专用源事件入口，不修改后台 shell 的 `spawnWithFileOutput` 执行行为。
- [ ] 命令 stdout 和 stderr 都用 pipe，原始 bytes 写同一日志，不标来源。各流独立增量解码 UTF-8、按完整行报告事件，重置同一静默计时；不拼接跨流部分行，不因 stderr 内容判失败。
- [ ] 保留用户 shell 管道与重定向语义，不整体附加 `2>&1` 或使用 eval／嵌套 shell／tee 改写执行。测试默认 stderr 绕过 grep 仍被收到，显式 `2>&1 | grep` 后才按两流过滤。
- [ ] 不完整超长行只保留有界预览和省略计数；源结束时最终片段进入收尾，不触发普通／恢复通知。
- [ ] WebSocket 按 message 事件报告一次到达；多行、空消息及二进制占位不丢失活动信号，连接诊断留在日志／收尾，不作为恢复进度。
- [ ] 按已确认契约在主 shell `exit` 时结束 monitor：先 finishing，再同步读取 Node 已缓冲的 stdout/stderr，只合入同一日志／收尾，随后关闭两个 pipe 和 fd。不等 EOF、不加排空时限；任一流未结束时说明后续输出可能缺失。
- [ ] 确保先接好事件处理再让工具返回，不用异步启动间隙或无界启动队列。测试 EOF 先到、exit 先到、孙进程持有 stdout，以及显式 kill／截止／日志保护的清理；主 shell exit 后无新活动通知。
- [ ] 移除不再使用的日志轮询 follower、`monitorPollMs` 及其专用测试；保留 `jobs output/attach` 和面板读取日志的实现。
- [ ] 实现 monitor 内部有界缓冲：复用 `monitorMaxLinesPerEvent` 和 `outputPreviewChars`，保留本批前缀、累计省略，不增加配置或策略开关。

验证：源的 UTF-8 分块、部分行、超长行、完整原始日志、WS 消息边界、源启动失败和终态排空测试通过。

### 2. 通知调度与静默／恢复

- [ ] 重写 `monitor-session.ts` 的调度，删除速率窗口和溢出终止。
- [ ] 分别记录事件到达时间和最近进度通知提交时间；普通间隔不由定时器是否存在决定。
- [ ] 一个 session 内部调度入口决定到期事项：已知终态／显式截止优先，其次静默提醒，再普通进度；不独立发相邻消息。
- [ ] 实现首批立即、普通合并、空缓冲不发、间隔过后新事件立即发送。
- [ ] 实现启动静默、一次提醒、恢复立即发送、第二轮静默再次提醒；被省略的事件仍重置静默时长。
- [ ] 所有通知使用 `DELIVER_STEER` 和 `display: true`；内容带 monitor ID、描述、状态、日志路径。
- [ ] 明确超长有限时间值的分段定时，避免 Node 超范围退化到 1 毫秒；`monitorFlushMs: 0` 继续表示源回调批次直接发送，不把单个输入块拆成逐行唤醒。

验证：假源＋假时钟测试通过，捕获每次 `sendMessage` 的时间、内容和投递 options；不使用真实等待验证 30 秒规则。

### 3. 统一收尾与共享日志保护

- [ ] 所有收尾进入同一协调入口；先切入 finishing 并取消定时，再接受最终输出并消费一次。
- [ ] 自然结束、失败、外部信号终止、显式截止、日志超限都只发一条合并收尾。
- [ ] 显式停止／会话退出不新增尾批或收尾；已经提交的通知不撤回。
- [ ] 在 `notify.ts` 提供小范围的 monitor 输出载荷：有载荷时使用它代替共享 failure-tail 回读，避免再次内联已发送日志；未传载荷的 shell 调用行为不变。
- [ ] 保留 `outcomeSurfaced`、`attachCount`、通知失败记录、`completeJob`、`markTerminal` 和注册表保留的现有归属。
- [ ] 在共享日志大小检测处增加 monitor 自有超量处理回调，默认 shell 处理不变；monitor 回调拥有停止及合并通知，不再紧接一条被动 `bg-stall`。
- [ ] 所有 monitor 都启用 `maxLogBytes` 检查，命令日志包含两流，仅 stderr 增长也可能触发保护；不新增日志轮转、日志总量预算或磁盘写入硬限额。
- [ ] 验证日志保护／截止和真实源结束的交错顺序、最终排空重入、迟到回调，以及 session 替换后不污染新会话。

验证：monitor 收尾测试、共享通知／生命周期测试、shell 超量及失败尾部回归全部通过。

### 4. 参数、配置与文档

- [ ] `tools/monitor.ts` 添加可选 `wake_absent_ms`；`timeout_ms` 也变为真正可选的有限正数，不再默认或截到旧上限；参数验证发生在源启动前。
- [ ] 删除 `persistent`、`monitorDefaultTimeoutMs`、`monitorMaxTimeoutMs`、`monitorRateWindowMs`、`monitorMaxLinesPerWindow`、`monitorMaxOverflowWindows`，以及第 1 步失去用途的 `monitorPollMs`。
- [ ] `monitorFlushMs` 默认改为 30000，保留文件／环境变量覆盖及 0 值语义；保留 `monitorMaxLinesPerEvent`、共享 `outputPreviewChars`、`maxLogBytes`。
- [ ] 不添加旧参数别名、迁移模式、专门弃用警告或用户文件写入。
- [ ] 工具说明和 prompt guidelines 改为默认合并 stdout/stderr、合并可唤醒通知、默认持续监听、可选静默提醒；删除“每行对应一条通知”“只有 stdout 算事件”“需要 2>&1 才接收 stderr”“persistent”“默认截止”等旧承诺。仅保留需要 `2>&1` 才让两流都经过用户过滤器的准确说明。
- [ ] 中文 README 更新后台任务小节：默认合流与管道区别、退出码判断、跨流顺序限制、新参数、30 秒合并、静默／恢复、显式停止、日志保护、有界内容、删除的配置；不要写入 Trellis 开发过程。
- [ ] 中文 PROVENANCE 追加本地 fork 行为变化，保留原上游版本、提交和许可证来源。
- [ ] 重新搜索旧参数及被动 monitor 注释，保留有明确历史说明的引用，避免遗漏类型、测试、README 或运行时 prompt。

### 5. 验证与交付

- [ ] 按下面矩阵完成全部验收，不靠“修改了常量”替代行为断言。
- [ ] 检查 Markdown 链接、JSONL 上下文、`git diff --check` 和产品差异范围。
- [ ] 使用临时 agent/config 目录运行 `pnpm check`，不读写个人配置，不真实执行 `install.sh` 或 pi 安装。
- [ ] 运行 `trellis-check` 独立实现审查，修复有证据的问题；若需求／设计 materially 改变，重新提交用户审阅。
- [ ] 增加后续集成边界回归：absent/resumed 时 Job 仍 running、`outcomeSurfaced` 未被进度消费；pending/timer 存在时 panel/shared-stop 无尾批，资源清理幂等。查看／关闭 panel 不影响调度。
- [ ] 保持 shell、快捷键、input、计数／保留、单入口加载的非 monitor 原断言；不在本任务实施后续的显式-only detach、Down 入口、混合列表或目录重命名。
- [ ] 交付时记录新增源入口、monitor 通知载荷／超量回调和新测试；后续 task 在自己的规划中刷新 baseline，并整组迁移到 process-tasks，不恢复已删除配置和被动通知。
- [ ] 更新本任务验证结果与必要的可复用 spec；完成／归档／提交按会话所有者确认的流程处理。

## 主要文件与风险边界

| 文件 | 预期变化／需保护的行为 |
| --- | --- |
| `extensions/bg-tasks/monitor-source.ts`、`monitor-ws.ts` | 源事件契约、命令双 pipe 合并日志及独立行解析、双流收尾清理；不丢 WS 消息边界 |
| `extensions/bg-tasks/monitor-buffer.ts`（新增内部模块） | 有界前缀、超长行预览和省略统计；不成为独立扩展 |
| `extensions/bg-tasks/monitor-session.ts` | 时间、状态、合并及统一收尾的唯一归属 |
| `extensions/bg-tasks/monitor-follow.ts`（删除） | 确认仅 monitor 使用后删除，不影响 `output.ts` 的日志读取／attach |
| `extensions/bg-tasks/lifecycle.ts`、`monitoring.ts` | 小范围超量处理回调；默认 shell 停止与通知保持不变 |
| `extensions/bg-tasks/notify.ts`、`index.ts` | monitor 载荷不回读重复 failure tail；TUI 显示状态、输出省略和日志路径，shell 渲染保持不变 |
| `extensions/bg-tasks/tools/monitor.ts`、`config.ts` | 直接切换新参数／配置，无兼容层 |
| `extensions/bg-tasks/__tests__/` | 假时钟、源输入和共享回归；不修改真实 `~/.pi` |
| `README.md`、`extensions/bg-tasks/PROVENANCE.md` | 与目标行为同步，不改上游来源记录 |

不改 `spawn.ts` 的 shell 执行契约、快捷键、任务面板交互、注册表回收、manifest 的资源声明或其他 Agent 的任务文件。仅收尾消息内容所需的 renderer 适配不属于交互重写。

## 验收与离线测试映射

| PRD 验收 | 测试归属 | 关键断言 |
| --- | --- | --- |
| 1 | `config.test.ts` | 新默认、显式旧值仍有效、环境优先、0 值、不写配置 |
| 2 | `monitor-session.test.ts` | 首批立即；29.999 秒不发、30 秒发；空闲后到达不额外等待；没有 passive 投递 |
| 3 | `monitor-session.test.ts` | 不启用提醒的安静源长期推进时间也无消息 |
| 4 | 源测试＋`monitor-session.test.ts` | 活动按到达时间重置；缓冲／省略事件仍有效；部分行不算完整行 |
| 5 | `monitor-session.test.ts` | 启动到阈值一次提醒，继续静默不重复 |
| 6 | `monitor-session.test.ts` | 恢复立即发；普通间隔从恢复提交起算 |
| 7 | `monitor-session.test.ts` | 两轮静默／恢复，无重复提醒 |
| 8 | `monitor-session.test.ts` | 待发输出合入 reminder；原普通定时回调不重复消费 |
| 9 | `monitor-session.test.ts`、源测试、`index.test.ts` | 正常／失败／外部信号／截止／超量单条收尾；显式 kill 与 session 退出无尾批；定时交错、排空和迟到回调无重复 |
| 10 | `monitor-session.test.ts`、通知／renderer 测试 | 每条 `display: true`、`DELIVER_STEER`；模型与 TUI 可见标识、状态、日志及省略量；不调用 Agent abort |
| 11 | `monitor.test.ts` | 0、负数、NaN、Infinity 无效；省略关闭；大数分段定时；验证失败时未构造进程／WS |
| 12 | buffer／源／`monitor-session.test.ts` | 两流已接收原始日志保留，UTF-8 独立增量解析，通知省略准确；主 shell exit 不等 EOF，同步读取两个已缓冲 pipe、不编造未知截断量；超长行、空消息、WS 多行均覆盖 |
| 13 | `monitor-session.test.ts`、`monitor.test.ts` | 不传截止，推进超过旧默认与上限仍运行，未安排隐式总截止 |
| 14 | `monitor-session.test.ts` | 显式截止停止、原因与输出一条；同点到期优先；静默只提醒 |
| 15 | buffer／`monitor-session.test.ts` | 大量连续输入不速率停止；每批存储／内容有界，只有一条省略说明；事件继续重置静默 |
| 16 | `config.test.ts`、`monitor.test.ts` | schema／DEFAULTS 无旧字段，无额外兼容路径；普通未知键处理不改写文件 |
| 17 | `monitoring.test.ts`、`lifecycle.test.ts`、`monitor-session.test.ts` | 同一共享阈值和周期；所有 monitor 受保护；一条合并通知、无 passive 超量消息；shell 原断言不变 |
| 18 | `monitor-session.test.ts`、`ui.test.ts`、`jobs.test.ts`、`registry.test.ts`、`index.test.ts`、共享 shell/shortcut/input/manifest 原测试 | absent/resumed 不改 Job 状态／结果标记；共享 stop 清理 pending/timer 且无新消息；查看／关闭 panel 不改调度；非 monitor 交互、计数、会话隔离、加载不变 |
| 19 | `monitor-source.test.ts`、`monitor.test.ts`、`monitor-session.test.ts`、日志保护测试 | stderr-only exit 0 有活动且 completed；stderr 防误静默并能恢复；两流同日志／通知，不串 UTF-8/部分行、不标来源、不固定跨流顺序；管道过滤／显式重定向正确；stderr-only 计入日志超限；exit/stop 清理两个流 |

新增 `monitor-buffer.test.ts` 及命令源测试（可放 `monitor-source.test.ts`）。原 follower 专用测试随废弃模块删除，原速率杀监听断言替换成持续运行和有界内容断言；失败回读尾部的 shell 测试不能改成新 monitor 契约。

## 验证命令

上下文和文档检查在规划阶段即可执行：

```sh
python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-monitor-wake
git diff --check
```

用户批准后，实施期间运行定向测试和全量检查。SDK 读取已有安装，配置指向临时目录：

```sh
pnpm link-sdk
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
trap 'rm -rf "$agent_dir"' EXIT
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
```

定向测试同样使用临时 `PI_CODING_AGENT_DIR`，如 `node --test extensions/bg-tasks/__tests__/monitor-session.test.ts`。新测试主动取消假源、结束真实测试进程并释放定时器，不以全量脚本的 `--test-force-exit` 掩盖资源泄漏。

## 回退与审阅门禁

- 源切换、session 调度和终态协调一起交付，不能只把 passive 改成 steer 后先上线。
- 回退只恢复本任务的产品改动和对应 README／PROVENANCE，不重置其他 Agent 的工作或本会话中文规范调整。不进行用户配置迁移，因此无需反向迁移脚本。
- 最终审阅须指出默认合并 stdout/stderr 但不改变 shell 管道、不把 stderr 判失败、不保证跨流严格顺序；主 shell exit 即关闭两个流观察及可能缺失后续输出、源接收成本、日志保护的周期性质、通知不承诺独立回复及故意不做旧参数兼容。
- 后续任务在本任务交付后开始，重读最终文档和验证结果；不得把其旧研究中 2 秒 passive、`persistent` 或原 follower 的行为重新当作目标。不替后续 task 改文件或提前解决其命名／兼容未决问题。
- 规划检查不代表实现测试通过；用户已批准开始实现，按本计划补齐测试与独立审查后再交付。
