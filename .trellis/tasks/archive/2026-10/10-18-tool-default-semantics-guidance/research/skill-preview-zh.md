# 最终分层工具指引完整中文预览

这是拟发布英文资源的中文审阅稿。工具字段、代码、命令、标识符及示例保留原拼写；本文不代表产品已经实施。所有 schema 字段均必填，“或 null”不等于可省略。以下展示启用 isolation/scheduling 的顶层工具、启用 isolation 的 nested 工具；功能关闭时对应字段、规则和示例字段一起移除。`<available_types_with_descriptions>`、`<available_types>`、`<allowed_nested_types>` 代表当次注册的动态列表，示例 `<available_type>` 必须换为允许的真实类型。

## 一、常驻工具契约

这些底线始终放在工具中，不依赖 Skill。仅当当前索引提供了可自动调用的 Subagents Skill 且有允许的读取工具时，按其路径读取；Skill 缺失、禁用或不可读时，不从硬编码路径旁路加载，不假装已读，也不改变权限。普通委派仍按工具契约安全调用；没有读到 workflow API 时，不猜测 API 编写或修改脚本，先说明限制。用户明确要求运行已有 workflow 时仍遵守来源与授权底线。

### 1. subagent_run：顶层

**description**：启动或恢复一个自主 Agent，执行委派工作。

**promptSnippet**：为复杂多步骤任务启动自主子 Agent。

**完整 promptGuidelines**

- 对较大的独立工作或广泛探索使用专门 Agent；目标已知的小任务直接使用工具。不要重复已委派的调查。prompt 必须自包含，写清目标、上下文、约束、修改或只读权限及预期结果；报告成功前检查实际修改与验证，子 Agent 总结不是证明。详细委派协调按当前可用的 Subagents Skill 读取。
- 提供当前工具暴露的每个字段，未使用控制字段填 `null`。配置控制的 `null` 交给配置／默认值；`resume:null` 选择新建。未知或禁用字段即使为 `null` 也无效。
- New 必需非 null：`prompt`、`description`、`subagent_type`；可配置 `name`、`model`、`thinking`、`run_in_background`、`isolated`、`inherit_context`、`isolation`、`schedule`。Resume 必需非 null：`prompt`、`resume`；只允许另设 `run_in_background`。模式外字段必须为 `null`，必需字符串非空；description 是新建专用简短具体 UI 摘要。可用类型：`<available_types_with_descriptions>`。
- Resume 使用已结束、可恢复 Agent 的真实 `agent_id`，保留类型、名称、会话设置，但本次执行模式重新确定。空 resume 无效；运行中用 `subagent_message`。Agent 文件优先于适用的调用参数；以结果的实际／被覆盖请求为准。`run_in_background:null` 使用配置；下一步依赖结果时选前台，否则可在后台运行期间做独立工作。
- 后台启动只是接受或排队，不是完成。复制 `agent_id` 用于消息／恢复，`execution_id` 用于 `agent_manage`，不得替换。前台返回内联结果；释放等待不停止执行。后台完成自动通知；不要只为检测完成而轮询或 sleep，不编造结果。
- `isolation` 是 Git 工作目录隔离：off 当前检出，worktree 临时副本看不到未提交修改；遵守项目 worktree 授权。`isolated` 则禁用扩展／MCP 工具。只有用户明确要求延迟／周期执行才使用 schedule；它创建调度定义而非当前执行，不能与 resume、inherit_context 或 run_in_background:false 组合。
- 示例：

```json
{"prompt":"Inspect login validation; do not edit files; report concrete defects.","description":"Inspect login validation","subagent_type":"<available_type>","name":null,"model":null,"thinking":null,"run_in_background":false,"resume":null,"isolated":null,"inherit_context":null,"isolation":null,"schedule":null}
```

```json
{"prompt":"Check the remaining boundary cases.","description":null,"subagent_type":null,"name":null,"model":null,"thinking":null,"run_in_background":null,"resume":"<agent_id>","isolated":null,"inherit_context":null,"isolation":null,"schedule":null}
```

**完整 schema descriptions**

