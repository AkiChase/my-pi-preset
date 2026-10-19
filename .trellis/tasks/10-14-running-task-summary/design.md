# 技术设计：后台任务防遗忘提醒

## 1. 行为差距与边界

现有后端有执行状态和完成通知，但主 Agent 的连续请求没有通用防遗忘提醒。状态实际属于后端，组合层已有同一 owner 的 management capabilities；请求提醒由组合层注册一个独立 owner，不能由 UI 计时器或单个后端分别发送。

候选改动位置：

- `extensions/task-composition.ts`：唯一提醒 owner 的注册，传入现有 capabilities / lifecycle。
- 新增 `extensions/runtime-tasks/reminder.ts`：真实任务元数据筛选、紧凑格式、预算和固定规则。
- 新增 `extensions/runtime-tasks/reminder-owner.ts`：请求计数、turn_end / before_agent_start 正常隐藏消息追加与生命周期。
- `docs/extensions/task-composition.md`：用户可见配置与行为说明。
- `extensions/task-ui/config.ts` 及配置测试：共享 `backgroundReminderInterval`，默认 8；不改名或迁移现有配置文件。
- `extensions/process-tasks/source.ts` 与 `extensions/task-ui/types.ts`：必要时新增纯数据 `reminderTitle`，防止 process 的 UI title 回退命令泄露完整脚本；不得改变已有 UI title/description。
- 相应 `extensions/runtime-tasks/__tests__/reminder*.test.ts`：纯逻辑及真实 SDK 请求边界验证。

不改变工具 schema、执行/停止/等待、结果消费、通知、UI 或 SDK。若实际需 SDK 私有写方法、上游改动或大量跨模块重构，停止并重新审阅，不能扩范围。

## 2. 真实状态与管理权限

### 2.1 来源

优先使用 composition 已收集的 `RuntimeTaskCapability.list()`，不是调用模型工具，也不是读取日志。原因是 coordinator 的 UI snapshot 可以包含可见但不可管理的 owned children；capability 提供 `manageable` 权限维度，与对应工具共用来源。

确认依据：

- `extensions/task-ui/types.ts:1-44`：TaskView 的身份、kind、executionMode、waitCount、时间和 workflow done/total。
- `extensions/task-ui/coordinator.ts:121-143`：snapshot/list 是元数据读取；detail 是另一操作，提醒不能调用。
- `extensions/agent-tasks/src/source.ts:65-105`：parentKey 与 owned 子任务、四种执行状态映射、workflow 汇总。
- `extensions/agent-tasks/src/management.ts:23-28`：Agent capability 按真实 record/owner 提供 manageable。
- `extensions/agent-tasks/src/workflow/management.ts:27`：workflow capability。
- `extensions/runtime-tasks/facade.ts:11-27`：有限 capability，不需持有 record/session/controller。

筛选规则：

1. lifecycle active、当前 session 身份匹配。
2. entry.manageable 为 true。
3. kind 是 agent/workflow/shell/monitor，status 是 starting/queued/running/paused。
4. executionMode 是 background；不把未解除的纯前台执行纳入后台提醒。
5. 不列 owned 子项。workflow 与普通顶层 Agent 各保留一项；不可管理子项不是预算省略数量。
6. 同一完整 identity 去重；快照异常不改变执行，报告诊断并跳过这次追加。

会话 scope 依靠现有 activation/capability owner：每次会话切换/重载都会关闭旧 activation，提醒 owner 随 `lifecycle.onClose` 注销，`session_start` 重置计数；不另做 sessionId 比较。不能只凭 ID 编码推断权限。

### 2.2 身份

复用 `extensions/runtime-tasks/execution-id.ts:4-17`，不要复制编码规则。

| 类型 | 正文身份 | 操作 |
| --- | --- | --- |
| agent | 完整 executionId + `agent=<taskId>` | agent_manage / subagent_message、subagent_run |
| workflow | 完整 taskId，即 wf_ executionId | agent_manage |
| shell/monitor | 完整 taskId | process_manage |

