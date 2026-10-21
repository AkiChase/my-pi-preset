# Task Composition：任务管理与共享面板

Task composition 把命令进程、Monitor、子 Agent 和 workflow 放进同一个任务面板。底栏按 `shell`、`monitor`、`agent`、`workflow` 显示活动和排队数量，前台任务也会计入；父任务及其子任务不会重复算作独立工作。底栏还显示实际等待数量及配置的全局解除等待入口；未绑定快捷键时显示 `/task-detach`。等待与后台运行独立，所属子任务不等于主会话正在等待。没有活动、排队或等待任务时，摘要隐藏。

底部 Footer 的用量行之后通过 [Widget Display](widget-display.md) 紧接显示只读 Agent／workflow 根任务概览，不显示 Shell／Monitor，不展开子任务，也不接管输入或导航。每行优先显示任务描述，使用与面板一致的状态图标（starting／running 默认播放低频 spinner，关闭动画时使用静态 `◌`）；耗时与 `↓ tokens` 靠右排列。最多五个根任务，小终端减少行数并提示隐藏数量；极端拥挤时 Pi 仍可能裁剪概览或底栏，隐藏数量不保证始终可见。空态隐藏，终态短暂保留四秒。

概览使用根任务自身统计，不累加子任务。Agent tokens 包含 input、output、cacheWrite，不含 cacheRead；继续会话时 tokens 为累计值，耗时为本轮运行。Workflow 的统计可能稍有延迟。请保持 Widget Display 启用；没有共享展示入口时概览不显示，但底栏和 Task Panel 仍可使用。命令等待只由共享底栏／面板说明，没有独立命令提示。

## 常用入口

| 命令／按键 | 用途 |
| --- | --- |
| `/tasks` 或 `Shift+Down` | 打开 Task Panel |
| 空输入框中的 `Down` | 有可查看任务、输入框持有焦点且没有补全或浮层时打开面板 |
| `/task-detach` 或 `Ctrl+Shift+B` | 解除所有当前任务等待，执行继续 |
| `/agents-config` | 管理 Agent 类型（编辑、启用／禁用、导出内置类型、恢复默认、删除）和 Agent 设置 |
| `/agents-create` | 新建 Agent 类型（由模型生成或手动填写） |
| `/process-tasks-version` | 查看当前加载的进程扩展版本和路径 |
| `/process-tasks-config` | 查看进程配置的覆盖项及加载警告 |

`/task-detach` 的作用是“现在不等了”，不是停止任务。前台命令或 Agent 转后台时继续原来的执行，ID、进程和会话不变；正在等待后台结果时，则只结束这次等待。它能同时解除多个等待，不只是当前面板选中的一项。

普通消息提交仍由 Pi 排队或作为 steering 处理，不会自动让命令转后台。

## Task Panel

Task Panel 覆盖整个终端，列表上方是 Agents（含 workflow），下方是 Processes。使用一处选择浏览真实父子树；Enter 进入全屏详情，Esc 返回列表，再按 Esc 关闭。返回保留选择、滚动位置和收起状态。打开／关闭不会清空或重建输入框。

| 面板内按键 | 行为 |
| --- | --- |
| `↑↓`、`j`、`k` | 列表中选任务；详情中滚动 |
| `Enter` | 从列表进入所选任务详情；在运行中或排队中的 Agent 详情里打开消息输入框 |
| `←`、`→` | 列表中收起／展开组，或返回父行 |
| `Home`、`End` | 当前页面到开头／末尾 |
| `x` | 请求停止当前可停止的任务 |
| `p` | 暂停／继续所选 workflow |
| `s`、`r` | 跳过／重试所选 workflow 子 Agent |
| `c` | 复制所选任务的日志、会话或 worktree 路径 |
| `Esc` | 详情返回列表；列表关闭，既不停止任务，也不解除等待 |
| 全局解除等待快捷键 | 解除所有当前等待，执行继续，与选中任务无关 |

列表和详情都有常驻滚动条。Fullscreen 模式下滚轮只滚动正文，不改变选择；固定标题／底栏和边界处不会穿透到主对话。折叠行显示后代数量，折叠包含当前选择时先选中父行。

停止 workflow 会停止整个 run；停止子 Agent 会停止它及它所属的嵌套任务，不停止独立的兄弟任务。`c` 复制的是路径，不是正文，也不会把内容提交给模型。面板没有重跑、删除记录或清理文件的按键。

