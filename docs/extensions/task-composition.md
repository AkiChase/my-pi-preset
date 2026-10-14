# Task Composition：任务管理与共享面板

Task composition 把命令进程、Monitor、子 Agent 和 workflow 放进同一个任务面板。底栏按 `shell`、`monitor`、`agent`、`workflow` 显示活动和排队数量，前台任务也会计入；父任务及其子任务不会重复算作独立工作。没有活动或排队任务时，摘要隐藏。

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

面板只在交互终端中可用；非交互模式可以用 `jobs` 或 `get_subagent_result` 查询。

## 命令进程

这些是模型可调用的工具，不是同名斜杠命令。可以直接告诉模型：“把这条命令放后台运行”“读取这个任务从头开始的日志”或“等它完成”。

| 工具 | 常用参数及行为 |
| --- | --- |
| `bash` | `command` 执行命令；`run_in_background: true` 直接后台；`timeout` 单位为秒，交互模式下长命令默认 120 秒后转后台；`description` 是简短说明 |
| `bash_bg` | `command` 直接后台运行；`name` 给任务命名；`notify: false` 关闭完成通知 |
| `jobs` | `action` 选 `list`、`output`、`kill`、`attach`、`search` 或 `stats` |
| `monitor` | 持续观察命令或 WebSocket，详见 [Monitor](monitor.md) |

不要把 Bash 的 `timeout` 当作所有命令的强制终止期限：普通长命令到时转后台，直接后台运行的命令也不会因为这个参数统一到时停止；非交互运行不做自动超时转后台。想给观察设置总截止，用 Monitor 的 `timeout_ms`。

单独的 `sleep N` 等固定等待可能被拒绝。等已有任务完成用 `jobs attach`；等某个条件应让检查循环在条件满足时退出，而不是先睡很久。

### 查看与停止进程

- `jobs list` 列出当前会话内的进程和 Monitor，包括暂时保留的终态；子 Agent 用 `get_subagent_result` 查询。
- `jobs output` 必须带 `jobId`，默认读日志尾部。`offset: 0` 从头读，`limit` 限定字节数；按返回的结束位置继续传 `offset` 可以翻页。字节边界可能把中文字符切开。
- `jobs search` 必须带正则 `pattern`；可用 `jobId` 限定任务，`ignoreCase` 忽略大小写，`context` 指定前后上下文行数。每个任务最多预览 20 条匹配行，长行也会截短。
- `jobs attach` 必须带 `jobId`，默认跟随输出并等到完成；`wait: false` 只看状态。解除或取消这次结果等待不停止任务。
- `jobs kill` 必须带 `jobId`，请求停止该任务；`jobs stats` 查看本会话累计统计。

主会话 Esc 取消仍在前台执行的 Bash 或 Agent 时，会停止对应执行。手动转后台后，前台取消不影响该任务。后台完成通常通过通知报告；结果已由工具返回时不会重复报告，取消结果等待后仍可收到完成通知。

会话切换、重载或退出时会停止当前任务，不会自动恢复。停止是请求，不能保证不响应取消的第三方模型请求立即结束。

日志默认在 `/tmp/pi-bg/<jobId>.log`，扩展不会主动删除。进程终态记录保留约十分钟、每分钟检查回收，回收后按 ID 查询会报未知任务，但日志仍在。系统可能清理 `/tmp`，需要长期保留时换一个 `logDir` 并自行管理文件。

## 子 Agent 与 workflow

`Agent` 把任务交给独立会话，默认后台启动并返回 ID；需要直接等待时用 `run_in_background: false`。新任务常用 `prompt`、`description`、`subagent_type`，可指定 `name` 方便识别。类型文件里的设置会优先于调用参数。

`get_subagent_result` 用 `agent_id` 查询，默认不等待；`wait: true` 等到完成，`verbose: true` 包含对话。`steer_subagent` 用 `agent_id` 和 `message` 给运行中的 Agent 发新指示。任务尚在运行时不能 resume；完成后可用 `Agent` 的 `resume` 参数继续同一会话。

输入 `@handle 消息` 可以定向联系 Agent。默认 `agentMentions: "model"` 下，启动新 Agent 会用当前模型和对话上下文在临时会话中后台生成派发请求，不增加可见主会话回合，但会额外调用模型。运行中的消息和已完成任务的继续则直接处理。`"direct"` 直接启动新任务，`"off"` 关闭此入口。

`SubagentWorkflow` 用于运行多阶段或动态数量的 Agent 编排，后台启动后通知结果；`/agents` 可以管理相应运行和定时任务。

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
| `timeoutMs` | `120000` | 前台命令自动转后台的等待时间 |
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
