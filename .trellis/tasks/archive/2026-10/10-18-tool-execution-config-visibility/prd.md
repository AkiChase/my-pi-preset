# 补齐执行配置回显与工具渲染

## 目标

让用户在 Agent 启动和后续查询中看清实际执行配置，而不是只能看到原始 null 或零散标签。补齐已有信息的返回与显示缺口，保持模型工具定义稳定，不将实时配置注入 tool schema/prompt。

## 背景与已确认事实

- `extensions/agent-tasks/src/index.ts:1835–1849` 的 detailBaseFor 返回 modelName/tags；后台 renderer 在 `:1626–1628` 只显示后台运行与 ID，展开也不恢复配置。
- `extensions/agent-tasks/src/activity.ts:44–55` 的 tags 只保留 true/worktree 等正向值，省略 false/foreground/off，无法代替完整配置。
- `extensions/agent-tasks/src/agent-manager.ts:938–960` 在 session 创建后回写真实 model/thinking；后台启动先返回，不能一律把启动快照标为最终 session-effective。
- `extensions/agent-tasks/src/management.ts:26–30` 与 `extensions/agent-tasks/src/index.ts:2713–2760` 的 output/wait metadata 和正文缺少 invocation。
- `extensions/agent-tasks/src/source.ts:88–94` 将 model/thinking 放进 TaskView.stats；`extensions/runtime-tasks/facade.ts:42–60` 将非数字过滤出 details，但 status 正文仍包含 view.stats。
- `extensions/beautify/tools/management.ts:15–23` 不展示已有 range/stats；`extensions/beautify/tools/optional.ts:50–54` 展开只显示标题和正文，`extensions/beautify/layout.ts:59` 的展开标题不会恢复 metadata。
- `extensions/process-tasks/management.ts:29–40` 已返回实际日志字节范围；默认预算和搜索 context 未独立返回，本任务不要求为全部低影响默认参数增加回显。

## 要求

### R1：结构化配置快照

复用执行 record 中的权威 invocation，返回模型标识、thinking、foreground/background、inherit_context、isolated、isolation 等与本轮执行相关的配置；明确 false/off，不把缺失等同于 false。启动与管理查询使用一致投影，不再以 modelName/tags 为唯一载体。仅输出白名单展示数据，不泄露完整内部对象、prompt、认证或私有配置。

区分已解析/待 session 确认与 session 实际生效；不能把后台启动的预解析值误标为最终值。历史结果使用当次快照，不由 renderer 读取当前配置重算。resume 按本轮 execution identity 与已有 session 的真实设置显示，不宣传未生效的新建参数。

### R2：折叠简洁、展开完整

折叠视图仅展示关键 model/thinking/执行模式及状态；展开视图显示 R1 的完整相关配置和已有结果正文。后台启动同样可展开查看，完成、错误、停止及查询路径不能因状态分支丢失关键配置。不打印不适用字段的 null 清单。

仅在请求与实际值不同或发生实际回退时显示有依据的差异说明；不能把 SDK 能力限制等一律说成 Agent 文件覆盖。当前记录未保留的 provenance 不得由 renderer 猜测；必要的差异归因在执行 owner 中记录，不先建设全量配置审计系统。

### R3：模型正文与 UI 数据分工

结构化 details 服务 renderer；不能假定 details 对模型可见。关键配置或请求被覆盖的差异在模型可见正文中简短表达，避免每次附完整参数表。配置值不进入动态工具定义；兄弟任务负责静态参数语义说明。

### R4：Process Manage 恢复已有信息展示

消费现有 range/stats 等合法结构化 metadata；折叠保持简洁，展开展示日志范围和适用统计。不将调用请求的 limit 当成实际读取字节数，也不把实际范围倒推为默认预算。不要求新增全量 Process 执行参数快照。

### R5：Monitor 的最小配置回显

启动时保存并返回监控配置快照：background模式、总截止时间（未设置明确无截止时间）、静默提醒阈值（未设置明确关闭）、实际采用的通知批次间隔。启动与process_manage status/output/wait查询复用该快照；不从日志或当前配置重算。source command/URL沿用已有正文，不额外复制到配置metadata，WebSocket认证与protocols不纳入本次展示。

