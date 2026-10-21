# 任务概览活动状态低频动画

## 目标

让主界面底部的 Agent／workflow 根任务概览直观区分排队与执行：starting／running 使用与 Task Panel 相同的 spinner，而非默认静态 `◌`。

## 背景与依据

- `extensions/task-ui/overview.ts:49` 当前调用 `taskDot(view)`，未传动画帧。
- `extensions/task-ui/presentation.ts:22-27` 已有共享 spinner；starting／running 无帧时回退 `◌`，queued 使用 `○`。
- `extensions/task-ui/owner.ts:39-45,59-74` 当前拥有概览耗时／终态过期计时器，并在发布失败时只保留过期维护；改动需保留生命周期防护。
- `docs/extensions/task-composition.md:5,52` 当前明确规定概览静态、仅面板动画，需要同步更新新行为说明。
- 历史任务 `.trellis/tasks/archive/2026-10/10-19-dispatch-task-panel-ux/design.md:168-183` 的限制是避免面板外高频动画重绘，本任务将概览改为按需低频动画。

## 范围与需求

1. 概览 starting／running 每 250ms 更新 spinner 帧，复用面板图标；starting 保持 warning 色、running 保持 accent 色。两状态切换不重置动画。
2. 多个根任务共享节拍与计时调度，不为每个 Agent 建立计时器；仅概览可用、有可呈现活动根任务且动画配置开启时安排动画刷新。显示发布失败／不可用时，不维持动画刷新。
3. 尊重现有 `animations` 配置；关闭时 starting／running 使用静态 `◌`。不增加新配置。
4. 非活动状态保留现有语义与配色：queued `○`、paused `Ⅱ`、completed `✓`、failed `✕`、stopped `■`、interrupted `!`；真实状态更新后立即替换动画图标。
5. 保留耗时、tokens、等待信息、布局与终态短暂保留四秒的既有规则。空态不运行动画；会话重置、关闭、dispose 时正确清理，防止旧回调发布内容。
6. 动画只表示真实 starting／running，不根据输出是否变化判断卡住。解除等待／转后台不改变状态。paused 目前用于暂停 workflow 后续 Agent 启动，已运行子 Agent 继续执行；本任务不调整这些运行时语义。
7. 更新相关测试与用户文档，使概览与面板的活动图标说明一致。

## 范围外

- 不改 Agent／workflow 状态机、暂停能力、等待／后台执行逻辑或工具卡片动画。
- 不新增任务类型、概览子任务展开、布局或统计口径。
- 不安装依赖、不修改 deployed runtime、不推送、不自动归档。

## 验收标准

- [x] starting／running 概览图标在时间推进时变化，queued 与其他非活动状态不播放动画；活动图标来自共享 spinner。- [x] starting → running 连续动画；切到终态／paused 后停止该任务动画，其他活动任务不受影响。
- [x] 多任务共享调度，默认动画刷新间隔 250ms；静态模式不额外启动动画时钟。
- [x] 空概览、不可用显示入口与发布失败不维持动画刷新；终态到期清理仍有效。
- [x] 会话重置／关闭／dispose 清理计时器，旧回调不发布；现有耗时与等待信息行为无回归。
- [x] 更新文档，通过 task-ui 相关测试与 TypeScript 检查。

## 实施与验证计划

单阶段：主会话直接实现概览与 owner 调度、补测试及文档；主会话自查实际 diff 和生命周期边界。此改动不改变公共状态／运行时契约，采用自审。若发现需要调整共享 widget 公共契约，暂停并重新确认范围。

计划验证命令（使用现有本地依赖，不拉取依赖）：

```sh
node --test --test-concurrency=8 --test-force-exit 'extensions/task-ui/__tests__/*.test.ts'
pnpm run typecheck
```

测试适配涉及宿主时补充相应定向测试；原始执行输出存放本轮仓库外自有临时目录，最终结果与失败／重跑事实记录到本 PRD。代码、测试与文档耦合为一个验证后提交检查点；不包含其他会话改动。

## 实施与验证结果

- 主会话已完成实现与自审。`overviewRootCount` 从原行数预算提取供渲染／可显示根任务判定共用，不改变行数规则；owner 复用一个 timeout，按绝对时间对齐 250ms 节拍，不因 source 通知重置动画。动画关闭／发布失败只保留原耗时或有限过期维护。无需新依赖、公共展示契约或状态机变更。
- 实施期间主分支合入统一 Footer（`0b5f8eb`，随后归档提交 `55a75e1`）。概览位置由 belowEditor 移至 Footer，属于并行任务，保留其实现和测试适配，不在本任务重复提交；当前改动仍走同一 client。新增回归验证动画只请求 host redraw、不重装 Footer，以及第三方接管退休后的无重试行为。
- 验证环境：Node `v24.14.1`，pnpm `10.33.0`，本地已安装 Pi SDK `1.3.0`；全程 `PI_CODING_AGENT_DIR=/tmp/task-overview-spinner.TzEklh/agent` 隔离配置，未拉取依赖或修改个人配置。
- 首次 `node --test extensions/task-ui/__tests__/overview.test.ts`：退出 1，11 PASS／1 FAIL。新增 hidden-root 测试错误假设新 root 会排到已保留 root 前面；实际 retention 按已有 Map 次序保留。修正为把已有可见 root 从 paused 改为 running，未改变产品排序或弱化动画断言。
- 修正后 `node --test extensions/task-ui/__tests__/*.test.ts extensions/shared/widget-display/__tests__/*.test.ts`：退出 0，133 PASS，未使用 forced exit，正常自然退出。最终增强 host redraw／takeover 测试后同命令重跑：退出 0，133 PASS。
- `pnpm check`（含 SDK link、严格 TypeScript、完整 forced-exit 测试）：首次及最终重跑退出均为 0，最终 1623 PASS／79 suites，无 FAIL、skip。完整 suite 的 forced exit 不用于证明资源退出，退出证据来自上述自然退出定向 suite。
- `git diff --check`、本页相关用户文档相对链接、任务 JSON 与两个空 manifest 检查通过。空 manifest 是直接实现／自审的有意选择，未声称 task validate 完整通过。
- 自审覆盖真实状态图标、配置 fallback、单时钟／source 事件对齐、隐藏活动根任务、小终端、空态、失败 sink、开始时间未知的 starting、同步重入、重置／关闭、终态四秒过期和 Footer takeover。当前无需新增长期 spec；沿用现有展示与资源所有权规范。
- NOT_RUN：真实交互终端／在线 provider 视觉验收、个人安装／sync／reload；组件与实际共享 owner 的回归不等同于肉眼终端动画验证。
- 原始日志位于本轮自有仓库外临时目录；结果检查完成后按授权清理，仅在本 PRD 留下完整结论与失败／重跑关系。不写 research 或额外 evidence 报告。
- 单阶段已验证，准备 scoped commit；任务不自动归档，不改其他会话 journal、任务或暂存内容。


## 授权与材料状态

用户已确认低频动画方向与状态呈现，并明确要求创建轻量 task。本任务使用 PRD-only；无阻塞产品决策。用户随后明确回复“开始做吧”，已批准按上述不变计划实施及验证后 scoped commit。直接实现与自审不需要派发 manifest，两个种子 JSONL 保持空；后续若获批准启动，应明确使用 `--allow-empty-context`，不将空 manifest 描述为完整验证通过。
