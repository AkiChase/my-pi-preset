# 运行任务接口与最小统一管理架构研究

## 0. 范围、版本与证据边界

本次仅做规划研究；唯一写入为本文件。不改产品、前置任务、PRD/生命周期、集成、个人配置；不安装、不运行会写临时配置/日志的测试，不提交。

- 本仓库基线：`81e47ddbe5bcd601a440a9f24c98c05d83d9c4a2`；读取时已有并行 `at-path-completion`、README、loader/manifest fixture 和 `.pi` 修改。本报告按当时实际文件，不以旧任务报告代替源码。
- 前置 `10-13-beautify-tool-shell-collapse` **已 completed/归档**，位置为 `.trellis/tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/`。本任务原 `beautify-migration.md` 中“未提交/未归档/无真实PTY”是较早快照，不是目前状态；不在本次改写那个文件。最终展示基线取实际源码及归档 `research/check-report.md`，真实终端后续材料见同目录 `tmux-validation.md`、`terminal-fix-report.md`。
- 外部维护检出 `/Users/jyxc-dz-0101322/tools/pi-trellis` HEAD：`93600d11f23eea049b6a89091fa7edf4d9269fcb`。
- 本项目加载的外部 clone `/Users/jyxc-dz-0101322/tools/my-pi-preset/.pi/git/github.com/AkiChase/pi-trellis` HEAD：`9af75d2f52f78ee932bb31563cc29fe7ce5a9b73`。两份入口不同，耦合点分别注明；没有更新 clone。
- SDK 观察限于现有 Pi 1.2 的实际工具注册实现；不是修改 SDK、安装验证或完整 SDK 审查。
- 下文 `路径:行号` 是读取时锚点；实施时若并行修改移动行号，以列出的符号定位。

### 已读规范

完整阅读 `.trellis/spec/preset/{index,repository-guidelines,extension-guidelines,monitor-contract,testing-guidelines,documentation}.md`，以及 `guides/{index,code-reuse-thinking-guide,cross-layer-thinking-guide}.md`。关键约束：

1. `task-composition.ts` 一次 activation 只有一个 coordinator/lifecycle/UI owner；backends 持执行，不把 promise/controller/session 放进冻结 TaskView。
2. launch wait 和 retrieval wait 分开；解除等待不等于停止执行；只有 backend 消费结果。
3. shutdown 必须所有 backend freeze/disarm → UI close → cancel waits → silent stop → 有界实际 drain → dispose，不能用终态 promise 冒充实际退出。
4. monitor 双流、时间/批次/有界通知/manifest/显式停止均保留；不能重新设计成统一执行引擎。
5. Beautify 只读、可选、未知合同委托，不读取后端私有状态、不额外 I/O/消费。
6. 名称改动跨 registration → prompt → nested tool scope → UI fallback → tests/README；不手改生成 `.pi` 集成或外部包。

### 完整阅读的主要实现文件

- `extensions/task-composition.ts`；`task-ui/{types,coordinator,lifecycle,controls,model,owner,panel}.ts`。
- `process-tasks/{index,state,types,registry,lifecycle,output,log-search,spawn,config,commands,source,notify,monitor-session,monitor-source,monitor-notifications}.ts`，`tools/{bash,bash-bg,bash-params,monitor,jobs}.ts`。
- `agent-tasks/src/{index,agent-manager,agent-runner,types,source,waits,nested-tools,child-context,cross-extension-rpc,output-file,status-note,mention-clone,schedule}.ts`；`workflow/{task,host,runtime,worker-source,journal,tool-description,collisions}.ts`；`ui/workflow-menu.ts`。
- `beautify/index.ts`、`tools/{bash,get-subagent-result,jobs,retrieval-contracts,optional}.ts`。
- `agent-tasks/__tests__/{loading.test.ts,host-loading-smoke.mjs}`；其他测试按目标符号定位，未宣称全部测试全文阅读/执行。
- 外部两份 `lib/subagent-rpc.ts` 全文；两份 `extensions/trellis.ts` 的 session bootstrap、ordinary tool hook 与收尾完整相关段；loaded clone `docs/worktree-execution.md` 全文。外部 provider probe 仅定位耦合。

## 1. 当前对象与所有权：已有统一读模型，尚无统一模型管理后端

| 层 | 实际入口与锚点 | 已有能力 | 不应错误复用之处 |
| --- | --- | --- | --- |
| composition | `extensions/task-composition.ts:15-31` | 创建 coordinator/lifecycle；process → UI/controls → agent；唯一 shutdown；公开 child marker bridge | 目前没有 `task_manage` 注册，不能在两个 factory 各注册一个同名根工具 |
| identity | `task-ui/types.ts:1-17` | `{sourceId, taskId, runId}`；`taskKey()` = JSON tuple；kind=`shell/monitor/agent/workflow` | kind 不等于 source；workflow 与 subagent 同属 source=`agent` |
| frozen views | `task-ui/types.ts:19-63` | 状态、mode、waitCount、统计、artifacts、有限 detail/stop | 不带 final-answer、consume、wait、search、aggregate stats、workflow controls；不能当通用执行 registry |
| coordinator | `task-ui/coordinator.ts:17-87,107-149` | source registration、list/snapshot、按真实 identity 路由有限 detail/stop；wait leases | detail 强制最多16K且非消费；不等于模型 output/verbose；stop 返回 bool 不是实际退出确认 |
| wait release | `task-ui/controls.ts:12-23` | `/bg`、Ctrl+Shift+B 对**所有当前 lease** detach；`/tasks`/Shift+Down 打开 panel | 不调用 ctx.abort，不停进程/agent；并非单任务 stop |
| UI retention | `task-ui/model.ts:4-45`、`panel.ts:44-55` | 终态组显示4秒；选择项保一个终态 preview；新 panel 使用 fresh model | UI 留存与后端十分钟留存不同；panel cache 不能给 `task_manage` 造一个可停止的旧任务 |
| process adapter | `process-tasks/source.ts:8-71` | 同一 registry 里 foreground/background shell 与 monitor 都可见；list、bounded log、silent stop | UI detail 不消费；模型 jobs output 会消费终态；不要把两者混合 |
| agent adapter | `agent-tasks/src/source.ts:12-165` | 根/owned nested/workflow 全部有树关系；startup/queue 无 session 也有身份；stop 精确 run | UI 可以看/停 child，旧根 result/message 工具只允许 top-level；这是权限边界差异而非漏字段 |

