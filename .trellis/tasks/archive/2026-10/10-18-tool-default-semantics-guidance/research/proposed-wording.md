# 工具说明措辞对照（待确认）

这份文档只供审阅措辞：按工具列出需要修改的规则和参数说明，每项都有英文原文、中文含义、英文提案和中文含义。实际工具说明仍使用英文，中文只用于本任务的对照。

本次重点是让 Agent 分清：`null` 使用配置、固定默认、不适用字段，以及新建／恢复的区别。没有列出的文字保留原样；不重写 workflow 教程，也不改变执行行为。

## 1. subagent_run：顶层调用

### A. 规则修改（promptGuidelines）

#### A1. 不再把当前后台配置写进规则

**修改前**
```text
Without an agent-file pin, run_in_background:null uses the configured default: execution defaults to ${options.backgroundByDefault ? "background" : "foreground"}. Use foreground when your next action depends on the result; otherwise do useful independent work while background execution runs.
```
**中文含义**

Agent 文件没有固定执行模式时，`run_in_background:null` 使用配置默认值，并在说明里写出当前是后台还是前台。如果下一步依赖结果，就使用前台；否则可以在后台执行期间做其他独立工作。

**修改后**
```text
run_in_background:null uses configuration. Use foreground when your next action depends on the result; otherwise do useful independent work while background execution runs.
```
**中文含义**

`run_in_background:null` 使用配置。如果下一步依赖结果，就使用前台；否则可以在后台执行期间做其他独立工作。

**为什么改：** 说明配置的作用即可，不把某次读取到的前台／后台值写成固定承诺。

#### A2. 恢复保留会话设置，但重新决定本轮执行模式

只替换恢复规则的第一句，后续句子保留。

**修改前**
```text
Resume uses the real agent_id of a finished, resumable agent and retains its type, name and stored session settings.
```
**中文含义**

恢复时使用已结束且可恢复 Agent 的真实 `agent_id`，并保留它的类型、名称和已保存的会话设置。

**修改后**
```text
Resume uses the real agent_id of a finished, resumable agent and retains its type, name and session settings; the execution mode is resolved again for this call.
```
**中文含义**

恢复时使用已结束且可恢复 Agent 的真实 `agent_id`。类型、名称和会话设置保留，但这次调用的执行模式会重新确定。

**为什么改：** 保留会话不等于沿用上一次的前台／后台模式。

#### A3. 配置优先级只针对当前模式允许的参数（顶层与 nested 共用）

**修改前**
```text
- Agent-file configuration takes precedence over call parameters. Null control values use configuration/defaults. Results state explicit requests overridden by configuration; do not assume a requested value became effective.
```
**中文含义**

Agent 文件配置优先于调用参数。控制字段的 `null` 使用配置或默认值。结果会说明哪些显式请求被配置覆盖，不能认为传入的值一定生效。

**修改后**
```text
- Agent-file configuration takes precedence over applicable call parameters. Results state explicit requests overridden by configuration; do not assume a requested value became effective.
```
**中文含义**

对当前模式允许使用的参数，Agent 文件配置优先于调用值。结果会说明哪些显式请求被配置覆盖，不能认为传入的值一定生效。

**为什么改：** 不是所有 `null` 都表示使用配置，例如 `resume:null` 表示新建。具体含义放在各参数说明里，也避免让人以为恢复时能传新建参数。

#### A4. 收窄“null 不选择模式”的笼统说法（顶层与 nested 共用，补充澄清提案）

**修改前**
```text
- Provide every field exposed by this tool. Set unused control fields to null. Null means not specified and does not select a mode or override agent configuration. Unknown or disabled fields remain invalid even when null.
```
**中文含义**

必须提供工具暴露的每个字段，未使用的控制字段填 `null`。原文笼统地说 `null` 表示未指定，不选择模式，也不覆盖 Agent 配置。未知或禁用字段即使填 `null` 也不合法。

**修改后**
```text
- Provide every field exposed by this tool. Set unused control fields to null. For configuration controls, null leaves the choice to configuration/defaults; resume:null selects a new agent. Unknown or disabled fields remain invalid even when null.
```
**中文含义**

