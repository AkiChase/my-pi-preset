# 阶段3A独立审查：monitor启动重入关闭泄漏

只读review `d45e71a5-8a8f-4c1` 的唯一blocking，actual复现；没有独立should-fix。不把3B尚未迁agentshutdownparticipant算3A新缺陷。

## Actual路径和复现

`tools/monitor.ts:109` add(reg,job)同步发布tasksource，订阅者可触发lifecycle.shutdown。此时job pid0/无source；关闭把job标killed。启动栈返回后依然monitor-session105createSource，打开WSsocket和logfd；startBackgroundJob89–100 terminalbranch只execution.stop(pid0)并deletejob.stop，返回已abortedcontroller；随后添加abortlistener不触发，source未关闭。

reviewer通过actualprocessActivation/tool/monitor-source/session，只替换无网络WStransport，在node:test内存定义复现，无源码修改：

```ts
h.source.subscribe(() => {
    if (h.lifecycle.active) closing = h.lifecycle.shutdown();
});
await h.execute("monitor", { ws: { url: "ws://offline.test" }, description: "reentrant" });
await closing;
```

实际输出cleanup timed out，phase closed但execution1/socketCloses0；lateframe仍增加15bytes日志。notificationguard有效却OS/source/fd ownership失败，不能因full404/382绿而通过AC9。

## 其他验证

review actualprotocol ALLfreeze→closehooks→waitcancel→ALLstop→boundeddrain→dispose、reentrantstablepromise；真实TERM忽略进程/后代终止；monitor批次/absence/recovery/deadline/silentstop/retrieval保持；真实SDKruntime new/resume/fork/import/reload/cancel/invalidcwd实际方法seam正常。

review定向88/88+19/19自然退出、strict/diffcheck通过，两memoryrepro失败且finally清transport。未调用模型/网络或改个人配置/源码。主会话已独立full404/three382通过；这不包括遗漏的新重入回归。

## 修复分工

主会话读actualtool/monitor-session/startBackgroundJob terminalbranch确认路径。原3Aagentresumehandle已清理，新的定向 `task-stage3a-fix` / `60c54991-5fb9-4c5` 只修publish后/createsource前admission复查、already-stopped source实际silentrollback、already-aborted接线和计数owner，添加actualWS重入回归。不得改monitorbuffer/wake/deadline契约，不开始3B改同核心。新增tests须createdsource close一次、执行map零、迟到frame不写/no notice、日志保留和counts/hookssafe。

G3和3Aslice暂开，修后parent和独立检查再续3B；stage3b-handoff草稿不是实施授权已下发。
