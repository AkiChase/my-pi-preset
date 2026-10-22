# 实施计划与验证记录

## 当前状态

- 已获任务创建/规划授权；用户选择默认保留 8 workers。
- 用户已通过“开始吧”批准三阶段计划，实施、验证和分阶段提交已完成。
- 主会话实施，三个阶段分别由 trellis-check 独立审查；check.jsonl 保留真实规范引用，implement.jsonl 有意为空。
- 实施提交：665c415、328e236、8068f9a。
- 用户通过“收尾吧”批准归档、清除绑定与日志记录；不推送、不安装、不重写历史。

计划清单已完成；条件项按实际范围执行（renderer 已由并行任务修复，未单独修改；focused 检查使用覆盖范围更广的自然退出 suites）。准确命令与限制见下方各阶段证据。

## 实施前门禁

- [x] 获得最终计划实施批准，读 trellis-before-dev、完整当前相关源/测试/SDK 公开文档与声明。
- [x] 核对 current task、HEAD、完整 git status/diff，协调并行 task-ui 文件范围。
- [x] 创建本任务独占系统临时目录，不复用先前 /tmp/pi-testrun 作为新执行目录。
- [x] 在临时 agent 配置与现有 PI_SDK_DIR 下重跑 pnpm typecheck / pnpm test，记录当前真实失败集。
- [x] 固定基线代码输入，启动任务；不用状态替代批准。

## Stage 1：SDK 兼容恢复

- [x] 修复当前仍存在的 reset seam 契约；保留真实 reset 与 lifecycle 断言。
- [x] 重核 renderer 类型失败，若仍存在且不冲突则用窄公开类型边界修复。
- [x] focused 自然退出验证：
  - `node --test extensions/at-path-completion/__tests__/host-reset.test.ts extensions/beautify/__tests__/editor.test.ts extensions/beautify/__tests__/phase-status.test.ts extensions/shared/widget-display/__tests__/sdk-footer.test.ts`
  - `node --test extensions/task-ui/__tests__/detail-tool-card.test.ts`（若当前文件仍存在且涉及 renderer 适配）
  - `pnpm typecheck`
- [x] 独立审查实际 diff 与 SDK 语义，相关 broader suites；通过后独立提交兼容阶段。

## Stage 2：重复 fixture 工作量优化

- [x] 完整读取 runtime-fixture 与四个热点文件，按 case 区分初始化验证 / 支持态准备 / 恶意状态。
- [x] 迁移适用支持态 fixture，保持隔离与 operation root 校验，补副本不互相影响的回归。
- [x] 先后运行自然退出 focused 与 broader：
  - `node --test extensions/trellis/__tests__/diagnostic-runtime.test.mjs extensions/trellis/__tests__/runtime-contracts.test.mjs extensions/trellis/__tests__/agent-context-integration.test.mjs extensions/trellis/__tests__/dispatch.test.mjs`
  - `node --test extensions/trellis/__tests__/*.test.mjs`
  - `python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'`
- [x] 固定同一配置与快照，3 次热点 before/after 配对，记录 wall/user/sys 中位数与范围、case 发现一致性。
- [x] 独立审查隔离、安全/恶意用例覆盖和实际性能收益；通过后独立提交 fixture 阶段。

## Stage 3：低负载入口与集成

- [x] 默认保持 8 workers，新增 `pnpm test:low-cpu`（4 workers），相同 SDK/发现 globs/失败退出码。
- [x] 仅更新必要测试规范的命令表，规范英文；不将内部测试教程写入用户 docs。
- [x] 如新增 runner，测试参数、发现和错误退出码；否则检查脚本一致性。
- [x] 临时 agent 配置下运行 `pnpm check` / `pnpm test:low-cpu`，固定快照并对比发现集。
- [x] 多次完整默认/低负载测量，记录区别，不将旧的变化代码测量当 A/B。
- [x] affected suites 自然退出复核、`git diff --check`、实际 staged/unstaged/untracked 最终审查。
- [x] 独立审查通过后提交入口与必要规范更新阶段。

## Stage 2 验证结果

