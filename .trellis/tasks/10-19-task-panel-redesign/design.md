# 设计

## 1. 现状定位

| 关注点 | 位置 |
| --- | --- |
| 面板组件、反馈行、详情拼接 | `extensions/task-ui/panel.ts`（`feedback`、`renderFrame`、`detailBody`、`range`） |
| 行渲染与格式化 | `extensions/task-ui/presentation.ts`（`taskLine`、`taskDuration`、`taskTokens`、`taskStatusColor`） |
| 读模型契约 | `extensions/task-ui/types.ts`（`TaskView`、`TaskDetail`、`TaskSource`）、`coordinator.ts` |
| Agent / workflow 数据源 | `extensions/agent-tasks/src/source.ts`（`fileDetail` 按字节读 JSONL） |
| JSONL 格式 | `extensions/agent-tasks/src/output-file.ts`（`{type, message, …}` 每行一条） |
| 旧对话渲染 | `extensions/agent-tasks/src/ui/conversation-viewer.ts`（Markdown 主题探测、`capResult`、角色渲染） |
| `/agents` 菜单 | `extensions/agent-tasks/src/index.ts` `showAgentsMenu` 及其子菜单，`registerCommand("agents")` |
| workflow 控制 | `workflow/task.ts` `pauseWorkflowTask` / `resumeWorkflowTask`，`task.control.skip/retry(index)`；进度条目含 `index` 与 `recordId` |
| steer | `agent-manager.ts` `steer(id, message): boolean` |
| 定时 | `src/schedule.ts`、`src/schedule-store.ts`、`src/ui/schedule-menu.ts`、`settings.ts` `schedulingEnabled`、`tool-contract.ts` / `tool-guidance.ts` / `nested-tools.ts` 的 `scheduling` 能力、`types.ts` `ScheduledSubagent` |

## 2. 面板布局（R1、R2）

- 删除 `TaskPanel.feedback`。stop / detach-all 只执行操作并 `requestRender`；失败等确需告知的情况使用 `ctx.ui.notify`（不占面板行）。
- header 固定为：标题行 +（详情页时）无额外 range 行。range 移入 Output 分区标题。
- 新增 `extensions/task-ui/detail-view.ts`，纯函数 `renderDetailHeader(view, theme, width, now): string[]`：
  - 标题行：`taskDot` + kind + 标题 + 右侧着色 `[status · waiting N]`。
  - 字段区：两列 `label value`，label 固定宽 dim；窄屏退化为单列。按 kind 选择字段，缺失字段不渲染。
  - `executionConfig` 只展示 model / thinking / tools 等可读字段，不再 JSON。
  - 分区标题：`── Name ─────` 形式（dim 线 + accent 名称），宽度裁剪到 `width`。
- `detailBody` 组合：header 字段 → Command（shell/monitor）→ Artifacts → Phases（workflow）→ Output / Conversation。缓存仍按 width 与内容失效。

## 3. 对话渲染（R3）

### 契约
```ts
// task-ui/types.ts
export type ConversationEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; tools: readonly { name: string; detail?: string }[] }
  | { kind: "toolResult"; name?: string; text: string; elided: number; error?: boolean }
  | { kind: "bash"; command: string; output: string; elided: number }
  | { kind: "notice"; text: string };
export interface TaskDetail { /* 现有字段 */ readonly conversation?: readonly ConversationEntry[]; readonly activity?: string }
```
文本均为未着色外部文本；渲染时先 `cleanTaskText` 再套主题。

### agent source
- 新增 `agent-tasks/src/conversation-entries.ts`：`fromMessages(messages)`、`fromJsonl(text, truncatedHead)`，共享截断（最近 64 条；assistant / user 单条 8 000 字符，tool result / bash 2 000 字符并记录 `elided`）。
- `detail()`：有 `record.session` 时用 `session.messages`；否则读 `.output` 末尾有界字节（256 KiB），`start > 0` 时丢弃首个不完整行，逐行 `JSON.parse`，失败行跳过。保留 `path/start/end/size/omitted*` 供 Output 标题显示。运行中时附 `activity`（来自 `describeActivity`）。
- workflow detail 维持文本（结构化阶段已在 header 中）。

### 渲染器
- 新增 `task-ui/conversation.ts`：`renderConversation(entries, width, theme, cache)`。
  - user：`accent` 的 `User` 标签 + 换行正文。
  - assistant：粗体 `Assistant` 标签 + Markdown 正文；工具调用使用 `createToolCallHeading`（beautify）单行标题。
  - toolResult：dim `Result · name` + dim 纯文本，`elided` 提示；error 标签用 error 色。
  - bash：`$ command` + dim 输出。
  - 条目间 dim 分隔线；运行中末尾 `▍ activity`。