必须提供工具暴露的每个字段，未使用的控制字段填 `null`。配置类控制字段填 `null` 时，由配置或默认值决定；`resume:null` 则表示新建 Agent。未知或禁用字段即使填 `null` 也不合法。

**为什么改：** 原文的“null 不选择模式”容易和新建／恢复规则冲突。这里只澄清这一个工具里的区别，不扩展成所有工具的统一规则。

**其余规则保留：** 委派时机、自包含任务描述、结果核验、New／Resume 参数组合、可用类型、真实 ID 的用途、后台通知与等待、Git 隔离、调度限制和现有示例均不改。恢复规则中关于非空 `resume`、新建字段必须填 `null`、运行中用 `subagent_message` 的后续句子也保留。

### B. 参数 description 修改

#### B1. model：明确模型来源和配置优先级

**修改前**
```text
Model override. Accepts "provider/modelId" or fuzzy name (e.g. "haiku", "sonnet"). Set null to use the agent type's default.
```
**中文含义**

可指定模型，支持 `provider/modelId` 或模糊名称，例如 `haiku`、`sonnet`。填 `null` 时使用该 Agent 类型的默认模型。

**修改后**
```text
Model override. Accepts "provider/modelId" or fuzzy name (e.g. "haiku", "sonnet"). Null uses Agent configuration, then the parent session model; Agent-file configuration takes precedence over the call.
```
**中文含义**

可指定模型，支持的写法不变。填 `null` 时先使用 Agent 配置里的模型，没有配置时使用父会话模型；Agent 文件配置优先于本次调用值。

**为什么改：** “类型默认模型”不够具体，也没有说明调用值可能被 Agent 文件覆盖。

#### B2. thinking：默认来自子会话设置，不是父会话当前 thinking（与 nested 共用）

**修改前**
```text
Thinking level: ${THINKING_LEVELS.join(", ")}. Set null to use configuration/defaults. Agent-file configuration takes precedence.
```
**中文含义**

选择列出的 thinking 等级。填 `null` 时使用配置或默认值，Agent 文件配置优先。

**修改后**
```text
Thinking level: ${THINKING_LEVELS.join(", ")}. Null uses Agent configuration, then child session settings/defaults. Agent-file configuration takes precedence over the call.
```
**中文含义**

选择列出的 thinking 等级。填 `null` 时先使用 Agent 配置，否则由子会话自己的设置或默认值决定；Agent 文件配置优先于调用值。

**为什么改：** 明确默认值的来源，避免误读为直接继承父会话当前的 thinking 等级。

#### B3. run_in_background：使用静态配置说明

**修改前**
```text
Execution mode; set null to use configuration/defaults. Default without an agent-file pin: ${getBackgroundByDefault() ? "background" : "foreground"}. Agent-file configuration takes precedence. Background returns execution identity; foreground waits for results.
```
**中文含义**

执行模式填 `null` 时使用配置或默认值。Agent 文件没有固定模式时，说明里会写出当前默认是后台还是前台。Agent 文件配置优先；后台返回执行标识，前台等待结果。

**修改后**
```text
Execution mode; null uses configuration. Agent-file configuration takes precedence over true/false requests. Background returns execution identity; foreground waits for results.
```
**中文含义**

执行模式填 `null` 时使用配置。即使显式传入 `true` 或 `false`，Agent 文件配置仍然优先。后台返回执行标识，前台等待结果。

**为什么改：** 去掉当前配置值，同时说明 `true/false` 也不一定能覆盖 Agent 文件。

#### B4. resume：区分新建、恢复和本轮执行模式

**修改前**
```text
Real agent_id of a finished agent. Set null for new agents; an empty string is invalid. With resume, set new-agent fields to null; prompt and run_in_background remain applicable; stored session settings are retained.
```
**中文含义**

填写已结束 Agent 的真实 `agent_id`。新建时填 `null`，不能填空字符串。恢复时新建字段必须填 `null`，仍可使用 `prompt` 和 `run_in_background`，并保留已保存的会话设置。

**修改后**
```text
Real agent_id of a finished agent. Null starts a new agent; an empty string is invalid. With resume, set new-agent fields to null; prompt and run_in_background remain applicable. Session settings are retained; execution mode is resolved again for this call.
```
**中文含义**

