# 阶段 2B 交接：agent backend waits 与只读 source

## 范围、所有权与当前结论

本段只实施 AgentManager/new/resume/queue/startup/pools、Agent/result tool wait、backend 通知与只读 agent/workflow source。沿用 composition 已注入的同一个 TaskCoordinator，未改 coordinator 行为或 process 核心；`task-ui/types.ts` 仅增加具体 readonly token/tool/model/workflow stats。没有创建第二 production/global UI，没有委派其他 agent、commit、task lifecycle、install/reload 或真实用户配置改写。

child-context namespaced ALS、source-loader、host loading/rootOnlyEvents hard assertions 未修改。process exception 修复由另一 agent 完成；最终 full check 包含其实际工作树，不把 process diff 归于本段。

阶段 2B 的自动离线 gate 已通过，G2 整体及下一阶段仍由主会话独立核对决定。完整 epoch/最终 panel/TUI 没有完成。

## 实际 API：给阶段 3/4

### AgentManager

`extensions/agent-tasks/src/agent-manager.ts`：

- `getRun(id): AgentRunHandle | undefined` 返回 frozen `{ identity, terminal }`；`identity={sourceId:"agent",taskId:id,runId:<execution revision>}`。terminal 从 spawn/resume 准备时即存在，包含 queue、worktree starting、failed startup、stopped，不靠出现 session/promise 后才轮询。terminal outcome 是 backend record 的浅快照，并复制 usage/invocation，不能让后续 resume 改写上一 run 的 result。该 API 是 backend wait seam，**不是 UI view**。
- `record.promise` 也立即建立，为既有 nested/workflow/RPC result 调用保留。`awaitStartup` 是 legacy startup-only failure 接口，失败 entry随 record 回收。
- `resumeRun(id,prompt,signal?,options?)` 同步准备新 run，真实 session 复用，新 controller/promise/revision/admission；旧 run 未 settle 时拒绝，包括已经 stopped 但 runner 尚在退出的窗口。`resume`/`spawnAndWait` 保留 legacy public 方法；foreground legacy 方法完成时消费，但 root Agent tool走 leased helper而非 untracked inline resume。
- `detachRun(identity)` 同步解除唯一 tracked parent signal link（覆盖 queue/startup/running），标 background/unblocking，迁移原 queued pool 或已 charged current pool；running fg 遇 bg满允许 transient exceed，后续 bg排队。同一 run不重启，completion释放 CURRENT lease一次。owned children不占顶层 pools。
- `stopRun(identity)` 仅当前 revision可停，`abort(id)` 停该 run及嵌套 descendants；queue立即 settle，startup/running立即解开 terminal，实际 cleanup/admission release仍等执行 settle，不允许马上 resume覆盖旧controller。
- `subscribe(listener)` / `notifyChanged()` 由 lifecycle/activity/text/usage/model/metadata更新；observer错误隔离。`setOwnerRetention` 由 source配置 active owner child保留，不让 sweep吞未消费结果。
- `freezeAdmission()` 是一次关闭 admission hook；无 reopen。阶段3应先 freeze旧 manager、冻结外发/epoch，再停止旧执行，构造新 session backend；不可把当前 factory保留manager的 session_start 当作完整换代实现。
- `abortAll()` 暂停 drain、先停 queue再停 running，解开所有 terminal；`dispose()` freeze/abort并释放当前 source/cleanup timer/session。startup迟到完成的完整 epoch/worktree有界 await仍属阶段3，**此 API不等于 AC9已经通过**。
- `AgentManagerDependencies` 仅 typed runAgent/resumeAgent/createWorktree/cleanupWorktree/worktreeEnabled 离线 seam，生产默认仍用既有 runner。`AgentTasksOptions.managerDependencies?` 转发此 seam，测试实际 manager/factory而非另造 backend。

### Shared wait 接入

`src/waits.ts` 导出 `registerAgentWait(manager,coordinator,run,kind,signal?,reconsider?)`：

