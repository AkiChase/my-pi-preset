# 统一任务面板与执行后端

## 目标

将 `@tintinweb/pi-subagents@0.20.0` vendor 到本 preset；将现有 `extensions/bg-tasks/` 整理为 `process-tasks`，agent 后端命名为 `agent-tasks`，共享交互层命名为 `task-ui`。执行后端保持独立，用户通过同一个「任务面板」查看和管理当前会话的任务。

这是个人 preset，不要求旧命令、配置文件、环境变量或 UI 保持兼容。不为改名建立别名、旧文件回退或自动迁移。

## 背景与证据

源代码基线及历史交互决策见 [baseline.md](research/baseline.md)、[进程交互研究](research/bg-tasks-interactions.md)、[vendor 与生命周期研究](research/subagents-vendor.md)、[面板入口研究](research/shared-panel-entry.md)。以下上游锚点均相对于当前安装的 `@tintinweb/pi-subagents`，实施后用 provenance 对照，不假设行号不变。

- 当前 `0.20.0` 有前台等待和后台启动，但无执行中的显式转后台动作：`src/index.ts:2209`、`src/ui/fleet-list.ts:307–361`。
- 前台取消会停止子 agent：`src/agent-manager.ts:746–758`；取消 `get_subagent_result(wait: true)` 只结束等待：`src/index.ts:2753–2771`。队列、worktree 启动和 foreground resume 需要一起覆盖，不能仅修改 `isBackground`。
- 用户报告需要 Down/Left 才看到列表；上游 FleetView 实际意图是在进入导航前显示符合条件的行。此显示缺陷尚未复现：`src/ui/fleet-list.ts:204–260,307–361,457–487`。本任务以替换交互为验收目标，不声称修复已定位的 repaint 缺陷。
- 当前项目 `.pi/subagents.json` 的基线为 `backgroundByDefault: true`、`fleetView: true`、`widgetMode: "background"`；新的 UI 不沿用这些显示选项。
- 现有 bg-tasks 面板只展示后台任务；前台命令实际上也有注册表记录：`extensions/bg-tasks/tools/bash.ts:143–205`、`extensions/bg-tasks/ui.ts:13–22`。
- 面板原入口默认是 `Shift+Down`，不是对话中提到的 `Shift+J`：`extensions/bg-tasks/config.ts:105`、`extensions/bg-tasks/__tests__/shortcuts.test.ts:30`。本任务保留默认键，增加有条件的 Down 入口。
- 旧进程输入处理会转后台后中断并重新提交普通消息：`extensions/bg-tasks/input.ts:8–33`。用户要求移除该行为。
- 上游切换会话会保留部分运行记录：`src/index.ts:1090–1122`。用户明确要求各后端都停止旧会话任务。

## 已确认的需求

### R1：Vendor 与加载所有权

- 以完整 `0.20.0` 源码为基线，保留 MIT 许可、来源、版本、artifact 校验信息和复制布局；后续修改由本仓库维护。
- 从 preset 的 packages 移除 standalone `@tintinweb/pi-subagents`，通过 conflicts 防止重复安装注册。
- vendor 目录不是独立发现入口；继续使用顶层扩展声明及 manifest 回归检查。
- `bash` 仍只有一个注册者，保留 pi-pretty 的渲染组合。

### R2：前台等待与显式转后台

- `Ctrl+Shift+B` / `/bg` 解除所有当前前台任务等待；进程或 agent 原实例继续运行，不停止、不重启、不丢输出。
- 对已在后台执行的任务进行结果等待时，同一动作也能解除等待，但不修改任务本身。
- agent 前台等待只手动转后台，没有按时间自动转后台；bash 原有超时转后台规则不变。
- 普通消息提交不隐式转后台，不做扩展自有的 abort-and-resubmit；消息由 Pi 原生 queue/steering 处理。给 agent 的定向消息与普通消息提交分开。
- 在主会话中 Esc 中断真正的前台执行会停止对应任务；Esc 取消已在后台执行任务的结果等待，不停止任务。

### R3：共享任务面板

