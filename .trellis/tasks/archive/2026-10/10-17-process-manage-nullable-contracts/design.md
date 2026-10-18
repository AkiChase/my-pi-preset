# process_manage nullable 契约设计

## 最小行为差异与所有权

原模型入口允许省略控制字段；目标入口要求提供完整字段并将声明的控制 null 归一化为内部缺省。行为所有者是 `extensions/runtime-tasks/tools.ts` 的 `managementTool("process")`，不是 SDK、facade 或 Beautify 注册层。

## 模型边界

```ts
interface ProcessManagementParams {
  action: RuntimeTaskAction;
  task_id: string | null;
  task_type: "bash" | "monitor" | null;
  offset: number | null;
  limit: number | null;
  pattern: string | null;
  ignore_case: boolean | null;
  context: number | null;
}
```

保持 flat closed schema；用已有 `nullableControl` 包装原类型和约束，所有属性 required。不要采用 action schema 联合、strict hook、第二个注册 owner 或递归清洗。

## 解析与数据流

1. `parseProcessManagementParams(value: unknown)` 调用 `parseControlArguments`，传入全部 8 个字段与 7 个 nullable 控制字段白名单。
2. 完整性及 unknown 检查在归一化前进行；复制对象后仅删除白名单的 null。
3. 调用既有 `validateNormalizedManagementParams("process", params)`；拒绝 action 不适用字段、缺目标/搜索模式及非法标量。
4. 返回内部 `ManagementParams`，保持 optional/undefined，交给现有 facade，不修改后端默认值。
5. `validateManagementParams` 的 process 分支也使用 parser；校验函数不返回归一化对象，execute 和 renderer 必须直接调用 parser，不能校验后继续使用原始 nullable 输入。
6. `managementTool.execute` 在 capability 查询前完成解析；保留 closed 分支当前优先级和错误 envelope。
7. Beautify `managementContract` 对两个 group 分别解析，以归一化值匹配 ID/result、生成摘要；失败仍按现有规则委托回退。

原 action matrix 不变，参见 PRD R2。错误提示统一要求不适用字段使用 null；未知字段仍要求移除。无需新增通用 dispatch/parser 框架。

## 预期变更文件

- `extensions/runtime-tasks/tools.ts`：process wire 类型、parser、schema、execute/validate 和模型指引。
- `extensions/process-tasks/tools/bash.ts`：仅同步现有 process_manage 协作指引，targeted call 的 task_type 要求改为 null；不改 Bash schema 或执行。
- `extensions/beautify/tools/management.ts`：共享 process 解析结果，保持渲染无后端副作用。
- `extensions/runtime-tasks/__tests__/*.test.ts`：完整 schema/parser、action matrix、整数、注册工具及 prompt 测试。
- 注册工具调用处涉及的 process-tasks/task-ui/Beautify 测试，以及 runtime retained-child 等集成测试：将 process_manage 调用迁移到完整 envelope。
- 必要时增加 test-only envelope 工厂，限于测试，用于有效调用；missing/unknown 测试必须绕过工厂，证明入口不自动补齐。

实际调用清单实施时再次搜索；改动现有测试数量不代表扩大产品范围。只调用内部 facade 的 optional 参数测试不迁移；不修改 Agent schema 或引入产品兼容入口。

## 兼容性、风险与回退

- 模型侧旧缺字段调用有意拒绝，不添加兼容开关；内部接口保留。
- null 值必须不流入 facade，尤其 task_id/filter/pagination；通过 spy 和真实注册工具行为验证。
- TypeBox/host 数值转换可能影响整数验证，保留 Number/multipleOf 与 direct safe-integer 校验并测试字符串小数。
- Renderer 可能因 null ID 被视为已提供而拒绝合法结果，因此必须解析后匹配，并覆盖 partial/final/error fallback。
- 不改变 search 正则异常通道、wait/stop/通知生命周期或 scope，避免把契约工作扩大成后端修复。
- 若实施或审查发现需改变后端行为，停止并重新确认范围。回退应把耦合 schema/parser/guidance/renderer/tests 一起回退，不通过恢复 Optional 或修改已安装 SDK 绕过问题；不改写历史。

## 实施与审查选择

建议主会话直接实施，独立 `trellis-check` 审查跨模块公开兼容契约。此前其他任务的豁免不延用。审查实际源码、调用点和验证结果，不能仅根据总结判定通过。
