# 阶段 2 独立检查报告（2026-10-15）

## 结论

**BLOCKED：发现 2 项 HIGH 功能缺陷、1 项 MEDIUM 生命周期缺陷和 1 项 MEDIUM 展示合同缺陷；本轮不建议验收或归档。** 不以启动 reviewer、实施者 616/699 自检或主会话核心 tmux 8/8 替代完整验收。

执行位置：既有 `/Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools`，branch `trellis/10-14-runtime-task-tools`。只读产品，唯一写入本报告；没有创建 worktree、start、升级运行时、产品编辑、commit、安装／link／sync／reload、递归委派或任务状态／AC 修改。

## 真实 Git 与规范边界

检查实际 tracked/untracked/deletes：删除旧 `process-tasks/tools/{bash-bg,jobs}.ts`、Beautify 旧 jobs/get-result/retrieval adapters 是本任务有意去旧接口；新增 runtime-tasks、两 backend management、workflow management 和 task-manage adapter 是实际产品，不因 untracked 忽略。`preset` 旧 specs 的大差异为主会话规范基线对齐，不判产品退化。source 自 `3bedbcc` 的 session naming、host-state、Beautify exact-name、docs 与 Trellis 基建提交为并行基线，未修改／回退。

完整读 PRD/design/implement/check.jsonl、43023-byte runtime-interface-map、stage1/stage2报告与引用研究／handoff、当前 development/testing/guides（含 source 更新版本）。目标 development/guides/tmux 与 source 相同；testing 唯一相关差异是目标已迁新 task_manage 展示规范，source 尚留旧 jobs/get-result措辞，以目标新规范审本任务。

完整审实际核心 contracts/facade/handoff/launch、agent management/manager/runner/nested/index/source/waits、workflow management/task/runtime/host、process management/search/log-search/output/bash/monitor/lifecycle、composition，以及 Beautify task-manage/optional/layout/shared/bash 与关键 actual-owner/host/registered tests。没有宣称整个仓库每份测试、Pi 全套文档或所有旧归档报告均已全文重读；产品不作修改，本轮 SDK host 行为由当前 actual-loader/SDK tests 和既有研究交叉核对。

## 已确认缺陷

### R1 — HIGH：resume 后 child composite 的 owned 管理永久失效

- 位置：`extensions/agent-tasks/src/agent-manager.ts:884-893`；`resumeRun/startResume:1182-1302`；child 加载 admission 在 `agent-runner.ts:834-837`。
- 原因：首轮 `nestedRuntime.management` 的 `owns/active` 捕获首轮 `run`，要求 `this.current(record, run)`。resume 换 runs map，但复用原 session、nested customTools 和加载时建立的 facade。新轮仍能启动 nested child，旧管理 capability 却永久空列表。
- 实际 manager＋原 facade 复现：创建 parent/run1 和其 management；完成首轮；`resumeRun(parent)`；在 run2 创建 owned child；调用原 facade `output(child)`。输出：

```json
{"parentRun":"2","childParentRun":"2","branchCount":0,"result":{"version":1,"action":"output","error_code":"not_found"}}
```

- 不是“漏一个测试”而是确定的接线缺陷。root 又拒绝控制 owned child，因此无法从根工具绕回取结果。
- 必须补：真实 child session 首轮→resume→nested background launch→同一 composite 的 list/output/wait/stop，并同时管理 local process；旧轮 waiter 仍绑定旧身份，不能借修复把旧异步执行接管新 child。建议由 session/parent owner 明确更新当前-run admission，而不是永久捕获初次 run。

### R2 — HIGH：extensions:false 保留 nested background 启动，却失去结果检索

- 位置：`agent-runner.ts:834-837` management 要求 `!noExtensions`；`:933-943` nestedTools 没有 noExtensions 禁用；`:999-1013` static allowlist 注入两个 nested工具；`nested-tools.ts:164-177,332-338` 仍允许后台并提示 task_manage。
- 实际 runner seam 复现配置 `extensions:false, allowedSubagents:all, persistSession:false`，捕获实际 sessionOpts：

```json
{"customTools":["subagent_run","subagent_message"],"tools":["subagent_run","subagent_message"]}
```

