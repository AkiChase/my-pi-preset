# 统一 Widget 与 Footer 展示规范

## 目标

将 preset 常驻附加信息纳入同一套区域、slot、固定顺序和生命周期规范。Agent／workflow 根任务概览位于 token 等信息之后，不插入空白行；原有状态栏三行也通过中心 slot 接入，避免两套布局规则。

## 背景与证据

- `extensions/shared/widget-display/contracts.ts` 的 `SLOTS` 当前声明 `recap`（aboveEditor，10）、`trellis`（aboveEditor，20）、`agent_overview`（belowEditor，10）。
- `extensions/shared/widget-display/owner.ts` 是唯一宿主 widget 发布者，按区域内 `order` 排序；`client.ts` 提供会话绑定的有限发布 handle。
- `extensions/task-ui/owner.ts` 已通过 `createWidgetClient(pi, "agent_overview")` 发布；`overview.ts` 仅展示 Agent／workflow 根任务，不展示 Shell／Monitor 或子任务明细。
- `extensions/status-bar.ts` 独占 `setFooter`，直接生成位置、上下文、用量三行，另有 `/statusbar` 开关。
- 已安装 Pi 1.3.0 的公开 widget placement 只有 aboveEditor／belowEditor。主布局顺序为 document → pendingMessages → status → widgetsAbove → editor → widgetsBelow → footer；belowEditor 不能靠 order 跨越 footer。
- 已安装 Pi 1.3.0 的 `FooterComponent.render` 将多个 `setStatus` 按 key 排序、清理换行后用空格连接，再 `truncateToWidth`；原生 Footer 的共享状态行并不自动换行。
- 原生 `Text.render` 使用 `wrapTextWithAnsi`，文本 widget 的每条字符串由宿主包装成 `Text`，因此一条文本可能占多行；多个 widget 本身仍是纵向排列。共享显示层不得将这种组件多行能力退化为强制单行截断。
- `.trellis/spec/development/widget-display.md` 与原任务 `archive/2026-10/10-16-builtin-display-layer/prd.md` 明确将 footer 排除在旧统一层之外。本任务明确扩展该边界，不修改旧任务材料。

## 需求

### R1：统一区域与顺序

中心注册表保留 aboveEditor／belowEditor，并增加 preset 内部 footer 区域。采用 `region → group → item` 三层注册：region 决定宿主位置；group 决定 block／inline 组合方式、区域内 order 与溢出策略；item 是插件独立拥有的内容，声明所属 group 和组内 order。不提供消费者任意优先级、用户自定义排序或区域移动配置。

目标 group 注册：

| 区域 | Slot | Order | 内容 |
| --- | --- | ---: | --- |
| aboveEditor | recap | 10 | Recap |
| aboveEditor | trellis | 20 | Trellis 信息 |
| footer | location | 10 | 路径、Git、会话名称 |
| footer | context | 20 | 上下文用量、模型、thinking |
| footer | usage | 30 | token、费用、缓存、任务汇总和已有快捷键 |
| footer | agent_overview | 40 | Agent／workflow 根任务概览 |

belowEditor 暂无内置内容，保留其接入能力。以上名称表示 group；recap／trellis／location／context／agent_overview 各自先接入一个独立 item，usage 由 tokens／cache_metrics／task_summary items 组合。group 使用区域内 order，item 使用组内 order，两者不跨层比较。

多个插件可以共享同一 region 和 group，但必须通过不同 item 发布。block 组内 item 纵向组合，各 item 可输出多行；inline 组内 item 横向组合，超宽可以按组策略换行。一个 item 只允许一个有效发布者，未知 group／item、重复占用和布局冲突明确拒绝。中心注册表声明 group 的 layout／overflow／separator，消费者不能临时覆盖或依加载顺序抢布局。顺序不是窄屏保留优先级，本次不增加按重要性隐藏机制。

### R2：单一发布所有权

共享显示层负责区域组合、排序、宿主发布、撤销和组件清理。Status Bar 保留三组指标业务计算与样式；Task UI 保留概览筛选、状态、计时和终态保留策略。消费者只更新自身 slot，不能直接抢占 setWidget／setFooter 或清除其他内容。沿用公开 pi.events 与现有 client／lease 思路，不依赖跨入口共享模块缓存。

### R3：视觉与空态

保留原三行信息的样式、指标口径和横向排列。Agent 紧接 usage 后，无新增空白行、分隔线或额外垂直间距。空 slot 不占位；Agent 终态仍按现有四秒规则消失。更新某个 slot 不重建无关组件。共享层保留组件输出多行和 SDK Text 的 ANSI／Unicode 自动换行能力，不能统一强制单行截断；原有指标／概览自身的截断策略保留。窄屏沿用宽度安全和概览有界策略，不承诺宿主极端拥挤情况下不裁剪。

