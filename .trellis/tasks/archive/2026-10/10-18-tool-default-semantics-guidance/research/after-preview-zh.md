# 修改后的完整工具说明预览（中文版）

这是修改后英文工具说明的中文审阅预览，不是实际发布语言；产品代码尚未修改。下文完整展开规则与参数描述，不只列出改动部分。代码、命令、JSON 键和标识符保留原文。

预览采用代表性功能范围：顶层 `subagent_run` 启用 isolation 和 scheduling，nested 启用 isolation、没有 scheduling；`subagent_workflow` 已启用。实际禁用某功能时，其字段、规则及示例中的对应字段会一起省去，不能向未暴露的字段传 `null`。可用 Agent 类型用 `<available_types_with_descriptions>`／`<allowed_nested_types>` 占位，代表注册时实际可用列表，不是本次实时查询结果；示例中的 `<available_type>` 要换成列表中允许的真实类型。没有展开当前后台配置值。nested 的 `isolated`／`inherit_context` 可选新增 description 未采用，仍标为无描述。

各工具的参数都必须提供；“可为 null”不表示可以省略。下文参数标题中的类型、必填和可空标记用于呈现 schema；“无 description”表示注册定义确实没有该字段的文字描述。

## 1. subagent_run：顶层调用

工具描述：启动或恢复一个自主 Agent，执行委派工作。

### 完整 promptGuidelines

- 对较大的独立工作或广泛探索，使用专门的 Agent。对于目标已知的小任务，直接使用工具。不要重复执行已经委派出去的调查。
- 提供自包含的 prompt，写清目标、相关上下文、约束、允许修改还是只允许研究，以及预期结果。报告成功前检查实际修改和验证结果；委派 Agent 的总结本身不是证据。
- 提供此工具暴露的每个字段。未使用的控制字段填 `null`。配置类控制字段填 `null` 时，由配置或默认值决定；`resume:null` 表示新建 Agent。未知或禁用字段即使填 `null` 也不合法。
- 各模式允许的非 null 参数：
  - New：`prompt`、`description`、`subagent_type`；可配置 `name`、`model`、`thinking`、`run_in_background`、`isolated`、`inherit_context`、`isolation`、`schedule`。
  - Resume：`prompt`、`resume`；可配置 `run_in_background`。
  - 当前模式不允许的字段必须填 `null`。必需的字符串不能为空；`description` 只用于新建 Agent，是简短、具体的 UI 摘要。
- 允许使用的 Agent 类型：
  - `<available_types_with_descriptions>`
- 恢复使用已结束且可恢复 Agent 的真实 `agent_id`，保留其类型、名称和会话设置；本次调用的执行模式会重新确定。非 null 的 `resume` 选择恢复模式；新建 Agent 时将 `resume` 设为 `null`。空字符串不合法。恢复时，新建专用字段必须填 `null`。对仍在运行的 Agent 使用 `subagent_message`。
- 对当前模式允许使用的调用参数，Agent 文件配置优先。结果会说明哪些显式请求被配置覆盖；不要认为请求值一定生效。
- `run_in_background:null` 使用配置。如果下一步依赖结果，使用前台；否则可以在后台执行期间做其他独立工作。
- 后台启动表示已接受或已排队，不表示完成。复制 `agent_id` 用于发消息／恢复，复制 `execution_id` 用于 `agent_manage` 的 status／output／wait／stop。不要混用 ID。前台直接返回结果；解除等待不会停止执行。
- 后台完成会自动通知。不要只为检测是否完成而轮询或 sleep，也不要编造尚未得到的结果。向用户总结实际结果。
- `isolation` 选择 Git 工作目录隔离方式：`off` 使用当前检出目录，`worktree` 使用看不到未提交修改的临时副本。遵守项目对 worktree 的授权。`isolated` 是另一个选项，用于禁用扩展／MCP 工具。
- 只有用户明确要求延迟或周期执行时才使用 `schedule`。它创建的是调度定义，不是当前执行；不能与 `resume`、`inherit_context` 或 `run_in_background:false` 组合。
- 示例：

新建（New）：
```json
{"prompt":"Inspect login validation; do not edit files; report concrete defects.","description":"Inspect login validation","subagent_type":"<available_type>","name":null,"model":null,"thinking":null,"run_in_background":false,"resume":null,"isolated":null,"inherit_context":null,"isolation":null,"schedule":null}
```

恢复（Resume）：
```json
{"prompt":"Check the remaining boundary cases.","description":null,"subagent_type":null,"name":null,"model":null,"thinking":null,"run_in_background":null,"resume":"<agent_id>","isolated":null,"inherit_context":null,"isolation":null,"schedule":null}
```

### 完整 schema 参数描述

#### prompt（必填，string，不可为 null）

Agent 要执行的任务。

#### description（必填控制字段，string 或 null）

新建 Agent 时必需：简短、具体的任务描述。恢复时填 `null`。

#### name（必填控制字段，string 或 null）

新建 Agent 的名称；填 `null` 时自动命名，可在输入框中用 `@name` 引用。工具发消息／恢复使用真实 `agent_id`；执行管理使用 `execution_id`。恢复时填 `null`。

#### subagent_type（必填控制字段，string 或 null）

新建 Agent 时必须非 null；恢复时填 `null`。可用类型：`<available_types>`。

#### model（必填控制字段，string 或 null）

