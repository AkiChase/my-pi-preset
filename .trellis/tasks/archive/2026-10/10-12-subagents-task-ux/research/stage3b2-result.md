# 阶段 3B2 结果：agent participant 与辅助执行所有权

## 范围与状态

本次直接实现 3B2，无递归 implement/check。沿 implement.md 的阶段3顺序消费已验收3A协议和3B1 manager API；不修改 manager/runner/worktree/process/monitor/task-ui 核心、最终 UI、旧 widget 移除或 model max_turns。没有模型／网络／真实 git／安装／真实 reload／个人配置／SDK 写入／提交／task start/finish/archive。

**3B2交付时的结论：**production agent participant 与本模块取消／输出封口已实现，当时严格 AC9 all-stop 未实现，G3未关闭。非协作的进程内 provider 或已经开始的第三方 hook 可能超过2秒继续写文件；不能用测试绿色、worker终止或terminal已resolve冒称全部停止。

**后续用户决策：**用户经解释后选择方案1，保留当前进程内架构，接受上述协作式取消边界；PRD R6/AC9已修订，见 [cancellation-boundary.md](cancellation-boundary.md)。不再以非协作代码不可强杀作为原严格要求的设计阻塞，但自有资源必须停止、旧接口/通知必须封闭。主会话独立审查仍在进行，G3未自动通过。

## 实际修改文件

- `extensions/agent-tasks/src/index.ts`：消费注入的唯一 TaskLifecycle；将旧 shutdown handler 迁入 participant。registered tool/command/input/RPC/mention/nudge/group/batch/usage/CLI workflow 路径在 admission、await 后及外部效果边界检查 activation。所有异步上下文捕获原 ctx，不把旧执行迁移到新 activation。增加 full clone/fallback、direct input/tool、worker/host gate 的实际 auxiliary promise 所有权，启动前先登记。manager stopped 终态订阅补齐 group membership，silent stopped 不吞自然 sibling。
- `extensions/agent-tasks/src/mention-clone.ts`：typed signal/isActive/loader-create seam；实际 reload/create/prompt 每个 await 边界检查。active prompt 由 session.abort 取消；late create 仅 local dispose，无 child shutdown hook。forced-background Agent 最多尝试一次，attempted 与 successful admission 分离，已尝试后 handler 失败不重复 fallback。
- `extensions/agent-tasks/src/schedule.ts`：每次 start 的 immutable pi/ctx/manager/store/controller binding，interval/once/cron/awaitStartup/finalize 均捕获并检查旧 binding。shutdown 取消 child signal，普通 disable 不改变已启动执行语义；不删除持久定义。resolveModel 仍同步。typed timer seam 不替换 scheduler/store；cron parser 临时验证 timer 立即 stop。
- `extensions/agent-tasks/src/workflow/host.ts`：gate 与 host agent/resume promise 归 index owner；signal 与 await 前后 guard；late resolved/control 不发布。worker terminate 不能代替 host exec 的实际 drain。
- `extensions/agent-tasks/src/workflow/runtime.ts`：late host result 在 schema/gate/journal/action 前检查 settled/aborted；pause/control、worker 构造和 progress 边界关闭；optional abort throw 不阻止 worker terminate。pipeline/parallel/schema/replay/intent retry 算法保留。
- `extensions/agent-tasks/src/waits.ts`：只增加 stopped 结果的通知过滤，保持 consumption/wait suppression/delivery latch；未重写 shared waits。
- `extensions/agent-tasks/src/cross-extension-rpc.ts`：narrow isActive guard，retained callback 和 awaited spawn 的 late reply 忽略 closing。
- `extensions/bash-unified.ts`：仅删除旧3B临时注释；仍注入同一个 coordinator/lifecycle、一个任务关闭 handler，pretty 独立 renderer teardown 保留。
- `extensions/agent-tasks/__tests__/auxiliary-lifecycle.test.ts`：actual clone loader/create/prompt/tool、real temp ScheduleStore+typed interval/once/cron、host gate actual exec promise、retained RPC 回归。
- `extensions/agent-tasks/__tests__/tool-waits.test.ts`：actual factory/source/participant、completed child extension-owned interval、repeat start、old tool/input、clone late create、busy worker、awaited gate、queue/startup/resume/retrieval、CLI workflow、自然通知及 scoped user stop、standalone single handler和同步完成回调 shutdown。
- `extensions/agent-tasks/__tests__/workflow.test.ts`：真实 worker late host gate、paused cancellation/control 回归。
- `extensions/agent-tasks/__tests__/host-loading-smoke.mjs`：保留 root/child/ALS/工具注册 hard assertions；shutdown 唯一性更新为 root/child 均是 composition + pretty 两个 handlers，不再减一个 agent legacy handler；root-only before_switch 仍只有一份且不破坏可取消 switch。
- `extensions/task-ui/__tests__/sdk-runtime.test.ts`：actual SDK new/resume/fork/import/quit 和 AgentSession.prototype.reload 均绑定真实 process/agent 到同一个 protocol；old active agent 被取消、old tools 拒绝、new factory 空状态可启动。保留 canceled/invalid switch、实际 shell PID/log/顺序断言。
- `README.md`、agent `PROVENANCE.md`、preset `extension-guidelines.md`/`testing-guidelines.md`：中文实际行为、开发命令、历史偏离与 all-stop 限制同步。
- 本中文交接：exact API、结果、失败证据和未覆盖边界。

