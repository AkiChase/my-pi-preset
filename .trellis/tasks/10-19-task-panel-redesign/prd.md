# Task Panel 重设计与 `/agents` 拆分

## 背景

当前 Task Panel 存在三个体验问题（2026-10-19 用户反馈）：

1. 按 `x` 停止任务后，header 追加 `Stop requested: …` 反馈行，滚动区整体下移造成抖动，且反馈直到切换选中项才消失。
2. 详情页几乎无配色；`stats` 以 `key: value · …` 原样拼成一行，`Execution config` 输出原始 JSON，运行时间、命令、token 等难以辨认。
3. Agent 详情直接按字节读取 `.output` JSONL 末尾，显示原始 JSON（首行常被截断），没有角色、Markdown、工具调用等渲染。上游 `ConversationViewer` 有较完整的渲染，但只挂在旧 `/agents` 菜单上。

同时，`/agents` 菜单中运行态功能与 Task Panel 重复，会话内定时子 agent（`schedule`）只在 pi 进程存活时运行、错过不补跑，用户认为鸡肋。

## 目标

- Task Panel 成为运行态 agent / workflow / process 的唯一交互入口，具备良好的详情与对话渲染。
- `/agents` 删除，配置能力拆分为 `/agents-config` 与 `/agents-create`。
- 整体删除子 agent 定时功能。

## 范围

### R1 去掉面板反馈行
- 删除 `feedback` 及其 header 行；`x` 停止、detach-all 不再显示文本反馈，结果通过状态变化体现。
- header 行数在交互过程中不变。

### R2 详情页重设计
- 采用"概要卡片 + 分区"布局：标题行（状态点、kind、标题、着色状态与等待数），随后按 kind 排布字段。
  - agent：model / thinking、耗时、turns（含上限）、tool 次数、tokens（总计与 in/out）、cost、activity。
  - shell / monitor：`$ command`、pid、exit code（非 0 用 error 色）、耗时。
  - workflow：进度 done/total、阶段列表。
- label 用 dim、值用默认或语义色；时长 / token 使用现有格式化函数；不输出原始 JSON。
- 分区标题（如 Command、Artifacts、Output / Conversation）；bounded range 只出现一次（Output 分区标题）。

### R3 Agent 对话渲染
- `TaskDetail` 增加可选结构化对话条目；agent source 优先读取内存 session 消息，session 已清理时按行解析 `.output` JSONL（丢弃不完整首行，条目数与单条长度有界）。
- task-ui 新增对话渲染器：角色标签着色、assistant 正文 Markdown（缓存、失败回退纯文本）、工具调用标题、tool result 淡化并截断、bash 执行、运行中 agent 底部 activity 行。
- shell / monitor 输出保持纯文本。

### R4 面板交互能力
- 运行中 agent 详情页按 Enter 打开单行 steer 输入框，提交后发送给该 agent；Esc 取消；输入框打开时接管按键。
- 选中 workflow 或其子 agent 行时：`p` 暂停 / 恢复 workflow，`s` 跳过子 agent，`r` 重试运行中子 agent；与 `x` 并列，仅在可用时出现在 footer 提示。

### R5 命令拆分与旧 UI 清理
- 删除 `/agents` 命令。
- 新增 `/agents-config`：首页两个入口 —— Agent types（列表、Edit / Enable / Disable / Eject / Reset / Delete，沿用现有行为）与 Settings（沿用现有设置项，去掉定时相关项）。
- 新增 `/agents-create`：沿用现有创建向导（AI 生成 / 手动）。
- 删除不再使用的 `ConversationViewer`、`viewer-keys`、`WorkflowDialog`、`workflow-menu` 等旧 UI 及其设置项（如 viewer Markdown 模式），旧配置键被忽略且不报错、不改写用户文件。

### R6 删除定时功能
- 删除 scheduler、schedule store、schedule 菜单、`schedulingEnabled` 设置、`subagent_run` 的 `schedule` 字段与相关校验和 usage 说明、仅服务于 scheduler 的内部参数。
- 删除 `croner` 依赖并同步 lockfile 与 manifest 测试。
- 旧配置中的 `schedulingEnabled` 被忽略；已有 `.pi/subagent-schedules/*.json` 不读取、不删除。

### 文档
- 更新 `docs/extensions/task-composition.md`、`extensions/agent-tasks/PROVENANCE.md`、subagents skill references 中涉及 `/agents`、定时、workflow 控制入口的内容。

## 不在范围内

- Task Panel 列表页布局、process 输出渲染、新的 source 类型。
- 系统级（离线）定时执行。
- `10-14-subagent-parent-messaging` 任务的内容；但若其先落地，本任务需兼容其详情页 Messages 区块，反之由该任务适配新布局。
- push、install、sync、reload、真实 provider 调用。

## 验收标准

- [ ] AC1：面板中按 `x` / detach-all 前后，header 行数与滚动区起始行不变（测试断言）。
- [ ] AC2：详情页无原始 `key: value` 拼接和原始 JSON；agent / shell / workflow 各有分区布局，状态与 exit code 有语义色（测试 + tmux 截屏）。
- [ ] AC3：agent 详情显示角色化对话，assistant Markdown 渲染；session 被清理后从 JSONL 正确解析，首行截断与坏行被忽略；不显示原始 JSON。
- [ ] AC4：运行中 agent 详情 Enter → 输入 → 提交后调用 steer；非运行 agent 不提供；Esc 取消不发送。
- [ ] AC5：workflow `p` / `s` / `r` 只在可用时生效并出现在提示中，调用对应 control。
- [ ] AC6：`/agents` 不再注册；`/agents-config`、`/agents-create` 可用并保留原有配置 / 创建行为。
- [ ] AC7：`subagent_run` schema 与 usage 不再包含 `schedule`；传入 `schedule` 被作为未知字段拒绝；仓库中无 scheduler / croner 运行代码；带 `schedulingEnabled` 的旧配置正常加载。
- [ ] AC8：`pnpm run typecheck`、`pnpm run test`、`pnpm run check`、`git diff --check` 通过；tmux 真实终端检查列表、详情、对话渲染与 steer 输入框。

## 授权

- 2026-10-19 用户批准创建任务并进入规划。实现需用户审阅本 PRD / design / implement 后批准。
- 批准实现即包含各阶段 scoped local commit；更新 lockfile 仅移除 `croner`，不安装或获取新依赖。
