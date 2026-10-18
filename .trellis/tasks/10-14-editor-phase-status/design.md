# 技术设计：输入框阶段状态

## 设计状态

PRD 的用户体验及启动前验证后的展示/计时口径已确认，用户已明确批准在 Beautify 实施本任务。范围含产品代码、测试、功能文档、独立审核及已验证阶段的本地提交；不含安装、个人同步/reload、push、归档或真实交互式 TUI。

## 所有权与范围

- 唯一入口仍为 `extensions/beautify.ts`，在 `extensions/beautify/index.ts` 接入新增阶段控制器；建议模块为 `editor/phase-state.ts`（状态归并）、`editor/phase-status.ts`（事件/UI/计时）、对应 `__tests__/phase-status.test.ts`。
- Beautify 只观察主会话事件、更新展示，不修改 agent loop、工具执行、工具输入/结果、TaskCoordinator 或后台任务所有权。
- 复用当前 editor handoff 和原生 embedded indicator，不能复制文本重建编辑器。输入框周边没有新增 widget，也不接管 bg-hint、Task Panel 或 blocked-signal 的外部终端通知。
- 功能说明更新根目录 `docs/extensions/beautify.md` 的输入框章节，测试方法归 spec；无需新建功能页或扩大文档重组范围。相关任务不构成交付依赖，实施前协调共享文件。

## 状态模型

内部允许比可见词更丰富的状态，不把所有内部状态映射成新文案：

- activation/session epoch：防止旧回调跨 session/reload 生效。
- 底层阶段：prepare / model-loading / model-generating / tools / inactive。
- 顶层工具 Map：以 toolCallId 为键；parentToolCallId 存在的嵌套事件不作为独立批次。
- prompt 覆盖：仅真实需要用户响应的交互覆盖 Asking，保存关联身份，不保存一份将来可能过期的显示字符串。
- 压缩状态：独立于普通底层阶段，结合原生 compaction indicator 交付和 session 成功/失败事件记录；本次提示首次交付时间支持空闲手动压缩，不等同精确操作开始。
- suspended：原生 Retry/Branch Summary 等专用状态期间停止普通 UI 写入；压缩期间也暂停普通 working 写入，但需通过公开压缩展示能力呈现 Compacting。保留底层事实，恢复必须基于最新状态。
- phaseStartedAt：单调时间，状态真正改变才更新；UI 文案差异不属于阶段变化。

归并后的可见词为 Loading、Brewing、Tooling、Asking、Compacting。压缩优先于普通模型/工具阶段；真实用户问题仍可覆盖 Asking，但底层压缩生命周期继续记录，不能被旧 prompt 清理掉。inactive 仅在没有压缩或真实交互时清理自有 override；prepare 只是一段短暂交接，不声称网络请求已发出或工具已运行。

## 主流程与事件

| 证据 | 内部处理 | 可见效果 |
| --- | --- | --- |
| run/turn 开始，进入主模型阶段 | 开始新的模型阶段；实际宿主测试确认 start 与 prepare 的顺序 | Loading，不声称 HTTP 已发送 |
| 主 assistant 的 thinking/text/toolcall 内容生成事件 | 观察非空 reasoning/text/参数增量或实际内容；空 start/delta/end 不自动判为生成 | 首次生成证据才 Brewing |
| toolcall_end | 仅内容事件 | 仍 Brewing，不能提前执行/显示 Tooling |
| assistant message_end | 记录模型消息完成，不猜测最终结果之外的下一步 | 等待实际工具/后续边界 |
| 顶层 tool_execution_start | 加入 Map、进入 tools | Tooling |
| 顶层 tool_execution_end | 删除匹配项 | 只要批次仍有待处理，维持 Tooling |
| 全部工具已结束、尚未进入下一轮 | 从 assistant 最终消息记录本批预期 toolCallId，完成最后一个后进入 prepare；Map 暂空但仍有预期工具时不结束串行批次 | 清除普通自有阶段展示，不虚构仍在 Tooling；下一 turn 才 Loading |
| 下一 turn 的模型阶段开始 | 清理旧批次，model-loading | Loading，重新计时 |
| 需回答的 prompt 开始/结束 | 加入/撤销 Asking 覆盖；恢复最新底层阶段 | 静态 Asking / 真实阶段 |
| 主会话原生压缩提示首次交付（手动/自动） | 记录独立展示生命周期与单调提示起点；暂停普通 working 写入 | Compacting，原生 spinner 与提示出现后耗时，保留取消提示 |
| 压缩中的 provider/生成事件 | 不作为普通模型阶段的生成证据 | 保持 Compacting，真实用户问题除外 |
| 压缩成功/失败/取消 | 结束匹配的压缩生命周期，解除压缩展示；以最新真实事件恢复，不复活旧阶段 | 后续模型开始才 Loading；无后续活动则清除 |
| agent_end / agent_settled | 分别清理普通本轮与处理真正完成边界；不能仅以普通 agent_end 结束仍在运行的压缩；后续自动继续由新事件重建 | 无过期文案 |

