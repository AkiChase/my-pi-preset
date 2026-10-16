# 第一批实施计划

## 授权与边界

用户已明确批准先执行第一批清单，完成后再规划下一批，复用本任务。主会话直接实施、自审；测试改动不涉及公共产品接口或生产生命周期重写，无需独立代理审查，遵守不启动 agent 的要求。批准包括范围内验证与本地阶段提交，不包括 push、归档、安装依赖或下一批实施。

现有业务行为不变，删除 GC/忙循环专项覆盖，其余通过合并/减重保留断言。不修改 SDK。保留单一全量入口，不新增测试分层。

## 第二批（用户已批准实施）

- S5：dispatch 的 13 个纯 RPC/state 用例使用 stateFixture；按 source/managed 从真实模板捕获 plain/task/implement/check 四类 query envelope，校准临时 root，由已有 mockPython 返回。产品 parser、Git snapshot、runtime 校验、文件/锁/execution 读写保持真实。role/task 之外请求拒绝；native drift、安全和 Python 互通用例不使用该 helper。完整 dispatch focused 后提交。
- S6：agent context 的 managedChild 复用一次真实 create/prepare 模板，复制后校准 Git links/marker/binding/初始化记录；target 缺 task 的专门集成仍保留原创建流程。复制目录及状态独立，真实 source query 和 binding/symlink/runtime 检查不 mock。两个变更文件自然退出 focused 后提交。
- S7：typecheck/full npm test 串行验收，记录 time 累计 CPU 和墙钟。使用新 owned 仓库外临时目录，不安装，不改生产接口。之前 full 102.92 s 是参考观察，机器负载不同不能当严格 A/B。保持任务 in_progress，下一轮另确认。

## 第二批验收记录

- S5 已完成，commit `f4b9bad`：13 个 RPC/state 用例切换 captured native query seam；只作用这组 fixture，不模拟其他 CLI。focused `node --test --test-concurrency=8 extensions/trellis/__tests__/dispatch.test.mjs`：35/35 PASS、exit 0、自然退出 41.45 s。
- S6 已完成，commit `ac2ea7a`：7 个 managedChild 用例共享一次 create/prepare 模板，按用例复制校准 Git/初始化/binding/marker 记录；所有动态身份、symlink、runtime/query 仍真实。focused 两个变更文件：63/63 PASS、exit 0、自然退出 43.22 s；dispatch 42.52 s、agent context 33.75 s（并行，不能相加）。
- S7 已完成：现有 Node v24.14.1/SDK 1.3.0/临时 agent-dir，`pnpm run typecheck` exit 0；`/usr/bin/time -l npm test` exit 0、1550/1550 PASS、78 suites、无 fail/cancelled/skipped。全量 106.91 s、user 349.22 s、sys 190.47 s，平均累计约 5.05 核；maximum resident set size 600129536 bytes，不是进程树同时 RSS。
- 全量 reporter dispatch 72.45 s、agent context 60.82 s、sync 18.69 s。相比第一批 full 102.92 s，本轮墙钟没有改善，累计 CPU 547.19→539.69 s 小幅减少但非受控 A/B、不可归因。无峰值采样，不能宣称满载已解决。
- 检查：两阶段 diff 自审、`git diff --check` PASS；不改生产实现、不删除测试、不改变发现范围/并发。未出现测试 FAIL；本 task 材料单独提交，其他会话未提交变更保留。空 implement/check manifests 是不派发代理的刻意配置，不声称 task validate 完整通过。
- 原始日志位于本轮 owned `/tmp/pi-test-resource-b2-tYcpP1`，验收后清理本目录。无需持久化原始日志，以上记录独立于临时路径。
- 第二批完成，继续复用任务，不归档。下一轮目前仅候选：实际资源占用仍主要由大量原生集成/初始化校验叠加造成，需审查其覆盖重复和进程树峰值，不能继续只凭单文件耗时猜测。

## 模块性能诊断（用户批准执行，不修改测试代码）

