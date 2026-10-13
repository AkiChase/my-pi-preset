# 阶段3B2实施交接：agent所有权集成

3A已验416/394，3B1补修主会话strict/full437/437、agent71/71、三模块415/415无forceexit自然退出（`/tmp/pi-bg/b79a7a10u.log`）；最后独立review842266a9 actualfollowup7/7确认completedretainedchildhookblocking关闭、无新增发现。3B1限定manager/runner/worktree API已接受。3B2接入index/clone/scheduler/workflow；不代表wholeG3已可通过，非协作provider/hookall-stop能力差距仍明确存在。

## 已存在协议，不重造epoch

`TaskLifecycle`（task-ui/lifecycle.ts）由bash-unified创建一次并注入两backend；`register({name, freeze, stop, drain, dispose})`，全部同步freeze后closehooks/cancelWaits，再全部stop、有界drain（默认2秒）、dispose/sources/coordinator。`active/phase`识别单activation是否closing；host正常换代重新建factory，旧closure不复活。只写agentparticipant与actualexecution隔离，不能再创建生产第二coordinator/protocol或跨activationglobal执行图。

agent/index.ts typedoptions.lifecycle已传入但未消费，旧shutdownhandler先于compositionprotocol执行。3B拆迁到participant，直接agentfactoryfixture无options时可own局部protocol+单handler，生产不再旧handler先stop。source注册/managerregistry条件释放必须保留childguard，stopped旧source不复活。

## Actual manager执行与result区别

- beginRun立即record.promise/terminalhandle；abort会提前resolveTerminal，不能作为runner退出。
- 3B1已保留真正new/resume/启动promise并纳入privateexecutions，所有latecallbacks按capturedrecord/run防重，publicisRunActive维持结果归属，不误堵正常立即resume。3B2沿用，不再重写manager。
- dispose新增stablebudget与explicitstopForShutdown/sealHostEffects，标准recipe在下面段落；旧abortAll→drain→localdispose不能清completedchildresources。3B2在protocolstop启动有效childshutdown，finaldispose先seal，不在host已经失效后继续发hooks。
- privateexecutions与drainExecution API已最终review确认，不等同terminal。index需要沿用不能重做globalowner。
- 不只是await所有会话shutdown：先让实际run停止，避免disposechildsubscriptions后仍provider跑；shutdownChildSession已有WeakSet幂等与3秒有界。协议drain默认2秒，不能因超时就删除尚在写worktree/称全部OSexecution结束。注明provider非协作的可保证边界，有界返回后latecleanup仍owned无新会话effect，不能吞资源或拿futurepromise当完成。
- `worktree.ts` 3B1已加execsignal/awaitcancel、partialartifact保留与正常nonforcecleanup；关闭时不新发git/prune，unknown写入文件保留。3B2不要改此正常分支与已验actualtests。

## 已验收的3B1集成API

```ts
freeze() { /* 同步disarm index notices/ctx/RPC */ manager.freezeAdmission(); }
stop() { /* 捕获取消clone/scheduler/workers */ manager.stopForShutdown(); }
async drain() {
  await Promise.all([manager.drainExecution(), drainOwnedAuxiliaryWork()]);
  // drainOwnedAuxiliaryWork由index-owned worker/clone/gate启动链实现，不是TaskUI拥有
}
dispose() {
  manager.sealHostEffects(); // protocol同步dispose不再允许新hostchildhook
  void manager.dispose();  // stablepromise，晚到清理owner继续local-only
  // source/unsubs/globalregistry仅本activationowned解除
}
```

standalone `await manager.dispose()` 自带stopForShutdown与2秒窗口，completed/retainedchildhook纳入实际executions。不要用普通abortAll代替关闭专用stopForShutdown，否则完成child资源不清；也不要调用clearCompleted绕UIretention猜关闭顺序。3B1不能保证非协作进程内provider或已开始thirdpartyhook2秒内停止，这与用户要求alloldexecutionstop尚有能力差距，G3不能不说明就关闭。

## 对外路径失效

