# 实施计划与验证记录

## 当前状态

- 已获任务创建/规划授权；用户选择默认保留 8 workers。
- 用户已通过“开始吧”批准 unchanged 三阶段计划；准备完成后 start。
- 实施主会话直接完成；涉及 fixture 隔离与 SDK 跨模块兼容，安排独立 trellis-check 审查。check.jsonl 已准备真实规范引用；implement.jsonl 有意为空，启动使用 --allow-empty-context，不宣称 task validate 全通过。
- 允许实施后按项目规则逐阶段本地提交；不推送、不安装、不归档。

## 实施前门禁

- [ ] 获得最终计划实施批准，读 trellis-before-dev、完整当前相关源/测试/SDK 公开文档与声明。
- [ ] 核对 current task、HEAD、完整 git status/diff，协调并行 task-ui 文件范围。
- [ ] 创建本任务独占系统临时目录，不复用先前 /tmp/pi-testrun 作为新执行目录。
- [ ] 在临时 agent 配置与现有 PI_SDK_DIR 下重跑 pnpm typecheck / pnpm test，记录当前真实失败集。
- [ ] 固定基线代码输入，启动任务；不用状态替代批准。

## Stage 1：SDK 兼容恢复

- [ ] 修复当前仍存在的 reset seam 契约；保留真实 reset 与 lifecycle 断言。
- [ ] 重核 renderer 类型失败，若仍存在且不冲突则用窄公开类型边界修复。
- [ ] focused 自然退出验证：
  - `node --test extensions/at-path-completion/__tests__/host-reset.test.ts extensions/beautify/__tests__/editor.test.ts extensions/beautify/__tests__/phase-status.test.ts extensions/shared/widget-display/__tests__/sdk-footer.test.ts`
  - `node --test extensions/task-ui/__tests__/detail-tool-card.test.ts`（若当前文件仍存在且涉及 renderer 适配）
  - `pnpm typecheck`
- [ ] 独立审查实际 diff 与 SDK 语义，相关 broader suites；通过后独立提交兼容阶段。

## Stage 2：重复 fixture 工作量优化

- [ ] 完整读取 runtime-fixture 与四个热点文件，按 case 区分初始化验证 / 支持态准备 / 恶意状态。
- [ ] 迁移适用支持态 fixture，保持隔离与 operation root 校验，补副本不互相影响的回归。
- [ ] 先后运行自然退出 focused 与 broader：
  - `node --test extensions/trellis/__tests__/diagnostic-runtime.test.mjs extensions/trellis/__tests__/runtime-contracts.test.mjs extensions/trellis/__tests__/agent-context-integration.test.mjs extensions/trellis/__tests__/dispatch.test.mjs`
  - `node --test extensions/trellis/__tests__/*.test.mjs`
  - `python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'`
- [ ] 固定同一配置与快照，3 次热点 before/after 配对，记录 wall/user/sys 中位数与范围、case 发现一致性。
- [ ] 独立审查隔离、安全/恶意用例覆盖和实际性能收益；通过后独立提交 fixture 阶段。

## Stage 3：低负载入口与集成

- [ ] 默认保持 8 workers，新增 `pnpm test:low-cpu`（4 workers），相同 SDK/发现 globs/失败退出码。
- [ ] 仅更新必要测试规范的命令表，规范英文；不将内部测试教程写入用户 docs。
- [ ] 如新增 runner，测试参数、发现和错误退出码；否则检查脚本一致性。
- [ ] 临时 agent 配置下运行 `pnpm check` / `pnpm test:low-cpu`，固定快照并对比发现集。
- [ ] 多次完整默认/低负载测量，记录区别，不将旧的变化代码测量当 A/B。
- [ ] affected suites 自然退出复核、`git diff --check`、实际 staged/unstaged/untracked 最终审查。
- [ ] 独立审查通过后提交入口与必要规范更新阶段。

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

## 最终记录要求

逐条记录命令、环境/Node/SDK、代码快照、退出码、PASS/FAIL/NOT_RUN、失败原因与后续 rerun 关系。保留第一次失败事实。性能没有稳定收益时明确报告并调整 fixture 方案，不以减少覆盖换取通过。

未解决诊断保留 owned 临时材料并说明路径；全部验证完成且无活跃使用者时，仅清理本任务新创建的 owned run 目录。不清理先前或其他会话的临时目录。归档/journal 属于后续单独授权边界。

## Stage 1 执行证据（2026-10-22）

用户“开始吧”批准 unchanged 计划后已 start，CLI main/base_branch 警告仅影响将来 PR/archive，本轮不归档。

- 当前 baseline：Node 24.14.1 / SDK 1.4.0，临时 agent dir + 显式已有 PI_SDK_DIR。`pnpm typecheck` exit 0：旧 renderer 类型问题已被其他任务修复，本任务未改产品 renderer。
- `/usr/bin/time -l pnpm test` exit 1：1656 tests / 1642 pass / 14 fail，仍全部为三个宿主缺 extensionDialogs。72.29 real / 247.77 user / 108.88 sys。运行期间 HEAD 从 70078ca 变化至其他会话提交，因此仅用于失败诊断，不作为固定快照性能验收。
- 三个 test seams 补齐 dialog stack；Beautify 使用实际 SDK showTopExtensionDialog + 最小 programStatus seam。新增真实 mounted dialog 的 focus/container/blocked、optional disposal、顺序、文本保留与重复 reset 回归。
- 主会话自然退出 broad：`node --test extensions/at-path-completion/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts extensions/shared/widget-display/__tests__/*.test.ts` exit 0，191/191 PASS。
- agent_trellis_check_0_6a40a6ff 独立首审无 blocker，指出最初新测试未实际挂载焦点；采纳并固化实际挂载后复审同一 broad command exit 0，191/191 PASS，自然退出；主核查其 natural.log 计数。
- 新 programStatus seam 原零参数推断导致最终 typecheck exit 2（editor.test.ts:17 TS2322），已在 harness 保留双参数签名；`pnpm typecheck` rerun exit 0，`git diff --check` exit 0。签名修改无运行行为变更。
- 日志位于 owned `/tmp/pi-test-sdk-cpu-zJjatf/`；独立 reviewer 保留 `/tmp/pi-sdk-stage1-check-MedEYU/` 和 `/tmp/pi-sdk-stage1-recheck-xgGO4x/`，本会话不自动清理子 agent 目录。

Stage 2 先前 3 次热点测量 74/74 自然退出 PASS：real 86.58/82.56/146.48，user 50.85/49.30/68.34，sys 22.29/21.30/33.30。负载波动明显、HEAD 期间变化；这些只是调查样本。迁移前后对比将核实有关代码 blob 不变并报告噪声，必要时使用同基准隔离快照重采样，不能直接承诺历史降幅。