| 字段／类型（均必填） | description |
| --- | --- |
| prompt: string | Agent 要执行的任务。 |
| description: string 或 null | 新建时必需：简短、具体的任务描述。恢复时为 null。 |
| name: string 或 null | 新建 Agent 的名称；null 自动命名，可在输入框用 @name。工具消息／恢复用真实 agent_id；执行管理用 execution_id。恢复时为 null。 |
| subagent_type: string 或 null | 新建必须非 null，恢复为 null。可用类型：`<available_types>`。 |
| model: string 或 null | 模型覆盖，支持 provider/modelId 或模糊名称（haiku、sonnet）。null 先使用 Agent 配置，否则父会话模型；Agent 文件优先于调用。 |
| thinking: off/minimal/low/medium/high/xhigh/max 或 null | thinking 等级如枚举。null 先使用 Agent 配置，否则子会话设置／默认值。Agent 文件优先于调用。 |
| run_in_background: boolean 或 null | 执行模式；null 使用配置。Agent 文件优先于 true/false 请求。后台返回执行标识，前台等待结果。 |
| resume: string 或 null | 已结束 Agent 的真实 agent_id。null 新建，空字符串无效。恢复时新建字段为 null；prompt、run_in_background 仍适用。保留会话设置，本次模式重新确定。 |
| isolated: boolean 或 null | null 使用配置，否则 false。true 时无扩展／MCP 工具，只有内置工具。 |
| inherit_context: boolean 或 null | null 使用配置，否则 false（新上下文）。true 将父对话文本加入 prompt。 |
| isolation: off/worktree 或 null（启用时） | 隔离模式。null 使用配置，否则 off。off 当前检出；worktree 创建临时 Git worktree，在隔离仓库副本工作，副本看不到主检出未提交或已暂存修改。 |
| schedule: string 或 null（启用时） | 仅明确选择时使用：稍后而非现在。null 立即运行（默认，几乎总是合适）。格式：6 字段 cron（"0 0 9 * * 1" = 周一 9am）、interval（"5m"/"1h"）、one-shot（"+10m" 或 ISO）。强制 run_in_background；不兼容 inherit_context/resume。返回 job ID。 |

### 2. subagent_run：nested

**description**：为有明确范围的委派工作启动适合子 Agent 使用的 nested subagent。仅允许父 Agent 授权类型，受深度限制。

**promptSnippet**：启动或恢复归自己所有的 nested Agent。

**完整 promptGuidelines**

- 较大独立工作／广泛探索可委派，已知小任务直接做，不重复调查。prompt 写清目标、上下文、约束、修改或只读权限、预期结果；核对实际修改与验证后才报告成功。详细协调按当前可用 Subagents Skill 读取。
- 提供所有当前暴露字段，未用控制为 null。配置控制 null 留给配置／默认值，resume:null 新建；未知／禁用字段即使 null 也拒绝。New 必需 prompt、description、subagent_type；可设 model、thinking、run_in_background、isolated、inherit_context、isolation。Resume 仅 prompt、resume；其他控制全部 null。必需字符串非空，description 仅为新建 UI 摘要。允许类型：`<allowed_nested_types>`。
- 仅恢复已结束、可恢复、归自己所有的真实 agent_id，保留类型、名称和会话设置；nested resume 始终内联等待，run_in_background 必须 null。运行中用 subagent_message。Agent 文件优先于适用调用参数，以实际结果为准。
- nested 新建 null 使用 Agent 配置，否则默认前台。后台需要当前可用的 owned agent_manage，必须在自己结束前收取结果；父 Agent 结束会停止其子 Agent。后台接受／排队不是完成，不能依赖顶层完成通知替自己收取 owned child。
- agent_id 用于消息／恢复，execution_id 用于 agent_manage，不混用；前台返回内联结果，释放等待不停止执行。不要轮询或 sleep 只为检测完成；收取实际结果，不编造。
- isolation 是 Git 工作目录隔离，off 当前检出、worktree 临时副本不含未提交修改，遵守项目授权；isolated 是禁用扩展／MCP 工具，不是 Git worktree。
- 示例：

```json
{"prompt":"Inspect login validation; do not edit files; report concrete defects.","description":"Inspect login validation","subagent_type":"<available_type>","model":null,"thinking":null,"run_in_background":false,"resume":null,"isolated":null,"inherit_context":null,"isolation":null}
```

```json
{"prompt":"Check the remaining boundary cases.","description":null,"subagent_type":null,"model":null,"thinking":null,"run_in_background":null,"resume":"<agent_id>","isolated":null,"inherit_context":null,"isolation":null}
```

**完整 schema descriptions**

| 字段／类型（均必填） | description |
| --- | --- |
| prompt: string | nested Agent 的自包含任务。 |
| description: string 或 null | 新建必需非 null，恢复为 null：简短任务描述。 |
| subagent_type: string 或 null | 新建必需非 null，恢复为 null。允许类型：`<allowed_nested_types>`。 |
| model: string 或 null | provider/model 覆盖；null 先 Agent 配置，再父会话模型。Agent 文件优先于调用。 |
| thinking: off/minimal/low/medium/high/xhigh/max 或 null | thinking 等级如枚举。null 先 Agent 配置，再子会话设置／默认值；Agent 文件优先于调用。 |
| run_in_background: boolean 或 null | null 使用 Agent 配置，否则 nested 新建前台。后台需要可用 owned agent_manage，在自己结束前收取结果。恢复时为 null，内联等待。 |
| resume: string 或 null | 已结束 owned child 的真实 agent_id；null 新建，不能空字符串。恢复时所有其他控制为 null；内联等待。 |
| isolated: boolean 或 null | 无 description。 |
| inherit_context: boolean 或 null | 无 description。 |
| isolation: off/worktree 或 null（启用时） | 隔离模式。null 使用配置，否则 off。off 当前检出；worktree 创建临时 Git worktree，在隔离仓库副本工作，副本看不到主检出未提交或已暂存修改。 |

