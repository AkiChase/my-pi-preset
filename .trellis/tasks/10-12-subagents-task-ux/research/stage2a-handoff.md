# 阶段 2A 交接：共享核心与进程后端

## 范围与真实状态

本段只实施 task-ui 契约／coordinator／wait leases、公共配置／入口和 process backend 接入。agent backend 仅增加 typed options 并从 composition 获得同一个 coordinator，未接入 AgentManager。最终分组 panel、分类底栏、旧 AgentWidget/FleetView 删除、editor Down 和完整 session epoch 留给后续不同 agent。

不同 cwd child guard 由并行修复 agent 独立修改；本段没有改 child-context、host-loading-smoke/loading tests 或 agent provenance。实际验证包含其最新 same/different cwd 与重叠根加载测试，不替换 rootOnlyEvents 断言。

## 2B 应使用的实际 API

### 导入路径

从 `extensions/agent-tasks/src/index.ts`：

```ts
import type { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { taskKey } from "../../task-ui/types.ts";
import type { TaskIdentity, TaskView, TaskSource, WaitLease } from "../../task-ui/types.ts";
```

`AgentTasksOptions` 已导出，含 `readonly coordinator?: TaskCoordinator`；default factory 参数目前是 `_options`，还没有读取。`extensions/bash-unified.ts` 已执行 `agentTasks(pi, { coordinator })`，process factory 获取同一实例。2B 不新增顶层入口，不在 production 创建第二 coordinator，不重新注册 `/bg`／`/tasks` 或公共 chords。

### 身份／不可变 source

- `TaskIdentity = { sourceId, taskId, runId }`；`taskKey(identity)` 是 JSON tuple，无分隔符碰撞。agent 每次 resume 必须用新 runId，真实 parentKey 用相同编码，workflow/nested 按真实 owner。
- `TaskView` 有 kind、status、executionMode、waitCount、time、stats、artifacts、有限 capabilities；嵌套字段也须冻结，不泄漏 AgentRecord、session、promises 或 controller。
- `TaskSource` 提供 `sourceId`、revision、`list()`、有界 `detail(identity, { offset?, limit? })`、`stop(identity): boolean`、`subscribe(listener): unsubscribe`、`dispose()`。详情目前同步返回有界文本／范围／路径，后端维护 transcript读取和订阅；如有额外 workflow 显示元数据需要，扩展具体只读字段，不塞 generic engine 或 unknown record。
- `coordinator.registerSource(source)` 返回幂等 unregister，只移除订阅／source 引用；source dispose 由 backend 所有者调用，coordinator 最终 dispose 也会释放仍登记的 source。
- `coordinator.snapshot()` 返回冻结的 source views；`list()` 聚合 tasks。`subscribe` 观察 source/wait 改变；adapter 如果用 waitCount，应订阅 `subscribeWaits`，不要订阅一般 `subscribe` 再发 source changed（会递归）。
- process 先例在 `extensions/process-tasks/source.ts`，`PROCESS_SOURCE_ID="process"`，`processTaskIdentity(jobId)` 的 runId=jobId；日志读复用 readLogSlice，stop 调 terminateJobSilently，不发 monitor 尾批。

### Lease 与消费归属

```ts
const lease = coordinator.registerWait<Result>({
  identity, label, kind: "launch", signal,
  onDetach: () => { /* unlink all backend parent links, transfer ownership once */ },
  onInterrupt: () => { /* stop this genuinely foreground launch */ },
  onDispose: () => { /* release this old run when epoch owner closes */ },
  onComplete: () => { /* atomically consume this inline result */ },
  cleanup: () => { /* release only wait-owned links/timers/renderers */ },
});
// actual per-run terminal promise must call lease.complete(result)
const outcome = await lease.result;
```