Task UI 的显示状态是规范化视图：process `pending→queued`、`killed→stopped`；agent `error→failed`、`aborted/stopped→stopped`、`steered→completed`。**统一结果必须保留原始状态/partial 原因**，不能只返回规范化 `completed/stopped` 而丢掉轮次上限与部分答案的说明。

## 2. 运行身份、继续执行与留存

### 2.1 现有身份表

| 对象 | 后端 ID | TaskIdentity | 继续/重跑 | 会话与历史 |
| --- | --- | --- | --- | --- |
| bash（前台/后台一致） | `b`+8位随机 base36；`registry.ts:12-21`、`types.ts:46-52` | `process, id, id`；`source.ts:9` | 没有 resume；重跑是新 ID；手动/timeout detach **不换 ID/PID/log** | 内存 registry，session_start 清空；终态10分钟、每60秒 sweep；磁盘 log 保留 |
| monitor | `m`+8位随机 base36，同上 | `process, id, id` | 没有 resume；command/WS 都是这个 kind；重启是新 ID | 同 process；monitor manifest 是日志 artifact，不自动恢复管理对象 |
| subagent | `randomUUID().slice(0,17)`；`agent-manager.ts:637` | `agent, record.id, record.runId` | 新建 run=`1`；resume 复用 record/session/id，但 runId 递增；`beginRun:442`、`resumeRun:1166` | manager 只存**当前 run**；旧 terminal snapshot 留给既有 waiter，不是任意旧 run 查询库 |
| workflow | `wf_`+12位 hex；`workflow/task.ts:25` | `agent, workflow.id, workflow.id` | `resumeFromRunId` 创建**新 workflow ID**，引用前 run 的 journal；不是解除 pause | `workflowTasks` 当前 activation 内存 map，无 age sweep；shutdown clear；script/journal 留磁盘 |
| workflow 内部 agent | `wf-agent-N` 是 runtime handle；`runtime.ts:856`附近 | 真正 manager child 是另一个17字符 ID | host `records: runtimeHandle→recordId`，整个 run 保持映射；resume label 复用 child record/new run | `host.ts:177,337-381`；progress 的 `recordId` 指真正 child；不可把 `wf-agent-N` 当模型管理 ID |
| nested `workflow()` | 不创建新的 WorkflowTask/worker/管理 ID | 同一个父 workflow | 单层子 scope、共享 semaphore/counter/abort/budget；`worker-source.ts:355-398,622-704` | phase prefix 标组；不能声称列表已有独立可等待的 nested-workflow 对象 |
| scheduled definition | `nanoid(10)`；`schedule.ts:125`附近 | 不在 TaskSource | 触发产生另一个真实 subagent ID；`schedule.ts:277-363` | definition 恢复与删除/禁用归 scheduler/menu，不是四类运行任务之一 |

### 2.2 现有 resume 语义与必须保留的区别

- `Agent` 的 `resume` 目前只按**原始 agent ID**查 record（`index.ts:2020-2050`附近），不按 handle；`get_subagent_result/steer_subagent` 则 ID 优先、再解析 live handle/alias，`resolveAgentRef:786-791`。
- 根 `Agent` 默认后台，nested 默认前台；`index.ts:1260-1265,1955`附近、`nested-tools.ts:181-191,246-250`。frontmatter 仍决定最终 mode；不能因统一管理强行统一默认。
- `resumeRun` 要求存在 live session 且 `isRunActive(id)` 为 false。`abort()` 先发布 stopped terminal，但实际 runner 未 settle 时 resume 仍拒绝；`agent-manager.ts:1167,1360-1382`。
- `beginRun` 清 resultConsumed/notificationDelivered/new abort link；旧 waiter 捕获 old run terminal，结果文本不被新 resume 替换；`agent-manager.ts:442-473`。
- 旧 terminal snapshot 对 `lifetimeUsage/invocation` 做复制，但 `session` 引用未复制；如果统一 wait 支持 `verbose` 且紧接着有人 resume，`getAgentConversation(snapshot.session)` 仍可能读到新轮次消息。**最终答案文本稳定不等于 verbose conversation 同样是历史快照**，新合同需明确或在完成时捕获所需文本。
- `toolUses/lifetimeUsage/compactionCount` 跨 resume 累计，`turnCount/startedAt/completedAt` 描述当前 run；`resumeRun/startResume:1166-1258`。统一 stats 不得把它们标成全部“本轮用量”。
- 十分钟 agent sweep 只移除已消费、无 active run、无活跃 owner retention 的终态；`agent-manager.ts:1427-1436`。notificationDelivered **不等于** resultConsumed。tombstone 最多100个，只保 top-level handle/sessionFile，**没有完整结果/旧 run 历史**；`tombstone:1408-1425`。
- tombstone 由 `@handle` 可信 mention 路径重开磁盘 session（新 record/new ID），不是旧模型 `resume` 的能力；`index.ts:977-1026`附近。`task_manage` 不应为查询偷偷重启 agent。
- workflow replay 是最长不变**成功前缀**，首个变更/失败后全 live；含 `agent({resume})` 的旧 journal 整体不 replay；`journal.ts:25-35,100-117`、`runtime.ts:628-630,709-717,889-927`。新增统一管理无需改算法。
- `resolveResumeTarget:247-291` 目前只拒绝 `status==='running'`，未拒绝 `paused`，但产品说明要求前 run 已结束。这是现有边缘不一致；不能把 `paused` 当真正可 replay 的 finished run。

