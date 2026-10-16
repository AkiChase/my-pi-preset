# 生命周期测试精简审查

## 第一批后的下一轮探索（只读，尚未批准实施）

全量实测最慢为 dispatch 81.07 s、agent context 66.00 s，sync 17.70 s。下一轮优先处理 Trellis 逻辑测试不必要的原生 CLI 重复调用，而非盲删轻量内存断言。

- **N1 dispatch RPC/lifecycle 路由测试减重**：`dispatch.test.mjs` 中 early terminal、shutdown、stop denied、spawn failure、通知/lease 等用例，当前沿 readyFixture→真实 copied Git/worktree→registerDispatchTool→多次 native query。优先由现有 mockPython 在昂贵 query 边界提供一次从真实 fixture 捕获的、按当前临时根校准并经过产品 parser 验证的 envelope；保留少量真实 source/managed dispatch 基线。须逐项确认不能模拟掉该用例要证明的 source drift/lock-time/checkout snapshot 变化。
- **N2 agent context 身份与提示逻辑减重**：普通 source role 注入、header stripping、无 task、session key 等测试目前 setup 每用例 copyRuntimeFixture 并调用原生查询。可将纯 handler/header 用例与真实 native source/worktree 用例区分，采用已有 query seam，保持 task 文件权威校验。不能缓存替代 symlink、binding replacement、live authority 验证。
- **N3 fixture 重复验证**：`runtime-fixture.mjs:39–41` 每次复制后完整 verifyRuntime；模板创建已验证。探索是否保留模板和少量复制基线检查，普通逻辑用例不再夹具层重复全文哈希。生产 runtime gate 不动，不伪造基线哈希。
- **N4 remaining fake timer**：`tool-waits.test.ts` 尚有多组无 worker 通知真实等待，第一批 fake timer 成功可逐项扩展。CPU 密集度收益未知，主要减少墙钟。
- **N5 process activation 小范围减重**：已完整读取 `activation.test.ts`。normal exit disarms escalation 用例在实际 child exit 后再真实等 300 ms；可用 fake timeout 验证 late stop 无信号。shutdown 三进程矩阵／TERM ignoring descendant 有真实 OS 覆盖，暂不删；重复重入坏 sink 的组合先对照 monitor-session 后再判断。

已完整读取 worktree-query.ts、task-context.ts、runtime-fixture.mjs、worktree-fixture.mjs 与 process activation；其他相关文件未全面复审，以上是下一轮候选方向，不是已批准具体删除/实施清单。不添加测试分层，不改生产接口。要实现模拟 query envelope 必须先完整读 dispatch/context 现有依赖与 runtime gate，避免临时发明新框架或复制产品算法。

## 审查范围与方法

用户已批准扩展规划：在主会话逐项审查 workflow 与进程生命周期测试，先提交保留／删除／合并／减重清单，确认后再实施。当前未执行测试、未修改产品代码。

本轮完整读取以下 9 个文件，共约 3111 行：

- `extensions/agent-tasks/__tests__/workflow.test.ts`
- `extensions/agent-tasks/__tests__/tool-waits.test.ts`
- `extensions/agent-tasks/__tests__/runner-cancellation.test.ts`
- `extensions/agent-tasks/__tests__/backend-waits.test.ts`
- `extensions/agent-tasks/__tests__/auxiliary-lifecycle.test.ts`
- `extensions/process-tasks/__tests__/lifecycle.test.ts`
- `extensions/process-tasks/__tests__/waits.test.ts`
- `extensions/process-tasks/__tests__/spawn.test.ts`
- `extensions/process-tasks/__tests__/bash-survive.test.ts`

已读取 `extensions/agent-tasks/src/workflow/runtime.ts:680–859` 的 worker 创建与终止实现。此清单不覆盖全部 140 个测试入口，也不是运行结果。其余 process monitor、SDK runtime、UI lifecycle 测试尚未逐项审查。

## 核心发现

1. 测试名称中的 actual 多指真实产品 runner/manager/factory，不意味着真实模型会话或完整 SDK 对象。runner-cancellation 的 detectEnv、resource loader、createAgentSession 都被替换；tool-waits 的 runAgent/resumeAgent 使用假 session。因此不能把这些文件全部描述为真实 SDK 集成。
2. 两个忙循环用例没有等待 worker 的 ready 消息，仅等待 80/60 ms 后 shutdown。高负载时可能尚未进入循环，不能可靠证明忙循环终止。
3. `workflow/runtime.ts:725–781` 对完成、挂起或忙循环脚本都通过同一 `worker.terminate()` 路径终止。已有 `workflow.test.ts:43` 的 worker 消息握手后 abort 测试可保留基础终止覆盖；不代表删除后仍有忙循环专项证据。
4. tool-waits 大量使用真实 130/260/250 ms 等等待；这些等待主要拉长墙钟耗时，不等于 CPU 忙循环。现有同文件末段已有 fake timer 用例，具备减重先例，但需验证 fake timer 与 worker 的兼容性，不能一刀切推进所有真实 worker 定时器。
5. 普通低层断言多为内存操作，主要成本可能在每文件模块启动；删除断言数量不会自动显著降低 CPU。

## 第一批具体清单（已获实施批准）

