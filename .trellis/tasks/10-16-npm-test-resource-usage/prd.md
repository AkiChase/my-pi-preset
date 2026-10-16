# 优化全量 npm test 的资源占用

## 目标

改善全量 `npm test` 的资源调度和重复测试成本，保留单一全量入口。分批推进：本轮执行第一批，任务不归档；下一批先审查、再确认实施。

## 授权与执行约束

用户已批准第一批清单及并发/GC 调整的实施。主会话直接实施和自审，不启动子 agent；范围内验证及本地阶段提交获授权，不包含 push、安装依赖、归档或下一批实施。保留其他会话修改，不修改生产生命周期或 SDK。

## 背景与证据

- `package.json:19` 未设置文件级并发，使用 `--test-force-exit` 和全量发现 glob。
- 只读分析环境 Node `v24.14.1`，可用 CPU 并行度 10；已核对 Node 源码默认文件并发 9，发现 140 个入口文件，不是实际通过数量。
- `extensions/trellis/__tests__/agent-context-integration.test.mjs:301` 与 `dispatch.test.mjs:382` 有 `concurrency:10`；`runtime-fixture.mjs:39–41` 复制验证项目、`worktree-fixture.mjs:22–24` 调用真实 Python CLI，内层并发叠加负载。
- `.trellis/spec/testing/index.md` 要求资源变更验证自然退出；全量强制退出不能证明自然关闭。本轮保留这项要求。
- 第一轮完整审查 9 个 lifecycle/workflow 文件约 3111 行；具体文件、L1–L12 建议及原始行号见 `design.md`。不覆盖全部测试，不等同于 CPU 实测。

## 第一批需求

- R1：全量入口显式使用文件并发 8。
- R2：删除两处 Trellis 文件内并发配置，保留独立夹具和用例。
- R3：保留单一全量入口、原发现 glob，不新增分层脚本。
- R4：删除 Task UI `editor.test.ts:341–346`/`editor-retention.mjs`、Beautify `editor.test.ts:161–166`/`editor-retention.mjs`、路径补全 `owner.test.ts:119–122`/`retention.mjs` 三组 GC 用例及专用 driver，不新增替代 GC/模拟保留测试。失去真实 GC 回收专项证据，不删除正常功能性关闭/委托回归。
- R5：按 `design.md` L1–L12 精简：删除未握手忙循环测试、CLI 用挂起脚本、合并重复 worker stop 与 bash survive、参数化订阅失败、降低 hook/通知等待成本、合并 shell 输出退出码和低价值断言。合并须保留列明的业务断言，允许丢弃已批准 GC/忙循环专项覆盖。
- R6：进行受控验证与资源观察，不同时跑多套全量测试。不额外跑旧配置满载全量基线，结构对照与最终资源采样分开记录，不承诺峰值/耗时改善百分比。验证方案与阶段检查点见 `implement.md`。

## 验收标准

- [x] AC1 / R1–R3：实际全量链路包含 `--test-concurrency=8`，两处内层并发移除，保留入口与 glob。
- [x] AC2 / R4：三组 GC 及专用 driver 移除，无替代 GC 测试，规范不再要求它们。
- [x] AC3 / R5：L1–L12 按阶段落实，合并前后覆盖映射可核对；范围外业务断言未削弱。
- [x] AC4 / R6：focused 自然退出、最终 typecheck/full suite 结果及资源观察自包含记录命令、环境、退出码、失败/重跑和未运行限制。
- [x] AC5：每个独立阶段检查后提交；第一批结束保留任务 in_progress，下一批需确认。

## 范围外与风险

- 不重写生产生命周期/包装函数、不删除所有 SDK 测试、不整文件删除 runner/backend/auxiliary 生命周期回归。
- 不审查全部 monitor/TUI/宿主测试，不清理历史材料或其他会话输出。
- 文件并发 8 仍可能高负载；减少等待可能提高平均 CPU。只有实际采样能说明本轮最终观察，不能把测试删减当作因果性能证明。