### 2.3 ID 设计的最小候选（待主会话/用户选择）

1. **保后端 ID＋可选/明确 runId**：统一入参 `task_id`（名称仅示例）、可选 `run_id`/kind；内部用已有 tuple。raw RPC ID、log 文件名、handle 全保留。小改动；若省略 runId，必须说明是“调用时绑定当前 run”，旧 ID 会指 resumed run；对显式旧 run 拒绝 stale，不能悄悄跳到新 run。
2. **公开 opaque run handle＋原后端 ID**：例如编码现有 tuple，启动和list返回两个字段。精确 run 的 wait/stop/output不会误指新 run；`subagent_run.resume` 仍需 stable agent ID（或明确解码再验证）。外部只返回 raw agent ID 时必须提供唯一匹配解析路径，否则 Trellis dispatch 无法进入新管理工具。

两种都不需要重编号已有后端、持久化新的总 registry 或承诺任意历史 run 查询。raw ID 目前随机/有类型前缀，但跨源唯一不是数学保证；按当前 sources 查唯一匹配、歧义拒绝，比仅靠正则猜 kind 安全。公开 ID 与 handle 是否同一个字段、`@`前缀接受与否都尚未确认。

**启动结果当前不一致**：后台 agent 通常只给 stable ID，无 runId；foreground agent ID 多在 details（模型正文不可见）；快速 foreground bash 返回纯日志无 ID；detached fg agent 才给 runId；monitor/workflow给独立 ID。因此“启动都返回明确运行身份”是**结果合同修改**，不只是改 label。Foreground失败的 thrown error 同样需设计怎样暴露已启动任务身份。

## 3. 旧工具能力逐项映射

下表的新动作是可实施映射建议，非批准的最终 schema。

| 旧入口/参数 | 当前真实行为 | `task_manage` 最小归属 | 保留要求/待定 |
| --- | --- | --- | --- |
| `jobs list` | 当前 registry 所有 job，含fg/monitor/最近终态，按startTime降序；`tools/jobs.ts:168-181` | `list` process facet＋agent/workflow facet | 不能只列后台；保kind/mode/wait/status/ID；根/child默认范围待定 |
| `jobs output {jobId,offset,limit}` | default tail；offset/limit单位**bytes**；范围start/end/size/续页；`jobs.ts:185-227`、`output.ts:65-106` | `output` bash/monitor | 终态读取会标 outcomeSurfaced；running peek 不消费；无输出与超尾 offset有明确返回 |
| `jobs attach {jobId,wait:true}` | live log partial＋等整个job terminal；最终主要是status，**不返回全log**；`jobs.ts:256-327` | `wait` bash/monitor | 保partial/final、全局detach/取消、不停执行；最后是否附一页output待定 |
| `jobs attach wait:false` | 只报当前状态，不读log | `status` | 可移除 attach 的 wait开关用独立动作表达，无须维持假 attach |
| `jobs kill {jobId}` | `terminateJobSilently`，先消费/禁通知，再停止；terminal会错误；`jobs.ts:231-252` | `stop` bash/monitor | 是请求停止/观察终态，不承诺所有OS后代已退出；自然terminal与explicit stop不同 |
| `jobs search {pattern,jobId?,ignoreCase?,context?}` | regex 全log扫描；可一个/全部；每job显示20 hit，每行80字符＋context，总count；`jobs.ts:333-414`、`log-search.ts:45-200` | `search`，至少bash/monitor | 保正则校验/大小写/上下文/路径与1-based行号/省略；不消费；全四类search不是原有能力，需另决策 |
| `jobs stats` | activation累计started/completed/failed/killed/elapsed/avg及live running；`jobs.ts:417-447`、`registry.ts:115-127` | `stats` process facet | totalStarted/terminal counters不受sweep影响；average和elapsed**不计killed**，不是CPU；不可用当前list反推累计 |
| `get_subagent_result {agent_id,wait:false,verbose:false}` | top-level/live ID或handle；运行中返回状态，完成给最终答案/error＋partial；`index.ts:2842-2930` | `output` subagent；纯 metadata新 `status` | 运行时当前工具**无普通partial答案**，verbose才含当前conversation；统一“当前输出”需补定义 |
| `get_subagent_result wait:true` | 捕获run terminal，用coordinator retrieval；completed atomically consume；abort/detach只停等待；`index.ts:2867-2885`、`waits.ts:7-29` | `wait` subagent | 必须返回最终回答，不能替成 source.detail 的16K transcript tail；保released/cancelled且通知仍eligible |
| `get_subagent_result verbose:true` | 活session formatted conversation；`index.ts:2920-2927`、`agent-runner.ts:1347-1373` | `output/wait verbose` | 旧所谓full是用户/assistant文本＋tool名；**每tool result只200字符，无tool参数/完整thinking**；不能误宣传原来能返回全原始trace |
| `Agent` new/bg/fg/resume/name/model/thinking/context/isolation/schedule | 配置解析、pool、transcript、join、usage不应改；`index.ts:1641-2380` | `subagent_run` | schedule不是立即run，不能把definition ID当runtime任务；无模型max_turns（可信manager/scheduler/RPC仍支持） |
| `steer_subagent {agent_id,message}` | top-level running；starting无session queue；live await session.steer；非running含queued拒绝；`index.ts:2932-2994` | `subagent_message` | 与manager.steer不完全一样：manager/menu/mentions可接受queued；是否扩大新工具到queued需确认，不能无声改变 |
| `SubagentWorkflow {script/scriptPath/name,args,resumeFromRunId,title?,description?}` | scriptPath>script>name；立即返回taskID，持久化script/journal；title/description忽略；`index.ts:2520-2697` | `subagent_workflow` | 保显式用户workflow opt-in、saved script、replay、JSON/schema/gate/parallel/pipeline/预算cap；改prompt名不改DSL `agent()/workflow()` |
| workflow result/inspect | tool render看live task；菜单看progress/log/children；notification只有preview；没有模型retrieval/wait工具 | 新 `status/output/wait` workflow | 必须新增真正final-result访问与completion promise，不拿journal或UI预览当脚本return |
| workflow menu pause/resume/skip/retry/child conversation | `ui/workflow-menu.ts:41-151`、`workflow/task.ts:171-201`、`runtime.ts:681-710` | 保菜单；是否额外给task_manage动作待定 | pause只阻止新start，现跑agent继续；resume(pause)≠relaunch(replay)；skip/retry按progress index且只窗口内有效 |
| `bash_bg {command,name,timeout,notify}` | 立即bg；name仅label；notify:false抑制完成；timeout对普通命令**不hard kill**；`tools/bash-bg.ts:23-112` | 删除入口；行为映射到 `bash run_in_background:true` | **notify:false当前bash不支持**；name→description已有；timeout当前explicit bg branch完全不使用，不能假称无能力差异 |