### 3. subagent_workflow

**description**：在用户明确授权编排时运行 workflow 脚本。

**promptSnippet**：运行确定性脚本，编排多个 subagent。

**完整 promptGuidelines**

- 只有用户显式选择多 Agent 编排才调用：用户原话要求 workflow／fan out／orchestrate with subagents；用户主动调用明确要求 subagent_workflow 的 skill/slash command；或用户要求具体 named/saved workflow。可能适合并行不是授权；自动读取 Subagents Skill 也不是授权。未授权时用单独 subagent_run，或说明能做什么与大致成本后询问；用户下次可直接说 "use a workflow"。
- 编写／修改脚本前，读取当前可用、允许自动调用且可读的 Subagents Skill 和 workflow-api reference；复杂设计再读 patterns。无可用入口／reader 不绕过禁用、不猜 API，说明限制。读取不授予执行、文件修改、安装或 worktree 权限。
- 工具始终后台，返回 execution_id 只是启动，不是完成。用 agent_manage 管理，/agents → Workflows 看进度；自动通知，不仅为检测完成轮询或 sleep，释放 wait 不停止运行。
- 每个暴露字段都要提供。新执行恰好一个非 null 来源 script/scriptPath/name，其他来源和 resumeFromRunId 为 null；重放提供同会话已结束运行的 resumeFromRunId，至多一个来源，所有来源 null 复用原脚本。空字符串无效；args 是原样 JSON 数据（包括 null），不继承旧 args。title/description 在脚本 meta，不是工具字段。
- 首次脚本用 script 内联传入，不先写文件；工具返回持久化路径。迭代编辑该文件后传 scriptPath。脚本为 JavaScript，开头 export const meta 纯字面量，至少 name/description，无变量／调用／spread／插值。具体 API、选项、限额、重放和示例以已读 reference 为准，不把未列选项猜作有效。
- 最小调用示例（已有授权时）：

```json
{"script":"export const meta = { name: 'inspect', description: 'Inspect one bounded item' }; return await agent('Inspect login validation; do not edit files; report concrete defects.');","scriptPath":null,"name":null,"args":null,"resumeFromRunId":null}
```

**完整 schema descriptions**

| 字段／类型（均必填） | description |
| --- | --- |
| script: string 或 null，maxLength 524288 | 内联 workflow 源码；其他来源或重放原脚本时 null。必须以 `export const meta = { name, description }` 开始。 |
| scriptPath: string 或 null | workflow 文件路径；未用时 null。与非 null script/name 互斥。 |
| name: string 或 null | saved workflow 名称；未用时 null。与非 null script/scriptPath 互斥。在项目 .pi/workflows、.agents/workflows 和用户 workflow 目录查找。 |
| args: 任意 JSON（包括 null） | 必填 JSON 数据，原样传入全局 args。null 是数据，不是未指定控制值。 |
| resumeFromRunId: string 或 null，pattern ^wf_[a-z0-9-]{6,}$ | null 新执行，或本会话此前 workflow run id。未变的开头 agent() 调用立即返回记录结果；首个变更／失败调用及之后实际运行。相同 script/args 不重新运行调用。 |

### 4. subagent_message（顶层／nested）

**顶层 description**：向当前运行 Agent 发送补充指导；交付不确认处理。

**顶层 promptSnippet**：向运行 Agent 发送补充指导。

**nested description**：向归当前父 Agent 所有的运行中 nested Agent 发送指导。

**nested promptSnippet**：向运行中的 owned child 发送补充指导。

**完整 promptGuidelines（共用）**

- 在允许的 ownership 范围内向当前运行 Agent 发补充指导，不新建执行，不恢复已结束 Agent。
- agent_id/message 非空字符串，不能 null；复制 launch/list 的真实 agent_id，名称、类型别名、execution_id 不接受。
- Queued 是等待 session 初始化；Sent 是提交 session，均不确认已读、处理或回答。
- 已结束 Agent 用 subagent_run resume；执行进度／结果用 agent_manage execution_id。
- 示例：

```json
{"agent_id":"<agent_id>","message":"Also check expired verification codes; keep the scope unchanged."}
```

**完整 schema descriptions**

