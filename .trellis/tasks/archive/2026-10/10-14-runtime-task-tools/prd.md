# 统一运行任务工具命名与管理入口

## 背景

当前 preset 的 process-tasks 和 agent-tasks 为仓库维护的本地 fork，经 `extensions/task-composition.ts` 加载，并非 Pi 官方内置能力。工具名称继承不同上游，存在缩写、大小写与前缀不一致、重复启动入口，以及分散的运行任务管理入口。

用户已审阅任务方案并明确批准开始实施（“10-14-runtime-task-tools 我看完了没什么问题，可以开始做了吧”）。授权覆盖本任务设计和实施计划内的代码、测试、文档与独立检查；沿用不自动commit/push/install/sync/reload的限制，不授权pi-trellis关联任务实施。

## 目标

统一启动工具的命名，并提供覆盖 subagent、workflow、bash 和 monitor 的运行任务管理工具。

## 已确认需求

### 工具集合

- 保留 `bash`，继续支持 `run_in_background=true`；移除冗余 `bash_bg`，不新增 `bash_background`。
- 保留 `monitor` 名称及命令输出／WebSocket 监听能力，不改名为 `watch_events`。
- `Agent` 改为 `subagent_run`，保留启动及继续已有子代理的能力。
- `SubagentWorkflow` 改为 `subagent_workflow`，保留编排能力及现有显式使用授权边界。
- `steer_subagent` 改为 `subagent_message`，用于向运行中的子代理发送指导消息。
- 以 `task_manage` 替代 `jobs` 和 `get_subagent_result`；不另设 `subagent_result`。

### 统一管理

- `task_manage` 覆盖 subagent、workflow、bash 和 monitor，不只管理后台 shell。
- 统一提供列表、状态、输出、等待和停止能力。
- 必须能够等待指定 subagent 完成并取得最终回答，不能丢失原 `get_subagent_result` 的等待能力。
- 启动工具返回明确的运行任务身份，供后续管理使用。
- 输出按类型解释：subagent 的当前输出／最终回答、bash 日志、monitor 已收到的监听内容、workflow 的执行输出／结果。
- monitor 的等待语义是等待整个监听结束，不是等待下一条事件；持续活动通知仍由 monitor 负责。
- “运行任务”与 Trellis 的规划任务明确区分；不将 Trellis 任务生命周期纳入本工具。
- 前台／后台执行模式不应导致管理对象类型或身份含糊。

### Beautify 已完成展示能力的迁移

- 以已完成并归档的 `.trellis/tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/` 成果为展示基线，而不是仅修改工具注册名。该任务的 PRD/design、`research/check-report.md` 和 `research/terminal-fix-report.md` 为迁移依据；保留后续终端背景 reset 修复。
- 将现有 `get_subagent_result` 与 `jobs` 的可选 Beautify 展示适配迁移至 `task_manage` 的对应类型／操作；新工具名称、参数与返回合同都必须同步适配，不能只替换 resolver 中的名字。
- 保留收缩态整块单行、主题 pending/success/error 背景、主信息优先及尾部可靠元数据、窄宽布局与展开显示实际已返回全文的行为。
- 保留 subagent description／身份、状态与可靠用量／耗时摘要；等待解除或取消只代表停止等待，不能显示为停止 subagent。
- 保留后台日志的分页／字节范围／省略标记、搜索与统计摘要，以及等待中的 partial 与最终结果区别；停止跟随不等于停止运行任务。
- 保持展示层只读与可选适配：不访问后端私有 registry、不额外获取结果或读取日志、不消费状态；未知参数／结果安全委托原 renderer，无原 renderer 时安全降级，支持动态注册。历史旧名不提供专门迁移适配，由宿主原／通用展示处理。
- 对 workflow 等新增统一管理对象补齐与新合同一致的展示覆盖，但不借本任务扩大到 `subagent_run`、`subagent_workflow`、`subagent_message` 或 `monitor` 启动工具的新 Beautify renderer。
- 保留原 Read/Bash/Find/Grep 展示成果，并核对 `bash_bg` 移除及 Bash 返回提示／句柄变化不会破坏现有后台摘要识别。
- 迁移当前活跃文档与测试；前置任务的历史验收报告保留当时名称与证据，不回写为新实现已验收。

