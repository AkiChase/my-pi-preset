# 分阶段实施记录

## 当前状态（最终收尾）

核心实现已完成，自动 strict/full 483/483、三模块 461/461 自然退出，独立核心面板与 Down 审查发现均关闭；授权隔离真实 CLI/PTY 分段 19 项检查通过。正在整理阶段 5 的证据和提交范围，未提交、未归档、未改个人安装。当前结果见 [final-acceptance.md](final-acceptance.md)；下方按阶段的“未开始／review中／待验”是当时快照，不是当前阻塞。

## 授权与基线

- 用户在最终规划之后明确批准实施，要求分阶段开 agent，避免单个 agent完成全任务。
- 任务已激活为 in_progress，分支 `feat/unified-task-panel`；不自动 commit、安装、reload或修改个人配置。
- 起始 tracked代码干净，仅既有 Trellis scaffolding和当前任务文件 untracked。
- 相邻 monitor-wake 已完成：`85c6189 feat: add batched monitor wakes and unified output handling`，`db22872` 归档。最新 monitor-contract已注入 implement/check JSONL，旧研究描述不能覆盖它。
- 隔离检查 baseline：设置真实 PI_SDK_DIR和临时 PI_CODING_AGENT_DIR后 `pnpm check`通过，325 tests，325 pass，0 fail。日志 `/tmp/pi-bg/byf31m105.log`，exit 0；检查期间未碰个人配置。

## 阶段分工

| 阶段 | Agent | 范围 | 状态 |
| --- | --- | --- | --- |
| 0/1 | `task-stage1` / `8a3f8188-63ff-4eb` | source复制、process目录改名、依赖/composition及初步typecheck | 轮次上限，部分完成 |
| 0/1补完 | `task-stage1-complete` / `f2785b4b-814e-433` | provenance、root/child/worker真实运行、正式tests/manifest | 轮次上限，已交付关键tests；主会话闭合G0/G1 |
| 2A | `task-stage2a` / `9c994f77-e8db-45f` | task-ui核心/wait registry、process接入、attach与输入交接删除 | 完成限定范围；主会话check339+target29通过 |
| 2A独立审查 | `task-stage2a-check` / `872e92bb-ef2a-453` | process/core等待、终态/通知和源契约 | 完成：确认3处throwingUI资源/结果问题 |
| process错误定向修复 | `task-process-error-fix` / `0d8f0774-e529-45d` | foreground hint cleanup、retrieval toast、background rollback和回归 | 完成；主会话读代码+无forceexit32 tests通过 |
| foundation独立审查 | `task-foundation-check` / `422baeb7-3edd-4ef` | stable vendor/loading/dependency/root-child测试 | 完成：发现different-cwd/worktree childguard blocking缺陷 |
| childguard定向修复 | `task-child-guard-fix` / `eea7a57d-a0eb-4a1` | graph-stable child ALS及真实different-cwd loading回归 | 完成；主会话独立targeted6 tests无force-exit通过 |
| 2B | `task-stage2b` / `967dbb28-258e-49e` | AgentManager queue/start/resume detach、结果消费/通知、agent read source | 交付限定范围；主会话full369+target27通过，readonlyreview中 |
| 2B独立审查 | `task-stage2b-check` / `43dd593d-a146-492` | agent run/queue/resume/通知/readonlysource | 完成：actualrunnerstartup取消等4项缺陷 |
| 2B定向修复 | `task-stage2b-fix` / `6db3ea7f-ba63-4c5` | runner迟接线cancel、backgroundartifactrollback、toolcallid/终态stats | 交付；主会话389/47/367全部通过，定向复核中 |
| 2B修复复核 | `task-stage2b-fix-check` / `e946b60a-f6da-4c2` | 四项actualcode与新测试 | 完成：四项关闭，发现2项resume边缘问题 |
| 2B边缘补完 | 继续 `6db3ea7f-ba63-4c5` | disposed partialsession引用、resume硬/软限额终态 | 完成，主会话393/50/371与最后review16通过 |
| 3A | `task-stage3a` / `abefc18d-f7e5-44a` | sharedactivation关闭协议、process实际exit/有界停止 | 已交付，主会话404/382通过；独立review中 |
| 3A独立审查 | `task-stage3a-check` / `d45e71a5-8a8f-4c1` | process停止/异常/monitor契约与actualSDK生命周期 | 完成：复现shutdown重入monitor源/fd泄漏 |
| 3A重入修复 | `task-stage3a-fix` / `60c54991-5fb9-4c5` | monitorpublish/createsource/alreadyabort rollback | 已交付；主会话414/392通过，独立复核中 |
| 3A重入复核 | `task-stage3a-fix-check` / `1033038b-227e-458` | 确认唯一blocking关闭与正常monitor契约 | 完成：最后2/2确认关闭，无新增发现 |
| 3B1 | `task-stage3b1` / `ecba2375-3e00-45a` | manager/runner/worktree实际执行与artifact清理 | 已交付430/64/408报告，主会话与review中 |
| 3B1独立审查 | `task-stage3b1-check` / `842266a9-337d-4c3` | actualdrain、重复cancel、childshutdown、artifact边界 | 完成：复现completedchild漏shutdown hook；连续cancel已排除 |
| 3B1定向补修 | 继续 `ecba2375-3e00-45a` | 所有ownedterminalchild在host有效时close、finalseal | 完成；parent437/71/415与review7通过 |
| 3B2 | `task-stage3b2` / `381312bb-02c5-4b3` | agentparticipant/clone/scheduler/workflow旧activation隔离 | 达轮次上限交付459/93/437报告，parent+review中 |
| 3B2独立审查 | `task-stage3b2-check` / `a03ec4e7-e12c-4fe` | auxiliary真实ownership、重入/通知、SDK双backend矩阵 | 只读执行中 |
| 4 | 待委派新 agent | shared双栏tree panel、default-expanded、old UI删除、editor-local Down、footer/键位 | 未开始 |
| 5 | 独立审查/必要修复 agent | 整体能力回归、README/spec一致性、完整checks、trellis-check | 未开始 |