指定模型。支持 `provider/modelId` 或模糊名称，例如 `haiku`、`sonnet`。填 `null` 时先使用 Agent 配置，没有配置时使用父会话模型；Agent 文件配置优先于调用值。

#### thinking（必填控制字段，枚举或 null）

thinking 等级：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。填 `null` 时先使用 Agent 配置，否则由子会话设置或默认值决定。Agent 文件配置优先于调用值。

#### run_in_background（必填控制字段，boolean 或 null）

执行模式；填 `null` 时使用配置。Agent 文件配置优先于 `true/false` 请求。后台返回执行标识，前台等待结果。

#### resume（必填控制字段，string 或 null）

已结束 Agent 的真实 `agent_id`。填 `null` 表示新建 Agent；空字符串不合法。恢复时，新建专用字段必须填 `null`；`prompt` 和 `run_in_background` 仍可使用。会话设置保留；本次调用的执行模式重新确定。

#### isolated（必填控制字段，boolean 或 null）

填 `null` 时使用配置，配置未指定时为 `false`。为 `true` 时，Agent 没有扩展／MCP 工具，只能使用内置工具。

#### inherit_context（必填控制字段，boolean 或 null）

填 `null` 时使用配置，配置未指定时为 `false`，使用新的上下文。为 `true` 时，把父对话文本加入 prompt。

#### isolation（功能启用时必填控制字段，off／worktree 或 null）

隔离模式。填 `null` 时使用配置，配置未指定时为 `off`。`off` 在当前检出目录运行 Agent。`worktree` 创建临时 Git worktree，让 Agent 在隔离的仓库副本中工作；副本看不到主检出目录中未提交或已暂存的修改。

#### schedule（功能启用时必填控制字段，string 或 null）

仅按明确选择使用：稍后执行而不是现在执行。填 `null` 时立即执行，这是默认方式，几乎总是合适的。格式：6 字段 cron（`"0 0 9 * * 1"` 表示周一上午 9 点）、间隔（`"5m"`／`"1h"`）、一次性（`"+10m"` 或 ISO）。强制使用 `run_in_background`；与 `inherit_context` 和 `resume` 不兼容。返回 job ID。

## 2. subagent_run：nested 调用

工具描述：启动适合子 Agent 使用的 nested subagent，执行有明确范围的委派工作。只能使用父 Agent 允许的类型；嵌套有深度限制。

### 完整 promptGuidelines

- 对较大的独立工作或广泛探索，使用专门的 Agent。对于目标已知的小任务，直接使用工具。不要重复执行已经委派出去的调查。
- 提供自包含的 prompt，写清目标、相关上下文、约束、允许修改还是只允许研究，以及预期结果。报告成功前检查实际修改和验证结果；委派 Agent 的总结本身不是证据。
- 提供此工具暴露的每个字段。未使用的控制字段填 `null`。配置类控制字段填 `null` 时，由配置或默认值决定；`resume:null` 表示新建 Agent。未知或禁用字段即使填 `null` 也不合法。
- 各模式允许的非 null 参数：
  - New：`prompt`、`description`、`subagent_type`；可配置 `model`、`thinking`、`run_in_background`、`isolated`、`inherit_context`、`isolation`。
  - Resume：`prompt`、`resume`。
  - 当前模式不允许的字段必须填 `null`。必需的字符串不能为空；`description` 只用于新建 Agent，是简短、具体的 UI 摘要。
- 允许使用的 Agent 类型：
  - `<allowed_nested_types>`
- 恢复使用已结束且可恢复 Agent 的真实 `agent_id`，保留其类型、名称和会话设置；nested 恢复始终在当前调用中等待结果。非 null 的 `resume` 选择恢复模式；新建 Agent 时将 `resume` 设为 `null`。空字符串不合法。恢复时，新建专用字段必须填 `null`。对仍在运行的 Agent 使用 `subagent_message`。
- 对当前模式允许使用的调用参数，Agent 文件配置优先。结果会说明哪些显式请求被配置覆盖；不要认为请求值一定生效。
- 新建 nested Agent 默认使用前台，除非其配置覆盖此选择。后台启动需要可用的 owned `agent_manage` 工具，父 Agent 结束时会停止其拥有的子 Agent。nested 恢复始终前台；恢复时 `run_in_background` 必须填 `null`。
- 后台启动表示已接受或已排队，不表示完成。复制 `agent_id` 用于发消息／恢复，复制 `execution_id` 用于 `agent_manage` 的 status／output／wait／stop。不要混用 ID。前台直接返回结果；解除等待不会停止执行。
- 后台完成会自动通知。不要只为检测是否完成而轮询或 sleep，也不要编造尚未得到的结果。向用户总结实际结果。
- `isolation` 选择 Git 工作目录隔离方式：`off` 使用当前检出目录，`worktree` 使用看不到未提交修改的临时副本。遵守项目对 worktree 的授权。`isolated` 是另一个选项，用于禁用扩展／MCP 工具。
- 示例：

新建（New）：
```json
{"prompt":"Inspect login validation; do not edit files; report concrete defects.","description":"Inspect login validation","subagent_type":"<available_type>","model":null,"thinking":null,"run_in_background":false,"resume":null,"isolated":null,"inherit_context":null,"isolation":null}
```

恢复（Resume）：
```json
{"prompt":"Check the remaining boundary cases.","description":null,"subagent_type":null,"model":null,"thinking":null,"run_in_background":null,"resume":"<agent_id>","isolated":null,"inherit_context":null,"isolation":null}
```