- `lease.complete(value)`／`detach(reason="manual")`／`interrupt()`／`dispose()` 返回本次是否胜出；`settled` 可查。result.kind 是 completed（value）、detached（reason）、interrupted 或 disposed。不能仅 Promise.race 而绕过完成消费竞态。
- coordinator 删除 signal listener，取出 lease，并同步调用 winning callback，然后 cleanup、resolve 和通知。`onComplete` 在 count抑制更新前消费；callback/cleanup失败隔离记录仍完成租约，不阻断 sibling。
- retrieval 用 `kind:"retrieval"`，不会调用 launch 的 onDetach/onInterrupt，保持后台 executionMode；可以设置 cleanup／onComplete／onDispose。
- `detachAll()` 解除所有 launch/retrieval，不 abort 主 turn；`waitCount` 是总数，`countWaits(identity)` 是该 run 数。多个 retrieval 不得共享 boolean抑制，按各自计数释放。
- `cancelWaits()` 可供阶段3取消旧 epoch，实例仍可登记下一组；`dispose()` 最终关闭，不能再 register。完整关闭顺序、admission冻结和旧通知抑制尚未实现，勿把此方法当作已通过 AC9。

## 进程实际变更

- bash spawn后首次 await前注册 launch lease；显式 detach 参加两秒 quick窗口，立即返回原 ID/PID/log。timeout继续存在；lease detach 同步移除父 signal，后续父 abort 不杀任务。
- 后端从启动即拥有 exit/watcher，foreground 不另做 terminal transition；markTerminal 幂等释放 job hooks。终态不删 registry或unlink日志；started与终态计数包含foreground，promotion不重复started。
- jobs attach 注册 retrieval lease，已 abort signal立即结束；wait:false 仅报告运行状态，不能说finished或消费running结果。完成wins由onComplete消费，cancel/detachwins重新考虑notification。
- attachCount保留为backend delivery抑制计数，coordinator waitCount是读模型，二者不能混为mode。取消一个不会清除siblings。
- `notificationRetries` 是 registry里的backend终态重查表，stop/session清理／成功send／inline consume解除；monitor仅保存已经取出的bounded payload，不改source timer/buffer，也不explicit stop flush。
- production process factory注入时只注册后端diagnostic；composition调用 `registerTaskControls` 一次。直接fixture省略options才创建本地coordinator与controls。未安装input handler；保留的 input.ts函数仅continue，测试证实无handoff。
- 过渡进程panel加入fg行、mode/wait标签和内部bg chord，Esc仍只close；它不是最终shared grouped UI。

## 配置／文档

- `extensions/task-ui/config.ts`：task-ui.json；shortcutBackground默认ctrl+shift+b、shortcutTaskPanel默认shift+down，支持string／array／off。
- `downOpener=false`为后续保留配置，true也只警告无listener，不能对用户声称已有Down入口。
- process配置删除旧shortcut keys及env读取，无fallback；`/bg-list`不再注册。README、process provenance、extension/testing/monitor specs同步。

## 验证

最终计数：isolated `pnpm check` strict + 339/339通过（`/tmp/stage2a-check-final2.log`）；三模块 `node --test` 不带force-exit 317/317正常退出（`/tmp/stage2a-noforce-final2.log`），其中当前vendor6项包含修复后的真实different-cwd/overlaprootloader与worker。新core+waits定向23/23通过。gitdiffcheck和taskvalidate通过，两份JSONL各18条。

全部检查使用实际SDK安装目录与临时agent-dir，不读写个人配置，不安装、reload或调用模型。一次setupfailurefixture未实际触发diff-before-write导致等待，已只终止隔离测试PID，修正强制首写后定向与完整检查均通过；不把强制停止那次当成功。

覆盖真实coordinator、真实bash/jobs/source、可控fake exits、隔离subprocess：all leases、重复detach、同tickrace、detach后signal、already-abortedretrieval、两个attach计数、早于2s detach、foreground success/failure/kill日志保留、timeout、sourceimmutable/bounded/mode/wait、普通input、registrationownership、monitorterminalcancel竞态、fg-onlypanel、callback和setup失败清理。

尚未验证／未做：实际模型agent、agent queue/startup/worktree/resume/pool/delivery、全后端session换代、最终workflow/UI与真实用户TUI。主会话核对2A差异后委派2B；不得将G2整体勾选完成。