### 保持现有能力

- 现有工具的有效能力不得在改名和整合时静默丢失，包括日志分页／搜索、统计、结果检索、等待取消、消息指导、工作流管理等；具体归属与参数在设计阶段列出映射。
- 保持现有 Task UI、等待与后台模式、完成通知、显式停止以及会话隔离契约。
- 更新工具描述、提示规则、内部调用、子代理工具继承／过滤规则、测试和活跃文档，避免模型继续被指导调用旧名称。

## 范围边界

- 本任务是运行工具接口统一，不重设计 Task Panel，不修改 Trellis PRD／任务管理工具。
- 不把 monitor 改为通用事件订阅框架。
- 不修改 Pi SDK 或恢复独立上游包依赖。
- 不包含自动安装、个人配置同步、reload、提交或推送。
- 直接切换新执行工具名，不注册旧执行别名，不保留旧名专用 renderer，不迁移旧历史记录或旧任务 ID。旧历史由宿主原／通用展示处理；当前 prompt／skill／脚本需迁移，外部插件的生成材料不在本仓库手改。
- 任务 ID 格式、继续执行时的身份规则与管理动作合同，在技术设计中依据现有生命周期确定，并随完整方案提交审阅。

## 验收标准

- [x] 最终公开启动工具为 `bash`、`monitor`、`subagent_run`、`subagent_workflow`、`subagent_message`，管理入口为 `task_manage`。
- [x] 不再提供冗余后台 bash 启动工具或独立 subagent 结果工具。
- [x] 四类运行任务可通过一致入口查询状态、读取输出、等待和请求停止。
- [x] 等待指定 subagent 可返回最终回答，运行中查询与完成后检索均有验证。
- [x] monitor 等待结束与持续事件通知语义明确且不混淆。
- [x] 现有日志搜索／分页、统计等能力有明确映射，未静默删除。
- [x] 工具注册、模型提示、子代理可用工具、内部桥接及文档名称一致。
- [x] 前置 Beautify 的 subagent 查询／jobs 展示迁移至 `task_manage`，覆盖类型／操作映射、单行背景、partial/final、等待释放／取消、字节范围、未知格式委托及动态注册；不要求旧名历史专门适配。
- [x] 原 Read/Bash/Find/Grep 展示无回归；展示迁移无额外 I/O、执行或结果消费。
- [x] 通过类型检查、定向契约测试及全量回归；真实交互未验证的部分明确列出。

## 关联任务

用户已授权在 `/Users/jyxc-dz-0101322/tools/pi-trellis` 创建 `.trellis/tasks/10-14-runtime-tool-names/`，负责新名检测、Trellis角色门禁／材料注入、dispatch提示与provider测试同步。当前仅planning，--no-start创建；两仓库任务不以parent/child字段伪装自动调度。先冻结preset新合同，再推进外部适配并做组合验证；插件安装／当前clone更新仍需另行授权。

## 规划状态

用户已完成方案审阅并批准实施。已完成内部阶段1及独立检查（21/21定向、692/692全量自然退出、strict通过），结果在managed target的research。阶段2代理因provider容量错误终止，已有未提交接口/Beautify/测试改动，但无最终报告或最终验收；任务继续in_progress。通知可靠性由独立 `10-14-subagent-completion-notification` 负责，target中本session额外引入的两处重叠hunk须先分离，不能继续扩展为本任务修复。新session接续以 [session-handoff.md](research/session-handoff.md) 为准；不自动commit/push/install/sync/reload。

## 最终验收

2026-10-15 本仓库范围已通过独立检查及source整合后的strict、773项full natural、真实tmux8项＋8项逐cell背景验收；详见 [final-acceptance.md](research/final-acceptance.md)。旧阶段进度为历史，不代表当前未完成。外部pi-trellis发布前置和NOT_RUN限制保留；产品未提交，source任务按已批准finish收尾。