Node v24.14.1、10 可用核、既有 SDK、每组临时 agent-dir。12 个模块合计 139 个入口，串行运行 `/usr/bin/time -l node --test --test-concurrency=8 --test-force-exit <该模块全部文件>`；结果均 exit 0、0 fail/skipped。脚本按半秒 cadence 使用 `ps -axo pid,ppid,%cpu,rss,comm` 从 time PID 递归收集当时存活进程树。短命 Python/Git 可在采样间结束或被 reparent，`ps %cpu` 是 OS 平滑统计而非精确半秒 CPU 增量，因此采样峰值低估/滞后，不能作为硬峰值上限。累计 CPU time 包含回收的子进程，比采样总量更适合比较成本；模块墙钟不能相加成全量墙钟。

| 模块 | 文件 | wall s | user+sys s | 平均核 |
| --- | ---: | ---: | ---: | ---: |
| trellis | 29 | 85.67 | 421.20 | 4.92 |
| agent-tasks | 11 | 19.80 | 14.29 | 0.72 |
| scripts | 2 | 16.55 | 11.38 | 0.69 |
| at-path-completion | 7 | 8.78 | 5.70 | 0.65 |
| memory | 9 | 4.21 | 14.58 | 3.46 |
| process-tasks | 33 | 3.13 | 15.91 | 5.08 |
| runtime-tasks | 10 | 2.94 | 9.61 | 3.27 |
| session-assist | 16 | 2.05 | 11.96 | 5.83 |
| beautify | 6 | 1.71 | 6.57 | 3.84 |
| task-ui | 9 | 1.26 | 4.77 | 3.79 |
| shared | 4 | 0.62 | 1.59 | 2.56 |
| extension-boundaries | 3 | 0.50 | 1.31 | 2.62 |

合计 CPU 518.87 s，Trellis 占 81.2%。Trellis 当时存活进程树采样最多 20 进程，出现 Node/Python/Git；采样 %cpu 合计最高 550.2%，不是真实瞬时上限。其他短模块也有启动峰值（memory 采样 633.6%、agent 588.6%），但持续时间/累计成本远小于 Trellis。scripts 采样峰值 24.2% 与累计平均 0.69 核不一致，印证大量短命子进程在 ps 采样中丢失；不采用该低采样值推断 CPU 成本。

### Trellis 二次细分

继续串行运行各细分、相同配置，均 exit 0：

| 组 | 文件 | wall s | CPU s | 平均核 |
| --- | ---: | ---: | ---: | ---: |
| dispatch.test.mjs | 1 | 35.67 | 28.86 | 0.81 |
| agent-context-integration.test.mjs | 1 | 26.77 | 21.54 | 0.80 |
| 初始化：init-review/initialization/skill-deployment | 3 | 27.56 | 55.33 | 2.01 |
| 更新接管：adopt-block/adopt-project/apply-template/resource-update | 4 | 24.75 | 34.83 | 1.41 |
| 其他 Trellis 文件 | 20 | 39.06 | 167.42 | 4.29 |

细分合计 CPU 307.98 s，低于合并运行的 421.20 s；机器负载/调度/缓存不同，不能直接量化并发因果，但支持大量原生集成同时运行产生明显争用，非只有 dispatch/context 两文件。其他组最慢具体用例 readiness malformed materials 6.36 s、Python/host interoperability 4.22 s、clone identity 3.62 s。更新组 unsupported runtime/scope/lock 矩阵 6.44 s、stale confirmation 4.25 s、symlink safeguards 3.84 s。下一批应先审这些矩阵反复初始化与查询，不优先删仅 1–3 秒的 UI/Process 模块。

原始日志、每组命令/采样、临时 driver 在 owned `/tmp/pi-test-modules-xFAq9i/`，本轮完成无未诊断测试失败，可按 owned 范围清理。未改产品代码，没有安装/真实 provider/终端执行；采样是诊断，不证明自然退出（模块运行保留全量 force-exit）。下一批优化范围尚未批准。

