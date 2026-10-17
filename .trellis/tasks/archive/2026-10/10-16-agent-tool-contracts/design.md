# Agent 工具组契约设计

## 1. 执行边界

本文件是实施前方案，不是实施批准。主直接实现、主自审，不启动 Agent。保留既有执行 owner、manager、coordinator、session 生命周期和公开 launch v2。不得通过普通 Agent/worktree 绕开 Trellis 绑定；当前不创建 worktree。

## 2. 工具参数表

所有工具 schema 为闭合扁平对象，不用重复 union。必填/互斥/按模式允许字段在共享准入函数验证；schema 负责字段形状，runtime 负责依赖与直接调用防御。

### subagent_run

| 模式 | 必填 | 可选 |
| --- | --- | --- |
| 主新建 | prompt、description、subagent_type | name、model、thinking、run_in_background、isolated、inherit_context、isolation（启用时）、schedule（启用时） |
| 主恢复 | prompt、resume | run_in_background |
| 嵌套新建 | prompt、description、subagent_type | model、thinking、run_in_background、isolated、inherit_context、isolation（启用时） |
| 嵌套恢复 | prompt、resume | 无 |

- prompt 始终必填；schema 将 description/subagent_type 改为 Optional，并在新建 runtime 要求非空。
- resume 一旦字段存在就进入恢复校验，空串/null/非字符串报错，不通过 truthiness 回退为新建。
- 恢复拒绝所有新建专用字段；嵌套拒绝 run_in_background 即使 false。不兼容填充被忽略的类型/描述。
- prompt/description/message 保留原内容但要求 trim 后非空；名字、模型、枚举、布尔、schedule 等沿用合法限制并补直接调用类型防御。关闭能力的字段不进入 schema，直接调用也拒绝。
- 主恢复先找到 owner 范围内目标，基于 existing.type 解析相关配置，不用 raw subagent_type 或 fallback。保留已存模型、thinking、隔离、上下文；后台选择仍由原 Agent 配置、显式参数、顶层默认依次决定。不改变 turn/transcript 政策。
- 运行/排队/paused 等尚未结束实例不可恢复：返回明确错误；manager 原实例 admission 仍是最终防竞态 gate。
- 新建 schedule 沿用现有定义/触发机制；与 resume/inherit_context 的既有禁止组合保留。定时定义不是一次执行，不伪造 execution_id。

### subagent_message

仅 agent_id、message 必填。校验非空字符串、未知字段、真实 manager ID 与 owner/运行状态后再 queue/steer。主入口不得复用 resolveAgentRef 的别名路径；@handle 继续使用自己的 resolver。返回内容区分 queued/sent 并明确不保证已处理，维持既有结果结构，无新增消息历史或确认协议。

### subagent_workflow

| 模式 | 必填 | 可选 |
| --- | --- | --- |
| 新启动 | script/scriptPath/name 恰好一个 | args |
| 重放 | resumeFromRunId | script/scriptPath/name 至多一个、args |

保留 resumeFromRunId 的 wf_ 身份及命名，不凭风格增加迁移。移除 title/description。计数按字段是否存在而不是 trim 后是否非空；空字符串及非法类型拒绝，不悄悄退回另一来源。

在工具 admission 做互斥，避免改变脚本内部 workflow() 的来源接口。resolveWorkflowScript 去除工具来源优先级指导并服从明确单来源；如果该 helper 有其他调用，逐一核实其语义，不全局收紧 resolveWorkflowSource。

重放只省略来源时使用 prior.scriptPath；缺失/不可读原文件报错。args 保持传入 JSON 值或 undefined，不默认继承旧值；journal 仍最长未变前缀缓存，失败/变更后继续实时执行。

## 3. 准入实现与错误

优先在 spawn-input.ts 扩展共享的 tool 专用纯验证，或增加同目录 tool-contract.ts；不把工具 schema 强加给 spawnTopLevel、manager 和任意内部 RPC options。共享必要字段表，不复制主/嵌套判断。

流程：activation gate → raw shape/字段/模式校验 → 查找目标/载入类型及配置 → 权限/模型/能力/来源与 meta 校验 → spawn/resume/steer/schedule/save/worker。合法 registry reload/read 可发生在类型解析阶段，拒绝输入不能产生执行写入。

错误返回统一 isError:true，既有成功 launch/usage/report wrapper 保持。修正仍活跃 resume、meta 解析、嵌套目标/steer 等拒绝路径，测试断言没有执行副作用。同步 throw/catch 均可，但不能 catch 后变成成功文本。

## 4. 配置优先与披露

