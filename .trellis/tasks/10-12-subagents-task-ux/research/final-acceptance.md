# 最终验收与提交前收尾

## 后续提交授权

用户随后明确要求“提交吧”，授权按`commit-plan.md`执行限定范围暂存/提交；没有授权finish/archive、push、install/reload。提交前隔离复跑strict/full483/483与三模块461/461自然退出，`/tmp/pi-bg/bx42ym7ad.log` exit0、`COMMIT_CHECK_OK`。下方“本轮仅整理/未提交”是之前验收收尾快照，技术验收边界不变，产品运行时代码未再修改。

## 当前结论与执行边界

本任务的核心实现、自动回归、逐段独立审查和授权隔离真实终端冒烟已经完成；当前只整理文档与提交清单，不新增功能、不重复全量测试矩阵。用户本轮“行”批准的是整理提交范围，**不是提交、finish/archive、push或切换日常Pi安装的授权**。任务保持`in_progress`，git index未暂存改动。

基线：分支`feat/unified-task-panel`，HEAD `07ec6bc chore: record journal`。相邻monitor-wake已在`85c6189`实现、`db22872`归档；本轮保留其batching/wake/双流/通知契约，不重做该需求。Pretty兼容和模型侧turn-limit另属独立任务，不合入其未提交改动。

## 验收证据（不新跑检查）

主会话本次重新读取最终日志和三个真实PTY报告确认：

| 检查 | 最终结果 | 证据 |
| --- | --- | --- |
| `pnpm check`（strict＋完整测试） | 483/483，0fail | `/tmp/pi-bg/bsowz6kd3.log`；项目test脚本有force-exit，不能拿它证明自然退出 |
| 三模块所有测试，无force-exit | 461/461，正常退出 | 同一日志，`FULL=0 NATURAL=0 DIFF=0 MANIFEST=0` |
| 核心UI独立审查 | panel/tool/mixed45/45；唯一整组窗口问题窄复核3/3关闭 | [core-panel-review-fix.md](core-panel-review-fix.md) |
| Down独立审查 | editor14/14＋actualSDK三场景确认安全回退；原blocking关闭；GC4/4 | [down-result.md](down-result.md) |
| 真实installedCLI/140×40PTY | 分段13＋3＋3共19项PASS | [tui-smoke-result.md](tui-smoke-result.md)；第三轮无error、natural_exit=true |
| 文档/manifest检查 | 本轮最后运行diff-check、JSONLvalidate及相对路径检查 | 当前JSONL31项各；本轮收尾材料增加后重新validate；不改运行时代码 |

真实PTY报告：

- `/tmp/pi-real-tui-smoke-6ouRGH/report.json`：13项PASS，随后fixture错误期待`PTY child`而实际handle为`general-purpose`中断。
- `/var/folders/fx/bn7t1rq16xn7_66t233x_s1h0000gn/T/pi-real-tui-tail-lpv4erj9/report.json`：workflow三项PASS，随后fixture End误选已停止child中断。
- `/var/folders/fx/bn7t1rq16xn7_66t233x_s1h0000gn/T/pi-real-tui-close-zj3buryg/report.json`：monitor/new/quit三项PASS，无error、自然退出、临时进程清理。

前两轮error仍保留，没有把捕获异常后exit0当成功，没有修改产品去迁就错误预期。PTY中的agent使用原生faux离线脚本响应，实际创建childsession/执行本地bash；workflow用真实worker，不是在线模型自主质量验证。

## PRD验收归并