填写已结束 Agent 的真实 `agent_id`。填 `null` 表示新建，不能填空字符串。恢复时新建字段必须填 `null`，仍可使用 `prompt` 和 `run_in_background`。会话设置保留，本轮执行模式重新确定。

**为什么改：** 把新建选择和执行模式说明分开，避免把会话设置理解成上一次的全部执行设置。

#### B5. isolated：无配置时才默认 false

**修改前**
```text
Set null to use configuration/defaults. If true, agent gets no extension/MCP tools — only built-in tools.
```
**中文含义**

填 `null` 时使用配置或默认值。为 `true` 时，Agent 只能使用内置工具，没有扩展或 MCP 工具。

**修改后**
```text
Null uses configuration, otherwise false. If true, agent gets no extension/MCP tools — only built-in tools.
```
**中文含义**

填 `null` 时使用配置；配置未指定时默认为 `false`。为 `true` 时，Agent 只能使用内置工具，没有扩展或 MCP 工具。

**为什么改：** 就近说明固定默认值，但不把配置里的 `true` 忽略掉。

#### B6. inherit_context：把父对话文本加入 prompt，不是复制会话

**修改前**
```text
Set null to use configuration/defaults. If true, fork parent conversation into the agent. Default: false (fresh context).
```
**中文含义**

填 `null` 时使用配置或默认值。为 `true` 时，原文说把父对话“分叉”给 Agent；默认 `false`，使用新的上下文。

**修改后**
```text
Null uses configuration, otherwise false (fresh context). If true, include parent conversation text in the prompt.
```
**中文含义**

填 `null` 时使用配置；配置未指定时默认为 `false`，使用新的上下文。为 `true` 时，把父对话的文本加入任务 prompt。

**为什么改：** 实际传递的是对话文本，不是通过 SDK 分叉父会话。

#### B7. isolation：配置未指定时才使用 off（与 nested 共用）

**修改前**
```text
Isolation mode. Set null to use configuration/defaults. Default "off". "off" runs the agent in the current checkout. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo (a copy cannot see uncommitted or staged changes in the main checkout).
```
**中文含义**

Git 工作目录隔离模式。填 `null` 时使用配置或默认值，默认是 `off`。`off` 在当前检出目录工作；`worktree` 创建临时 Git worktree，在仓库副本工作，副本看不到主检出目录里未提交或已暂存的修改。

**修改后**
```text
Isolation mode. Null uses configuration, otherwise "off". "off" runs the agent in the current checkout. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo (a copy cannot see uncommitted or staged changes in the main checkout).
```
**中文含义**

Git 工作目录隔离模式。填 `null` 时使用配置，配置未指定时使用 `off`。`off` 和 `worktree` 的功能及限制不变。

**为什么改：** 只澄清默认值与配置的关系，不改变 Git 隔离能力或项目授权要求。

**其余参数说明保留：** `prompt`、`description`、`name`、`subagent_type`、`schedule` 不改。自动命名、立即执行等已有说明保持各自含义，不统一改成“使用配置”。

## 2. subagent_run：nested 调用

这是 Agent 内部调用的同名工具，不能直接套用顶层的执行模式说明。

### A. 规则修改（promptGuidelines）

#### A1. 恢复始终在当前调用中等待结果

只替换恢复规则的第一句，后续句子保留。

**修改前**
```text
Resume uses the real agent_id of a finished, resumable agent and retains its type, name and stored session settings.
```
**中文含义**

恢复时使用已结束且可恢复 Agent 的真实 `agent_id`，并保留它的类型、名称和已保存的会话设置。

**修改后**
```text
Resume uses the real agent_id of a finished, resumable agent and retains its type, name and session settings; nested resume always waits inline.
```
**中文含义**

恢复时使用真实 `agent_id`，保留类型、名称和会话设置；nested 恢复始终在当前调用中等待结果。

**为什么改：** nested 恢复不能像顶层一样重新选择后台模式。

**共用规则同步修改：** 第 1 节 A3（配置优先级）和 A4（`null` 的范围）同样用于 nested，采用上面完整的英文提案，不另写一套解释。