通知批次间隔当前插入monitor的常驻promptGuidelines，改为静态“使用配置值”说明并通过结果呈现实际值；不改变批次调度、截止时间、静默唤醒和通知行为。确认间隔是启动固定还是可变后按真实owner语义命名，不将可能变化的live配置误称为启动后永远固定。Monitor无model/thinking、覆盖归因或session确认阶段。

### R6：所有权与兼容性

执行层生成快照，渲染层只格式化，不查 live manager、不解析正文猜参数、不触发结果消费或其他执行副作用。保持 schema 准入、scope/ownership、等待/停止/通知、结果消费、execution ID 与 stale fencing 行为。扩展结果 metadata 时同步类型、字段白名单与所有相关投影/renderer；不盲目塞入只允许数字的 stats。

## 验收标准

- AC1（R1）：新建启动和 agent_manage status/output/wait 对相同执行返回一致配置；可区分预解析与 session 生效，false/off 与未知值不混淆，resume 不串用旧 run 或当前配置。
- AC2（R2）：后台、前台、完成、停止、错误、查询折叠/展开均保持可读；展开展示配置，窄终端无溢出，无冗长 null 清单。
- AC3（R3）：真实工具结果正文含必要且简短的配置/覆盖说明；不依赖 details 对模型可见，无动态 tool definition 更新。
- AC4（R4）：process_manage 展示现有日志范围及适用统计，返回范围与呈现一致，不虚构默认预算。
- AC5（R6）：参数准入、foreign metadata 回退、历史回放、partial/final、权限与生命周期回归通过；renderer 不查询或改变后端。
- AC7（R5）：monitor启动及status/output/wait可显示实际采用的timeout、静默提醒、批次间隔；无截止/关闭与未知区分。常驻Rule不含实时批次值；command/URL/认证不新增复制。监控结束、停止、静默恢复与通知消费无回归。
- AC6：主会话核对实际 diff 与聚焦测试；跨模块结果契约需独立审查。类型检查与相关宿主渲染/生命周期集成检查完成；未做真实视觉/provider 验证时明确 NOT_RUN。

## 不在范围内

重做 required-nullable schema、改变默认配置与入口优先级、bash任何行为/返回/独立renderer改造、全量 provenance/配置审计系统、新查询工具、全部 Process 默认参数回显、workflow replay/persistence/model fallback 策略修复、动态 prompt/cache 改造、用户文档参数教学、安装/reload/push/归档及无关修改。

Workflow/nested 的现有共用结果消费者必须兼容新投影；是否同时补齐其独立界面功能在技术设计阶段明确，未明确纳入前不扩大为全量 workflow UI 改版。

## 设计与执行准备

见design.md与implement.md：三阶段为Agent配置返回契约、Agent显示、Monitor快照与Process展示集成。主会话实施，各阶段独立trellis-check审查；跨模块白名单/结果契约与生命周期不得仅靠自查。派发前由主会话准备真实check.jsonl引用，本次不伪造执行manifest或测试PASS。监控间隔owner语义、旧结果回退及实际渲染接入需要在实施前核对。

原始执行输出使用仓库外自有临时目录，不写research/。使用现有Node/TypeScript/SDK、COREPACK_ENABLE_NETWORK=0；不安装或下载工具依赖，不改个人HOME/安装/reload。准确测试命令与资源限制见implement.md。

## 关联与授权

兄弟任务已完成并归档：`.trellis/tasks/archive/2026-10/10-18-tool-default-semantics-guidance/`（88878a6/2f32141）。本任务继续遵守静态工具语义与结果回显分工，不重做Skill。

用户已批准任务规划、monitor范围与现有beautify风格，并明确“开始吧”授权按三阶段实施、验证与本地阶段提交。不授权安装/下载、个人reload、push或归档；bash不在范围。实施与审查分别选择执行者，主会话核对实际diff/证据并维护材料。