主会话每阶段读取真实 diff和有界测试日志，核实gate后再委派后续，不并行改共享文件。Agent摘要不是完成证据；失败/turn limit必须明确续派该限定阶段，不能把未写的下一阶段称为完成。

## 第一阶段部分核验

- 实际文件存在：process-tasks迁移、agent-tasks/src 56文件、LICENSE、composition、依赖/config改名；未写agent provenance和正式 loading.test.ts，仅source-loader.mjs/host smoke草稿。
- 主会话重新运行真实 isolated `pnpm typecheck`通过（composition接线之后）；随后host-loading-smoke失败：child工具仍包含Agent，line30 true!==false。日志 `/tmp/pi-bg/bzbmvmzq0.log`。问题可能是测试用jiti创建了第二份child-context module identity，但未确认，不能删除assert当通过。
- 补完agent已收到失败证据，需核验同一实际host context/root manager guard和child shutdown。G0/G1仍未通过，未启动后续集成。
- process机械迁移比较已核对，monitor新源和buffer内容未见逻辑回退；README当前只有部分机械替换，仍需真实性审阅。

## Foundation最终闭合

- 第二实现agent解决host module identity，改用真实DefaultResourceLoader的cached loader路径，同一composition暴露child-context bridge；root11/child7 tools、childshutdown保留rootmanager、rootshutdown释放已用正式test验证。
- 实际inline workflow worker无agent结果/stub RPC/abort3 tests通过。配置新文件/旧文件忽略和custom discovery通过。
- 主会话最终完整check首次331 tests中3 fail：两处commands测试旧路径/报告名正则未改，sync negative regex误匹配“must not be installed”。修正actual诊断名和测试plan行范围，并补全README/vendor/self-maintenance文档。
- 重跑真实隔离`pnpm check`：331 tests通过、0 fail；agent定向无force-exit：5 tests通过、0 fail，自然退出。日志 `/tmp/pi-bg/bhc941xc5.log`。git diff --check/task validate通过。
- 原G0/G1 foundation检查通过后，独立审查发现different-cwd childguard失败，child-isolation门重新打开；未完成shared control/UI，old process panel/input和agentwidget/fleet仍保留给下一阶段改。README明确过渡现状，不冒称最终UX已上线。修复agent与2A所有文件分开，2B前须核验修复。

## 不同cwd guard修复核验

