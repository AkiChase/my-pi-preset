# 适配 Pi SDK 1.5.1 并恢复完整检查

## 目标与价值

使仓库在当前已安装 Pi SDK 1.5.1 下通过真实类型检查及测试，不依赖外部兼容 shim，同时保持扩展已有功能、编辑器/会话/执行所有权和用户交互契约。修复 SDK API 使用与过时测试夹具，而不是借 SDK 升级重构 UI。

## 授权

用户已批准建任务与规划，并在最终四阶段方案审阅后回复「行」，批准本 PRD/design/implement 的实施、验证及 scoped 阶段提交。材料保存不改变已获批方案；不授权安装依赖、SDK 修改、个人 reload/sync、push 或范围外重构。

## 已复现基线

Node `v24.14.1`，SDK `1.5.1`，离线既有依赖。隔离 `PI_CODING_AGENT_DIR`，无 shim：

- `pnpm check` exit 2，25 条 TypeScript 诊断。
- `pnpm test` exit 1，1338 tests / 1242 pass / 96 fail。
- 本任务新跑结果与前一任务日志的 25 条诊断、96 个失败名称完全一致。
- 96 是失败记录而非独立缺陷数，其中 51 是整个 test-file 加载失败。导入问题修复后将执行更多原本无法加载的测试，后续若出现新失败必须重新定位。
- 研究归类：63 条与 `pi-ai.Type` 缺失及导入级联有关；25 条属于编辑器/补全安装夹具级联；5 条 reset registry；1 条 overlay registry；Memory 和 Recap 预期各 1 条。归类不是声称六个已验证产品缺陷。

## 修复要求与证据

### R1 公开 Schema 与类型契约

- SDK `docs/extensions.md:166–171` 明确 published `pi-ai` 不再导出 TypeBox `Type/Static/TSchema`，应从 `typebox` 导入。Pi extension loader 保留旧别名，所以 Node 测试加载失败不等于用户运行中的 Pi 扩展必然无法加载。仓库已声明 typebox，不需新依赖。
- 6 个 Type 导入诊断：`agent-tasks/src/invocation-config.ts:2`、`process-tasks/tools/bash-params.ts:2`、`process-tasks/tools/monitor.ts:8`、`runtime-tasks/tools.ts:6`、`agent-tasks/__tests__/detail-timing-sdk.test.ts:6`、`runtime-tasks/__tests__/reminder-sdk.test.ts:6`。只移动 Type，StringEnum/AI helper 保留原来源，不改变 schema。
- 5 个 ExecResult 诊断：`agent-tasks/__tests__/tool-waits.test.ts:591–605` 与 `worktree-lifecycle.test.ts:23,73,90,115`。SDK `dist/core/exec.d.ts:26–35` 要求 `truncated:boolean`；模拟结果应明确 `false`，不能与 killed 混为一谈。
- 14 个 renderer 诊断：Beautify registered-agent/registered-monitor/retrieval/secondary-parameters/title-tones/tools 的 context fixtures，Process notification-renderer fixtures，以及 `process-tasks/index.ts:77–78` helper 丢失完整 MessageRenderOptions 类型。SDK `extensions/types.d.ts:73–77,367,1175` 要求注入 keyText/keyHint。修复类型和夹具，不新增 UI 提示行或改键绑定。

### R2 SDK 实际方法的完整隔离夹具

- `at-path-completion/__tests__/harness.ts:36–49`、`task-ui/__tests__/editor.test.ts:43–52` 缺少 extensionDialogs。SDK `interactive-mode.js:2326–2334` 安装编辑器读取其 length；已有 owner 正确 fail-closed，导致后续大量补全/焦点断言级联失败。
- `beautify/__tests__/harness.mjs`、`at-path-completion/__tests__/host-reset.test.ts:8`、`shared/widget-display/__tests__/sdk-footer.test.ts:18–25`、`shared/interaction/__tests__/sdk-overlay.test.ts:12–23` 缺 extensionOverlays。SDK `interactive-mode.js:2025,2438–2445,2480` 的 reset/open/done 使用真实 registry。补夹具字段，继续调用实际 SDK 方法，不重写假的 reset 算法。
- `task-ui/__tests__/sdk-runtime.test.ts:106` 的服务夹具仅强转 cwd/agentDir。SDK `agent-session-runtime.js:301–309` 卸载后等待 modelRuntime.settleCredentialWrites。补最小 typed service 并断言调用顺序/等待，不创建真实凭据服务。
- 安装夹具恢复后再判断是否存在真正的产品行为缺口；保留编辑器 identity/history/paste、Down、❯、目录续查取消、Footer takeover、动画与资源清理契约。