### 3.1 `bash_bg` 不是仅删除 registration

- `bash` 的 `spawnBackground:273-319` 不看 timeout、没有 notify 入参；`bash-params.ts:12-39` 只有command/timeout/run_in_background/description。
- `bash_bg.timeout` 仅在interactive且command不允许auto-background时写timeout marker并TERM；正常命令到期继续，bare长sleep又已被前置guard阻断。不要把这个旧字段误作普适 hard deadline。
- 为满足“有效能力不丢失”，至少要明确 `notify:false` 移到bash的background分支还是批准舍弃；不在研究中替用户决定。timeout需明确保原语义还是单独不扩展；不应借改名把普通bg变成限时强杀。
- 原bash后台结果与 Beautify固定regex绑定，新增ID/label/提示行必须同步迁移 `beautify/tools/bash.ts:4-10`，不能让后台摘要静默降级。

## 4. 等待、取消、消费与真正停止

### 4.1 已有共享等待机理

`TaskCoordinator.registerWait:52-87`：一个lease仅completion/detach/interruption/dispose一项胜出；先移signal listener、删除wait，再同步callback/cleanup，最后发布变更。`onComplete`在wait suppression释放前运行。

| 操作 | launch lease | retrieval lease |
| --- | --- | --- |
| `/bg` / manual detach | 同一次执行转后台，agent转移当前pool lease/移除parent signal | 只结束这个等待，不consume，不改mode |
| parent/tool AbortSignal | stop该launch（bash silent termination、agent stopRun） | 只interrupted，源继续且通知重新有资格 |
| completion | 返回真实outcome并consume backend | 同上；多wait各有计数，不由一个wait清掉其他 |
| activation shutdown | 全部backend先freeze；dispose wait再stop/drain | 不让旧ctx/result callback重新出现；不是复活新activation |

因此新 `task_manage.wait` 应注册 **retrieval**，无论目标原先fg/bg；不得调用`ctx.abort()`、重新launch、把source.stop当cancel，或使用不追踪runId的poll来代替agent terminal。

### 4.2 Process细节

- `jobs attach` 增attachCount、capture donePromise、register retrieval；terminal hook删除donePromise不影响已capture waiter。cleanup分别降计数；取消之后调用notificationRetries；`jobs.ts:271-314`。
- `onUpdate` 首条following说明；随后 `streamLog` 1秒轮询变动tail，最多4096 bytes，**原始partial不含status envelope**；`output.ts:168-225`。新 renderer只能把它解释成wait partial，不能扫描log猜状态。
- `outputAction` 先检查terminal并markOutcomeSurfaced，再readLogSlice；即文件缺失/空输出也会消费；`jobs.ts:195-210`。统一接口若改善“成功读才消费”应明确是行为修订，不把当前事实写错。
- `terminateJobSilently:282-296` 先禁通知/monitor queue/retry，再stop源和actual execution、mark killed、abort timer；explicit stop不flush monitor尾批。
- `Job.donePromise` 是观察终态；`OwnedExecution.done` 是OS main child实际exit；`spawn.ts:14-55`、`lifecycle.ts:93-102,216-247`。TERM→250ms KILL由同一个execution owner；stop期间leader先exit仍清活group，正常exit不kill剩余后代；WS/pending pid0不能signal。
- `wait monitor` 等整个观察结束，不等下一条事件；自然command主shell exit，不等EOF/孙进程；WS close/error/silent close；`monitor-source.ts:125-201`。deadline/oversize有自然原因终态通知，explicit stop无通知；`monitor-session.ts:74-91,142-163`。
- monitor active progress不consume；attach压住terminal时scheduler保存已构造的bounded terminal payload，最后retrieval取消后重挂及时批次；`monitor-notifications.ts:166-181,204-211,240-246`。新wait不能另开consumer截取event，不能消费或重播这些pending。

