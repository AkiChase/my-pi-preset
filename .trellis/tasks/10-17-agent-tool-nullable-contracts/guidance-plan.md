# 模型说明调整清单

## 模型工具契约

用户明确要求不使用 `Type.Optional`。本任务范围内注册工具的所有已暴露字段都必须提供：不适用/未指定的控制字段声明为 `Type.Union([Type.Null(), 原类型])` 并传 null；始终必填字段保留非 nullable 类型。说明不得再写控制参数可省略，也不得把业务可选与 JSON 字段可省略混为一谈。

模型输入先校验所有已注册字段存在及未知字段，再删除控制字段 null 并进入内部业务校验；内部删除后的字段缺失是实现语义，不是模型调用方式。禁用功能的字段不注册，也不能传 null。

## subagent_run（主/嵌套）

> Provide every field exposed by this tool. Set unused control fields to null. Null means not specified and does not select an invocation mode or override agent configuration. Fields not exposed by this tool are invalid, even when null.

> A non-null resume selects resume mode and must be a non-empty real agent_id. For a new agent, set resume to null; an empty string is invalid. When resuming, set new-agent fields to null.

> Nested resume always waits inline. Set run_in_background to null; non-null values are not accepted with nested resume.

模式表区分 required non-null 与 must be null，不再列 optional arguments。description/subagent_type 新建必须非 null，恢复必须 null。model/thinking/mode/context/isolation 的 null 使用既有配置/默认；schedule:null 立即执行，非 null 仍需明确调度授权。主/嵌套未暴露字段不出现在示例中。

## subagent_workflow

> Provide every field exposed by this tool. For a new execution, set exactly one of script, scriptPath, or name to a non-null source, and set the other source fields and resumeFromRunId to null. Empty strings are invalid. For replay, provide a valid resumeFromRunId and at most one non-null source; set all source fields to null to reuse the prior script.

> Null in control fields means not specified. This does not apply to args: its JSON value, including null, is passed to the script unchanged.

args 也必须在工具调用中提供；args:null 是脚本数据 null，不是 undefined。不再在模型工具说明中教授省略 args。脚本内部 agent()/workflow() JS API 的 optional 参数、返回 null、undefined 语义不改变，不对它们施加外层工具 schema 规则。

## subagent_message（主/嵌套）

无业务可选字段，agent_id/message 保持非 nullable：

> Both agent_id and message are required non-empty strings; null is not accepted.

保留 ownership、真实 ID、queued/sent 非处理确认。

## agent_manage

> Provide action and every control field exposed by this tool. Set unused fields to null. Action must be non-null. Only non-null control values participate in action-specific validation; unknown fields remain invalid even when null.

动作表写每个动作必须非 null 的字段，其余字段 set to null。list 的 execution_id/verbose 必须 null；目标动作的 execution_id 必须真实有效；kind:null 不筛选；verbose:null 不请求详情。workflow 不接受非 null verbose（包括 false）。Process schema/说明不改。

## trellis_dispatch

保持现有 plain JSON schema，但所有已暴露字段加入 required，业务未指定字段明确 nullable。

- action：`Set to dispatch or stop; null uses the default dispatch action. An empty string retains the existing dispatch default.`
- agent：`A non-null Trellis role is required for dispatch. Set to null for stop.`
- task：`Set to null to use the local/active task. An empty string retains the existing local/active task default.`
- prompt：`Non-empty text is required for dispatch. Set to null for stop. Newlines/tabs are preserved; NUL is forbidden.`

不再教授 omit；不为修复创建大型 guidance。权限、source/worktree/occupancy 与 ID 语义保持。

## schema 描述、错误与示例

- 每个已注册字段都 required；nullable 描述写 null 的具体默认/不适用意义，而非 optional/omit。
- missing field：提示字段必须提供，不适用时设 null；非 nullable 字段要求合法值。
- 空 resume：`Set resume to null for a new agent; provide a non-empty real agent_id to resume.`
- 恢复中的实际新建值冲突：提示设该字段为 null。
- unknown/disabled 字段：提示删除，不得建议 null 绕过。
- workflow 空来源：unused sources must be null; empty strings are invalid。
- 示例必须包含该注册配置下所有字段；避免静态示例遗漏 feature-gated 字段或给嵌套入口添加 name/schedule。
- 不在外层调用示例中省略 args；args 的内部 JSON null/false/0/空串均保持。
- 模型工具调用与内部 RPC/manager/脚本 API 明确分离，后者不整体改成 required nullable。

## 全局扩展删除

删除 `extensions/tool-guidance.ts`、专属测试、用户页及 README/docs index/当前 spec 引用。保留归档历史和其他工具自身规则，不复制旧全局省略提示。nullable 不保证模型永不填错；保留缺失/类型/模式/权限校验和实测验收。