**其余规则保留：** 已有规则明确新建默认前台，Agent 配置可以覆盖；后台需要可用的 owned `agent_manage`，父 Agent 结束时会停止其子 Agent；nested 恢复始终前台，`run_in_background` 必须填 `null`。这些规则以及允许的类型、深度限制、模式组合、ID 用法、通知和示例均保留。

### B. 参数 description 修改

#### B1. model：补齐配置与父模型的关系

**修改前**
```text
Provider/model override; set null to use configuration/defaults.
```
**中文含义**

可指定 provider／模型；填 `null` 时使用配置或默认值。

**修改后**
```text
Provider/model override; null uses Agent configuration, then the parent session model. Agent-file configuration takes precedence over the call.
```
**中文含义**

可指定 provider／模型；填 `null` 时先使用 Agent 配置，没有配置时使用父会话模型。Agent 文件配置优先于调用值。

**为什么改：** 与顶层遵循相同优先级，但这里的父会话是直接发起 nested 调用的 Agent 会话。

#### B2. run_in_background：明确默认前台和恢复限制

**修改前**
```text
Defaults to false for nested spawns — the call blocks and returns the child's result inline. Set true only for work you will collect later with agent_manage; a detached child is stopped when you finish.
```
**中文含义**

nested 新建默认 `false`，调用会等待并直接返回子 Agent 的结果。只有准备稍后用 `agent_manage` 收取结果时才设为 `true`；调用者结束时，后台子 Agent 会被停止。

**修改后**
```text
Null uses Agent configuration, otherwise foreground for nested spawns. Background requires an available owned agent_manage tool; collect the result before you finish. With resume, set null; execution waits inline.
```
**中文含义**

nested 新建时，填 `null` 使用 Agent 配置，配置未指定时使用前台。后台执行需要可用的 owned `agent_manage`，必须在自己结束前收取结果。恢复时此字段必须填 `null`，调用会等待结果。

**为什么改：** 不把前台默认说成无条件规则，也就近说明恢复时不能传 `true/false`。父 Agent 结束时停止子 Agent 的规则仍保留在 guidelines 中。

**共用参数同步修改：** `thinking` 和 `isolation` 分别采用第 1 节 B2、B7 的完整 description；含义与顶层一致。

**其余参数说明保留：** `prompt`、`description`、`subagent_type`、`resume` 不改。nested 的 `resume` 已明确其他控制字段必须填 `null`，并在当前调用中等待结果。

### 可选补充：为 isolated／inherit_context 增加 description（未纳入建议方案）

这两个 nested 字段目前没有 description。此前建议是**不新增**，本次仍保持该建议。下面仅供选择是否额外补齐，不算已采用的修改。

#### 可选 1. isolated

**修改前**

无 description。

**中文含义**

该字段没有单独的文字说明。

**修改后**
```text
Null uses configuration, otherwise false. If true, agent gets no extension/MCP tools — only built-in tools.
```
**中文含义**

填 `null` 时使用配置；配置未指定时默认为 `false`。为 `true` 时，只能使用内置工具，没有扩展或 MCP 工具。

#### 可选 2. inherit_context

**修改前**

无 description。

**中文含义**

该字段没有单独的文字说明。

**修改后**
```text
Null uses configuration, otherwise false (fresh context). If true, include parent conversation text in the prompt.
```
**中文含义**

填 `null` 时使用配置；配置未指定时默认为 `false`，使用新的上下文。为 `true` 时，把父对话文本加入任务 prompt。

**为什么可能补充：** 方便只看参数说明的 Agent 理解这两个字段；代价是增加与顶层相同的说明。未选择该补充时，两字段保持现状。

## 3. subagent_workflow

### A. 规则修改（promptGuidelines）

这里修改的是指南里的 JavaScript `agent()` 选项说明，不是顶层 JSON 工具参数。

#### A1. opts.model：显式选项优先于 Agent 定义

**修改前**
```text
opts.model overrides the model for this agent call. Default to omitting it — the agent inherits the main-loop model (the resolved session model), which is almost always correct. Only set it when you're highly confident a different tier fits the task; when unsure, omit.
```
**中文含义**

`opts.model` 为这次 Agent 调用指定模型。默认建议省略，原文说 Agent 会继承主循环模型；只有确信需要其他档位时才指定，不确定就省略。

