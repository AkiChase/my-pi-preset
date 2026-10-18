# 改造 process_manage nullable 参数契约

## 目标与价值

将模型可见的 `process_manage` 参数改为完整 required-nullable envelope，避免 provider 将 optional 字段具化为占位值后触发错误动作校验。复用已验收的 Agent 控制字段方案，保持进程管理行为不变。

## 背景与证据

- `extensions/runtime-tasks/tools.ts:36` 的模型指引仍要求省略字段；`:79` 的 `ManagementParams` 是内部 optional 结构；`:89` 的 action 表定义实际适用范围；`:130` 的 process schema 使用 `Type.Optional`。
- 同文件 `parseAgentManagementParams` 已采用 `parseControlArguments`；`extensions/shared/tool-arguments.ts` 会先拒绝未知和缺失字段，再浅层删除声明的控制 null。
- `extensions/beautify/tools/management.ts:3` 的 process 分支只校验原始参数，必须与执行层同步使用归一化结果。
- `extensions/runtime-tasks/facade.ts` 与 `contracts.ts` 使用内部 optional 参数负责目标、权限、结果与生命周期；本任务不迁移这些接口。
- `extensions/runtime-tasks/__tests__/nullable-controls.test.ts` 当前明确验证旧 process optional 契约；`public-process.test.ts` 覆盖注册工具搜索、分页、统计和拒绝跨动作参数；`schema-integers.test.ts` 覆盖真实 host 的数值转换。

## 范围与要求

### R1：完整、封闭的模型参数

所有调用必须提供 `action`、`task_id`、`task_type`、`offset`、`limit`、`pattern`、`ignore_case`、`context`。`action` 非 null；其余字段均为 nullable 控制字段。禁止 `Type.Optional`，保持 `additionalProperties: false`，未知字段即使为 null 也拒绝。

### R2：沿用 action 适用范围

下表只列允许非 null 的字段；其余字段必须为 null。

| action | 可用字段 | 必须非 null |
| --- | --- | --- |
| list / stats | task_type | 无 |
| status / stop | task_id | task_id |
| output | task_id、offset、limit | task_id |
| wait | task_id、limit | task_id |
| search | pattern、task_id、task_type、ignore_case、context | pattern |

先验证完整 wire shape，再浅层去除控制 null，随后校验 action、类型和依赖，最后才进入 facade。不得修改输入对象。拒绝调用返回可纠正的错误且不调用 capability 的 list/execute/search/stats。

### R3：保留值与默认语义

- `offset: null` 保持默认读尾部，`offset: 0` 从开头读；`limit: null` 保持既有日志预算。
- `ignore_case: null` 使用默认 false；显式 false 有效。`context: null` 使用默认 0；显式 0 有效。
- `task_type: null` 不过滤；仅接受 bash/monitor。search 同时提供 task_id/task_type 时仍校验目标类型匹配。
- offset/context 是非负安全整数，limit 是正安全整数；保留 `Number({ multipleOf: 1 })` 和 direct-call 校验，不静默截断小数。
- 空字符串不是通用 omission。task_id 的非空检查和 pattern 的现有长度/正则语义保持不变；不新增 trim 或正则错误处理策略。
- 不改变 scope/ownership、目标绑定、wait release、stop cancellation、结果消费、自动通知、关闭后的拒绝、v2 metadata 或日志字节范围。

### R4：执行、渲染与模型指引一致

执行入口、公开 validate helper 与 Beautify 使用同一 process parser。模型指引描述完整字段、未用字段 null、action 适用范围，示例提供全部字段。更新注册工具调用测试以真正传入完整 envelope；不得在产品入口自动补齐旧调用。

## 不在范围内

- monitor、bash、memory_list 的 schema 改造，以及其他工具迁移。
- 内部 RuntimeTaskParams、facade/backend/RPC 的整体 required-nullable 迁移。
- 兼容旧模型侧缺字段调用、通用递归 null 清洗、通用空字符串清洗。
- provider strict 补丁、SDK 改动、用户文档中的 tool JSON 教学、长期 spec 的一次性实现记录。
- 安装、reload、push、改写历史、归档及无关并行改动。

## 验收标准

- [ ] AC1（R1）：注册 schema 所有属性均 required；7 个控制字段接受 null，action 不接受 null，未知字段拒绝。实际 host validator 与 direct parser 均覆盖。
- [ ] AC2（R2）：7 个 action 的完整 envelope 正常通过；逐字段缺失、undefined、未知 null、无效 action、缺必需非 null 值和非适用非 null 字段均拒绝，且无 capability 调用。
- [ ] AC3（R3）：false、0、null 默认值、合法过滤、目标类型匹配、整数/字符串小数、safe integer 边界和空字符串行为均有回归覆盖。
- [ ] AC4（R3）：注册工具的搜索、字节分页、统计、等待、停止、结果消费/通知及 scope 回归通过；内部 optional 参数测试保持有效。
- [ ] AC5（R4）：Beautify 正常识别完整 envelope，匹配原有目标/结果/partial-final 元数据；无效调用仍回退，不查询或消费 backend。
- [ ] AC6（R4）：真实 SDK prompt assembler 中只出现一个 Process_manage usage 组，完整示例与新契约一致，其他工具和 hidden 行为不变。
- [ ] AC7：聚焦自然退出测试、`pnpm check`、独立审查及最终 Git diff 检查完成，准确记录失败、重跑和未运行限制；不得宣称离线测试证明真实 provider 行为。

## 授权边界与材料状态

用户已批准创建、细化并实施本计划，包含按 workflow 的 scoped local commit。用户再次明确：tool 参数用法仅面向 Agent，不写入 `docs/` 或 `.trellis/spec/`；本任务不修改这些路径，也不清理历史内容。任务启动与执行记录见 `implement.md`。
