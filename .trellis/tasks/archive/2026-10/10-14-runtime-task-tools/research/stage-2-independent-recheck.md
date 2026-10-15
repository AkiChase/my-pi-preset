# 阶段 2 独立复查报告（2026-10-15）

## 结论

**BLOCKED（最终验收）：原 R1、R2、R3 的成功路径围栏及 R4 已通过本轮独立复查，但额外实际注册入口探针发现一项 HIGH 日志错误处理缺陷 N1：search 遇到不存在的日志文件时，readline 的未处理 `error` 会令整个 Node 宿主退出。**

N1 经恢复 HEAD 的 `log-search.ts`（仅内存 hook）复核，确实是既有缺陷，**不是本轮四项修复新引入的回归**。但它位于本轮修改的 R3 同一资源／错误 owner，且与“错误路径实际关闭资源、错误不伪装成功”的交付合同直接相关。本 reviewer 不建议带这个已复现宿主崩溃验收／归档；主会话应协调最小 owning 修复和缺失日志错误回归后再验收。没有编辑产品修复，也没有改变任务 AC／状态。

| 原问题／新增问题 | 独立结果 |
| --- | --- |
| R1 retained child 首轮 capability 在 resume 后失效 | PASS：当前 owner getter＋每次操作冻结 owner，真实 retained SDK session／同 tool definition 下两种 cwd、旧 child run 和旧 owner waiter、分支隔离均验证 |
| R2 noExtensions 能启动 nested background 却不可收集 | PASS：实际 loader 下 finite owned-only fallback；deny／isolated／nestedOff／ext narrowing 不复活被禁能力；不可收集时 spawn 前明确拒绝后台 |
| R3 target/global search await 后关闭／identity 围栏 | PASS（原复现）：四个 close/replacement 组合返回 closed，不发布旧匹配，成功读取流实际 closed 后才返回，日志保留；**错误流 N1 未通过** |
| R4 终态 stop 被摘要伪称 requested | PASS：中性 `stop · observed …`，实际 backend→SDK renderer 回归，无 schema／正文猜测／I/O |
| 原 workflow registered pause 链 coverage gap | PASS：真实 registered launcher→菜单同 owner pause→wait/stop→worker terminate 与 lifecycle auxiliary/host drain；独立 sibling 未停止 |
| N1 search 缺失日志的 readline 未处理 error | HIGH／FAIL：actual registered definition 子进程自然 exit1，宿主不可捕获为正常 tool error；HEAD 相同缺陷 |

## 执行边界与读取范围

执行项目：`/Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools`，branch `trellis/10-14-runtime-task-tools`，HEAD `3bedbcc3ebd83d23d9a98270c8e043da22bb17bb`。用户明确批准普通 Agent 对既有任务／worktree 独立检查，本轮没有 taskstart、创建 worktree、递归委派、commit、archive、install/link/sync/reload、runtime 升级或在线 provider。唯一仓库写入为本报告。

完整读 PRD/design/implement、`stage-2-independent-check.md`、`stage-2-fix-report.md`，目标 current development/testing/guides 与相关 preset extension 约束。完整读四项 fixes 的 owner：`agent-manager.ts`、`agent-runner.ts`（均分页到结尾）、agent management/waits/nested-tools、runtime facade/child-handoff、composition、process management/log-search/search、Beautify task-manage。完整读 decisive `retained-child.test.ts`、runtime process/agent tests、Beautify retrieval、`tool-waits.test.ts` 和 source-loader；workflow task/runtime 全文及注册 launcher 的 owner 段做链路复核。

未重复原 reviewer 的全仓研究，没有把有限摘读的巨大 `agent-tasks/src/index.ts` 说成重新全文检查；所需 registered workflow owner 已定位并读完整方法。并行 source 通知专任务的新提交／dirty `index.ts` 和 `tool-waits` 不移植、不修改；目标产品仍只留在目标，main 自行审 actual diff、整合与最终验收。本轮未驱动或消费 main 并行 tmux 捕获。

## R1 — retained session 与 operation owner：已解决

证据 owner `agent-manager.ts:884-923`：

- capability 的持有者是首轮创建后绑定的确切 session，而不是首轮 `run`。
- `currentOwner()` 每次要求原 record 在 map、当前 runs map、record.session 为原 session、该当前 run.sessions 持有原 session、session 未关闭且 owner 未 abort。
- list 可以在合法 resume 的新 run 中重新 admission；execute 先捕获 `owner`，其 `active` 之后只接受 `currentOwner() === owner`，不是 await 后重选新 owner。
- target management 另捕获 child record、identity.runId、terminal；`currentTarget()` 控制消费／通知，旧 terminal snapshot 可以返回原答案，但不能消费或取消新 child run。
- `waits.ts` 的有限 `canConsume` 沿用 coordinator lease，不增加等待引擎。