### 完整 schema 参数描述

#### prompt（必填，string，不可为 null）

给 nested Agent 的自包含任务。

#### description（必填控制字段，string 或 null）

新建 Agent 时必须非 null；恢复时填 `null`：简短任务描述。

#### subagent_type（必填控制字段，string 或 null）

新建 Agent 时必须非 null；恢复时填 `null`。允许的类型：`<allowed_nested_types>`。

#### model（必填控制字段，string 或 null）

指定 provider／模型；填 `null` 时先使用 Agent 配置，没有配置时使用父会话模型。Agent 文件配置优先于调用值。

#### thinking（必填控制字段，枚举或 null）

thinking 等级：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。填 `null` 时先使用 Agent 配置，否则由子会话设置或默认值决定。Agent 文件配置优先于调用值。

#### run_in_background（必填控制字段，boolean 或 null）

填 `null` 时使用 Agent 配置，配置未指定时 nested 新建使用前台。后台需要可用的 owned `agent_manage` 工具；在自己结束前收取结果。恢复时填 `null`；执行在当前调用中等待结果。

#### resume（必填控制字段，string 或 null）

已结束且归自己所有的子 Agent 的真实 `agent_id`；新建时填 `null`，不要填空字符串。恢复时，所有其他控制字段必须填 `null`；执行在当前调用中等待结果。

#### isolated（必填控制字段，boolean 或 null）

无 description。

#### inherit_context（必填控制字段，boolean 或 null）

无 description。

#### isolation（功能启用时必填控制字段，off／worktree 或 null）

隔离模式。填 `null` 时使用配置，配置未指定时为 `off`。`off` 在当前检出目录运行 Agent。`worktree` 创建临时 Git worktree，让 Agent 在隔离的仓库副本中工作；副本看不到主检出目录中未提交或已暂存的修改。

## 3. subagent_workflow

工具描述：在用户明确授权编排的前提下运行 workflow 脚本。

### 完整 promptGuidelines

执行一个以确定性方式编排多个 subagent 的 workflow 脚本。workflow 在后台运行，此工具立即返回 `execution_id`，完成后会通知你。在 `/agents → Workflows` 查看实时进度。

workflow 用于组织多个 Agent 的工作：完整覆盖（分解后并行覆盖）、提高把握（提交前采用独立视角和对抗检查），或处理单个上下文装不下的规模（迁移、审计、大范围扫描）。脚本负责表达这种结构：哪些工作并行展开、哪些负责验证、哪些负责综合。

**只有用户明确选择多 Agent 编排时，才能调用此工具。** workflow 可能启动几十个 Agent，消耗大量 token；这种规模必须由用户提出，不能自行推断。明确选择包括以下任意一种：

- 用户用自己的话直接要求运行 workflow 或使用多 Agent 编排，例如 `"use a workflow"`、`"run a workflow"`、`"fan out agents"`、`"orchestrate this with subagents"`。要求必须来自用户原话；仅仅认为某任务能从 workflow 中受益，不算授权。
- 用户调用的 skill 或 slash command，其指令要求调用 `subagent_workflow`。
- 用户要求运行一个具体的命名或已保存 workflow。

其他任务即使明显适合并行，也**不要**调用此工具。使用 `subagent_run` 委派单个 Agent，或简短说明多 Agent workflow 能做什么、成本大致多少，再问用户是否运行。可以告诉用户，下次直接说 `"use a workflow"` 就能省去询问。

实际调用时，通常适合采用**混合方式**：先在当前会话里侦察（列出文件、找到相关通道、限定 diff 范围），确定工作清单，然后调用 `subagent_workflow` 用 pipeline 处理。开始任务前不必知道工作结构，但开始编排前必须知道。

可以跨轮次串联的常见单阶段 workflow：

- **理解（Understand）**：多个读取 Agent 并行检查相关子系统 → 结构化地图。
- **设计（Design）**：N 个独立方案组成评审面板 → 评分后综合。
- **审查（Review）**：按维度 → 发现问题 → 对抗验证（见下方示例）。
- **研究（Research）**：多种方式扫描 → 深读 → 综合。
- **迁移（Migrate）**：发现位置 → 分别转换（worktree 隔离）→ 验证。

更大的工作可以按顺序运行多个 workflow；读取每个结果后再决定下一阶段。你始终参与决策，每个 workflow 都是一次范围明确的并行展开。

提供此工具暴露的每个字段。新建执行时，恰好提供一个非 null 来源：内联 `script`、文件 `scriptPath` 或已保存的 `name`；其他来源字段及 `resumeFromRunId` 填 `null`。空字符串不合法。重放时，提供合法的 `resumeFromRunId`，最多提供一个非 null 来源；若要复用此前保存的脚本，将所有来源字段设为 `null`。未使用的控制字段填 `null`。这不适用于 `args`：其 JSON 值包括 `null` 都原样传入。标题和描述放在脚本的 `meta` 中，不放在工具参数中。

