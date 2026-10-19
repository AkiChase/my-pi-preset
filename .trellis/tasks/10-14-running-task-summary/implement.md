# 实施计划：后台任务提醒

## 授权与当前状态

- 用户已授权自主技术验证、逐阶段实施/检查/本地提交、独立审查、隔离 tmux 测试与最终收尾；不授权 push、SDK 修改、安装依赖或个人实例操作。
- 前置核实发现阻塞后，用户选择**方案 B**（现有公开接口；run 中途自动压缩后晚一请求为已知限制）。
- 主会话直接实现，独立 trellis-check 审查（跨模型输入/缓存前缀与 runtime owner）。implement.jsonl 有意为空；dispatch reviewer 前策划 check.jsonl。

## 前置核实：正常追加接口（已发现阻塞）

- [x] 核实公开 before_agent_start message、turn_end custom_message drafts、请求准备与成功压缩顺序。
- [x] 独立只读 SDK 审查与 main 源码复核一致：Pi 1.3.0 没有在所有请求相关压缩之后、dispatch 之前正式追加 custom_message 的公开 actionable boundary。
- [x] 实际 SDK `AgentSession.prototype.sendCustomMessage` 离线调用确认：streaming 时 display:false / triggerTurn:false 只排队，不立即追加；退出码 0。
- [x] 精确第 N 次目标请求前与“run 中途压缩后” fresh 提醒在现有公开接口下不可同时实现；记录为阻塞，交用户决策。

决定性反例：第 7 次请求及工具结果完成 → turn_end 提交提醒 → prepareNextTurn 自动压缩 → session_compact 被动发送新提醒只排队 → 第 8 次请求先发出 → 第 8 次 turn_end 才 flush。提醒即使被压缩保留，也不是压缩成功后生成的最新提醒。

最小所需能力：公开 awaited 请求前追加 boundary，覆盖初始/续轮/重试，位于包括 virtual routing 压缩在内的所有压缩之后，提交隐藏 custom_message 并用更新 projection 发出当前请求，不引发额外 continuation。当前 SDK 无此接口；修改 SDK 或放宽语义属于原范围外，须另行决定。

源码锚点（安装 1.3.0）：agent-session.js:425–562、1815–1875、2556–2571；pi-agent-core/agent-loop.js:95–142；extensions/types.d.ts:613–620、754–798、1194、1257–1276。

验证命令：`node --input-type=module`，直接调用安装 SDK 的 `AgentSession.prototype.sendCustomMessage.call`，使用仅含 isStreaming/pending queue/append spy 的离线 seam，断言立即 append=0、pending=1、display=false。不是完整 provider 或压缩端到端测试，未读写个人配置、session，不产生临时文件。完整压缩时序来自真实源码及独立审查，不将该小测试声称为端到端证据。

当时按“明显问题停下”暂停（未 start、未改产品代码）。用户随后选择方案 B，恢复实施。

## 阶段 1：方案 B 实现（完成）

- [x] `task-ui/config.ts`：`backgroundReminderInterval` 默认 8，非负安全整数，非法值警告回退 8；配置测试。
- [x] `task-ui/types.ts` + `process-tasks/source.ts`：可选 `reminderTitle`，仅来自 `job.name`，不回退命令。
- [x] `runtime-tasks/reminder.ts`：筛选、身份、清洗、耗时、状态、预算、固定 system 规则。
- [x] `runtime-tasks/reminder-owner.ts`：context 仅计数；turn_end 草稿（保留其它草稿）；before_agent_start 固定 section + 补充提醒；session_compact pending；scheduledFor 去重；session_start 重置；onClose 注销。
- [x] `task-composition.ts`：仅非子会话注册。`host-loading-smoke.mjs` 期望改为子会话少 2 个 session_start handler（Agent manager + 提醒，均为 root-only）。
- [x] 测试：`reminder.test.ts`（5）、`reminder-owner.test.ts`（3）、`reminder-sdk.test.ts`（3，真实 AgentSession + 离线 scripted provider）、配置测试 +1。
- [x] 用户文档 `docs/extensions/task-composition.md`：「后台任务提醒」章节与配置项，含已知限制。
- [x] 自审 + 独立 trellis-check（无阻塞缺陷）。采纳建议：去掉 `fromTurnEnd` 旁路，统一 `scheduledFor` 去重；设计文档改为与实际一致的 lifecycle 作用域（不另做 sessionId 比较）。

## 验证记录

环境：Pi 1.3.0（已安装 SDK，`pnpm link-sdk` 仅链接），Node v24.14.1，tmux 3.6a；所有命令使用临时 `PI_CODING_AGENT_DIR`。

| 命令 | 结果 |
| --- | --- |
| `node --test extensions/runtime-tasks/__tests__/reminder.test.ts extensions/task-ui/__tests__/config.test.ts` | 首次 FAIL 1：夹具 root/queued 开始时间相同，按 key 排序（设计如此）；修正夹具后 PASS 8/8 |
| `node --test extensions/runtime-tasks/__tests__/reminder-sdk.test.ts` | 首次 FAIL 1：手动压缩报 “Nothing to compact”（默认 keepRecentTokens 过大）；夹具设 `keepRecentTokens: 1` 后 PASS 3/3 |
| 定向套件 runtime-tasks/process-tasks/task-ui/agent-tasks（自然退出） | 首次 771 中 FAIL 1：`loading.test.ts` 的 smoke 期望子会话 session_start 仅少 1；提醒为 root-only 属预期，更新期望后 `loading.test.ts` PASS 2/2 |
| `pnpm check`（隔离，修正后） | exit 0，1491/1491 |
| 独立审查后最终代码：定向 16/16、`pnpm typecheck` exit 0、`pnpm check` exit 0 1491/1491 | PASS |