共享行组合与溢出策略区别于 block：原生 setStatus 共享行当前截断，原生 Text 支持换行。公共 inline items 明确支持 wrap／truncate，采用 SDK helper 保留 ANSI／Unicode 能力；usage 默认 truncate，保持现有窄屏显示行为，其 token／费用、缓存指标、任务汇总接入独立 items。wrap 用真实组合组件回归验证，不把原生 setStatus 的当前行为误称为自动换行。间隔、分隔符和空 item 的分隔符消除由 group 组合层统一负责，本次组间不加空行。

### R4：移除开关

删除 `/statusbar` 注册、enabled 状态及恢复原生 footer 的用户开关，统一 Footer 随完整 preset 加载启用。生命周期退出仍须正确释放已拥有的宿主 UI，不影响新 activation 或第三方后来安装的组件。

### R5：规范与兼容

更新开发规范，覆盖 widget 与 footer 注册、区域内排序、间距、单一 owner、会话身份及失败处理。更新对应用户文档和生产边界回归，清理当前文档中 `/statusbar` 及 Agent 在 belowEditor 的描述。不改动历史任务与既有原始证据。

RPC 保留现有 aboveEditor／belowEditor 文本 widget 能力；新增 footer 组件是 TUI 能力，不伪造 RPC／print 支持，不悄悄把 Agent 回退到 belowEditor。共享层缺失时明确不可发布；命令、执行、指标数据等非展示逻辑不由显示失败改变。

### R6：验证与效果交付

受影响自动测试、strict typecheck、完整套件以及独立审查通过后，使用独立临时 tmux server 与隔离 HOME／agent-dir／cwd 显式加载本地扩展。使用离线任务／指标 fixture，不调用线上模型，不继承个人认证、包注册或接入现有 panes。核查有／无 Agent、宽／窄屏和 resize，输出供用户查看的效果 PNG。

若图片只能从 tmux 的真实 ANSI capture 渲染，应明确标注“真实终端内容渲染图”，不得冒充物理终端窗口截图。原始 capture 本身不是图片截图。

## 验收标准

- AC1 / R1,R2：所有目标 region／group／item 在中心注册表声明，稳定按区域内 group order 和组内 item order 组合；不同插件通过不同 item 共享 block／inline group，不同加载／发布／刷新顺序不改变布局，重复 item owner／未知目标明确拒绝。
- AC1b / R1,R3：block 保留各 item 多行输出；inline 支持 SDK ANSI／Unicode 安全的 wrap／truncate，空项不留分隔符、空组不占位，usage 默认截断不改变现有窄屏行为。
- AC2 / R3：有 Agent 时位于 usage 后且无空行；无 Agent 时不留占位；原三行指标与任务概览语义不变。
- AC3 / R2,R4：唯一共享 owner 发布宿主 widget／footer；`/statusbar` 不再注册，没有开关状态；执行和状态数据发布不受显示缺失影响。
- AC4 / R2,R5：会话切换、reload／shutdown、迟到 factory、setter／dispose 重入和异常只影响所属内容；缺失消费者或 owner 时不越权回退。
- AC5 / R3,R5：主题、中文／Unicode、窄宽度、动态 resize 和组件 invalidate／dispose 回归通过；RPC／print 行为明确且不虚构 footer 能力。
- AC6 / R5：开发、测试规范与当前用户文档同步，生产边界测试能阻止消费者直接发布宿主 footer。
- AC7 / R6：主会话核查独立审查和测试结果，记录首次失败与重跑、NOT_RUN 限制；提供隔离 tmux 效果图并核查自有进程退出。

## 排除

不接管 Header、对话、排队消息、Working 行、输入框、overlay 或第三方 widget／footer；不修改已安装 SDK 或其私有布局；不安装依赖、个人 sync／reload、push、重写历史、自动归档或修改其他会话未提交材料。不实现配置菜单、任意排序、隐藏指标开关或半行间距。

## 授权

用户已确认以上显示方向、零间隔、删除 `/statusbar`，并明确要求完整 task；后续明确认可 `region → group → item`、跨插件共享 block／inline group、独立 item 所有权与 wrap／truncate 能力，并授权更新规划材料。此前“小改动直接编辑、不建任务”的流程选择已由后续完整任务请求替代。用户已在最终更新后明确批准完整方案实施，并要求在新的托管 worktree 执行；源目录管理权威材料，新 worktree 修改产品／测试。

本任务未收到明确 no-commit 指令；依项目流程，实施计划获批后主会话按验证阶段做 scoped commit。无 push、归档或 journal 授权。