独立实际执行 `retained-child.test.ts` 两项 same/different cwd，每项都用实际 SDK createAgentSession／resource loader／composition／manager／runner，只有环境探测和 prompt 离线 seam：

1. run1 完成→parent resume run2，确认同 session、同 `task_manage` definition、唯一 registration；nested 后台 child parentRunId 为 2。
2. 同 composite list/output/wait/stop 有效，同时 local Bash 最终日志可收集。
3. 两个重叠 branch 不能 output root、另一 parent、另一 branch child；另一 branch 不能 stop 本 child／读本 local process。
4. child 完成同步 resume：旧 wait 返回 run1 的 `nested final answer`，child 当前 run2.resultConsumed 仍 false；新 run2 output 返回新答案。
5. 旧 owner run2 waiter 期间 parent 同步 resume run3：旧 waiter 返回 `closed`，不能消费新 owner child；同 tool list／stop 新 child 仍有效，独立 sibling parent 仍 running。
6. shutdown retained session 后原 capability list 空，不能复活。

runtime `agent.test.ts` 同步 completion resume 的 verbose snapshot／notice fence、branch retention 与原 runner cancellation regressions亦独立绿。所审路径未发现 root/sibling 权限扩大。

## R2 — composition 缺席的 owned-only 管理：已解决

证据 owner `agent-runner.ts:834-839,934-1043,1108-1118`、`nested-tools.ts:225-232`、runtime child handoff/facade 与 composition：

- 允许 nested、非 isolated、task_manage 未 deny、深度允许时可交付有限 parent capability，不再因 noExtensions 一概丢掉它。
- loader 没有注册管理工具且没有 ext opt-in narrowing 时才创建 owned-only facade/coordinator，并复用同一 `runtimeTaskTool` builder；不加载 extension，不把 local process/root capability 放进 fallback。
- 有 composition 时用 scope registration 回传的确切 definition 验证 owner 和 selector，不能仅凭同名认为可收集；不注入同名 customTool 覆盖 composition。
- noExtensions 静态工具 allowlist 与 loaded-extension active scope 都接正确 readmit；deny 不恢复，narrow 不绕过。
- background invocation 解析后、spawn 前核 `canCollectBackground`；没有 collection seam 返回工具错误，foreground 仍 inline 返回。
- fallback close 属于 session shutdown owner，关闭 facade/coordinator，不 dispose root manager。

独立实际执行 matrix 七项：`noExtensions`（extensions:false）、`excluded`（extensions:[]）、`deny`、`isolated`、`nestedOff`、`narrow`（只 bash）、`narrowAllow`（task_manage）。检查 active SDK 工具集、唯一 registration、实际 nested final wait／stop、root not_found、无本地 process/root 复活。deny/narrow 后台失败且 manager 仍只有 parent；foreground 可以返回 `inline answer`；nestedOff 本地 Bash wait 有效；isolated 不注入 nested；fallback 的保留 tool callback 在 shutdown 后返回 closed。

NOT_RUN：任意第三方之后动态同名替换的组合；该限制不是这七项矩阵 PASS 的延伸。

## R3 — 原围栏与实际 fd：已解决；错误路径仍阻塞

`process management:40-60` 在 search 前 capture 实际 job 对象，global/target await 后核 registry.closed 和对象是否仍在 map；target 分支再核首个 job，typed failure 不重写 success。facade global 聚合保留 backend failure。

独立执行 `registered asynchronous search fences close/replace (global/target) and closes streams` 四项：调用实际 `runtimeTaskTool` definition后同步 close registry/facade 或 replacement，返回 `isError=true/error_code=closed`，正文不出现旧 `match line`；named Node fs binding 经 `syncBuiltinESMExports` 实际 spy，所有 ReadStream.closed 为 true 才发布；原日志 bytes 完全保留。invalid regex remains error、missing output log 不 consume、目录不是成功空日志等亦通过。

`log-search.ts:155-172` 现在等待 stream `close` 才 resolve，readline close 触发 destroy；正常扫描的 fd 顺序验证真实有效。**但是 stream error 会被 Node readline 转发给 Interface；该 Interface 没有 error listener，见 N1。** 因此原成功路径 R3 PASS 不等于其全部错误路径已验收。

## R4 — stop observed：已解决