## 第三批（用户已批准实施）

S8：T1/T2，将 50 个 manifest schema 变体集中到纯 validateManifest，保留 runtime/template/skill 三类 malformed manifest 的 verifyRuntime/inspect/plan 无写入集成；删除 init-review 重复字段矩阵，保留独有 recovery 与 safe update。focused 两文件自然退出后提交。
S9：T3/T5，apply-template 改用现有 initialized copy fixture；initialization/manifest 两处 snapshot 提到循环外，全部原业务断言保留。focused 三文件后提交。
S10：T4，readiness 六种输入复用一次 unprepared worktree，各次真实 prepare 失败均检查记录/target 不变。focused worktree-cli 后提交。
S11：串行 Trellis timed suite、typecheck 和 full npm test；保留原日志于 owned /tmp/pi-test-b3-WL4YqR，记录失败/重跑/CPU 与墙钟。主会话实施、自审，不派发，无安装/生产变更/归档。

## 第三批验收结果

- S8 commit `ff2167c`：50 schema 变体改纯 validateManifest，增加 null runtime source/extra template 两种集中覆盖；保留 runtime/template/skill 三组真实链路拒绝。移除 init-review 12 个重复集成用例，集中新增 5 项（2 字段 + 3 集成），净减少 7 测试。focused 85/85 PASS、exit 0，自然退出 20.47 s。
- S9 commit `ab71833`：apply-template 的约 22 次 fresh initialization 改一次模板构建/独立复制；两处 O(N²) snapshot 提到循环外。focused 100/100 PASS、exit 0，自然退出 27.64 s。
- S10 commit `5a0de56`：六个 readiness 变体共用一次 create，每次真实 prepare 拒绝新增 binding 文件 byte-for-byte 不变断言；移除无用 imports。focused worktree-cli 15/15 PASS、exit 0，自然退出 26.29 s。
- S11：现有 Node v24.14.1/SDK 1.3.0、临时 agent-dir。`/usr/bin/time -l node --test --test-concurrency=8 --test-force-exit extensions/trellis/__tests__/*.test.mjs` exit 0，全部通过、无 fail/cancelled/skipped；wall 69.91 s，user 214.58 s、sys 135.49 s，CPU 350.07 s。此前相同并发模块观察 wall 85.67 s、CPU 421.20 s；本次分别少 15.76 s（18.4%）和 71.13 CPU s（16.9%），不同运行环境/缓存非严格 A/B，仅陈述观察差。
- `pnpm run typecheck` exit 0；`/usr/bin/time -l npm test` exit 0、1543/1543 PASS、78 suites、无 fail/cancelled/skipped。wall 90.38 s，user 307.88 s、sys 165.20 s，CPU 473.08 s。第二批 full wall 106.91 s、CPU 539.69 s，观察减少 16.53 s（15.5%）、66.61 CPU s（12.3%）。CPU平均仍约 5.23 核，没有采样真实峰值，不声称满载解决。
- 保留所有批准范围内 schema 变体及模板/prepare 业务断言；明确减少逐字段完整 inspect/plan 重复覆盖，不修改生产实现、不改并发/glob、不安装。self-review 与各阶段 `git diff --check` PASS；无测试 FAIL。日志位于 owned `/tmp/pi-test-b3-WL4YqR`，结果已核对后清理；其他会话文件不纳入提交。任务继续 in_progress、不归档。

## 第四批（用户已批准实施）

S12 U1/U4：CLI bad-argument 矩阵迁入现有 Python discovery，直接 main(argv) 并断言 manage 未调用；Node 保留 help 与两个错误启动基线。resource-update 复用现有 copyRuntimeFixture。focused Python/CLI/update 后提交。
S13 U2/U3：非法 active/start identity/record/pointer 和 developer 名称变体迁入 Python unittest，隔离 cwd/env、调用真实 handlers、检查文件/hook 不变；Node 保留真实成功 lifecycle 与坏输入/外部路径/symlink代表基线。focused Python/runtime-contracts 后提交。
S14：定向自然退出、typecheck、timed 全量串行验收；仓库外 owned /tmp/pi-test-b4-CkSCGD。生产 runtime/哈希/接口不变，无新分层入口，不派发、不安装，任务不归档。