- launch 的 onDetach转移原 run、onInterrupt/onDispose停原 run；retrieval不改 execution且不stop。
- terminal调用 `lease.complete(outcome)`；winning completion 的 `onComplete` 在wait suppression释放前消费run。
- cleanup只有 notice reconsider微任务，inline timer由tool finally拥有；多个 retrieval由coordinator count独立计数。
- Agent tool注册launch在首次await前（含queue/startup/resume），detach返回原 Agent ID+Run ID，后台activity/transcript继续。不定时detach、不abort主turn、不spawn replacement。
- `get_subagent_result(wait:true)` 使用retrieval，starting/queued也等terminal；已abort signal立即取消。wait:false只peek running/queued，不消费。返回completed output之后result consumed；取消或detach terminal竞争重新考虑通知。
- inline UI/update与旧widget/status sink失败被隔离，不能阻断强制controller/lease/timer清理或已消费结果返回。transcript wiring失败时停止已启动run、释放lease，已生成文件不删。

### Backend 通知仍保持上游所有权

consumed / activewait suppression / notificationDelivered 分开。`canDeliverAgentResult`检查current record/run、真实settle、consumed、delivered与waitCount。delayed individual/group closure捕获run revision，delivery再次检查。group-join保存terminal attempt快照；resume注销旧group membership与individual nudge；所有terminal group members（即使consumed/waited）仍参与关闭group，防止siblings被拖到30秒timeout。

通知仍使用`subagent-notification`与既有formatTaskNotification、smart/group/debounce、usage ownership；没有generic UI复制或增加畸形task-notifications。stopped explicit action 的最终silent语义/epoch外发冻结留阶段3，当前保留backend原失败通知契约。

### Agent source

`src/source.ts`：`createAgentTaskSource(manager,coordinator,workflowTasks)`，sourceId=`agent`。factory在session_start登记一次source；shutdown unregister+dispose。直接factory省略coordinator仅创建局部owned实例；production composition始终注入。

- list复制冻结所有manager agents（含nested/workflow children、queued/no-session）及workflow roots。parentAgentId+parentRunId保持真实parent attempt；workflow key为`{sourceId:"agent",taskId:workflowId,runId:workflowId}`。`executionMode`foreground/background/owned与waitCount分开。
- stats具体字段：tokens/inputTokens/outputTokens/cost/toolUses/turnCount/maxTurns/activity/model/thinking/durationMs，以及workflow doneCount/totalCount/phases。phases仅真实meta/progress声明，不编造阶段。
- frozen TaskView/嵌套stats/artifacts/capabilities无records/session/controllers/promises；backend TaskSource订阅manager与`coordinator.subscribeWaits`，不general subscribe递归。
- detail同步最多16K transcript bytes，offset/limit返回start/end/size/omittedBefore/After/path；复用existing `.output` transcript格式，不引入第二全文reader。没有可复用的上游有界文件reader，原conversation viewer从session构建，所以新增局部 bounded `open/fstat/read/close`。无文件用last32 messages/每项1K bounded memory preview，明确旧/大内容省略；workflow显示真实phase/childprogress/log tail（明确省略），不消费结果。
- stop仅同run，选nested仅其branch，选workflow abort其worker signal并停所有workflow-owned children。高级pause/skip/retry仍`/agents`；workflow/task.ts增加metadata observer，不改runtime算法。实际source+manager+host/worker证明 stopped child attempt返回skipped，不auto-retry。
- active workflow/nested owner所需completed children及未消费result不被旧10分钟sweep提前回收；最终expanded/tree/window/selected snapshot仍stage4 UI owner负责。persistent sessions/memory/discovery/scheduling定义不删除。

## 变更文件

