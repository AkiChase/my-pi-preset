# 阶段 2B 定向复核修复

## 授权与边界

按用户批准的 final plan，只修独立 review `43dd593d` 指出的四条 agent backend 实际路径。直接实施，没有嵌套 implement/check、commit、task start/finish/archive、真实模型/git/网络、install/reload 或用户配置改写。未修改 process、task-ui coordinator、composition、workflow 算法／child guard／loader hard assertions。阶段 3 epoch、重复真实会话切换和阶段 4 最终面板仍未实施；相邻 subagent-turn-limit 规划不属于本段，现有回合限制保留。

## 修复后的实际路径

1. **async startup 取消不会迟到 prompt**：`src/agent-runner.ts` 新增 typed `AgentRunnerDependencies` 三项局部 seam，生产默认仍走 SDK。入口已取消、detectEnv 后、loader.reload 后、createAgentSession 前后、bind 后、session callback 后、首次 prompt 前都检查 backend controller signal；不是只 abort session 然后无条件 prompt。structured retry 继续保留 signal／hard-limit cancellation guard。partial session 通过共用 `shutdownChildSession` 做 3 秒有界 shutdown + dispose，WeakSet 保证 runner error 与后续 manager disposal 不重复。实际 prompt 已开始后的 provider failure 保留旧显式 resume 能力。`AgentManager.starting` 在 onSessionCreated ready 才清除；parent detach 只解绑父链接，backend signal 未取消，正常 run 仍可开始。
2. **后台 transcript setup rollback**：`src/index.ts` background new 对当前 toolCallId/joinMode/attachTranscript 的同步初始化包 try/catch，失败先消费未返回 run 的 notice 资格、cancel nudge/forget group、stop controller/run，再原样抛异常；在加入 batch/activity 之前，文件不删。queued stop 在 manager settle 清 startGate，pool 只释放当前 lease。background resume 先完成 artifact preflight，再更换上一 run 的通知／关联；preflight 抛错不创建 run，也不吞旧结果。立即 stream subscribe 失败 abort controller、settle admission、重抛同一异常，不调用 resume runner；已经返回 ID 的 queued resume 若稍后 stream 接线失败，是该 run 一次正常失败报告，仍不 prompt／不漏 controller/pool。foreground 原 setup guard 保留；已失败即时 foreground resume 不重新塞入 activity map。
3. **tool-call 关联**：foreground new 在 getRecord/getRun 后、首次 await 前赋当前 toolCallId；foreground resume 在成功 preflight 后、resumeRun 前赋当前值。undefined mention 清旧 ID，不改变外部工具 schema。后台通知 XML 的 `<tool-use-id>` 和内部 `NotificationDetails.toolCallId` 来自当前 run。
4. **通知有限终态统计**：manager record 保存 per-run turnCount/maxTurns；new 初始化，resume 重新计数并接入 runner onTurnEnd。后台 individual/group details 不依赖已被 finishActivity 删除的 runtime map；group terminal snapshot 保留统计，consumed 成员过滤后其他 details 仍精确。resume soft steering／hard turn-limit 保留，实际 runner 有离线验证；不是移除 modelmaxturns 的实现。

## 实际改动文件

- `extensions/agent-tasks/src/agent-runner.ts`：typed 输入 seam、await/prompt 取消、partial session 幂等关闭、resume 订阅失败清理及 per-run 回合事件／限额。
- `extensions/agent-tasks/src/agent-manager.ts`：共用 session shutdown、ready starting、terminal startGate、record finite stats、resume stream setup 失败与回合转发。
- `extensions/agent-tasks/src/types.ts`：AgentRecord effective maxTurns、NotificationDetails 当前 toolCallId；不改工具输入 schema。
- `extensions/agent-tasks/src/index.ts`：后台初始化回滚／resume preflight 结果所有权、foreground new/resume 关联赋值、终态 details 读取。
- `extensions/agent-tasks/__tests__/runner-cancellation.test.ts`：新增 **13 项**，执行真实 runner/manager；只 stub detectEnv/loader/create 的昂贵输入。
- `extensions/agent-tasks/__tests__/tool-waits.test.ts`：在既有 8 项上增加 **7 项** actual registered tool + manager 回归；factory 支持不同／undefined call ID、实际 backend registry 只读观察与临时 artifact fault。
- `README.md`、`extensions/agent-tasks/PROVENANCE.md`：准确同步启动取消、setup failure、通知统计；仍明确 epoch/UI 未完成。
- `.trellis/spec/preset/extension-guidelines.md`、`testing-guidelines.md`：实际 runner／unreturned result 所有权与 fault regression 约束。
- 本中文研究记录：本轮证据；未覆盖旧 handoff 的历史结论。

