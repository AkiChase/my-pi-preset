# 实施计划

## 门槛

- [x] 前置接口已落地：`10-16-runtime-tool-contracts`、`10-16-agent-tool-contracts`、`10-17-agent-tool-nullable-contracts`（均已归档）。
- [x] 2026-10-19 与用户逐项讨论并确认 D1–D14。
- [ ] 用户批准实施。
- [ ] 实施前读取 `.trellis/spec/` 相关索引与测试指南（含 `testing/tmux.md`），复核 design §1 代码位置。
- [ ] 执行方式：主会话直接实现；阶段 1、2、3 完成后各由 `trellis-check` 独立审查（用户已确认可用）。派发前整理 `check.jsonl`；`implement.jsonl` 故意为空，start 使用 `--allow-empty-context`。

批准后按 workflow 对每个已验证阶段做 scoped local commit；push / install / sync / reload / 真实 provider 测试另需授权。tmux 本地终端检查属于批准范围内的验证。

## 阶段 1：子侧通道与 mailbox

- mailbox（请求 / 消息 / 上限 / 生命周期关闭）与受限父通道。
- `agent-runner.ts` 为非 workflow 新建子会话预置 `reply_to_parent`（customTool 保活）；resume 不改声明。
- 子侧校验：nullable 归一化、空白 / 超长、发送上限、未知 / 已回复 / 跨执行 `request_id`、通道关闭。
- 测试：声明在创建 / 问答 / resume 前后字节一致；isolated / 自定义工具列表仍有工具；workflow 子代理没有；执行结束 / resume / shutdown 后迟到调用被拒。
- 独立审查 → 主会话核实 → scoped commit。

### 阶段 1 记录（2026-10-19）

- 实现：`extensions/agent-tasks/src/parent-messaging.ts`（mailbox、`ParentChannel`、`reply_to_parent`）；`agent-manager.ts`（非 workflow record 创建 mailbox、按当前执行解析的通道、`createParentRequest` / `failParentRequest` / `subscribeParentMessages`、终态 / settle / 移除 / freezeAdmission 关闭）；`agent-runner.ts`（`parentChannel` 选项，与 StructuredOutput 同级的宿主工具注入）；`types.ts`。
- 自检：`pnpm run typecheck` exit 0；`node --test extensions/agent-tasks/__tests__/*.test.ts` 257/257；隔离 `pnpm check` exit 0（1501/1501）。
- 独立审查（trellis-check，execution `exec_WyJlNWEzZTU0NS1lNjZjLTQxMyIsIjEiXQ`）：
  - Medium（已修）：停止时 pending 请求要等 runner 实际退出才关闭，不配合取消时 waiter 可能悬挂。改为 `resolveTerminal` 即关闭；审查者新增 4 个测试（停止关闭、record 移除、listener 重入、`disallowed_tools` 不剥夺工具），并验证去掉修复时测试失败。
  - Low（已处理）：关闭原因新增 `stopped`；保留最近 5 次执行的上界写入 design §4。
- 修复后复验：typecheck exit 0；agent-tasks 全套 260/260；`git diff --check` 无输出。
- 并行修改：工作树中 `extensions/task-ui/panel.ts`、`panel.test.ts`、`detail-view.ts` 及 `.trellis/tasks/10-19-task-panel-redesign/` 属另一任务，未触碰、不纳入本阶段提交。

## 阶段 2：顶层父侧提问、送达与展示

> 2026-10-19 暂停：`10-19-task-panel-redesign`（in_progress，未提交）将修改 `agent-tasks/src/index.ts`、`source.ts`、task-ui 详情页与 `docs/extensions/task-composition.md`，与本阶段重叠。用户选择等待该任务完成并提交后，再基于其新详情页布局实施阶段 2–4。恢复前重新复核 design §1 的代码位置与详情页接口。

- 主 `subagent_message` 增加 `reply`（schema、类型、准入、usage）；`reply: null` 回归锁定。
- 两条消息投递（含 pending 队列有序 flush）、请求上限、投递失败。
- `reply: "wait"`：接入 `waits.ts`，replied / cancelled / released / execution_ended。
- 送达：entry 卡片 + renderer、`display: false` 上下文消息、per-agent 合并、等待中暂存并附结果（前台 `subagent_run`、`agent_manage wait`）、释放时转送达、先于完成通知 flush、失败提示。
- 任务面板最新消息、详情页 Messages 区块。
- 测试：多请求不串、四种父状态送达、同 tick 回复与终态、多 waiter、无 timer 泄漏、shutdown 隔离、Beautify 与 task-ui 回归。
- 独立审查 → 主会话核实 → scoped commit。

### 阶段 2 记录（2026-10-19）

