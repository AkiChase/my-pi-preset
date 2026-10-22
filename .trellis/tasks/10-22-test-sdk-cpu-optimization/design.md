# 技术设计

## 执行边界

任务材料归主会话所有，默认在源目录规划。当前不创建 worktree、不派发实施。实施前完整读取实际源文件与测试；复核并行 task-ui 提交，避免重复修复已经解决的类型问题。

## SDK 兼容

测试 seam 使用真实 SDK 方法，补齐最小必要宿主状态，不复制 reset 算法。检查 extensionDialogs 空列表及真实非空列表的 disposal / showTopExtensionDialog 调用语义；必要时集中测试宿主的共用契约，但不为少数字段创建泛化 mock 框架。

renderer 问题仅在新基线仍失败时修复。优先使用 SDK 公开类型/defineTool 保留具体参数推断与安全擦除边界；不得修改 SDK 或使用 blanket suppression。具体方案在读完当前实现、声明与调用链后确定。

## Fixture 优化

复用现有 runtime-fixture.mjs 的 copyRuntimeFixture：按 Git、用户与 prepare shape 建模板，每个 case 复制独立临时根，重写 operation record，再验证支持态。对完整初始化本身的测试、fresh/unsupported 恶意状态测试保持现有真实性。

先优化 diagnostic-runtime / runtime-contracts；agent-context-integration / dispatch 只迁移仍反复初始化且不测试初始化行为的 fixture，避免无收益重构。不缓存产品 runtimeBaseline/provenance 检查，不降低实际产品的安全边界。

## 测试入口

默认 pnpm test 继续使用 8 workers。增加 test:low-cpu 的 4 worker 模式，复用同一 SDK 链接及发现范围，保持非零失败退出码。若为避免脚本重复需要新增 runner，必须有参数/发现/退出码测试，不能将单一并发选项演变成大型测试框架。

## 性能与隔离

新建本任务独占、仓库外临时 run 目录；解析 time -l 的 real/user/sys，不混淆进程树 CPU 与 V8 wall samples。基线和复测固定 HEAD 与有关 diff，使用同一 Node/SDK 与临时 agent 配置。至少 3 次配对热点测量，并对完整默认/低负载模式测量，记录中位数和范围。快照变化则该组对比作废并重新采样。

保留独立测试数/失败集对照，分别报告 fixture 总工作量与并发压力。maxrss 单进程值不作为进程树总内存。CPU profile 如有必要采用 timeDeltas 加权、不跳过重复样本；探针计数只有校验 ESM boundary 后才可报告精确次数。

## 风险与回退

- 模板副本 operation root 未更新：保留现有 rehomeOperationRecord 并回归根绑定。
- 特定 fixture 含变更或 Git 历史：显式 prepare/key，禁止跨形状误共享。
- 静态类型修复遮蔽 renderer 运行错误：真实 SDK read/write/edit、宽窄/theme、重复更新及结果状态测试。
- natural-exit hang：保留失败日志，查 owned resources，不能追加 force-exit 掩盖。
- 并行提交漂移：重新冻结比较输入；只提交本任务已核验阶段，保留其他改动。

每阶段可独立回退本任务对应提交；不重写已有历史。低负载入口与默认入口都不得减少测试范围。