复用 resolveAgentInvocationConfig，不改优先级。其 invocation snapshot 加入适用的请求/实际对比：model、thinking、run_in_background、inherit_context、isolated、isolation。

- 只披露调用方显式提供、且被配置覆盖为不同结果的字段。
- 使用稳定值比较；model/thinking 保持现有 requested/effective 语义，模型名称解析等价细节在实际回归中避免误报。
- isolation 的 off/undefined 在比较时区分原配置决策与显示结果；能力关闭仍按现有政策，不为了提示重新开放字段。
- 主/嵌套、前台/后台/恢复等有实际覆写的路径统一内容说明，必要内部类型可扩展，不新增公开 envelope 版本。
- mention model 使用注册工具；配置冲突继续成功并说明，不新增重试或 fallback。直接 mention/RPC 无显式调用请求时不伪造冲突。
- workflow agent() 配置解析若共用 helper，保持既有 hooks 行为，新增披露不变为拒绝；不扩大脚本 API 设计。

## 5. 指导所有权

新增或提取纯 guidance builder（例如 src/tool-guidance.ts），输入可用类型及注册能力/默认快照，产出 description、snippet、单组 guidelines。无需额外 prompt 框架。不能硬编码顶层默认 true，嵌套默认明确 foreground；Agent 文件仍可覆盖新建默认。

### 内容分组

- Subagent_run usage：何时委派/避免重复调查；新建/恢复参数表；配置优先；前后台与通知/agent_manage；agent_id/execution_id；权限与隔离/调度条件；提示编写；集中例子。
- Subagent_message usage：真实 agent_id、运行状态/ownership、queued/sent 非处理确认、完成后用 resume、结果用 agent_manage；集中例子。
- Subagent_workflow usage：仅明确用户选择编排时调用；互斥来源/meta/JSON args；后台 launch/agent_manage；journal 重放；hooks/限制/零Agent脚本可能性；集中例子。

workflow 长脚本 API 示例与必需能力仍保留，但从巨大 description 移入一个结构清晰 usage 组。不丢 meta、pipeline/parallel 的差异、null 容忍与 author error、schema/gate/resume/workflow nesting、并发/数量上限及无静默截断限制。不改 hooks 实现。

移除 ToolDescriptionMode 类型、sanitizer/apply/setter/state/settings menu/save snapshot、模板文件读取与专属替换函数。动态类型和条件指导用明确 builder 实现，不能误删 workflow 仍需的动态内容。旧配置是未识别字段，不做模式映射；项目/个人模板文件不删除、不读取。

注册快照与现有 settings 的生效时机保持；本任务不实现热更新 schema 或新 reload 机制。必要指导注明需新会话注册生效。

## 6. 结果与展示

保持 runtimeLaunch v2 与 AgentDetails/workflow details，不新建执行注册表。launchText 公共身份投影继续复用；所有成功启动/恢复路径携带正确 handle，终态取结果消费仍由现有 owner 完成。

消息内容显示实际 agent_id 与阶段。拒绝没有伪成功 launch；主/嵌套一致。沿用 createToolCallHeading，无新外观重构。

## 7. 文件与调用方

主要：src/index.ts、nested-tools.ts、spawn-input.ts（或新增 tool-contract.ts）、invocation-config.ts、types.ts 中相关 invocation、settings.ts、纯 guidance builder。

消费者：mention-clone.ts 及实际注册 clone 参数、cross-extension-rpc.ts/agent-runner.ts 中确实调用 tool 的路径、workflow/saved.ts、实际 host fixture 与相关 tool/loader/renderer/runtime tests。先核实，不让 internal spawn payload 变为工具 payload。

文档 docs/extensions/task-composition.md 与必要 Agent 页面只描述当前功能；开发/testing spec 记录执行契约。检查 package-owned Trellis 指导中的新建/resume 字段例子，确有改变时更新相应 adapted hash；不手改生成资源或历史基线。默认配置中的 toolDescriptionMode 若存在一并移除（不安装或修改个人文件）。

## 8. 风险、验证与回退

公开调用破坏性变更，不保留旧模式/字段/别名 compatibility。完整仓库消费者同阶段更新；用户外部迁移。阶段 commit 可单独用于后续显式回退，当前不授权自动 revert/history rewrite。

高风险点为模式分流、mention clone、nested owner 和保存前拒绝；主自审配合实际 factory/host schema/natural-exit 验证。没有独立 Agent review（用户限制），无线上模型/真实终端验证，不宣称这些已通过。

实施前必须完整读取待编辑文件和实际调用方/测试；本规划定位证据不是完成代码审查。技术小调整只可在上述范围内，若影响权限/后台能力/脚本 API 等产品边界需重新确认。
