# 阶段2B独立审查与定向修复安排

只读trellis-check `43dd593d-a146-492` 读actualmanager/runner/index/source/group/tests，正常27agent/369full/strict通过，但确定以下控制流缺口。审查未调用真实model，前两项代码路径确定、故障注入验证待修复agent；不将其描述为已完成实测复现。

## 缺陷

1. **blocking startupcancel**：manager787–791进入异步runner前starting=false；runner598detectEnv、760loader、1008create、1019bind均await；1097forwardAbort只addlistener不checksignalalreadyaborted，1113无条件prompt。Esc/x在这些await期间已stop terminal但后来可开始prompt。fakeRunAgent入口立刻接线未覆盖此迟接线窗口。必须真实runner路径验证no prompt和partialsessioncleanup。
2. **backgroundartifactrollback**：index1878–1881 attachTranscript初始化可能throw；backgroundnew2112–2135先spawn后attach无tryrollback，结果toolreject但后台执行继续。用stopand rethroworiginal初始化error，未返回ID的execution不能继续或发successnotice，保留file。
3. **notificationcorrelation**：foregroundnew2265–2285无record.toolCallId赋值，foregroundresume2055–2074未重写旧ID。detachnotice缺本次tool-use-id或串上一次resume调用。tests固定offline-call掩盖；需distincttoolCallIds/mentionundefinedclear回归。
4. **noticestats**：indexfinishActivity在630–631先删activity，509/547delayednotice读取活动图，turnCount变0、maxTurnsundefined。用finite terminalrecordstats/snapshot，不保留活动runtime；groupothers同样正确。

## 分工

新的定向实现agent `task-stage2b-fix` / `6db3ea7f-ba63-4c5`处理上述runner/error/correlation/stats与实际回归。不得同时开始phase3改同manager/index；待主会话核验后进入sessionepoch。processerrorfix已完成，sharedcore不用重写。

只允许agentbackend相关代码与tests/docs，不更改UI/monitor或另外planning中的turn-limit schema。未执行真实用户配置/安装/model/git调用，未startphase3、未finish/archive/commit。

## 原阶段证据保留

queue/startupworktree detach、pooltransfer、new/resume同session、retrievalcount、消费/分组race、readonlysourcefreeze/paging/owner retention测试均通过；这些不能替代actualrunnerstartupcancel。G2整体仍未关闭。最终mixedshellagent、epoch/latecallbacks和taskpanel/down仍未验收。
