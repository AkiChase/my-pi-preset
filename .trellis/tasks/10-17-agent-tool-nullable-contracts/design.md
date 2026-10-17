# Agent nullable 契约设计

## 设计目标与边界

最小行为差距：模型可能为未使用的可选字段补值，而现有工具根据字段存在性选择模式或拒绝跨模式字段。本次在注册 schema 中显式声明 `T | null`，在工具自身准入边界恢复“null 控制字段等于未提供”，不把这一兼容责任下放到内部 manager/RPC，也不修改 provider。

保留扁平、封闭 schema；所有已暴露字段均 required，业务未指定/不适用字段直接 `Type.Union([Type.Null(), 原类型])`，不用 Type.Optional。此 required+nullable 由工具显式定义，不添加 constrainedSampling 或 strict payload hook。所有 provider 的模型调用均按完整字段对象校验，不再允许省略。

## 统一输入流水线

```text
调用输入（raw 或 host validation 后）
  → 确认对象及本入口可注册字段
  → 拒绝未知/已禁用/本入口不存在的字段，包括其 null 值
  → 确认所有已注册字段存在，缺字段拒绝
  → 浅复制，删除允许的可选控制字段中的 null
  → 选择模式/动作
  → 校验条件必填、字段类型、跨模式冲突
  → 返回非 nullable 的已准入参数
  → 原业务执行、配置优先级和权限/所有权检查
```

这里“可注册字段”是所有模式的并集，而不是当前模式字段：例如主工具 resume 调用中的 `description: null` 可以删除，但嵌套入口根本没有的 `name: null` 不能删除；禁用 scheduling 时 `schedule: null` 也拒绝。归一化不得覆盖 unknown-field 检查。

重复归一化必须幂等，不修改原输入对象；不能依赖校验函数偷偷原地删除值。可在现有 contract owner 增加返回已准入参数的 parser，assert 入口保留为兼容包装并委托 parser；所有 execute 和有语义依赖的消费者使用 parser 返回值，避免 assert 通过却继续使用原始 null 对象。

宿主 `normalizeOptionalNulls` 仅会删除“不接受 null”的 optional 值；手工 nullable 后会保留 null。因此测试须明确区分 host 输出与工具 parser 输出，不能借助宿主自动删除来掩盖遗漏。

## 字段矩阵

| 工具/入口 | 可选控制字段：null → omission | 非 nullable 必填/条件必填 | 数据例外 |
| --- | --- | --- | --- |
| 主 `subagent_run` | description、subagent_type、name、model、thinking、run_in_background、resume、isolated、inherit_context；启用时 isolation、schedule | prompt 必填；新建 description/subagent_type 必填；有效 resume 选择恢复 | 无 |
| 嵌套 `subagent_run` | description、subagent_type、model、thinking、run_in_background、resume、isolated、inherit_context；启用时 isolation | prompt 必填；新建 description/subagent_type 必填；恢复后不接受非 null run_in_background | 不注册 name/schedule |
| `subagent_workflow` | script、scriptPath、name、resumeFromRunId | 新建恰好一个有效来源；重放最多一个来源且有效 replay ID | args 任意 JSON，包括顶层及嵌套 null |
| 主/嵌套 `subagent_message` | 无 | agent_id、message 为非空字符串，null 非法 | 无 |
| `agent_manage` | execution_id、kind、verbose | action 必填非 nullable；目标动作 execution_id 必填；非 null 字段遵循动作表 | 无 |
| `trellis_dispatch` | action、agent、task、prompt | action 省略/null/既有空字符串 → dispatch；dispatch 的 agent/prompt 必填；stop 不接受非 null agent/prompt | prompt 合法换行/tab 原样保留 |

原有 `trellis_dispatch.action: ""` 默认 dispatch、`task: ""` 默认当前任务语义保留，不移植到其他字段。显式 undefined 的 direct-call 既有行为不顺便放宽；本次新增的空值协议仅为 null。

## Schema 与类型方案

- 使用 `Type.Union([Type.Null(), 原 schema])`，不加 Type.Optional，字段描述覆盖整个 union；所有已暴露字段加入 required。枚举保留原集合，不用空字符串新增占位枚举。
- Trellis 已使用 plain JSON schema，保持其技术形式；使用等价 anyOf/type union 明确接受 null，不迁移成 TypeBox 仅为样式统一。
- 对共享 `thinkingParam`、`isolationParam` 核对 schema 消费者与测试，业务 resolver 继续接收已规范化参数，不把 manager/RPC 类型整体 nullable 化。
- 原始 tool 输入可 nullable，parser 输出不 nullable，并保留有效 false；不用 `any`/批量断言消除新增类型错误。
- 最多引入一个小型无状态 `extensions/shared/tool-arguments.ts`，只承担有明确字段白名单的浅层 optional-null 复制/删除；各工具仍拥有字段集合、模式校验和错误信息。不做通用递归 schema 框架。
- schema 定义与 nullable 字段集合需有自动覆盖测试，防止以后新增字段只改一边。

