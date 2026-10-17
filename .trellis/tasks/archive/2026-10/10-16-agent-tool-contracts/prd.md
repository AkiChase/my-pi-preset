# Agent 工具组契约规范化

## 目标

规范 subagent_run、subagent_message、subagent_workflow 的参数、模型指导和返回语义，减少无效参数、静默忽略及重复说明，使主助手和子 Agent 能正确启动、恢复、发消息和取得执行结果。

## 授权与边界

用户已批准完整方案和具体 tool rules，三个实施阶段及追加UI测试修复已完成；最新默认 pnpm check 通过。用户已验收并授权收尾，包括归档、journal、绑定清除和范围内本地提交。主实现/自审，未启动 Agent，不称独立复核。不包含安装、个人 sync/reload、push 或历史重写。

## 背景与证据

前置任务 `.trellis/tasks/archive/2026-10/10-16-runtime-tool-contracts` 已完成执行管理拆分：agent_id 标识会话，execution_id 标识一次执行；agent_manage 管理结果。本任务延续规范，不重做后端。

| 证据（规划时行号） | 现状与问题 |
| --- | --- |
| extensions/agent-tasks/src/index.ts:1625-1735；settings.ts:114-120、382-383、487 | full/compact/custom 与模板机制，长 description 和分散 guidelines 并存 |
| index.ts:1856-1870、2055-2155；spawn-input.ts:22-38 | resume 忽略类型/名称/描述，却仍要求类型和描述；已有启动选项拒绝；部分未恢复路径返回成功文本 |
| nested-tools.ts:166、190-208、401-426 | 单独的嵌套定义；resume 固定前台且忽略后台参数；消息只按真实 ID 查找 |
| index.ts:2930-2985 | 主消息接受别名，缺少 usage 组；queued/sent 不代表已处理 |
| index.ts:2580-2685；workflow/saved.ts:186 起 | 多脚本来源静默优先级；title/description 接受后忽略；meta 错误部分返回成功文本 |
| invocation-config.ts:133-198；index.ts:1900-1922 | Agent 配置优先，只有 model/thinking 覆盖披露；后台默认受配置影响而指导写死 |
| index.ts:989-1198；mention-clone.ts | @handle 的消息/恢复直接路由，新建 model 路径复用注册工具；严格参数迁移不能使此路径失效 |

## 需求与已确认决策

### R1：统一官方指导

取消 full/compact/custom 模式、对应配置/设置 UI、模板读取及专属占位符机制。不保留旧配置映射，不删除用户模板文件。每工具采用简短 description、单句 promptSnippet、一个多行具名 usage 组及集中示例；配置/能力相关内容从实际注册配置生成。workflow 脚本 API 指导须保留准确能力与限制，不靠自定义模板注入。

### R2：新建与恢复共用 subagent_run

不新增 subagent_resume。新建必填 prompt、description、subagent_type；恢复必填 resume、prompt，沿用原 Agent 类型、名称和标题。恢复拒绝 description/name/subagent_type/model/thinking/isolated/inherit_context/isolation/schedule 等不适用字段。

主入口恢复可用 run_in_background，省略沿用现有配置解析政策并基于被恢复 Agent 自身类型，不解析无效类型。嵌套恢复仅前台，拒绝显式 run_in_background（包括 false）；不改变嵌套新建的现有后台能力。恢复仅限可拥有、已结束且可恢复的会话；拒绝路径明确带错误，不暗示启动成功。

### R3：workflow 参数清理

删除无效 title/description，标题和说明来自脚本 meta。新启动必须提供 script/scriptPath/name 恰好一个；重放 resumeFromRunId 可省略来源沿用原脚本，或提供恰好一个替代来源。多个来源在读取来源、写文件、创建执行和 worker 启动前拒绝，不保留优先级兼容。其余 args、resumeFromRunId 命名及 journal 前缀重放语义不变；省略 args 保持现有 undefined，不新增自动继承旧 args。

### R4：消息寻址与成功含义

主/嵌套 subagent_message 仅接受真实 agent_id 与非空 message，不接受名称、类型别名或 execution_id。保留原 owner/运行状态检查。queued 表示已排队等待会话初始化，sent 表示已提交给会话，均不保证 Agent 已读取、处理或回复。不新增阻塞回复、送达确认或消息历史仓库。

### R5：配置优先与公开结果

用户最终选择保留 Agent 文件配置优先，不把显式请求冲突改为启动失败。省略沿用配置，相同值不重复提示；不同请求按配置执行，并在内容中明确被覆盖字段及请求/实际值。保留模型 scope、禁用能力、类型 fallback 和权限政策，不以结果披露扩大能力。

启动/恢复成功仍使用现有公开 launch v2 和 agent_id/execution_id；workflow 使用现有执行句柄；不新增公共 envelope 版本。消息结果明确阶段和目标，不伪造 execution_id 或已处理确认。终态取结果与通知消费属于 agent_manage，保持现有精确身份与会话 fencing。

### R6：严格准入与消费者一致性

schema 闭合扁平，按调用模式执行字段/形状/非空与依赖校验，先验证后产生执行副作用。直接 execute 与实际 host validator 都覆盖。主入口、嵌套入口、mention model、仓库维护的 RPC/测试调用方同步；内部 spawn/RPC 不无故收紧为模型工具 schema，工具别名删除不影响 @handle 解析。

## 排除

不改变调度、并发、托管 worktree、权限、持久化会话、@handle 状态分流、workflow worker/脚本 hooks API 或结果存储。不新增暂停/重试/后台嵌套恢复、消息阻塞应答（已有独立任务）、历史查询。不全面重做 renderer；沿用公共工具标题和实际结果展示。不修改个人配置/模板文件或生成 Trellis 拷贝。

## 验收标准

- AC1（R1）：三工具在真实 SDK prompt 中各一组指导；peer 保留、隐藏/禁用工具遗漏正确；配置模式和模板不再读取或保存，用户文件未删除。
- AC2（R2/R6）：主/嵌套新建与恢复字段表一致于实际行为；合法恢复不要求类型/描述，非法模式字段与未知/畸形输入在 spawn/resume/steer/schedule/worker 前拒绝；所有拒绝带 isError。
- AC3（R3）：三来源互斥覆盖新启动及重放；空值不当成省略；重放省略来源仍读取原保存脚本，args 与 journal 政策保持。
- AC4（R4）：真实 ID 消息成功，别名/execution_id/越权/非运行目标拒绝；queued/sent 不声称处理完成；@handle 主输入行为不变。
- AC5（R5）：配置继续优先，覆盖披露覆盖所有适用调用参数；省略/一致值不误报，能力禁用与 scope 防御不回退；前台/后台结果与执行身份一致。
- AC6（R6）：实际 mention clone 能用新参数正常创建；已尝试启动失败不新增重试；retained-child/loader/depth/owned waits/通知 fencing 回归保持。
- AC7：每阶段主自审、受影响自然退出回归及 pnpm check 通过，文档/spec/必要资源 hash 与消费者同阶段；记录失败原因和未验证限制，不将模拟 provider/UI 称线上或视觉验收。

## 规划状态

三个阶段已完成，用户已验收并授权收尾；精确验证、失败与重跑记录见 implement.md。