- 实际改动仅 diagnostic-runtime 支持态 fixture 与 runtime-contracts 一个 supported child-binding case；其余 script-only/fresh/恶意状态保留。agent-context-integration 与 dispatch 已有模板缓存，未重复重构。
- 新 runtime-fixture.test.mjs 验证独立根、operation plan.root、真实 inspect ready、tamper 拒绝、模板及后续副本不污染、shape/user 区分。
- focused `node --test --test-concurrency=1 runtime-fixture.test.mjs diagnostic-runtime.test.mjs runtime-contracts.test.mjs`（完整路径为 extensions/trellis/__tests__/）exit 0，55/55 PASS，自然退出。
- broader `node --test extensions/trellis/__tests__/*.test.mjs` exit 0，359/359 PASS，自然退出。
- `python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'` exit 0，38 tests OK。输出的 argparse invalid-choice 是拒绝 removed action 的预期断言，非检查失败。
- 独立 agent_trellis_check_1_8407a2f0 完整代码审查无 blocker；node --check / diff --check exit 0，核查 focused 55/55；按主要求未并发执行 CPU-heavy tests，避免干扰测量。
- 固定源码快照：`git archive 665c415` 在 owned temp before/after 目录展开（非 Git worktree、非托管执行/派发），同一外链已有 node_modules、Node 24.14.1 / SDK 1.4.0；after 只替换两处 fixture test 文件，原 74 个热点测试发现一致。使用 `/usr/bin/time -l node --test --test-concurrency=1` + 四个热点路径，before/after 交替 3 对，全部 exit 0、74/74 PASS。

| variant | real 秒（3 次） | user 秒（3 次） | sys 秒（3 次） |
| --- | --- | --- | --- |
| before | 80.87 / 77.62 / 77.10 | 47.74 / 46.82 / 46.63 | 20.32 / 19.08 / 19.21 |
| after | 57.94 / 57.32 / 59.47 | 32.97 / 32.88 / 33.74 | 14.57 / 14.42 / 15.19 |

中位数 real 77.62 → 57.94（-25.4%）；user+sys 中位数组合 66.03 → 47.54（-28.0%）。这是热点固定输入结果，不推断整个套件同等降幅；测试路径不同目录但相同源码与依赖，系统外部负载仍是噪声因素。新增 isolation regression 未加入配对集合，避免改变测试数。

- 未解决 blocker：无。非阻塞限制：新 shape case 同时改变 user/key，未逐维覆盖 user-only/key-only/git-only；strict gate 原本同时篡改 diagnostics.py，不独立证明每个 gate 原因，未削弱现有断言。
- 原始日志和快照在 `/tmp/pi-test-sdk-cpu-zJjatf/paired-*`、stage2-*；自包含结果如上。独立 reviewer 空临时目录由其保留，不自动清理。

## Stage 3 验证结果与最终验收

- 默认 test 8 workers unchanged；新增 `pnpm test:low-cpu` 4 workers，发现 globs / SDK 前置步骤 / forced-exit / 失败退出码与默认完全相同。只更新 testing spec 英文命令表，不新增用户测试教程。
- `node --test scripts/test-modes.test.mjs` 初次 exit 1：子进程继承 NODE_TEST_CONTEXT，Node 拒绝 recursive runner 导致失败 fixture 返回 0。已删除该子环境变量，让子 runner 拥有独立上下文；rerun exit 0，1/1 PASS，实际验证两个模式各自的成功 0 / 失败 1。
- 独立 agent_trellis_check_2_9a8e722a 只读审查无 blocker，node --check / diff --check exit 0；按主要求不并发全套测量。主会话执行结果如下面表格。
- 固定 HEAD 328e236；六轮开始/结束 HEAD 一致，tracked binary diff cmp exit 0，新增 test-modes 文件期间未变化。每轮显式临时 agent + 现有 PI_SDK_DIR，Node 24.14.1 / SDK 1.4.0。首次默认 command 为 `/usr/bin/time -l pnpm check`（包括 typecheck 成本），后两次默认 `/usr/bin/time -l pnpm test`；low 三次 `/usr/bin/time -l pnpm test:low-cpu`，default/low 交替。每轮 exit 0，1659 tests / 1659 pass / 0 fail；第二对 named records 1735/1735 完全一致，命令 parity regression 锁定所有 glob。

| mode | real 秒 | user 秒 | sys 秒 |
| --- | --- | --- | --- |
| default 1（含 typecheck） | 63.83 | 225.43 | 97.22 |
| low 1 | 76.55 | 181.23 | 67.76 |
| default 2 | 72.94 | 232.00 | 102.44 |
| low 2 | 120.82 | 222.48 | 90.78 |
| default 3 | 56.30 | 214.63 | 93.49 |
| low 3 | 74.47 | 176.52 | 65.41 |

