# 运行任务上下文提醒

## 目标

主 Agent 经常在多轮工具调用或上下文压缩后忘记还有后台工作。本任务定期补充简短的 `<background-task-reminder>`，帮助它记得处理后续结果、避免重复委派。提醒不是实时或完整任务列表；需要确认当前状态或获取完整列表时仍使用对应管理工具。现有 Task Panel / footer 继续负责用户可见状态，不重设计 UI。

## 授权与状态

- 用户已授权创建任务、记录规划，并认可固定 system 规则、精简提醒格式、默认周期 8 及共享配置。
- 用户随后明确授权自主技术验证、逐阶段实施/检查/本地提交、独立审查、隔离 tmux 测试与最终任务收尾；除明显阻塞外无需逐步重复确认。授权不包含 push、SDK 修改、安装依赖、个人配置同步或不满足验收的强行归档。
- 核实发现 Pi 1.3.0 缺少“所有压缩之后、请求前”的公开追加边界。用户选择**方案 B**：用现有公开接口实现，接受 run 中途自动压缩后那一次请求晚一个请求收到最新提醒；为 Pi 新增请求前 boundary（方案 A）不在本任务范围。
- 用户要求历史提醒保持追加式，不能为了更新状态而替换/删除旧提醒、破坏模型输入缓存前缀。任务约束记录在任务材料，不额外写入 memory。

## 背景与证据

- `extensions/task-composition.ts` 组合 Agent / Process 后端与共享 `TaskCoordinator`、`TaskLifecycle`，并注册 `agent_manage` / `process_manage`。
- `extensions/agent-tasks/src/index.ts:499-603` 是原规划时的完成结果预览证据；当前通知代码已迁移，运行期间仍无每 N 次主模型请求的通用提醒。
- `extensions/process-tasks/notify.ts` 负责后台 shell 终态通知；`monitor-notifications.ts` 负责事件批量通知，不是所有运行任务的周期性提醒。
- `extensions/task-ui/owner.ts` 更新用户可见状态，不将它发送给模型。
- 原证据 `.pi/git/github.com/AkiChase/pi-trellis/extensions/trellis.ts:931` 指 Trellis 项目绑定注入；当前内置集成在 `extensions/trellis/`，不能将项目绑定当作后台运行状态。
- 原关联任务 `../10-14-runtime-task-tools/prd.md` 已归档至 `../archive/2026-10/10-14-runtime-task-tools/`；不能沿用旧规划中的 `get_subagent_result` / `steer_subagent` / `jobs` 或 `bash_bg`。当前接口以注册源码及工具契约为准。
- SDK 核实：请求 hook 不自动持久化消息；`sendMessage` 在运行中被动发送会延迟到 turn 结束。普通 `context` 修改消息还可能折叠 system 历史，不能据此声称缓存前缀稳定。详见 `design.md`。

## 已确认需求

### R1：提醒用途与可见性

- 提醒用于防遗忘，不代替 `agent_manage` / `process_manage` 的 list/status。
- 默认仅模型可见，不在主对话显示卡片，不增加 Task Panel 或 footer 展示。
- 固定解释规则进入 system，并准确引用 `<background-task-reminder>`；动态任务数据只在对话尾部追加。
- 不反复重写 system prompt，不修改已有提醒内容/顺序，不用定时器唤醒空闲模型，不自行增加模型请求。

固定 system 规则：

```text
Periodic <background-task-reminder> messages help you remember outstanding
background work. They are not a live or complete task list. Use the corresponding
task-management tools when you need current status or a full list. Do not forget
pending results or duplicate delegated work; completion notifications arrive
automatically.
```

### R2：真实类型与归属

- 普通 subagent 标记 `agent`；workflow 单独一项，不重复平铺其内部 agent。
- 后台 bash 标记 `shell`；monitor 标记 `monitor` / `watching`，不暗示应立即结束。
- 只包含当前会话拥有且尚未终态的后台工作，不包含其他会话、历史完成任务、Trellis 规划任务或另一个 owner 的内部任务。
- 若已有可确认的主会话等待信息，追加 `main-waiting`；等待与执行状态是独立维度。

### R3：精简正文