- 实际child-context.ts已使用typed namespaced Symbol.for共享ALS marker，非globalUI/manager状态；所有异步范围仍run(true, fn)，parallel root不被标成child。
- host smoke实际覆盖同/不同temp cwd、child工具/handlers缺席、root重复加载/关闭所有权、nested async child与独立root overlap。loading.test.ts保留断言，新增独立ALS/异常范围测试。
- 主会话读取全部修改后再次运行targeted loading/foundation/workflow：6/6通过、0fail，无force-exit自然退出。日志 `/tmp/pi-bg/btb2ygux6.log`。修复agent报告完整check335/335通过（含当时2A的部分改动），不是最终2A验收；后续仍须fullcheck。
- G0/G1 childguard门重新闭合；真正运行中的session/worker/queue隔离仍属于stage3，未以nosession smoke替代。

## 阶段2A主会话核验

已逐文件读task-ui/types/coordinator/controls、process/source、bash/jobs wait接入、新coordinator和waittests、真实composition。task/run身份用JSONtuple防碰撞，launch/retrieval lease分离，manualdetach同步signal解绑，progress/artifact仍backend-owned。process早期detach不再等2秒，foregroundfinal保留file，inputhandler不再注册，生产controls唯一在composition。

主会话实际隔离`pnpm check`：339/339通过，0fail；targetcore+waits+vendor6合计29 tests通过，0fail无forceexit自然退出。日志 `/tmp/pi-bg/b1zb68zxu.log`。另派readonly2A审查，只读稳定core/process而不审查正在实现agentbackend。

Stage2B委派证明理解了2A API，使用registerWait/TaskSource/subscribeWaits，不另造coordinator或注册sharedcommands；将actual管理器queue/start/resume/pool归一化，不以Promise.race+isBackgroundflip掩盖取消关联。G2整体未通过，真实epoch/最终UI仍未实现。

独立review确认2A UI异常3处缺陷（stage2a-review.md）；定向修复已完成，主会话读actualbash/bash-bg/jobs和9条新错误路径tests，再运行core/waits/error targeted32/32通过无forceexit（`/tmp/pi-bg/bvyac1vj4.log`）。mandatorycleanup先disposelease，displaysteps逐个隔离，后台接线失败silentstop等待exit，toast不妨碍inline结果。修复agent旧代码回归1pass/8fail，修复后9/9、core/process320/320、当时fullcheck359/359；parent最终fullcheck仍等2B稳定一起跑，不把并发快照当final。

## 阶段2B主会话初验

已读agentwaits/source与manager begin/detach/consume/start/settle/dispose、factorysession/mention/notifyowners。leasedterminal覆盖queue/startup，resume换runrevision，readonlysource不泄漏controller。实际隔离fullcheck369/369通过，targetagent27/27无forceexit通过（`/tmp/pi-bg/b8akis1bh.log`）。独立review读取稳定2B执行/通知路径，阶段3还未派写agent避免review-race。

G2整体暂不关闭，混合shell+agent integratedcase留下一阶段核验；session_before_switch复用旧manager/ctx、lateworktree/clone/worker旧epoch清理等具体缺口写stage3-contract.md，不冒称完整session/面板已做。另有pretty-editorcompat独立任务与turnlimitplanning已记录，后续不覆盖其边界。

独立review已完成并指出当前stage2B4项缺口（stage2b-review.md）：actualrunnerawait后cancel未检查，backgroundtranscriptinit无rollback，fgdetach/resume通知toolcallid未接线，completion先删activity导致turnstats丢失。主会话读actual代码确认路径后派新定向fixagent；phase3暂停，防止同核心文件write race。

## 阶段2B修复主会话复验

主会话读实际runner env/reload/create/bind/callback/prompt取消守卫、partial幂等shutdown、managerready/per-runstats、artifactrollback与notice关联代码；以临时agentdir、真实只读SDK执行 `set -e` gate，完整389/389、agent47/47及三模块367/367全部通过，后两组无force-exit正常退出，diffcheck通过（`/tmp/pi-bg/bmvegx4tl.log`）。不是仅按agent摘要确认。

主会话补G2缺失mixedcase `extensions/task-ui/__tests__/mixed-waits.test.ts`：同一实际coordinator，actualshell/bash/jobs与actualmanager/typedfakeagent，四个lease一次detach，父abort不杀原PID/session，immutableview、计数、日志与agentoutput连续；定向1/1自然退出和strict通过。README/spec同步；新的全量基线应为390/48/368，尚待重跑不提前记作通过。

