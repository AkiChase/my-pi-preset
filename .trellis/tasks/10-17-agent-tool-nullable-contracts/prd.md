# Agent 工具 nullable 参数契约修复

## 目标

统一 Agent 相关工具的参数契约：模型侧不再使用 `Type.Optional`，所有已暴露字段都必填；业务可选/不适用控制字段明确声明 `Union[null, T]`，模型必须传 null。工具边界在模式选择、校验和副作用之前将控制 null 解释为未指定。同步修正 schema、参数类型、准入校验、执行代码、工具说明、用户文档与测试。

先完成本任务并由用户重新部署确认实际有效，再另开其他工具的修复任务。本任务不创建后续任务。

## 背景与证据

- 用户明确要求手工 nullable schema 与工具代码配套修改，而不是仅设置 `strict: false` 或依赖宿主自动 strict 转换。
- `extensions/agent-tasks/src/index.ts:1536` 注册主 `subagent_run`，当前字段以 `Type.Optional` 表示；`:1688` 附近在执行入口调用模式校验。
- `extensions/agent-tasks/src/nested-tools.ts:174` 有嵌套 `subagent_run` schema，`:194` 调用相同准入校验；两个入口须保持一致。
- `extensions/agent-tasks/src/index.ts:2411` 注册 `subagent_workflow`，`args` 当前为 optional `Type.Any`，具有任意 JSON 数据语义。
- `extensions/agent-tasks/src/index.ts:2759` 注册 `subagent_message`，`agent_id` 和 `message` 均为必填，没有需要新增 nullable 的可选字段，但需验证必填 null 拒绝行为。
- `extensions/runtime-tasks/tools.ts:121` 注册 `agent_manage` schema；与 `process_manage` 共享实现，需要保证 Agent 修复不改变 Process 分支。
- `extensions/trellis/lib/subagent-rpc.ts:116` 注册 `trellis_dispatch`，包括 dispatch/stop 模式与可选任务引用，纳入 Agent 调度工具契约核对。
- 公开复现可参考 `https://github.com/vercel/ai/issues/11869`：Responses 路径可能为 optional 字段生成空字符串。nullable 是本次用户选择的方案，但是否恢复实际模型调用必须通过部署测试确认。

## 范围与要求

### R1：Agent 工具全覆盖

覆盖 `subagent_run`、`subagent_workflow`、`subagent_message`、`agent_manage`、`trellis_dispatch`，包含主入口、嵌套入口、复用/克隆入口及相关说明。无可选字段的工具只核对必填约束，不人为扩大 nullable。

### R2：明确 nullable 与业务准入

- 所有已暴露字段加入 required，不使用 Type.Optional。业务可选控制字段直接 Union[null, 原类型]；不适用时必须 set to null，省略字段须在 host/raw admission 中拒绝。
- 使用入口明确字段集合处理 optional-null；先拒绝未知、已禁用或本入口未注册字段（包括其 null），再复制归一化。只删除已注册的可选控制字段，不能遍历任意 JSON 数据并删除 null。
- null 归一化必须先于模式选择、跨模式字段冲突校验、目标查询及 spawn/resume/schedule/stop/message 等副作用。
- 必填字段不能因 nullable 改造获得合法 null；条件必填字段为 null 时按缺失报错。
- 空字符串不作为通用未提供值；保留原已明确支持的工具特有空字符串语义，不能静默扩大到其他字段。
- 保留合法 `false`、`0`、枚举值和原有默认值、权限、调度、隔离与所有权规则。
- 不原地修改调用方对象；execute 及有语义依赖的消费者必须使用已规范化的参数，而不是仅校验通过后继续使用原始 null 对象。
- `trellis_dispatch.action` 在新模型契约中必须提供，null 使用默认 dispatch；`agent_manage.action` 必填且非 nullable。Trellis 的既有 action/task 空字符串默认语义保留；内部参数对象可省略不代表模型工具可省略。