## 正向验证

所有命令用临时 `PI_CODING_AGENT_DIR`，完整检查提供只读实际 SDK 路径 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules`。没有修改 SDK／新 build 或 global mock。

- `PI_SDK_DIR=<actual> PI_CODING_AGENT_DIR=<temp> pnpm check`：最终真实 strict/noEmit + **389/389、0 fail**，`/tmp/stage2b-fix-check-final2.log`。项目脚本自身使用 force-exit，不能视为自然退出证明。
- `PI_CODING_AGENT_DIR=<temp> node --test extensions/agent-tasks/__tests__/*.test.ts`：**47/47、0 fail**，无 force-exit，自然退出，`/tmp/stage2b-fix-agent-final2.log`。
- `PI_CODING_AGENT_DIR=<temp> node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts`：**367/367、0 fail**，无 force-exit，自然退出，`/tmp/stage2b-fix-three-final.log`。
- 单独实际 runner 初轮修正后 9/9；最终包含 13 runner + 15 tool，共新增 20 tests（旧基线 369/27，现 389/47）。现有 source-loader、root/child guard、真实 worker 的硬断言未改。
- `git diff --check` 通过；`python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-subagents-task-ux` 通过（implement/check JSONL 各 19 条）；五份本轮文档的本地 Markdown 链接检查通过。不触碰任务 lifecycle。

## 四项反向验证：旧缺陷确实被测试抓住

临时局部恢复每个旧缺陷，只改允许的源文件；Python `finally` 原样恢复，之后重新跑全部正向检查。脚本 `/tmp/stage2b-mutation.py`，没有 git revert／拷贝其他 worktree：

- 禁用 runner cancelled guard：实际 delayed env/reload/create/bind/callback/prompt 6 项出现 missing rejection（如果保留第一次 abort 但仍 prompt，仍不能通过），exit 1，`/tmp/stage2b-fix-mutation-runner-checks.log`。
- 禁用 background new rollback：实际 ENOTDIR registered tool 没有 stopped record，断言失败，exit 1，`/tmp/stage2b-fix-mutation-background-rollback.log`。
- 删除 foreground new/resume correlation 赋值：不同 call ID 通知细节断言失败，exit 1，`/tmp/stage2b-fix-mutation-call-correlation.log`。
- 恢复 activity-map-only turn/maxTurns：延迟 group first/others 统计断言失败，exit 1，`/tmp/stage2b-fix-mutation-terminal-stats.log`。

这些是预期失败证据，不计正向通过；所有 mutation 完成后恢复并重新验证 final2 full/no-force。

## 失败历史与修正

- 实际 runner fixture 首轮缺 SDK ctx.getSystemPrompt，env 后提前 TypeError，其他 delayed boundary 等不到；只终止本测试 background PID，补真实 ctx surface，定向自然 9/9。没有把早期 fixture 失败归于产品通过。
- 实际 ENOTDIR queued stop 发现 terminal startGate 仍留 resolved Promise；在 manager settle 清除后通过。
- structured retry fixture 误写 compileSchema，按实际 compileJsonSchema 的 union contract 修正。
- full strict 曾因测试 steer 返回 Promise<void> 不符合 SDK QueuedInputDisposition 失败；修正返回 queued。随后 full **388/389**，真实 resume limit 测试发现 optional chaining 把 ++turnCount 放在可选回调参数里，无回调就不执行计数；改为单独自增，实际 new/resume limit 和最终 full 全通过。

## 验收与未做

四个 review 缺陷及本轮关联的真实失败回归已通过：对应 AC2/AC4 的 agent startup/detach/Esc 局部、AC10 的通知归属／统计／关联局部、AC12 的离线 strict/full。不是完整产品 ready，不勾选 G2／AC9 整体。

阶段 3 完整 epoch、重复 session_start／真实会话替换、scheduler/mention/late worktree 隔离、显式 stopped silent feedback仍由另 agent 实施；阶段 4 shared tree/footer/Down focus-safe/editor/旧 widget FleetView 删除仍未实施。真实 Pi TUI、用户 dev 加载和完整非 UI 能力矩阵未执行。主会话应核对本轮实际 diff 和 389/47/367 证据，再决定是否关闭 G2／派下一阶段；不以这些 tests 宣称 phase3 已完成。

## 后续复核 e946b60a：仅两条补修

主会话已独立验证原四修复，并新增 mixed-waits 回归，补修前基线 full **390/390**、三模块自然 **368/368**；本段未修改该 mixed fixture、README 的 testing 段、process／composition／UI／阶段 3。

### 实际 diff

- `agent-runner.ts`：复用既有 closedSessions，增加 backend 窄只读 `isChildSessionClosed`。resumeAgent 在 hard limit 调 session.abort 前记录 aborted，返回可选 aborted/steered；旧 trusted fake/programmatic runner 不带标志仍兼容。
- `agent-manager.ts`：在实际 runAgent rejection catch 清除已关闭部分 session 的当前匹配引用及 sessionFile，resumeRun 因无 session 拒绝。只有 bookkeeping 明确关闭的引用被清除；真正 prompt failure 没有被 dispose，保留原会话正常 resume。startResume 采用与 new 相同优先级：外部 stopped > aborted > failure/error > steered > completed，保留本次部分 text 与 old runId terminal snapshot。
- `runner-cancellation.test.ts`：强化原 callback-failure test，设置真实非空 sessionFile 并断言 session/sessionFile 清除、resumeRun 拒绝、重复 dispose 一次；强化原 hard-limit test 的 runner flag。新增 3 项实际 runner/manager/host 回归：genuine prompt failure 保留 live session并正常 resume；hard/soft/provider/stopped 的 current terminal stats/flags/onComplete/partial text 和 prior snapshot；真实 workflow host 对 hard-aborted resume 返回 ok:false。workflow 算法未改。
- README 的 agent behavior、既有 provenance／extension spec：同步已 dispose startup 不可 resume 及 limit 终态语义。本节记录后续证据。

### 先红后绿及最终验证

新断言／测试先在旧路径运行：定向 **12/16 pass、4 fail**（closed session、runner aborted flag、manager terminal flags、workflow host 成功判定），日志 `/tmp/stage2b-followup-red.log`；genuine prompt failure 保留会话测试旧路径已通过，确保修复不误删这类实例。

初次局部 replacement 落在 launch startup-only catch，实际 runner catch 尚未清引用，定向仍 15/16；已移到实际 `.catch(async err)` 后 16/16。随后 strict 检出 WorkflowHost.resumeAgent 是 optional，fixture 用 assert.ok 收窄，不加 unsafe cast。失败不计通过。

最终采用 `set -e`、临时 PI_CODING_AGENT_DIR 与只读 actual SDK：

- `pnpm check`：真实 strict/noEmit + **393/393**，`/tmp/stage2b-followup-full.log`；脚本自带 force-exit。
- `node --test extensions/agent-tasks/__tests__/*.test.ts`：**50/50**、无 force-exit自然退出，`/tmp/stage2b-followup-agent.log`。
- 三模块同一 node --test：**371/371**、无 force-exit自然退出，`/tmp/stage2b-followup-three.log`；主会话的 mixed waits 原断言通过且未修改。
- 实际 runner 单文件修复后 **16/16**，`/tmp/stage2b-followup-green2.log`；全量 final 包含随后补强的 sessionFile 非空断言。

本补修仍不是整体 G2／产品 ready；phase3 epoch、真实重复会话切换与最终 UI 未实施，等待主会话验证／决策。无模型/git/network/install/commit/task lifecycle／递归子 agent。