### tmux 真实 CLI（离线 scripted provider，`backgroundReminderInterval: 3`）

隔离：唯一 `tmux -L` server、`env -i`、临时 HOME/agent/sessions/cwd/logs，`--no-extensions` 等禁用发现，仅 `-e` 加载夹具 provider 与本 checkout 的 `task-composition.ts`；未调用在线 API。夹具与报告：`evidence/tmux/`（`driver.py` 默认把屏幕/事件写到新临时目录）。

- 第 1 次：全部断言失败，原因是夹具后台命令 `sleep 120` 被现有 sleep 防护拒绝，没有后台任务（产品“无任务不提醒”正确）。改用 `tail -f /dev/null`。
- 第 2 次：前 3 项 PASS；压缩等待条件写错（压缩视图替换了原文本）导致超时，屏幕确认压缩成功。改为等待 `Compacted from`。
- 第 3 次（最终）：5/5 PASS——第 3 次请求（新用户 run）提醒紧邻用户消息之前；提醒仅含 `shell | <task_id> | long sleeper | 0s`，无命令；其它请求无新增提醒；`/compact` 后下一请求末尾有最新提醒；TUI 屏幕不显示提醒。`/quit` 正常退出，无残留后台进程，测试 server 已停止，临时目录已删除。
- 观察：该次压缩前 turn_end 已写入周期提醒，压缩后又写入一份（见设计 4.1 第 3 点，预期行为）。

### NOT_RUN / 限制

- 在线 provider、真实缓存命中、真实模型行为未测。
- run 中途自动压缩后晚一请求（已知限制）只在单元级 owner 测试中覆盖，未做端到端。
- Agent/workflow 类型在 tmux 中未启动真实子 Agent；由单元与 SDK 测试覆盖格式与筛选。

## 阶段 2：最终集成验收

- [ ] 比较 AC1–AC9；不把 mock handler 或 UI 模拟当作真实模型输入证据。
- [ ] 真实 SDK 离线 provider 捕获默认第 8/16 次及自定义周期请求、成功压缩后的下一请求、周期重合、隐藏消息、历史稳定和完整 system transitions。
- [ ] 验证取消/会话切换/reload/shutdown 后无旧状态、无额外执行/通知消费；定向 tests 不用 force-exit。
- [ ] 隔离现有 SDK 和临时 agent dir 运行类型检查及全量 suite。
- [ ] 评估 reusable specs 更新，只写有证据的契约；具体 tool 教学不搬入用户文档。用户可见行为变化才更新已有功能页，不新增内部实现说明页面。
- [ ] 使用已有 tmux/CLI 建立唯一测试 server 和临时 HOME/agent/cwd/session/log，env 隔离并明确加载本 checkout；使用本地 scripted provider，不调用在线 API。
- [ ] tmux 验证真实请求中的提醒与 UI 默认隐藏、自定义周期/0、压缩后提醒、正常 quit 及 owned process cleanup；完整输入证据与 pane capture 分开，未测项目明确 NOT_RUN。
- [ ] 技术核实/验收通过后按既有收尾授权归档并记录 journal；未满足验收不归档。

既有环境隔离范式：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')" || exit
agent_dir="$(mktemp -d)" || exit
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

原始输出、临时 driver/provider/session 都放自己创建的仓库外 run 目录；完成诊断前保留。最后由 main 记录精确命令、环境、退出码、首次失败/修复/重跑和 NOT_RUN 限制，不依赖临时链接作为唯一证据。

## 风险与回滚

- 已知限制：run 中途自动压缩后的那次请求晚一请求收到最新提醒；完整解决需 Pi 新增请求前 boundary（范围外）。
- 普通 context 改写可能合并 system 历史，owner 的 context handler 只计数、不修改。
- 不使用 sendMessage、continue、临时注入、历史重放或 private session append。
- 回滚：移除 composition 注册即停止新提醒；已写入的隐藏消息保留，不清理用户 session。
- 在线 provider 缓存命中、真实远端压缩、第三方 context transformer 组合未验证。

## 本轮规划核实记录

- 读取任务 PRD/task.json/空 manifests、项目 workflow/spec、实际 composition/source/capability/identity 与 SDK 安装源。
- 原定位 `extensions/task-runtime`、`task-source.ts`、`identity.ts`、`summary.ts` 不存在；通过实际目录定位为 runtime-tasks、source.ts、execution-id.ts，未据旧路径设计修改。
- 关联 runtime-task-tools 已归档；当前 tools 为 agent_manage/process_manage，不沿用旧 PRD 工具名。
- SDK 只读研究代理已完成，main 复核关键 runner 恢复/发送队列/投影 API 源码；未运行 provider、测试、产品实施或创建临时报表。
- 本轮只修改本任务 prd/design/implement，绑定仅本 session，任务 status 仍 planning。
- 后续讨论确认按模型请求计数、默认周期 8、共享 task-ui.json 配置，并授权更新文档；移除已撤回的影子历史/锚点重放实施路线。
- 随后获自主验证、实施、隔离 tmux 测试和最终收尾授权；正常请求前追加接口仍待核实，若明显阻塞须停。未运行产品实现或测试。
