# Source 最终三方集成独立检查（2026-10-15）

## 结论

**PASS（仅本轮 source 集成检查）。** 未发现三方合并丢失已提交的完成通知 owner，或回退已审阅的运行任务接口合同。Source 的单独遗留 Beautify 测试已完整迁为 `task_manage` detail 测试，不再调用已删除 adapter；目标七动作宽度矩阵及旧名称无 adapter 负向检查均保留。

这不是重新做全产品审查，也不替代 N1 专项 reviewer `6d41` 的结论、main 正在进行的 fresh strict/full、整体验收或生命周期接受。产品仍为 **main HEAD `8158d31056b42e316039e64496903cf052ff4d46` 之上的未提交改动**，检查时 index 为空。本 reviewer 没有产品编辑、start、授权提问、commit、install/link/sync/reload、递归委派或归档；唯一仓库写入为此报告。后台检查只使用自己创建的临时 agent-dir，退出时按路径 guard 清理。

## 检查输入与方法

执行项目：`/Users/jyxc-dz-0101322/tools/my-pi-preset`。比较对象为 source HEAD、当前 source 与既有 `.worktree/10-14-runtime-task-tools` 的实际文件，不以摘要或旧 ready 文件代替当前产品。

读取当前 workflow、development/testing 约束、PRD 核心边界、`integration-boundary.md`、`stage-2-implementation-report.md`、四项修复报告与独立 recheck、目标 N1 修复报告；读取 `integration-review/ready-plan.json`、冲突产物及完整 merged tool-waits 和当前 source 对应测试。旧 `.trellis/spec/preset/index.md` 不存在，实际使用 current development/testing，不恢复目标旧规范。

巨大 `agent-tasks/src/index.ts` 仅对本次 HEAD/target diff 及所需 owner 方法作定向读取，**不声称重新全文审查整个入口或所有产品**。N1 owner/test 仅做 target→source byte-retention 核对，没有重复专项错误探针。

## 1. 已提交通知 owner：保留

- `extensions/agent-tasks/src/spawn-input.ts:1–19` 与 source HEAD **byte-equal**：缺省/null/空白 description 回退类型，非空原值保留，非法类型拒绝；type/prompt/options 的最小 guards 未被旧 target 覆盖。
- `agent-manager.ts:638–658,1017–1019,1065–1067` 保留 manager admission 规范化和 record/worktree cleanup 的同一描述。Source 对 target 的差异仅为既有规范化 import、admission/record 与两处 cleanup，不撤回 target retained capability。
- `index.ts:767–793` 保留解析实际 dispatch 类型后规范化、top-level assert/parse 及去除伪造 parent/workflow 内部字段。`cross-extension-rpc.ts:75–201` 保留最小结构校验、**await 前 `const requestId = raw.requestId`**、成功/失败 reply 都使用该捕获值，原 model/cwd/stop/consume 协议不扩大。
- `index.ts:519–535` 失败只给固定安全 warning/log，异常 payload 不进入提示，无持久 diagnostic、自动 retry；提示 sink 失败被隔离。`554–556` individual send 后核 active/record/captured run；`579–618` group 保存 `{record, runId}` 并只给原提交成员标 delivered，不给同步 resume 新 run 置 latch。
- `index.ts:570–575,1337–1342,2465–2477` 保留 stopped 公开终态先结 group membership、真实 running 仍等/partial、不把 stopped 非合作 runner drain 当作必须等待的完成通知前提。实际 execution drain 仍归 lifecycle，不被通知 latch 冒充。
- `PROVENANCE.md:143–159` 两个 owner 段并存：完成通知入口合同完整保留，同时追加新运行任务合同及明确独立通知成果已保留、外部适配另验；无旧 conflict marker。

## 2. 已审阅 runtime 合同：保留

**Byte-equal target→source**：`agent-runner.ts`、agent `management.ts`/`waits.ts`/`nested-tools.ts`、`task-composition.ts`、`beautify/tools/task-manage.ts`、整个 `extensions/runtime-tasks/` 产品及测试目录；process N1 四个 owner `management.ts`/`log-search.ts`/`search.ts`/`output.ts` 亦 byte-equal。此证据只证明集成未改写，不扩张为新的独立 N1 验证。