不以 provider 原始数据或 before_provider_request 单独驱动主状态：这些事件可能来自工具内嵌模型请求、压缩等，不能靠“处于 busy”就认定属于主模型。优先采用 agent loop 提供的主 assistant message_update 与 turn 边界，role 检查、epoch fencing 必须有回归。

并行工具准备阶段可能先发出多个 start，execute 也可能还没开始；所以 Tooling 是处理而不是“进程已启动”的证明。序列执行工具间 Map 可暂时为空，不能闪回 Loading。截断响应会生成合成的工具 start/end 错误事件，允许短暂 Tooling，但不得宣称工具实际执行。

## 用户交互识别

- 使用公开 ui_prompt_start/end 判断交互生命周期；select/confirm/input/editor 默认属于需要用户操作的提示，但仅在主忙碌或压缩阶段覆盖本提示。
- custom 不一律变 Asking：Task Panel 与安装 editor 时的空 overlay 也属于 custom。
- 标准 select/confirm/input/editor 使用公开 ui_prompt_start/end；宿主对嵌套 UI 只发最外层事件，不能假定每个 dialog 均有独立 ID 或成对事件。
- 问卷优先使用公开 peer channel `rpiv:ask-user:blocked` 的 `{ active: true/false, toolCallId }` 明确等待生命周期，优先按 toolCallId 幂等匹配（当前安装 2.13.9 总是发出 ID），缺 ID 的兼容事件才使用有界计数；`rpiv:ask-user:prompt` 仅提供可选标签，本功能不展示标签，无需用旧 payload 猜测 custom 意图。
- 当前 `extensions/blocked-signal.ts` 及对应测试已使用上述合同；Beautify 独立观察，不能依赖该扩展在 Herdr/cmux 存在时才启用的 watcher，也不沿用终端 sink 的过滤策略。实际安装问卷发布方的发出顺序、异常释放和取消路径仍需验证。
- 对不能确认的 custom 保留底层阶段，不猜测用户等待。无问卷 peer 时保留标准 dialog 能力；不得把浏览 Task Panel/custom setup 一律判为 Asking。
- 不修改 blocked-signal 对 Herdr/cmux 的既有事件与通知逻辑。

### 已验证的展示阻塞

实际 Pi 1.3.0 标准 selector 与问卷 2.13.9 的默认 inline custom 挂载都会从 editorContainer 临时移除原输入框，关闭后恢复同一 editor。问卷 blocked 意图能可靠观察，但此时输入框边框并未渲染，Asking 不可见。不能把离屏状态归并通过称为 AC3/R2 的可见体验通过。

在不修改 SDK、问卷 presentation、对话框所有权且不新增状态行的既定范围内，用户已选择“输入框可见时展示 Asking；输入框被问题替换时由原生问题 UI 表达等待”。因此保留原生 dialog/inline 挂载，不改变问题布局；离屏状态仍用于结束后恢复，但不要求离屏边框可见。AC3 已按该口径更新。

## 原生 spinner、颜色与时间

### 首选公开接线

- 文案、阶段色和时间由原生 indicator 的公开 border render 装饰呈现；不调用非 keyed 的 setWorkingMessage，避免覆盖其他写入者。
- 动画复用宿主十帧、80ms；Asking 仅在必要模式切换时通过已接收 indicator 的公开 setIndicator 使用静态标记，离开时恢复原生配置。
- 不调用 setWorkingVisible(true) 或创建 loader；Retry/Branch Summary 不装饰，保留宿主专用生命周期。
- 阶段色只作用于状态词/指示符，不改变 editor.borderColor。使用宿主主题/颜色工具，不硬编码 ANSI 字符串或仅测试 dark 模式。

### 必须验证的能力缺口

原生 `setWorkingIndicator()` 会把 currentFrame 重置为 0。公开 `frames` 是静态数组，不能每秒重设彩色数组来实现颜色增强，否则动画周期被打断；也不能无限追加预染色帧来伪装按时长变化。

实施第一步验证公开 `CustomEditor.setWorkingStatusIndicator()` 的接收入口：宿主向同一 editor 交付 working/compaction/retry/branchSummary indicator，可通过该公开方法的参数获得对象，不读取私有 workingStatusIndicator。候选方式是在仍归宿主管理的 indicator 的公开 border-render 方法上装饰展示，使用原生 spinner-only render 获取当前帧，在绘制时添加阶段色、耗时及宽度降级；不改原生动画帧、timer、dispose 或 cancel handler。类型可从公开 CustomEditor 方法参数推导，不把内部 StatusIndicator 模块深导入作为产品依赖。

