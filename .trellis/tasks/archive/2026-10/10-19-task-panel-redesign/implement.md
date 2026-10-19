# 实施计划

## 门槛

- [x] 2026-10-19 用户确认方向：去掉反馈行、详情分区、新对话渲染、删除 `/agents` 拆为 `/agents-config` + `/agents-create`、Settings 并入 config、workflow 控制与 steer 进入 Task Panel、整体删除定时功能。
- [ ] 用户审阅 PRD / design / 本计划并批准实施。
- [ ] 实施前读取 `.trellis/spec/development/index.md`、`.trellis/spec/testing/index.md`、`testing/tmux.md`、相关 guides。
- [ ] 执行方式：主会话直接实现。阶段 1、2 主会话自审；阶段 3、4、5 涉及跨模块契约 / 公开命令 / 工具 schema，完成后由 `trellis-check` 独立审查（派发前整理 `check.jsonl`）。`implement.jsonl` 故意为空，start 使用 `--allow-empty-context`。

批准后每个已验证阶段做 scoped local commit；push / install / sync / reload / 真实 provider 测试不在授权内。

## 阶段 1：面板布局（R1、R2）

- 删除 `feedback`；新增 `task-ui/detail-view.ts`；重写 `detailBody` 分区与 Output 标题 range。
- 测试：stop / detach-all 前后帧 header 行数一致；三类 kind 详情字段与语义色；窄屏不溢出。
- 自审 → commit。

## 阶段 2：对话渲染（R3）

- `TaskDetail.conversation` / `activity`；`agent-tasks/src/conversation-entries.ts`；source 使用 session 或 JSONL。
- `task-ui/conversation.ts` 渲染器，迁入 Markdown 主题探测。
- 测试：转换、截断、坏行、渲染、Markdown 回退。
- 自审 → commit。

## 阶段 3：面板交互（R4）

- 契约 `steer` / `control` 与能力位；coordinator 转发；agent source 实现；面板 Enter 输入框与 p/s/r。
- 测试：能力判定、身份过期拒绝、输入框路由与 Esc、提示只列可用动作。
- trellis-check 独立审查 → 核实 → commit。

## 阶段 4：命令拆分与旧 UI 清理（R5）

- 删除 `/agents` 及旧 viewer / workflow dialog / menu；新增 `/agents-config`、`/agents-create`；删除 `viewerMarkdown` 设置。
- 更新 `docs/extensions/task-composition.md`、`PROVENANCE.md`、`skills/subagents/references/workflow-api.md`。
- trellis-check 独立审查 → 核实 → commit。

## 阶段 5：删除定时（R6）

- 按 design §6 删除代码、schema、设置、依赖与测试；更新文档与 `delegation.md`。
- 测试：`schedule` 被拒绝、旧配置可加载、registered prompt 不含 schedule。
- trellis-check 独立审查 → 核实 → commit。

## 最终验证

```bash
node --test <阶段内定向测试>
pnpm run typecheck
pnpm run test
pnpm run check
git diff --check
```

tmux 真实终端：列表页、三类详情页、agent 对话（运行中 / 已结束 / session 清理后）、steer 输入框、workflow p/s/r 提示、`/agents-config`、`/agents-create`。

## 进度记录

### 阶段 1（2026-10-19）

- 改动：删除 `TaskPanel.feedback` 及 header 反馈行；新增 `extensions/task-ui/detail-view.ts`（状态行、按 kind 的标签字段、Command / Phases / Artifacts / Output 分区，range 仅出现在 Output 标题）；`panel.test.ts` 更新断言并新增“stop / detach 不改变 header”和“分区字段无原始 stats / JSON”两个用例。
- 验证：`PI_CODING_AGENT_DIR=<tmp> node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts` → 455/455 PASS；`pnpm typecheck` PASS；`git diff --check` PASS。
- 视觉检查：用 dark 主题和 fixture 直接渲染 agent / shell 详情帧（不经过 pi CLI），确认颜色和布局正常，发现并修复了长 label（`conversation`）与值之间没有空格的问题。
- 过程失误：第一次用 tmux 截图时，渲染脚本从 SDK 公开入口导入 `getThemeByName` 失败，脚本立即退出，等待循环又没设超时，空转到被 SIGTERM 终止。已确认没有残留 tmux / node 进程；之后的临时脚本都加了 30 秒 alarm。这次的视觉检查不是真实 pi CLI 的 tmux 验证，那项留到最终验证再做。

