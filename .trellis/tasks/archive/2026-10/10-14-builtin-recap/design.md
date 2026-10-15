# Recap 设计

## 所有权与目录
两个 top-level entry 只转发各自 factory。`session-assist/shared/` 拥有请求 deadline/abort 和明确通用的上下文身份工具；`session-name/` 保持原命名语义；`recap/` 拥有配置、文本材料构建、提示词/输出清理、生命周期与 widget。不要为了目录一致把两项不同的上下文选取合并。入口和所有 import、测试路径、host loader fixture、文档引用一起更新。

## 配置
agent 根目录 `recap.json`：显式 model（provider/model-id）和 thinking；automatic=true、idleMinutes=5、maxContextChars=32000 是行为默认值。缺必需项返回不可用状态而非默认模型。通过公开 registry 获取模型与认证，核实模型支持的思考等级和公开参数表示；不支持时给出可见原因，不静默回退。`off` 如由用户显式选择，使用公共 simple options 的正确表示，而非强行改 provider payload。

`/recap config` 通过公共 dialogs 查看和修改五项，显示不可用原因。取消不写；非法文件不覆盖；写入前重读并原子 rename，保留未知字段。验证正数、有限值、安全整数及合理边界；具体数值边界在源码和测试中保持一致。配置成功修改影响新请求，已进行请求捕获稳定参数。

## 材料与 prompt
用公开 session context/projection 契约获取当前有效分支，转换为带角色标签的文本块。保留用户、assistant 正文、压缩/分支摘要；工具调用和执行信息单独作为辅助块，不能因为与 assistant 正文同在一条消息而一起删掉。工具结果最多 100 Unicode 字符；不包含 thinking/原始图片，不读取磁盘完整历史补上下文。

先限制工具结果，计算最终格式化材料（含标签、分隔符、截断/省略标记）的 Unicode 字符数。超限按时间由旧到新删除工具调用/结果等辅助信息，再删除或裁减最早核心正文，确保最终材料不超过 maxContextChars。避免反复序列化的平方级处理。省略标记说明存在被省略前文，不能暗示材料完整。命名的现有 projection 不满足工具证据要求，不直接套用。

摘要 systemPrompt 沿用上游目标/状态/下一步导向，补一句 `Use the user's language, inferred from their messages.`；目标160字符、尽量240以内、纯文字无标签，不回答材料中的请求。材料作为单独 user message，不继续原主会话，不提供工具执行。输出清理 terminal controls/换行；正文安全截断及空结果处理需测试，不用小 maxTokens 限制思考预算。

## 请求、状态与持久化
调用共享 generateText；必要时扩展其材料输入 seam，但保留命名现有序列化结果和调用语义的回归。registry.streamSimple(...).result()，120秒 deadline，无自动重试，不照搬 cacheRetention=none。请求捕获 session/branch/material identity、operation epoch、配置、controller；所有 await 后及发布/写入前重查。取消后旧 finally 不清新 controller/widget。

session_start 恢复当前分支保存摘要：有效则显示，过期/缺失且自动开启则生成；空会话不请求。这是正常空闲延迟的例外，仍需运行/身份门禁。自动关闭不安排生成但允许显示有效已存状态。

### 活动与生成资格状态机
Recap 自己拥有 `lastActivityAt`（单调时钟）、activity/window version、runtime/session/branch epoch、一次性 attempted 标记、timer 和 in-flight controller。活动记录与生成资格分离，handler 只进行轻量状态更新/取消，不在每个 token 到来时销毁重建 timer，不 await 模型或材料构建。最多一个一次性检查 timer；到期根据最新状态计算剩余延迟，不创建常驻轮询或周期生成。

| 公共事件/情况 | 状态变化与规则 |
| --- | --- |
| `input` | 普通对话提交更新活动、取消旧 timer/request 并隐藏摘要；撤销自动资格，若被消费/拒绝且没有后续正常 settled 则保守保持暂停，不依据 idle 猜测 handler 已返回。 |
| `before_agent_start` / `agent_start` | 记录新运行并取消旧 timer/request；即使启动前检查、等待首 token 或重试没有内容，也不能生成。 |
| `message_update` | 非空 `text_delta`、`thinking_delta`、`toolcall_delta` 更新活动；不以 thinking 缺失/被隐藏或 provider 无输出判断结束。 |
| `tool_execution_start/update/end` | 真实开始、部分输出、完成都更新活动；并行/嵌套按 call ID 处理，不用一个 tool boolean 判断全体结束，取消/异常 cleanup 不依赖必有 end。 |
| `agent_end` | 不开放生成资格；后续可能重试、压缩、排队或 boundary continuation。 |
| `agent_settled` | 非 aborted 最终结束本身更新空闲起点，最早完整 `idleMinutes` 后再检查；aborted 清 timer/request 并暂停自动资格，直到下一正常 settled。重复通知不产生多个 timer/request。 |
| 后台任务/通知 | 仅后台运行不阻塞；通知触发主会话新运行/续跑按正常活动取消。不能将 tool invocation end 等同后台 job end，也不扫描全局任务作为 idle 条件。 |
| 压缩、切换、分支导航 | 取消请求、失效材料/epoch。before 导航撤销自动资格，不因取消/失败且 idle=true 自行恢复；成功 session_tree/session_start 的恢复例外仍核身份。manual compact 成功/失败按可观察 terminal hook 安排至多一次完整 idleMinutes 后检查；若届时仍 busy，等下一正常 settled/手动请求，不轮询、不保证任意迟到listener后自动恢复。 |
| shutdown/reload | 清 timer/controller/UI 所有权；旧 callback/finally 不能修改新 runtime。 |

