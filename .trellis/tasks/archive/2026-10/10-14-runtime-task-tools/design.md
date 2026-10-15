# 统一运行任务工具接口设计（审阅草案）

## 1. 状态与依据

本文件为用户已审阅并批准实施的技术设计。已确认公开名称、统一管理四类运行任务、subagent可等待、Beautify新接口迁移，以及不考虑任何旧兼容。外部pi-trellis任务已获授权创建（`/Users/jyxc-dz-0101322/tools/pi-trellis/.trellis/tasks/10-14-runtime-tool-names/`），本轮不实施外部仓库或更新当前插件。

依据：`research/runtime-interface-map.md`、`research/beautify-migration.md`、`research/migration-surface.md` 和 preset owning specs。前置 Beautify 已 completed／归档，需保留最新 `clipPlain` 背景 reset 修复。

## 2. 目标架构：统一接口，不统一执行引擎

```text
task-composition（每 activation 唯一 owner）
  ├─ TaskLifecycle / TaskCoordinator / Task UI（原有）
  ├─ runtime-tasks 管理 facade（新增，唯一 task_manage 注册）
  │    ├─ process capability → 原 registry、日志、停止与通知
  │    ├─ subagent capability → 原 manager、terminal、消费与通知
  │    └─ workflow capability → 原 workflow map、worker/control，加 terminal
  └─ Beautify（独立入口，只读取公开返回合同）
```

新增 helper 放 `extensions/runtime-tasks/`，不新增顶层扩展入口。执行注册仍归各 backend，composition 只接收 typed finite capabilities。管理接口不使用 UI 16K detail 替代最终回答，也不通过调用已删除工具复用旧执行。TaskView 不持 promise/controller/session；不新增总任务数据库或全局执行 registry。

process 原 jobs actions 抽到 backend management service，继续调用原 readLogSlice、streamLog、searchLogs、terminateJobSilently、notification retry。agent retrieval 从 index 的现有闭包形成 capability，保留 resolveRef、usage reporting、cancelNudge 与 completion consumption。workflow 单独补齐可检索 terminal handle 与通知 latch。

## 3. 公开工具与旧能力映射

| 新工具 | 功能 | 边界 |
| --- | --- | --- |
| `bash` | 前台／后台命令；保 command/description/timeout/run_in_background | 增补被删除 bash_bg 的有效 notify 选项；不新增后台硬截止 |
| `monitor` | 命令输出／WS 监听 | 源、批次、截止、静默及显式 stop 不变 |
| `subagent_run` | 新建／继续／已有 schedule 能力 | 不改预算、配置、默认后台、isolation 策略或 schedule store |
| `subagent_workflow` | 运行／replay 编排脚本 | 不改 DSL agent()/workflow() 或 opt-in 门禁 |
| `subagent_message` | 给 running subagent 指导消息 | 保 startup queued-steer，执行队列 queued 仍拒绝；不扩大权限 |
| `task_manage` | list/status/output/wait/stop/search/stats | 四类运行任务统一入口；字段按动作／类型验证 |

删除 bash_bg/get_subagent_result/jobs 注册与旧 Agent/SubagentWorkflow/steer_subagent 名称；不保执行 alias、旧名 renderer、旧记录／ID迁移。旧名称历史由 host 原／通用展示处理。上游历史说明不是活跃 prompt，不机械全文改名。

## 4. 身份与 scope

### 4.1 身份合同

采用已有 `{sourceId, taskId, runId}` tuple，不重编号 backend。公开字段：

- `task_id`：后端稳定对象 ID（bash/monitor/workflow 的 ID、subagent 的 record ID），模型文本中必须可见，RPC 返回的真实 agent ID可直接使用。
- `run_id`：当前执行轮次；subagent resume 换 run，其余对象与 task_id 一致。
- `task_type`：`bash | monitor | subagent | workflow`，与内部 shell/agent kind 做明确映射。

target 动作以 task_id 查当前 scope 的唯一对象，歧义拒绝，不靠 ID 前缀猜类型。run_id 省略时，在调用开始绑定当前 run，后续 await 不重解析到新 run；提供 run_id 时必须精确匹配，否则返回 stale。不得对已被回收对象自动重启／读磁盘恢复执行。

启动结果、列表、状态和输出都带上述身份；前台快速完成也返回身份＋原结果。subagent_run.resume 继续以 stable task_id 选 record，新 run 的返回显式给新 run_id。已有后台切换、wait 释放不换 task_id/run_id/PID/session/log；workflow replay 创建新 task_id，不等于菜单暂停后继续。

外部公共 RPC仍返回真实 record ID，channel/envelope/spawn cwd/stop/consume 不因模型工具更名改变。它是当前集成接口，不是旧模型工具兼容。