| 字段／类型（均必填） | 顶层 description | nested description |
| --- | --- | --- |
| agent_id: string | launch/list 的真实 agent_id；标识本会话拥有且当前运行的 Agent。不接受名称或 execution_id。 | 无 description。 |
| message: string，minLength 1 | 非空白 steering 消息，会作为用户消息出现在 Agent 对话。 | 给运行 nested Agent 的非空白指导。 |

### 5. agent_manage

**description**：管理 subagent 和 Agent workflow 执行，不控制对话。

**promptSnippet**：检查、读取、等待或停止委派执行。

**完整 promptGuidelines**

- 管理 subagent_run/subagent_workflow 执行，不处理进程日志或 Agent 对话控制。bash/monitor 用 process_manage，消息用 subagent_message，Agent resume 用 subagent_run，workflow replay 用 subagent_workflow。
- 提供 action/execution_id/kind/verbose 全字段，unused null，action 非 null；未知字段即使 null 也拒绝。
- 各动作非 null 字段：list 可 kind 过滤，execution_id/verbose 必须 null；status/stop 必需 execution_id，kind/verbose null；output/wait 必需 execution_id，可 verbose，kind null。
- kind 仅过滤 list。复制 launch/list 的 execution_id，不构造、不替换为 agent_id；agent_id 是消息／恢复的会话身份，execution_id 是一次执行。动作外字段不可非 null。
- Agent resume 产生新 execution_id，旧句柄的新请求 stale，绝不操作新执行；已接受 wait 保持原执行。workflow replay 是另一次执行，新 ID。
- output 当前输出／进度或最终结果；wait 等整个执行。verbose 仅 subagent output/wait 请求额外对话，不是无限 trace；workflow verbose 必须 null。
- /bg 或取消只解除等待，不停止执行；stop 请求取消，仍可能收尾。停 workflow 同时停 owned agents，不停独立同级；可见 owned child 不一定能由别的 owner 直接管理。
- 成功终态 output/wait 交付消费该执行结果并免重复通知；list/status 不消费。完成自动通知，不仅为检测完成轮询。
- 示例：

```json
{"action":"list","execution_id":null,"kind":"workflow","verbose":null}
```

```json
{"action":"output","execution_id":"<execution_id>","kind":null,"verbose":null}
```

```json
{"action":"wait","execution_id":"<execution_id>","kind":null,"verbose":null}
```

```json
{"action":"stop","execution_id":"<execution_id>","kind":null,"verbose":null}
```

**完整 schema descriptions**

| 字段／类型（均必填） | description |
| --- | --- |
| action: list/status/output/wait/stop | 无 description。 |
| execution_id: string 或 null | launch/list 的执行句柄；targeted 动作非 null，list 为 null。 |
| kind: subagent/workflow 或 null | list 过滤；不过滤／其他动作 null。 |
| verbose: boolean 或 null | subagent output/wait 请求附加对话，null 与 false 同效。workflow／其他动作必须 null。 |

### 6. process_manage：完整保留在工具中

**description**：管理 bash 和 monitor 任务及其日志。

**promptSnippet**：管理命令与观察任务。

**完整 promptGuidelines**

- bash 运行有限命令，monitor 观察持续事件流。process_manage 检查、读取、等待、停止或搜索这些任务；Agent/workflow 执行用 agent_manage。
- 提供所有暴露字段 action/task_id/task_type/offset/limit/pattern/ignore_case/context。unused 控制 null，action 非 null，未知字段即使 null 也无效。
- 各 action 非 null 字段：list/stats 可 task_type 过滤；status/stop 必需 task_id；output 必需 task_id，可 offset/limit；wait 必需 task_id，可 limit；search 必需 pattern，可 task_id/task_type/ignore_case/context。
- 复制 launch/list 的 task_id。task_type 只过滤 bash/monitor。所选动作表之外字段必须 null。
- output 默认有界尾页，offset=0 从头；offset/limit 按字节，wait 的 limit 限制最终日志页。用返回 ranges 继续读。search 为 regex，可忽略大小写和提供上下文行数。
- wait 等整个任务；monitor 必须观察结束，不是等一个事件。/bg 或取消只解除等待，stop 请求取消执行，之后仍可能收尾。
- 成功终态 output/wait 交付报告结果并免重复完成通知。list/status/search 不消费结果。完成自动通知，不仅为检测完成而轮询。
- 示例：

```json
{"action":"output","task_id":"<task_id>","task_type":null,"offset":0,"limit":null,"pattern":null,"ignore_case":null,"context":null}
```

```json
{"action":"wait","task_id":"<task_id>","task_type":null,"offset":null,"limit":null,"pattern":null,"ignore_case":null,"context":null}
```

```json
{"action":"search","task_id":null,"task_type":"bash","offset":null,"limit":null,"pattern":"ERROR","ignore_case":false,"context":0}
```