- `agent-manager.ts:885–936` retained session 管理能力仍以确切 session 获取合法当前 owner，每次 execute 冻结 owner；原首 run 闭包缺陷没有因通知 import 合并而复活。`settleRun` 的终态 conversation 快照也保留。
- `agent-runner.ts:834–839,930–1043,1108–1118`、runtime child handoff/composition 保留唯一管理 definition admission、owned-only fallback、deny/isolated/nested-off/narrowing、不恢复 root/local process、shutdown owned cleanup、无可收集入口时 background spawn 前拒绝。
- `index.ts:2410–2427,2458–2464` 保留新管理 result 的 pending usage 单次 drain 与 active fence；root agent/workflow capability 继续连同 cancelNotice/reconsider，而非仅更名丢 consumption hook。
- `management.ts:21–56` / `waits.ts` 仍捕获 exact run、snapshot/current-target、winning wait consumption、旧 owner waiter closed、cancel/release 不停止执行。
- facade/schema/public name 和新 launcher/message/workflow 接线均与 reviewed target 一致；source RPC 稳定 raw ID 仍可交给 `task_manage`，没有恢复 `Agent/jobs/get_subagent_result/bash_bg` 等旧注册或调用。

## 3. 测试三方保留及 Beautify 遗留修正

### Tool-waits

`extensions/agent-tasks/__tests__/tool-waits.test.ts`：HEAD **49** 个测试名称块，target **42**，source **53**；集合精确为 **38 common + 11 source-only + 4 target-only**，没有缺失或另造替代名称。Template 循环展开后的实际执行计数与名称块计数不同。

- Source 与 `research/integration-review/merged-tool-waits.test.ts` byte-equal；target 全部测试块在空白归一后与 source 一致。
- 11 个 source-only 通知测试完整保留；其中仅三个块改 `get_subagent_result(agent_id)` 为 `task_manage(action=output,task_id)`，原 warning/secret/nonconsume/delivery/no-retry/available-result 断言未弱化，其余 source-only 块不变。
- 实际 RPC description/malformed admission、UI/headless safe sink、formatter、individual/group 同步 resume、shutdown reentry、before/after batch stopped noncooperative、running/mixed partial 均仍走实际 factory/manager/registered definition（runner/provider 是离线 seam）。
- 四个 target-only 块保留 raw RPC ID/noalias、usage 单次上报、registered pause→wait/stop→worker/host drain、不影响 sibling，以及 full workflow answers/startup/concurrent wait。
- 独立 requestId mutation 回归位于 `auxiliary-lifecycle.test.ts:142–158`，该回归与 HEAD 一致；此文件的 HEAD diff 仅 clone fixture 的公开工具更名，不丢捕获地址断言。

### Beautify

`extensions/beautify/__tests__/retrieval.test.ts:80–114`：target 的 **七动作 × pending/result × collapsed/expanded × 8/20/40/80/120 列**矩阵完整不变，仍断言 physical visibleWidth 与足够宽度的真实工具名。

Source-only 新增块现在完整使用 `taskResult`、`taskManageContract` 与实际 SDK `ToolExecutionComponent("task_manage")`，覆盖 list/search/output/wait identity 及 expanded returned body；**零 `agentContract/jobsContract` 引用**。与 target 的 actual diff 只有这个新增块，不再是旧测试一半参数迁移。`retrieval.test.ts:165–180` 保留 old-name noadapter/delegation 负向矩阵；旧名只用于断言不接管，不是执行入口。`tools.test.ts` 与 target byte-equal，HEAD 所有测试名称保留。

对上述三份测试检查实际 execute/tools.get/captured.get/SDK component 构造，**无旧工具执行调用**。

## 4. 用户文档

读取 current source `docs/extensions/{task-composition,beautify,monitor}.md` 与 `docs/packages/trellis.md` 及 HEAD diff。

