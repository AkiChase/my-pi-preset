# 核心面板切片：实施与集中验证

## 交付时的结论（历史快照）

本文的466/444与“待审查/Down待实施”为核心切片首次交付快照。后续core-window窄修、Down和真实PTY已完成，当前统一结果见 [final-acceptance.md](final-acceptance.md)，不据下方历史状态重复派发实施。

共享核心UI已写入，旧概览与两套panel/footer删除/替换，主会话actualstrict/full466/466、三模块444/444无forceexit自然退出；当时独立review59d94a60进行中。G3/G4未提前勾；当时Down/真实TUI未交付。用户批准cooperativecancel及调整顺序见core-panel-slice/cancellation-boundary，未授权install/reload/个人配置/commit。

## 实际改动

- task-ui/model.ts：immutableidentity父子树、workflow新组默认展开、collapsedstate稳定、whole-root4秒/activeparent保留child、selectedpin；taskSummary只统计独立真实任务。
- task-ui/panel.ts：双栏选中即时有界detail，Tab焦点/scroll/copy/xscope/Escclose/sharedbgchord，safecontrol+SDKwidth，小屏保底。detail只16K+range/omitted提示，selectedpreview随source移除保留。不读backendmutablemap/session/controller。
- task-ui/owner.ts：唯一overlay/订阅/底栏、onClose先dispose再waitrelease、reentrantcustom/statusownership；compositioncontrols共享。coordinator新增finite identitydetail/stop，拒绝unknown/stale/closed且有界；source订阅重入guard。
- 删除agent ui/agent-widget、ui/fleet-list与实例/导航/旧settings(fleetView/widgetMode/showModel)、process ui.ts和panelownedstate。非UI格式/activity迁到agentactivity.ts，工具/通知/viewer/管理保留。processrenderSidebar只publish+hinttimer，不竞争footer；sessionstart在外部pub/widget后重查closed。
- mentionprivateWeakSet参数identity强制真实bg，ordinaryfrontmatter不变；明确拒绝/partialattemptthrow反馈原ctx但不重复fallback。agentdetail无offset读tail。

## 实施者与主会话验证边界

实施a2b0cf28达到turnlimit，actual44/41通过3失败；交付未完整验证、文档未更新。parent读取实际三个UI文件/coordinator/composition/source/registry与tests，接管窄修和文档，不再派大实现。

### 三个残留定向失败的判定

- 原source-stoptest只在TaskView.statusrunning触发；managerrecordstarting到onSessionCreated才结束，故实际runner已进入，calls1不能当产品早启动证据。parent改条件为actualstarting，保持calls0/notices0/waits0/timers0/artifact/closed断言，无改acceptedmanager取消算法。
- render安全test要求clean(line)==line，SDKwrap/ScrollView合法SGRreset也被误判；改为只允许SDKSGR而外部OSC/BEL/其他controls仍失败，visibleWidth全部窄屏断言保留。
- actualtypes+panel/tool44/44通过自然退出，日志 `/tmp/pi-bg/bns8g5vwf.log`。

### 第一轮集中检查：466/457、444/435

日志 `/tmp/pi-bg/bus8ixy06.log`，9失败：旧hostloader期待widget专用tool_execution_start；多个monitorfixture通过已删除的setStatus footer注入故障/推进Date，根本未触发；progress期待旧后台-onlyfooter。parent没有恢复旧UI来满足断言。

迁移原断言：

- hardhostloader保留根/child所有工具/commands/singleprettybash/ALS/shutdowncount，旧widgetevent改为明确不存在。
- monitorstartup故障通过actualreg.changed在job.stop/job.donePromise已owned后的wirepublication抛错；shutdown-afterwire、sourcepubreturn同步取消；Date推进移到sourceowned后的publication。原socket/fdstoponce、savedloglate不增长、retainedcounts、controller/hook/execution/timer0和notification0/1断言不减。
- progress验证source更新但无backendfooter，同时保留hintticker创建/terminal清理。sharedfooter分类/前台-only已在paneltest验。
- 一次“second source publication”fixture误假定必有两次publish，实际只一次导致started；只改fixture到明确的registrypublication-return重入，非产品失败/不改生产monitor。

### 最终集中检查

`PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules`，每次tempPI_CODING_AGENT_DIR：

- pnpmcheck strict/full **466/466**，0skip/cancel/fail（package脚本force-exit，不能当自然退出证据）。
- node --test三模块所有tests **444/444**，无forceexit，自然退出；包含实际cachedhostloader/worker/SDKepoch/process/monitor/agent/clone/panel。
- diffcheck通过，FULL=0 NATURAL=0 DIFF=0；日志 `/tmp/pi-bg/b0dk3e0hq.log`。
- mixed-waits actualshell+typedrunneragent新增真实TaskPanel：view/close仍4wait，panelbgchord全部release，PID/session/log/未consume保持；非仅stubtwoTaskViews。

README/provenance/currentextension/testing/cross-layerguide同步新UI与pendingDown；历史stage说明保留但标历史，不将cooperative限制当新blocking。无AGENTS新检查脚本，不生成dist。

## 当时待完成（已由后续切片闭合）

集中review唯一整组窗口缺口已修并独立3/3确认；随后Down独立14/14与实际SDK三情形通过，真实隔离PTY19项核心交互通过。没有重新打开核心实施范围。下一步仅按 [commit-plan.md](../commit-plan.md) 整理范围和待确认提交；不自动finish/archive/commit。
