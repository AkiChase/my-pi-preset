# 统一工具卡片与会话通知渲染

## 目标

在 `extensions/beautify/` 建立可复用的公共卡片骨架，使自有工具调用、后台通知、父会话 reply/notice 和 Trellis Check 报告使用一致的标题、正文、宽度降级、状态标记与预览规则。

统一的是**标题 + 正文**的呈现结构和公共行为，不是把所有工具的专用正文或业务语义压成一种样式。

## 授权与边界

- 用户已明确批准按本 PRD 和设计分阶段实施；当前只进入 S1。遇到设计边界、公共接口、范围扩大或无法安全适配的情况，必须暂停并向用户说明后再继续。
- 本授权不包含安装依赖或推送；按项目 workflow 在每个通过验证的阶段完成 scoped commit。
- Task Panel 由 `10-19-dispatch-task-panel-ux` 负责；本任务不修改其列表、详情、conversation、paging、布局或交互。
- 保留其他会话的未提交改动，尤其不修改 `extensions/task-ui/` 以及 agent source/conversation/paging 的相关文件。
- 不改变工具执行、权限、调度、wait、取消、消息投递、通知消费或 reply 匹配语义。

## 已确认的问题

| 位置 | 当前缺口 |
| --- | --- |
| `extensions/agent-tasks/src/index.ts:257-280,391-450` | 失败通知有 `error` 却只显示 `resultPreview`；无正常 result 时显示 `No output.`，隐藏真正失败原因。 |
| `extensions/agent-tasks/src/index.ts:1538-1673` | 顶层 `subagent_run` 混用 shared heading、本地 legacy renderer 和裸文本回退。 |
| `extensions/agent-tasks/src/nested-tools.ts:254-258,533-536` | 嵌套 agent/message 路径缺少一致的结果适配。 |
| `extensions/agent-tasks/src/index.ts:2417-2442` | workflow 的错误或缺 live task 路径退化为文本。 |
| `extensions/agent-tasks/src/ui/workflow-card.ts:255-376` | child 失败状态可见，但错误原因不一定可见。 |
| `extensions/process-tasks/index.ts:77-120` | process/monitor 通知使用独立旧样式。 |
| `extensions/agent-tasks/src/parent-delivery.ts` | reply/notice 有独立卡片；held message 也可追加到工具结果，易造成漏显示或重复显示。 |
| `extensions/beautify/tool-clock.ts` | 运行计时只接入 Bash，管理工具和通用兜底没有一致策略。 |

### 运行时事实与限制

- Pi 提供全局 `pi.registerToolRenderer((name, next) => …)`；`next()` 可得到下游完整 renderer 或 `undefined`，但公开接口没有语义化 title/body 拆分能力。
- `renderShell: "default"` 只表示宿主外框归属，不代表内容是宿主默认 renderer；不能据此安全拆分已有自定义 renderer。
- 宿主在工具执行结束后提供 `durationMs`，它表示 `.execute()` 耗时；运行中没有等价的实时 execution 时钟。
- 工具 resolver 不拦截 message/entry renderer、问卷弹窗或无扩展子会话；原生 `ctx.executeTool()` 嵌套调用不产生独立 transcript 工具行。

## 需求

### R1：公共卡片骨架

- 公共组件只有标题与正文，不强制固定详情区，也不自动插入 `Parameters` / `Output` 标题。
- 标题有身份、调用方提供的摘要、可选标记和可选统计的位置；正文可为文本或专用组件。
- 组件不硬编码只有 tool/agent 才能使用；工具调用、目标通知、reply/notice 和诊断报告通过各自适配数据接入。
- 不建立新的消息总线，不读取后端、不消费结果、不改变交付时序。

### R2：标题与摘要

- 单行优先；所有接入公共 factory 的工具使用相同宽度降级算法。
- 优先省略次要信息/展开提示，再缩短摘要；仍放不下时，标记与统计整体下移。极窄宽度可继续换行，不静默丢失关键状态或时间。
- 摘要由调用方决定：支持普通文本，或接受可用宽度、主题和展开状态的受约束摘要 renderer。调用方不能越界、占用标记区域或重复绘制标题。
- 完整参数不强制塞进标题；适配器可在展开正文组织参数、目标信息和输出。无专用适配的通用工具使用参数与结果兜底。

### R3：状态与时间

- 工具调用状态固定为 `Pending`、`Running`、`Completed`、`Failed`、`Cancelled`；`Cancelled` 仅凭可靠结构化证据判定。
- `wait` 是操作摘要；`background` 是请求/实际模式；目标状态不能冒充调用状态。
- 运行中从 `tool_execution_start` 显示实时 `elapsed`，表示已进入处理多久。
- 最终结果有宿主 `durationMs` 时显示 `execution`，表示 `.execute()` 耗时；没有 execute 的拒绝/校验/未知工具失败不伪造 execution 时间。
- agent/process/workflow 的 `runtime`、token、模式和目标状态属于目标信息，由适配器放入正文；不冒充工具 elapsed/execution。
- 历史工具卡片使用宿主已有 `durationMs`；缺失时不显示时间。不保存额外 call 时钟或 display sidecar。

### R4：正文、折叠与错误