stage3研究已纠正真实host lifecycle：Pi1.1.0 shutdown后建新runtime/factory，非复用旧manager/coordinator；before_switch可取消或invalidcwd失败，不可永久close仍在使用的activation。最终shutdown冻结/禁notice/有界awaitactualexecution再disposesources/coordinator，新factory空state。独立repaircheck尚未返回，仍不派stage3改同核心。

主会话新增mixed后又跑完整390/390与三模块368/368，后者自然退出，diffcheck通过（`/tmp/pi-bg/bdvj436on.log`）。修复复核已确认原四项关闭，但指出两项新增路径缺口：partialstartupcallback失败时runner已dispose但managerrecord.session仍可resume；resume硬回合abort没有返回标记，manager误标completed，softsteered同样丢失。主会话读实际runner/manager/tests确认，续派原修复agent限定补这两项及actual回归。G2仍开，不以测试全绿替代生命周期语义。

## 阶段2B边缘补修主会话最终检查

已读closedWeakSetquery、managercatch精准clear与promptfailure保留、resumeoptionalaborted/steered和manager同new终态priority；实际newtests断言disposedref不可resume、promptfailure同session可resume、partialoutput/currentstats/priorrun冻结、workflowhosthardabort非success。主会话临时配置重跑最终strict/full393/393，agent50/50、三模块371/371无forceexit自然退出，diffcheck通过（`/tmp/pi-bg/bweo7yd11.log`）。最后两项review续派原只读reviewer，不另扩大fullvendor读范围。G2将在其结果确认后关闭。

下一阶段依据实际Pi1.1.0hostruntime，shutdown后newfactory，不以globalpointer复活旧coordinator。新增发现host先await主session.abort再shutdown，foregroundSIGTERM忽略会令shutdown达不到；stage3必须真实exittracked有界killupgrade，同monitor已有silentstop不刷尾契约不变。

## G2关闭与3A启动

read-onlyreviewer `e946b60a-f6da-4c2` 最后确认两项followup均关闭，actualrunner16/16无forceexit自然退出，未发现新增blocking/shouldfix；parent393/50/371及mixed四leasegate已核验。implement.md阶段2读模型/等待总项与G2关闭，仍不勾epoch/最终UI全AC。

新3Aagent `abefc18d-f7e5-44a` 专做sharedactivation关闭协议与processrealexit/TERM升级，typedAPI交接3B；同一task不机械加child，顺序不同agent。3B不得开始改同composition/manager直到3A真实gate确认。3A未覆盖agent/worker/clone/scheduler，G3整体开。已纳入stage3a-handoff两份JSONL，各20条validate通过。

## 阶段3A主会话初验

3A已交付 `TaskLifecycle` participant协议、processclosedadmission、backendactualexecutionregistry、TERM→250msKILL、monitor观察与OSexit分离，source/dispose逐项隔离。主会话读实际lifecycle/coordinator/composition/processstate/index/spawn及APIhandoff；临时配置、真实只读SDK完整strict/check404/404，三模块382/382无forceexit自然退出，diffcheck通过（`/tmp/pi-bg/b9w3quluc.log`）。

独立review `d45e71a5-8a8f-4c1` 正在检查boundedstop/executionownership/monitor契约/真实SDKruntime。旧agentshutdown尚未转participant，不能称全backendfreeze顺序/G3完成。主会话正在读3Bmanager/startup/runner/worker/clone/scheduler实际ownership，等3Areview后才派3B写agent，避免同核心写入竞态。

## 阶段3A独立审查后修复

review完成，唯一blocking actualrepro：同步add(job)订阅中shutdown，随后monitor仍createsource；terminalbranch只stop pid0execution且删除sourcehook，lateabortlistener无效，phaseclosed仍socketclose0/execution1/fd可写。review正常107targeted/strict绿但新memoryrepro失败，不豁免。见stage3a-review.md。

主会话读actualcode确认，原3Aagentresumehandle不可用，改派新的定向 `60c54991-5fb9-4c5` 处理postpublishguards/constructedsource silentrollback/提前abort/计数和actualtests。阶段3B仍暂停，待修复核验后继续；G3仍开。

## 阶段3A重入修复初验