最终接线已通过实际组件、初次活跃 indicator、重试计时、clear/redelivery、locked later wrapper 和 reset/shutdown 回归。资源回调通过独立 forwarder 与可清空 cell 避免 retired wrapper 保留 controller；restore 失败逐项隔离。成功 clear 的 fenced microtask 区分同步同对象 handoff，不把交接当压缩终态。仅使用公开参数对象和方法；未新增私有字段或内部兼容 seam。

时间文案可用一个 session-owned、仅主 busy 或压缩时运行的低频 tick 更新，模型 token 事件不重建计时器。颜色函数采用有界曲线：0–10s 柔和，10–30s 渐进增强，>=30s 保持最大值；Asking 静态，无 tick 需求。Compacting 使用主题中性色及本次独立压缩耗时，重复压缩进度不重置开始时间；空闲但压缩未结束时不能停 tick。timer unref 不是清理，无主活动/压缩、session 切换/shutdown 必须停止。

Asking 前后静态/动画切换可能触发原生配置重置，允许必要的模式切换；普通阶段转换应尽量保留转动连续，时间 tick 绝不反复重置帧。

## 专用状态、并存与回退

- Compaction 不再只是“不覆盖”的例外，而是第五种可见阶段 Compacting。保留原生压缩生命周期、spinner 和 cancel hint；不把压缩伪装成普通 Working，不用 setWorkingVisible(true) 抢占专用 loader。
- 实际 Pi 1.3.0 的公开 ExtensionAPI 只有 session_before_compact/session_compact/session_compact_failed，没有 compaction_start/end 或 summarization retry 事件；Embedding 的 AgentSession.subscribe 虽公开，普通 ExtensionContext 不提供当前 session，不能混为可用扩展 API。注册未声明事件在 JS 中被接纳但不派发，不可依赖。
- session_before_compact 晚于宿主开始（前置 handler 可延迟）；session_compact 早于宿主结束（后续 handler 可延迟）；failed 则晚于宿主清理。手动 too-small 有 start/end 却没有 before，二次 overflow 失败可有无 start 的 end。禁止仅用这三类扩展事件宣称精确原生起止。
- 公开 editor receiver 装饰已通过组件验证，可展示 Compacting 并保留宿主 spinner/cancel hint。用户已选择从本次 compaction indicator 首次交付计时，表示“原生提示出现后耗时”，不宣称操作精确开始；retry 后重建不重置。R3/AC7 已同步，不访问私有 session 或新增精确生命周期 seam。
- 压缩重试中可依据接收的 retry kind 保留原生提示，但 undefined 也用于 indicator 交接，不能每次 undefined 都结束压缩；后续完整产品接线需结合 session 成功/失败、当前 indicator 及 epoch 核验，不复活旧状态。
- 压缩开始时记录独立计时，暂停普通写入；结束后不能恢复一份旧显示字符串。自动压缩后真正新模型边界进入 Loading，空闲手动压缩完成清除；失败/取消按宿主后续真实事件处理，旧 session 回调必须被 epoch 拦截。
- 保留原生 retry、branchSummary 文案和 cancel hint。当前 Pi 1.3.0 的压缩/分支总结也有 summarization retry：原生 indicator 暂时替换为 retry，再重建 compaction/branchSummary。压缩生命周期和计时不因替换重置；retry 优先显示原生文案，不被 Asking 或 Compacting 抢占。普通 retry 的 extension 事件能力与顺序需核查；不能以延迟定时器强制复活 Working。实际宿主测试覆盖普通 retry、summarization retry、compaction->next turn 和 idle->manual compaction->idle。
- 当前本仓库没有其他 setWorkingMessage 写入者，但它不是 keyed API：接线/清理要说明独占边界，不能对未知后加载扩展承诺完整恢复。发生冲突或能力不符时保留原生展示并报告。
- 非 TUI 不装展示、不创建计时器，模型和工具行为不变。安装失败不能丢失现有编辑器。

## 清理与测试边界

所有 UI 写入、timer callback、prompt pairing 都检查 activation/epoch。真正 session replacement 重置状态，取消 replacement 不关闭当前 activation；reload reset UI 先于 shutdown 时清理不能重新安装旧 override。

确定性测试验证事件归并/时间曲线/清理；实际 SDK loader/editor 测试验证动画帧、颜色、宽度和宿主 setter 顺序；真实 TUI 验证另行授权与记录。组件模拟不称为 tmux/真实视觉验证，scripted provider 不称为在线模型验收。

## 风险与回滚

最大风险是公开颜色能力与连续 spinner 的冲突，其次是 Asking 配对、压缩专用展示能力与生命周期恢复。未通过门槛不进入功能交付。回退目标是保留原生 Working/Compacting context/其他专用状态和原编辑器；回滚只移除新增阶段接线，不能 reset 并行源码或修改外部包。