`extensions/beautify/tools/task-manage.ts:20` 使用 `stop · observed ${raw_status/status}`。实际 backend 正文仍分别写 Stop requested／Stop not needed，不把 metadata 增 schema，也不读正文猜事实。

独立 `actual backend stop summaries report observed status without inventing a request`：真实 foreground completed/no-op、后台 running/请求停止、随后 killed/no-op 三种，通过真实 process owner 得到 body/meta，再由真实 SDK ToolExecutionComponent／optional renderer渲染。三种摘要均无 `requested`；观察状态 completed／killed 正确。其余七 action guard、partial/final、委托和 shell 回归亦绿。

## Workflow registered pause gap：已补齐

`tool-waits.test.ts:802-836` 新测试不是仅名字有 paused。actual registered `subagent_workflow` 启动真实 worker，测试专用内存 observer 只暴露 owner 已设置的 task/control，然后直接调用菜单所用 `pauseWorkflowTask`。

第一 owned child 完成后 30ms 仍未启动第二 child；注册 `task_manage wait+stop` 返回 stopped，task.control 清除。源码 `runtime.ts` finish 等待 `worker.terminate()` 才 resolve，`runWorkflowTask` 才 complete terminal；最后 lifecycle.shutdown 等 auxiliary/host drain，wait_count 0、source 空，独立 sibling 未 abort。另有实际 factory host gate pending drain 和非协作 execution 区分的回归独立通过。

这个测试的 model child 是昂贵边界 seam；它不声称在线 provider、物理 workflow menu 按键或任意第三方 drain 已验证。

## N1 — HIGH：日志缺失时 search 杀死宿主（既有缺陷，本次新发现）

位置：`extensions/process-tasks/log-search.ts:159-160`：stream.on(error) 仅设置 failed；Node createInterface 同时安装 input error 转发，Interface 上没有 `error` listener。错误发生时 EventEmitter 抛未处理事件，任何上层 tool.execute promise catch 都接不住，最终宿主 process exit1。

真实复现使用当前 BackgroundRegistry／source／management／facade／runtimeTaskTool，注册一个 logPath 指向 self-created temp agent dir 下未创建文件的 job；执行 target search：

```js
const reg = new BackgroundRegistry(DEFAULTS);
const source = createProcessTaskSource(reg);
const facade = createRuntimeTaskFacade([createProcessManagement(reg, source)]);
const job = add(reg, createRunningJob({
  id: "missing", command: "test", pid: 0,
  logPath: `${process.env.PI_CODING_AGENT_DIR}/nonexistent.log`,
  toolCallId: "offline",
}));
try {
  console.log(JSON.stringify(await runtimeTaskTool(facade).execute(
    "recheck", { action: "search", task_id: job.id, pattern: "needle" },
    undefined, undefined, {},
  )));
} finally { facade.close(); source.dispose(); reg.coordinator.dispose(); }
```

独立 `node --input-type=module -e` subprocess 结果（正常 tool reply 没有产生）：

```text
node:events:486
      throw er; // Unhandled 'error' event
Error: ENOENT: no such file or directory, open '/tmp/runtime-independent-search-error.*/nonexistent.log'
Emitted 'error' event on Interface instance at:
    at ReadStream.onerror (node:internal/readline/interface:259:10)
CURRENT_EXIT=1
```

基线鉴别：test-only `registerHooks` 对 `log-search.ts` 单文件用 `git show HEAD:extensions/process-tasks/log-search.ts`，经 `stripTypeScriptTypes` 转换后仅内存替换；其余 same registered probe 不变。输出相同 Interface/ENOENT，`CORRECTED_BASELINE_EXIT=1`。首次 baseline hook 忘 type stripping，SyntaxError 不能证明缺陷；已纠正并重跑，**仅纠正后结果用作基线依据**。direct searchLogs 初始探针亦同样 exit1，不把这类预期红复现写成测试 PASS。

建议最小处理：由 streamLogFile 同一 owner 处理 readline 的 error，标记失败并 destroy 输入流，保证只在真实 stream close 后 settle；保现有 tail fallback／错误策略，不装全局 uncaughtException，不吞成成功空日志，不改 SDK。加实际 definition 子进程 missing/unreadable log 回归、真实 stream closed 断言、close/replacement 并发错误与自然退出。该建议不是本 reviewer 实施；是否调整返回合同由 main 在已批准范围内协调，不拓展新框架。

## 独立自动验证

