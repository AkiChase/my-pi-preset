# 阶段 2 四项检查修复报告（2026-10-15）

## 范围与结论边界

按主会话重复明确授权，直接在既有 `.worktree/10-14-runtime-task-tools` / `trellis/10-14-runtime-task-tools` 修改四项 R1–R4 及必要 owning 回归。没有 taskstart、worktree 创建、runtime 升级、commit、install/link/sync/reload、递归委派、source 产品修改或通知专任务移植。未修改 PRD AC、任务状态或归档；本报告是实施者自检，不是后续独立 recheck 或最终验收。

## 精确新增修改范围（不等于整个阶段 2 dirty diff）

| 文件 | 本轮必要改动 |
| --- | --- |
| `extensions/agent-tasks/src/agent-manager.ts` | R1 retained child session capability；合法当前 owner run admission，每 execute 冻结 owner run，保 parentAgentId/parentRunId/session/map/closed 围栏 |
| `extensions/agent-tasks/src/management.ts` | exact target record/run/owner 检查；旧异步操作不消费或取消新 run 通知 |
| `extensions/agent-tasks/src/waits.ts` | 既有 wait owner 增有限 canConsume predicate，完成 callback 保精确 ownership，不另建等待引擎 |
| `extensions/agent-tasks/src/agent-runner.ts` | R2 no-composition owned-only facade；不加 extensions、不恢复 builtin/localprocess/root；deny/narrowing 尊重；shutdown 关闭 fallback；核实际 composition tool definition owner |
| `extensions/agent-tasks/src/nested-tools.ts` | 无合法 collection capability 时，解析实际 background invocation 后、spawn 前明确拒绝；foreground 答案仍可返回 |
| `extensions/runtime-tasks/{facade,child-handoff}.ts` | 复用同一 tool definition builder；短 loader admission 回传确切 composition registration，无 globalregistry/同名 override |
| `extensions/task-composition.ts` | 注册原唯一管理工具后回传有限 definition；仍 composition-owned single registration |
| `extensions/process-tasks/management.ts` | R3 global/target search await 后 captured job identity 和 registry closed 围栏；不把 typed failure 重写 success |
| `extensions/process-tasks/log-search.ts` | 原 log stream owner 在 actual stream close 后才 resolve；readline close/error 路径释放流，不删日志 |
| `extensions/beautify/tools/task-manage.ts` | R4 仅中性 `stop · observed …`，无新 schema/body parsing/I/O |
| `extensions/runtime-tasks/__tests__/retained-child.test.ts` | 9 项实际 SDK/loader/manager/runner组合测试，环境探测和 prompt 是离线昂贵边界 seam |
| `extensions/runtime-tasks/__tests__/process.test.ts` | 4项注册 definition target/global close/replacement+实际fd关闭回归及regex错误回归 |
| `extensions/beautify/__tests__/retrieval.test.ts` | 实际 backend completed/no-op、running/stop、stopped/no-op metadata→actual SDK renderer |
| `extensions/agent-tasks/__tests__/{source-loader.mjs,tool-waits.test.ts}` | 测试专用 in-memory exact onControl observer；注册workflow launch→菜单同 owner pause→task_manage wait/stop→worker/host drain，独立 sibling保持 |

## 修复说明

### R1 会话 owner 与运行 owner 分离

loader 创建的 branch capability 绑定确切 retained session。每次 admission 从该 record 当前 run 获取 owner，只在原 record/map、session reference、当前 run session set、非 closed/abort 同时有效时开放。每个 management execute 捕获该 owner；await 完成后必须仍为同一个 owner，旧 owner wait 返回 closed，而不是重解析到新 owner。child target wait仍绑定原 run terminal；child同步 resume 时返回旧 snapshot，但不消费新 run。

真实 child 首轮完成→同 session resume→nested background→同一 task_manage definition list/output/wait/stop；同时 local Bash wait/output。same/different cwd各一项，两个重叠owned branches均无法查/停root/sibling/另一branch或另一branch localprocess。parent同步 resume 后旧 waiter不能触及新child；关闭 retained session 后 branch不能复活。

### R2 composition缺席时有限管理

loader仍不增加 extension。当 nested opt-in 且没有注册 task_manage、没有明确 deny或ext narrowing时，runner创建仅含 owned agent facet的facade/coordinator并注入复用的管理工具定义。若composition已注册，则绝不注入同名customTool；admission需确切definition身份和ext narrowing允许。explicit task_manage deny、isolated、nestedoff、narrow不恢复被禁能力；manager不可用时明确拒绝实际background invocation，foreground仍返回inline答案。fallback在session shutdown关闭，不dispose根manager。

