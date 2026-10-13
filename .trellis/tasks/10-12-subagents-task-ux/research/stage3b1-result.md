# 阶段 3B1 结果：manager 实际执行清理

## 范围与 gate

遵循 implement.md 阶段 3 的顺序拆分，仅实施用户派发的 3B1 manager／runner／worktree backend。没有递归委派、修改 index/composition/task-ui/process/clone/scheduler/workflow、旧 UI 或 model max_turns；没有 task 生命周期／提交／安装／reload／个人配置／SDK 写入／真实 git／模型／网络操作。**production agent participant、clone/scheduler/workflow worker 仍未接入，G3 开放。**

## 修改文件

- `extensions/agent-tasks/src/agent-manager.ts`：私有 actual executions 集合，startup/new/resume/output/worktree/session stop/close 均有 owner；公开 terminal 不冒充实际结束。同步 freeze 禁入场／外部 callback，stop 关闭输出、清 pending steer、取消子树并 release 当前 pool 一次。dispose 稳定有界，公开 map 清空后保留 late cleanup owner。
- `extensions/agent-tasks/src/agent-runner.ts`：cleanup-only early session ownership（create 返回、bind 前）、shared abort/close promise、部分会话 local-only late teardown；订阅失败／抛错清理逐项隔离，取消后 event 不继续限额 steer。保留正常 provider failure resume、父 detach、hard limit、current-run text/stat/status 等 G2 契约。
- `extensions/agent-tasks/src/worktree.ts`：可选 signal 经 pi.exec，await 边界取消守卫，partial add 候选 path 可捕获；保存错误／关闭保留 tree，不强删未知更改。正常成功保存 branch 后使用 non-force remove。
- `extensions/agent-tasks/__tests__/runner-cancellation.test.ts`：新增 actual manager+runner new/resume drain、late create/bind、非协作 prompt、queued/nested/reentrant close、throwing subscriptions/output 等 7 项。
- `extensions/agent-tasks/__tests__/backend-waits.test.ts`：新增 stopped 非协作 runner 释放 transferred current pool 一次，late settle 不双减／允许错误超限的回归。
- `extensions/agent-tasks/__tests__/worktree-lifecycle.test.ts`：新增 6 项真实 create/cleanup + fake pi.exec/tempfiles 测试，含 partial add、await cancellation、保存失败／generated branch、delayed cleanup、active artifact timeout。
- `README.md`、agent `PROVENANCE.md`：用户行为、安全保留偏离、验证命令与阶段边界同步。
- `.trellis/spec/preset/{extension-guidelines,testing-guidelines}.md`：actual drain 与 terminal 分离、host effect 截止、artifact 安全及离线证据。
- 本结果文档：3B2 exact API 与限制交接。

## 给 3B2 的 exact API

```ts
manager.freezeAdmission(): void;
// 同步关闭 admission、notifyChanged/subscribe 和外部执行 callbacks，停 sweep，
// abort cleanup git signal。不执行 global 切换、不恢复这个 manager。
manager.abortAll(): number; // 普通取消，不替代shutdown stop
manager.stopForShutdown(): number;
// 先freeze/abortAll，幂等启动并track所有settled/retained child hooks。
// active prompt/bind先cancel，hook等actualrunner cleanup，不提前dispose。
manager.sealHostEffects(): void; // protocol finaldispose前同步封口，永不reopen
// 排队优先，silent backend cancellation（输出取消、父 link／terminal释放、
// nested scoped stop、partial/current session.abort），current pool lease只 release一次。
await manager.drainExecution(): Promise<void>;
// 没有内部 deadline；等待全部私有 actual startup/new/resume/output/worktree/
// session stop/close，包含 stopped actual work 和后来接住的 partial session。
// protocol 的 2s budget 在外部；超时后本方法仍能观察 private late owner。
await manager.dispose(pi?): Promise<void>;
// 非 async 包装，重复调用 === 同一个 promise。单独调用也 freeze+stop。
// 最多2s后清 agents/startups/runs/tombstones/listeners/optional sinks，
// 但不丢 actual executions 的唯一 late owner。pi参数仅保留调用兼容，不 prune。
manager.executionCount: number; // readonly finite diagnostic，不给UI mutable refs
await manager.waitForAll(): Promise<void>; // normal queue + actual stopped cleanup
```

`getRun().terminal`、`record.promise`、`isRunActive` 保留 G2 terminal/result 语义。不要把它们当实际 drain；修改 isRunActive 为执行 promise 尾部状态会破坏完成通知和立即 workflow followup。实际清理在 settle 之前已完成，settle 后只剩 promise bookkeeping；不要为这几个 microtask 阻止正常显式 resume。

runner 新窄选项（默认真实 host，不增加全局替换）：