## 第四批验收结果

S12 commit `126e890`：CLI 参数变体迁 Python main(argv)，每次检查 JSON/非零/管理未调用；Node 留 help+两个坏参数部署接线，resource-update 复用初始化模板。focused python-worktree/worktree-cli/resource-update 20/20 PASS、exit 0，自然退出 21.66 s。
S13 commit `5a253d6`：active/start/developer 输入矩阵迁真实 Python handler 单进程测试，隔离 cwd/env、保留文件与 hooks 保护；Node 留代表变体/成功/外部路径/符号链接。Python unittest discover 37/37 PASS、exit 0、0.366 s；Node python-worktree+runtime-contracts 27/27 PASS、exit 0、自然退出 17.90 s。完整 variant 列表保留，Node 顶层测试数不变，Python discovery 新增 5 tests。
S14 Node v24.14.1/SDK 1.3.0、临时 agent-dir，`pnpm run typecheck` exit 0；`/usr/bin/time -l npm test` exit 0、1543/1543 PASS、78 suites、0 fail/cancelled/skipped。wall 84.78 s、user 297.21 s、sys 162.77 s，CPU 459.98 s。第三批 full 90.38 s、CPU 473.08 s，本次观察少 5.60 s/13.10 CPU s；不同轮次非严格 A/B，平均仍约 5.43 核，不声称 CPU 峰值/满载解决。
所有阶段 self-review 与 git diff --check PASS，无生产 runtime/哈希/接口变化，不安装/派发/归档。Python unit 默认通过 python-worktree.test.mjs 进入同一全量入口，无新测试分层。未发生测试 FAIL；迁移时一处 JS 文本拼写在执行测试前检查修正，不属于产品失败。owned 日志 /tmp/pi-test-b4-CkSCGD 在最终核对后清理，其他会话变更未提交。

## 第五批（用户已批准实施；完成后继续只读审查下一批）

S15：agent-context-integration identity 五字段逐例真实集成降为 bindingId 一个代表；worktree.test 增加直接 sameIdentity 全部 immutable 字段/双方比较与 mutable 状态不影响断言，parseBinding schema 使用构造记录，不 git init/create。仅改这两个测试和本任务材料；真实 Git/index/删除/symlink 安全集成不变。主会话直接实施和自审，不派发；focused 自然退出后立即提交。然后审 dispatch 重复原生 query 的实际目标，不自动扩大实施范围。

此前 owned /tmp/pi-test-critical-xMwjgJ 两次全量诊断 exit 1（80.84/84.78 s）：1345 tests、42 fail，工具返回 task_id/run_id→agent_id/execution_id 及 task_manage→agent_manage/process_manage 断言不匹配；第二次恢复 PI_SDK_DIR 后仍复现，对应其他任务的在途契约修改，不按环境问题掩盖、不修复范围外文件。Trellis 全部通过。同期两套件插桩 63/63 PASS：dispatch query-worktree 157 次/30.54 s，context 93 次/22.23 s；Node readFile 444.28/825.20 MiB，0.71/1.09 s（不含 Python/Git/copy，非物理吞吐），复制 3.10/0.86 s。identity 五字段内存实验 baseline 14.36 s/9.82 CPU s、只留 bindingId 4.65 s/3.69 CPU s，均 PASS，但不是最终 coverage 替代验收。S15 输出 /tmp/pi-test-b5-qV005p。

## 第五批结果与下一批诊断