名字和 ID 各自清理，名字不得影响身份；异常或超预算的身份必须省略整项，不能截成不可操作 ID。

### 2.3 安全短名称

process source 当前 `title` 与 `description` 会回退到完整 `job.command`（`extensions/process-tasks/source.ts:36-37`）。不能把 UI title 无条件拿来当提醒名称，也不能用“截短命令”冒充名称。

建议 source 提供可选纯数据 `reminderTitle`：有 `job.name` 时使用它，缺失时使用固定 `shell`/`monitor`。保留既有 title/description，不影响 UI/工具输出。Agent/workflow 使用 source 的短 title，缺失则固定类型名称；不回退完整 prompt、活动文本或日志。

所有标题单行化：去终端控制序列、换行/分隔符归一化、空白压缩，按 Unicode code point 截到 60 字符，必要时加省略符。防止标题注入 XML tag/新行。

## 3. System 与正文

固定 system 文案以 PRD 为唯一产品定义。通过 `before_agent_start` 修改 `event.systemPromptOptions.sections.background_task_reminder`，固定内容，不读取任务数量/时间，不返回完整 `systemPrompt` 或 forceSystemPrompt。

这是通用记忆规则，不是第二套工具使用说明；具体调用契约仍留在工具注册字段。保留其它 sections，不把每次运行都写成不同 prompt。

SDK 依据：

- 安装版本 1.3.0 `examples/extensions/prompt-customizer.ts:40-48` 展示 sections 修改。
- `dist/core/agent-session.js:1307-1314` 用 section diff 追加变更。
- 同文件 `:1351-1370` 的 forced prompt 投影会折叠历史，不能采用。

正文准确使用 `<background-task-reminder>`，每项一行，类型顺序 agent → workflow → shell → monitor，同类按 startedAt、完整 key 排序：

```text
<background-task-reminder>
agent | exec_... | agent=... | review-editor | 4m
workflow | wf_... | review-changes | 2/5 done | 3m
shell | b... | full-tests | 2m
monitor | m... | service-events | watching | 8m
</background-task-reminder>
```

- running 省略；starting/queued/paused 原样保留，不伪称运行。
- monitor 在 running 时加 watching，其余特殊状态仍准确保留。
- waitCount 来自 main capability/coordinator 且大于零时才加 main-waiting，不改变 status。
- 耗时取非负真实时间：不足分钟用整数秒，其后整数分钟，超过小时用小时及分钟。缺少可靠起点不捏造耗时。
- workflow done/total 只在安全非负整数且 done ≤ total、total > 0 时展示；动态发现的 total 只是当前真实进度，不称为最终计划总数。
- 默认预算：12 项、正文连 tag 合计 4,000 Unicode 字符。先为每种非空类型选一项，再按上述顺序填余量，最终输出类型顺序稳定。
- 整项能放下才输出；留足 `… N more` 与闭合 tag 预算。N 是此次可提醒候选中未显示数量，不包含不可管理/终态/前台项。
- 全部候选超预算时可只输出省略行，不截短身份。无候选不输出空 tag。

## 4. 请求节奏（方案 B）

用户选择方案 B：只用 Pi 1.3.0 现有公开接口，接受“run 中途自动压缩后的那一次请求晚一个请求才收到最新提醒”这一种限制。

- 计数：`context` hook 每次主 Agent 请求准备尝试 +1，只观察、不修改消息（不触发 system 合并）。语义是主请求尝试，不含 provider 内部 HTTP 重试、压缩模型、子请求、缓存预热。
- 周期：`task-ui.json` 的 `backgroundReminderInterval` 默认 **8**；正整数 N 在第 N、2N…次请求前提醒；`0` 关闭周期提醒但保留压缩后提醒；非法值警告并回退 8。由 composition 现有 loader 启动时读取一次。
- 无后台工作仍推进计数，但不追加；不发送空清单。
- 子会话（`inChildSessionContext()`）不注册提醒 owner，只服务主 Agent。