### 4.3 Agent/Workflow细节

- `registerAgentWait`用`AgentRunHandle.terminal`；`consumeRun`校验source/run且terminalResolved；`waits.ts:7-29`、`agent-manager.ts:507-517`。状态查询不应借UI inspection消费，输出/最终wait消费须保backend单一owner。
- 通知是200ms held followUp/triggerTurn；根 individual/group发送前重查 live runId、resultConsumed、notificationDelivered、waitCount；`index.ts:503-600`、`waits.ts:32-40`。新task_manage若抽出retrieval handler须把cancelNudge/reconsider回调与usage reporting一道交给agent facet，不能只抽formatter。
- `abort:1359-1382` 立即status stopped、清pendingSteers/stream、abort controller/session、递归children、release pool、resolve terminal；**实际run仍可能未settle**。Stop返回可报告request/observed stopped，不承诺非协作第三方provider内部工作被强杀。
- manager shutdown是另一合同：freeze → stopForShutdown → drainExecution → sealHostEffects → dispose；completed retained child也需跑shutdown hooks；`agent-manager.ts:1482-1548`。统一工具不能自己clear map或remove artifacts模拟关闭。
- workflow `runWorkflowTask:2449-2482`当前promise由`own`保存，仅做actual auxiliary drain，没有可按taskId retrieval的terminal/consumed latch。
- `notifyWorkflowFinished:2491-2514`没有workflow resultConsumed/waitCount检查；只有workflowActive和heldnudge。因此新增workflowwait/output要补backend latch与通知重查，否则“wait已经返回完整结果”还会重复nudge。
- `runtime.finish:753-768` abort inflight、releasePause/semaphore、**等worker.terminate后**返回；host callbacks/gate promise可能仍在运行，归`createWorkflowHost own`和composition auxiliary独立drain。Worker实际结束≠全部host promise实际结束。
- workflow stop现在source.abortController＋owned records manager.abort；最终`killed`在runtime退出后completeWorkflowTask发布；`source.ts:145-153`。如果开等候，需要创建launch当刻completion handle，覆盖badargs/meta/runtime启动失败、already-aborted、running/paused stop，不靠metadata polling。
- `workflowResultText:231-236`是error/string/JSON serialized return，**不同于**progress logs，**不同于**journal（settled agent calls）。统一 `output` 应把这些通道明确标识，而非把16Ksource preview当最终结果。

## 5. 子会话与 nested 工具：不能只替换四个字符串

### 5.1 当前实况

- `agent-tasks/src/index.ts:335-341` 首先 `inChildSessionContext()` return：child不会再造root AgentManager、RPC、scheduler、workflow command。
- **composition没有整个child return**：先建立独立process backend/UI/coordinator，agent factory才跳过。actual loader fixture明确child仍有`bash/bash_bg/jobs/monitor`；`host-loading-smoke.mjs:41-45,74-86`。这些child-local shell/monitor属于child自己的registry/source，不自动汇入root coordinator；根panel看到agent tree，不等于看见每个agent内部的全部process。若要求root `task_manage`也跨child管理这些process，需要额外受控source bridge，当前并无此能力，不能宣称改名后自然获得。
- `child-context.ts:7-42`在Symbol里共享**只含boolean的ALS marker**，处理same/different cwd fresh jiti graphs；不是跨会话runtime singleton。现有公开 `runInChildSessionContext` bridge须保留。
- nested三工具通过SDK `customTools`注入；`nested-tools.ts:50,146-424`，ownership只认`record.parentAgentId===parentAgentId`。根结果/message拒owned child，nested拒其他branch/root/sibling。
- nested result现有参数只有agent_id/wait，无verbose。wait用abortable queue轮询/record.promise，**没有coordinator retrieval lease，不consume，也不受父/root `/bg`统一解除**；`nested-tools.ts:364-389`。后台nested被owner finish/stop递归停止；不可把它变成独立可无限存活top-level。
- Nested允许types/depth/default fg、禁止模型max_turns、配置root/work cwd与output_transcript不变；`nested-tools.ts:198-244,292-333`。
- 三道scope都需迁移：`SUBAGENT_TOOL_NAMES`/`EXCLUDED_TOOL_NAMES:agent-runner.ts:39-48`；`readmitToolNames:959-963`；registry allow/deny `997-1027`；live inScope/beforeToolCall `250-301`。只改registered名字会泄露根工具或block新nested工具。
- 若把`task_manage`直接放入agent exclusion list而没有child-local例外，则**不开nested的child也丢掉原jobs对自身bash/monitor的管理能力**。

### 5.2 已核实的同名覆盖陷阱

现有SDK `dist/core/agent-session.js:2846-2895`把extension registered tools在前、SDK customTools在后，逐个`Map.set(name,tool)`，故同名customTools会覆盖extension工具。`ExtensionToolContext`公开`tools/executeTool`只指当前可调用registry，`dist/core/extensions/types.d.ts:269-280`。