## 现有 owner 与预期改动

| 文件/组 | 必要原因 |
| --- | --- |
| `extensions/agent-tasks/src/tool-contract.ts` | 新建/恢复/workflow 准入解析，规范化顺序与条件必填 |
| `extensions/agent-tasks/src/index.ts`、`src/nested-tools.ts` | 注册 nullable schema，execute 使用已解析参数；mention clone 复用注册工具，无另一个执行 owner |
| `extensions/agent-tasks/src/invocation-config.ts` | thinking/isolation 共享 schema；内部配置优先级保持 |
| `extensions/agent-tasks/src/tool-guidance.ts`、`src/workflow/tool-description.ts` | null 控制参数与 args 数据例外的准确说明 |
| `extensions/runtime-tasks/tools.ts` | 仅 Agent schema/准入/说明分支；Process 分支保持原行为 |
| `extensions/beautify/tools/management.ts` | 它调用 management validator，但之后继续读取原始参数；使用相同 Agent 解析结果匹配标题/身份，避免 nullable 调用执行成功却渲染回退 |
| `extensions/trellis/lib/subagent-rpc.ts` | plain schema 与纯 validator 配套 nullable；原派发/停止流程不改 |
| 相关 `__tests__` | raw、host、execute、配置门控、所有权、克隆/渲染回归 |
| 当前用户文档 | 仅功能、操作与限制，不放模型字段表/null 调用教学 |
| `.trellis/spec/development/index.md` | 仅删除已失效的扩展引用与旧契约语句，不新增本次 nullable 实现规则 |

`StructuredOutput` 也位于 Agent 实现内，但其输入 schema 为用户提供的数据契约，不属于 Agent 控制参数。审计结论为保持 caller schema 原样，不自动 nullable 或删 null；workflow 内部 agent()/workflow() JS API 同理。

## 测试设计

1. Schema：注册工具逐字段确认 null/合法原类型接受；所有已暴露字段 required，逐字段删除均拒绝；非 nullable 字段、非法 enum、unknown null、配置禁用字段均拒绝。检查原 schema 不被修改。
2. Raw parser：冻结输入；返回值与输入身份不同；两次解析一致；null 删除只在入口已注册控制字段；unknown/disabled null 严格拒绝。
3. 模式：spawn + resume:null；resume + spawn 字段:null；非 null 冲突仍拒绝；条件必填 null 报缺失；空/空白 resume 仍在副作用前报错。
4. 执行：合法 nullable 调用只触发正确 spawn/resume/schedule/action；拒绝调用对 lookup、文件持久化、执行注册、RPC/消息/停止计数全部为零。
5. 数据：args:null、false、0、""、数组及嵌套 null 原样到脚本；来源 null 不影响有效来源；绝不递归清洗。
6. 跨模块：Agent 管理原始 nullable args 的渲染身份与规范化执行保持一致；Process raw 校验/host 行为不变化；stale/foreign ID、workflow verbose、嵌套深度/后台收集门控仍有效。
7. 说明：真实注册 guideline 的集中规则与 schema 相符，主/嵌套差异正确；按用户要求删除全局 Tool Guidance 注入及其专属测试/文档/导航/当前规范引用，保留各工具原有说明，不改其他工具契约；新增 null 示例不复制整套工具签名。

args 也必须提供且保留完整 JSON 语义，nullable 不用于表示缺失数据。外层工具不再允许省略 args；内部 JS API 及旧内部对象中 undefined 的语义不变。

## 模型说明规划

逐工具拟用文案、错误指导、删除全局提醒及对应测试清单见 [guidance-plan.md](guidance-plan.md)。该文件是本设计的说明契约附录，实施前须完整读取。

## 风险、审查与回滚

- 审查授权修正：用户明确批准本任务豁免独立审查，只由主会话自审和测试后提交；本任务例外不写入项目 workflow，不启动 Agent，不将自审冒充独立审查。
- 真实 provider 可能仍输出空字符串/首个 enum；nullable 声明不能保证模型行为。用户部署验证为单独验收门，失败则保留事实再分析，不扩大清洗范围。
- S1/S2 各保持 coupled schema、code、tests、说明与适用 spec 一起提交。回滚仅可在后续获批时对本任务精确提交做 revert；不自动重写历史/恢复文件，不触碰并行改动。