```ts
RunOptions.onSessionOwned?: (session: AgentSession) => void; // cleanup-only BEFORE bind
RunOptions.canEmitShutdown?: () => boolean; // bounded owner后禁新child host hook
stopChildSession(session): Promise<void>; // 同一个取消周期 concurrent abort 去重
shutdownChildSession(session, { emitShutdown?: boolean; canEmitShutdown?: () => boolean }): Promise<void>;
// shared stable close；正常 shutdown hook最多3s，finally local dispose once
```

worktree：

```ts
interface WorktreeOptions {
  signal?: AbortSignal;
  onCreated?: (tree: WorktreeInfo) => void; // add结束/失败/取消，候选path也可保留
}
createWorktree(pi, cwd, agentId, options?): Promise<WorktreeInfo | undefined>;
cleanupWorktree(pi, cwd, tree, description, options?): Promise<WorktreeCleanupResult>;
// result新增 preserved?: boolean、已有path；hasChanges:true在preserved时包含未知状态，
// 不是已成功保存。仅成功创建的branch以branch字段报告。
```

3B2 使用现有 `TaskLifecycleParticipant`：freeze 同时先 disarm index 的 notices/nudges/RPC/ctx并manager.freezeAdmission；stop 关 scheduler/clone/worker并 **manager.stopForShutdown()**；drain 返回真正 owned work（含manager.drainExecution）；protocol final dispose 首先同步 **manager.sealHostEffects()**，再 `void manager.dispose()` 并解除source/subscriptions/registry。所有已完成／retained child hooks必须在host-valid stop/drain中启动并track，不能猜测clearCompleted/sweep会释放它们。单独 `await manager.dispose()` 自带stopForShutdown和2sbudget，完成或超时seal；它不再无条件从入口就禁hooks。确切修正见下方review follow-up，原handoff的abortAll recipe存在阻塞缺陷并已被替代。

## 安全偏离与不可保证的限制

- 原“取消后 force remove fresh tree”和“dispose detached prune”改为安全保留：真实 git add 30s、protocol drain 2s、child hook 3s之间没有保证 all-stop 的通用强制能力。partial add 的路径／文件／注册和 runner 正在写的 tree 必须保留，关闭后不启动 git；正常完成仍保存分支并 non-force remove。此为生命周期内安全偏离，未改变 scheduler/workflow算法。
- provider/SDK create/bind/第三方 shutdown hook 是进程内 promise，无法从本 backend 强制终止非协作实现。超过2s只关闭自己的公开状态、输出订阅和通知资格，私有 owner 继续接晚结果；**不能证明全部资源已停止，不能承诺没有第三方继续写文件。**封口／budget到期后的迟到创建只 local dispose，不能发新 prompt、steer、git、manager callback；已开始的第三方 hook 也不能被本模块撤销。日志/session/memory/generated branch/tree不删除。
- 未做真实 TUI／安装／切换；生产 participant 未迁移，不能将本段当全 AC9／G3通过。3B2仍须 index admission/notice origin、clone cancellation/fallback、scheduler binding、workflow worker/host/journal真实所有权和统一排序。

## 验证与失败历史

均临时 `PI_CODING_AGENT_DIR`，只读 SDK `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules`，strict/noEmit，无 dist。

最终命令：

- `pnpm check`：strict + **430/430**，exit0，`/tmp/stage3b1-check-final3.log`。package test自身force-exit，不作为自然退出证据。
- `node --test extensions/agent-tasks/__tests__/*.test.ts`：**64/64**，无force-exit正常退出，`/tmp/stage3b1-agent-final.log`。
- `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts`：**408/408**，无force-exit正常退出，`/tmp/stage3b1-three-final2.log`，保留actual SDK lifecycle/hardloader/worker/mixed-waits。
- target runner+worktree **29/29** natural exit，`/tmp/stage3b1-target3.log`；最后8项3B1/pool target也通过 `/tmp/stage3b1-pool.log`。
- `pnpm typecheck`多次实际strict；最终由check重跑；`git diff --check`和task validate（implement/check各21条）通过。

失败记录：

1. 新增最初两个actual tests先在旧实现执行，**0/2通过**：waitForAll提前返回和dispose promise非stable，`/tmp/stage3b1-baseline.log`。
2. 首strict遇 AgentRecord.worktreeResult旧窄类型不接受inline extra path；用typed结构兼容赋值修复，不改types scope。
3. 为适配protocol synchronous dispose，late create/bind shutdown改local-only，原新增断言仍要求hook1，target **24/25**；修正为真实安全契约hook0／dispose1，已有active startup hook回归未弱化。
4. 一度把 isRunActive 纳入promise尾部，agent **48/59**；已恢复 G2通知语义。尝试只阻normal resume也导致 immediate workflow followup失败（**58/59**），已撤销bookkeeping阻塞，不改workflow或旧assert。
5. final optional callback reentrant二次status判断被TS控制流错误窄化，strict失败；改读真实AbortSignal守卫，无cast/any/ignore，随后完整430及64/408均通过。