- Task Composition 的既有通知失败 warning、headless 安全日志、不自动重发、stopped sibling 语义段完整保留，仅改结果获取入口为 `task_manage output/wait`。
- 新七动作、task/run 身份、whole-monitor wait、resume owner/fallback/narrowing、分页/search 限制与 Beautify returned-content-only 描述匹配当前合同；没有指导调用已删除别名。
- `docs/packages/trellis.md:36–39` 明确新名与仍检测 Agent 的外部 pi-trellis 不匹配时，派发/材料/worktree gate **不能视为可用**，须关联适配验证，不靠冲突包/旧 alias 绕过。`Agent` 在这里是必要限制说明，不是宣称旧入口可用。
- 没有用目标旧 docs/spec 全量覆盖 source 新导航/规范，也没有把本次检查写成外部已完成组合发布。

## 独立定向执行

在 source 的 self-created `/tmp/runtime-final-integration-independent.*` agent-dir 下执行，existing dependencies/SDK，不 link/install，不强制退出：

```sh
node --test extensions/agent-tasks/__tests__/tool-waits.test.ts \
  extensions/beautify/__tests__/retrieval.test.ts \
  extensions/beautify/__tests__/tools.test.ts
git diff --check
```

**PASS 82/82，0 fail/cancelled/skipped，22.190s，自然 exit0；`git diff --check` PASS。** Job `b0753oqtx`，实际日志 `/tmp/pi-bg/b0753oqtx.log`；已读执行结果及 totals，不只依完成通知。日志 intentional sibling cleanup fault 与 experimental TS warning不是 suite failure。没有重跑 full、strict、actual tmux 或 N1 专项；main 的 fresh checks/实际 tmux 由 main 单独报告，不称为本 reviewer 独立执行。

## Preparatory artifact 限制

`ready-plan.json` 的 source_head 正确；99 行的最终内容/删除预期除下列三项外匹配当前 source：

1. PROVENANCE 后续修订 owned-only/resume 与独立通知成果说明；
2. tool-waits 的预备行仍 `pending-test-merge/merged_sha256=null`，实际 merged 文件与 source 已一致；
3. retrieval 后续完整迁移的 source-only detail 测试改变了预备 hash。

因此 **ready-plan 是预备集成证据，不是最终文件 checksum manifest**。本轮以真实 diff、byte compare、测试及下列 final hashes 作为检查输入，不把这三个陈旧预备标记误称产品未合入或最终 manifest 已完全更新。本 reviewer 不改规划/产物/产品去消除这些说明性差异。

## 本轮 final SHA-256

检查前后产品 hash 稳定；后续相关产品/测试改动需 main 重新核受影响检查。

```text
f3077939c233b26196d8b879d7a64bc199a942dd40f23afc5bf3ebf7d8dabe27  extensions/agent-tasks/src/spawn-input.ts
5537626b3aa9501fe2cd124038918ea8e8cc168a33aa9924dd8b0c034a4c90eb  extensions/agent-tasks/src/index.ts
1f8898d3370c9b73944cc6a502fbf925c3c6c9ffefc609f5695a20f752678af6  extensions/agent-tasks/src/agent-manager.ts
66305225772d45b4ae9f908e7a685baa5d771d34d7b8b7d2906bfd6d96a1c352  extensions/agent-tasks/src/cross-extension-rpc.ts
fb1c6fbd5eb017d2b9803235124d2220da660d4fc03dbaa2e56e6568c038e6a9  extensions/agent-tasks/PROVENANCE.md
2073096478629959f40a48366d88ea70c0ee1021458b92dbf69183478b7e04ae  extensions/agent-tasks/__tests__/tool-waits.test.ts
a33905988f40cae4e3b80ff9c5f989fde4a6aabb895888480520a52e1e018ad5  extensions/beautify/__tests__/retrieval.test.ts
427ddb9ad9276f339ac67611ae9013ea7ac3a1a7e42ee001847b3d80b47b5c77  extensions/beautify/__tests__/tools.test.ts
```

不声称在线 provider、物理 menu/mouse/IME、任意第三方 late 同名替换、权限/跨平台矩阵或 external pi-trellis 已验。**本轮集成可继续 main 最终门；不自动触发产品 commit 或 task archive。**