S15 `ccbbb73`：identity 五字段集成→bindingId 一个真实 child 替换 + sameIdentity 十个 immutable 字段双向对象断言，mutable state/lastError 不影响；schema test 不再创建 Git。`/usr/bin/time -l node --test --test-concurrency=8 extensions/trellis/__tests__/agent-context-integration.test.mjs extensions/trellis/__tests__/worktree.test.mjs` 临时 agent-dir、exit 0、40/40 PASS、无 fail/skipped/cancelled，自然退出 25.21 s/26.36 CPU s。选中文件 diff 和 staged diff check PASS；全仓 diff check 报范围外 extensions/runtime-tasks/facade.ts EOF 空行，未修改。未重跑在途工具契约的全量/typecheck，不声称全量验收。

下一批只读证据：完整读取 subagent-rpc.ts，成功 managed dispatch 本身需 six query subprocess（plain、task、两轮 supportedRelease 各额外 plain+role），单 query 又派生多个 Git。仓库外 TRELLIS_PYTHON wrapper 追踪 subprocess.run：首次 wrapper 不支持 -B -c，初始化探针失败、35/35 FAIL（夹具连锁失败）；修正为 -c passthrough 后 rerun 35/35 PASS，自然退出 37.02 s。成功轮与首轮 trace 中 query 合计174次、16.49 s，其中945次Git/13.89 s，rev-parse 542次/8.10 s、worktree 271次/4.03 s、check-ignore与ls-files各66次/约0.9 s。计时包含等待，非纯CPU；比此前157次多，是拦截了同步调用与capture，不与此前直接相减。主要放大在每次原生查询重复 Git 身份，不是Python启动本身或Node文件读取。

N6候选（未批准）：dispatch 的 custom-role/target-pointer、multiline prose 两项用现有 stateFixture；真实role文件检查/target pointer 文件/产品query parser保持，固定原生facts意味着不再证明原生query忽略target pointer。已有target task absent/source authority真实基线保留。内存对照两项 baseline5.19s/4.31CPU s→optimized3.36s/3.08CPU s，均2/2 PASS，包括首次capture成本；整suite可摊薄capture但收益不保证。
N7候选（未批准）：将 target-only task identity 三角色重复dispatch 与 target stale spec/missing task 无Git改动合成一个真实source-authority集成；角色隔离由 selected-role isolation 回归负责，research无manifest由Python source_materials unit负责。不保留每个角色重跑six queries的重复接线，明确减少集成组合覆盖。
N8候选（未批准）：check snapshot case 用stateFixture产生真实execution/finalSnapshot，仅保留native status当前→修改→stale验证；不是mock snapshot/status。Python decoder与invalid lease矩阵的seed dispatch用stateFixture(t,false)，其后实际Python拒绝/无写入保持真实。降低无关setup dispatch成本而不模拟所测CLI。
N9候选（未批准）：child普通source session/header/key隔离用现有mockPython与真实一次envelope捕获，保留managed replacement/symlink/target-runtime/source-drift端到端；需要逐个读完整source handler边界与测试后才给清单。暂不改生产query的重复Git，也不盲目整套memfs。

/tmp/pi-test-b5-qV005p 材料核对后清理；此前 /tmp/pi-test-critical-xMwjgJ 留存并行契约失败诊断，未解决范围外失败、不删所需材料。

## 阶段与提交检查点

1. **S1 调度与 GC 精简**：package test 并发 8、两处 Trellis 内层并发移除；删除三组 GC 用例和专用 driver；更新测试规范过时的 GC 要求。检查三组 editor/owner 和两组 Trellis 测试、静态配置/glob，然后提交。
2. **S2 进程回归合并**：L3/L9/L10/L11；合并 bash-survive、合并输出/错误码 shell、改启动握手/清理超时与临时目录、合并简单状态断言并删除默认字段断言。运行 process waits/spawn/lifecycle 无强制退出，提交。
3. **S3 workflow/runner 减重**：L1/L2/L4–L8/L12；去除重复 worker stop、CLI 用挂起脚本、收窄 clone 接线、参数化 subscription setup、合并 completed shutdown 入口与资源状态、非 worker 通知 fake timer。运行 agent 五个已审文件无强制退出，提交。
4. **S4 最终整合**：既有 SDK/临时 agent-dir 隔离下运行 `pnpm run typecheck`、`npm test`；记录墙钟、CPU 累计/采样和退出码。检查配置、全量发现、git diff 与证据；必要整合修复单独提交。第一批完成后任务保持 in_progress，不归档。