- 折叠正文按当前宽度的实际文本显示行计算，最多 3 行；标题不计入，展开提示另占一行。
- 错误优先使用同一个 3 行预算；同一错误不重复展示。
- 展开显示完整可用正文，保留专用渲染；不得暗示能恢复工具/交付层已经截断的数据。
- 图片是文本行预算的例外，保留宿主现有图片显示规则，不截切图片或修改宿主。
- `error` 存在而正常 result 缺失时必须显示错误原因，不能仅显示 `No output.`。

### R5：通知、消息与聚合

- agent/workflow/process/monitor 通知、subagent reply/notice 和 Trellis Check 复用公共标题/正文组件。
- 单一业务对象可在标题显示精确业务标记，例如 `Turn limit reached`、`Stopped`、`Quiet`；公共层只处理 label/tone/布局，不新建业务状态枚举。
- 聚合消息不得选择任一成员状态冒充整体；成员状态在正文保留。
- agent 的模型分组交付在用户侧按成员显示独立卡片；每张成员卡独立适用三行预算，partial/仍在运行说明保留。
- monitor 保持实际交付粒度：已有合并 batch 显示为一张卡片，整体适用三行预算；未合并事件显示为独立卡片。UI 不重新拆包或重组。
- reply/notice 保留独立 entry 与 held 工具结果的既有双通道；当二者同时可见时允许正文重复，以避免新增 presentation metadata 或改变模型 content、wait、投递/消费语义。匹配 waiter reply 仍保留可见正文。
- Trellis Check 迁移为公共通知卡片，保留既有诊断校验、计数颜色、报告预算和省略说明；不迁移菜单/toast。

### R6：工具覆盖规则

- 自有工具和明确协作的工具直接调用 Beautify 导出的公共 self-shell factory，提供无标题正文和结构化显示数据；旧完整 renderer 不再嵌套，避免双标题和双 shell。
- 下游没有 renderer 的未知/动态工具，由全局 resolver 使用公共 self-shell 通用兜底。
- 下游提供任意 custom renderer 的未知外部工具完整原样委托；不按名称、`renderShell`、第一行或 ANSI 自动拆分。
- 第一版保留 Pi 宿主原生专用 renderer（`edit/write/read/ls/codemode` 等）原样，不引入私有结构依赖 seam。后续只有在宿主提供语义接口或存在安全协作 adapter 时再专项迁移。
- 保留外部工具、图片、鼠标、异步预览和专用内容的既有所有权；不修改外部包或宿主实现。

### R7：Workflow 范围

- 实时 workflow tool card 和既有通知使用各自已拥有的数据接入公共呈现。
- 不新增 CLI/history workflow entry 的终态展示快照，不保存返回值、暂停时间或 replay 信息，不承诺其与实时卡片信息量一致。
- 不改 workflow 控制、调度、恢复或 Task Panel source/history。

## 不在范围

- Task Panel、任务浏览器、conversation paging/summary/collapse、面板状态栏、布局、交互和跟随滚动。
- 问卷/权限弹窗、editor/widget/status/toast、`!bash`、隐藏模型提示和存储型 entry。
- 全部 HTML 导出统一；只验证宿主实际会调用扩展 renderer 的通道。
- isolated / `extensions:false` / headless 子会话的自动 UI 覆盖。
- 对未知 external custom renderer 或宿主原生专用 renderer 的强制视觉迁移。

## 验收标准

| ID | 可观察结果 |
| --- | --- |
| AC1 | 公共 factory 接入的工具、通知和消息使用标题+正文骨架，无强制空分区、双标题或双 shell；专用内容与交互保留。 |
| AC2 | 宽度不足时按同一规则缩短摘要并下移标记/统计；关键状态和时间不因长摘要静默丢失。 |
| AC3 | 运行中显示实时 `elapsed`；最终有 `durationMs` 时显示 `execution`；未执行和缺失历史值不伪造时间。 |
| AC4 | 调用状态、操作参数、目标 runtime/状态语义不混淆；停止、失败、turn-limit、静默提醒可区分。 |
| AC5 | 折叠正文最多 3 个实际文本行，错误使用同一预算；图片例外；展开与截断提示诚实。 |
| AC6 | 失败无 result 的通知显示 error；reply/notice 的独立 entry、held block、匹配 waiter reply 都不会漏显示；entry 与 held 工具结果同时可见时允许重复，以保持既有模型/交付语义。 |
| AC7 | agent 用户侧成员卡片与 monitor 实际 batch 粒度符合本 PRD；partial、overflow、manifest/stall/absent/resumed 等状态保留语义。 |
| AC8 | 未知无 renderer 工具使用通用公共卡片；未知 custom renderer 和宿主原生专用 renderer 不被破坏或强拆。 |
| AC9 | Trellis Check 使用公共通知卡片，诊断安全校验和报告预算保持。 |
| AC10 | 不修改 Task Panel、其他任务的未提交产品文件，执行/交付/消费语义保持不变。 |

## 规划状态

产品边界已经收敛，用户已批准按阶段实施。当前先执行 S1；每个阶段完成后先报告实际变更、验证结果和新发现的设计问题，再继续下一阶段。