- 面板统一叫「任务面板」/ `Task Panel`，显示当前会话前台、后台、排队任务，以及短暂保留的终态记录；不是只展示后台任务。
- 任务类型包含 shell、monitor、独立 agent、workflow；区分执行模式与主会话是否正在等待，不能把「等待后台结果」标成前台执行。
- 底栏提供分类摘要；打开一个双栏面板，左侧选择，右侧立即展示日志、对话或 workflow 进度，不需要 Enter 或下一层弹窗。
- 查看和关闭面板均不解除等待或改变任务模式。Tab 切换列表/详情焦点，箭头/jk 选择或滚动；Esc 只关闭面板。
- x 只停止当前选中的活动任务。选 workflow 停止整个 run 及子任务；选子 agent 只停止它及其所属嵌套工作，不把其他独立任务停止。workflow 后续按正常失败/依赖规则处理，不能因自动重试而悄悄重新启动被用户停止的同一次执行。
- 日志/对话按终端显示宽度安全渲染，限制一次读取量，明确提示省略内容；复制文件路径不提交内容给主 agent。

### R4：Workflow 分组与保留

- workflow 子 agent 放在其所属组内，默认展开；Left/Right 在面板列表中收起/展开，不抢主编辑器键。
- 新组默认展开；同一次面板交互的刷新不覆盖用户收起状态。
- 选择 workflow 立即显示整体进度和真实阶段，选择子 agent 立即显示它的对话；未声明阶段时不编造阶段。
- workflow 运行期间保留全部已完成子 agent 行；只有整体结束才开始组的终态展示窗口。
- 终态展示窗口结束后，当前正在查看的最终详情仍保留到切换选择或关闭面板，且不得依靠保留运行时控制器来实现。
- 普通 agent 的嵌套子任务按真实父子关系展示，不伪装成 workflow，不在顶层重复平铺。

### R5：移除旧任务 UI 与入口

- 移除上方 AgentWidget、下方 FleetView、它们的导航监听器和对应设置项，不保留可选旧 UI。
- 新面板保留显式 `Shift+Down` 入口，使用 `/tasks`；新增：编辑器严格为空、有可查看任务且编辑器持有焦点时，Down 直接打开面板。只有前台任务时也可使用。
- 非空文本、无任务、其他弹窗/选择器持有焦点、按键释放事件时不打开也不吞 Down。面板内部 Down 仍是面板导航。
- 同一会话只存在一个入口监听与一个面板实例；重载、会话替换和关闭有明确注销所有者。

### R6：会话所有权和通知

- 切换会话或退出时，停止旧会话运行/排队的 shell、monitor、自有 workflow worker、子任务和延迟启动活动，关闭面板并释放自有等待、定时器及订阅。
- 普通 agent 保留与主 Pi 同进程的架构，采用协作式取消：正常响应取消的 provider、异步创建和 child shutdown hooks 必须清理；对不响应取消的第三方进程内代码，发送取消请求、有界等待并封闭旧会话的工具、接口和通知，保留迟到清理所有者。不保证强制终止该代码或阻止其内部继续写文件。
- 上述取消边界由用户在 3B2 后明确选择方案 1；不为强杀非协作第三方代码改成独立进程/worker 架构。自有可终止资源不适用这一豁免。
- 旧执行不会自动恢复；晚到的启动/完成/通知不能进入或重新填充新会话。
- 磁盘日志和对话记录保留；显式用户再次发起执行不算自动恢复。
- 正常完成由 inline 结果或后台完成通知报告，不重复、不漏报；取消后台结果等待后仍保留完成通知资格。
- 停止动作反馈与正常完成通知区分；手动转后台本身不是任务完成。

### R7：名称、配置与能力边界

- 使用 `process-tasks`、`agent-tasks`、`task-ui` 模块名，不要求发布成三个独立包。
- 配置使用 `process-tasks.json`、`agent-tasks.json`、`task-ui.json`；进程环境变量使用 `PROCESS_TASKS_*`；面板/入口/转后台键配置由共享层管理，不在两个后端重复配置。
- `/tasks` 替代 `/bg-list`，`/bg` 仍表示转后台，`/agents` 仍表示 agent 管理。旧 `/bg-list`、旧配置和 `BG_TASKS_*` 不提供兼容实现。
- 保留仍准确的工具名称，不为目录对称而重命名 `bash`、`bash_bg`、`jobs`、`Agent`、`SubagentWorkflow`、`get_subagent_result`、`steer_subagent`、`monitor`。
- 保留自定义 agent 类型、调度、workflow pipeline/parallel/schema/gate/replay 和高级控制、嵌套委派、steering/resume、worktree、mentions、记忆、用量和剩余设置等非旧概览 UI 能力。名称兼容与能力保留是两回事。
- README、provenance 和离线测试同步更新；不通过真实安装或读写个人配置来替代验证。

