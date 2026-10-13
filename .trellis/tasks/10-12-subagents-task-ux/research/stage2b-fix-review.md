# 阶段2B修复复核：原缺陷关闭与两个边缘问题

只读review `e946b60a-f6da-4c2` 确认原四项修复与实际28/28 runner/tool定向测试通过，自然退出；未重跑主会话全量、未改代码。

## 原四项已关闭（限定路径）

- runnerenv/reload/create/bind/callback/prompt取消守卫，不再已stop后prompt。
- backgroundinit失败在publishbatch/activity前stop、disarm并抛原异常。
- foregroundnew/resume当前toolCallId含undefinedclear。
- individual/group通知用finite recordstats。

## 两项should-fix（当前路径，不归未来epoch/UI）

1. manager812–854 onSessionCreated先写record.session，callback throw后runner1197–1201在prompt前shutdown/dispose；manager917–943 catch未clear对应已关闭session，1077resumeRun只检查exists，会接受已dispose引用。SDKdispose会断订阅/invalidateextensions不能恢复。需精准清partial引用与resumecapability；actualprompt已开始后providererror会话仍保留。已有callbackfailuretest只看disposeonce，新增resume拒绝/正常promptfailure仍能resume实际断言。
2. resumeAgent1238–1244硬limitabort但1273–1276只returntext/failure，manager1143–1145无failure就completed。softsteer同样失去steered终态。返回当前run aborted/steered，manager用new同优先级stopped>aborted>error>steered>completed，证明onComplete/host不把budgetstop当success。保留用户/程序回合配置；与独立turn-limit移除模型schema的planningtask无关。

主会话读真实路径确认后继续原定向修复agent `6db3ea7f-ba63-4c5`；不得并行启动phase3改同manager/runner/index，新增onlyactualregression及中文交接。该复核不宣称overallAC2/4/9/11，真实TUI仍未执行。

## 主会话集成证据

修复首轮parentfull389/agent47/three367通过；新增mixed-waits实际shell+manager四lease之后full390/three368通过（`/tmp/pi-bg/bdvj436on.log`），three无force-exit。mixed1/1和strict也通过。测试通过不能豁免以上源码语义缺口，G2尚未关闭。