### 4.2 最小权限与可见范围

- 根 facade 列出当前 root activation 的对象和真实分组关系，包含可见 descendants；列表为 child 标明是否可由当前调用者管理。
- 保持根原 subagent retrieval/message 的 top-level 管理边界；不因统一入口偷偷允许模型读／控制其他 owner 的 nested child。workflow 的管理通过 workflow owner 操作；UI现有细粒度 child detail/stop 保留。
- child facade 可管理自己的 shell/monitor 与现有权限允许的 owned nested subagent；不得读取整个根 registry、root/sibling或其他分支。
- 不聚合任意子会话内部 process 到根管理器；根统一四类指根 activation 拥有的运行对象，不等于系统级跨会话进程管理。
- schedule definition 不是运行任务，仍保既有 menu/store；触发后产生的真实 subagent 可管理。工具返回须区分 definition ID 与 runtime task_id。

这套 scope 是不扩大原模型管理权限的最小方案，最终审阅须确认其可见但不可操作的 child 行行为。

## 5. task_manage 参数与动作

采用一个 provider-friendly flat TypeBox schema，运行时逐动作验证，拒绝不适用字段而非忽略。全局参数为 `action`；target动作需要 `task_id`，可选 `run_id`。列表可选 `task_type`；其余选项只允许在表中适用动作使用。

| action | 目标／参数 | 返回与消费 |
| --- | --- | --- |
| list | 可选 task_type | 当前 scope 元数据、树关系、身份、状态、mode、wait_count；不消费，包含backend保留期内终态，不用UI四秒窗口过滤 |
| status | task_id/run_id | 规范化状态＋原始状态／partial原因、可靠stats、能力与artifact路径；不读日志、不消费 |
| output | task_id/run_id；process offset/limit；subagent verbose | process默认尾页，bytes分页；subagent原最终回答／运行状态，verbose保原formatted conversation；workflow明确标识script return/error＋有界progress日志；成功终态检索由backend消费 |
| wait | task_id/run_id；process limit；subagent verbose | retrieval lease 等整个任务终态；subagent最终回答，bash/monitor状态＋一页尾部输出，workflow script最终返回／error；释放／取消只结束本次等待 |
| stop | task_id/run_id | typed stop请求结果＋观察状态；不承诺所有OS后代／非协作provider已退出；不消费别的run |
| search | pattern，可选task_id/task_type；ignore_case/context | MVP仅bash/monitor日志，保持原regex扫描、hits、1-based行号、每job20条／80字符与context限制；指定subagent/workflow明确unsupported；不消费 |
| stats | 可选task_type | process原activation累计值＋四类可靠当前snapshot计数，标明计量范围；不伪造agent/workflow累计账本 |

默认 output 上限沿用 process outputPreviewChars，offset/limit仍是byte；统一字段使用 snake_case（jobId→task_id，ignoreCase→ignore_case），内部翻译复用helper。subagent最终回答与workflow script return 不用UI preview静默截断；verbose沿用原工具的格式化对话（tool result有200字符省略），不宣称全原始trace。原生JSONL artifact路径与有限progress日志另行标明，不能混成同一“完整答案”。

`wait` 不增加默认超时、不使用sleep/poll替代已有terminal机制。bash/monitor保原tail partial；subagent/workflow先发身份与waiting状态，终态返回答案，不新增实时全量transcript流。外部AbortSignal或全局/bg会返回 `wait_outcome=cancelled/released`，目标不停止、不消费；完成为completed。process终态 tail读取失败明确返回日志错误与实际任务终态，不伪造空日志成功。

## 6. 返回与 Beautify 合同

新工具的 `content` 保模型可读完整数据，身份不能只放 details。管理返回新增轻量公开 `details.runtimeTask` 合同（version=1），只保存不可变元数据：action、task_type、task_id/run_id、原始／规范化status、wait_outcome、title、可靠stats、byte range、省略信息、列表／搜索计数、错误code。正文仍在content，不在details复制全文。

类型／验证器可放 `runtime-tasks/contracts.ts`：仅纯数据与guard，不import backend，不建立执行state。Beautify可依赖此公开合同而不接触manager/registry。合法参数与结果action/identity必须匹配；安全整数／有限duration等逐项验证。未知version、details={}SDK异常、同名异形、无合法metadata仍委托original或通用fallback；不放宽旧text-only guard为任意details。

Beautify将旧两套adapter合并为task-manage adapter，按type/action取主信息、关键状态与尾部次要统计。复用optional/shared/layout的call/result状态、宿主default背景、once padding、mouse边界、宽度预算与clipPlain reset防护。expanded只显示已返回content／当前partial，不额外读文件、请求结果或拼接自造history。wait release/cancel显示target unchanged；stop显示requested/reported，不与完成混淆。