## 验收标准

| ID | 需求 | 可观察结果 |
| --- | --- | --- |
| AC1 | R1、R7 | 精确 vendor 基线和许可有记录；只加载 preset 所有的入口，无 standalone / nested 重复工具、快捷键注册；pretty bash 组合仍有效 |
| AC2 | R2 | 同时前台 shell/agent 可一次解除所有等待，ID/会话/输出不变；排队、worktree 启动、resume、完成竞态均正确；结果等待也可解除 |
| AC3 | R2 | 推进时间超过 bash 超时不会自动转后台 agent；bash 超时行为不变；普通消息不请求转后台或 abort-and-resubmit |
| AC4 | R2、R3 | 主会话 Esc 停止真正前台执行；后台结果等待取消只取消等待；面板 Esc 只关闭；查看面板不改变执行模式 |
| AC5 | R3 | 前台/后台/排队任务均可見，执行模式与等待标签正确；选择立即显示详情，Tab/滚动/宽度安全/省略提示正确，x 不误停其他任务 |
| AC6 | R4 | workflow 默认展开；子结果在整体完成前不逐个消失；用户收起不被刷新覆盖；组/子详情立即可看，最终查看内容不被回收清空 |
| AC7 | R5 | 旧 widget/FleetView 及设置不能出现；共享底栏/面板正常，剩余 /agents 管理能力可访问 |
| AC8 | R5 | 空编辑器 Down 有任务即打开（含前台-only）；非空、无任务、其他 UI、释放事件不拦截；面板 Down 正常，重复初始化无监听器/面板叠加 |
| AC9 | R6 | 会话替换/关闭停止自有旧进程、monitor、队列、workflow worker及延迟启动并释放资源；agent 发取消并有界清理，非协作第三方进程内代码按 R6 封闭接口/通知、保留迟到清理所有者而不保证强杀；晚到事件不污染新会话，文件保留、不自动复活 |
| AC10 | R6 | 自然完成只交付一个对应报告；转后台竞态不重复、不丢报告；取消后台等待不永久吞掉通知 |
| AC11 | R7 | 模块/配置/命令/README 使用新规范，不遗留旧名兼容实现；非 UI agent/workflow 能力有回归覆盖 |
| AC12 | 全部 | 离线自动测试、真实 strict typecheck、`pnpm check` 和 `git diff --check` 通过；真实 TUI 验证失败/未执行如实记录 |

## 范围外

- 合并进程与 AI 会话执行引擎，或把 agent 强制转换为 shell Job。
- 为强制终止非协作第三方进程内代码而重设计普通 agent 的独立进程/worker 隔离。
- 面板管理任意阻塞工具（read/edit/提问等不是此处的执行任务）。
- 旧名称别名、旧配置回退、自动配置迁移、旧 UI 可选模式。
- 改写 monitor 事件 batching、wake/inactivity、stderr 语义；由独立 monitor-wake 任务管理。
- 修改个人配置、切换实际安装来源或加载到日常 Pi；必须单独取得授权。已批准的代码实施及临时配置隔离冒烟不在此禁区内。
- 与本任务无关的工作流基础设施、既有修改和 upstream 回合并。

## 验收状态

用户已批准实施和后续协作式取消边界，核心交互已完成；自动 strict/full 483/483、三模块 461/461 无 force-exit 自然退出，独立审查发现已关闭，隔离真实 Pi PTY 分段 19 项核心检查通过。四秒整组保留、取消与等待区分、焦点安全的 Down 均有实际回归。

产品已提交为 `fe8d0f6b35adc0f52bf93fe26349f22ba971fd5d`（`feat: unify process and agent task interactions`）。用户随后批准正式收尾，本任务完成并归档到 `.trellis/tasks/archive/2026-10/10-12-subagents-task-ux/`；没有合并分支、推送或改变日常 Pi 安装。验收边界、未覆盖场景与提交范围统一记录于 [final-acceptance.md](research/final-acceptance.md) 和 [commit-plan.md](commit-plan.md)，不把离线脚本响应当作在线模型自主质量，也不把任意非协作第三方代码强杀纳入已批准保证。