所以“child composition注册一个process-only `task_manage`，nested再注入一个agent-only `task_manage`”**会丢失process管理**，不是自动合并；`ctx.executeTool('task_manage')`会递归调用当前覆盖工具，不能找回原process handler。

### 5.3 最小可实现路线候选（均需actual child-loader测试）

**路线A：每个child只注册一个composition-owned composite manager**

- child保自己的process facet，root manager只提供这个parent/run的owned-agent facet；composition的task_manage把它们合并。
- 需新增一次**明确的scoped capability handoff**，把owner-scoped facet接到child composition；不能读取`Symbol.for('pi-subagents:manager')`获得整个root，不扩现有boolean ALS为永久runtime singleton。
- 例如runner提供每child私有registration callback，经加载期短生命周期bridge注入/登记，composition不重复造agent backend；callback退役时清引用，childshutdown只释放自身facets，不dispose root manager。完整数据/生命周期须先设计。
- 优点：一个注册，child-local wait owner自然一致。代价：改当前child handoff合同及其规范/loader seam；不能当作“简单改名”。

**路线B：保SDK customTools，但注入完整child composite `task_manage`**

- runner创建注入工具时持有owner-scoped subagent facet；child process factory在本child加载期显式回传自身有限management capability，composite才支持两类。
- 没有process extension时不假造process tasks；nested off仍要保child-localprocess管理；isolated/noExtensions不凭新接口恢复禁掉的extension能力。
- 优点：沿用现有nested customTool gate。代价：仍需scoped process capability接线，不能依赖同名覆盖或绕过permissions调用“丢失的原工具”。要验证async后注册/不同cwd/denylist。

根会话facade本身小；**child-local process＋owned nested在一个工具中的接线是实施计划必须独立验证的一项**。不建议为了避开它保留旧jobs/独立subagent_result，或让child看到整个root任务。Root是否可通过task_manage操作workflow/nested children、是否只看组但通过ownercontrol停止，属于产品范围选择；backend现有UI支持并不自动授权模型同样权限。

## 6. 最小根架构：统一接口，不统一执行引擎

### 6.1 建议复用边界

```text
一次 task-composition activation
  coordinator / lifecycle / UI（保留）
  runtime management facade（新增一次注册 task_manage）
    process management facet -> 同一 BackgroundRegistry + lifecycle/log helpers
    subagent management facet -> 同一 AgentManager + run/wait/notice/usage闭包
    workflow management facet -> 同一 workflowTasks + completion/control/notice闭包
```

- `TaskCoordinator.list()/TaskIdentity/taskKey`可直接提供统一metadata/identity来源，保真实parentKey。
- management接口通过**typed finite capabilities**注入，不能把reg/manager/workflowTask公开给renderer/UI。
- process旧actions是`tools/jobs.ts`私有函数；最低成本先抽为backend management service/exports，再由新tool解析/路由；保log search/stream/notify/stop逻辑，不从工具注册表调用已删除jobs。
- agent retrieval formatter目前也是`index.ts`闭包；以typed factory/options registration callback交给composition（如`onManagementBackend`，名称仅示例），保resolveRef、reconsider、cancelNudge、showCost、withUsageReporting，不把4125行index全重写。
- workflow只补run terminal handle、resultConsumed/notificationDelivered、retrieval lease，reuse`workflowResultText/control`；不改worker DSL、gate/replay/semaphore/schema算法。
- `status`/`list`应只快照metadata，`output`/`wait`各backend明确是否consume；没有能力的action明示unsupported，不把不存在动作伪装成empty成功。
- 管理facade admission随lifecycle关闭，callback/await后验activation和run identity；unregister/dispose只清facade自己的订阅/引用，不拥有执行cleanup第二份。

### 6.2 两种接口形状候选

1. **统一flat schema＋每action精确运行时校验**：action包含list/status/output/wait/stop/search/stats，通用task ref，offset/limit/verbose/pattern/ignoreCase/context按适用type拒绝/说明。最接近旧jobs，TypeBox/provider接受度高；不能让忽略字段看似生效。
2. **discriminated action schema**：每action/type参数清晰、required依赖编码到schema；减少错误，schema更长/需确认当前model/provider union支持。外层公共action一致，后端仍有限facets。

搜索最小覆盖原process logs，agent/workflow若要新增search可另给结果文本/日志artifact scope；stats最小可type分组列已有process累计＋可靠snapshot counts，不把缺失agent累计counter当0。无需另设持久化管理任务数据库、重做TaskPanel或复用Trellis规划task生命周期。

### 6.3 结果合同与Beautify

**必须先冻结新结果合同，再迁移renderer；名称替换不足以完成本任务。** 最小选项：

- 选项1：继续text-only+details undefined，每action固定头部携带task/type/status/run/wait outcome与可靠stats，正文无歧义delimiter；迁移成本低但仍有description/任意log伪装header的固有限制。
- 选项2：text为模型可读数据，details带**有版本判别且有限的返回快照**（如task kind/identity/action/status/waitOutcome/range/stats）；renderer只校验此公开结果合同。减少跨类型regex歧义；不是读取私有registry，也不是把details当模型唯一ID来源。

这只是合同选项；未决定版本名、字段名、模型字数/默认分页、error shape。

## 7. Beautify迁移清单：保成果，不改执行