- 实现：新增 `parent-delivery.ts`，在收到子消息时即时 `appendEntry` 对话卡片；非等待态经 `sendMessage({ display: false }, { triggerTurn: true, deliverAs: "steer" })` 一次性进入父上下文。`subagent_message` 支持 `reply: null | "wait" | "notify"`，问题以有序 steering 正文 + `<parent-request … />` marker 投递；前台 launch、`agent_manage wait` 与 reply wait 均把等待中的消息附加回工具结果。`source.ts` 与 task UI 暴露最新消息和带预算的详情 `Messages` 区块。
- 独立审查（trellis-check，execution `exec_WyJhNzVhNzcyNS00N2U5LTQ0YiIsIjEiXQ`；原 Trellis host 被打断后以同角色新执行恢复）：
  - High（已修）：reply wait 在 Esc / detach 后仍保留 mailbox waiter，随后回复会被吞掉。lease cleanup 立即取消 waiter；只有 completed wait 才取得 held messages。
  - Medium（已修）：持久化卡片 payload 允许终端控制序列；渲染前清理。详情问题原先静默截断 2,000 字符且不遵守 detail budget；现保留预算内最新完整 entries 并显式显示 omitted 数。
  - 审查者新增 detach race、控制序列、超长问题与 task panel 消息行 / selection 映射的回归覆盖。
- 复验：`node --test extensions/agent-tasks/__tests__/parent-messaging.test.ts extensions/agent-tasks/__tests__/parent-delivery.test.ts` 25/25；`pnpm run typecheck` exit 0；task-ui + tool-contract 78/78；主会话最终 `pnpm check` 1538/1538，均使用临时 `PI_CODING_AGENT_DIR`；`git diff --check` 无输出。
- 未运行真实 provider 或 tmux 终端验证（留阶段 4）；嵌套交付为阶段 3 范围。

## 阶段 3：嵌套支持

- 嵌套 `subagent_message` 增加 `reply`，与主入口准入一致。
- 嵌套父通道：父子代理运行中 steer 送达、前台等待附结果、已结束仅记录。
- 测试：嵌套问答、父子代理结束后不唤醒、与主入口行为一致。
- 独立审查 → 主会话核实 → scoped commit。

### 阶段 3 记录（2026-10-19）

- 实现：`nested-tools.ts` 将嵌套 `subagent_message` 对齐主入口的 nullable `reply` 契约。直属孙代理的已接收消息只通过正在运行的直属父 `AgentSession.sendCustomMessage({ display: false }, { triggerTurn: true, deliverAs: "steer" })` 送达；不走根 `pi`、不创建卡片。前台嵌套 launch 与 reply wait 暂存消息并附在自身工具结果中，父已结束/已恢复时仅保留 mailbox 记录。
- 独立审查（trellis-check，execution `exec_WyIwOWMwMjQ0NC04MWM1LTQ2OCIsIjEiXQ`）：
  - Medium（已修）：异步 ordered steering 只捕获 record，child resume 后旧 `<parent-request>` marker 可能进入新执行。现每次发送都围栏校验 admitted `runId` 和 running 状态，失败关闭请求；增加 resume race 回归。
  - Low（已修）：嵌套问题结果及 delivery details 未使用 canonical `exec_…` identity；现统一由 `executionId` 编码。
- 复验：审查者 focused 73/73、typecheck exit 0、`git diff --check` 无输出；主会话最终 `pnpm check` 1540/1540（临时 `PI_CODING_AGENT_DIR`）。
- 未运行真实 provider 或 tmux 终端验证（阶段 4）；workflow child 仍刻意不支持。

## 阶段 4：文档与集成验证

- 中文用户文档：实际 owning 文档（预计 `docs/extensions/task-composition.md`）说明功能与限制；不写模型参数教学。README 如有索引仅简述。
- spec：仅记录有证据的通用约束（即时可见用 appendEntry、上下文用 display:false sendMessage 等）。
- 全量验证、tmux 真实终端检查卡片位置与详情页、AC 逐项核对 → scoped commit。

## 验证命令

```bash
node --test extensions/agent-tasks/__tests__/<new>.test.ts   # 阶段内定向
pnpm run typecheck
pnpm run test
pnpm run check
git diff --check
```

`pnpm` 脚本会运行 `scripts/link-pi-sdk.mjs`；不安装、不获取依赖。现有相关测试：`tool-contract.test.ts`、`nullable-schema.test.ts`、`tool-waits.test.ts`、`backend-waits.test.ts`、`input-errors.test.ts`、`extensions/beautify/__tests__/registered-agent.test.ts`、`extensions/task-ui/__tests__/*`。

## 后续任务（不在本任务内）

- `agent_manage` 输出与查询能力（running output、消息 / 对话查询、`verbose` 去留），基于本任务 mailbox。需用户批准后另建。