### 4.1 追加点

“下一次请求”的序号 = 已计数 + 1。提醒在下一次请求之前、通过正常会话追加写入：

1. **`turn_end`**（主路径）：assistant 与完整工具结果已持久化后，若下一次请求到期或有待处理压缩，返回 `custom_message` 草稿（`customType: background-task-reminder`，`display: false`），不返回 `continue`。
   - 下一次是工具续轮：提醒位于完整工具结果之后、请求之前。
   - 下一次是新用户 run：提醒位于上一 run 结尾，即用户消息之前。
2. **`before_agent_start`**（补充）：run 开始（已完成 run 前压缩）时，若下一次请求到期且尚未由 turn_end 写入，或有待处理压缩，返回同样的隐藏 message（位于用户消息之后、首个请求之前）。覆盖 N=1、首个请求、空闲手动压缩和 run 前压缩。
3. 已为某个请求序号写入后记录 `scheduledFor`，同一序号不重复写入；同一写入点上周期与压缩重合只写一份。若周期提醒已在压缩前写入、之后才发生压缩，压缩后仍会再写一份最新提醒（压缩前那份可能已被总结），这是预期行为。

`session_compact` 成功只置 pendingCompact；失败/取消不置。不使用 `sendMessage`、`context` 注入、`continue`、steer/followUp 或私有 API。

### 4.2 已知限制

- run 中途自动压缩（阈值、virtual routing、overflow 恢复）发生在 `turn_end` 之后、请求之前：该请求看到的是压缩前写入（可能已被总结）的提醒，最新提醒在该请求的 `turn_end` 写入，晚一个请求。完整解决需 Pi 新增公开请求前追加 boundary（方案 A，范围外）。
- turn_end 写入时 run 可能随后结束，提醒在下一次用户请求前才被看到，内容反映写入时刻状态；system 规则已声明提醒非实时列表。
- 其它扩展通过 boundary 草稿直接追加的 compaction 不发 `session_compact`，不额外检测。

## 5. 缓存前缀

- 只经 SDK 正常持久化追加隐藏 custom message；不改写、删除、移动已有消息或 system 历史，不使用会合并 system 的 `context` 修改。
- 固定 system 规则通过 `before_agent_start` 设置 `systemPromptOptions.sections.background_task_reminder`，内容恒定，首次出现时产生一次 section 变更，此后无 diff；不返回 `systemPrompt`/`forceSystemPrompt`。
- 证据（安装 1.3.0）：`agent-session.js:485-562`（turn_end 草稿提交后再准备下一轮）、`:1444-1507`（run 前压缩后 before_agent_start）、`:1815-1875`（运行中被动消息仅排队）、`extensions/runner.js:91-106`（context 修改会合并 system）。
- 不保证任意 provider 在线缓存命中，不约束其它扩展。

## 6. 生命周期与失败

owner 注册在 composition；`session_start` 重置计数/pending/scheduledFor；`lifecycle.onClose` 关闭后所有 handler 直接返回。不开 timer，不持有 session/controller。快照或格式化异常记录诊断并跳过本次提醒，不影响工具和通知。恢复会话不恢复旧后台执行，周期从 0 开始，历史提醒仅为历史。

## 7. 验证

纯逻辑测试覆盖筛选/格式/预算/节奏；真实 AgentSession 离线 scripted provider 测试覆盖：默认第 8 次、配置 N、工具续轮与新用户 run 的位置、N=1、0、成功压缩（手动空闲）后下一请求、隐藏不显示、历史前缀稳定、不额外请求、子会话不注册。隔离 tmux 用本地 scripted provider 验证真实 CLI。run 中途自动压缩的晚一请求行为单独记录为已知限制。