```json
{"action":"stop","task_id":"<monitor_task_id>","task_type":null,"offset":null,"limit":null,"pattern":null,"ignore_case":null,"context":null}
```

**完整 schema descriptions**

| 字段／类型（均必填） | description |
| --- | --- |
| action: list/status/output/wait/stop/search/stats | 无 description。 |
| task_id: string 或 null | bash/monitor launch/list 的任务身份；targeted 非 null，unused null。 |
| task_type: bash/monitor 或 null | list/stats/search 过滤；不过滤／其他动作 null。 |
| offset: 非负整数或 null | output 日志字节偏移；null 尾页、0 开头；其他动作 null。 |
| limit: 正整数或 null | output/wait 日志字节预算；null 使用配置预算；其他动作 null。 |
| pattern: string 或 null | 非空搜索 regex；其他动作 null。 |
| ignore_case: boolean 或 null | search 忽略大小写；null 默认 false／其他动作 null。 |
| context: 非负整数或 null | search 上下文行数；null 默认 0／其他动作 null。 |

## 二、插件 Skill 文件结构

```text
extensions/agent-tasks/skills/subagents/
├── SKILL.md
└── references/
    ├── delegation.md
    ├── workflow-api.md
    └── patterns.md
```

### SKILL.md：完整入口

```yaml
---
name: subagents
description: "规划和协调 subagent 委派，以及用户已明确授权的 workflow 编排。委派较大独立工作、协调运行或恢复 Agent 时使用；编写或修改已获授权的 workflow 脚本前使用。读取本 Skill 不授权 workflow 执行。"
---
```

# Subagents

当前工具/schema 是可用类型、字段和安全调用的依据。本 Skill 不增加工具能力，不授予 workflow、修改文件、提交、安装或 worktree 权限。自动读取本入口不能代替用户明确选择多 Agent 编排。

按当前需要读取，不默认展开所有 references：

- 普通委派／协调 Agent：读取 [delegation](references/delegation.md)。
- 编写／修改 workflow：先确认用户授权，再完整读取 [workflow API](references/workflow-api.md)。
- 已授权的复杂编排设计：在 API 后读取 [patterns](references/patterns.md)。

相对 references 从本 SKILL.md 所在目录解析为绝对路径，用当前允许的 reader 读取；缺失、禁用或不可读时说明限制，不绕过策略、不假装已经加载。工具契约的底线始终适用。

### references/delegation.md：完整拟内容

# 委派与协调

## 任务与证据

较大的独立工作、广泛探索适合专门 Agent；已定位目标的小修改用直接工具更高效。不要在当前会话重复子 Agent 已在调查的部分。选择当前 subagent_run 工具/schema 暴露的允许类型；本文件不固定安装时类型列表。把目标、相关文件／背景、范围、明确只读或允许修改、禁止事项、预期输出写在自包含 prompt 中。需要跨会话背景时仍提供相关文本，不假定冷启动 Agent 了解当前讨论。

返回应简洁、包含证据和未解决限制。执行结束与任务接受不同；主会话核查实际 diff、命令及结果后才报告成功，委派总结本身不是证明。并行编辑须划分不重叠所有权；临时 worktree 不能代替项目批准的工作目录协议。

## 模式与配置

工具每字段必填，按当前模式把 unused 控制填 null，不给未暴露字段补 null。顶层 New 的 name 与 schedule 不能照搬到 nested；nested 不暴露 name/schedule。完整合法模式表和示例以当次工具为准。

subagent_run 的 Agent 文件优先于适用请求；null model 使用 Agent 配置再父会话模型，null thinking 使用 Agent 配置再子会话设置／默认值，不直接复制父会话当前 thinking。null isolated/inherit_context 使用配置，否则 false；inherit_context 是加入父对话文本，不是 SDK fork。顶层 null 执行模式使用配置；nested null 新建默认前台，除非 Agent 配置指定。

下一步依赖 Agent 结果时选前台，否则后台期间做独立工作。请求前台也可能被 Agent 文件覆盖，必须检查结果给出的实际模式。隔离分两种：isolated 禁用 extension/MCP tools；isolation:worktree 是 Git 副本，看不到主检出未提交／已暂存修改，必须遵守项目授权。只有用户明确要求延迟／周期才使用 schedule；这是调度定义，不是已运行的 Agent，不与 resume、inherit_context 或 run_in_background:false 合用。

## 协调运行、恢复与结果

launch 返回的 agent_id 标识会话，用于 subagent_message 与 subagent_run resume；execution_id 标识此次执行，用于 agent_manage。不得用名称、类型别名、execution_id 发消息或恢复，也不得构造 execution_id。后台启动表示接受／排队，不表示完成，保存真实 ID。