通过 `script` 内联传入脚本，不要先用 Write 写入文件。每次调用都会自动将脚本保存到会话目录下的文件，并在工具结果中返回路径。迭代 workflow 时，用 Write／Edit 修改该文件，然后用 `subagent_workflow` 重新调用，参数为 `{script: null, scriptPath: "<path>", name: null, args: null, resumeFromRunId: null}`，不要重新发送整个脚本。会运行多次的脚本应放在 `.pi/workflows/<name>.js`（或 `.agents/workflows/`；若要跟随用户在各处使用，则放在 `<agent dir>/workflows/`）；通过 `name` 字段调用，其他来源字段和 `resumeFromRunId` 填 `null`，显式提供 `args`，不要重新发送源码。

每个脚本必须以 `export const meta = {...}` 开始：

```js
export const meta = {
  name: 'find-flaky-tests',
  description: 'Find flaky tests and propose fixes',   // one-line, shown in permission dialog
  phases: [                                            // one entry per phase() call
    { title: 'Scan', detail: 'grep test logs for retries' },
    { title: 'Fix', detail: 'one agent per flaky test' },
  ],
}
// script body starts here — use agent()/parallel()/pipeline()/phase()/log()
phase('Scan')
const flaky = await agent('grep CI logs for retry markers', {schema: FLAKY_SCHEMA})
...
```

`meta` 必须是**纯字面量**，不能有变量、函数调用、展开运算或模板插值。必需字段：`name`、`description`。可选字段：`whenToUse`（在 workflow 列表中显示）、`phases`。`meta.phases` 中的阶段标题必须与 `phase()` 调用完全相同，标题按精确匹配处理；没有对应 meta 项的 `phase()` 调用会拥有独立的进度组。某阶段使用特定模型覆盖时，在对应 phase 项中添加 `model`。

脚本正文可用的 hooks：

- `agent(prompt: string, opts?: {label?: string, phase?: string, schema?: object, model?: string, effort?: string, isolation?: 'worktree', agentType?: string, gate?: string, resume?: string}): Promise<any>`：启动 subagent。没有 `schema` 时，返回其最终文本字符串。有 `schema`（JSON Schema）时，为 subagent 提供据此构建的 StructuredOutput 工具，`agent()` 返回已经验证的对象，无需解析。不符合 schema 的内容会退回给子 Agent 修正；若子 Agent 始终不通过该工具回答，会再收到一次提示，之后失败，调用返回 `null`，所以每个 schema 阶段之后都要过滤。用户在运行中跳过 Agent，或 Agent 在重试后仍因终止性 API 错误退出，也返回 `null`；用 `.filter(Boolean)` 过滤。`opts.label` 覆盖显示标签。`opts.phase` 显式指定该 Agent 的进度组；在 pipeline／parallel 阶段中使用它，可以避免全局 `phase()` 状态竞争，同一个 phase 字符串对应同一个分组框。`opts.model` 会覆盖这次调用使用的 Agent 定义模型；省略时先使用 Agent 定义里的模型，否则使用父会话模型。只有确信其他档位适合任务时才指定，不确定就省略。`opts.effort` 会覆盖这次调用使用的 Agent 定义 thinking 等级（`'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`）；省略时先使用 Agent 定义的等级，否则使用子会话设置或默认值。简单机械步骤用 `low`，较高等级只用于最难的验证／判断步骤。`opts.isolation: 'worktree'` 在新 Git worktree 中运行 Agent，成本高（每个 Agent 都有准备时间和磁盘开销），仅在多个 Agent 并行修改文件、否则会发生冲突时使用；Agent 结束后 worktree 会删除，修改保留在分支上。`opts.gate: '<command>'` 在 Agent 完成后运行 shell 命令并要求通过；非零退出会将 Agent 标为失败，命令输出作为错误。优先用 `gate: 'npm test'`，而不是询问另一个 Agent 代码看起来是否正确。`opts.resume: '<label>'` 继续此前使用该 label 的子 Agent，而不是重新开始，迭代循环因此能保留上下文；不能与 `agentType`、`model`、`effort`、`isolation`、`gate` 或 `schema` 组合。`opts.agentType` 使用自定义 Agent 类型，替代默认 workflow subagent；从与 `subagent_run` 相同的注册表解析，可与 `schema` 配合。可用类型：
  - `<available_types_with_descriptions>`