real 中位数 default 63.83 / low 76.55；每轮 user+sys 的中位数 default 322.65 / low 248.99（约 -22.8%）。平均 CPU 核数代理 (user+sys)/real 的中位数 default 5.05 / low 3.25。系统负载存在明显噪声（low2 120.82 秒）；第一默认含 typecheck，非严格纯套件耗时对照，不承诺稳定百分比或将平均值称为峰值。默认仍速度优先，低负载由用户显式选择。

- 全套 forced-exit 不证明 cleanup：Stage 1 191 个相关测试、Stage 2 focused 55 / broader 359 / Python38 均另有自然退出证据。
- 三个阶段独立审查无未解决 blocker。无 SDK/依赖安装、产品初始化逻辑改动、跳过测试或削弱校验。无独立 lint script，未运行真实终端/provider（非本任务验收）。
- 最终 `git diff --check` exit 0；只提交本任务 package/script/spec/materials，不纳入另一个 Beautify task。
- 原始输出曾位于 owned `/tmp/pi-test-sdk-cpu-zJjatf/`；主会话已核查结果、确认本轮命令结束后删除该目录并验证不存在。自包含记录如上；旧 `/tmp/pi-testrun` 和 reviewer 目录未清理。

## 最终记录要求

逐条记录命令、环境/Node/SDK、代码快照、退出码、PASS/FAIL/NOT_RUN、失败原因与后续 rerun 关系。保留第一次失败事实。性能没有稳定收益时明确报告并调整 fixture 方案，不以减少覆盖换取通过。

未解决诊断保留 owned 临时材料并说明路径；全部验证完成且无活跃使用者时，仅清理本任务新创建的 owned run 目录。不清理先前或其他会话的临时目录。归档/journal 属于后续单独授权边界。

## Stage 1 执行证据（2026-10-22）

用户“开始吧”批准原计划后已 start。任务直接在 main 实施、无 PR 分支；收尾归档使用 CLI 的非 PR 任务 --skip-branch-validation，不虚构分支或 PR。

- 当前 baseline：Node 24.14.1 / SDK 1.4.0，临时 agent dir + 显式已有 PI_SDK_DIR。`pnpm typecheck` exit 0：旧 renderer 类型问题已被其他任务修复，本任务未改产品 renderer。
- `/usr/bin/time -l pnpm test` exit 1：1656 tests / 1642 pass / 14 fail，仍全部为三个宿主缺 extensionDialogs。72.29 real / 247.77 user / 108.88 sys。运行期间 HEAD 从 70078ca 变化至其他会话提交，因此仅用于失败诊断，不作为固定快照性能验收。
- 三个 test seams 补齐 dialog stack；Beautify 使用实际 SDK showTopExtensionDialog + 最小 programStatus seam。新增真实 mounted dialog 的 focus/container/blocked、optional disposal、顺序、文本保留与重复 reset 回归。
- 主会话自然退出 broad：`node --test extensions/at-path-completion/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts extensions/shared/widget-display/__tests__/*.test.ts` exit 0，191/191 PASS。
- agent_trellis_check_0_6a40a6ff 独立首审无 blocker，指出最初新测试未实际挂载焦点；采纳并固化实际挂载后复审同一 broad command exit 0，191/191 PASS，自然退出；主核查其 natural.log 计数。
- 新 programStatus seam 原零参数推断导致最终 typecheck exit 2（editor.test.ts:17 TS2322），已在 harness 保留双参数签名；`pnpm typecheck` rerun exit 0，`git diff --check` exit 0。签名修改无运行行为变更。
- 日志位于 owned `/tmp/pi-test-sdk-cpu-zJjatf/`；独立 reviewer 保留 `/tmp/pi-sdk-stage1-check-MedEYU/` 和 `/tmp/pi-sdk-stage1-recheck-xgGO4x/`，本会话不自动清理子 agent 目录。

Stage 2 先前 3 次热点测量 74/74 自然退出 PASS：real 86.58/82.56/146.48，user 50.85/49.30/68.34，sys 22.29/21.30/33.30。负载波动明显、HEAD 期间变化；这些只是调查样本。迁移前后对比将核实有关代码 blob 不变并报告噪声，必要时使用同基准隔离快照重采样，不能直接承诺历史降幅。