详情顶部是固定、限高的元数据摘要，包含任务名、模型／配置和有限路径信息。长值单行截断，不会随正文滚动；完整路径仍可用 `c` 复制。Conversation／Output 标题固定，中间只有一个独立滚动区域，包含 Messages 和对话／输出。底部始终显示所选任务的状态、名称、当前活动及可容纳的耗时／统计，再显示操作提示；紧终端优先保留正文、状态和操作，空间不足时操作提示缩为可用按键和全局解除等待快捷键。

首次进入详情显示最新消息。处于末尾时自动跟随新增内容；向上浏览后停止跟随，`End` 重新读取并跳到最新消息，而非仅跳到当前历史窗口末尾。Agent 对话向上到窗口顶部时加载更早一页，向下到历史窗口底部时加载更新一页；驻留窗口有上限，离开的历史可再次加载。会话已释放时从记录文件分页读取；记录变化、游标失效或不可读会明确提示，可用 `End` 重试或复制路径检查。

对话区分 User／Assistant，Assistant 正文按 Markdown 渲染。工具结果默认只预览最多 5 个视觉行；鼠标左键点击该条结果可单独展开／收起，展开也最多预览 40 个视觉行。没有键盘或全局展开入口。read、write、edit、bash 显示可用的路径、命令和统计；write 成功仅显示摘要，不回显写入正文。已知省略量会说明，来源未检查的额外内容只提示“additional content omitted”，不猜数量。

状态图标不只靠颜色区分：queued `○`、starting／running 活动指示、paused `Ⅱ`、completed `✓`、failed `✕`、stopped `■`，文字状态始终保留。概览有可显示的活动任务、或面板打开且有活动任务时播放轻量动画，可通过配置关闭为静态 `◌`。实际等待次数是独立的等待信息，不表示 Agent 有 waiting 执行状态。停止等操作通过状态变化体现，不额外插入提示行。

消息输入框打开后，所有按键都输入到框内：Enter 发送给该 Agent，Esc 取消。消息会在 Agent 当前工具执行完后送达；workflow 子 Agent 不接受直接消息。暂停 workflow 后，已在运行的 Agent 会继续完成，只是不再启动新的；跳过让该 Agent 的调用返回空结果，重试只对运行中的 Agent 有效。

命令输出是有长度限制的预览，最多 16K 字符，文件通常读取尾部；面板会标明范围和省略量。滚动只覆盖这段预览，更多内容请复制路径查看，或让模型用结果工具读取。终态任务通常在整体完成四秒后隐藏，正在查看的最终预览保留到换选项或关闭面板。小终端会压缩固定信息和正文，可放大终端以查看更多内容。

面板只在交互终端中可用；非交互模式没有面板预览。

## 命令进程

这些是模型可调用的工具，不是同名斜杠命令。可以直接告诉模型：“把这条命令放后台运行”“读取这个任务从头开始的日志”或“等它完成”。

| 工具 | 常用参数及行为 |
| --- | --- |
| `bash` | `command`执行有限命令；`background_after_seconds: -1`等待完成或手动解除等待，`0`立即后台，正数为交互模式等待后转后台秒数，不是终止期限；`description`必须提供字符串，可为空 |
| `process_manage` | 查看或停止 Bash／Monitor 任务 |
| `monitor` | 持续观察命令或 WebSocket，详见 [Monitor](monitor.md) |

`background_after_seconds`必须显式提供：`-1`等待完成或手动解除等待，`0`立即后台，正数设置交互等待阈值（允许小数，最大`2147483.647`）。非交互模式只接受`-1`或`0`。转后台只结束等待，不终止命令。

主对话bash工具块优先显示非空description，展开保留完整命令。实时`handling`计时从工具处理开始到返回，包含准备/校验，不等同进程运行时长；安静调用也更新，返回后冻结。Workflow折叠仅整体摘要，展开查看阶段、子任务统计和日志。

前台完成通过工具结果返回；后台完成自动通知，最终结果已被读取或等待取得时不会重复通知。后台启动结果只表示已启动，不代表命令成功完成。后台任务仍属于当前会话，会话关闭时停止。想给持续观察设置总截止，用 Monitor 的 `timeout_ms`。

单独的 `sleep N` 等固定等待可能被拒绝。等已有任务完成用 `process_manage` 的 `wait`；等某个条件应让检查循环在条件满足时退出，而不是先睡很久。

### 查看与停止进程／观察任务

