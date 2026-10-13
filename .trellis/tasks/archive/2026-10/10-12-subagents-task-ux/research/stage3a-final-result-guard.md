# 阶段3A最后返回值边界：初始通知中的shutdown

review1033038b确认WS/fd/alreadyabort/统计缺陷关闭，另指出monitor-session末次decide可能发absent，发送回调同步shutdown后仍无条件returnstarted。review仅源码确认，未冒称独立动态复现。

主会话直接补actualregisteredtool回归 `monitor-setup-result.test.ts`：fakeDate模拟startup20ms、wake10ms，actualsource/WS/session/tool/lifecycle，只有transport fake；初始通知sink同步shutdown，应rejectsetupcancelled。同时独立对照正常timeout10ms、startup20ms，已创建monitor正常立即deadline收尾，必须仍started、1killednotice，不误归failedadmission。

首次fixture错误：Node mock.method不接受Array，替换仅临时测试messages.push而非全局Array原型后，修复前1/2fail：silencecase Missing expected rejection，deadline对照通过。生产仅改末次decide后返回值，复查reg.closed/mapidentity，不把正常terminaldeadline当cancel。修复后2/2正常退出、strict/noEmit与diffcheck通过。

README/monitor-contract/processprovenance同步最后callback guard与对照用例。当前主会话full416/416及三模块394/394自然gate通过，diffcheck通过（`/tmp/pi-bg/bwqlhmmhc.log`）；最后定向review1033038b续跑，结果尚未返回。3B仍暂停到独立门确认，wholeG3未验收。未触碰个人配置/真实模型/network/install/SDK/commit。