**修改后**
```text
opts.model overrides the Agent definition's model for this call. Omit it to use the Agent definition's model, then the parent session model. Only set it when you're highly confident a different tier fits the task; when unsure, omit.
```
**中文含义**

`opts.model` 会覆盖这次调用使用的 Agent 定义模型。省略时先使用 Agent 定义里的模型，没有配置时才使用父会话模型。只有确信需要其他档位时才指定，不确定就省略。

**为什么改：** workflow 的显式模型选项优先于 Agent 定义，与 `subagent_run` 的“Agent 文件优先”不同；省略也不一定直接使用父模型。

#### A2. opts.effort：明确子会话默认，不声称继承父 thinking

**修改前**
```text
opts.effort overrides the reasoning effort for this agent call ('off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') — omit to inherit the agent definition's own level, then the parent's; use 'low' for cheap mechanical stages and higher tiers only for the hardest verify/judge stages.
```
**中文含义**

`opts.effort` 指定这次调用的推理等级，可选值如上。省略时原文说先继承 Agent 定义的等级，再继承父级等级；简单机械步骤使用 `low`，较高等级只用于最难的验证／判断步骤。

**修改后**
```text
opts.effort overrides the Agent definition's thinking level for this call ('off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') — omit to use the Agent definition's level, then child session settings/defaults; use 'low' for cheap mechanical stages and higher tiers only for the hardest verify/judge stages.
```
**中文含义**

`opts.effort` 会覆盖这次调用使用的 Agent 定义 thinking 等级，可选值不变。省略时先使用 Agent 定义的等级，否则由子会话自己的设置或默认值决定。简单机械步骤使用 `low`，较高等级只用于最难的验证／判断步骤。

**为什么改：** 与模型选项一样，显式 effort 优先于 Agent 定义；但其默认来源不是父会话当前 thinking。

**其余规则保留：** 用户明确选择 workflow 的前提、脚本来源、meta、其他 `agent()` 选项、pipeline／parallel、示例、数量限制、恢复和重放说明均不改。JavaScript 可选参数仍可省略，不要求像顶层工具参数一样全部填 `null`。

### B. 参数 description 修改

**无修改。** 顶层 `script`、`scriptPath`、`name`、`args`、`resumeFromRunId` 的说明保留。

尤其保留 `args` 的区别：它是原样传递的数据，字面 `null` 仍然传入脚本，不表示省略，也不表示继承上一次的 args。来源字段的 `null` 表示不选择该来源，不能套用“null 使用配置”的说法。

## 4. process_manage

### A. 规则修改（promptGuidelines）

#### A1. search 示例写出简短的固定值

**修改前**
```text
Search logs: {"action":"search","task_id":null,"task_type":"bash","offset":null,"limit":null,"pattern":"ERROR","ignore_case":null,"context":null}
```
**中文含义**

搜索 bash 日志中的 `ERROR`。`ignore_case` 和 `context` 使用默认值；搜索动作不使用的 `offset`、`limit` 填 `null`。

**修改后**
```text
Search logs: {"action":"search","task_id":null,"task_type":"bash","offset":null,"limit":null,"pattern":"ERROR","ignore_case":false,"context":0}
```
**中文含义**

搜索 bash 日志中的 `ERROR`，明确区分大小写，不显示匹配行前后的额外行。搜索动作不使用的 `offset`、`limit` 仍填 `null`。

**为什么改：** 这两个适用字段有简单固定默认值，示例可以直接表达；不适用字段仍必须是 `null`，不做全局替换。

**其余规则保留：** 每个字段都要提供、action 适用范围、真实 task_id、output 默认读尾部、等待与停止的区别、完成通知和其他三个示例均不改。

### B. 参数 description 修改

#### B1. limit：明确使用配置预算

**修改前**
```text
Output/wait log byte budget; null for default or other actions.
```
**中文含义**

output／wait 的日志字节预算；使用默认值或执行其他动作时填 `null`。

**修改后**
```text
Output/wait log byte budget; null uses the configured budget; null for other actions.
```
**中文含义**

output／wait 的日志字节预算；填 `null` 时使用配置预算。其他动作必须填 `null`。