### 阶段 2（2026-10-19）

- 改动：`task-ui/types.ts` 增加 `ConversationEntry`、`TaskDetail.conversation` / `conversationTruncated`；新增 `agent-tasks/src/conversation-entries.ts`（session 消息或 JSONL 尾部 256 KiB → 有界条目，丢弃不完整首行、跳过坏行）；`source.ts` 附加结构化对话，并在消息末尾不含最终答案时补上 `record.result`，失败时补 Error 提示；新增 `task-ui/conversation.ts` 渲染器（角色标签、Markdown 带缓存与失败回退、工具调用行、tool result 淡化截断、bash、运行中 `▍ activity`）；panel 有对话时用 Conversation 分区替代 Output。
- 与 design 的偏差：
  - 没有用 `TaskDetail.activity`，直接复用 `TaskView.stats.activity`。
  - 截断信息改成布尔值 `conversationTruncated`：从文件中途读取时无法得知被丢掉的消息条数。
  - 工具调用行在 task-ui 本地渲染，没有用 Beautify 的 `createToolCallHeading`：它需要完整的 `Theme`，而面板只拿到只有 fg 的 `TaskTheme`。
- 验证：新增 `conversation-entries.test.ts`（4 个用例）、`conversation.test.ts`（2 个用例），`panel.test.ts` 和 `backend-waits.test.ts` 补了集成断言。`PI_CODING_AGENT_DIR=<tmp> node --test` 跑 task-ui、process-tasks、agent-tasks、runtime-tasks、beautify 五个目录 → 878/878 PASS；`pnpm typecheck` PASS；`git diff --check` PASS。
- 失败与重跑：第一次跑完整套件时 `backend-waits` 有 2 个失败（"fresh panel after actual sweep…"）。原因是 session 消息里没有最终答案时，对话视图把原来 preview 会附带的 `record.result` 弄丢了，属于产品回归。补上 `withOutcome` 后重跑 878/878 PASS。
- 过程失误：为对比基线执行过一次 `git stash`，把并行会话未提交的改动也一起暂存了，随后 `stash pop` 已恢复（`git stash list` 为空）。之后不再用 stash 做基线对比。
- 视觉检查：用 dark 主题直接渲染对话详情帧（不经过 pi CLI），Markdown、角色、工具行、失败结果、activity 都显示正常。

### 阶段 3（2026-10-19）

- 改动：
  - `TaskView.capabilities` 增加 `steer` / `pause` / `resume` / `skip` / `retry`，`TaskSource` 增加可选的 `steer` / `control`。
  - coordinator 新增 `capable()`：先按 key 重新读取 `list()`，确认身份和能力仍然有效，再转发。
  - agent source：可 steer 的只限非 workflow 子 agent 且状态为 running/queued；workflow 的 pause/resume 走 `pause/resumeWorkflowTask`；子 agent 的 skip/retry 按 progress index 调用 `task.control`，并在执行前重新检查当前状态窗口。
  - panel：详情页按 Enter 打开 `Input` composer（接管全部按键、Esc 只关闭 composer、IME 光标通过 Focusable 转发、footer 高度不变）；`p` / `s` / `r` 只在有对应能力时生效；footer 只列出当前可用的动作。
- 独立审查（trellis-check，agent 41da36dd-b30c-495）：发现并修复 2 个 Medium 和 1 个 Low 问题：
  - workflow 子 agent 也能 steer，超出了 design §4 的范围；
  - 窄屏下 composer 让 footer 变矮，正文跟着位移；
  - 面板关闭后仍调用 render。
  另补了 IME 光标、窄屏 footer、子 agent 不可 steer 三项测试。主会话逐项核实了这些修改，并顺手删掉未使用的 `composer.key`。
  未修复：composer 打开时 footer 仍显示 x/c 等提示（placeholder 已写明 Enter 发送、Esc 取消）；目标 agent 结束后 composer 不会自动关闭，提交会被拒绝并提示。