| 标准 | 现有证据与边界 |
| --- | --- |
| AC1 | MIT/provenance、精确0.20.0artifact、manifest/conflicts、cachedhostloader根/同不同cwd子ALS、单一prettybash注册 |
| AC2–4 | coordinator launch/retrieval、实际process/manager/tool与mixedwaits；queue/startup/resume/同tick完成/父信号解绑；Esc与面板查看分离；PTY验证原PID继续 |
| AC5 | panel实际组件的即时有界详情/模式wait/滚动/宽度/pathcopy/scopedstop；PTY看到shell/真实childtool结果 |
| AC6 | stableidentity/default展开/collapse、activeownerchild保留、groupend4秒；actualspawnAndWait→sweep→新panel0/3999/4000回归；selectedfinalpreview独立保留 |
| AC7 | 旧AgentWidget/FleetView/进程panel与配置/导航删除，共享owner/footer；高级`/agents`与viewer保留 |
| AC8 | publicfocus/autocomplete/overlay与原handleInput委托；actualSDKsameinstancehandoff保state；失败preflight不卸载；opaqueGC；真实PTYDown/草稿/导航 |
| AC9 | 实际OSexit/TERM→KILL、monitorresource、manager真实drain、retainedchildhooks、clone/scheduler/worker/hostgate旧activation隔离；SDKnew/reloadseam与PTYnew/quit；按用户批准cooperative边界验收 |
| AC10 | consumed/waited/delivered区分、单次完成归属、group自然兄弟不被stopped吞掉、cancelretrieval仍notice；相应tool/backend/monitor回归 |
| AC11 | 规范module/config/commands，无旧名执行fallback；非UI能力代码与针对性回归见下表，不宣称未测试的全功能矩阵 |
| AC12 | strict/full/naturalexit/独立review/PTY结果如上；失败/未覆盖场景诚实记录 |

## 非UI能力保留与验证精度

| 能力 | 实际保留/现有回归 |
| --- | --- |
| custom agent discovery/frontmatter | `custom-agents.ts`/`invocation-config.ts`保留；foundation真实临时全局/项目precedence与tools，clone实际foregroundpin回归 |
| steering/resume/queue/nested | 原控制入口保留；backend/tool/runner测试覆盖same-session/newrun/信号/pool/descendant/软硬限额；PTY前台/queued/heldchild |
| scheduling | schedule/store/menu保留；auxiliary真实store与typedtimer seam验证interval/once/cron捕获binding、shutdown取消、迟到finalize不串新上下文 |
| workflow pipeline/parallel/schema/gate/replay/control | runtime/worker-source/schema/journal/host/menu完整保留；actualworker/RPC/abort/pause/latehostgate/不retry stoppedchild与PTYgroup验证。未单独穷举每种schema/replay/算法组合，不把保留源码称为全矩阵测试 |
| worktree | 原能力保留；fakeexec＋临时文件执行actualcreate/cleanup取消、partial保存与失败artifact保留；本轮未真实Gitworktree矩阵 |
| mentions | 实际clone/reload/create/工具/cancel/forcedbackground/refusal/partialattempt回归，定向resume call关联保持 |
| memory/usage | 原`memory.ts`及runner读写调用保留；usage/terminalstats/tool回合统计有回归，未专门模拟完整持久记忆交互；旧UI删除提取`activity.ts`不删非UIformat/helpers |

## 明确未承诺

- 任意非协作进程内第三方provider/create/hook被强杀或停止内部写入；用户已批准协作式取消，接口/通知封口、原cleanupowner与文件保留，自有资源不豁免。
- 任意终端尺寸、任意后续不delegate factory插件、真实input-history原包所有顺序或相邻Pretty兼容任务已合入；Down对真实SDK/Pretty与等价inputwrapper的已测路径保持状态，限制已在README说明。
- 在线模型自主质量/provider认证/真实Gitworktree全面验证。
- 普通面板富Markdown完整移植；已交付有界文本对话/日志预览，高级viewer保留。

## 当前提交边界

完整路径和混合spec的精确纳入/排除见 [commit-plan.md](../commit-plan.md)。本任务只提交product/source/tests/docs和本任务材料，不把所有`.trellis/`未跟踪文件整体加入；语言/工作流/bootstrap规则与相邻任务保持外部所有权。large vendor/lockfile变化都有来源解释，不通过`git add -A`隐藏混入。
