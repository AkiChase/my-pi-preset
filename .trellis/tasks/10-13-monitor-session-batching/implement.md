# 实施计划（已获实施批准）

## 0. 前置门禁

- [x] 与用户确认整批容量／公平性和通知提交失败语义：共享输出预算、来源公平分配、保留 metadata，不新增自动重试。
- [x] 确认 min(200ms, monitorFlushMs) 的小间隔兼容规则。
- [x] PRD/design/implement 已评审，用户批准开始实施；validate 后 task.py start。
- [x] 在当前 main 工作区实施；保留现有 4 个无关 `.pi` 改动，不得混入本任务提交。

## 1. 红测与调度底座

- [x] 添加 monitor-notifications.test.ts，假时钟验证首批跨源合并、固定截止而非 debounce、普通刷新共享时间、无空消息、及时事件提前刷新带走 pending、F=0、小 F、巨大 timer、发送重入和取消。
- [x] 增加 actual monitor-session 的多源通知红测，记录既有独立时钟产生多条通知的失败证据。
- [x] 添加 registry-scoped monitor 调度器；按设计持有一个刷新 timer，freeze/reset/dispose 有明确 owner。

## 2. Session 与终态接入

- [x] monitor-session 去除独立普通通知时钟，保留每源 deadline/silence/event arrival 与缓冲。
- [x] timely transition 与自然尾批接入同一调度器；保留短窗口状态转换，不因内部 terminal abort 丢尾批。
- [x] notify.ts 提取必要的终态资格／commit helper；shell 发送时机及正文不改变。
- [x] 覆盖 attach/outcome/last-wait cancel 与 delayed terminal 竞争；setup rollback、显式 stop、shutdown 清对应 pending。
- [x] index session_start fallback 和 lifecycle freeze 同步释放队列，迟到回调不得复活。

## 3. 内容与渲染

- [x] 按评审容量方案实现 batch preview，正文/details 共用有界载荷、省略元数据和来源日志路径。
- [x] 多来源一次 steer 投递；renderer 兼容既有单条消息与新 batch，清终端控制符并按显示宽度截断。
- [x] 更新实际工具描述／config 注释，不新增未经批准的配置字段或写真实配置。

## 4. 文档与审查

- [x] README 同步首批短窗口、会话级间隔、及时刷新和 F=0 语义。
- [x] 更新 monitor-contract、provenance 对应行为，保留 source/log/OS ownership 和 shell/agent 排除项。
- [x] trellis-check 独立检查任务验收标准、行为竞争与既有 hard regressions；发现两项可修代码问题已修，容量策略缺口仍须主会话／用户决定，不能视为全部验收通过。
- [x] 必要修复后重新全量检查；更新可复用规范，不把任务细节当全局规则。

## 5. 验证命令

所有命令使用真实只读 SDK 路径、临时 PI_CODING_AGENT_DIR，测试离线，不启动在线模型，不 install/reload 个人环境。

```sh
node --test extensions/process-tasks/__tests__/{monitor-notifications,monitor-session,monitor-buffer,monitor,config,index,activation,waits}.test.ts
node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts
pnpm check
git diff --check
```

定向回归不使用 force-exit，验证 timer/socket/fd 自然释放。pnpm check 按 testing-guidelines 的隔离命令执行。

## 6. 回滚与交付

- 回滚整个会话调度／渲染变更及同步文档，不保留旧每源节流和新共享节流同时工作。
- 仅暂存本任务拥有的文件／hunk，提交前检查无关改动不进入 staged diff。
- 不自动 push、安装或 reload；按 Phase 3 的用户授权与工作流完成提交／收尾。

## 实施结果与验证（2026-10-13）