实际loader矩阵：extensions:false、extensions:[]、deny、isolated、nestedOff、ext:task-composition/bash、ext:task-composition/task_manage。owned-only无localprocess/root；成功finalwait/stop；closed工具回调返回closed；narrow/deny后台拒绝但foreground可用。

### R3 异步search围栏与真实资源释放

global search capture所有实际受搜索job对象，await后核registry闭合/identity replacement。target execute再核最初job；typed error直接保留。原stream owner不再在readline close时先行resolve，而等待actual stream close；readline close触发destroy。实际spy通过syncBuiltinESMExports接上named Node fs binding，断言所有流closed后才发布，旧日志内容仍保留。invalidregex仍reject。

### R4 stop摘要

不从正文猜请求结果；折叠态只显示 `stop · observed completed/killed/...`。正文依旧准确区分 Stop requested/Stop not needed，metadata不扩schema。completed、running-stop、stopped-noop全部经实际backend和ToolExecutionComponent验证。

## 首败与红测

保留日志：

- `stage-2-fix-first-child-fixture.log`：首次9项6PASS/3FAIL，fixture把builtinToolNames设[]，实际SDK正确拒绝bash；修fixture仅允许测试所需bash，不改产品权限。
- `stage-2-fix-first-types.log`：新增fixture unknown SDK boundary / fs.default TS错误，修typed fixture，不放宽产品strict。
- `stage-2-fix-first-stream-fixture.log`：75项71PASS/4FAIL，named ESM fs未接default export spy；syncBuiltinESMExports+restore后4项通过。产品closed/replacement断言当时已通过，失败仅资源spy未观察到流。
- `stage-2-fix-red-mutations.log`：仅临时 `/tmp/runtime-task-fix-mutations.mjs` 内存hook恢复各缺陷，不改磁盘产品。R1首run捕获→same/different两个FAIL；R2禁fallback→noExtensions FAIL；R3去post-await围栏→target close/replacement两个FAIL；R4旧requested文案→completed断言FAIL。四个子进程均自然exit1，驱动确认全部非0后exit0。

## 最终验证命令与环境

整个invocation临时PI_CODING_AGENT_DIR；Node24.14.1/现有SDK1.2.0；compiler只读source ancestor existing路径，无dependency/link安装、onlineprovider、forceexit。

```sh
cd /Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools
agent_dir="$(mktemp -d)"
trap 'rm -rf "$agent_dir"' EXIT
export PI_CODING_AGENT_DIR="$agent_dir"
node /Users/jyxc-dz-0101322/tools/my-pi-preset/node_modules/typescript/bin/tsc -p tsconfig.json
node --test extensions/runtime-tasks/__tests__/*.test.ts \
  extensions/agent-tasks/__tests__/tool-waits.test.ts \
  extensions/agent-tasks/__tests__/runner-cancellation.test.ts \
  extensions/agent-tasks/__tests__/loading.test.ts \
  extensions/beautify/__tests__/retrieval.test.ts
node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"
```

最终 job `bkopq4ujo`，完整日志 `stage-2-fix-final-checks.log`。**PASS strict/noEmit、focused129/129、full715/715（72 suites），命令自然exit0**；focused15.23s/full22.40s，0cancelled/0skipped，无forceexit。该命令覆盖最后composition exactdefinition owner fence后的实际产品与最终测试。此前bcxnshb87同矩阵亦自然exit0，但仅最新job作为最终检查证据。

`git diff --check` PASS；新增test及本报告无trailing whitespace。临时mutationhook已删除，仅任务内保留日志。

## 已达到/仍开放门

- 实际SDK loader composition same/different cwd、retained resume、两个ownedbranch、localprocess、exact旧child和ownerwait、closed-session no revival：已有decisive组合回归。
- noExtensions/excluded owned-only、isolated/nestedoff/deny/narrow matrix、唯一管理registration/no override：已有actual session工具集合和执行断言。
- registered workflow launcher→same-menu-owner pause→wait/stop、下一child不启动、独立 sibling不stop、terminal时control清理、lifecycle实际auxiliary/host drain：已有回归。
- target/global searchclose/replacement+actualstreamclose/logpreserve、actualbackend stop renderertruth：已有回归。
- main随后独立recheck/tmuxaffected重跑 **NOT_RUN by this executor**；不代称此前main tmux8/8仍覆盖修改后结果。
- physical workflow menu keys、mouse/IME、在线模型、任意第三方late同名工具、自定义主题全矩阵 **NOT_RUN**。
- pnpm check **NOT_RUN**：脚本先link-sdk写链接且full使用forceexit，已用existingcompiler+configuredfullglobs自然退出替代；无独立lint脚本。
- 外部pi-trellis新名gate仍外部owner发布前置，本轮未实施/安装/port。
- docs/spec由main拥有，本轮未编辑；sessioncapability和no-composition finite management可由main酌情纳入通用约束。
