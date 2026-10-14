# 修复 Subagent 完成通知可靠性

## 目标与价值

程序化派发的 subagent 正常完成后，父会话能够收到准确的完成通知；通知失败必须可见，不能因无效描述、错误运行标记或已停止组成员而静默丢失或不必要延迟。保留现有执行、取消、消费与会话隔离语义。

## 授权与状态

- 用户已同意前述修复方向，并于本会话明确要求“开个 task”。
- 用户已批准在主 worktree 实施及 scoped 本地阶段提交；失败提示按后续确认精简，不新增持久诊断。
- 计划主会话直接实施，独立检查公共 RPC 与跨模块通知契约；不修改已部署副本。

## 背景与证据

- 原诊断：`.trellis/tasks/10-14-runtime-task-tools/research/completion-notification-diagnosis.md`。历史两次 managed 派发记录 completed、缺少 description 且无对应通知；第三次合法描述代理的约 15 分钟延迟原因尚未确认。
- 当前本地与部署副本的 `index.ts`、`cross-extension-rpc.ts`、`agent-manager.ts`、`xml.ts` 四文件 hash 相同。
- 本会话实际 RPC + factory + manager + 离线 runner 复现：缺省 description 和数字 description 均派发成功、completed、通知 0 条；合法字符串通知 1 条。复现不调用模型、不安装、不修改产品源码。

## 需求与约束

### R1：入口描述契约（当前故障主因）

证据：`extensions/agent-tasks/src/cross-extension-rpc.ts:121,164`、`src/index.ts:747,753`、`src/agent-manager.ts:196,649`、`src/index.ts:198`、`src/xml.ts:12`。

- 程序化公共入口与 manager admission 使用一致契约：缺省、null、空白描述回退为已解析 agent 类型名；非空字符串保留；数字、对象、数组等非法类型在创建 record/runner 前拒绝。
- 对 RPC type、prompt、options 做必要结构校验，不扩大为所有配置重构；缺省 options 仍合法，错误请求可按有效 requestId 返回明确失败。
- 规范化描述传入 record 与 cleanup；runner 不读取描述、不新增参数。不以 `String(undefined)` 或仅 renderer fallback 掩盖错误。
- 不依赖 pi-trellis 补描述，不更改其产品源码或公开 RPC version。

### R2：通知失败可见

证据：`extensions/agent-tasks/src/index.ts:507–513` 删除 pending timer 后吞所有同步异常；正常完成不会自动补偿重发。

- 失效 activation/run、已消费或 active wait 的通知保持正常跳过。
- 构造或同步投递抛错时，有 UI 时显示简短英文 warning，无 UI 时输出简短、安全的错误日志；不新增持久诊断记录、查询入口或诊断 schema。
- 诊断 sink 自身失败逐项隔离，不能影响兄弟通知、结果检索、执行清理。
- 失败不标为 notificationDelivered，结果保留可检索；第一版不增加自动重试或通知 outbox。

### R3：单条通知的运行身份保护

证据：`extensions/agent-tasks/src/index.ts:526–538` 在 sendMessage 后直接写可变 record；独立内存 mock 复现发送路径同步 resume 后新 run 被误标已通知。

- 发送前捕获 record/runId；发送返回后只有 activation 有效、manager 仍持有同一 record 且 runId 未变时，才标原 run 已提交通知。
- notificationDelivered 仅表示已提交 SDK，不宣称持久化成功或父模型已消费。
- 保持现有 group run 快照保护。

### R4：停止组成员及时结算

证据：`extensions/agent-tasks/src/index.ts:551,2428–2434`、`src/agent-manager.ts:1366–1378`、`src/group-join.ts:59–109`。stop 已公开 terminal，但 runner 未退出时 isRunActive 阻止 group 结算，兄弟被延至 30 秒 partial，并误称 others still running。

- grouped stopped 成员立即计入组终态，不生成其自身完成通知，不等待 runner/cleanup 返回才释放兄弟通知。
- execution drain 与任务终态保持分离；不伪造执行已结束、不强杀 provider。
- 真正仍未终态成员保留现有 partial timeout；消费、等待、resume 与 shutdown 语义不变。

## 验收标准

- [x] AC1 / R1：实际 RPC 不传/null/空白 description 均使用默认类型名完成，通知恰好一次；非空字符串正常。
- [x] AC2 / R1：非法描述及必要的 malformed RPC payload admission 前失败，无 record、runner 或池计数残留。
- [x] AC3 / R2：合法通知构造/同步投递失败有简短安全 warning/日志，未标已通知、结果仍可取，不自动重试。
- [x] AC4 / R2：warning/日志 sink 抛错不阻塞兄弟通知或 cleanup；不产生持久诊断 entry。
- [x] AC5 / R3：sendMessage 内同步 resume 同一 agent，旧通知不会污染新 run，新 run 完成可正常通知。
- [x] AC6 / R4：组内 stopped runner 不退出，已完成兄弟无需等待 30 秒即可通知，文案不误称 stopped 成员仍在运行。
- [x] AC7：正常消费、取消等待、group partial、resume 与 shutdown 现有回归保持通过；不改变实际取消与执行清理机制。
- [x] AC8：针对性测试、strict 与整体测试通过；独立检查及主会话实际 diff 复核完成，明确未执行的真实 provider/PTY 验证。

## 排除与风险

- 不处理历史约 15 分钟延迟，除非后续独立调查闭合其根因；不将其归因于本次四项缺陷。
- 不增加 SDK 投递确认、自动重试、幂等队列、跨会话恢复或通知 outbox。
- 不修改 pi-subagents 外部发布包、pi-trellis、Pi SDK、个人部署配置；不安装、同步、reload、push 或归档。
- 公共入口接受缺省描述是明确行为；错误类型拒绝可能暴露调用方既有不合法用法，需独立 review。
- SDK void sendMessage 的异步失败仍由 SDK 上报；本任务不承诺插件收到持久化确认。

## 规划收敛

已按目标、证据、需求、验收与排除整理；无阻塞产品问题。技术实现细节及命令见 design.md / implement.md。角色派发前再准备 check.jsonl，当前空 manifest 不代表已通过上下文验证。