`bash` 和 `monitor` 返回 `task_id`。`process_manage` 用这个 ID 管理本次任务；这些运行任务不是 Trellis 规划任务。

| action | 参数与行为 |
| --- | --- |
| list / stats | 可用 task_type 筛选 bash/monitor；分别查看任务或保留记录与累计统计 |
| status / stop | task_id 必填；查看状态或请求停止 |
| output | task_id 必填；offset/limit 指定日志字节页，默认尾页，offset:0 从头读 |
| wait | task_id 必填；等待整个任务结束，limit 可限定最后日志页 |
| search | pattern 必填正则；可带 task_id/task_type、ignore_case、context |

参数只能用于对应动作。管理进程不需要 run_id，不接受 Agent 对话详情参数。日志失败明确报错，不会当作成功的空日志；搜索不消费结果。

Monitor 的 wait 等整个观察结束，不是下一条事件。解除或取消等待不会停止执行；stop 才请求停止。成功取得终态 output/wait 会标记已报告，避免重复通知；status/list 不消费结果。停止返回时执行可能仍在清理。

会话切换、重载或退出会停止所属任务，不自动恢复。日志默认 `/tmp/pi-bg/<jobId>.log`，记录回收不会删除日志；系统可能清理临时目录，长期保留请配置 logDir。

## 子 Agent 与 workflow

可以让模型新建子 Agent，或继续一个已完成或退出中断 Agent 的会话。每个 Agent 都有完整 `agent_id`；后台启动先返回该 ID，完成后通知；前台直接等待结果。Pi 重启后，父会话会收到直属中断子 Agent 的通知，可用同一 `agent_id` 恢复其 transcript。恢复会话沿用原类型与设置；子 Agent 恢复自己的孩子时固定前台。

Agent 文件配置优先于模型的调用请求；未指定设置时沿用配置/默认值，请求被覆盖时结果会说明实际值。可以让模型给运行中的 Agent 发指示，或在它完成后继续同一会话。queued 表示等待会话初始化，sent 表示已提交，均不保证已读取或处理。

workflow 用脚本编排多步工作，可以调用 Agent，也可以不启动 Agent。你可以提供脚本、文件路径或已保存的 workflow 名称。重放可以沿用原脚本或使用替代脚本；每次启动或重放都产生独立的执行标识。暂停、继续、跳过和重试在 Task Panel 中操作。

### 中途消息与提问

运行中的父 Agent 可以向其直属子 Agent 发送普通指示，也可以附带一个需要答复的问题。子 Agent 的重要发现会立即显示为对话卡片；运行中的 Agent 行会显示最近一条消息摘要，详情页的 **Messages** 区块保留本次执行的提问、答复、通知和状态。

提问可选择立即返回或等待子 Agent 的答复。选择等待时，收到的答复会直接附在本次工具结果中；等待期间的其他消息也随结果一并返回，不会重复插入主对话。解除等待不会撤回问题或停止子 Agent，之后到达的答复会照常显示和送达。子 Agent 结束、停止或会话关闭而未答复时，结果会说明原因；可以通过恢复该 Agent 继续处理。

嵌套子 Agent 同样支持中途提问和答复，但消息只送达其直属父 Agent，不会唤醒根会话或额外生成根会话卡片。workflow 启动的子 Agent 不支持这项能力。

### 委派执行管理

子 Agent 的管理操作使用完整 `agent_id`；workflow 仍使用自己的 execution ID。停止或等待已退出中断的 Agent 会明确返回中断状态；先恢复它才会创建新的运行。关闭面板或解除等待不会停止正在运行的任务。

在交互输入框中可使用显式 Agent 命名空间：

```text
@agent:create:Explore 检查 registry
@agent:resume:explore-0 继续检查
```

`create` 后是已注册的 Agent 类型；`resume` 后是直属父级范围内的规范化 `type-index` 简写（例如 `general-purpose` 使用 `general-purpose-0`）。补全会显示并插入该简写。其他普通 `@…` 输入仍由 Pi 的文件补全和原有行为处理。

## 后台任务提醒

主 Agent 在长对话中可能忘记还有后台工作。有未结束的后台 Agent、workflow、命令或 Monitor 时，每隔若干次模型请求（默认 8 次，工具调用后的继续回答也算），会在请求前向对话追加一条只给模型看的简短提醒，列出类型、可用于管理工具的 ID、短名称和已运行时间。上下文压缩后也会补一条。