### R3：说明、类型和测试一致

同步 TypeScript 输入/内部类型、schema 描述、usage、错误信息和相关中文用户文档。说明已暴露字段必须提供，不适用控制字段 set to null，不再教授 optional/omit。仍严格拒绝实际提供的跨模式字段。

用户要求删除全局 `extensions/tool-guidance.ts`，不再注入通用可选参数规则；删除其专属测试、用户文档以及 README/docs index/当前 spec 的引用。不将旧全局规则复制进所有工具，仅由本范围工具说明各自的 nullable 语义。nullable 不能保证模型不再填错，运行时校验与实测验收仍保留；其他尚未修复工具契约不变。

### R4：部署验收后才推广

本地 host validation、raw admission 与执行边界回归必须通过；随后用户重新部署，检查实际模型调用能用 null 表达未使用字段，且新建、恢复、管理和工作流模式正常执行。本地测试不等于真实 provider 验收。

## 验收标准

1. 每个 Agent 工具均有明确审计结果；所有已暴露字段都 required，业务可选控制字段直接 Union[null,T]，host 和 raw admission 都拒绝缺字段。
2. 新建调用中 `resume: null` 不误入恢复模式；恢复调用中的新建字段 null 不产生模式冲突；有效非 null 跨模式字段仍拒绝。
3. 管理工具中不适用字段 null 不阻塞动作；目标字段 null 在目标动作中仍报缺失。
4. workflow 来源 null 不参与互斥计数；全无有效来源时维持原缺失/恢复规则；`args` 的合法 JSON 值不被递归清洗。
5. 必填消息、提示和标识符 null 不产生任何副作用；`agent_manage.action: null` 拒绝，`trellis_dispatch.action: null` 使用原 dispatch 默认。空/非法 ID 仍被拒绝。
6. 主/嵌套工具行为一致，合法 false/0 和数据 null 有专门回归。
7. Process 分支、其他工具、第三方插件、安装版 Pi 不发生契约变化。
8. 聚焦测试、类型检查、全套 `pnpm check` 和 `git diff --check` 有真实执行结果；失败和不可用检查如实记录。
9. 用户部署确认有效后才允许创建后续其他工具任务。

## 排除项与授权

- 不采用全局 Responses payload rewrite，不用 `strict: false` 替代本次 nullable 契约。
- 不拆 Agent 工具，不修改 workflow 编程 API 的任意数据语义，不更改权限或隔离策略。
- 不修改 `process_manage`、bash、monitor、Web/MCP/第三方工具的行为。
- 不安装、reload、push、重写历史或自动归档；保护并行修改。
- 用户已批准任务创建与规划；尚未批准扩展后的最终实施计划，不 start、不修改产品代码。
- 沿用用户要求，由主会话直接调查与实施，不启动 Agent。公开/跨模块契约原要求独立审查；用户已明确批准本任务豁免，并要求不开 Agent，由主会话自审、测试后提交。该例外仅适用于本任务，不修改项目 workflow，也不把自审报告成独立审查。
- 用户后续纠正材料边界：不将模型调用规则写入用户 docs 或长期 spec。工具 schema/usage 拥有模型规则；任务材料保留设计/验证。用户文档仅讲功能、操作与限制；spec 仅删除因本任务变更而失效的旧语句和扩展引用，不新增本次实现规则。
- `StructuredOutput` 与 workflow 内部 JS API 的 caller schema/数据不是 Agent 控制字段，本任务审计后保持原样；`agent_manage` 的 Beautify 参数消费者需要同步 Agent 解析结果，但不改变 Process 分支。

## 已确定的数据例外

用户确认保留 `subagent_workflow.args` 的数据语义：`args: null` 原样传入脚本，嵌套对象/数组中的 null 也保留。外层模型工具的 args 字段同样 required，不能省略；内部 JS API/旧内部参数的 undefined 语义不变。仅约定的控制字段将 null 解释为未指定，不执行通用或递归空值清洗。