- 新增 BackgroundRegistry 拥有的 monitor-notifications 调度器，普通刷新一个 timer；session 仅保留事件到达／deadline／silence／source 清理。共享决策订阅在发送前核查同点 deadline/silence，避免 timer 插入顺序让 progress 抢先。
- 首批／timely 用固定 min(200ms,F) 窗口，F=0 直接；timely带走可发送 pending，成功提交重计共享 interval。多源一次 steer+triggerTurn，正文/details共用公平裁剪预览；有界转换顺序和来源metadata保留。
- 自然 completion 的 abort 不丢尾批；attach／消费／取消／shutdown／reset／sweep 清有限通知 owner。回调重入前移出快照，新活动留下一批；失败不自动 replay／retry，terminal保留查询和原 retrieval 重查。
- README、config/tool说明、monitor-contract、testing-guidelines、provenance 同步。未改 task-ui、agent、dependency/config字段或无关 `.pi` 文件。
- 独立 trellis-check 必须由主会话派发；本 implement 子代理未派发、未声称通过。后续主会话已派发，完整结果见 [research/check-results.md](./research/check-results.md)：修复 decision reset 丢新 timer 和 unknown 异常转换再抛；最终142/142定向、503/503三模块自然退出、strict＋563/563全量及563/563全量自然退出。整批metadata无硬上限的要求缺口仍开放。

验证命令均使用只读 installed SDK 1.2.0（link-sdk linked0/7）和临时 PI_CODING_AGENT_DIR，离线，无 install/reload/model执行。

| 检查 | 实际结果 |
| --- | --- |
| `node --test --test-name-pattern='session batch:' extensions/process-tasks/__tests__/monitor-session.test.ts`（修改前） | 0/1，断言首窗无发送时实际2条；证据见 research/red-session-batch.log |
| 定向9文件命令（上文） | 最终136/136自然退出 |
| 三模块自然退出（上文）初次 | 493/494，未改的 task-ui/editor.test.ts:208 的 Date.now()-3999 边界出现1ms竞态 |
| 三模块原样复跑 | 494/494自然退出；最终再跑497/497自然退出 |
| `pnpm check` 最终 | strict typecheck + 557/557；既有package test脚本含force-exit，另跑全量自然退出证明 |
| `node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"` 初次 | 556/557，仍仅未改task-ui/editor.test.ts:208同一1ms边界；未修改task-ui |
| 同命令原样复跑 | 557/557自然退出，无force-exit |
| Markdown相对链接／`git diff --check` | 交付前检查，结果见 research/implementation-results.md |

实现中首次 Node strip-only 运行发现新增参数属性不支持（ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX），已改显式字段；初次strict发现monitor notification state不属于JobStatus，已用局部terminal谓词。旧立即发送断言按批准短窗更新；真实renderer窄宽会产生SDK SGR reset，测试保留SGR，仅禁止外部control。以上均为开发迭代，非红测产品证据或最终未解决错误。

未执行提交／stage／push、task finish/archive或安装。仅保留 working diff 供主会话独立审查；未动原4个.pi改动。

## 用户追加批准的硬容量修复

- [x] 独立内部64KiB通知上限（正文/details≤63KiB，预留1KiB信封），保留共享公平preview预算；有界前缀与同载荷正文/details。
- [x] 同logDir、uuid+wx+0600完整JSONL metadata，逐来源／字符串分块写；无需SDK runtime/global singleton/config/admission。
- [x] 单条可见省略数量/路径；超长不可表示路径与保存失败诚实提示，未保存省略terminal不消费，不杀监听/自动retry/replay。
- [x] actual helper 1500终态及actual factory两个350批次(capacity1)，独占session隔离、query、transition/consumption、短写/失败/fd/cleanup/renderer，保留前check的重入与恶意unknown修复。
- [x] README/spec/tool/provenance同步；离线验证与反向红证据见 [research/capacity-results.md](./research/capacity-results.md)。
- [x] 主会话对本轮追加代码重新独立check：检查全部task diff并修复普通临界批预选／原异常inspect再次抛错，strict＋579/579全量自然退出、158/158定向、519/519三模块自然退出；证据追加于research/check-results.md，原容量blocker闭合。

前文metadata无硬上限为追加批准前的审查记录，不代表本轮最终实现；上一check绿色不替代新实现审查。