- 每个任务一行：类型、完整可操作身份、短名称、简化耗时；必要的非 running 状态单独保留。
- Agent 保留执行管理的 `execution_id` 和引导/恢复的 `agent_id`，不能互相替代。workflow 用真实 `execution_id`，Shell 用 `task_id`。
- 不重复固定解释、工具教学、快照声明、分组标题或普遍的 `running`。
- workflow 进度只在来源可靠时显示。描述单行化、有界，不读取或推测结果。
- 不包含完整 prompt、日志、token/cost 或完整 shell 命令；名称缺失不能回退到命令。
- 摘要有总预算，截断时必须有明确省略标记；省略不表示任务已结束。具体预算见设计。
- 不消费结果或改变完成通知资格。工具使用方式仍由当前注册契约说明，不注册旧别名或修改外部插件。

正文格式：

```text
<background-task-reminder>
agent | <execution_id> | agent=<agent_id> | review-editor | 4m
workflow | <execution_id> | review-changes | 2/5 done | 3m
shell | <task_id> | full-tests | 2m
monitor | <task_id> | service-events | watching | 8m
</background-task-reminder>
```

### R4：节奏

- 按主 Agent 模型请求次数计数，默认每隔 **8 次**提醒；不是用户消息数、工具调用数或墙钟时间。
- 周期属于 Task 插件共享配置：在现有 `task-ui.json` 中新增 `backgroundReminderInterval`，默认 `8`，正整数 `N` 表示第 N、2N、3N… 次请求前提醒；`0` 关闭周期提醒但保留压缩后提醒。非法值警告并回退默认值，不影响任务执行。
- 提醒必须在目标模型请求发出前进入会话上下文并保留历史，不能等目标请求回答结束后才发。新用户消息触发时优先放在该消息之前；工具继续请求时放在完整工具结果之后，不拆开工具调用与结果。
- 成功压缩后下一次主模型请求补一份，与周期触发重合时只发一次。已知限制：run 中途自动压缩（阈值、virtual routing、overflow 恢复）后的那次请求晚一个请求收到最新提醒。
- 每次触发读取最新真实后台状态。终态任务不再出现在新提醒中，最终结果仍由原通知负责。
- 无运行任务时不追加；不发送空清单，不用它撤销旧历史状态。
- 技术计数边界是主 Agent 请求准备尝试：不包含 provider 内部 HTTP 重试、压缩模型、子 Agent 请求或缓存预热；请求准备后早期失败可能计入。详见设计。

## 范围外

- Task Panel/footer/fleet/workflow 卡片重设计。
- 工具改名、统一管理迁移、旧接口别名、修改外部插件。
- 修改 Pi SDK、生成的 `.pi/git/` 集成或新增上游依赖。
- 改变执行、等待解除、停止、完成通知或 monitor 事件通知语义。
- 跨会话恢复后台运行、把 Trellis 项目任务放入提醒。
- 读取日志、新增轮询工具调用、主动唤醒空闲模型。
- 自动安装、同步个人配置、reload、push、归档或修改其他任务材料。

## 验收标准

- [ ] AC1 / R1：实际请求收到隐藏提醒，用户对话默认不显示；固定 system 规则准确引用 tag，动态状态不改写 system，空闲模型不被唤醒。
- [ ] AC2 / R2：四种类型正确，monitor watching，workflow/父 Agent 的内部任务不重复展示，不混入其他 owner/session。
- [ ] AC3 / R2-R3：身份可直接用于对应工具，名称及耗时准确；等待不改变执行状态，终态/纯前台任务不出现在新提醒中。
- [ ] AC4 / R3：无 prompt/日志/cost/token/完整命令；内容有界、省略可见，正文没有重复工具教学。
- [ ] AC5 / R4：默认第 8/16 次主请求前收到提醒；配置 N、0、非法值均有测试，用户消息/工具数量不决定计数；请求尝试与底层 HTTP 的区别明确记录。
- [ ] AC6 / R4：run 外/前的成功压缩后下一请求补发，run 中途自动压缩按已知限制晚一请求；周期重合不重复，压缩失败不误触发，无任务不注入，新提醒读取最新状态。
- [ ] AC7 / R1-R4：不消费结果、改变通知、追加模型请求或调用 list/log 工具；取消/切换/shutdown 无跨会话泄漏。
- [ ] AC8：定向回归、类型检查及全量测试有证据；真实 provider、在线缓存命中及真实压缩未测部分明确报告。
- [ ] AC9 / R1：真实 SDK 请求投影中旧提醒正文/时间戳/位置保持稳定；追加新提醒不折叠 system 历史、不拆开 tool call/result，不丢失历史前缀。不得用“只保留最新提醒”降级。

## 实施状态

方案 B 已确定并获实施、测试与收尾授权；进度和验证证据见 `implement.md`。
