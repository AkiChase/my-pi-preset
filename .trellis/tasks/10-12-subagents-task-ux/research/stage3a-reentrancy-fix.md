# 阶段 3A：monitor 同步启动重入修复

## 范围与已确认缺陷

本次只修复 reviewer `d45e71a5` 确认的 process monitor 启动重入阻塞，不进入 3B，不改 composition／agent／共享等待／SDK／个人配置，不运行模型、网络、安装、真实 git 操作或任务生命周期命令。此前 404 全量／382 三模块通过不能排除同步 callback 重入。

真实调用链：monitor 工具 `add(reg, job)` 同步发布 → source subscriber 调用 `TaskLifecycle.shutdown()` → pid0 Job 被 terminalize，但工具继续 `createSource` 打开 WS／日志 → `startBackgroundJob` 已终态分支只 stop pid0 execution 并删除 `job.stop` → session 在已 abort controller 上补 listener，永远不触发。关闭后的 source/fd 和 execution 因而未清理，旧工具还报告启动成功。source factory 内或 UI 接线中的同步 shutdown 有同类 ownership 边界。

## 实际修复 API 与所有权

- `tools/monitor.ts`：发布后立即检查 setup 资格，早于 source 构造。同步取消抛 `Monitor setup cancelled`，不返回 Monitor started。普通非终态 setup exception 才撤销 registry entry／totalStarted；已由 shutdown 计入的 killed record／统计保留，避免 totalStarted=0、killed=1。
- `monitor-session.ts`：`isMonitorSetupCancelled(reg, job)` 同时检查 closed／terminal／map identity；直接 `startMonitorSession` 创建源前也检查，返回 `"started" | "cancelled"`。保留 sinks-before-factory 接线；source once closure 由 session 捕获，terminal 删除 `job.stop` 后仍可清理。已 abort controller 立即静默清理，不等待第二次 abort。发消息 callback 后复查 current，避免 shutdown 后重新安装 timer；不改 buffer／wake／deadline／decoder 的正常语义。
- `lifecycle.ts`：`startBackgroundJob` 的已关闭／terminal／identity 失效分支保留 actual execution 归属，先调用 source hook（捕获错误），finally actual stop／abort／completion hooks 清理。sidebar subscriber／UI 返回后再次检查并返回已 abort controller，处理已发生的同步 shutdown。未改 TaskLifecycle register／freeze／stop／drain API。
- 日志不删除；未构造源的取消不打开日志，已构造源关闭一次；静默停止不发尾批、不通知旧 activation。source stop 抛错时 actual stop 与 backend map 释放仍执行。

## 新回归与反向证据

共新增 10 项，保留既有 hard assertions：

1. `activation.test.ts` 的 actual monitor tool/source publication subscriber 在 add 中 shutdown：拒绝启动，WS 构造次数 0、无新日志、started=1／killed=1。
2. 同文件 actual tool 的 UI hook shutdown，分别正常返回与随后抛错：取消／原异常，socket close 一次，保留 metadata／log／计数，不报告 started。
3. `monitor-session.test.ts` actual WS source 在 factory 构造后、sidebar hook、registry wire publish 中 shutdown：返回 cancelled，socket close 一次，关闭后 message／close／error 不追加日志或发通知。
4. 直接 session 的 closed／terminal／replaced admission：source factory 调用次数 0。
5. 同一 common terminal setup 分支 source stop 抛错：actual execution.stop 一次、done 后 execution map 清空，controller 已 abort，saved log 和 started／killed 不变。

重入测试只 fake WebSocket transport，实际执行 tool／source／session／registry／coordinator／TaskLifecycle。assert 实际 execution map、controller、foreground、wait、source snapshot、retry、sidebar／sweep、job.stop／donePromise／resolveDone 清空，无 cleanup timeout；已创建的文件 late frame 后字节不变且保留。

先加最初 8 项，在原实现上运行：**0 pass／8 fail**，日志 `/tmp/stage3a-reentrancy-red.log`。add 与 factory 重入各约 2004ms，走到 cleanup timeout；旧工具未拒绝，直接 admission 调用不该打开的 factory，terminal source stop 未执行。修复前的三个生产文件 narrow snapshot 位于 `/tmp/stage3a-reentrancy-before/`，未复制 vendor tree。

首轮修复 target **83/87**：四项 fixture 写了不存在的 `coordinator.sourceCount`，实际 API 是 `snapshot().length`；修正测试断言，不修改 coordinator／SDK。再补 actual tool UI shutdown/throw 两项验证统计 rollback owner。原 fake source startup rollback 的 `[-12345, SIGTERM]` 一次 group TERM 断言未改；首批、批次、事件、wake、deadline 测试未改。

## 实际验证

每条运行测试的命令均提供只读 SDK `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules` 与独立临时 `PI_CODING_AGENT_DIR`；退出后删除临时 agent-dir。未读写个人配置或修改 SDK。

| 命令 | 结果／日志 |
| --- | --- |
| `pnpm typecheck` | strict/noEmit 退出 0；`/tmp/stage3a-reentrancy-strict1.log` |
| `node --test extensions/process-tasks/__tests__/{activation,monitor-session,lifecycle,monitor}.test.ts` | **89/89**，无 force-exit 自然退出；`/tmp/stage3a-reentrancy-target2.log` |
| `pnpm check` | strict + **414/414**，退出 0；`/tmp/stage3a-reentrancy-full.log`；package test 自带 force-exit，不当自然退出证据 |
| `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts` | **392/392**，无 force-exit 自然退出；`/tmp/stage3a-reentrancy-noforce.log`；包含 mixed-waits、真实 hard loader／worker、SDK lifecycle seam |
| `git diff --check` | 退出 0 |
| `python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-subagents-task-ux` | implement/check 各 20 entries，通过 |

原 lifecycle 异常隔离测试本来会输出有意触发的错误／timeout；新增重入 fixture 单独捕获并断言错误数组为空，不能把全量日志有字样当成新泄漏。

README 用户关闭行为与开发命令、process PROVENANCE、monitor／testing spec 已增量同步。其他未提交工作保持原样；新增研究为中文，不更新任务 lifecycle 或整阶段勾选。

## 验收与交接边界

本修复覆盖 AC9 的 process monitor 同步启动／shutdown 边界、AC10 的不产生旧通知／静默清理回归及 AC12 的当前 offline strict/full/natural 检查。没有实施／验证完整 agent／clone／workflow／scheduler epoch 隔离、最终 UI／Down 或真实用户 TUI，不能据此宣称完整 3A／G3 或全部 AC 已关闭。

主会话应核对本次 narrow diff 与新重入证据，复核 reviewer 阻塞是否关闭后决定 3A 接受与 3B 派发；3B 仍使用已有 TaskLifecycle participant API，不由本修复重定义。未发现计划需要改线，只按阶段 3A process ownership 的确认阻塞窄修。