- `src/agent-manager.ts`：stable execution handles、tracked parent link、resume统一run、pool transfer、stop/freeze/retention/observable metadata。
- `src/types.ts`：run/start/notice/activity/turn与parentRun元数据。
- `src/index.ts`：注入coordinator、source lifetime、Agent/resume/result leases、通知recheck、inline/backend cleanup分离、旧UI sink隔离、workflow observer绑定。
- `src/waits.ts`（新增）：backend leased wait与delivery资格helper。
- `src/source.ts`（新增）：immutable all-agent/workflow read adapter、bounded detail与same-run stop。
- `src/group-join.ts`：terminal attempt snapshot与resume旧membership注销；保留group/join策略。
- `src/workflow/task.ts`：backend observer覆盖progress/pause/resume/settle，无runtime retry算法修改。
- `task-ui/types.ts`：只加readonly concrete agent/workflow stats。
- `__tests__/backend-waits.test.ts`、`tool-waits.test.ts`（新增）：13项manager/source +8项实际factory/tool/notice，共21项新回归。
- `README.md`：准确描述agentdetach/result等待和当前UI/session未完成；未改process inventory。
- `agent-tasks/PROVENANCE.md`、extension/testing specs、implement.md与本handoff：本地偏离/验证/API/后续边界中文同步。

## 实际验证与失败历史

全部使用真实SDK目录 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules`（只读取安装路径）、临时`PI_CODING_AGENT_DIR`。没有真实models/git/network/install/reload。

- 最终 `PI_SDK_DIR=<actual> PI_CODING_AGENT_DIR=<temp> pnpm check`：strict/noEmit通过，**369/369、0 fail**；`/tmp/stage2b-check-final3.log`。package本身带force-exit，不能作为自然退出证据。
- `PI_CODING_AGENT_DIR=<temp> node --test extensions/agent-tasks/__tests__/*.test.ts`：最终 **27/27、0 fail**，不带force-exit，自然退出；`/tmp/stage2b-agent-noforce-final3.log`。其中基础6项包含 unchanged actual child/root cached loader与worker；新增21项。
- 首轮backend11项10/11：worker fixture遗漏`export const meta`，修正后真实host/worker通过。两次strict因新增fixture错误（registerAgents传array、tool ctx缺ExtensionToolContext）修正；并行process fixture尚未补types的一次strict未过，不修改其文件。
- full曾通过365/365（当时17项新回归），最终增4项后第一次full **366/369**失败：新增fixture cleanup错误把fake worktree的tmpdir也当成generated artifact清理，导致临时目录EPERM和同批sync-test calls.txt丢失；已严格过滤conversation+本fixture目录。另一失败是source排序与runner启动顺序不一致选错resume ID，改成actual runner agentId匹配。该失败不算通过，已重新自然跑27/27与full369/369，sync重新全通过。不隐藏误清理事实；需要主会话知悉测试缺陷已修复。
- 三模块一起 `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts`：**347/347、0 fail**，无force-exit自然退出；`/tmp/stage2b-three-noforce.log`。
- `git diff --check` 通过；`python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-subagents-task-ux` 通过，两份JSONL各18项。

## 主会话应决定/后续未做

1. 阶段3另agent：epoch freeze/outbound guard、session manager/source重建、scheduler执行timer/mention clone取消、workflow worker oldepoch、late worktree有界cleanup、旧run不会污染新session、stopped explicit silent feedback。当前只提供hooks，不宣称AC9。
2. 阶段4另agent：shared panel/footer/tree/default-expanded/terminalwindow/selectedfinalsnapshot、editor-local focused Down、old widget/FleetView/settings完整移除。当前`/tasks`仍进程过渡面板，source不是最终UI。
3. G2整体验收还需主会话独立审查实际diff/API；混合shell+agent的一次detachAll已有同一coordinator实现，但本段未新增实际混合shell/agent同fixture测试，不能称完整AC2 TUI验收。
4. 真实Pi TUI/用户加载没有运行，需要用户授权。完整非UI能力矩阵（全部schedule/mention/schema/gate/replay）仍阶段5回归范围；本段没有改算法，不能把保留源码当作全部已验证。
5. backend `getRun().terminal` snapshot保留session引用仅用于tool/backend返回，TaskSource绝不暴露；stage4 selected-final详情必须保存artifact/readonlymetadata而不是此backend outcome。
