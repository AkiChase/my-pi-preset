# 阶段 3A 结果与 3B 接口交接

## 实施范围

本段只完成 composition-owned 关闭协议和 process 实际执行／取消。没有递归委派；没有重写 agent manager/index 执行或旧 shutdown，agent 仅增加 typed options。未修改 scheduler、mentions、workflow、最终 UI、mixed-waits 或 hard child loader 测试。G2 的 runner 取消、transcript rollback、resume 数据／统计／tool-call 关联修复原样保留。**G3 未关闭，不能宣称所有后端已统一排序。**

遵循 implement.md 阶段 3A；真实 Pi 1.1.0 shutdown→新 factory，而不是旧 disposed factory 复活。没有引入 global UI/coordinator、假 agent participant 或 global epoch。before-switch 可取消／cwd 无效不 shutdown 时，不关闭现存 activation。

## 真实 typed API（供下一位 3B agent 使用）

```ts
import { TaskLifecycle, type TaskLifecycleParticipant } from "../../task-ui/lifecycle.ts";

interface TaskLifecycleParticipant {
    readonly name: string;
    freeze(): void;          // 同步关闭 admission AND 所有向外通知资格
    stop(): void;            // 同步发 silent cancellation，取消 timers/worker/clone/RPC 等
    drain(): Promise<void>;  // 实际 runner/startup/worktree/worker cleanup，不是 terminal handle
    dispose(): void;         // 最后解除 source/subscription，不能保留 runtime 为 UI
}

lifecycle.register(participant); // active 时登记，返回取消登记函数
lifecycle.onClose(closeUI);      // 同步 UI/入口 teardown hook，返回注销函数
lifecycle.phase;                 // "active" | "closing" | "closed"
lifecycle.active;                // 不可变 activation 的存活检查
await lifecycle.shutdown();     // 幂等：重复调用返回同一 promise
```

`TaskLifecycle(coordinator, drainTimeoutMs = 2_000)` 只由 composition 创建一次，后端 fixture 可以 scoped own。顺序：标 closing／coordinator freezeAdmission → **全部** participant.freeze → close hooks → coordinator.cancelWaits → **全部** stop → 每 participant 有界 drain → 全部 dispose → coordinator.dispose。所有同步 hook、drain 失败或超时逐项隔离并记录，不能让一个异常挡其他 cleanup。coordinator.freezeAdmission 只关登记，不提前执行 wait dispose；cancelWaits 与最终 dispose 独立，source.unsubscribe/dispose 异常隔离。

生产 `extensions/bash-unified.ts` 同时向 process 和 agent 传 `{ coordinator, lifecycle }`，最后登记 protocol 的 session_shutdown handler。`AgentTasksOptions.lifecycle?: TaskLifecycle` 已声明但**还没有消费**：旧 agent session_shutdown handler 仍先执行，无法满足“所有后端 freeze 先于任意 stop”的最终顺序。3B 必须把那个 handler 的职责迁成 participant，不是再登记第二个 protocol shutdown handler，也不是添加 fake placeholder。直接 agent fixture 若无注入，则依设计 scoped own 生命周期；不要复活已 disposed 实例。

process 的 `ProcessTasksOptions.lifecycle?: TaskLifecycle` 已实际消费；无 lifecycle 的直接 factory fixture登记自己的关闭 handler。返回值包含 `{ coordinator, lifecycle, source, openPanel }`。`createProcessLifecycleParticipant(reg, disposeSource)` 位于 `process-tasks/lifecycle.ts`，供实际 backend fixture scoped 使用；它 freeze closed/admission/notification，silent stop fg/bg/pending/monitor、abort refs、panel/ticker/sweep，await executions，然后销毁 source。

## Process 实际执行所有权

- `spawn.ts` 新 `OwnedExecution { done: Promise<SpawnExit>; stop(): void }`、`ownProcessExecution(pid, exit)`；`spawnWithFileOutput` 返回 `.execution`。stop TERM，250ms 未退出升级 KILL；实际 exit 清升级 timer，normal exit 后 stop 无 signal。停止中的 leader exit 只补杀仍存在 group，不回退到已退出 PID，防止 TERM-killed leader 遗留忽略 TERM 的后代。pid0 不发 OS signal。
- `BackgroundRegistry.executions: Map<Job, OwnedExecution>` 只在 backend；不是 TaskView/source detail 数据。startBackgroundJob 登记 `.done`，实际退出删除 identity 匹配的 entry；Job.markTerminal 的提前 donePromise 和 OS exit 不混用。fg parent abort／panel/jobs silent stop／shutdown 共用能力。
- `MonitorSource.execution?: OwnedExecution` 只供 backend；command source 使用真实 child exit/error，source.exit 仍是原 observation result。同步 stop 关观察/fd/pipe，实际 TERM→KILL 单独追踪。WS/pending pid0 安全，monitor 初批/合并/decoder/buffer/deadline/stderr 语义没有重写，显式 stop 不新增尾批。
- `BackgroundRegistry.closed` 在 assertJobSlot 禁新 spawn；旧 jobs 工具也拒绝。notice 与 monitor current 检查 closed；晚 exit 不改新 activation 的 counters/messages。throwing stop hook 不能挡 actual execution.stop、markKilled/abort 或 sibling cleanup；自然 exit 的可选 callback/display 异常隔离。
- 日志文件保留，旧 source 在 dispose 后为空，新 factory 从空注册表开始，不迁移执行状态。

## 修改文件

