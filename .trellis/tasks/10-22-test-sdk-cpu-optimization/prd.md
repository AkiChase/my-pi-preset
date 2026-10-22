# 修复 SDK 更新后的测试兼容并优化测试 CPU 开销

## 目标

修复安装 SDK 更新后出现的测试及类型兼容失败，降低本机执行完整测试时的 CPU 压力和重复初始化成本，同时保留测试发现、隔离、失败诊断和行为覆盖。

## 授权边界

- 用户已同意创建任务并进入规划（“行，开个task吧”），并明确批准按已审阅计划实施（“开始吧”）。
- 批准范围为本任务三个阶段的代码、测试、必要规范修改与验证；按项目规则由主会话逐阶段本地提交。
- 不安装依赖、不修改安装 SDK、不推送、不归档、不清理历史材料或其他会话的临时目录。
- 其他会话正在推进 task-ui / Beautify 工作；实施前重新核对 HEAD、diff 与失败集，不覆盖其改动。

## 背景与已有证据

### B1：SDK reset 测试宿主缺字段

此前使用已安装 SDK 1.4.0 的完整测试记录为 1640 tests、1626 pass、14 fail。14 个失败均在实际 SDK `InteractiveMode.resetExtensionUI()` 访问 `extensionDialogs.length` 时抛出 TypeError。

涉及测试与宿主：

- `extensions/at-path-completion/__tests__/host-reset.test.ts:10`：1 个失败。
- `extensions/beautify/__tests__/harness.mjs:151`：被 editor / phase-status 测试调用，共 11 个失败。
- `extensions/shared/widget-display/__tests__/sdk-footer.test.ts:44`：2 个失败。

SDK 实现新增对话框清理分支，需要检查最小宿主状态和方法是否完整；不能用替换真实 reset 实现或跳过断言掩盖失败。

### B2：renderer 类型兼容诊断

此前 `pnpm run typecheck` exit 2，报告 `extensions/task-ui/detail-tool-card.ts:19-20` 的 4 个 TS2322：具体 edit/write renderer 参数与 SDK `ToolRenderers` 擦除后的 unknown 参数不兼容。该文件属于并行任务，诊断不是当前 HEAD 的验收结果；先重跑，若已由其他任务解决，不重复修改。

### B3：CPU 与重复 fixture 成本

历史测量（macOS、Node 24.14.1、SDK 1.4.0）：

| 运行方式 | real 秒 | user 秒 | sys 秒 | 平均 CPU 核数（user+sys）/real |
| --- | ---: | ---: | ---: | ---: |
| 完整套件，8 workers | 62.97 | 228.58 | 101.09 | 5.24 |
| 完整套件，4 workers | 86.24 | 198.27 | 76.58 | 3.19 |
| 单文件逐个运行汇总 | 291.0 | 181.5 | 58.4 | 不适用 |

两轮期间代码发生变化，测试数从 1640 变为 1652；这些数字只支持调查方向，不能当作严格同版本 A/B 性能结论。最大 RSS 为单进程观测值，不代表完整进程树总内存。

单文件汇总中 Trellis 30 个文件贡献约 92.7 user 秒 / 41.0 sys 秒。热点包括 diagnostic-runtime、runtime-contracts、agent-context-integration、dispatch。`diagnostic-runtime.test.mjs:16` 的本地 fixture 对支持态用例直接调用 `installRuntimeFixture()`；独立探针中完整初始化约 1.06 秒。项目已有 `copyRuntimeFixture()` 模板复制工具，testing spec 已要求复用它。

V8 profile 显示同步子进程等待、文件系统访问、哈希及初始化记录处理等热点；采样时间不是纯 CPU 时间。此前 spawn 计数探针未证明覆盖所有 ESM 调用边界，不能把“72 次 Python”当作全套精确总数；此前 inclusive profile 计算错误地跳过重复 sample，不能将其百分比作为验收证据。

`agent-tasks/__tests__/tool-waits.test.ts` 与 path completion 部分测试主要是等待型，不能将墙钟慢等同于 CPU 忙。

原始诊断输出位于 `/tmp/pi-testrun/`，只供本轮核查；任务长期结论以此文和后续 implement.md 的自包含记录为准，不复制完整日志到仓库。

## 需求

- R1：恢复 SDK 1.4.0 下 reset 生命周期测试，保留真实 SDK reset、编辑器状态、第三方接管与清理语义。
- R2：重新核实类型失败；只修复当前仍存在且未由并行任务负责解决的 SDK renderer 兼容问题，不使用 blanket any / ts-ignore。
- R3：在独立项目副本与真实运行时校验不变的前提下，减少 Trellis 支持态测试的重复完整初始化；真正验证初始化流程的用例保留真实初始化。
- R4：保留默认 8 workers（用户已明确选择），增加显式 4 worker 低负载入口；保留完整发现 globs 和失败退出码。
- R5：同一固定代码快照、同一 SDK、隔离 agent 配置下重建基线并复测，区分纯并发变化与 fixture 工作量变化。
- R6：受影响测试使用不带 `--test-force-exit` 的自然退出检查；完整 forced-exit 套件成功不视为资源无泄漏证据。

## 验收标准

- [ ] AC1（R1、R2）：隔离配置下 `pnpm typecheck` 与完整套件通过；明确记录仍由其他任务负责的阻塞，不宣称未验证的 PASS。
- [ ] AC2（R1）：reset-before-shutdown、第三方接管、两种生命周期注册顺序、编辑器焦点及状态回归保留。
- [ ] AC3（R3）：每个测试拥有独立根目录；复制后的 operation record 指向正确根；修改一个副本不影响模板或其他副本；恶意/不支持态用例仍因预期原因失败。
- [ ] AC4（R4）：默认与快速模式发现同一测试集合，保留错误退出码；并发策略及可见取舍与获批决定一致。
- [ ] AC5（R5）：固定快照对比记录命令、SDK/Node、环境、至少多次结果、wall/user/sys、失败集及限制；报告 CPU 峰值代理指标与总工作量，不以单次历史数据承诺百分比。
- [ ] AC6（R6）：受影响 focused suites 自然退出，拥有的进程、worker、timer、目录可核查清理；诊断未解决时保留材料并报告位置。

## 排除范围

- 修改 SDK、降低安全校验、用假 hash 伪造受支持运行时、共享可变 fixture 根。
- 变更 Trellis 产品初始化/权限逻辑来迎合测试性能。
- 为缩短时长直接删等待、跳过测试、关闭断言或减少发现范围。
- 全面 clock/fake-timer 重构：先作为后续候选，不混入当前 CPU 主线。
- 无关 UI、参数阅读器或其他会话任务的产品行为修改。

## 已定决策与规划状态

用户选择保留默认 8 workers，另提供显式 4 worker 低负载模式。fixture 优化用于降低默认运行的实际工作量，不以牺牲默认速度为主要手段。

不存在剩余用户需求决策。design.md 和 implement.md 的三个阶段已由用户明确批准实施。