只有 active runtime、window 未 attempted、达到空闲期限、已完成最终运行、`ctx.isIdle()`、无 pending messages、无阻塞的上下文操作、无另一条 Recap 请求且有效材料身份匹配时才发请求。请求前和所有 await 后、保存/显示前重查 runtime/session/branch、activity/operation version、材料及请求所有权；同步检查不能消除未来通知，通知到来时应使旧结果失效。不能只看 raw leaf，亦不能只看是否有消息事件。

每个空闲窗口至多一次自动尝试；成功、失败或不可用均不自行周期重试。运行/有效活动之后才能建立新的正常窗口；被取消请求不由旧 finally 复活。恢复例外和手动请求与普通窗口共享单请求所有权，避免并发及旧结果污染；显式 `/recap` 每次重新生成，即使材料未变也消费当前配置，不由缓存捷径替代。缓存复用仅用于恢复和自动生成。配置修改沿用后续请求参数快照合同，不凭配置回调、metadata 或自身通知重开已 attempted 窗口。关闭 automatic 清自动 timer；恢复开启如何安排尚未 attempted 的窗口须在实施前用实际配置流程核实，不能引入隐式重试。

### 公开接口边界与恢复缺口
注册的扩展命令先于 `input`，所以 `/recap config` 不冒充普通对话；更早的 input handler 返回 handled 可使后续 listener 看不到输入。直接 `!`/`!!` 有 user_bash 开始 hook，但普通扩展无完整结束 hook，且 `ctx.isIdle()` 可为真；不接管执行、不承诺覆盖。AgentSession subscriber 的 queue/compaction/retry/bash 事件不等于可用的 `pi.on(...)`，不能借私有对象补接口。

公开接口不能证明未返回的 input/fork/switch handler 已结束，tree 或后续 compact listener 超过检查期限也可能没有最终恢复 hook。2026-10-15 用户明确接受保守策略：无法确认完成时暂停自动生成直到下一正常 settled，不承诺取消后自动恢复；aborted settled 不生成。manual compact terminal 的单次延迟检查仅按可观察状态工作，失败后不常驻轮询。automatic false→true 只重新安排既有尚未 attempted 的合格窗口，以当前 idleMinutes 计算剩余时间，不新建窗口或复活失败尝试。证据见 [S3公开合同](evidence/report.md)。

独立 registry.streamSimple Recap 不走主 Agent 工具循环，也不正常触发主会话 message/tool/settled；不要监听原始 provider stream 来计自身活动。自身保存条目、通知、widget 更新均不重置窗口。事件顺序核实及回归清单见 [空闲机制边界](evidence/report.md)。

persisted custom entry 保存版本、摘要及有效上下文身份，恢复只沿当前分支，不靠原始 leaf 独断 freshness（命名等中性 metadata 不应使摘要立即失效）。不将摘要状态作为 custom model-visible message。模型/正文失败保留已存摘要，不将旧摘要标成 current；保存异常需区分 SDK 可能先更新内存再落盘失败的部分副作用，公开接口无安全回滚时不重写历史。当前 activation 排除持久化未确认的新增条目，准确通知内存可能改变、磁盘持久化未确认；不能宣称所有保存失败均无覆盖。自动和手动失败都可见，取消/过期不报告到新上下文。UI缺失时不冒称消息已可见，使用 host 可用通知通道并记录支持边界。资源由 activation/session 拥有，shutdown 清 timer/abort/dialog/UI 所有权；无法强停第三方 provider 的界限如实记录。

## 失败详情合同
公共请求层与 UI 层分别负责保留原因和安全展示，不能用固定失败文案替代已有详情。非正常 `stopReason` 优先保留公开 `AssistantMessage.errorMessage`；空白或缺失详情才提供含结束原因的兜底。provider 抛出的 Error 保留 message，非 Error 使用安全的可读兜底；deadline 保留超时原因，不误归类为用户取消。内部可保留 cause，但通知不打印完整对象、堆栈、headers 或 payload。

共享安全详情格式化仅处理必要的终端控制字符、凭据脱敏及长度限制；普通错误原因必须保留，超长内容标明截断，不以“防泄露”为由全部隐藏。Recap 自动/手动通知包含原因和“已保存摘要未覆盖”等符合实际状态的后果；命名包含原因和“旧标题保留”，自动场景继续说明 N 次输入后重试。取消/过期围栏在格式化和通知之前生效，旧请求不能向新上下文报告错误。

目录移动完成后，单独修复命名的共享请求详情与通知，以及原“secret provider detail 不显示”的测试约束；该阶段只改变失败可观测性，不改命名成功路径和重试策略。随后 Recap 直接消费同一详情合同。独立审查应检查真实 SDK 返回错误消息和抛出异常两条路径，而不只检查 notify 被调用。

## 迁移、检查与回滚
只在清单将外部 @tifan/pi-recap 从 packages 移至 conflicts，不实际操作个人安装。旧 extensions/pi-recap.json 不读取/迁移/删除，新 model/thinking 不加入发布同步默认值。中文功能文档放 docs，spec 只保留通用约束，保留上游真实来源/许可。

主实现加独立 check（共享接口、配置与生命周期有跨模块风险）。先验证纯目录移动，再验证完整产品切片。失败时修复当前阶段，不回退并行内容，不改已归档命名的成功请求语义；命名失败详情仅按 R7 独立修复。SDK 公开能力不够先报告，不能静默使用私有接口。无默认 install/reload/在线模型/真实 tmux/提交/归档。