- `extensions/task-ui/lifecycle.ts`：新 composition-owned participant／close hook／有界关闭 API。
- `extensions/task-ui/coordinator.ts`：独立 freezeAdmission，source disposal 错误隔离。
- `extensions/bash-unified.ts`：单一 lifecycle 创建、注入、最后登记 protocol handler；注释明确 agent 3B 缺口。
- `extensions/agent-tasks/src/index.ts`：仅 AgentTasksOptions typed lifecycle option；不改旧 agent handler。
- `extensions/process-tasks/state.ts`：closed 与 backend-only actual executions。
- `extensions/process-tasks/index.ts`：注册真实 process participant，不再自行提前 dispose coordinator；关闭后 session_start 不复活。
- `extensions/process-tasks/lifecycle.ts`：actual execution 登记、scoped participant、closed admission、silent stop／exit异常隔离。
- `extensions/process-tasks/spawn.ts`：真实 exit-scoped TERM→KILL owner。
- `extensions/process-tasks/tools/bash.ts`、`tools/bash-bg.ts`：传实际 execution、前台取消及既有 timeout kill 使用同一 stop owner；保留通知归属和 timeout auto-background 规则。
- `extensions/process-tasks/tools/jobs.ts`：关闭 activation 的最小工具 admission guard。
- `extensions/process-tasks/monitor-source.ts`、`monitor-session.ts`：分离观察 result 与 actual OS exit，关闭通知守卫，不改批次语义。
- `extensions/process-tasks/notify.ts`、`registry.ts`：closed notice／sidebar late callback guard。
- `extensions/process-tasks/__tests__/activation.test.ts`、`process-harness.ts`：真实 backend/process 和 scoped typed fixture；不进入生产。
- `extensions/process-tasks/__tests__/index.test.ts`：旧 shutdown 后继续调用旧 jobs 的断言更新为拒绝／source已释放，不弱化实际无 orphan 检查。
- `extensions/task-ui/__tests__/lifecycle.test.ts`、`sdk-runtime.test.ts`：协议异常/order/idempotence 与真实 SDK lifecycle 方法 seam。
- `README.md`：用户关闭行为与开发验证；process PROVENANCE、preset extension/testing/monitor specs：真实 contract 和 3B 未完成边界。

## 实际验证与失败历史

使用只读安装 SDK `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules`，每条测试命令临时 `PI_CODING_AGENT_DIR`；未真实 pi install/reload、模型／网络、SDK 写入或个人配置修改。未运行 task start/finish/archive，未提交。

最终验证：

- `pnpm check`：strict/noEmit + **404/404**，退出 0；`/tmp/stage3a-check-final.log`（package test 自身有 force-exit，不能当自然退出证据）。
- `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts`：**382/382**，无 force-exit 正常退出；`/tmp/stage3a-noforce-final.log`。包含未改的 mixed-waits、actual hard root/child host loader 和真实 worker 测试。
- 新 3A target `node --test extensions/task-ui/__tests__/{lifecycle,sdk-runtime}.test.ts extensions/process-tasks/__tests__/activation.test.ts`：**11/11** 自然退出；`/tmp/stage3a-new-target3.log`。
- `pnpm typecheck` 多次真实 strict；最终由 pnpm check 重新执行通过。
- `git diff --check`、`python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-subagents-task-ux` 通过（当前 implement/check 各20条）。

失败历史不掩盖：

1. 首轮旧 target **303 pass /3 fail**：新 lifecycle constructor误用 native strip-only 不支持的参数属性导致两个 test file import失败；已改 erasable 字段。monitor 旧 local fake source UI rollback 断言要求一次 group TERM，首次忘了保持 optional execution 缺失时的 fallback，已修复，hard monitor test保留原断言。
2. 新 fixture 首次 strict：SDK generic tool renderCall variance、ExtensionToolContext 与 partial cast 类型不匹配；以有说明的单一 boundary cast和窄 CapturedTool 修正，没有 any/ts-ignore。
3. SDK fixture首轮 strict：activations/activate 自引用 inferred type 与 extensionsResult缺失；去掉递归类型，返回真实 createExtensionRuntime 的空结果。
4. 首次 full **397/399**：两个旧 index shutdown 测试继续执行 closed jobs；根据真实host contract改为 assert.rejects + source空，原无 orphan/通知/snapshot断言保留。
5. 扩展 target **9/10**：node mock.method替换 WebSocket constructor仍继承原 EventTarget prototype；改临时 global constructor替换与after restore，actual WS source/session/tool仍执行。最终11项全部通过。

## 验收边界与下一步

3A 覆盖 AC9 的 process/pending/monitor/attach/定时/旧新 activation/late callbacks/日志保留部分，以及 AC4 前台 cancel 的真实有界终止；AC10 进程／monitor旧 latch、mixed detach、自然通知回归保持，AC12离线 strict/full/natural target通过。真实 TUI、全 agent AC9、完整 G3、最终 UI/Down 均未验证／未实施。

主会话应核对3A实际diff/test后，派**另一位**agent做3B：

1. 消费现有 lifecycle option，把旧 agent shutdown 拆为同步 freeze/disarm（所有 nudge/group/batch/ctx/admission）→ stop（scheduler/clone/RPC/workflow/queued/startup/runner/nested）→ 实际 drain（不是 terminal handle）→ source/registry/subscription dispose；旧 handler不能先于protocol继续 abort。
2. runner/startup/worktree/partialsession actual cleanup ownership、clone创建/prompt/fallback cancellation、scheduler binding/timer/finalize、workflow worker/host wait/journal晚回调 origin ownership；保留全部 G2修复。
3. 复用 SDK runtime seam扩实际 agent/workflow矩阵，不手动 old session_start冒充真实新 activation，不绑定旧 closures到新 global manager。
4. 待3B关闭整个所有权顺序后再判断G3；最终 UI/editor/Down仍阶段4，TUI需用户另行批准。