定向修复agent60c54991交付postpublish+directsetup closed/terminal/identity guard、capturedonce stopOwner、alreadyaborted immediate silent cleanup、commonterminal/afterUIcancel sourcehook+actualexecutionstop、保留cancelledterminalcounts。新增10actualregression，agent报告before8/8fail→afterfull414/three392通过，未改正常batch/wake/deadline行为。

主会话已读三个实际生产文件及中文handoff，临时配置full414/414+three392/392无forceexit自然退出、diffcheck通过（`/tmp/pi-bg/bsy8dhpaa.log`）。新的独立定向review1033038b仍在执行，等待其实际结论后闭合3Aslice；3B不与review中的共享process/lifecycle/composition同时写。

## 阶段3A末次通知返回值修复

review1033038b确认原资源/alreadyabort/统计缺陷关闭，但指出最后initialdecide发送absent回调shutdown后仍returnstarted。主会话直接新增actualtool/WS/fakeclock回归，修复前1/2失败Missingrejection，生产只改decide后regclosed/identity复查，不把正常立即deadlineterminal当cancel。修后2/2+strict通过，最终full416/416、三模块394/394无forceexit自然退出（`/tmp/pi-bg/bwqlhmmhc.log`），diffcheck通过。最后独立review续跑1033038b，待结果后闭3A与派3B，wholeG3仍开。详见stage3a-final-result-guard.md。

## 3A关闭与3B1开始

最后独立review1033038b確認末次returnguard以及deadline对照2/2自然退出，前轮blocking资源/alreadyabort/统计已闭，无新增发现。结合parent416/394，3A切片已接受。wholeG3尚开。

3B顺序再拆manager实际promise/worktree（3B1）与index/clone/scheduler/workflowparticipant（3B2）以控制单agent复杂度；新agentecba2375只写3B1允许文件，另一agent后续消费actualAPI。handoff写清record.promise/terminal不是actualrun，voidrun/resumepromise必须tracking，noncooperativecleanup与artifact保留；两JSONL各21条validate通过。无并行共享核心写入。

## 阶段3B1初验与限制

agentecba2375交付manageractualexecutionSet/drainExecution/稳定2sdispose，runnercleanup-onlyearlysession/abort-close去重，worktreeexecsignal/partialpreserve/nonforcecleanup。未改index/productionparticipant/clone/scheduler/workflow。主会话已读actualmanagerfreeze/ownsession/start/run/resume/abort/dispose、runnerstop/close与真实SDKdispose、worktree代码及交接，派842266a9独立review；隔离full430/430+agent64/64+three408/408无force自然gate通过，diffcheck通过（`/tmp/pi-bg/blno2jlmh.log`）。

交付明确限制noncooperativeinprocessprovider超过2s仍可能写，lateowner不是allstop保证；当前managerdispose先关闭childhosteffects再localdispose，完成retainedchild可能不emitshutdown释放extensionresources。另runnerstoppingWeakMap resolvedpromise不delete，需确认resume后第二次cancel是否可实际abort。主会话已告知reviewer定向核验这两路径，不重复其测试；不接受其未核验语义或提前勾AC9/G3。wholeG3和3B2仍未完成，不静默放宽用户停旧执行要求。

## 阶段3B1独立审查阻塞补修

review actualrepro确认唯一blocking：completedretainedchild standardfreeze→abortAll→drain→dispose只localdispose，shutdownHook0/resource1；activechildcontrolhook1/resource0。SDKdispose不emitshutdown，已有workaroundclearCompleted需disableownerretention并非正确交接。必须明确stop阶段所有terminalchildhook，directdispose也实际关闭，finalseal禁止lateoldhosteffect。

连续cancelafterresume实测abort2/prompt2，forwardAbortSignal已重置stopWeakMap，主会话前提已排除不作缺陷。其余drain/identity/pool/worktree安全回归通过。详见stage3b1-review.md；续派原ecba2375定向修复+firstredactualtests，3B2仍暂停，不改sharedcore/productionparticipant。G3开。

## 阶段3B1 completedchild补修初验

已读新增managerstopForShutdown，ignoredisplayretain对全部settledsession启动trackedshutdown；active先abort真正run后close，directdispose有效窗口后seal，protocolfinaldispose需先sealHostEffects。runnerlivepermit在actualemit前读，预算后latecreate只localclose。7actualmanager+runner新tests使用真实interval仅shutdownhook释放，不只counter。agent报告first2/2fail→full437/agent71/three415通过。