- `pipeline(items, stage1, stage2, ...): Promise<any[]>`：每个 item 独立依次通过各阶段，阶段之间**没有屏障**。item A 可以已进入阶段 3，而 item B 仍在阶段 1。这是多阶段工作的**默认方式**。总耗时等于最慢的单 item 链路，而不是各阶段最慢耗时之和。每个阶段回调收到 `(prevResult, originalItem, index)`；在后续阶段用 `originalItem/index` 标注工作，不必通过阶段 1 的返回值传递这些上下文。某阶段抛错时，该 item 变为 `null`，剩余阶段跳过。
- `parallel(thunks: Array<() => Promise<any>>): Promise<any[]>`：并发运行任务。这是**屏障**：等待所有 thunk 后才返回。thunk 抛错或其 Agent 出错时，对应结果变为 `null`，使用前先 `.filter(Boolean)`；只有致命的运行错误会继续抛出，而不是变成 null，例如超出上限、嵌套 workflow 无法加载，或库校验失败（如未知 `agent()` 选项、超出范围的 `effort`）。参数按文档定义的结构校验，因此拼写错误会使运行失败并指出错误字段，而不是悄悄形成 null 分支。只有确实需要所有结果一起到齐时才使用。
- `log(message: string): void`：向用户发送进度消息，显示为进度树上方的说明行。
- `phase(title: string): void`：开始新阶段，之后的 `agent()` 调用在进度展示中归到这个标题下。
- `args: any`：原样使用传给 `subagent_workflow` 的 `args` 值；工具的必填 `args` 字段包括 `null` 都原样传入，内部 `workflow()` 调用可以使用 `undefined`，不会自动继承上一次的 args。通过工具调用传入真正的 JSON 数组／对象，不要传 JSON 编码后的字符串：用 `args: ["a.ts", "b.ts"]`，不要用 `args: "[\"a.ts\", ...]"`。字符串化的列表会以一个字符串进入脚本，导致 `args.filter`／`args.map` 抛错。用它为命名 workflow 提供参数，例如直接传研究问题、目标路径或配置对象，不要通过旁路文件传递。
- `budget: {total: number|null, spent(): number, remaining(): number}`：这里 `budget.total` 始终是 `null`，它来自 pi 没有的 token 目标指令，所以 `while (budget.total && budget.remaining() > 50_000) { ... }` 这样的条件不会进入，也不会因缺少全局变量而抛错。`budget.spent()` 返回本次运行中 Agent 已消耗的输出 token 数。没有目标时，`budget.remaining()` 返回 `Infinity`。
- `workflow(nameOrRef: string | {scriptPath: string}, args?: any): Promise<any>`：将另一个 workflow 作为子步骤在当前流程内运行，返回其返回值。传入名称可调用已保存的 workflow，与 `{name: "..."}` 使用同一注册表；传入 `{scriptPath}` 可运行此前用 Write 写过的脚本文件。子 workflow 与当前运行共享并发上限、Agent 计数、abort signal 和 token 预算；它的 Agent 在 `/agents → Workflows` 中归入 `▸ name` 分组，token 计入 `budget.spent()`。`args` 参数成为子 workflow 的全局 `args`。只允许一层嵌套，子 workflow 内再调用 `workflow()` 会抛错。名称未知、`scriptPath` 不可读、子脚本语法错误时抛错；可以 catch 后妥善处理。

调用 `agent()` 时，以上未列出的选项都会按名称被拒绝。

subagent 会被告知，其最终文本就是返回值，不是面向人的消息，因此会返回原始数据。需要结构化输出时使用 `schema`；校验在工具调用层发生，不匹配时模型会重试。

脚本是普通 JavaScript，**不是 TypeScript**；类型注解（`: string[]`）、interface 和泛型都无法解析。正文在异步上下文中运行，可以直接使用 `await`。可用标准 JS 内置对象（JSON、Math、Array 等），但以下例外会抛错：`Date.now()`、`Math.random()`、不带参数的 `new Date()`，因为它们会破坏恢复机制。通过 `args` 传入时间戳，在 workflow 返回后添加时间；需要随机性时按 index 改变 Agent 的 prompt／label。`eval` 和 `Function(...)` 会抛错。不能访问文件系统或 Node.js API。

**默认使用 pipeline()。** 只有确实需要上一阶段所有结果一起到齐时，才使用阶段间屏障（parallel）。

只有阶段 N 需要阶段 N-1 的跨 item 上下文时，屏障才合理：

- 在昂贵的下游工作前，对完整结果集去重／合并。
- 总数为零时提前结束，例如“发现 0 个 bug → 完全跳过验证”。
- 阶段 N 的 prompt 要引用“其他发现”进行比较。

以下理由不足以使用屏障：

- “需要先 flatten／map／filter”：在 pipeline 阶段内部做，例如 `pipeline(items, stageA, r => transform([r]).flat(), stageB)`。
- “这些阶段概念上不同”：这正是 pipeline 表达的内容；独立阶段不等于同步阶段。
- “代码更整洁”：屏障确实会增加延迟。若有 5 个查找 Agent，最慢者耗时是最快者的 3 倍，屏障会让快速查找者有 2/3 的时间空等。

检查是否误用屏障：如果写成这样：

```js
const a = await parallel(...)
const b = transform(a)        // flatten, map, filter — no cross-item dependency
const c = await parallel(b.map(...))
```

中间转换不需要屏障。改成 pipeline，把转换放在阶段内部。不确定时使用 pipeline。

每个 workflow 的并发 `agent()` 调用上限为 `max(1, min(16, available CPUs - 2))`，超出部分排队，空出位置后运行。仍可给 parallel／pipeline 传入 100 个 item，所有 item 都会完成，只是任一时刻大约运行 10 个。一个 workflow 整个生命周期最多启动 1000 个 Agent，这是远高于正常使用规模的失控循环保护。单次 parallel／pipeline 最多接受 4096 个 item；超出会明确报错，不会悄悄截断。

标准多阶段模式：默认 pipeline，每个维度一完成审查就立即验证：

```js
export const meta = {
  name: 'review-changes',
  description: 'Review changed files across dimensions, verify each finding',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}
const DIMENSIONS = [{key: 'bugs', prompt: '...'}, {key: 'perf', prompt: '...'}]
const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, {label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA}),
  review => parallel(review.findings.map(f => () =>
    agent(`Adversarially verify: ${f.title}`, {label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA})
      .then(v => ({...f, verdict: v}))
  ))
)
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
return { confirmed }
// Dimension 'bugs' findings verify while dimension 'perf' is still reviewing. No wasted wall-clock.
```

屏障合理的情况：先汇集所有发现并去重，再执行昂贵验证：