- 验证：五个目录共 882/882 PASS，`pnpm typecheck` PASS，`git diff --check` PASS。中途一次失败是 fixture 问题：已完成的行缺少 `endedAt`，被列表隐藏。
- tmux 终端演示：独立 `tmux -L tpdemo*` server，100×38，dark 主题；用真实 pi-tui `TuiAltScreen` + `ProcessTerminal` 挂载 TaskPanel，数据来自 fixture source；按真实按键操作，每个等待都设 10 秒上限。截了 7 张屏：列表、agent 对话详情、composer 输入、发送后、workflow 暂停、子 agent 的 s/r 提示、shell 详情。全部 PASS。
  - 第一次运行失败：`TUI` 是抽象类且没有导出，有界等待 10 秒后超时退出。
  - 演示结束时快速连按两次 Esc 没有退出，可能被合并成了一个转义序列；trap 已清理 server，确认没有残留进程。
  - 这次演示不是真实 pi CLI，也没有调用 provider。

### 阶段 4（2026-10-19）

- 改动：
  - 删除 `/agents`、`showAgentsMenu`、`showRunningAgents`、`viewAgentConversation`、`workflowMenuDeps`，以及 `ui/conversation-viewer.ts`、`viewer-keys.ts`、`workflow-dialog.ts`、`workflow-menu.ts`。
  - 新增 `/agents-config`（Agent types、Settings 两个入口，子页面返回后回到首页）和 `/agents-create`。
  - 删除 `viewerMarkdown` 设置和 `ViewerMarkdownMode`。
  - 用户和模型可见文本中原来指向 `/agents → Workflows` 的地方，改为 `/tasks` 或 `agent_manage stop`，涉及 workflow resume 拒绝提示、workflow card、`subagent_workflow` usage、`workflow-api.md`。
  - 更新 `docs/extensions/task-composition.md`（命令表、面板按键、详情布局、消息输入框和 workflow 控制）和 `PROVENANCE.md`。
- 测试：`host-loading-smoke.mjs` 改为断言 root 注册 `agents-config` / `agents-create`、不注册 `agents`，子会话三者都不注册；`tool-waits` 的 factory 改为捕获命令，新用例覆盖首页的两个入口、类型列表与 Settings 的往返、创建向导入口、旧 `viewerMarkdown` 配置可以加载且导航时不写盘。
- 中途失败：loading 测试 1 个失败，原因是旧断言仍要求注册 `agents`，属于预期变化，已更新断言；新用例因 fixture 的 `modelRegistry` 为空对象而报错，测试上下文补了最小 registry。
- 独立审查（trellis-check，agent 64cc7f66-6794-404）：没有阻塞问题。做了两处修复：
  - PROVENANCE 原来写"不改写用户文件"，实际上之后在 Settings 保存时会写入完整快照，已改为准确描述；
  - 补强测试（旧配置、Settings 往返、不写盘）。
  主会话核实后另外修正了文档：Enter 对排队中的 Agent 同样可用。审查指出调度相关的 UI 入口和文案只剩一半，留到阶段 5 处理。
- 验证：六组测试共 900/900 PASS，`pnpm typecheck` PASS，`git diff --check` PASS。
- 真实 pi CLI 的 tmux 验证：pi 1.3.0，隔离 HOME / `PI_CODING_AGENT_DIR` / cwd，加 `--offline -ne -ns -np -nc --no-mcp --no-session`，只加载本仓库的 `extensions/task-composition.ts`，没有模型。结果：
  - 输入 `/agents` 时自动补全只给出 `agents-config` 和 `agents-create`；
  - config 首页只有两个入口；
  - Agent types 和 Settings 正常显示，Settings 里仍有 Scheduling，留到阶段 5；
  - `/agents-create` 打开位置选择；
  - Ctrl+D 退出，`PI_EXITED=0`，没有残留进程，隔离目录已删除。

### 阶段 5（2026-10-19）