- Markdown：把 `conversation-viewer.ts` 的主题探测（`resolveMarkdownTheme` / fallback）迁入此文件；`Markdown` 实例按文本缓存（有界 Map，面板关闭时清空），渲染异常回退纯文本并记住失败。
- 不提供 Markdown 模式开关；旧 `viewerMarkdown` 设置删除，配置中出现时忽略。

## 4. 交互（R4）

### 契约扩展
```ts
capabilities: { stop; details; steer?: boolean; pause?: boolean; resume?: boolean; skip?: boolean; retry?: boolean }
interface TaskSource { /* … */ steer?(id: TaskIdentity, message: string): boolean;
  control?(id: TaskIdentity, action: "pause" | "resume" | "skip" | "retry"): boolean }
```
coordinator 增加同名转发，与 `stop` 一样校验 closed 与 source 存在；能力缺失返回 false。

### agent source
- 运行中 / queued 的非 workflow-owned agent：`steer: true`，`steer()` 调 `manager.steer`。
- workflow 行：`pause`（running 且有 control）、`resume`（paused）。
- workflow 子 agent 行：在 `workflowProgress` 中按 `recordId` 找 `index`；`skip`（未结束）、`retry`（运行中）。动作再次校验当前身份后调用 `task.control`。

### 面板
- 详情页、`capabilities.steer` 时 Enter 打开 `Input`（pi-tui）。输入框占用 footer 的提示行（行数不变）；打开期间所有输入路由给它；提交非空文本调用 `coordinator.steer`，失败时 `notify`；Esc 关闭。焦点 / cursor marker 透传以支持 IME。
- 列表页与详情页：`p` / `s` / `r` 按能力调用 `coordinator.control`；footer 动作行只列出当前可用动作。

## 5. 命令（R5）

- 删除 `registerCommand("agents")`、`showAgentsMenu`、`showRunningAgents`、`viewAgentConversation`、`workflowMenuDeps` 及 `ui/conversation-viewer.ts`、`ui/viewer-keys.ts`、`ui/workflow-dialog.ts`、`ui/workflow-menu.ts`；实现时 `rg` 确认无其他引用（`select-item.ts`、`workflow-card.ts` 若仍被使用则保留）。
- `/agents-config`：`select("Agents config", ["Agent types (N)", "Settings"])`，子页返回后回到首页；复用 `showAllAgentsList`、`showAgentDetail`、`showSettings`。
- `/agents-create`：调用 `showCreateWizard`。
- 命令描述使用英文，与现有命令一致。

## 6. 删除定时（R6）

- 删除文件：`schedule.ts`、`schedule-store.ts`、`ui/schedule-menu.ts`。
- `index.ts`：删除 scheduler 实例、`startScheduler`、session 生命周期中的 start/stop、`subagent_run` 的 schedule 分支、设置项。
- `tool-contract.ts` / `tool-guidance.ts` / `nested-tools.ts` / `invocation-config.ts`：移除 `scheduling` 能力与 `schedule` 字段。删除后 `schedule` 作为未知字段被现有封闭 schema 拒绝。usage 不写迁移说明。
- `settings.ts`：删除 `schedulingEnabled` 字段、解析与 applier；未知键沿用现有忽略逻辑（实现时确认不告警或仅忽略）。
- `agent-manager.ts`：`bypassQueue` 若仅 scheduler 使用则删除。
- `types.ts`：删除 `ScheduledSubagent`、`ScheduleStoreData`。
- `package.json` 删除 `croner`；`pnpm install --lockfile-only --offline` 更新 lockfile（失败则手工删除对应条目并说明）；`scripts/pi-manifest.test.mjs` 去掉 croner 断言。
- 注释中提到 scheduler 的地方（`agent-types.ts`、`cross-extension-rpc.ts`、`status-note.ts`、`usage.ts`）同步改写。

## 7. 风险与回滚

- 契约扩展均为可选字段，process source 不受影响。
- 对话解析只读有界数据；渲染无文件 I/O。
- 每个阶段独立提交，可逐阶段回滚。
- 与 `10-14-subagent-parent-messaging` 的详情页 Messages 区块可能冲突：后落地者适配，本任务不实现其内容。

## 8. 测试

- `task-ui/__tests__/panel.test.ts`：反馈行移除后行数稳定；详情分区；steer 输入框；p/s/r 提示与调用。
- 新增 `task-ui/__tests__/conversation.test.ts`：各条目渲染、Markdown 失败回退、截断提示、宽度安全。
- 新增 `agent-tasks/__tests__/conversation-entries.test.ts`：messages / JSONL 转换、首行截断、坏行、上限。
- `agent-tasks` 测试：source steer / control 能力与身份校验；`/agents` 未注册，`/agents-config` / `/agents-create` 注册；schedule 字段被拒绝、旧 `schedulingEnabled` 配置可加载。
- tmux 真实终端检查（见 `.trellis/spec/testing/tmux.md`）。