Bash新身份返回需要同步其固定后台信封识别与foreground行数摘要：优先只给details追加身份，background text使用明确合同携带task_id/run_id；formatter和renderer共同验证正文含background关键词不误判。原read/find/grep不改。新启动subagent/monitor/workflow不扩Beautify renderer范围。

## 7. Workflow必须补齐的后端合同

每个WorkflowTask创建时立即拥有按精确identity的terminal promise，覆盖meta/runtime初始化错误、already-aborted、running/paused stop。terminal保存不可变script result/error、实际状态和必要日志快照；actual worker/host drain仍单独由原owner持有，不以terminal冒充执行结束。

补 `resultConsumed`、`notificationDelivered` 与共享wait_count抑制。output/正常wait终态在lease完成callback内先consume再释放抑制；wait取消后重查尚未交付终态并保现有nudge cadence。显式stop封通知并取消source/owned agents/worker，保留日志/journal；late host callback核activation/identity，不发旧通知。

pause/resume/skip/retry原菜单继续可用，不在MVP追加task_manage动作；其中resume pause与replay新run保持区别。replay前置须拒绝running与paused旧run，符合原“必须结束”合同，不改prefix cache算法。

## 8. Child composite接线

不能在child extension注册process-only task_manage、再用nested customTool同名覆盖：实际SDK customTools Map.set会覆盖并丢失process能力。

选择composition-owned唯一facade路线：保现有boolean child marker公开bridge不变，新增独立、短生命周期、AsyncLocalStorage scoped capability handoff（处理实际host不同cwd/jiti graph），由runner加载child时传入有限parent/run owner capability，child composition与本地process capability组合。不在Symbol保存永久root manager，不让renderer/UI读取runtime singleton。scoped handoff只传当前owner授权接口，不传整manager；loader退出清scope，childshutdown释放自己的facade引用，不dispose root。

nested launcher/message customTools保有权限和深度检查；移除旧nested result注入，nested检索经child composite使用共享retrieval lease，父owner停止会使nested执行终止但取消检索只结束wait。no-nested child仍有local process管理；denylist/isolated/noExtensions不自动恢复禁掉的能力。runner readmit/excluded/inScope/beforeToolCall与ToolNames同步，actual same/different cwd loader、late registration、重叠scope及shutdown验证是硬门。

## 9. Bash冗余入口移除

bash_bg独有有效notify:false迁到bash，仅显式run_in_background=true允许；foreground传notify明确拒绝，避免隐式影响超时切后台通知。name映射到已有description。后台timeout沿用现有普通命令不强杀的行为；将bash_bg对不可auto-background命令的安全timeout分支抽到原backend helper复用，不新增普适deadline，不把bash timeout描述成硬后台截止。

删除旧文件／注册与测试中的重复入口，但保其启动失败rollback、真实TERM→KILL、notification suppressed等有效测试到bash后台入口。model指南统一“完成通知用bash，事件流用monitor”，删除互相推荐旧工具的promptGuidelines。

## 10. 外部pi-trellis发布依赖（阻塞最终范围确认）

研究已核外部ordinary tool_call hook只识别Agent，新subagent_run会绕过材料注入／managed执行门禁。这不是仅help旧名。公共RPC本身可保持当前协议，description、provider probe和运行工具门禁须由外部owner同步。

本任务默认不能手改 `.pi/git/` 或生成 `.pi/agents`，也不能自动install/update。用户须选择：将外部维护仓库pi-trellis的必要新名迁移纳入独立关联任务，或保持本任务仅preset、将外部门禁更新作为发布前置且未满足时不宣称当前旧adapter组合完整可用。不靠伪造Agent事件或保旧alias规避。

## 11. 实施阶段、回退与风险

一个任务内分阶段完成，因为公开接口与两后端/child/display为同一可验证交付，不按文件拆成不可独立发布子任务。外部插件更新如纳入，须单独task/owner，不能混进preset提交。

先冻结合同和capabilities并加失败测试，再接process/subagent/workflow＋child，再一次切换公开名称与prompt，最后Beautify/文档与整体验收。每阶段保持已有后台执行、通知、scope/shutdown硬断言；不把中间双注册状态当交付。

回退限定本任务owning diff，保无关README/at-path/.pi并行修改、磁盘日志和journal；不能reset整个checkout、恢复旧文件覆盖别人hunks或删除artifact。风险最高：child接线、workflow通知消费、resume/wait竞态、foreground身份、外部门禁。新API不兼容是用户已接受的产品决策，不追加migration层。