- 旧 nested result customTool 已删除；此 child 不加载 composition，也没有注入 owned-only task_manage。后台 nested 答案没有 owner 内检索入口，root 不单独通知 owned child，owner 结束会 stop child。
- 必须保持 noExtensions/isolated/denylist：不可恢复被禁 local-process/root能力或绕过明确 task_manage deny。应保有限 owned-only 管理 seam，或者在无检索能力时明确拒绝不可收集的后台启动；不能继续宣传可收集却静默丢失原能力。补实际 loader 配置矩阵，而非只检查 `installExtensionToolScope()` helper。

### R3 — MEDIUM：指定 task_id 的异步 search 在 shutdown 后仍返回旧 activation 日志

- 位置：`extensions/process-tasks/management.ts:53-55`；`runtime-tasks/facade.ts:63` 的 target 直接 return，只有非 target search 聚合路径在 await 后检查 closed。
- 复现：用实际 registry/source/process management 创建一份含 `needle old activation` 的日志；启动 `facade.execute({action:'search',task_id:'old',pattern:'needle'})`；同步 `facade.close(); reg.closed=true`；await 后仍返回完整旧匹配、`count:1`、正常 runtimeTask，而不是 closed。
- list/status 的无 await 边界安全；global search 有围栏，target search 漏掉。停止/退出后的日志仍可保存在磁盘，但旧管理调用不应继续向已关闭会话发布成功结果。
- 补 target search 的 await 后 activation＋原 job identity 检查及真正 stream cleanup/closed回归。无需删除日志或扩展总 registry。

### R4 — MEDIUM：stop 对终态不执行请求，折叠 renderer 却显示 stop requested

- 位置：`extensions/beautify/tools/task-manage.ts:20`；对照 process management `:58-61`、agent management `:32-34`、workflow management `:30-38`。
- backend 正文准确区分 `Stop requested` / `Stop not needed`，轻量 metadata 未携带这个区别；renderer 对所有无 error 的 stop 一律写 `stop requested`。
- 实际 pure contract 复现：终态 completed 的 `taskResult('Stop not needed; observed status=completed.', ...)` 被渲染成 `stop requested · observed completed`。不是 OS drain 措辞问题，而是未发生请求被展示为已请求。
- 应由公开 metadata 明确 request outcome，guard/test同步；或用不作请求事实断言的“stop · observed …”。不要扫描正文推测，不新增 backend I/O。

## 独立验证

环境 Node 24.14.1、既有 SDK 1.2.0。整个命令设临时 `PI_CODING_AGENT_DIR`，结束只删自建目录，compiler 只读 ancestor 现有路径：

```sh
cd /Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools
agent_dir="$(mktemp -d)"
export PI_CODING_AGENT_DIR="$agent_dir"
trap 'rm -rf "$agent_dir"' EXIT
node /Users/jyxc-dz-0101322/tools/my-pi-preset/node_modules/typescript/bin/tsc -p tsconfig.json
node --test extensions/runtime-tasks/__tests__/*.test.ts \
  extensions/beautify/__tests__/retrieval.test.ts \
  extensions/agent-tasks/__tests__/tool-waits.test.ts \
  extensions/agent-tasks/__tests__/runner-cancellation.test.ts \
  extensions/agent-tasks/__tests__/loading.test.ts
```

**PASS strict/noEmit＋113/113 focused，自然退出 exit0，无 force-exit**。job `bkeaeqgpz`，完整日志 `/tmp/pi-bg/bkeaeqgpz.log`。R1/R2/R3/R4 另以只读 Node -e 临时配置探针执行，全部自然 exit0 并打印上述错误行为；这些是 defects reproduced，不是 regression PASS。`git diff --check` PASS。

未重复完整 699 suite；实施者 full selftest 是可引用证据，不变成本独立 full。`pnpm check` NOT_RUN，其 link-sdk 会修改链接；无独立 lint命令。没有为了红测暂时修改产品。

主会话新鲜 tmux 报告已读：8/8 功能场景／8/8 per-cell SGR、exit0/error=null，首轮仅 cleanup fixture失败保留并重跑。它确实覆盖六注册名、list resize/CtrlO、typed error、actual Bash页/search/stats/partial/bg/PID/final、显式／继承模型 child 563字符、monitor Esc不stop/stop/finite、零agent workflow return。**未审全部 raw capture，不把主报告来源伪称本 reviewer 驱动的 tmux。** 此核心矩阵不覆盖 R1/R2 或真实 nested owned branch。

## 高风险判断与仍需补齐的门