| 已有owner | 真实合同 | 新接口必须覆盖 |
| --- | --- | --- |
| `beautify/index.ts:14-19` | resolver匹配read/bash/find/grep＋两个optional名称，next动态 | 新task_manage adapter；历史旧名展示是否保留resolver分支与执行alias是两件事 |
| `tools/get-subagent-result.ts:7-27` | 仅agent_id/wait/verbose合法参数、single text、details undefined、固定metadata头；description可多行；partial降级 | 新type/action/ref/header合同、description/ID、状态/可靠duration/usage、notfound、released/cancelled不报stopped |
| `tools/jobs.ts:3-73` | list/output/search/stats/attach/kill分动作guard；byte safeinteger、sum safeinteger；attach rawpartial只following/waiting | 七动作与bash/monitor/workflow/subagent分type；wait partial/final；stop requested与waitreleased分开；范围/省略、search、统计 |
| `tools/retrieval-contracts.ts:5-19` | unknown字段/类型/details envelope严格拒；number有限；SDK thrown error details={}未知 | 不为单行接受任意{}；新版本details若采用需独立完整guard；未知格式委托original |
| `tools/optional.ts:30-120` | percall namespaced state；original call/result lastComponent分槽；已有result延迟到本轮renderResult；self/default shell区分；padding mouse不展开 | 原机制可复用，不能因新tool扩大I/O/执行/消费；只展开实际已返回全文；未知无original有bounded generic fallback |
| `tools/bash.ts:4-10` | 匹配**完整单行**旧background信封 | 移除bash_bg/newbashhandle后同步；正文含“background/ID”不误识别；Read/Find/Grep原成果不改 |

新workflow output/wait的摘要必须基于新结果快照，不直接看workflowTasks/live state；workflowscript的return、progress、journal通道明确。保持pending/success/error背景整行、主信息优先、secondary逐字段省略、显示列宽、once padding、partial→final、未知dynamic/history委托。

不新增`subagent_run/subagent_workflow/subagent_message/monitor`启动Beautify renderer；不改归档历史报告中的旧名。

实际回归入口：`beautify/__tests__/{retrieval,registered-agent,shell-collapse,tools}.test.ts`与`renderer-host.mjs`；registered-agent测试验证真实执行结果不变/不额外读consume；host-loading-smoke的tool集要迁移但保root/child全部硬断言。

## 8. 外部pi-trellis耦合：只定位，不修改

### 8.1 与模型工具改名无关、应该继续保持的公共RPC

本preset provider：`agent-tasks/src/cross-extension-rpc.ts:102-205`、`index.ts:718-893`。

- channel仍是`subagents:rpc:{ping,spawn,stop,consume}`及`:reply:<requestId>`，envelope success/data或error，ping.version=2。不是`Agent`工具调用，不应跟模型工具改名改RPC协议名。
- spawn经spawnTopLevel清`parentAgentId/workflowId/depth/maxSubagentDepth/configCwd/rootSessionId/resumeSessionFile/reclaim/blocking`，允许公开`options.cwd`，valid absolute directory；model string规范化/作用域检验。
- manager区分working cwd与configCwd：customcwd在目标实际工作，但配置从parent ctx.cwd加载；`agent-manager.ts:95-113,768-788,848-858`。
- RPC awaitStartup只等startup不等terminal；queued可能暂时无startup promise而先返回ID；仍以真实ID/terminal事件追踪，不发第二个管理ID替代它。
- stop仅top-level、拒owned children；返回成功表示manager接受stop，**不证明actualrunner结束**。
- consume用于已settled result suppression；是外部显式消费，不应在task_manage list/status自动调用它。
- `Symbol.for('pi-subagents:manager')` registry entry只有waitForAll/hasRunning/spawn/getRecord，首owner并仅top-level getRecord；它不是通用task_manage接口，不新增process全局singleton。

### 8.2 loaded clone耦合锚点

以 `.pi/git/github.com/AkiChase/pi-trellis/` 为路径前缀：

- `extensions/trellis.ts:974-984`：只认tool.name==='Agent'的缺失提示。
- `extensions/trellis.ts:1072-1105`：ordinary `Agent`专用材料注入、临时isolation拒绝、managed target/bound task拒绝、失败fallback；改名而外部不迁移会**跳过这些检查**，不只是提示过时。
- `lib/subagent-rpc.ts:32-37`：公共RPC correlated请求；`68` description仍推荐get_subagent_result/steer_subagent。
- `lib/subagent-rpc.ts:93-96`：stop接受task、取execution.agentId并RPC stop；不立即release occupancy。
- `lib/subagent-rpc.ts:111-138`：ping、lock、material recheck、`options:{cwd:binding.worktreePath,isolation:'off'}`、真实rawagent ID、early completed/failedrace、unknownstartup保留占用。
- `docs/worktree-execution.md`：明确真实ID复用原结果/message、停止只是请求、worktree可选、main在source；无自动安装/advance/cleanup。

### 8.3 外部维护检出耦合锚点

以 `/Users/jyxc-dz-0101322/tools/pi-trellis/` 为路径前缀：

- `extensions/trellis.ts:909-922`同样只认Agent；`1003-1017` unsupported runtime的bash/bash_bg/monitor和Agent gate；`1026-1063`ordinaryAgent注入/managed边界及失败fallback；`1067-1083`tool_result刷新覆盖三shell工具。
- `lib/subagent-rpc.ts:15-21,52,115-141`：同样公共RPC/rawID/旧结果message说明。相较clone新增verifyRuntime/adapterConfigured异步等，但工具名耦合未移除。
- `tests/provider-contracts.mjs:121-133`主动查旧get_subagent_result/steer_subagent并调用，真实providerprobe迁移后需要新接口支持同一个rawID，不依靠旧alias假绿。
- 外部规范 `spec/extension/{session-and-context,worktree-lifecycle}.md`和包资源workflow/skills的ordinaryAgent用法需由其owner后续同步；历史plans/archive研究保持历史。