Node `v24.14.1`，既有 SDK `1.2.0`，真实路径 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent`。目标通过 source ancestor 的现有 node_modules 解析，无安装／link。整条命令临时 `PI_CODING_AGENT_DIR`，只清理 self-created temp，未读写个人配置：

```sh
set -eu
cd /Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools
agent_dir="$(mktemp -d /tmp/runtime-independent-recheck.XXXXXX)"
trap 'rm -rf "$agent_dir"' EXIT
export PI_CODING_AGENT_DIR="$agent_dir"
node --version
node /Users/jyxc-dz-0101322/tools/my-pi-preset/node_modules/typescript/bin/tsc -p tsconfig.json
node --test extensions/runtime-tasks/__tests__/*.test.ts \
  extensions/agent-tasks/__tests__/tool-waits.test.ts \
  extensions/agent-tasks/__tests__/runner-cancellation.test.ts \
  extensions/agent-tasks/__tests__/loading.test.ts \
  extensions/beautify/__tests__/retrieval.test.ts
git diff --check
```

**独立 PASS strict/noEmit、129/129 focused，0fail/0cancelled/0skipped，自然 exit0，无 force-exit，15.43s。** Job `bilbmw7yv`；完整日志 `/tmp/pi-bg/bilbmw7yv.log`，已读实际日志而非只依 completion 通知。日志内 intentional offline sink／optional cleanup warnings 是有断言的失败隔离 fixture；不是 suite failure，也不与 N1 actual crash 混淆。

实施者 fresh full715/715（72 suites）及 mutation red evidence 已读但未重复 full：**full 本轮 reviewer NOT_RUN，不把实施者自检称独立全量**。pnpm check NOT_RUN（会 link-sdk／forced exit），无独立 lint 脚本。main 并行 tmux、本轮 reviewer 的 tmux、外部 pi-trellis、在线模型、物理 menu/mouse/IME均 NOT_RUN by reviewer；接受的环境限制没有被标成 PASS。

## 精确复查输入（SHA-256）

```text
44bb08694078b76d46572b44855da2f00abd132c7c4c4362b85d01c3a579183a  extensions/agent-tasks/src/agent-manager.ts
14d7f5f80db7d43db92d7c98a1cdc970d458847316116ae3f796341f9744a4c5  extensions/agent-tasks/src/agent-runner.ts
a63429a09ec9ea8f5a6d1ccb4a5778e7ec41b37ee5abb7bd283182be1072a325  extensions/agent-tasks/src/management.ts
bfa4b65077b78f1cfd998e24d421670bc0f73d78192d48107cba264fc731473f  extensions/agent-tasks/src/nested-tools.ts
ae253879b49707192d4bf1267ec89815a26a75db559001cd4c71747560497ea6  extensions/agent-tasks/src/waits.ts
13e39dcb616f6a1f35b6d60f80d850d90862b1413106782b03d4f303597f8829  extensions/runtime-tasks/facade.ts
ee4652377f614d5a29b244187a00c55d960f651ec6094ff1fd3992f016e12863  extensions/runtime-tasks/child-handoff.ts
2f115ce12f05c834c7f559b6fde6bb4ae8d044c898c0b0ca31943ca656d25b47  extensions/task-composition.ts
3f48b3f83aab5ead4ec60b2e13dcdad84fb2459600c2bc81624f20fb37a12676  extensions/process-tasks/management.ts
4753545edeb383495c655da5afd08571423fa46ba61e58c9126cc2b60172f846  extensions/process-tasks/log-search.ts
12c42183cf7f1ced4a80fd76dd583382a704c4dccec56918f44845921df0fc78  extensions/beautify/tools/task-manage.ts
66b8210ac3c122978e6762ddaa38074b8caa853e0fdc9269b9ee57d2567f5000  extensions/runtime-tasks/__tests__/retained-child.test.ts
fad6720b924712a2e52058dcac62cc8505ee774bca14c9f0e9a5d21707097fd7  extensions/runtime-tasks/__tests__/process.test.ts
62923e0d0ac59b0b8baf52e0e04c00b61b70c82acd341fea3790616a686f665b  extensions/beautify/__tests__/retrieval.test.ts
c83da8e74f7778a79034547d730c2c80d1a2363140d049881d1bf6643fcc4dbd  extensions/agent-tasks/__tests__/tool-waits.test.ts
dfa1653cb10b8e5dbd45de4b78353e6353b644d05532fc3fa700010a86c26258  extensions/agent-tasks/__tests__/source-loader.mjs
```

本轮只新增本报告。main 应核实际报告／diff并处理 N1 后再最终接受；原四问题通过不自动授权归档，也不使已复现错误消失。