运行中补充范围用 subagent_message；Queued/Sent 不确认已读或执行。已结束且可恢复时 resume，保留类型、名称和 session 设置；顶层此次 mode 重新解析，nested resume 始终前台，其他控制包括 run_in_background 全 null。恢复产生新 execution_id，旧句柄的新请求 stale；已接受旧 wait 仍属于原执行。workflow replay 则是新的独立执行。

用 agent_manage output 读取当前进度／结果，wait 等完整执行，verbose 在 subagent output/wait 请求附加对话（null 与 false 同效），不是无限 trace。workflow verbose 必须 null。/bg／取消只释放等待，stop 才请求取消执行，收尾可能继续。终态 output/wait 的成功交付避免重复通知；list/status 不消费，别轮询只为检测完成。后台顶层完成自动通知，通知不是实际 diff／测试验证。

## 嵌套边界

只能使用父允许类型，在深度上限内委派；不存在可用 nested 工具就直接完成，不递归绕过禁用。nested background 必须有当前可用的 owned agent_manage；父 Agent 结束会停 owned children，务必在结束前收取结果，不依赖顶层自动通知。管理可见性不是权限，其他 owner 可见的 owned child 不一定可直接管理。停止 workflow 会停止其 owned agents，不影响独立同级。

### references/workflow-api.md：完整拟内容

# Workflow API

## 授权与调用来源

只在用户明确 opt-in 时执行 workflow：用户原话要求 workflow／多 Agent 编排、用户主动调用明确要求该工具的 skill/slash command，或指定 named/saved workflow。加载 Subagents Skill 不授权执行；任务可能受益也不算。未授权时单独委派或说明用途和大致成本后询问，用户以后可说 "use a workflow"。

提供顶层工具的 script/scriptPath/name/args/resumeFromRunId 全字段。新执行恰好一个非 null source，其他 source/resumeFromRunId 为 null；重放本会话已结束 run，至多一个 source，全部 null 复用原脚本。空字符串无效。args 是原样 JSON 数据，包括 null；不是控制默认，不自动继承旧 args。title/description 放 meta，不放工具参数。

首次 script 内联传，不先 Write；每次调用自动保存会话目录文件并返回路径。迭代时编辑该文件，用 `{script: null, scriptPath: "<path>", name: null, args: null, resumeFromRunId: null}` 再调用，不重发全部源码。重复使用的脚本放 `.pi/workflows/<name>.js`、`.agents/workflows/`，或随用户的 `<agent dir>/workflows/`；用 name 调用，其他 source/resumeFromRunId null，显式 args。文件写入仍需原任务授权。

后台立即返回 execution_id，自动通知；用 agent_manage 管理、/agents → Workflows 查看实时进度，不 sleep／轮询仅为检测完成。脚本确定性控制流表达 fan-out、验证、综合。

## 来源与 meta

每脚本开头 `export const meta = {...}`。meta 必须纯字面量，无变量、函数、spread、模板插值。必需 name/description，可 whenToUse（workflow 列表）、phases。meta.phases 标题与 phase() 完全匹配；无对应 entry 的 phase() 自成进度组。阶段特定 model 覆盖在 phase entry 添加 model。

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

示例 schema／helper 占位必须替换为真实定义，不能将省略号当可运行代码。

## 完整 hooks

### agent

```text
agent(prompt: string, opts?: {label?: string, phase?: string, schema?: object, model?: string, effort?: string, isolation?: 'worktree', agentType?: string, gate?: string, resume?: string}): Promise<any>
```

- 无 schema 返回最终文本 string；schema 是 JSON Schema，子 Agent 获得据此构建的 StructuredOutput tool，返回已经校验的对象，无需 JSON.parse。不匹配 payload 退回修正；始终不用工具回答时再提示一次，之后失败返回 null。每个 schema stage 后过滤 null。
- 用户中途 skip、Agent 重试后 terminal API error 也 null，使用 `.filter(Boolean)`；不把 null 当成功证据。
- label 覆盖显示标签。phase 显式进度组，pipeline/parallel stage 用它避免全局 phase() 竞争，相同 string 同组。
- model 显式覆盖本次 Agent 定义模型；省略先定义模型，再父 session 模型。不确定就省略，仅确信不同档位适合才指定。
- effort 显式覆盖本次 Agent 定义 thinking，允许 off/minimal/low/medium/high/xhigh/max；省略先定义等级，再子 session settings/defaults，不是父当前 thinking。机械步骤 low，难 verify/judge 才较高等级。
- isolation:'worktree' 创建新 Git worktree，成本高（准备／磁盘每 Agent 一份）；仅在并行修改否则冲突时用，遵守项目协议。Agent settle 后删除副本，修改保留分支。
- gate:'<command>' 在 Agent 完成后运行 shell 并要求通过，非零 exit Agent 失败，命令输出为 error。能跑的断言用 gate:'npm test'，不靠另一个模型说代码看起来对。
- resume:'<label>' 继续该 label 的 finished child，保留上下文；不能与 agentType/model/effort/isolation/gate/schema 组合。
- agentType 使用自定义类型替代 workflow 默认子 Agent，从当前 subagent_run 同注册表解析，可与 schema 组合；当前可用类型读当次工具/schema，不固定列表。
- 未列选项按名称拒绝。JS optional 可以省略，不需要顶层 JSON 全字段/null 契约。