- 提醒默认不显示在主对话中，不会唤醒空闲的模型，也不会额外发起请求。
- 它只用于防遗忘，不是实时任务列表；模型需要当前状态时仍会用对应的管理工具查询。完成结果照常通过完成通知送达。
- 不包含完整命令、委派内容或日志；命令没有描述时只显示类型名。任务较多时只列一部分并标明省略数量。
- 已写入的提醒保留在历史中，不会被改写。
- 限制：一轮工具调用中途发生自动压缩时，压缩后的提醒会晚一次请求到达。

间隔在 `task-ui.json` 的 `backgroundReminderInterval` 中配置，见[面板与快捷键](#面板与快捷键)。

## 配置

配置文件默认位于 `~/.pi/agent`，设置了 `PI_CODING_AGENT_DIR` 时跟随这个目录。手改配置后在 Pi 中 `/reload`；影响 Agent 功能开关的设置建议重启 Pi。

### 面板与快捷键

`task-ui.json` 可以不创建，默认如下：

```json
{
  "shortcutBackground": ["ctrl+shift+b"],
  "shortcutTaskPanel": ["shift+down"],
  "downOpener": true,
  "animations": true,
  "backgroundReminderInterval": 8
}
```

两个快捷键接受单个键名、数组或 `"off"`。`downOpener: false` 只关闭空输入框 Down 入口，不影响 `/tasks` 或显式面板快捷键。要改扩展快捷键，在这里改，不是在 Pi 的 `keybindings.json` 里改。

`backgroundReminderInterval` 是[后台任务提醒](#后台任务提醒)的模型请求间隔，接受非负整数；`0` 关闭周期提醒，压缩后的提醒仍保留。无效值会记录警告并使用默认值 `8`。

`animations: false` 关闭概览和 Task Panel 的活动指示动画，仍保留静态图标和状态文字；默认 `true`，无效值会警告并回退默认。

空输入框 Down 不可用时仍可用 `/tasks` 或 `Shift+Down`；第三方编辑器不一定支持这个增强。

### 进程

`process-tasks.json` 的优先级是有效环境变量 > 文件 > 默认值。环境变量名为 `PROCESS_TASKS_` 加大写蛇形键名，如 `timeoutMs` 对应 `PROCESS_TASKS_TIMEOUT_MS`。无效值或未知键会记录警告，可用 `/process-tasks-config` 查看。

| 键 | 默认值 | 用途 |
| --- | --- | --- |
| `timeoutMs` | `120000` | 交互模式前台命令自动转后台的默认等待时间，不是运行期限 |
| `logDir` | `"/tmp/pi-bg"` | 日志目录，支持开头的 `~` |
| `maxConcurrentJobs` | `16` | 同时运行的进程任务上限，前台和 Monitor 也占用 |
| `maxLogBytes` | `104857600` | 周期检查日志，超量时停止任务；不是硬写入上限 |
| `outputPreviewChars` | `12000` | 日志输出预览预算，Monitor 也使用 |
| `failureTailLines` | `20` | 失败通知的日志尾部行数 |
| `failureTailChars` | `2000` | 失败通知尾部长度限制 |
| `failureTailLinesShown` | `5` | 终端摘要下展示的尾部行数，`0` 关闭 |
| `stallCheckIntervalMs` | `5000` | 日志超量和疑似等待输入的检查间隔 |
| `stallThresholdMs` | `45000` | 日志无增长且尾部像交互提示时提醒 |
| `stallTailBytes` | `1024` | 判断交互提示时读取的尾部字节数 |
| `monitorFlushMs` | `30000` | Monitor 普通进度通知间隔 |
| `monitorMaxLinesPerEvent` | `50` | 每个 Monitor 来源的输出预览行数上限 |

### Agent

全局 `agent-tasks.json` 提供默认值，项目 `.pi/agent-tasks.json` 覆盖；`/agents-config` 的 Settings 写项目文件。自定义类型放全局 `agents/*.md` 或项目 `.pi/agents/*.md`，同名项目类型优先。

常用设置有 `backgroundByDefault`（默认 `true`）、`maxConcurrent`（后台默认 `10`）、`maxConcurrentForeground`（默认 `0`，不限制）、`defaultMaxTurns`（默认不限制）、`maxSubagentDepth`（默认 `2`）。`worktreeIsolation: false` 关闭临时 worktree 创建；这与面板查看 worktree 路径是两回事。
