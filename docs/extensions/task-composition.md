# Task Composition：任务管理与共享面板

Task composition 把命令进程、Monitor、子 Agent 和 workflow 放进同一个任务面板。底栏按 `shell`、`monitor`、`agent`、`workflow` 显示活动和排队数量，前台任务也会计入；父任务及其子任务不会重复算作独立工作。没有活动或排队任务时，摘要隐藏。

前台命令超过短暂等待窗口后，编辑器下方会显示命令、已运行时间和转后台快捷键提示；所有前台命令结束或转后台后提示消失。此提示通过内置 [Widget Display](widget-display.md) 展示，请保持它启用；任务底栏和 Task Panel 不受此展示开关影响。

## 常用入口

| 命令／按键 | 用途 |
| --- | --- |
| `/tasks` 或 `Shift+Down` | 打开 Task Panel |
| 空输入框中的 `Down` | 有可查看任务、输入框持有焦点且没有补全或浮层时打开面板 |
| `/bg` 或 `Ctrl+Shift+B` | 解除所有当前任务等待，执行继续 |
| `/agents` | 管理 Agent 类型、定时任务、workflow 和设置 |
| `/process-tasks-version` | 查看当前加载的进程扩展版本和路径 |
| `/process-tasks-config` | 查看进程配置的覆盖项及加载警告 |

`/bg` 的作用是“现在不等了”，不是停止任务。前台命令或 Agent 转后台时继续原来的执行，ID、进程和会话不变；正在等待后台结果时，则只结束这次等待。它能同时解除多个等待，不只是当前面板选中的一项。

普通消息提交仍由 Pi 排队或作为 steering 处理，不会自动让命令转后台。

## Task Panel

当前面板是居中的双栏浮层：左侧选任务，右侧立即显示日志、对话或 workflow 进度，不需要按 Enter 才能查看详情。workflow 默认展开，刷新会保留用户的收起选择。

| 面板内按键 | 行为 |
| --- | --- |
| `↑↓`、`j`、`k` | 列表焦点下选任务；详情焦点下滚动 |
| `Tab`、`Shift+Tab` | 切换列表与详情焦点 |
| `←`、`→` | 列表中收起／展开组，或返回父行 |
| `PageUp`、`PageDown` | 当前焦点跨页移动 |
| `Home`、`End` | 当前焦点到开头／末尾 |
| `x` | 请求停止当前可停止的任务 |
| `c` | 复制所选任务的日志、会话或 worktree 路径 |
| `Esc` | 关闭面板，既不停止任务，也不解除等待 |
| 转后台快捷键 | 解除所有当前等待，执行继续 |

停止 workflow 会停止整个 run；停止子 Agent 会停止它及它所属的嵌套任务，不停止独立的兄弟任务。`c` 复制的是路径，不是正文，也不会把内容提交给模型。面板没有重跑、删除记录或清理文件的按键。

详情是有长度限制的预览，最多 16K 字符，文件通常读取尾部；面板会标明范围和省略量。滚动只覆盖这段预览，更多内容请复制路径查看，或让模型用结果工具读取。终态任务通常在整体完成四秒后隐藏，正在查看的最终预览保留到换选项或关闭面板。窗口过小时会提示放大终端。

面板只在交互终端中可用；非交互模式可以用 `task_manage` 查询四类运行任务。

## 命令进程

这些是模型可调用的工具，不是同名斜杠命令。可以直接告诉模型：“把这条命令放后台运行”“读取这个任务从头开始的日志”或“等它完成”。

| 工具 | 常用参数及行为 |
| --- | --- |
| `bash` | `command` 执行有限命令；默认前台等待，`run_in_background: true` 立即后台；`background_after_seconds` 是交互模式前台等待后转后台的秒数，不是终止期限，不能与立即后台组合；`description` 是简短说明 |
| `task_manage` | `action` 选 `list`、`status`、`output`、`wait`、`stop`、`search` 或 `stats`，统一管理 Bash、Monitor、子 Agent 和 workflow |
| `monitor` | 持续观察命令或 WebSocket，详见 [Monitor](monitor.md) |