| ID | 位置 | 建议 | 覆盖边界与理由 |
| --- | --- | --- | --- |
| L1 | `tool-waits.test.ts:573–584` | 删除 | factory shutdown 忙循环用例未握手；已有暂停 workflow 的实际管理 stop/wait 测试（:1053 起）和 worker abort 测试。失去忙循环专项覆盖，不声称等价替代 |
| L2 | `tool-waits.test.ts:627–638` | 减重 | CLI 重复启动验证独有，应保留注册入口／只执行一次／shutdown 无通知断言；脚本改为挂起 Promise，移除忙循环。不新建专项测试 |
| L3 | `process-tasks/__tests__/bash-survive.test.ts:43–79`（整个文件） | 合并后删除文件 | genuine cancel 与 background survive 已由 `waits.test.ts:53–76、100–120` 在同一 registerBashTool 边界验证；保留 survivor PID 断言，并把已停止进程不存在的断言补进 abort/stop 用例。移除额外文件加载和两组各 600 ms 固定等待。该文件使用默认 registry/logDir、未等待 execute 结束；不应因此直接声称已发生污染 |
| L4 | `tool-waits.test.ts:651–666` | 合并后删除 | 自然完成通知验证并入 :1053 的 registered workflow stop/wait 测试（已有独立 sibling 保护）或保留最小自然完成断言；避免重复启动两组 worker。:1090 的 launcher 管理用例仍验证完整输出／启动失败／多等待 |
| L5 | `tool-waits.test.ts:1090–1115` 中末段 stop 场景 | 合并 | :1053 用例已有 actual task_manage stop、wait、paused、独立 sibling 和 control 释放。这里保留完整答案、多等待、args 失败及非法 output 参数，去掉重复 worker stop 场景 |
| L6 | `tool-waits.test.ts:558–571` 与 `auxiliary-lifecycle.test.ts:30–46` | 保留但收窄 | 前者证明 input→clone→factory 关闭接线，后者证明具体 clone 取消边界；不是完全重复。factory 用例只保留接线 observable，底层负责 dispose 等内部计数 |
| L7 | `runner-cancellation.test.ts:220–229、462–472` | 合并 | new/resume 的 subscription setup 失败参数化为同一个测试，保留每条路径特有的局部 session disposal 与 abort listener 断言；不是直接删除一种路径 |
| L8 | `runner-cancellation.test.ts:489–561` | 合并／减重 | 将 completed retained、direct dispose、running child、throwing sibling 的重复 hookResource setup 收束成带状态/入口的表驱动组；真实空 interval 改成可观察的资源状态，断言 hook 调用与清理，不新增 GC。是否能减少用例取决于路径差异，不能先承诺固定删除数量 |
| L9 | `process-tasks/__tests__/spawn.test.ts:14–59` | 合并 | stdout、stderr、nonzero exit 三个真实 shell 合为一次同时输出两流且 exit 42 的测试，仍断言全部行为；减少两次 shell 启动 |
| L10 | `spawn.test.ts:61–127` | 保留／减重 | AbortSignal、进程组终止、孙进程持 fd 三种 OS 行为不应假对象替代。使用启动握手而非固定 200/100 ms 等待；孙进程用例的 Promise.race 超时需清除，确保 owned process/logDir 可靠清理。无实测，不声称已有泄漏 |
| L11 | `lifecycle.test.ts:19–157` | 保留／合并简单断言 | PID 无效值、exit→status 映射合并表驱动；删除只检查 Map/default fields 的 :149–157 低价值实现断言。幂等终态、abort controller 归属保留，均非 CPU 密集集成 |
| L12 | tool-waits 中非 worker 通知用例的 `pause(130/260/250)` | 减重 | 逐个在现有 factory 用例注入 fake timers，验证实际通知行为，缩短真实时间等待；真实 worker/RPC 消息握手用例不可凭时间快进声称消息已完成 |

## 保留的最小行为骨架

- worker 正常完成、基本 RPC、abort 真正终止和暂停后不启动下一 child（`workflow.test.ts`）。
- 实际工具注册后 launch/output/wait/stop 的接线，至少一个独立 sibling 不被误停的集成场景。
- `/bg` 保持同 PID；取消 retrieval 不停止执行；命令失败码与 stdout/stderr 返回。
- 启动取消后不能 prompt、正常失败可以 resume、shutdown 后旧执行不能发通知。
- 停止后的 admission 与 execution drain 区分，避免队列永久卡住或旧执行释放新槽位。

## 未纳入第一批

- 删除整个 runner-cancellation/backend-waits/auxiliary-lifecycle 文件。
- 重写生产生命周期、包装函数或 worker 实现。
- 审查所有 monitor、TUI、完整宿主测试；若以后扩展需另行明确。
- 安装依赖、并发运行多套全量基线、推送、清理其他会话临时输出。

## 风险与实施前约束

- 合并后的断言必须映射原行为，允许明确删除忙循环与 GC 专项覆盖，不得假称仍有该证据。
- 重叠文件有其他任务未提交修改；stage commits 必须只选择本任务 hunks，无法安全选择时报告 blocker。
- fake timer 更改先在无 worker 的用例验证，不以失败为由削弱断言或改变生产默认值。
- CPU 并发 8 不保证低峰值；先消除内层并发再采样。减少等待可能加速下一组启动，平均 CPU 不一定下降。