### pipeline

`pipeline(items, stage1, stage2, ...): Promise<any[]>`：每 item 独立走完整链路，阶段无 barrier。A 可在 stage 3，B 还 stage 1。多阶段默认此方式，总时间是最慢单 item 链路，不是各 stage 最慢之和。每 stage 回调 `(prevResult, originalItem, index)`，后续 label 用 originalItem/index，不必在 stage1 result 搬运。stage 抛错该 item null，跳过余下 stage。

### parallel

`parallel(thunks: Array<() => Promise<any>>): Promise<any[]>`：并发并等待所有 thunk，是 barrier。thunk/Agent 真失败变 null，使用前 filter(Boolean)。致命运行错误（cap breach、nested workflow 无法加载、library validation 如未知 agent() option/out-of-range effort）继续抛出，不藏进 null。参数按文档 shape 校验，typo 会指出字段并使 run 失败。只在确实需要全结果一起到齐时用。

### log 与 phase

- `log(message: string): void`：用户看到进度树上方 narrator 行。
- `phase(title: string): void`：开始阶段，之后 agent() 归该标题 progress group。

### args

`args: any` 是工具输入原值，包含 null；内部 workflow() 可传 undefined，不自动继承上一 args。数组／对象传真正 JSON，不是编码字符串：`args: ["a.ts", "b.ts"]`，不是 `args: "[\"a.ts\", ...]"`，后者作为一个 string 导致 args.filter/map 抛错。用于 named workflow 参数，直接传研究问题、path/config，不用 side-channel 文件。

### budget

`budget: {total: number|null, spent(): number, remaining(): number}`。这里 total 始终 null（Pi 无 token-target directive），所以 `while (budget.total && budget.remaining() > 50_000) { ... }` 正确不进入，不是 missing global 错误。spent() 为本 run 子 Agent output tokens；无 target 时 remaining() 为 Infinity。

### workflow

`workflow(nameOrRef: string | {scriptPath: string}, args?: any): Promise<any>`：内联子步骤运行另一个 workflow，返回其结果。name 用与顶层 name 同 registry；{scriptPath} 可指此前写的文件。child 与 run 共用 concurrency cap、agent count、abort signal、token budget，/agents → Workflows 归 `▸ name`，token 计 spent()。args 成 child global。只一层，child 内再 workflow() 抛错；unknown name/unreadable path/child syntax error 抛错，可 catch 处理。文件读取／编排仍服从授权。

## 运行边界

子 Agent 被告知 final text 就是返回值，而不是人类消息，返回 raw data；structured 用 schema，让 tool-call validation 支持不匹配重试。

脚本纯 JavaScript，不是 TypeScript；`: string[]`、interface、generics 无法 parse。async context 可直接 await。JSON/Math/Array 等标准内置可用，但 Date.now()/Math.random()/无参 new Date() 抛错（破坏 replay）；timestamp 用 args，返回后 stamp，变化按 index 调整 prompt/label。eval/Function(...) 抛错，没有 filesystem/Node API。

每 workflow concurrent agent() cap 为 `max(1, min(16, available CPUs - 2))`，额外排队、空槽继续。可传 100 items 全处理，只是同时约 10 个（实际取决 CPUs）。整个 run Agent count 1000；单 parallel/pipeline items 4096，超出明确错误，不 silent truncate。

## 重放

工具结果包含 execution_id。pause、kill 或修改脚本后，已结束本会话 run 用 scriptPath/resumeFromRunId relaunch，script/name null，args 显式。最长 unchanged agent() 调用 prefix 瞬间返回缓存；首个 edited/new call 后全部 live。同 script + args → 100% cache hit。它是 prefix 不是 lookup，早先变化后稍后仍匹配也不复用。journaled failure 截断 prefix，Agent 5 失败则从 Agent 5 重试。必须同会话且 run finished，先 /agents → Workflows stop。新 replay 有新 execution_id。

诊断已完成 run 空／意外 result 前读脚本旁 `<run id>.workflow.jsonl`，其中有每 Agent 实际 return，不假设 cached result 非空。Date.now()/Math.random()/new Date() 不可用，时间从 args 或返回后 stamp。这里保留现有重放契约，不以缓存复用替代对结果的验证。