1. 首次加载的 branch scope：`manager:885` 同时核 parent ID、parentRunId 和当前 owner run；root capability `owns:isTopLevelAgent`，root 可见 descendants但 forbidden；child process为本地 registry；renderer不读registry。所审代码未发现 root/sibling 越权。不等于真实 nested/provider/ALS组合已经 PASS。
2. graph-stable ALS holder `finally` 撤销、undefined mask、不同 cwd host smoke、重复factory、root/child shutdown分离已存在并在独立113 suite PASS。smoke owned branch仍是有限 stub，actual manager branch是分开的测试。鉴于 R1/R2 已证明拼接处有真实缺陷，**补 actual composition＋真实 nested owner 的 same/different cwd、两个重叠 branch、nestedoff/localprocess、isolated/noExtensions、task_manage deny/ext narrow硬门后再验收**；无需穷举在线模型或任意插件。
3. workflow paused chain：`:runWorkflow` 确实 onControl→pauseGate→abort releasePause→worker.terminate；runtime-tasks workflow test使用真实 paused worker并实际 stop/wait。注册测试 `tool-waits:804` 名称虽含 paused，实际上只 stop running owned-child。未见 pause→stop 实现缺陷；它是**明确 coverage gap**。main补注册 launcher→`pauseWorkflowTask`（菜单同一 owner）→task_manage wait+stop，确认无新child、wait settled、worker/host实际drain和独立 sibling不停止；菜单物理键验证可单列NOT_RUN。
4. resume waiter答案／formatted conversation：terminal resolve同步快照，lease精确run consume／notice取消重查，实际-manager同步resume回归PASS。用量上报接现有 pendingUsage；不是新总账本。wait取消不stop由coordinator kind区分，process/agent/workflow各有独立 owner证据。
5. 日志分页 UTF-8 seams／正则错误／20-hit count/context/cumulative stats、workflow不可序列化/setup失败/return与logs区分、原engine gate/replay实际drain已有源码及owner回归；除R3围栏外未确认新缺陷。任意超大context/regex成本是既有能力限制，本轮不凭相似代码扩大修复。
6. Beautify strict version/action/type/id/run guard、unknown details={}／动态原delegate、default/self一次padding、partial/final槽、clipPlain背景reset/exact tool name修复保留；expanded仅返回正文，无backend I/O。R4仍需解决。
7. 不重引入通知description fallback或raw catch日志两hunk；其需求归另owner。外部 pi-trellis ordinary new-name门禁仍未实施，docs明确限制；**是组合发布前置，不要求本task私改外部或保旧alias**。

## PRD AC 映射（不是勾选验收）

| AC（按 PRD 顺序） | 证据与结论 |
| --- | --- |
| 1 六工具集合 | actual cached loader＋tmux；SUPPORTED，workflow用户开关仍可禁用 |
| 2 去冗余启动／独立结果 | 真实删除与注册负向断言；SUPPORTED，无旧compat |
| 3 四类型统一管理 | root/process/workflow基本路径SUPPORTED；R1/R2阻塞完整child能力，R3阻塞closed围栏 |
| 4 指定subagent wait最终答案 | actual manager/注册＋tmux完整答案SUPPORTED；resume-owner nested仍R1 |
| 5 monitor wait结束≠事件通知 | 真实stream/取消/finite tmux及原owner；SUPPORTED |
| 6 日志页/search/stats不丢失 | registered page/count/context/stats及tmux；SUPPORTED，target search lifecycle R3待修 |
| 7 注册/prompt/child/internal/docs一致 | 主集合/rawRPC新工具一致；R2 child提示与实际能力不一致，不能PASS |
| 8 Beautify迁移全合同 | actual host/registered/SGR多数SUPPORTED；stop请求R4待修，nested相关结果门待补 |
| 9 原Read/Bash/Find/Grep无回归/noI/O | 源码保clipPlain/exactname，无新增I/O；实施者全量证据，独立focused不涵全部原四工具测试 |
| 10 strict/focused/full/真实限制 | 独立strict113绿＋实施者699绿＋maintmux8绿；真实nested/pausedchain门仍开放，不能最终PASS |

主会话先协调修复以上四项、补decisive registered/actual child tests、重跑受影响strict/focused/full，再决定是否重跑相关tmux。完成前保持 in_progress；本review未改变任何AC或状态。
