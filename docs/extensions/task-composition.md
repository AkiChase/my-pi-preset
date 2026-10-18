# Task Composition：任务管理与共享面板

Task composition 把命令进程、Monitor、子 Agent 和 workflow 放进同一个任务面板。底栏按 `shell`、`monitor`、`agent`、`workflow` 显示活动和排队数量，前台任务也会计入；父任务及其子任务不会重复算作独立工作。没有活动或排队任务时，摘要隐藏。

前台命令超过短暂等待窗口后，编辑器下方会显示命令、已运行时间和转后台快捷键提示；所有前台命令结束或转后台后提示消失。此提示通过内置 [Widget Display](widget-display.md) 展示，请保持它启用；任务底栏和 Task Panel 不受此展示开关影响。

## 常用入口

| 命令／按键 | 用途 |
| --- | --- |
| `/tasks` 或 `Shift+Down` | 打开 Task Panel |
| 空输入框中的 `Down` | 有可查看任务、输入框持有焦点且没有补全或浮层时打开面板 |
| `/task-detach` 或 `Ctrl+Shift+B` | 解除所有当前任务等待，执行继续 |
| `/agents` | 管理 Agent 类型、定时任务、workflow 和设置 |
| `/process-tasks-version` | 查看当前加载的进程扩展版本和路径 |
| `/process-tasks-config` | 查看进程配置的覆盖项及加载警告 |

`/task-detach` 的作用是“现在不等了”，不是停止任务。前台命令或 Agent 转后台时继续原来的执行，ID、进程和会话不变；正在等待后台结果时，则只结束这次等待。它能同时解除多个等待，不只是当前面板选中的一项。

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

可以让模型新建子 Agent，或继续一个已完成 Agent 的会话。后台启动先返回执行标识，完成后通知；前台直接等待结果。恢复会话沿用原类型、名称与设置；子 Agent 恢复自己的孩子时固定前台。

Agent 文件配置优先于模型的调用请求；未指定设置时沿用配置/默认值，请求被覆盖时结果会说明实际值。可以让模型给运行中的 Agent 发指示，或在它完成后继续同一会话。queued 表示等待会话初始化，sent 表示已提交，均不保证已读取或处理。

workflow 用脚本编排多步工作，可以调用 Agent，也可以不启动 Agent。你可以提供脚本、文件路径或已保存的 workflow 名称。重放可以沿用原脚本或使用替代脚本；每次启动或重放都产生独立的执行标识。暂停、继续、跳过和重试在 `/agents` UI 中操作。

### 委派执行管理

子 Agent 和 workflow 的运行状态、结果与停止操作会显示在 Task Panel，也可从 `/agents` 中查看。停止 workflow 会停止它所属的 Agent，不停止独立任务；关闭面板或解除等待不会停止正在运行的任务。

输入 `@handle 消息` 可联系对应 Agent。默认的模型模式会生成更完整的委派请求，直接模式则立即启动；可在 `/agents` 的 Settings 中调整。定时定义本身不是运行任务，实际触发的 Agent 才会出现在任务列表。

## 配置

配置文件默认位于 `~/.pi/agent`，设置了 `PI_CODING_AGENT_DIR` 时跟随这个目录。手改配置后在 Pi 中 `/reload`；影响 Agent 功能开关的设置建议重启 Pi。

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
