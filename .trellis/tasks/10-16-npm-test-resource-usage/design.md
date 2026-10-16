# 生命周期测试精简审查

## 第七批候选：初始化/校验成本审查（只读，待批准）

完整读取 initialization.test.mjs、init-review.test.mjs、init-diagnostics.test.mjs 与 engine.ts inspect/validatePlan/readOperation/recheck/apply。owned /tmp/pi-test-init-audit-0b7bHS 内存插桩：首次signature匹配packageResources失败，三个文件未加载（exit1），收窄计数边界后rerun76/76 PASS、自然退出31.14s/56.34CPU s。initialization plan50/apply24/validatePlan101/recheck1415、Python200次约15.47s、lstat152万次4.15s、普通readFile903.86MiB、operation3097.51MiB；init-review plan41/apply36/validatePlan114/recheck432、Python190次15.78s、operation954.70MiB；diagnostics只一次真正初始化，verifyRuntime39次、operation251.54MiB。读取是Node逻辑读取量，不含Python/copy、非物理磁盘吞吐；统计嵌套fs只计顶层以免双计，测试guards会替换探针影响部分计数。

根因：apply每发布一个action就recheck全体guards，并save完整含base64输出的plan；完成record又由readOperation反复validatePlan，重读package内容/启动Python skeleton。单次完整初始化本身重复成本高；不在本测试任务改生产算法，也不能用probe假结果掩盖验证。

I1 init-review十种forged incomplete operation：生成同一个真实first-write中断基线一次，复制小partial目录/record、校准root重算planHash，各case独立篡改；inspect/plan/apply拒绝与全目录no-write仍真实。内存实验10/10 PASS：baseline6.28s/6.13CPU s→template3.26s/3.22CPU s。明确仅~3s，非主要资源问题解决。
I2 root-prefix/duplicate/skip三变体及forged-root-attributes使用带对应AGENTS输入的一次中断模板，而非各次plan+apply。不同原始root输入不可错误共用一模板；无新通用framework。
I3 onboarding malformed records四变体：目前每次复制initialized项目后运行一轮真实identity apply建立join；改一次真实join模板，各次copy/删developer/改字段；保留真实plan拒绝+history不变。减少三次identity apply。
I4 initialization中只测host handler的task_error/unsupported release，改用已有copyRuntimeFixture，不测fresh apply；其余需要观察fresh init中断/完整发布的保留。这只是两次full apply减少。
I5 删除明确重复的published manifest interruption：init-review的published manifest不能执行/可以retry与initialization的manifest interruption整合成一组（保留verifyRuntime拒绝，实际重试一次，不跑两次full apply）。root bytes/exact block两组先集中保留一个真实发布，其余appendBlock/journalAttributes已有公开函数可纯Buffer测试，若碰到生产plan collision路径不能全部替代。
I6 diagnostics六个strict manifest mutation不应该每变体copyRuntimeFixture+verifyRuntime再collect；verifyRuntime拒绝由manifest-provenance字段矩阵负责，这里只保留collect静态投影拒绝，六变体一个独立fixture恢复manifest。其目标是第二套诊断parser接线，不应直接删除所有变体。

建议I1/I3/I4/I5/I6作为一批；不要宣称此批可到二三十秒。最大长期成本在数十次full apply固有O(actions*guards)；测试侧只有减少full初始化回归组合数量/保留小型代表端到端，才能明显降成本。若期待更大幅收益，需要另行批准更强的集成删减或生产初始化算法改动，不能在此只读/测试授权内越界。


## 第四批具体候选（历史规划）

完整读取 runtime-contracts、worktree-cli、preparation、worktree、resource-update、skill-deployment 及 Python cli/developer 实现。本轮仓库外插桩统计同步 spawnSync/execFileSync，只用于定位，不改测试代码。

- runtime-contracts 整文件：19.98 s、CPU 18.40 s；同步 Python 193 次累计 15.38 s，Git 140 次累计 1.77 s。带 --test-isolation=none 的诊断运行非标准全量，不直接比较既有 wall。
- worktree-cli 整文件：24.51 s、CPU 16.24 s；Python 100 次累计 23.25 s、Git 45 次累计 0.87 s。Python 计时包含其内部 Git/等待，不等同纯 Python CPU；异步 query 未计入此同步计数。

**U1 worktree-cli:strict CLI help/operation arguments（约 28 个坏参数）**：每个变体调用一次部署 CLI，实际只测试 parser/value/Once 与 JSON 错误包装。改为 Python unittest 直接调用现有 cli.main(argv)，逐例捕获 stdout/stderr、断言非零/ok=false，并 mock manage.assert_not_called；Node 留 --help、prepare --help 和 1–2 个部署 CLI 坏参数基线。仓库外内存实验复用原全部参数变体：baseline 2.22 s、CPU 2.07 s，单进程 0.49 s、CPU 0.46 s，全选中用例 PASS。明确不再对每个坏参数证明部署启动器，保留 main 的真实错误包装及无执行断言。

**U2 runtime-contracts:active rejects invalid identity/task/pointer 与 start invalid records**：所有命令执行相同 cmd_active/cmd_start，几十个输入变体每次加载完整 Python。把变体迁到 python unit test，直接调用真实 cmd_active/cmd_start、隔离环境和 cwd，逐例保留 pointer/task/hook marker 不变；Node 留有效 active/start/current/deactivate、一个坏 context key、一个坏 record 和外部路径/符号链接 CLI 接线。不能用纯 safe_segment 替代 cmd_active/start 的完整判断，也不能共享被污染 sys.modules 状态而不恢复。

