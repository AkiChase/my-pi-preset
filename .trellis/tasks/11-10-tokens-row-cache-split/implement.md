# 实施与验证

## 单阶段：请求快照与累计分类显示

用户已批准 PRD 显示方案。实现与测试耦合，独立审查通过后由主会话提交一个阶段检查点。

### 变更边界

行为缺口位于 Agent usage 事件→record→TaskView→外层/详情：当前错误使用累计混合值，缺少最近请求快照。实现方完整阅读相关源码、调用方和测试后，在 `extensions/agent-tasks/src/types.ts`、`agent-manager.ts` 记录最近一次自身 assistant 请求 usage，在 `source.ts` 及 `extensions/task-ui/types.ts` 暴露明确的请求/累计字段，在 `presentation.ts`、`detail-view.ts` 渲染。相关 Agent/UI 测试必须验证多轮、resume、缓存、未知值及尺寸约束。允许按实际所有者需要调整这些目录下的小范围文件，不修改计费累加与模型工具返回契约。

请求快照只来自该 Agent 自身请求，不能被子 Agent 累计上报覆盖；原 lifetime 账本原样保留。没有最近 usage 时显示缺失状态；新请求进行期间不清空旧值。workflow 展示维持原有语义，不强套 Last req。

实施在共享源目录，主会话不同时编辑委派文件；不创建 worktree。实施方与审查方不提交、不安装、不改任务/规范文件。主会话负责材料、集成与提交。

### 验证计划

隔离 PI_CODING_AGENT_DIR，使用已安装 SDK，无下载或个人配置访问；原始输出留在本轮仓库外临时目录。

1. `node --test extensions/task-ui/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts`，自然退出。
2. `pnpm check`，严格类型检查与配置全量套件（全量 test 的 force-exit 不证明自然退出）。
3. 主会话阅读实际 diff；trellis-check 独立审查数据来源、生命周期、未知值、窄宽度及兼容消费者。
4. `git diff --check`、精确文件暂存与检查点提交；保留无关已有改动。

## 执行记录

### 实施与独立审查

- 实施方：`agent_trellis_implement_0_033c56f5`；审查方：`agent_trellis_check_1_7428a56e`。主会话检查了实际变更、事件来源与最终日志。
- `latestRequestUsage` 仅在 fresh/resume 的自身 assistant usage 回调刷新，冻结保存；原 lifetime 账本未改。
- 外层与 `Last req` 共用最近请求格式化；详情新增 `Usage Σ`。累计沿用既有含所属嵌套子 Agent 的 ledger，文档明确父子行不可再相加。
- 固定详情头压缩描述/override 行以保留新增指标、Model/Context/Activity/ID/artifact；移除 Agent 选中状态行中的旧累计混合数。
- 独立审查发现带子任务计数的窄行会挤掉生命周期 glyph，已修复并新增 1–50 宽度、多状态/缩进/选中样式回归。
- 规范更新：`.trellis/spec/development/index.md` 记录请求与累计的跨层字段、缺失行为、嵌套账本归属和必需回归。

### 环境

Node `v24.14.1`；已安装 SDK `1.5.1`；`PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.5.1/node_modules`。所有验证使用本轮临时目录内的独立 `PI_CODING_AGENT_DIR`，不读取个人配置或调用在线模型。

初始 SDK 链接指向已不存在的 1.4.0，测试启动前退出 1；通过已有 `scripts/link-pi-sdk.mjs` 离线链接本机 1.5.1，无安装/下载。随后出现已有源码与 1.5.1 API 不一致，未扩展本任务到 SDK 迁移。

### 最终检查

| 命令/检查 | 实际结果 |
| --- | --- |
| `node --test extensions/task-ui/__tests__/{presentation,overview,panel}.test.ts`（无 shim） | PASS，exit 0，62/62，自然退出 |
| `node --import /tmp/pi-tokens-row.EaBi0M/review/type-compat.mjs --test extensions/agent-tasks/__tests__/runner-cancellation.test.ts extensions/task-ui/__tests__/{panel,presentation,overview}.test.ts` | 限定 Node 测试 PASS，exit 0，98/98，自然退出；不是真实 host 兼容证明 |
| 独立审查 `node --test extensions/task-ui/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts`（无 shim） | FAIL，exit 1，234 tests / 217 pass / 17 Type-import 加载失败 |
| 独立审查相同完整 focused suite（有测试 shim） | FAIL，exit 1，428 tests / 420 pass / 8 fail；7 个未修改 editor 实际 SDK 测试，1 个未修改 sdk-runtime disposal 测试 |
| `pnpm check`（最终版） | FAIL，exit 2，类型检查失败，未执行它的 test 阶段 |
| `pnpm test`（最终版单独运行） | FAIL，exit 1，1338 tests / 1242 pass / 96 fail；包含 Type import、编辑器、recap、overlay、Footer 等 SDK 相关失败，不声称全量兼容 |
| TypeScript 原始 HEAD 对比（编译器 host 内存替换本任务 10 个 TS 文件，不修改 checkout/SDK） | PASS，exit 0，原始版本和最终版均 25 个完全相同诊断，新增 0 |
| `git diff --check`、`task.py validate 11-10-tokens-row-cache-split` | PASS，exit 0；两个 role manifests 均 3 条有效引用 |
| 文档本地链接 | 独立审查 PASS |
| 真实终端视觉 / 在线 provider | NOT_RUN，未授权 |

测试 shim 仅通过 Node `registerHooks` 对安装 SDK 的 pi-ai index 内存追加从本地已安装 typebox 导出 Type，以解锁现有 Type import 后执行实际 Agent/UI 代码与回归；未修改产品或 SDK 文件，不是运行时修复。

### 失败与重跑关系

- 初始 UI 扩大指标后暴露状态点/旧 overview 期望失败，实施方修正并重跑，实施最终 UI 为 61/61 PASS。
- 初始类型检查还暴露新增 fixture cast 诊断，修正后无变更文件诊断；主会话进一步以内存 HEAD 对比确认最终 25 条诊断完全等同基线。
- 审查新增窄行回归首次 25/26，修复带 descendants 的 lifecycle 丢失后重跑 26/26；主会话再跑完整受影响 UI 62/62。
- 首次 shim 使用 CommonJS resolve 遇到 SDK import-only exports，0/39；改为精确 ESM URL 后受影响测试 98/98，完整 focused 仍 8 个已有 SDK 不兼容失败。
- 主会话首次完整 suite 为 1337 tests / 1241 pass / 96 fail；审查修复新增一条回归后最终为 1338 / 1242 / 96，失败未消失，已完整保留限制。

### 保留材料与提交检查点

本轮原始日志、隔离配置与测试 shim 在仓库外 `/tmp/pi-tokens-row.EaBi0M/`。SDK 兼容问题尚未解决，保留诊断材料，不清理、不把 raw logs 提交进任务。

阶段只提交本任务代码/测试/用户文档、规范与最小 PRD/实施记录/manifests/task metadata，保留现有无关 Trellis 基础设施改动。独立审查无剩余本任务范围内问题；本阶段有 scoped 验证，完整仓库检查未通过。提交哈希在最终回复给出；任务不自动归档或记 journal。