### references/patterns.md：完整拟内容

# 编排模式

## 选择与规模

只有明确获授权 workflow 才应用本教程，读取不是 opt-in。workflow 组织多个视角以覆盖完整性、独立验证和单上下文装不下的迁移／审计／扫描；脚本表达 fan-out、verify、synthesize。常见 hybrid：先当前会话侦察文件／通道／diff，发现 work-list 后编排。开始任务前不必知道结构，开始 orchestration 前要有结构。

可以跨轮串联：Understand 并行读子系统→structured map；Design N 独立方案→judge/scored synthesis；Review dimensions→find→adversarial verify；Research 多方式 sweep→deep-read→synthesize；Migrate discover sites→逐处 transform（有批准的 worktree isolation）→verify。大任务拆几个 workflow 顺序跑，读每次结果再决定下一阶段，保持主会话参与，每次 fan-out 范围明确。

规模匹配请求："find any bugs" 少量 finders/single-vote verify；"thoroughly audit this"/"be comprehensive" 更大池、3–5 vote 对抗与综合。研究／审查／审计不确定时偏完整，quick check 偏简短。用途合适仍不是授权。多步骤控制流适合确定性 loops/conditionals/fan-out 时才用，不靠模型临场随机控制。

## pipeline 与屏障

多阶段默认 pipeline；仅 stage N 真需要 stage N-1 所有 item 的跨 item 上下文才 barrier：全集 dedup/merge 后昂贵验证；总数零 early-exit；后续 prompt 比较“其他发现”。

flatten/map/filter 本身不是理由，可 `pipeline(items, stageA, r => transform([r]).flat(), stageB)`；概念不同 stage 不等同步；“代码整洁”不能抵消 barrier latency。5 finders 最慢是最快 3× 时，快者浪费 2/3 等待。

```js
const a = await parallel(...)
const b = transform(a)        // flatten, map, filter — no cross-item dependency
const c = await parallel(b.map(...))
```

这个 middle transform 不需 barrier，改 pipeline stage。不确定用 pipeline。下面示例保留教学占位（schema/helpers/ellipsis），运行前须真实定义并检查 API。

## 完整示例

### 每维度审查后立即验证

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

### 全集去重确实需要 barrier

```js
const all = await parallel(DIMENSIONS.map(d => () => agent(d.prompt, {schema: FINDINGS_SCHEMA})))
const deduped = dedupeByFileAndLine(all.filter(Boolean).flatMap(r => r.findings))  // <-- genuinely needs ALL at once
const verified = await parallel(deduped.map(f => () => agent(verifyPrompt(f), {schema: VERDICT_SCHEMA})))
```

### 累积到目标数量

```js
const bugs = []
while (bugs.length < 10) {
  const result = await agent("Find bugs in this codebase.", {schema: BUGS_SCHEMA})
  bugs.push(...result.bugs)
  log(`${bugs.length}/10 found`)
}
```

schema stage 可能 null；在实际脚本每 stage 后检查／过滤，不将示例成功路径当失败策略。

### gate 与保留上下文的重试

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

### seen 去重、多视角判断、连续 dry 收敛

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

## 质量与完整性

- 对抗验证：每 finding N 独立 skeptics，要求 REFUTE，多数 refute 则丢弃，防止 plausible-but-wrong。

```js
const votes = await parallel(Array.from({length: 3}, () => () =>
  agent(`Try to refute: ${claim}. Default to refuted=true if uncertain.`, {schema: VERDICT})))
const survives = votes.filter(Boolean).filter(v => !v.refuted).length >= 2
```

- 用运行而不是询问验证：可测试 claim 用 gate，不问另一模型是否成立。
- 多视角 verify：correctness/security/perf/does-it-reproduce 分开，别 N 个相同 refuters；diversity 能补 redundancy 漏洞。
- judge panel：MVP-first/risk-first/user-first 等 N 独立 attempts，并行 judges 评分，从 winner 综合，吸收 runners-up 优点；宽解空间优于单尝试反复迭代。
- loop-until-dry：未知数量发现持续至连续 K 轮无新结果；简单 while count < N 漏尾部。
- multi-modal sweep：by-container/by-content/by-entity/by-time 各自独立搜索，不预先知道别人的发现，单角度不足时使用。
- completeness critic：末轮检查“哪些 modality 没跑、claim 未验证、source 未读”，变为下轮 work-list。
- no silent caps：top-N/no-retry/sampling 用 log() 说明 dropped coverage，不把抽样写成全面。

这些不是穷尽模式，授权范围内可组合 tournament/self-repair/staged escalation 等。每阶段过滤失败／null、检查实际证据；不把另一个 LLM 的认可当测试通过。