**U3 runtime-contracts:developer unsafe names/trimmed dot**：约 14 个拒绝变体改单进程调用 common.developer.init_developer 并检查 .developer/workspace 不存在；Node 留 Unicode/spaces 成功、重复 identity 保留、get_developer 环境覆盖拒绝基线。Python unit 当前仅 diagnostics developer_text 覆盖，不足以直接删除 init_developer 回归。

**U4 resource-update.test.mjs:fixture**：4 个测试都 fresh apply(plan)，但测的是 update/repair，不是 init。改现有 copyRuntimeFixture(t,{user:'Dev'})，保留真实更新/repair、history、不支持 release/unknown 文件保护全部断言。小而确定，不引入新 helper。

**U5 preparation.test.mjs 与 worktree.test.mjs**：各自每个 case 新 git init/commit（10/15 cases），但更多是状态/prepare/remove。可复用已提交的 source 模板，只复制 Git fixture；不缓存 create 本身，因为多个用例确实测试 create 对 staged/index、branch、路径、失败记录的行为。优先 source-template-only，暂不引入通用 managed fixture 框架。收益未实验，不能保证。

建议第四批先 U1/U4 + U2/U3 的迁移，集中降低 Python 启动；U5 后置。无需再次跑模块发现列表，不改生产 runtime/哈希、不增加全局缓存。所有迁移后的 Python unit 保持由 python-worktree.test.mjs 默认全量入口 discover，用户要求单一全量入口不变。实验临时目录 /tmp/pi-test-native-audit-v15qfx，在结果记录后清理。

## 第三批具体诊断与建议（尚未批准实施）

已完整读取 apply-template、worktree-cli、manifest-provenance、init-review、initialization 五个测试文件及 engine.ts 的 manifest/资源验证实现。用户要求给出具体有效结论，本轮用仓库外 registerHooks 对现有测试做内存变换实验，不修改仓库测试。

### T1：manifest-provenance.test.mjs:143–147 的约 50 种 malformedManifests 矩阵

每个 schema 字段变体都会 preserved(t)→复制完整项目→verifyRuntime(copy)→完整 snapshot→verifyRuntime→inspect（Python probe）→plan（再 inspect/校验）→完整 snapshot。实际目标仅为 validateManifest 的字段/键集合/格式规则。改为同一真实 manifest 的 structuredClone，每个变体调用已有纯 validateManifest(manifest, packageProvenance)。packageProvenance 每组准备一次。保留少量 malformed runtime/template/skill 的 verifyRuntime/inspect/plan 端到端拒绝与无写入检查。移除约 50 个输入变体逐个证明 inspect/plan 无写入的重复集成覆盖，明确列为取舍，不假称同等覆盖。

已做原测试和内存优化对照：命令 node --test --test-concurrency=1 --test-force-exit --test-name-pattern='^manifest rejects' manifest-provenance.test.mjs；baseline 19.15 s、CPU 17.77 s；optimized 1.25 s、CPU 1.26 s。全部选中变体通过，串行先 baseline 后 optimized 单次，缓存顺序可能影响部分结果，但重复 setup 路径和调用数消除明确。不是全量加速百分比。

### T2：init-review.test.mjs:resource manifest rejects/still rejects 矩阵

其中 unknown role/source/kind/hash/template/mode 与 T1 重复，包括 missing role、wrong runtime source、unknown role field、malformed role fingerprint、malformed template mode。保留 init-review 的 forged incomplete operation/recovery 攻击；将重复 schema-only 变体删去或归并到 T1，保留代表性 runtime 篡改在 inspect/plan 的拒绝接线。stale template/role safe update 通过 applyResourcePlan 的成功链路不同，不能只换纯 validator。

### T3：apply-template.test.mjs:10 fixture

每个用例/矩阵分支执行 apply(plan(root,'Dev'))，全文件约 22 次完整初始化。其中 stale confirmation 4 次、runtime/scope/worktree/lock 6 次、symlink 3 次。这里测试 templatePlan/applyTemplatePlan，不测试初始化。使用已有 copyRuntimeFixture(t,{user:'Dev'}) 共用一次真实初始化，保留模板预览/发布/备份/无写入/运行时变化全部真实，不 mock template API。不应重写全局 runtime fixture 校验。

### T4：worktree-cli.test.mjs:93–103 readiness 矩阵

六个变体每次 fixture 都 git init+commit，create --confirm，再 prepare --confirm。先用一个 fixture 创建一次 unprepared worktree，逐次恢复 manifest 后运行 six prepare；每次失败检查状态仍 unprepared、target task 不存在，断言更强且状态保持独立变体输入。manifest/readiness 错误不改变 Git identity，无需六次 create。另有 strict CLI arguments 约 30 次 subprocess，大多是 parser 行为；Python 已有 parser unit tests，但本轮先不扩展删除，单独保留部署 CLI 接线。

### T5：两个明确 O(N²) 文件快照

initialization.test.mjs:35 和 manifest-provenance.test.mjs:74 在 for(before entries) 内调用 f.snapshot()[path]；每个 path 都重读整棵目录。提到循环外 const after=f.snapshot()，同样逐项比较 before/after，无断言损失。仓库外内存实验两个选中用例 baseline 6.79 s、CPU 6.37 s；optimized 5.88 s、CPU 5.87 s，均通过。不是主瓶颈但确定多余 I/O。

### 顺序与边界

建议先 T1/T2（最大已测收益）→T3/T5（fixture/snapshot）→T4（原生 create 复用），每阶段 focused 检查并提交；最终 Trellis 模块 time 对照及全量验收。不改生产实现、不新增测试层入口、不引入全局缓存/伪造哈希。不对未试验的 T3/T4 承诺具体收益。原始实验位于 owned /tmp/pi-test-targets-RwxTRd，可在结果记录后清理；实验模块使用 force-exit，不证明自然退出。

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