- 改动：
  - 删除 `schedule.ts`、`schedule-store.ts`、`ui/schedule-menu.ts`，以及仅被后者使用的 `ui/select-item.ts`。
  - 从 index 中删除 scheduler 的创建、绑定、shutdown stop/drain，`subagent_run` 的 schedule 分支和 schema 参数，Settings 的 Scheduling 项，以及 `scheduler_ready` 事件。
  - `tool-contract`、`tool-guidance`、`nested-tools` 去掉 `scheduling` 能力和 `schedule` 字段。
  - `settings` 和 `types` 删除 `schedulingEnabled`、`ScheduledSubagent`、`ScheduleStoreData`。
  - `bypassQueue` 仍被创建向导使用，予以保留。
  - 移除 `croner`：执行 `pnpm install --lockfile-only --offline`，exit 0，lockfile 只删除了 croner 的三处条目，`node_modules` 未改动。
  - 更新 docs、PROVENANCE 和 `delegation.md`，并把提到 scheduler 的注释改为准确描述。
- 测试：
  - 删除仅测试 scheduler 的 3 个用例（auxiliary-lifecycle ×2、tool-waits ×1）。backend-waits 只去掉 scheduler 部分，保留 RPC 轮次上限的覆盖。
  - 新增 AC7 用例：旧配置 `schedulingEnabled: true` 被忽略，schema 和 guidance 中没有 schedule，传入 `schedule` 会在 spawn 之前被拒绝，也不会创建 `.pi/subagent-schedules`。
  - 去掉各 fixture 中遗留的 `schedulingEnabled`。
- 独立审查（trellis-check，agent 54f1383d-469b-4dc）：没有阻塞问题。修复了 3 个 Low 问题：补充嵌套工具经注册 schema 和 execute 拒绝 schedule 的测试，修正 2 条过时注释。审查认为超出其范围的 3 条注释和 1 个 fixture，由主会话随后修复。
- 中途失败：第一次脚本修改 `tool-guidance.ts` 时断言失败，原因是还有一行 schedule 规则没有覆盖到，补上后重跑通过。整个过程没有产品测试失败。
- 验证：
  - `PI_SDK_DIR=<sdk> PI_CODING_AGENT_DIR=<tmp> pnpm check` → exit 0，1526/1526（forced-exit 全量）；
  - 不加 force-exit 的完整集成测试 `node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"` → 1188/1188，自然退出；
  - typecheck、`git diff --check` 均 PASS。
- 真实 pi CLI 的 tmux 验证：同阶段 4 的隔离方式，额外在全局 `agent-tasks.json` 中写入 `{"schedulingEnabled": true, "viewerMarkdown": "all"}`。结果：Settings 列表里已没有 Scheduling；stderr 为空；配置文件没有被改写；cwd 下没有产生 `.pi`；`PI_EXITED=0`；没有残留进程，隔离目录已删除。

### 收尾（2026-10-19）

- AC1–AC8 已逐项核对，证据见各阶段记录；PRD 已勾选，并注明未运行的项目（真实 pi CLI + 在线模型下的面板端到端）。
- 提交：阶段 1 `752313b`，阶段 2 `247e1bd`，阶段 3 `d182ef3`，阶段 4 `0855428`，阶段 5 `0811ec8`。中间穿插的 `859d132`、`24c5045` 是并行会话的提交，与本任务无关。
- spec 沉淀：
  - `development/index.md`：Task Panel 的 capability 契约（source 用同一个窗口判定生成能力位并在执行时复查，coordinator 只路由到仍在声明该能力的身份，结果通过视图状态体现、不插入反馈行，结构化 detail 有界且不带样式）。
  - `testing/tmux.md`：两层真实终端证据——没有模型的命令流用隔离的真实 CLI；需要 agent 的面板把组件挂到 `TuiAltScreen` 上，并标注证据层级；driver 的 stderr 必须落盘，避免死循环等待。
  - `testing/index.md`：删去已不存在的 scheduler ownership 覆盖项。
- 临时目录：tmux 截图所在目录在用户查看后删除；各次运行的隔离 HOME 已在当次清理。
