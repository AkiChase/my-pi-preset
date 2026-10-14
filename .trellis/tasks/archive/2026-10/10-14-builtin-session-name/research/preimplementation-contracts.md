# 实施前 SDK 核查与最终决策

2026-10-14，用户在实施前讨论后明确“好的”，批准按收敛方案实施；仍不自动 commit/push/install/sync/reload/archive。

## 已确认的用户选择
- 默认自动开启，N=8；`/session-name config` 的自动开关与 N 全局持久化到 agent 目录，不增加会话覆盖层。
- 自动失败显示一次用户可见英文消息，保留原标题；从该失败处理位置再累计 N 次有效用户输入后重试。手动命令随时可试，失败不解除手动标题保护。
- 非关键细节采用推荐方案，不继续逐项询问；正常取消与失效不报失败。
- 不重建历史输入来源；从启用后记录可确认的输入，未知输入宁可少计，不把插件通知计入。斜杠命令（包括 skill/template）不计数。未交付排队输入不计数。已交付且主处理 settled 的输入计数，不要求主模型回答成功；aborted 的边界不自动发起命名，之后新输入可继续累计。
- 标题及手动保护按整个会话；公开改名事件与提交前名字/entry复核保护外部写入，不承诺检测跨进程直接写文件。

## installed Pi 1.2 公开合同
源码根：`node_modules/@earendil-works/pi-coding-agent/dist/`（链接到已安装 SDK，不修改 SDK）。
- `core/session-manager.d.ts:178,200–202`、`session-manager.js:197–284`：`ctx.sessionManager.buildSessionProjection()` 提供当前分支、compaction、context_edit 投影。先筛 user/assistant 可见正文及 compactionSummary/branchSummary，再序列化；不要将 custom/shell 先 convertToLlm 变成 user 后猜来源。
- `core/extensions/types.d.ts:908–933`、`extensions/runner.js:1200–1236`、`agent-session.js:1560–1663,1879–1907`：input source 为 interactive/rpc/extension；input 尚非最终接受，后续处理器可 transform/handled；持久 user message 无可靠 source/关联 ID。采用本 activation 的输入候选与已交付消息一对一保守匹配；歧义不计，不能声称任意插件组合精确归因。
- `extensions/types.d.ts:797–805`、`agent-session.js:1416–1439,1499–1558`：agent_settled 为真正自动续行结束边界，不等于成功，不以 agent_end 次数当用户次数。异步旁路请求不能阻塞 settled handler，避免用户下一输入被延后。
- `extensions/types.d.ts:583–587,1190`、`agent-session.js:3211–3215`：session_info_changed 公开但只携带 name，不携 writer；异步发事件，不能用同步 own-write boolean。以 session_info entry 身份记录自身写入；外部同标题写入也解除自动所有权。
- `extensions/types.d.ts:1271–1276`、`session-manager.js:815–819,900–940`：appendEntry 为非模型上下文 branch-linked metadata 且推进 leaf；名字读取整个 session 的最后 title。freshness 用语义投影 fingerprint 与分支路径身份，不因自己的 metadata 推进 leaf 就失效；跳转必须取消旧请求。
- `pi-ai/dist/types.d.ts:86`：timeoutMs 是 adapter/SDK 支持时的 HTTP timeout，并非统一总截止时间。本任务推荐 120000ms 总截止时间，用拥有的 AbortController+timer，等待方可取消；清理 timer/listener，不保证停止非协作 provider 内部 promise。
- `core/model-runtime.js:494–518`：registry.streamSimple 负责认证和虚拟模型路由，reasoning 捕获当前 pi.getThinkingLevel；传 sessionId 使用 SDK 的 provider 路由能力，不复制旧包自定义 HTTP/auth/payload patch。

## 执行路径与范围
主会话直接实施，避免将尚未提交的本项目 Trellis runtime/scaffolding 复制到新 worktree。独立只读代码审查可由非 Trellis lifecycle 的 general-purpose reviewer 执行；不派发能修改代码的 managed 角色、不创建临时隔离。如需 managed reviewer，必须先满足已有协议的 committed scaffolding/prepare 门禁，不擅自提交或同步这些并行基础设施。

产品文件：独立 `extensions/session-name.ts`、嵌套 `extensions/session-name/`、纯共用 `extensions/session-assist/`、对应 tests、README、manifest 与实际来源说明。保留其他 task、Recap、.pi/.trellis runtime 变更。不新增预算、truncate、compact、专用模型、独立认证或 footer 设计。