## Exact API 与关闭顺序

生产 composition 仍创建一次 `TaskCoordinator` 和 `TaskLifecycle`，向两 backend 注入。`AgentTasksOptions.lifecycle` 现在被使用；未注入 lifecycle 的 direct factory 使用局部 protocol、只注册一份 session_shutdown；不复活旧 factory。

```ts
lifecycle.register({
  name: "agent-tasks",
  freeze() {
    // Synchronous: old ctx/input/tool/notice/group/RPC admission disarmed.
    // lifecycle.active is already false before any participant is invoked.
    manager.freezeAdmission();
  },
  stop() {
    scheduler.stop("shutdown");
    // Abort captured clone controllers and workflow run signals.
    manager.stopForShutdown(); // NOT ordinary abortAll; retained children included.
  },
  async drain() {
    await Promise.all([
      manager.drainExecution(), scheduler.drain(), drainAuxiliary(),
    ]);
  },
  dispose() {
    manager.sealHostEffects(); // FIRST synchronous action.
    void manager.dispose();
    // Then owned source/subscriptions/registry conditional release only.
  },
});
```

TaskLifecycle 原2秒预算不变；actual auxiliary promise 在 start 前登记，late promise 的唯一 owner 不在超时后丢弃。index 内 `own<T>(() => Promise<T>)` 同时供 workflow host gate/agent/resume 使用。worker promise 只表示 thread terminate，host pi.exec promise 独立纳入 drain。

新窄 seams：

```ts
interface MentionCloneDependencies {
  createSession: typeof createAgentSession;
  createLoader(options: ConstructorParameters<typeof DefaultResourceLoader>[0]):
    Pick<DefaultResourceLoader, "reload">;
}
// MentionCloneOptions: signal?, isActive?, dependencies?
// MentionCloneResult: spawned, attempted?, error?
// index AgentTasksOptions: mentionDependencies? (offline input seam only)

new SubagentScheduler(timers?: ScheduleTimers);
scheduler.start(pi, ctx, manager, store); // new immutable binding each time
scheduler.stop(reason?: "shutdown"); // ordinary disable does not kill spawned work
await scheduler.drain(); // actual owned startup/finalize promises

// WorkflowHostOptions: isActive?, own?<T>(start: () => Promise<T>): Promise<T>
// RpcDeps: isActive?: () => boolean
```

正常 host new/resume/fork/import/reload 是旧 shutdown 后新 factory/coordinator；可取消 before_switch 不清状态或永久停 scheduler，重复 session_start 不重复 source/RPC/timer/flag workflow。global registry 只在当前 entry 仍是自己时释放，child ALS guard 原样。

## 验证与失败历史

