# Monitor nullable 契约设计

## 入口与内部边界

最小行为差距是模型 schema 的省略语义与 strict provider 的必填语义不一致。只在实际工具 owner 修复，不改 backend/transport，不增加旧模型 envelope 自动补齐兼容层。

模型形状：

```ts
{
  command: string | null;
  ws: { url: string; protocols: string[] | null } | null;
  description: string;
  timeout_ms: number | null;
  wake_absent_ms: number | null;
}
```

两个固定对象都 closed；url 与 description 非 null。顶层不用 object oneOf/anyOf，XOR 留在 runtime；nullable 字段使用已有 nullableControl。

## 解析与数据流

1. 新增可直接测试的 Monitor 参数 parser（在 tools/monitor.ts 或就近 monitor-params.ts；优先保持 owner 内聚，最终按文件复杂度确定），复用 parseControlArguments 校验五字段完整性、unknown keys，再浅层删除四个顶层 control null。
2. 若 ws 存在，单独以 url/protocols 固定字段校验其完整封闭形状，只有 protocols 是该对象的 nullable control；复制 ws 后归一化，绝不修改原对象/数组，不对数组元素或任意嵌套数据递归处理。
3. 执行现有字段级校验、来源 XOR、描述和有限正时间校验。空 command + ws 仍双来源；单空来源仍空来源错误。无效 input 在 registry/source effects 前拒绝。
4. 归一化后内部参数继续 optional/undefined。WsSpec 及 source/session/lifecycle API 不迁移。
5. 后续运行保持现有 cwd、capacity、WS capability、admission、source创建和同步 cancellation owner；不重构生命周期。若需要把时间校验提前，则仅将纯输入校验移到副作用前并以负例证明零任务/零来源。

## 预计变更与排除

- tools/monitor.ts：schema、parser调用、null恢复指引及完整模型例子；必要时新增就近 monitor-params.ts 以承载局部 parser。
- process-tasks/__tests__/monitor-schema.test.ts、monitor.test.ts：完整契约与负例；新增 test-only monitor envelope helper，迁移受影响真实注册调用，包括 monitor-session、monitor-setup-result、activation/index 等实际定位文件。
- runtime-tasks/__tests__/prompt.test.ts：验证最终 SDK assembler 的完整 Monitor 例子/无省略指引，保留其他工具组。
- 若 host-loading-smoke.mjs 有 Monitor 实际调用，迁移 fixture；其余 runtime/task-ui/Beautify 如仅使用 monitor metadata，不机械修改。
- Beautify 当前没有 Monitor 特有参数 parser；完整调用点检查后，除非存在明确执行/渲染不一致，不新增 renderer 或无关适配。
- shared/tool-arguments.ts 原 helper 可直接复用，不扩大为递归清洗；monitor-ws.ts 仅作为行为证据，预计不改。
- 不修改 docs/spec、Bash/Memory、Trellis runtime、个人安装或并行任务。

## 模型指引与错误

五个顶层字段必须全部提供；无使用的来源/时间字段 null，选中 ws 时必须提供 url/protocols。protocols:null 无协商偏好；[] 原样传入。错误不再要求省略 nullable 字段；缺字段调用明确拒绝。来源生命周期和通知指引保持原语义。

## 验证、风险与回滚

host validator 可能保留既有 scalar coercion，不把 host验证等同 raw 类型验证；direct parser仍拒绝错误类型。正小数时间保持，不引入整数限制。测试证明 array元素 null 拒绝、空数组/顺序保留且原输入不变。

验证 command/WS/null defaults、闭合schema/完整nested形状、XOR/空来源、错误零副作用，以及既有启动失败、silence/deadline、事件/终态消费、shutdown/晚事件 fencing。真实 provider及物理终端不由脚本结果代替。

单一耦合阶段提交 schema/parser/guidance/fixtures/tests。实现委派 trellis-implement 以降低 fixtures 迁移的上下文负担，独立 trellis-check 审查公共契约与嵌套边界，main 核验并提交。回滚仅撤销本阶段 scoped commit，不动并行工作。执行期间 scope 重大扩展须重新批准。