```js
const all = await parallel(DIMENSIONS.map(d => () => agent(d.prompt, {schema: FINDINGS_SCHEMA})))
const deduped = dedupeByFileAndLine(all.filter(Boolean).flatMap(r => r.findings))  // <-- genuinely needs ALL at once
const verified = await parallel(deduped.map(f => () => agent(verifyPrompt(f), {schema: VERDICT_SCHEMA})))
```

循环到指定数量的模式：累积到目标：

```js
const bugs = []
while (bugs.length < 10) {
  const result = await agent("Find bugs in this codebase.", {schema: BUGS_SCHEMA})
  bugs.push(...result.bugs)
  log(`${bugs.length}/10 found`)
}
```

门控与重试模式：通过实际运行验证，并在尝试之间保留 Agent 上下文：

```js
let fixed = await agent('Find and fix the failing test.', {label: 'fix', gate: 'npm test'})
if (fixed === null) {                        // a non-zero exit failed the agent
  // Resume keeps everything the child already learned. It cannot carry the
  // gate, so re-verification needs its own gated call, in the same tree.
  fixed = await agent('`npm test` is still failing. Fix the cause.', {label: 'fix', resume: 'fix'})
  const verified = await agent('Run `npm test` and report the result. Change nothing.',
    {label: 'verify', phase: 'Verify', gate: 'npm test', effort: 'low'})
  return { passed: verified !== null, summary: fixed }
}
return { passed: true, summary: fixed }
// An LLM judging whether a fix works is a weaker signal than the test suite.
```

组合模式：全面审查（查找 → 相对 seen 去重 → 多视角面板 → 循环直到没有新发现）：

```js
const seen = new Set(), confirmed = []
let dry = 0
while (dry < 2) {                                              // loop-until-dry
  const found = (await parallel(FINDERS.map(f => () =>          // barrier: collect all finders this round
    agent(f.prompt, {phase: 'Find', schema: BUGS})))).filter(Boolean).flatMap(r => r.bugs)
  const fresh = found.filter(b => !seen.has(key(b)))           // dedup vs ALL seen — plain code, not an agent
  if (!fresh.length) { dry++; continue }
  dry = 0; fresh.forEach(b => seen.add(key(b)))
  const judged = await parallel(fresh.map(b => () =>           // every fresh bug judged concurrently...
    parallel(['correctness','security','repro'].map(lens => () =>   // ...each by 3 distinct lenses
      agent(`Judge "${b.desc}" via the ${lens} lens — real?`, {phase: 'Verify', schema: VERDICT})))
      .then(vs => ({ b, real: vs.filter(Boolean).filter(v => v.real).length >= 2 }))))
  confirmed.push(...judged.filter(v => v.real).map(v => v.b))
}
return confirmed
// dedup vs `seen`, NOT `confirmed` — else judge-rejected findings reappear every round and it never converges.
```

质量模式是常见的组织方式，可以按任务选择并自由组合：

- **对抗验证**：每个发现启动 N 个独立怀疑者，要求其反驳。达到多数反驳时丢弃，避免看似合理但错误的发现被保留。

```js
const votes = await parallel(Array.from({length: 3}, () => () =>
  agent(`Try to refute: ${claim}. Default to refuted=true if uncertain.`, {schema: VERDICT})))
const survives = votes.filter(Boolean).filter(v => !v.refuted).length >= 2
```

- **用运行验证，不靠询问**：能实际测试的结论使用 `gate`，不要问另一个模型是否成立。
- **多视角验证**：发现可能从多个方面出错时，给验证者不同视角（正确性、安全、性能、能否复现），不要启动 N 个完全相同的反驳者；视角差异能发现重复验证找不到的失败方式。
- **评审面板**：从不同角度生成 N 个独立方案，例如 MVP 优先、风险优先、用户优先；用并行评审者评分，以获胜方案为基础综合，吸收其他方案的最佳想法。解空间较大时，这比围绕一次尝试反复迭代更有效。
- **循环直到没有新发现**：问题数量未知（bug、问题、边界情况）时，持续启动查找者，直到连续 K 轮没有新结果。简单计数条件（`while count < N`）会遗漏尾部。
- **多方式扫描**：并行 Agent 分别按不同方式搜索，例如按容器、内容、实体、时间；各自不知道其他 Agent 找到了什么。单一搜索角度不够时适用。
- **完整性检查者**：最后一个 Agent 专门问“还缺什么——哪种方式没运行、哪个结论没验证、哪个来源没读？”其发现作为下一轮工作。
- **不要悄悄限制覆盖**：若 workflow 限制了覆盖（top-N、不重试、抽样），用 `log()` 说明丢弃了什么。没有说明的截断会被误读为已经完整覆盖。

规模应匹配用户要求。“找找有没有 bug”适合少量查找者、单票验证；“彻底审计”或“全面检查”适合更大的查找者池、3–5 票对抗验证和综合阶段。不确定时，研究／审查／审计偏向完整性，快速检查偏向简短。

这些模式不是全部；任务需要时可组合新的组织方式，例如锦标赛、自修复循环、分阶段升级等。

在多步骤编排的控制流需要由确定性逻辑（循环、条件、并行展开）决定，而不是由模型临场决定时，使用此工具。

#### 恢复（Resume）