parent隔离full437/437、agent71/71、three415/415无force自然gate通过，diffcheck通过（`/tmp/pi-bg/b79a7a10u.log`）。review842266a9续跑限定已确认blocking，尚未返回结果不提前记为验收。3B2须用freeze→stopForShutdown→drainExecution→sealHostEffects→voiddispose替代旧abortAllrecipe；wholeG3仍未通过非协作providerall-stop能力，不能把timebudget私有owner保留当全部执行终止。

## 3B1限定验收与3B2派发

review842266a9最后确认completedretainedchildshutdownblocking关闭、无新增blocking/shouldfix；actualrunner followup真实interval7/7自然退出。主会话437/71/415已验。3B1限定backendaccepted，privateowner不等于非协作providerallstop，wholeG3仍开。

已更新stage3b-handoff真实API与旧缺口表述，当前managerstopForShutdown包含全部settledchildhooks，sealHostEffects在protocolfinaldispose先调用；不能沿旧abortAllrecipe。新3B2agent381312bb按此register existingparticipant、实际clone/timer/worker/hostdrain和latecallbackguards，不改acceptedprocess/manager/UI/turnschema。两JSONL各22条validate通过。fullG3严格alloldexecutionstop限制须最终设计门处理，不能隐式放宽。

## 阶段3B2交付与设计门

381312bb达到轮次上限，交付indexparticipant、ownauxiliary实际clone/worker/hostgate、guardoldtool/input/RPC/nudge/group、scheduleimmutablebinding、mentionclonecancelseam、workflowlatehost前guard。中文stage3b2-result明确full459/agent93/three437报告与strict/target42最终重跑，不能把wrappedup摘要直接当完成。主会话已读actualindexprotocol/proxy/own、cloneawait/admission、schedulefire/finalize和result，安排临时配置full+agent/three无forcegate `bd8do2d17` 与独立review `a03ec4e7-e12c-4fe`。

严格AC9仍未满足：不协作进程内provider/已开始第三方hook可能超budget继续写；本轮无强制线程隔离或SDK改动，owner/cancel/seal不能证明alloldexecutionstop。主会话临时配置full459/459、agent93/93、三模块437/437无forceexit自然gate通过、diffcheck通过（`/tmp/pi-bg/bd8do2d17.log`）；独立reviewa03ec4e7仍在执行。用户对停止保证选择回答“什么意思，没看懂”，这不是同意放宽AC9；先用日常例子解释，仍不闭G3/派UI实现。

## 用户批准的协作式取消边界

用户明确回复“那就按1吧”，保留普通agent进程内架构，接受不响应取消的第三方provider/create/shutdownhook可能超budget继续写的限制；不要求为它们重设计独立进程强杀。PRD R6/AC9、design/implement、decisions/README/spec和cancellation-boundary.md已同步，memory已持久化。独立reviewa03ec4e7收到边界调整，但自有process/monitor/worker/timer泄漏仍是缺陷；G3等待review，不能凭用户选择直接通过。

## 后续委派必须明确的接口

- 单一 composition owner注入同一 coordinator，而不是两个后端用 globalThis搜 UI singleton。
- 基础task视图不可变且带 source/task/run identity、parent ownership、execution mode和wait state。View不消费结果。
- runner所有 queue/start/run取消关联可解除；wait lease与执行控制器分开；结果等待同样可通过background chord解除。
- detach胜出继续记录activity/transcript，tool renderer/timer清理不等于 execution finished。
- reset先禁admission/通知，后取消wait/run/worker/延迟clone；保证旧async callbacks不能生成新session任务。
- process前台正常/中断finally目前unlink，必须保留可见终态和disk logs；不得只解决background终态。
- `Down`使用editor-local装饰，保留custom editor和app/undo/history/autocomplete行为；panel持焦点时转后台键显式转给coordinator。
- 一次stop user intent不能被workflow自动重试悄悄复活，显式advanced retry可保留。

## 待核验风险

TS `.js` → `.ts` specifiers与inline CommonJS worker区别；host SDK/TypeBox依赖；child extension factory/Trellis跨扩展agent manager；temporary background over-capacity记账；late consumed notification；parent child detail retention；SDK editor factory替换时草稿/history保存。