### R3 持久化与参数转换预期

- `session-assist/recap/__tests__/sdk-runtime.test.ts:284–305` 对 EISDIR 仍期望产生两个 recap。SDK `session-manager.js:816–832` 失败时回滚 fileEntries/byId/leafId，应验证仍只有先前已确认状态、leaf 与磁盘不变，恢复夹具路径后验证可恢复及后续刷新。保留产品 `recap/index.ts:223–236` 的 conservative unconfirmed 处理及非原子旧 host fake coverage。
- `memory/__tests__/list-arguments.test.ts:44–49` 将 required query/offset 的 undefined 误当作空串/零。SDK pi-schema 在无 default 时拒绝 missing；更新实际 host 标量预期，保留 required/closed schema 与 direct-call 严格拒绝，不能放宽工具参数。
- 阶段 1 导入修复后解锁同类过期 fixture：`process-tasks/__tests__/bash-schema.test.ts:135` 将 required description:undefined 当空串，`monitor-schema.test.ts:246` 将 required timeout_ms:undefined 当 null。与上述 missing-required 根因相同，归入已批准 R3，不放宽产品字段。

### R4 验证与边界保留

- 分阶段验证与独立审查，主会话提交各阶段检查点；最终 `pnpm check` 无 shim 通过。
- 受影响生命周期 suites 自然退出，不借 full-suite force-exit 证明 cleanup。
- 保持已提交 `618353a` 的最近请求 ↑/↓、Last req、Usage Σ 回归和父子累计归属。
- 所有实际失败、fixture 修复及重跑结果保留，不能用测试预期放宽掩盖真实行为缺口。

## 范围与排除项

范围限上述公开 API/类型、实际 SDK fixtures、Memory/Recap 过期预期、相关规范与已有文档修正，以及修复后解锁的同类 SDK 回归。若发现需要改变用户交互、扩展公开契约或重构所有者，停止并重新确认范围。

不修改 SDK、升级依赖、下载安装工具，不改个人配置、sync/reload/push/history。不做新 UI 功能或老版本多矩阵工程；保留已存在旧 host 安全处理，不删除其有效覆盖。真实终端/IME、第三方 input-history、在线 provider 不属于当前授权，未跑明确 NOT_RUN。

必须保留六个既有并行 Trellis 文件：`.pi/agents/trellis-research.md`、`.pi/skills/trellis-brainstorm/SKILL.md`、`.trellis/.pi-trellis.json`、`.trellis/scripts/pi_trellis_worktree/{manager,materials}.py`、`.trellis/workflow.md`。

## 验收

- [ ] A1：当前 SDK 1.5.1 下 `pnpm check` 无 shim exit 0。（R1–R4）
- [ ] A2：受影响 Agent/Process/Runtime/Task UI、补全/Beautify、shared overlay/Footer、Memory/Recap focused suites 自然退出通过。（R2–R4）
- [ ] A3：工具/schema/render 行为、编辑器 identity/focus/history/paste、执行取消和资源 cleanup 无退化。（R1、R2）
- [ ] A4：Recap 失败后已确认状态/磁盘保护、Memory missing/标量/direct-call admission 回归正确。（R3）
- [ ] A5：最近请求与累计用量现有回归通过，无关改动保持原样，所有失败/重跑/NOT_RUN 如实记录。（R4）

## 材料

本任务原始验证材料 `/tmp/pi-sdk-compat.ZDRQNy/`；旧任务材料 `/tmp/pi-tokens-row.EaBi0M/` 只读引用，不迁移/清理。长期记录在本任务 implement.md；研究角色返回直接证据，未写 source research/ 或产品文件。