工具结果包含 `execution_id`。暂停、终止或编辑脚本后要恢复，使用 `subagent_workflow`，传入 `scriptPath` 和 `resumeFromRunId`，将 `script/name` 设为 `null`，显式提供 `args`。最长的未修改 `agent()` 调用前缀会立即返回缓存结果；从第一个修改或新增调用开始，后续全部实际运行。同一脚本加同一 args，缓存命中率为 100%。这按前缀处理，不是按调用查找：前面某次调用变化后，后面的调用即使仍匹配也不会复用。已记入记录的失败会终止此前缀，因此在 Agent 5 失败的运行，恢复时恰好从 Agent 5 重试。仅限同一会话，且该运行必须已结束；先在 `/agents → Workflows` 停止它。诊断已完成 workflow 为何返回空或意外结果前，先用 Read 读取脚本旁的 `<run id>.workflow.jsonl`，其中记录每个 Agent 的实际返回值；不要假定缓存结果非空。脚本中不能使用 `Date.now()`／`Math.random()`／`new Date()`，它们会破坏此机制；在 workflow 返回后添加时间，或通过 `args` 传入时间戳。

### 完整 schema 参数描述

#### script（必填控制字段，string 或 null；字符串最长 524288）

内联 workflow 源码。使用其他来源或重放此前脚本时填 `null`。必须以 `export const meta = { name, description }` 开始。

#### scriptPath（必填控制字段，string 或 null）

workflow 脚本文件路径；未使用时填 `null`。与非 null 的 `script` 和 `name` 互斥。

#### name（必填控制字段，string 或 null）

已保存 workflow 的名称；未使用时填 `null`。与非 null 的 `script` 和 `scriptPath` 互斥。在项目的 `.pi/workflows`、`.agents/workflows` 和用户 workflow 目录中查找。

#### args（必填，任意 JSON 数据，包括 null；不是控制字段）

原样传入脚本并作为全局 `args` 的必填 JSON 数据。`null` 是数据，不是未指定的控制值。

#### resumeFromRunId（必填控制字段，string 或 null；字符串匹配 ^wf_[a-z0-9-]{6,}$）

新建执行时填 `null`，或提供此会话中此前 workflow 的 run id。其开头未修改的 `agent()` 调用立即返回已记录的结果；第一个修改或失败的调用及其后所有调用实际运行。相同的脚本和 args 意味着没有任何调用重新执行。

## 4. process_manage

工具描述：管理 bash 和 monitor 任务及其日志。

### 完整 promptGuidelines

- `bash` 运行有限命令；`monitor` 观察持续事件流。用 `process_manage` 检查、读取、等待、停止或搜索这些任务。subagent／workflow 执行使用 `agent_manage`。
- 提供每个暴露的字段：`action`、`task_id`、`task_type`、`offset`、`limit`、`pattern`、`ignore_case`、`context`。未使用的控制字段填 `null`；`action` 必须非 null。未知字段即使填 `null` 也不合法。
- 各 action 允许的非 null 参数：
  - list／stats：需要过滤时使用 `task_type`。
  - status／stop：`task_id`。
  - output：`task_id`，需要时使用 `offset/limit`。
  - wait：`task_id`，需要时使用 `limit`。
  - search：`pattern`，需要时使用 `task_id/task_type/ignore_case/context`。
- 从启动／列表结果复制 `task_id`。`task_type` 只过滤 bash／monitor。所选 action 列表之外的字段必须填 `null`。
- output 默认读取有界的尾部一页；`offset=0` 从开头读取。`offset/limit` 按字节计数；wait 接受 `limit` 来限制最终日志页。使用返回的范围继续读取。搜索使用正则表达式，可选择忽略大小写和上下文行。
- wait 等待整个任务；对 monitor，必须等到观察结束，不能仅仅等到出现一个事件。`/bg` 或取消只解除等待。stop 请求取消执行，之后执行仍可能在处理收尾。
- 成功交付终态 output／wait 时，会报告结果并避免重复完成通知。list／status／search 不消费结果。完成会自动通知；不要仅为检测完成而轮询。
- 示例：

读取日志：
```json
{"action":"output","task_id":"<task_id>","task_type":null,"offset":0,"limit":null,"pattern":null,"ignore_case":null,"context":null}
```

等待任务：
```json
{"action":"wait","task_id":"<task_id>","task_type":null,"offset":null,"limit":null,"pattern":null,"ignore_case":null,"context":null}
```

搜索日志：
```json
{"action":"search","task_id":null,"task_type":"bash","offset":null,"limit":null,"pattern":"ERROR","ignore_case":false,"context":0}
```

停止观察：
```json
{"action":"stop","task_id":"<monitor_task_id>","task_type":null,"offset":null,"limit":null,"pattern":null,"ignore_case":null,"context":null}
```

### 完整 schema 参数描述

#### action（必填，枚举，不可为 null）

可选值：`list`、`status`、`output`、`wait`、`stop`、`search`、`stats`。无 description。

#### task_id（必填控制字段，string 或 null）

来自 bash／monitor 启动或列表结果的任务标识；针对具体任务的动作必须非 null，未使用时填 `null`。

#### task_type（必填控制字段，bash／monitor 或 null）

将 list／stats／search 过滤到 bash 或 monitor；不过滤或执行其他动作时填 `null`。

#### offset（必填控制字段，非负整数或 null）

output 日志的字节偏移；`null` 读尾部，`0` 从开头读取；其他动作填 `null`。

#### limit（必填控制字段，正整数或 null）

