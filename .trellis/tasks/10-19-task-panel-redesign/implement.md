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