全部只读 Pi1.1.0 SDK：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules`，临时 `PI_CODING_AGENT_DIR`。strict noEmit，无 dist。所有下列最终命令 exit0：

| 命令 | 最终结果 | 日志 |
| --- | --- | --- |
| `pnpm check`（内部 typecheck + test） | **459/459**，strict通过；package test自带force-exit，不当自然退出证据 | `/tmp/stage3b2-check-final2.log` |
| `node --test extensions/agent-tasks/__tests__/*.test.ts` | **93/93**，无force-exit自然退出 | `/tmp/stage3b2-agent-final.log` |
| `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts` | **437/437**，无force-exit自然退出 | `/tmp/stage3b2-three-final2.log` |
| `node --test extensions/agent-tasks/__tests__/{auxiliary-lifecycle,tool-waits,workflow}.test.ts extensions/task-ui/__tests__/sdk-runtime.test.ts` | **42/42**，无force-exit自然退出 | `/tmp/stage3b2-target-final.log` |
| `git diff --check` | 通过 | 最终tool输出 |
| `python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-subagents-task-ux` | implement/check各22条通过 | 最终tool输出 |

失败不隐藏：

1. 初始红测试先用错 coordinator stop/getSource API 和 agent() grammar；这些 TypeError/timeout **不是产品失败证据**，已改为截获 actual registered source、`agent("late", { gate })`。
2. 有效旧代码红证据：retained result tool 关闭后没有拒绝；late worker host result 在 abort/terminate 后仍执行 gate（gates=1应0）。日志 `/tmp/stage3b2-red2.log`。正确 actual source stop 测试初始0 notice应1（`/tmp/stage3b2-red-stop.log`）；随后发现测试 rows按新到旧排序但 finish 错 sibling，纠正 identity 后新版通过，不把该最初失败单独当生产原因。
3. 临时 index改写脚本混入 Python slice/index/triple quote 语法，未成功写生产时退出；修正后一次 clone fallback括号替换过宽造成 compiler syntax失败，已定点修复。新 fixture missing ToolDefinition schema 与 generic own return spread 类型 strict失败均修复，无 any/ignore掩盖新增错误。
4. 首 full **443/444**：hard loader仍要求旧 root before_switch handler；保留root-only no-op handler而非弱化child guard。之后目标 **30/32**：shutdown数量未计 pretty独立handler、clone fixture settings/context错误。按真实注册（pretty src index session_shutdown）修正 root/child 都2；clone改用actual agentMentions与getSystemPrompt，不 mock整个 clone。目标2/2后full454/454，再增量最终459/459。
5. 后续定向42/42、agent93/93、三模块437/437自然退出，原 hard loader/mixed wait/monitor/runner/worktree断言继续执行；optional throwing participant test 的 console error 为预期，未阻断其他清理。

## 验收与未完成事项

已覆盖 AC9 的本模块 admission/notification/queue/startup/resume/worker/clone/timer/host gate/retained-child-owned resource/host换代边界；AC2/AC4/AC10 的已有等待/结果与自然通知回归保持，stopped group member 不额外报告且 sibling自然结果仍一次。AC1单一loading与pretty保持。AC12离线 strict/full/natural/whitespace通过。

**交付时未满足严格all-stop：**任意非协作进程内provider/create/hook/hostcall可能超2秒继续写；owner/取消/封口不能撤销其内部副作用。本轮没有改成workers或修改架构来假称满足。后续用户已明确接受方案1的协作式取消边界，修订验收不再要求强杀这些第三方代码；实际限制保留，自有资源停止和迟到隔离仍须独立审查，G3尚未关闭。

未执行真实TUI／真实模型／真实git／真实安装或用户会话切换；最终Task Panel/tree/Down/old widget removal 属阶段4。新增实际SDK矩阵覆盖双后端换代，但没有把每一种 clone/scheduler/workflow状态与每一种host换代方法做全笛卡尔积；个别辅助边界由actual factory/actual auxiliary单独覆盖。主会话需独立 review实际diff和此矩阵，不以fullgreen代替全部产品验收。不改task状态、不提交。
