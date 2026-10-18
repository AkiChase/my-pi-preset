# 输入框阶段状态与加载动画

## 目标

让输入框上的忙碌提示回答“主会话现在处于哪个阶段”，明确区分模型尚未返回内容、模型生成、工具处理、等待用户操作和压缩上下文；保持一个指示符、一个状态单词和阶段耗时，不增加状态行或重复工具详情。

## 授权与状态

- 用户已认可下述展示设计，并明确要求“创建一个 task”。本轮授权为建任务与保存规划，不据此启动产品实施。
- 用户随后批准补充 Compacting 规划：压缩上下文纳入统一阶段展示，不再仅以“不覆盖原生提示”处理；仍不授权产品实施。
- 用户随后认可启动前审查结论，批准更新本任务规划并执行隔离的技术验证；该授权不包含产品实施、start、提交或真实交互式 TUI 验收。
- 用户在启动前验证后确认两项口径：输入框被问题 UI 替换时保留原生问题 UI，不要求离屏 Asking；Compacting 从原生压缩提示首次交付时计时，不宣称精确操作起点。该确认仍不授权产品实施。
- 任务保持 planning，使用 `create --no-start`，本会话不绑定任务。未授权安装、依赖获取、个人配置同步、reload、push 或归档。
- 用户已明确批准在 Beautify 开始产品实施：包含本任务代码、测试、功能文档、独立审核及通过验证后的 scoped 本地提交；不包括安装、个人同步/reload、push、归档或真实交互式 TUI。

## 已确认的背景

- 当前入口是 `extensions/beautify.ts`，不是 standalone Pretty。`extensions/beautify/editor/owner.ts:22` 保留原生 embedded working status；`appearance.ts` 只装饰原生 render/top-border/padding，不维护阶段。
- 当前安装 Pi 的 `dist/modes/interactive/interactive-mode.js` 在 turn_start 显示 Working、agent_end 清理；message_update 和 tool_execution_start/end 不改变其阶段文案。正文 Thinking 标签与边框状态不是同一机制。
- 当前安装 `pi-agent-core/dist/agent-loop.js:141-174,260-329,366-460`：先等待完整 assistant stream，随后处理本次响应中的工具批次；toolcall_end 只是消息更新，不立即执行工具。默认并行，全局 sequential 或批内工具声明 sequential 时整批串行；批次全部结束后才进入后续模型请求。token-limit 截断响应中的工具不会实际执行。
- `extensions/task-ui/coordinator.ts` 已有等待租约、waitCount 与订阅；后台任务状态不等于主会话被其阻塞。`task-ui/model.ts` 的底栏主要显示 active/queued，详细工具信息由工具卡片及 Task Panel 承担。
- 当前问卷意图识别优先核验 `rpiv:ask-user:blocked` 的明确等待生命周期；`rpiv:ask-user:prompt` 只是辅助标签，不据此猜测 custom 面板是否为问题。编辑器监听不依赖 Blocked Signal 的终端宿主开关。
- 当前 owning 用户文档为 `docs/extensions/beautify.md`；无需等待其他任务交付，启动时协调共享文件。
- 原生 `pi-tui/dist/components/loader.js:2-3,38-61` 使用十帧盲文 spinner、80ms 间隔；setMessage 更新显示，setIndicator 会重置帧并重启动画。`pi-coding-agent/dist/modes/interactive/components/status-indicator.js` 负责原生 working/retry/compaction/branchSummary。
- 这些安装目录证据仅代表分析时的宿主版本，实施前须核验；没有修改 SDK。Claude Code 的实际时长配色规则未核实，本方案不是复刻声明。

## 需求

### R1 五种可见阶段

| 单词 | 可观察含义 | 基础色 | 指示符与耗时 |
| --- | --- | --- | --- |
| Loading | 主会话进入模型阶段，尚未观察到生成内容 | 冷蓝 | 原生 spinner，阶段耗时 |
| Brewing | 正在生成 reasoning、文本或工具调用参数 | 紫色 | 原生 spinner，阶段耗时 |
| Tooling | 正在处理工具调用，主会话等待其返回 | 青色 | 原生 spinner，阶段耗时 |
| Asking | 需要用户回答或确认 | 琥珀色 | 静态 ◇，不计时 |
| Compacting | 主会话正在压缩上下文 | 主题中性色，不表示错误 | 原生 spinner，本次压缩耗时 |

- 不独立展示 Thinking、Preparing tool call、响应头接收、工具校验等细分状态。
- Loading 不声称连接故障或服务端没有思考；HTTP 响应头、心跳不是生成内容。
- Tooling 不声称工具卡死，也不保证已进入实际 execute；工具准备、校验和执行可属于同一阶段。
- Asking 只表达需回答/确认的交互，不把浏览 Task Panel 等普通 custom UI 一律当成用户阻塞。仅原输入框仍可见时展示；标准 dialog 或 inline 问卷替换输入框时保留原生问题 UI，不新增行、不改变问题布局，不要求离屏边框可见。
- Compacting 由实际主会话压缩生命周期驱动，覆盖手动与自动压缩；压缩内部模型请求不得触发 Loading/Brewing。不能凭 token 数、busy 或 provider 请求猜测正在压缩。
- 正常结束清除提示，不保留 Done；起始准备/短暂交接期间不得虚构生成或工具执行。

### R2 唯一紧凑展示

```text
── ⠴ Loading · 8s ─────────────────
── ⠹ Brewing · 12s ────────────────
── ⠦ Tooling · 24s ────────────────
── ◇ Asking ──────────────────────
── ⠹ Compacting · 12s ────────────
```