index全部delayednudge/group/batch callbacks先active+origin/runcheck，freeze同步disarm并freeze manager，清 pendingNudges/currentBatchAgents/timer，groupjoindispose与outwardevent/append/usage守卫。来源只在currentactivation使用capturedctx，before_switch被取消/invalidcwd无shutdown仍可新执行，不能永久freeze。当前before_switch还stop scheduler但取消后没start事件，需取消不会破坏active计划的策略（优先不在可取消beforeevent永久停scheduler/清owner，真正停止属于shutdown）。

RPC handlers与globalMANAGER_KEY registry只是当前rootactivation的外部句柄，ownershipconditionalrelease不得deletechild/root他人；freeze后拒绝spawn、await不能阻塞shutdown。shutdown早断RPC、stop scheduler/clone/worker，finaldispose注销source/registry。mentionprovider wrapper宿主无注销API：其enable predicate/roster须active且不保留oldctx污染newprovider，不恢复旧factory。

explicit userstop/session stop需有noticeintent字段或有限stopcause：x/RPCkill/foregroundEsc/managerstop已knowintent不额外completionnotice；自然异常/外部providerabort仍一次报告，soft/hardlimit区分已修复aborted/steered不回退。group要看所有terminal成员关组，silentmember只过滤它不吞siblings。source.stop(workflow)要取消ownershipchild范围，不把stop误当retry。

## clone、scheduler、workflow

- mention-clone.ts完整读取：reload→create→prompt→dispose，当前无signal/owner；registeredAgent cloneexecute关闭后必须拒绝，创建等待返回要dispose不prompt，actualcloneprompt可abort。index1075clone.thenfallback要active+capturedowner防晚回调directspawn/notify；直接mention/tombstone/resume的await后也guard。测试typed局部detect/create/loaderseam，运行actualclone，避免mock整个function。
- schedule.ts resolveModel同步，不虚构asyncmodelresolver。timers闭包目前 `this.executeJob(job.id)` 会用新binding，once闭包捕获oldstore却this.emit用新pi；awaitStartup→record.promise→finalize里this.getNextRun同样串newbinding。每个start bindingtoken/immutablepi/ctx/manager/store捕获，stop取消timer并invalidates，不改persisted用户definition。旧latefire、finalize不新spawn/emit/store跨写；在关闭后本schedule执行controller停止，schedulerdisable是否同时stop已spawn须遵守用户明确配置语义，不随意新增。
- runWorkflowTask/index2433实际runWorkflow promise等worker.terminate，但tool2651/CLI2808voidthen未tracked；onProgress/onControl/journal/notifyWorkflowFinished/CLIappend+send nextTurn需active/origin及taskmapmatchguard。worker abort与ownedagentstop同步，真正workerpromise由backendtrackawait；gate pi.exec signal已有但要afterawaitguards，runtimefinish只能杀worker不能取消挂起hostpromise，hostawait与worktreegate需ownedcleanup。
- workflow/runtime当前await host.spawnAgent后先schema/gate，再 `if(settled)return`，可能在worker已终止后latehostresult仍执行gate。检查settled/aborted后跳gate/newjournal/resolve；这属于取消边界最小修复，不重写pipeline/parallel/replay/重试算法。progress onResolved已inflightguard保留。

## 验证矩阵

扩actualSDKruntimeharness，不copyhost eventorder：old+new factory bothprocess+agent samecoordinator/protocol、oldqueued/running/startup/resume/resultwait/workflowpaused/workerbusy/clone/delayedtimer；new/resume/fork/import/reload/quit空新state、oldtools拒绝、新tools能执行、log/session/memory/schedule definitions保留。驱动oldlatecallback断言新notice/map/counters不变。

manager实际runner typedseam迟到onSessionCreated/afterabortpromise；worktreecreate迟到清理且不prompt；oldnotify timer/group晚到仅silent，真实worker终止等待/hostgate abort；actualclonecreating/prompt/fallbacklate不会spawn；scheduler同实例rebind+旧timercallback和finalize防串store。清理sinkthrow不挡siblings，重复shutdown同promise，closedsource/lease无漏，childALS实际hardtests原样保持。

README/agentprovenance/spec与中文结果handoff同步阶段边界，不碰另外planning中的model max_turns removal或Pretty兼容独立worktree代码。最终panel/widget移除/Down/editor仍4阶段，3B不增加wholeeditor/inputlistener。