交互模式下，前台命令默认等待 120 秒后转后台，可用 `background_after_seconds` 设置正数秒数（允许小数，最大 `2147483.647`）。这个阈值只解除前台等待，命令继续运行，不会终止命令。非交互模式默认等前台命令完成，显式传入该参数会在启动前报错。立即后台无需等待阈值。

前台完成通过工具结果返回；后台完成自动通知，最终结果已被读取或等待取得时不会重复通知。后台启动结果只表示已启动，不代表命令成功完成。后台任务仍属于当前会话，会话关闭时停止。想给持续观察设置总截止，用 Monitor 的 `timeout_ms`。

单独的 `sleep N` 等固定等待可能被拒绝。等已有任务完成用 `task_manage` 的 `wait`；等某个条件应让检查循环在条件满足时退出，而不是先睡很久。

### 查看与停止运行任务

启动结果会给出 `task_id`、`run_id` 和 `task_type`。管理指定任务时传 `task_id`；传入 `run_id` 可以锁定这一轮执行，旧轮次会被拒绝，不会误操作继续后的新轮次。这里的运行任务不是 Trellis 的规划任务。

日志文件已丢失或不可读时，搜索返回明确错误，不会把它算作“没有匹配”；全局搜索有部分日志失败时会标明结果不完整，并保留可读日志中的匹配。

| `action` | 行为与参数 |
| --- | --- |
| `list` | 列出当前会话可见任务，包括后端仍保留的终态；可用 `task_type` 限定为 `bash`、`monitor`、`subagent` 或 `workflow` |
| `status` | 带 `task_id` 查看状态、能力和可用路径；不消费结果 |
| `output` | 带 `task_id` 读取本次输出；子 Agent 终态返回最终回答，workflow 返回脚本结果或错误 |
| `wait` | 带 `task_id` 等整个任务结束并返回结果；Monitor 等的是监听结束，不是下一条事件 |
| `stop` | 带 `task_id` 请求停止执行；解除或取消结果等待不会执行这个动作 |
| `search` | 搜索 Bash／Monitor 日志，必须带正则 `pattern`；可用 `task_id` 或 `task_type` 限定范围，`ignore_case` 忽略大小写，`context` 指定前后行数 |
| `stats` | 查看进程累计统计与当前任务快照，可用 `task_type` 限定范围；不同类型的统计口径会标明 |

Bash／Monitor 的 `output` 默认读尾页，`offset: 0` 从头读，`limit` 限定字节数；根据返回范围继续翻页。`wait` 可用 `limit` 限定最后返回的日志页。字节边界可能把中文字符切开。日志搜索每个任务最多预览 20 条匹配行，长行也会截短。子 Agent 的 `output`／`wait` 可用 `verbose: true` 返回格式化对话；它不是未经截短的原始 trace。分页参数不能用在子 Agent／workflow，日志搜索也不支持这两类。

`status` 和 `list` 不消费结果；正常取得终态输出或等待结果会标记已报告，避免重复完成通知。`/bg` 或取消本次结果等待只解除等待，目标继续运行，之后仍可以查询。

主会话 Esc 取消仍在前台执行的 Bash 或 Agent 时，会停止对应执行。手动转后台后，前台取消不影响该任务。后台完成通常通过通知报告；结果已由工具返回时不会重复报告，取消结果等待后仍可收到完成通知。

会话切换、重载或退出时会停止当前任务，不会自动恢复。停止是请求，不能保证不响应取消的第三方模型请求立即结束。

日志默认在 `/tmp/pi-bg/<jobId>.log`，扩展不会主动删除。进程终态记录保留约十分钟、每分钟检查回收，回收后按 ID 查询会报未知任务，但日志仍在。系统可能清理 `/tmp`，需要长期保留时换一个 `logDir` 并自行管理文件。

## 子 Agent 与 workflow