- 沿用现有输入框边框位置，不新增 widget、状态行或第二个 spinner。
- 不显示 bash 等工具名，不显示 pending 数量或等待任务名称；具体信息留在工具卡片/Task Panel。
- 仅状态词与指示符使用阶段色；耗时保持次要色，不改变整个输入框边框及其原生 thinking-level 语义。
- 宽度不足优先省略耗时，保留可辨认状态词；极窄宽度遵守原生 spinner-only 降级，任何一行不得超宽。

### R3 时间与动画

- 复用原生十帧、80ms 旋转机制，不新增动画引擎，不因等待变长而加速或闪烁。
- 耗时属于当前阶段，阶段切换重置；同阶段 token 更新、工具数减少不重置。
- 0–10 秒采用柔和基础色，10–30 秒有限渐进增强，30 秒后保持上限；不能因耗时长自动变黄/红或标成错误。
- Asking 固定静态琥珀色，不显示耗时，不随时间升级。
- Compacting 的耗时自本次原生压缩 indicator 首次交付到编辑器计起，表示提示出现后的持续时间，不声称精确操作起点；重复事件及 retry 后重建 indicator 不重置。沿用有界增强规则，不转成错误色，不加速 spinner。
- 尽量保持旋转连续；不得每秒调用 setWorkingIndicator 导致帧反复归零。阶段切换必要的原生配置切换与连续配色方案需在实施前完成技术验证，不能静默绕过公开接口限制。
- 颜色在暗色/亮色主题下可读；文字本身足以辨认阶段，不依赖颜色才能理解。

### R4 准确性与生命周期

- 仅主会话模型事件驱动 Loading/Brewing，后台 Agent 或工具内嵌模型请求不得冒充主会话生成。
- 按顶层 toolCallId 跟踪工具处理，嵌套事件不重复计数；某个并行工具结束不能提前离开 Tooling。
- 工具批次结束不立即宣称 Brewing；在后续模型阶段开始后进入 Loading，观察生成事件再进入 Brewing。
- 普通 assistant message_end 不等于开始工具执行；toolcall_end 不等于执行。
- 用户交互结束后恢复真实底层阶段，防止错误恢复旧状态。
- 压缩期间统一展示 Compacting，同时保留原生压缩取消提示与专用生命周期。成功、失败或取消后根据最新真实事件恢复或清除，不无条件恢复压缩前的旧阶段；空闲时手动压缩也需显示并在结束后清理。
- 保留原生 Retry/Branch Summary 及取消提示，不覆盖专用状态。取消、失败、真实会话切换、reload、shutdown 后无旧文案或计时器泄漏；取消切换不破坏现有会话。压缩专用 indicator 的公开展示接线实施前核验，能力不足先报告并保留原生 Compacting context 提示，不强行创建 Working loader。
- 保持编辑器实例、history、undo、paste、IME、focus 和鼠标行为，不读取编辑器私有状态，不修改工具执行/模型结果。

## 验收标准

- [ ] AC1 / R1：无生成内容时 Loading，reasoning/text/toolcall stream 均 Brewing；完整 stream 结束后才可能进入 Tooling；最终回答结束清除。
- [ ] AC2 / R1,R4：并行、串行、嵌套、工具拒绝/错误/截断不产生错误阶段；一个工具先返回不宣称模型已继续。
- [ ] AC3 / R1,R4：需要回答/确认且原输入框可见时 Asking 静态无耗时；问题 UI 替换输入框时保留原生交互，不要求离屏 Asking；结束后恢复真实阶段，浏览面板不误报。
- [ ] AC4 / R2：仅原有边框显示一个 spinner/静态标记、一个单词、可选耗时；无工具名、pending 数量和新增行。
- [ ] AC5 / R3：阶段计时准确，事件重复不重置；配色按 10/30 秒有界增强；不变成错误色，不加速/闪烁，不周期性重置 spinner。
- [ ] AC6 / R2,R3：暗/亮主题、窄宽/resize、隐藏输入行标签与原生边框颜色兼容。
- [ ] AC7 / R1,R4：手动/自动压缩显示 Compacting，耗时从本次原生提示首次交付计起，retry 替换/重复不重置；保留取消提示。内部模型流不误报 Loading/Brewing，成功/失败/取消后按真实边界恢复或清除，空闲手动压缩结束不残留。Retry/Branch Summary 保留；切换及 reload/shutdown 清理验证；后台或嵌套模型流不污染主阶段。
- [ ] AC8 / R4：实际宿主 editor handoff/history/undo/focus 回归通过；真实 TUI 验证与模拟测试明确区分。
- [ ] AC9：功能文档写入根目录 docs/ 的中文 owning 文档，不在 spec 新增功能章节；记录实际验证命令及未验证项。

## 不在范围内

- 改变 stream/tool 执行顺序、提前执行生成完的工具、修改 SDK、独立动画框架。
- Task Panel/底栏重设计、后台任务管理语义、删除现有 process-tasks bg-hint；这些属于其他任务。
- 显示具体工具/任务列表、随机状态词、卡死判断、网络故障诊断、完整 tracing。
- 修改外部 Claude Code、个人安装/同步/reload、依赖获取、push 或生命周期收尾。

## 规划收敛

Pi 1.3.0 启动前核验确认公开 editor indicator 装饰可行。用户已确认 Asking 仅在原输入框仍可见时展示、问题占位保留原生 UI，以及 Compacting 从原生提示首次交付计时；上述口径已更新对应需求和 AC3/AC7。启动前可行性已收敛，无待用户产品决策；后续完整 controller 的生命周期/所有权/清理与真实 TUI 验收仍需实施验证。任务仍 planning，产品实施需明确批准。