**为什么改：** 说明默认预算来自配置，但不写入当前的具体数值。

**其余参数说明保留：** `offset:null` 读尾部、`offset:0` 从头读；search 中 `ignore_case:null` 使用 `false`、`context:null` 使用 `0`。这些固定默认已经清楚，无需重复改写。身份、过滤条件、搜索表达式和其他动作的 `null` 限制也保留。

## 5. agent_manage

### A. 规则修改（promptGuidelines）

#### A1. verbose：把“详细格式”改成实际请求的额外对话

只替换下面两个完整句子，同一段前面的 output／wait 说明保留。

**修改前**
```text
verbose is only for subagent output/wait and requests formatted detail, not an unlimited trace. Set verbose to null for workflow.
```
**中文含义**

`verbose` 只适用于 subagent 的 output／wait，用来请求更详细的格式化内容，而不是无限量的执行轨迹。workflow 必须填 `null`。

**修改后**
```text
verbose is only for subagent output/wait and requests additional conversation, not an unlimited trace. Set verbose to null for workflow.
```
**中文含义**

`verbose` 只适用于 subagent 的 output／wait，用来请求额外的对话内容，而不是无限量的执行轨迹。workflow 必须填 `null`。

**为什么改：** 说明请求的实际内容，不把它说成泛泛的“更详细输出”；也不保证一定能取得额外对话。

**其余规则保留：** 管理执行而非会话、全部字段与 action 适用范围、execution_id／agent_id 区别、恢复后的执行 ID、等待与停止、可见范围、完成通知和四个示例均不改。

### B. 参数 description 修改

#### B1. verbose：适用时 null 与 false 同效，workflow 必须 null

**修改前**
```text
Formatted detail for subagent output/wait; null when unused or for workflow.
```
**中文含义**

subagent output／wait 的详细格式化输出选项；不用时或管理 workflow 时填 `null`。

**修改后**
```text
Include additional conversation for subagent output/wait; null behaves like false. Must be null for workflow or other actions.
```
**中文含义**

在 subagent output／wait 中请求附加对话；此时 `null` 与 `false` 一样，都不请求附加对话。管理 workflow 或执行其他动作时，必须填 `null`。

**为什么改：** 既说明固定默认效果，也保留适用范围。不能因为 `null` 与 `false` 在 subagent output／wait 中同效，就给 workflow 传 `false`。

**其余参数说明保留：** `action`、`execution_id`、`kind` 不改。

## 6. subagent_message：不修改

### A. 规则修改

无。只向当前运行中的 Agent 发送补充消息，不新建或恢复；`agent_id` 和 `message` 必须为非空字符串，不能传 `null`。真实 ID、权限范围、排队／已提交不代表已读等规则全部保留。

### B. 参数 description 修改

无。现有说明与使用方式一致，不为了统一措辞引入 nullable 解释。

## 源码位置

以下路径相对项目根目录，仅列文字所在位置，便于需要时查原文：

- 顶层 `subagent_run`：`extensions/agent-tasks/src/tool-guidance.ts`、`extensions/agent-tasks/src/index.ts`；共用 thinking／isolation 描述在 `extensions/agent-tasks/src/invocation-config.ts`。
- nested `subagent_run`：`extensions/agent-tasks/src/nested-tools.ts`，另共用上述 guidance 和参数描述。
- `subagent_workflow`：规则在 `extensions/agent-tasks/src/workflow/tool-description.ts`，顶层参数描述在 `extensions/agent-tasks/src/index.ts`。
- `process_manage`、`agent_manage`：`extensions/runtime-tasks/tools.ts`。
- `subagent_message`：规则在 `extensions/agent-tasks/src/tool-guidance.ts`，参数说明在顶层／nested 注册文件。

## 确认范围

本稿保留此前 18 项模型可见措辞提案，并补充 1 项“null 不选择模式”的局部澄清；恢复规则分别给出顶层和 nested 版本。另列 2 项未采用的可选 description 补充。

本次只重写此研究文档。没有修改产品代码、其他任务材料或任务状态，没有提交、安装或运行测试。代码注释、实现方式和验证安排不在这份措辞审阅稿中；确认英文提案也不等于产品已完成修改。
