# 技术设计

## 状态
用户已审阅并认可统一方案与扩展范围。2026-10-14 用户进一步批准仅更新规划：面板参考 `/trellis-task-viewer` 改为全屏列表/详情，覆盖旧的非全屏约束；底部只读概览与其他视觉/语义原则不变。2026-10-15 用户批准同步邻仓新滚动设计方向，直接使用原生连续滚动与滚动条，支持 Fullscreen 滚轮，不沿用旧手动视口实现。当前仅更新规划、不开始产品实施，实施前仍需完成子任务上下文与技术门禁。

## 架构与边界
- 保持 task-composition.ts 创建一个 TaskCoordinator、TaskLifecycle、Task UI owner 的结构。
- TaskSource 仍只提供 immutable TaskView 与 identity 路由的有界 detail/stop；不得从共享 UI 直接读取 manager/session。
- panel.ts 内同一全屏 interaction 使用 list/detail 两个状态，不增加嵌套 overlay 或另一个查看器。
- 参考邻仓 `lib/task-browser/command.ts` 的公开 `ctx.ui.custom()` 接入：`overlay: true`，`overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 }`。不修改邻仓或 SDK，不切换宿主终端模式。
- panel 按 supplied width 和 `tui.terminal.rows` 预算固定 header/footer 与可伸缩正文，使用公开原生 Stack/Scroll 布局接入 `ScrollView`。完整列表/详情内容交给原生布局树管理裁剪、连续滚动与滚动条，不再用 `render()` 后 `slice()`、手工 `updateLayout()` 与重复 offsets 模拟视口。原生容器与背景仍须填满实际终端行列，空态和极小终端不透出底层对话；不能仅改 overlay 百分比或仅包一层 `ScrollView` 就认为接入完成。
- 小屏优先压缩次要 header/footer，保留关闭入口；原生正文视口随 resize 重算并收敛位置。通过 supplied done 一次性关闭，owner 保持现有 dispose/finally 及 shutdown 清理，验证恢复编辑器焦点/文本。
- owner.ts 增加 belowEditor 只读概览；不注册原 FleetView 导航，不处理原 main 行或获取编辑器焦点。
- 建议新增 presentation.ts：清理终端控制字符、标题选择、圆点/状态映射、耗时/token 格式化与保护统计的宽度预算。
- 建议新增 overview.ts：只读元数据渲染与非选中保留规则。与面板复用显示函数，不复用带 selected pin 的实例。

## 列表与详情
- list 先呈现 Agents/workflow 根树，再呈现 Processes 根树；标题不可选，整份列表单一选择/滚动。
- model.ts 增加真实树形 continuation/last-sibling 前缀与后代计数；保留 orphan/cycle 容错，不将通知 join group 伪装成父组。
- 折叠前将内部选中子项移到父项，避免最终 snapshot pin 令隐藏子项作为孤立根行重新出现。
- 用稳定 task identity 而不是下标保留选择；列表与详情各有独立原生滚动状态，不另存一套手动视口 offsets。不在 render、每秒刷新或普通内容更新时调用确保旧选择可见；仅键盘选择变更时确保目标可见。鼠标滚轮不改变选择，树折叠/任务移除时 reconcile 选择与滚动锚点，resize、返回及内容变化后合理保留或收敛。
- detail 显示完整换行标题、执行模式、等待关系、类型统计、完整阶段文案及单一有界输出预览；低频 ID/path 信息不抢占默认摘要。
- Enter 进入详情，Esc 从详情返回列表、从列表关闭；保留 SDK select cancel 匹配，不照搬邻仓 Ctrl+C 拦截或文档 section 导航。不保留手动分页、PageUp/PageDown 处理和提示；方向键在列表移动选择、在详情逐行滚动，左右键继续用于树展开/收起。
- Fullscreen 通过公开原生鼠标/布局路由将滚轮交给对应正文 `ScrollView`，使用原生 containment（如目标 SDK 的 `overscroll: "contain"`）阻止边界穿透；Regular 不主动启用终端鼠标捕获，保留键盘滚动与滚动条。滚动条显示策略、行点击、拖动未确认，不擅自增加处理器或宣称支持。
- 选中 final metadata 与 bounded detail 保留到切换/关闭；列表不渲染输出，但保留现有选中有界读取策略，避免 sweep 后丢失最终详情。

## 状态与宽度
- ● 仅对应 running；○ 对应其他状态，具体含义用文字/语义色区分。
- selectedBg 在完成整行 padding 后应用，测试嵌套 ANSI reset 不破坏背景连续性。
- 先保护状态/waiting 与必要统计，再预算树前缀、类型、标题。深树与极窄宽度采用缩减次要字段/限制缩进，不任由右侧 suffix 抢光标题。
- waiting 取 waitCount，不从 foreground/background 推导；owned 是执行归属而非主会话等待。
- global detachAll 语义不变，列表与详情都标为解除全部等待，selected stop/path-copy 与其分开。