`subagent_run` 把任务交给独立会话，默认后台启动并返回任务身份；需要直接等待时用 `run_in_background: false`。新任务常用 `prompt`、`description`、`subagent_type`，可指定 `name` 方便识别。类型文件里的设置会优先于调用参数。

`task_manage` 用 `task_id` 查询子 Agent；`action: "output"` 读取当前输出或最终回答，`action: "wait"` 等到完成，`verbose: true` 包含格式化对话。`subagent_message` 用 `agent_id` 和 `message` 给运行中的 Agent 发新指示。任务尚在运行时不能 resume；完成后可用 `subagent_run` 的 `resume` 参数继续同一会话，任务 ID 保持不变，新轮次返回新的 `run_id`。

子会话只能管理自己的命令／Monitor 和权限允许的嵌套 Agent，不能读取或控制主会话及兄弟会话的任务。关闭扩展加载但允许嵌套代理时，仍可使用仅管理所属嵌套代理的入口，不会因此恢复本地进程扩展；明确禁用管理能力时，不允许启动无法收集结果的后台嵌套任务。继续同一子会话后，管理入口跟随合法新轮次，旧等待不会接管新轮次。主会话列表可显示子任务关系，但可见不等于可直接操作；workflow 整体管理仍通过它的任务身份进行。

输入 `@handle 消息` 可以定向联系 Agent。默认 `agentMentions: "model"` 下，启动新 Agent 会用当前模型和对话上下文在临时会话中后台生成派发请求，不增加可见主会话回合，但会额外调用模型。运行中的消息和已完成任务的继续则直接处理。`"direct"` 直接启动新任务，`"off"` 关闭此入口。

`subagent_workflow` 用于运行多阶段或动态数量的 Agent 编排，后台启动后通知结果；`task_manage` 可以查询、等待或请求停止整个 workflow。`/agents` 继续管理相应运行和定时任务，菜单中的暂停、继续、跳过和重试不属于 `task_manage` 动作。定时定义本身不是运行任务，触发后产生的 Agent 才有运行任务身份。

完成通知发送失败时，会显示简短警告；没有 UI 时输出简短日志，结果仍可通过 `task_manage` 的 `output` 或 `wait` 获取，不自动重发。组内手动停止的 Agent 不发送自己的完成通知，也不会让已经完成的兄弟任务继续等它退出。

轮次上限由用户设置 `defaultMaxTurns` 或 Agent 类型文件中的 `max_turns`，不由模型的工具调用参数决定。`0` 表示无限制；达到软上限后有收尾宽限，超出宽限才中止，部分结果不能当成完整完成。

## 配置

配置文件默认位于 `~/.pi/agent`，设置了 `PI_CODING_AGENT_DIR` 时跟随这个目录。手改配置后在 Pi 中 `/reload`；影响 Agent 工具参数或开关的设置建议重启 Pi。

### 面板与快捷键

`task-ui.json` 可以不创建，默认如下：

```json
{
  "shortcutBackground": ["ctrl+shift+b"],
  "shortcutTaskPanel": ["shift+down"],
  "downOpener": true
}
```

两个快捷键接受单个键名、数组或 `"off"`。`downOpener: false` 只关闭空输入框 Down 入口，不影响 `/tasks` 或显式面板快捷键。要改扩展快捷键，在这里改，不是在 Pi 的 `keybindings.json` 里改。

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

全局 `agent-tasks.json` 提供默认值，项目 `.pi/agent-tasks.json` 覆盖；`/agents` 的 Settings 写项目文件。自定义类型放全局 `agents/*.md` 或项目 `.pi/agents/*.md`，同名项目类型优先。

常用设置有 `backgroundByDefault`（默认 `true`）、`maxConcurrent`（后台默认 `10`）、`maxConcurrentForeground`（默认 `0`，不限制）、`defaultMaxTurns`（默认不限制）、`maxSubagentDepth`（默认 `2`）。`worktreeIsolation: false` 关闭临时 worktree 创建；这与面板查看 worktree 路径是两回事。