## 验证与性能方案

- 所有原始日志/临时采样脚本放在本会话 `mktemp -d` 的仓库外目录。
- 只使用既有 node_modules 和 SDK；`PI_SDK_DIR` 从既有 SDK link realpath 推导，每次检查创建临时 `PI_CODING_AGENT_DIR`。
- Focused：`node --test --test-concurrency=8 <阶段文件>`，不强制退出；阶段依序执行，不同时跑测试套件。
- 最终：`pnpm run typecheck` 与 `npm test`，串行执行。不存在独立 lint 脚本，不伪造 lint PASS。
- 不重跑旧配置全量满载基线；以只读记录（10 核、旧外层 9、内层 10）及减少的 worker/进程/GC 调用作为结构对照。最终采样记录实际负载，不声称因果改善百分比。后续如需严格 A/B 基线另行规划，避免本轮额外满载运行。
- 命令失败保留事实，定位并重跑；记录未运行和自然退出限制。

## 进度与证据

- 开始时相关产品文件已干净；其他会话已提交原有相关修改，仍需每阶段复核 Git。
- [x] S1：`f7e395b`。并发 8、内层串行、三组 GC 删除及当前规范/Beautify 验证说明更新。focused 117/117 PASS，exit 0，自然退出约 55.07 s。
- [x] S2：`18daf87`。删除重复 bash-survive 文件；输出两流/exit 合并，启动握手、清除 race timer、临时目录 cleanup；status 参数表合并。focused 27/27 PASS，exit 0，自然退出约 0.78 s。日志有既有 fake UI cleanup 的已隔离错误输出，未导致测试失败。
- [x] S3：`3c16f63`。busy 用例删除、CLI 改挂起、worker stop 合并、clone 接线收窄、new/resume subscription 参数化、hook 状态替代真实空 timer、两组无 worker 通知 fake timer。五个审查文件 121/121 PASS、exit 0、约 19.58 s；最终移除 factory 空 interval 后重跑两个变更文件 87/87 PASS、exit 0、约 19.15 s。未全面替换其余通知等待；running/throwing sibling 路径保留各自断言，completed 两入口参数化合并。
- [x] S4：`pnpm run typecheck` exit 0；`/usr/bin/time -l npm test` exit 0，1550/1550 PASS、78 suites、0 fail/cancelled/skipped。Node v24.14.1，现有 Pi SDK 1.3.0，临时 `PI_CODING_AGENT_DIR`，未安装依赖。

### 最终资源观察与限制

全量墙钟 102.92 s，user 352.57 s、sys 194.62 s；累计 CPU / 墙钟约 5.32 核，不是 CPU 峰值。time 报告 maximum resident set size 650739712 bytes，不能解释为整个进程树同时 RSS 峰值。未进行定时 CPU 采样、旧配置 A/B 基线、真实终端或 provider 验证，不能宣称满载已解决或改善百分比。

实测 full reporter：dispatch suite 81.07 s，agent context suite 66.00 s，sync 脚本入口 17.70 s；套件并行，时间不能相加。当前发现 139 个入口（删除一个 bash-survive），GC driver 不属于入口。所有 staged stage diff 自审和 `git diff --check` 通过，未混入其他会话改动。任务在 main 上记录 branch，CLI 提示日后 archive 的 branch/base 相同限制；本轮无归档授权，不改 branch、不创建 worktree。

原始输出目前在本会话 owned `/tmp/pi-test-resource-bhpEjA/`；确认结果后按 owned 范围清理，不保留为仓库证据。未发生测试 FAIL；工具精确编辑/参数拒绝在执行前返回，不属于测试失败。

第一批自验收完成。用户已授权完成后只读探索下一批；下一批具体改动仍需确认，任务继续 in_progress。