**发布协调点**：本task不修改外部。旧外部hook只认Agent而本preset只注册subagent_run，安全门禁会漏ordinary新入口。要么由外部owner先/同时支持新名并更新提示/测试（loadedclone需用户明确更新），要么明确暂不使用该旧adapter组合。不能为“兼容”在preset偷偷伪造tool_call为Agent、私改clone、自动install，或保重复旧执行工具而不让用户决定。

## 9. 必须留给产品规划确认的决策

以下是尚未解决的选择，不由研究替用户做：

1. 旧执行工具alias是否完全移除；旧名历史Beautify展示是否单独保留，多久/哪些历史格式。
2. task ID raw/opaque、stable agent ID与run ref、handle/alias接受范围、省略runId指当前还是必须精确；是否查询任意旧run（目前无backend支持）。
3. 根task_manage默认是否含owned descendants，能否stop/output这些child；nested只ownerbranch与child-localprocess应保安全边界，不能推成全root。
4. 统一output的subagent current text vs formatted conversation vs `.output`原始JSONL；默认全文/有界/分页单位；verbose原200char toolresult省略是否继续。workflow finalreturn vsprogress/journal怎样选通道。
5. wait各type finalpayload：subagent必须finalanswer；bash/monitor保旧status-only还是附一页输出；是否支持progress partial、等待超时/释放结果的字段/词汇。monitor已明确等整个监听结束。
6. `bash_bg.notify:false`迁到bash哪个适用mode；旧timeout边缘语义是否保留；不自动增加普适hardkill。
7. search仅原bash/monitor日志还是扩到agent/workflow；stats分类型现有累计+snapshots还是新跨源累计账本；禁止重复计算owner/children。
8. workflow pause/resume/skip/retry保持UI即可还是新增管理动作；pause-resume与replay-resume命名要分开；修paused replay旧边缘是否纳入。
9. 新返回text固定信封还是版本details快照；错误、notfound/stale/unsupported、stop请求状态怎样表达。
10. `subagent_message`严格running保旧合同，还是接受queued（backend已有menu行为），是否绑定精确run。
11. 外部pi-trellis改名门禁/文案迁移的owner与交付顺序、真实clone升级何时由用户授权。
12. schedule定义不属于四类运行对象，是否只保菜单/提示明确definition identity，还是以后另任务纳入管理；不能把定义取消与停止其某次执行混淆。

## 10. 后续验证最小矩阵（计划建议；本次未执行）

- registration：根集合恰为bash/monitor/subagent_run/subagent_workflow/subagent_message/task_manage；无旧启动/管理重名；workflowoff/disablednested/isolated/lateextension保持范围。
- root/child：实际hostsame/differentcwd loader、overlappingALS、childshutdown不删root；无nestedchild仍可管理自己的bash/monitor；nested开只管ownbranch不看root/sibling；自定义task_manage不覆盖丢processfacet。
- identities：fg/bg/detach同execution不变；新/resume/queue/startupfailed均有ID；旧runstop拒绝；wait完成与resume同tick返回旧answer；verbose snapshot语义验证；rawRPC ID与新taskref互通。
- management：所有旧jobs search/context/count/page范围/stats、subagentverbose/errorpartial/handle、workflowreturn/log/replay/control均有明确映射；status/list不consume，terminaloutput/finalwait一次consume。
- waits：四类multiplewait、alreadyaborted、`/bg`/trueEsc/complete同tick、waitpartial→final、cancel重查heldnotice、workflow启动失败/pausedstop都结束；不把waitrelease渲染stopped。
- stops：processactualTERM→KILL/WSclose/fd/timer释放、monitor显式无尾批、agentownedchildren/pool/queued/startup、workflowworkerterminate＋hostgateabort/latecallback、协作式provider限制；不以metadata终态冒充实际drain。
- notifications：保持processsteer、agent/workflowfollowUp、groupheld/usage、workflowwaitconsume禁重复nudge、manifest失败/overflowrecheck/log保留、不重播旧activation。
- Beautify：新type/action合同、byte范围/safecounts、error{}未知、dynamic/history/absentoriginal/throwingoriginal、same-roundpartialfinal、self/default一次padding/mouse/连续背景、原四类regressions无新增I/O。
- 外部：RPCping/spawncwd/missingdir/stop/consume/rawID、ordinarynewname材料门禁与Trelliscontext、unsupportedruntime拒绝；不修改SDK或生成集成来让测试过。
- 完整检查按testing-spec只读已安装SDK＋隔离agentdir；自然退出定向/全量与strict分开报告。真实CLI/PTy须主会话明确授权、临时隔离、按前置最小matrix；不拿本研究或旧终端报告当新task_manage验收。

## 结论

最小可实施统一是**composition一次注册＋三组有限backend管理capability**，复用既有tuple身份、coordinator retrieval lease、backend consumption/stop/retention，补workflowterminal/通知消费，不合并执行引擎。

主要必做增量不是四个rename，而是：`bash_bg`有效选项迁移、fg身份返回一致化、workflow模型output/wait、childcomposite接线与scope、旧Beautify合同按新type/action迁移，以及外部ordinaryAgent门禁改名协调。ID/权限/输出默认/额外controls等产品选择以上均保留未决。