output／wait 的日志字节预算；`null` 使用配置预算；其他动作填 `null`。

#### pattern（必填控制字段，string 或 null）

非空搜索正则表达式；其他动作填 `null`。

#### ignore_case（必填控制字段，boolean 或 null）

搜索是否忽略大小写；使用默认值 `false` 或执行其他动作时填 `null`。

#### context（必填控制字段，非负整数或 null）

搜索上下文行数；使用默认值 `0` 或执行其他动作时填 `null`。

## 5. agent_manage

工具描述：管理 subagent 和 Agent workflow 执行，不是控制对话。

### 完整 promptGuidelines

- 管理 `subagent_run` 或 `subagent_workflow` 启动的执行，不处理进程日志或 Agent 对话控制。bash／monitor 使用 `process_manage`；消息使用 `subagent_message`；Agent 恢复使用 `subagent_run`；workflow 重放使用 `subagent_workflow`。
- 提供每个暴露的字段：`action`、`execution_id`、`kind`、`verbose`。未使用的控制字段填 `null`；`action` 必须非 null。未知字段即使填 `null` 也不合法。
- 各 action 允许的非 null 参数：
  - list：需要时使用 `kind` 过滤；`execution_id` 和 `verbose` 必须填 `null`。
  - status／stop：`execution_id`；`kind` 和 `verbose` 必须填 `null`。
  - output／wait：`execution_id`，需要时使用 `verbose`；`kind` 必须填 `null`。
- `kind` 将 list 过滤到 subagent／workflow。从启动／列表结果复制 `execution_id`，不要自己构造，也不要用 `agent_id` 代替。`agent_id` 标识用于发消息／恢复的对话；`execution_id` 标识一次执行。不要为当前 action 不允许的字段提供非 null 值。
- Agent 恢复会产生新的 `execution_id`。用旧 `execution_id` 发起的新调用会因过期而失败，绝不会操作恢复后的执行。已经接受的 wait 仍绑定原执行。workflow 重放会创建独立执行，使用新 ID。
- output 返回当前输出／进度或最终结果；wait 等待整个执行。`verbose` 只适用于 subagent output／wait，用于请求额外对话，不是无限量执行轨迹。workflow 的 `verbose` 必须填 `null`。
- `/bg` 或取消只解除等待，不停止执行。stop 请求取消，执行仍可能在处理收尾。停止 workflow 也会停止其拥有的 Agent，不会停止独立的同级 Agent。可见的 owned 子 Agent 不一定能由其他拥有者直接管理。
- 成功交付终态 output／wait 时，会报告该执行结果并避免重复完成通知；list／status 不消费结果。完成会自动通知；不要仅为检测完成而轮询。
- 示例：

列出 workflow：
```json
{"action":"list","execution_id":null,"kind":"workflow","verbose":null}
```

读取结果：
```json
{"action":"output","execution_id":"<execution_id>","kind":null,"verbose":null}
```

等待执行：
```json
{"action":"wait","execution_id":"<execution_id>","kind":null,"verbose":null}
```

停止执行：
```json
{"action":"stop","execution_id":"<execution_id>","kind":null,"verbose":null}
```

### 完整 schema 参数描述

#### action（必填，枚举，不可为 null）

可选值：`list`、`status`、`output`、`wait`、`stop`。无 description。

#### execution_id（必填控制字段，string 或 null）

来自启动／列表结果的执行句柄；针对具体执行的动作必须非 null，list 时填 `null`。

#### kind（必填控制字段，subagent／workflow 或 null）

list 的过滤条件；不过滤或执行其他动作时填 `null`。

#### verbose（必填控制字段，boolean 或 null）

为 subagent output／wait 请求附加对话；`null` 与 `false` 效果相同。workflow 或其他动作必须填 `null`。

## 6. subagent_message

顶层工具描述：向当前运行中的 Agent 发送补充指导；交付不代表已处理。

nested 工具描述：向归当前父 Agent 所有、仍在运行的 nested Agent 发送指导。

### 完整 promptGuidelines（顶层与 nested 相同）

- 在允许的拥有关系范围内，向当前运行中的 Agent 发送补充指导。这不会启动新执行，也不会恢复已结束的 Agent。
- `agent_id` 和 `message` 必须是非空字符串，不能传 `null`。从启动／列表结果复制真实 `agent_id`；名称、类型别名和 `execution_id` 都不接受。
- Queued 表示正在等待 Agent 会话初始化。Sent 表示已提交给该会话。两者都不能证明 Agent 已经读取、执行或回答该消息。
- 对已结束的 Agent，使用 `subagent_run` 的 resume。查询执行进度／结果，使用 `agent_manage` 和 `execution_id`。
- 示例：

```json
{"agent_id":"<agent_id>","message":"Also check expired verification codes; keep the scope unchanged."}
```

### 完整 schema 参数描述：顶层

#### agent_id（必填，string，不可为 null）

来自启动／列表结果的真实 `agent_id`；必须标识此会话拥有且当前运行中的 Agent。不接受名称和 `execution_id`。

#### message（必填，string，不可为 null；最短长度 1）

要发送的非空白引导消息。它会作为用户消息出现在 Agent 对话中。

### 完整 schema 参数描述：nested

#### agent_id（必填，string，不可为 null）

无 description。

#### message（必填，string，不可为 null；最短长度 1）

给当前运行中的 nested Agent 的非空白指导。