验收覆盖：AC9中的manager queue/startup/new/resume/nested/late callbacks/artifact部分，AC2/AC4/AC10已有G2回归保持，AC12离线strict/full/natural通过；全agentproduction、全AC9/G3和TUI未验收。主会话应review这部分diff，再给另一agent派3B2，勿提前勾G3。


## 3B1 复核 follow-up：review 842266a9 的 completed child 阻塞（已修复）

旧报告将 manager dispose 入口无条件禁child hooks描述为安全边界，但因此漏了completed/active workflow retained child只由session_shutdown持有的extension资源。SDK core dispose不补emit shutdown；`freeze → abortAll → drain → dispose`不足，不能用clearCompleted或解除retention的sweep workaround代替shutdown。此为确认阻塞，本段只修manager/runner/fixture/docs，未进入3B2或改G2。

### 替代 exact recipe

```ts
// 3B2 TaskLifecycleParticipant对应阶段，不修改protocol itself：
freeze() { /* index notices/timers admission同步disarm */ manager.freezeAdmission(); }
stop() { /* scheduler/clone/worker取消 */ manager.stopForShutdown(); }
drain() { return manager.drainExecution(); } // protocol已有2s budget
// protocol drain完成/超时后，这个同步dispose不能等待额外host窗口：
dispose() { manager.sealHostEffects(); void manager.dispose(); /* source等解绑 */ }

// standalone调用方仍valid并且await它；内部自己的2s budget允许hooks：
await manager.dispose(pi); // 自带stopForShutdown，到期/完成seal，重复===同promise
```

`stopForShutdown(): number`先freeze＋abortAll、清queue/output；每activation幂等。忽略display retention，对全部settled run sessions/record.session启动并track shutdown promise。completed parent/owned child都包括；未settled的starting/prompting/stopped actual runner必须先取消，实际结束后的原closeRunSessions接hook，不能因terminal先resolve而提前dispose。`abortAll()`保持普通取消语义，不修改pool/resume/result或取消周期WeakMap逻辑。

`sealHostEffects(): void`同步永久关许可。runner的`shutdownChildSession(session, { canEmitShutdown?: () => boolean })`在actual hasHandlers之后、emit之前读取permit，不以预先捕获bool冒充截止。manager/partial runner均传live predicate；final seal/budget后late create/bind/end只能local dispose，不发新hosthook。已开始hook的promise仍tracked并受原3s ceiling；无法撤销任意第三方hook内部的迟到副作用，非协作provider限制仍存在。

### 本 follow-up diff

- `agent-manager.ts`新增stopForShutdown/sealHostEffects，directdispose不再入口无条件禁hook；停止阶段登记completed/retained child，finalization保留lateowner且seal。
- `agent-runner.ts`窄`canEmitShutdown`参数在actualemit边界检查。
- `runner-cancellation.test.ts`新增7项actualmanager/runner回归；绑定真实owned interval（只有shutdownhook清理），不是只断言fakecounter。覆盖retainedcompleted／directdispose、runningchild+completedparent、throwinghook+sibling、latecreatebudget及fileartifact、hasHandlers撤销permit、pendingcompletedhook超过disposebudget后的retainedowner。旧protocol-latecreate测试增加明确seal以区分standalonevalidbudget。
- README/agentprovenance/extensionspec/testingspec/本结果修正旧claims并给可调用API。未写index/TaskLifecycle/composition/process/clone/scheduler/workflow/worktree或旧UI。

### 最终验证与失败历史

隔离临时PI_CODING_AGENT_DIR，只读Pi1.1.0SDK，无模型/网络/install/reload/真实git/SDK写入/个人配置/commit/task生命周期：

- 新两个completed/directactualinterval回归先旧实现**0/2**：hook0应1，确认resource仍active，`/tmp/stage3b1-followup-baseline.log`。
- 首strict暴露fixture给SDK genericemit直接赋Promise<void>不匹配；改为已有partialsession边界上的窄shutdowneventfixture，未any/ignore，`/tmp/stage3b1-followup-target1.log`实际29/29通过。
- final `node --test .../runner-cancellation.test.ts` **30/30** natural，`/tmp/stage3b1-followup-target-final.log`。
- final `pnpm check` strict/noEmit＋**437/437**，`/tmp/stage3b1-followup-check-final.log`（package自带force-exit，不作自然退出证据）。
- agent `node --test extensions/agent-tasks/__tests__/*.test.ts` **71/71** natural，`/tmp/stage3b1-followup-agent-final.log`。
- 三模块 `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts` **415/415** natural，`/tmp/stage3b1-followup-three-final.log`，hard SDK loader/worker/mixed-waits不弱化。

AC9的completed/retainedchildshutdown资源漏关闭blocking已覆盖，原G2通过；G3/全productionparticipant仍未完成，3B2应消费替代recipe。不能承诺非协作provider/任意第三方hook全部资源在budget内停止；超时后只保证自身effect封口和privateowner保留，不自动复活或删diskartifact。