## 概览与统计
- 建议展示 agent/workflow 根项，保留运行时顺序，每项单行，最多五项并明确 hidden count；根组统计不汇总可见子行。
- workflow 与父 agent 各使用现有 stats.tokens；↓ 仅为 FleetView 记号，不代表 output-only。
- Agent display tokens 为 input+output+cacheWrite，不含 cacheRead；nested usage 已传播到祖先，不可再求和。
- Resume tokens 为 lifetime，而耗时对应当前 run，保持既有语义并在文档说明。
- Workflow totals 可能滞后 live children，且 retry/resume 下不等于精确总花费；本任务不修执行/计费契约、不制造全局累计值。
- owner 管理事件订阅与仅在需要时运行的 clock/expiry timer；概览无 selected pin，根组终态四秒后自然消失。
- 在外部 setWidget/setStatus 前发布 ownership，调用后检查 lifecycle；reset/dispose/late callbacks 不得复活已关闭 UI。关闭顺序保持 freeze→UI close→cancel waits→backend drain。

## 前台 shell 提示收敛
- 删除 process-tasks 的独立 `bg-hint` renderer 及其 show/clear/reset 接线；旧两秒 UI 展示门槛不再触发下方 widget。两秒窗口若仍用于工具输出流转，不因移除提示而顺便改变执行路径。
- `registry.ts` 的时钟职责须区分：清除 hint 专有渲染/缓存，保留共享 TaskSource 所需的计时刷新、状态发布与终态 sweep；不能因去掉 hint 而使面板耗时停止更新。
- 前台 bash 将输入 `description` 传入 `runForeground`/Job.name，复用 `source.ts` 的 `job.name ?? job.command` 标题契约。共享安全文本处理只作用于显示副本，实际 command 与详情原文保持。
- 共享 owner 从 coordinator 的实际等待信息表达紧凑等待状态；全局提示读取配置中的快捷键，未绑定时用 `/bg`。不能只统计前台 shell，也不能把 background 自动当作无等待。
- 不新增独立 shell 概览、第二个 widget owner 或独立快捷键注册；agent/workflow 概览范围不变。
- 删除提示不能影响 launch/retrieval lease、detachAll、timeout、abort、日志、通知、结果消费、cleanup 与 session 环境隔离。

## 长标题统一范围
- 覆盖 Task Panel、belowEditor 概览、Agent 调用与完成摘要、workflow progress 卡片、现有 /agents workflow-dialog/conversation-viewer、shell/monitor 可见标题与 Beautify bash 呈现。
- 共用字段含义、文本安全处理、状态/圆点、格式化与宽度预算，不将不同界面强制改成相同结构。
- 除本任务明确删除的独立 `bg-hint` 外，原布局与导航保留；完整描述在现有可滚动/换行详情中呈现，工具正文/命令/日志/通知 payload 不变。
- workflow-card.ts header/phase/child 需 width-aware 原生渲染测试，调用与 replay 路径都覆盖。
- Beautify bash 使用 preset 本地适配，不修改 node_modules。
- 窄屏依次缩短文案、隐藏次要统计、减少重复标识/缩进；极窄时允许摘要统计移至第二行，不令标题或关键状态完全消失。
- footerPhaseLabel 当前无调用者，不作为活跃表面改造。

## 兼容与集成
- 不重写 /agents 既有高级管理路径；新概览不恢复 FleetView 独立 viewer。
- 现有 footer 语义配色与快捷键保持；打开面板时全终端覆盖对话/编辑器，关闭后恢复。主对话的 belowEditor 只读概览保持原范围，不随面板改变布局；兼容 Pi regular/fullscreen 两种宿主模式。
- 实施前核对实际 SDK 与目标宿主版本，验证公开 Stack/Scroll/ScrollView 在全终端 overlay 与 Regular/Fullscreen 的真实布局及输入路径。若原生能力阻碍目标，报告阻碍并保留规划未验收状态，不改 SDK、不回退到自制滚动条或手动截取。
- 邻仓 `10-15-task-viewer-mouse-scroll` 当前仍 planning，只作设计与后续证据参考，不作为整个父任务硬依赖，也不影响先行共享展示子任务。Panel 实施前若已有邻仓结果可借鉴，但须独立完成本面板的布局、动态任务更新及真实宿主滚轮验证。
- 工作区已有 monitor 任务及 .pi 修改。新 worktree 必须绑定明确基线；潜在 README/spec 重叠需 scoped hunks 集成，不能覆盖既有修改。

## 拆分与依赖
采用父任务整体验收、两个子任务串行实施：
1. 共享展示规则与现有 renderer 适配：交付 presentation primitives、旧工具/专用查看器/progress/Beautify 本地适配与独立回归；补齐前台 description→Job.name，不改变命令执行。
2. Task Panel 与只读概览：依赖第一个子任务已验收的 shared helpers，交付 model/panel/owner/overview 与 lifecycle、导航回归；移除独立 `bg-hint`，将等待说明收敛到共享底栏/面板。
父任务保留完整需求与最终集成验收；第二个子任务 PRD/实施计划必须明确等待第一个子任务共享接口就绪，不凭父子树隐式推断依赖。
共享文件以串行交付和精确 hunks 集成，不能用并行改同一 checkout 的方式省略隔离。
