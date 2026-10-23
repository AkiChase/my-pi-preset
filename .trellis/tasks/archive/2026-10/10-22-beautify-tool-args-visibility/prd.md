# 补齐 beautify 工具参数可见性

## 目标

让 `bash` / `read` / `find` / `grep` 四个内置工具的卡片在**参数流式生成期间**和**工具执行期间**就能看到关键参数，并在 `Ctrl+O` 展开时输出完整参数表。保持现有 beautify 极简卡片风格与 tool 名称优先的身份字段，不新增自定义展开控件，不改变工具执行、schema 与结果正文。

## 背景与已确认事实

以下事实均由源码核对与无头 harness 实测确认（仓库外临时目录，已清理）。

### pi 原生能力（无需新增机制）

- `pi-ai/dist/utils/json-parse.js:115-137` 的 `parseStreamingJson()` 把不完整 JSON 增量解析为「已到达的键」组成的对象；`api/anthropic-messages.js:588`、`api/openai-completions.js:456`、`api/openai-responses-shared.js:616,625`、`api/bedrock-converse-stream.js:476`、`api/mistral-conversations.js:573`、`api/pi-messages.js:160` 在每次 delta 都执行 `block.arguments = parseStreamingJson(partialJson)`。因此流式期间 `ctx.args` 就是部分对象，逐键增长。
- `dist/modes/interactive/components/tool-execution.js` 中 `isPartial` 初值 `true`；`message_update` 时 `updateArgs()` → `updateDisplay()` → 重新调用 `renderCall`；`tool_execution_start` 时 `markExecutionStarted()`。`setExpanded()`（:139-142）只改 `expanded` 并 `updateDisplay()`，执行中同样生效。
- `modes/interactive/interactive-mode.js:3698-3714` 的 `setToolsExpanded()` 遍历 `chatContainer.children` 调 `setExpanded()`；运行中的 tool 卡片是 `chatContainer` 直接子节点（:2816、:2887 添加），故 `Ctrl+O` 在执行期间可达。
- 实测（`ToolExecutionComponent` + `markExecutionStarted()` 后 `setExpanded(true)`）：无 renderer 的 fallback（`formatToolCallWithArgs`）与带 toolDefinition 两条路径在执行中都正确响应展开。**pi 本身不限制执行中展开。**
- 唯一的 stock 限制：`tool-execution.js:113-119` 的 `createResultRegion` 点击处理器有 `if (!this.result …) return`，故**鼠标点击**运行中卡片无反应；键盘 `Ctrl+O` 不受影响。

### beautify 现状与两个缺口

`extensions/beautify/index.ts:22-33` 用 `pi.registerToolRenderer` 接管渲染，形成三族：

| 工具族 | 工厂 | 执行中展开可见参数 |
| --- | --- | --- |
| `bash` `read` `find` `grep` | `tools/shared.ts` 的 `renderers()` | **否** |
| MCP / `subagent_run` / 其他扩展工具 | `tool-card.ts` `createToolCardRenderers` | 是 |
| `process_manage` `agent_manage` `monitor` | `tools/optional.ts` | 是 |
| `edit` `write` | 未接管，用 pi 内置 | 是 |

- `tools/shared.ts:29-40` 的 `renderCall` 只返回 `toolHeading(name, label, suffix, meta.stats, width, theme, ctx.expanded, meta.secondary)`，**从不输出参数体**；`renderResult`（:41-47）仅在 `ctx.expanded` 且有 result 时输出 body。
- 实测：`renderCall` 在「执行中」的折叠态与展开态输出同一行标题（仅折行变化），参数全集不出现。
- `layout.ts:19-22` 的 `title()` 只挑一个主字段：`bash` 取 `description`（非空时）否则 `command`；`read` 取 `args.path`；默认取 `pattern` + `path`。
- `tools/bash.ts:7-11` 的 draw 仅在 result body 展开态输出 `Command: …`，故 `bash` 带 `description` 时执行中看不到 `command`。
- 参数名与 pi 1.4 schema 一致，无错配：read 用 `path`（`core/tools/read.js:10-14`）、grep/find 用 `pattern`+`path`（`grep.js:11-19`、`find.js:17-23`）。首轮实测曾误用 `file_path`，已修正重测。

### 流式副标题的布局安全性（已实测，4576 例）

- `layout.ts:38-54` 的 `summary()` 恒返回 1 行且不超宽：`fields.pop()` 从尾部丢字段 → 丢光只留 `stats` → `stats` 也 `clipPlain` 截断；`middlePath` 再按剩余空间截断 label。`toolHeading`（:56-76）把 `identity + 2 + rest` 约束在 `room = width - visibleWidth(identity) - 2` 内。
- 4576 例（宽度 10–400 × 各工具名 × detail/stats/secondary 组合）实测：**宽度溢出 0 次**；多行 1034 例**全部**来自 `taskTool` 集合（`bash`/`subagent_run`/`subagent_workflow`/`agent_manage`/`process_manage`/`monitor`）的主动 2 行分支（`layout.ts:63-70`，注释说明 "Task state/measurements must not silently disappear behind long labels"），且第二行也换行受控；非 taskTool 多行 0 例。
- 流式阶段 `stats` 为空（`renderCall` 中 `describe(undefined, ctx)` → `genericMetadata(undefined)` → `{stats:""}`，且 `executionStarted` 为 false 时计时器未启动），副标题实际拿到最宽松空间。
- `hint`（`expand`）排在 `fields` 之后且 pop 循环只丢 `fields`，故「可展开」可见性不会先于参数丢失。
- hostile 输入（半截 OSC 无终结符、`\n`、emoji/宽字符、`\x00\x01\x07`、`\t`）不注入换行：`clean()` 剥 OSC/CSI/C0，且 `detail`/`stats`/`secondary` 均经 `.replace(/\n/g, "\\n")`。

## 要求

### R1：副标题纳入非主字段（缺口 A）

`renderers()` 的 `renderCall` 在折叠态把**未在主字段出现的参数**并入 `toolHeading` 的 `secondary`，使用现有 ` · ` 分隔契约，由 `summary()` 既有的丢字段/截断逻辑承担窄终端降级。

- `bash`：主字段为 `description`（非空）或 `command`；另一个进入 secondary。`timeout`、`run_in_background`、`background_after_seconds` 等执行控制参数按现有 `title()` 的模式纳入 secondary（`title()` 目前已把 background/timeout 拼在主字段尾部，需保持不重复）。
- `read`：主字段 `path`；`offset`/`limit` 纳入 secondary（保留现有 `:offset` suffix 契约，不重复表达同一信息）。
- `grep`：主字段 `pattern` + `path`；`glob`、`ignoreCase`、`literal`、`context`、`limit` 纳入 secondary。
- `find`：主字段 `pattern` + `path`；`limit` 纳入 secondary。
- 仅纳入**已到达**的键：流式期间 `ctx.args` 是部分对象，未到达的参数不得占位或显示 undefined。
- 不得为默认值重复占位；值与默认相同的参数是否显示由实现决定，但不得虚构未提供的参数。
- 不引入字段排序或数量上限等抖动缓解（用户已明确不需要）；`secondary` 字段顺序由实现按信息价值自定。

### R2：展开态输出完整参数表（缺口 B）

`renderers()` 的 `renderCall` 在 `ctx.expanded` 时，在标题之下输出完整参数表（`key: value` 逐行，多行值缩进），覆盖流式中、执行中、完成后三种状态。

- 复用 `tool-card.ts:54-72` 的 `argumentsText` 既有格式与 `card-primitives.ts` 的 `textPreview` 预览契约，不新造第二套参数格式化实现。
- 展开参数表与 result body 不互相排斥：无 result 时只显示参数表；有 result 时参数表与正文按现有顺序呈现。
- 折叠态不显示参数表（保持极简），仅按 R1 显示 secondary。
- `Ctrl+O` 在执行中与流式中均可见完整参数（`ctx.expanded` 由宿主 `setExpanded` 提供，renderer 只读取）。

### R3：所有权与兼容性

- 只改 `extensions/beautify/` 呈现层；不改工具 schema、执行、结果正文、`pi.registerToolRenderer` 的接管范围与优先级。
- `edit` / `write` / MCP / `subagent_run` / `process_manage` / `agent_manage` / `monitor` 等其它族的显示行为不变。
- 不改变 `toolHeading` / `summary` / `textPreview` 的公开签名与既有调用方语义；若需扩展仅在既有参数内使用（如已存在的 `secondary`）。
- 渲染层无文件 I/O、不访问后端、不消费结果、不触发执行副作用。
- 不引入对 pi 私有 API 的新依赖；继续使用公开 `ToolRenderers` / `RenderContext` 契约。

## 验收标准

- AC1（R1）：对 `bash`/`read`/`find`/`grep`，在**参数流式生成期间**（`isPartial=true`、`executionStarted=false`、`argsComplete=false`、无 result）渲染卡片，已到达的非主参数出现在 secondary 中；未到达的参数不出现。
- AC2（R1）：对上述四工具，在**执行期间**（`executionStarted=true`、无 result）渲染卡片，非主参数同样出现在 secondary 中；`bash` 带 `description` 时 `command` 可见。
- AC3（R2）：在流式中、执行中、完成后三种状态下 `setExpanded(true)`，均输出完整 `key: value` 参数表，且包含全部已到达参数。
- AC4（R2）：折叠态不输出完整参数表；`Ctrl+O` 提示仍可见。
- AC5（R3）：宽度不溢出——在宽度 `[1,2,8,20,40,80,120]` 与折叠/展开两种状态下，所有渲染行满足 `visibleWidth(line) <= Math.max(width, 5)`（沿用 `tools.test.ts` 既有断言口径）。
- AC6（R3）：非 taskTool 四工具折叠态恒 1 行；`bash` 的 taskTool 2 行分支行为不回退（stats 放不下时仍换行受控）。
- AC7（R3）： hostile/部分转义内容（半截 OSC、`\n`、emoji/宽字符、C0 控制符）不导致换行注入或溢宽。
- AC8（R3）：`edit`/`write`/`subagent_run`/`process_manage`/`agent_manage`/`monitor`/MCP 的现有渲染断言不回归。
- AC9：`pnpm typecheck` 通过；beautify 聚焦测试通过；主会话核对实际 diff。真实终端视觉/provider 验证不做，明确 NOT_RUN。

## 不在范围内

- 鼠标点击展开运行中卡片（stock `createResultRegion` 需 `result` 才响应）——属 pi 宿主行为，本任务不改 pi，也不为 beautify 绕过该契约。
- 副标题字段抖动缓解（字段排序、数量上限、稳态保持）。
- `tool-card.ts` / `optional.ts` 两族的行为调整；`edit`/`write` 的 pi 内置渲染器。
- 工具 schema、执行语义、结果正文、`promptGuidelines` 的任何变更。
- 用户文档参数教学、个人 reload/安装/push/归档。
- 重做 `title()` 的主字段挑选策略（除 R1 要求的去重外）。

## 设计与执行准备

见 `design.md` 与 `implement.md`：两阶段为（S1）副标题纳入非主字段、（S2）展开态完整参数表；每阶段独立 trellis-check 审查后提交。跨模块渲染契约（`toolHeading`/`summary`/`textPreview` 签名与既有调用方）不得仅靠自查。

原始执行输出使用仓库外自有临时目录，不写 `research/`。使用现有 Node/TypeScript/SDK，`COREPACK_ENABLE_NETWORK=0`；不安装或下载工具依赖，不改个人 HOME/安装/reload。准确测试命令与隔离方式见 `implement.md`。

## 关联与授权

用户已确认范围：**两个缺口一起修**，不做抖动缓解；展示形态为「仅展开态显示完整参数」+「副标题纳入非主字段」。用户在流式副标题提案后主动提出单行失效风险，经 4576 例无头实测确认非 taskTool 恒 1 行且 0 溢宽，并明确「不用缓解，问题不大」。

授权边界：任务规划审批后按 `implement.md` 两阶段实施、验证与本地阶段提交；不授权安装/下载、个人 reload、push、归档。实施与审查分别选择执行者，主会话核对实际 diff 与证据并维护材料。

## 验收修正：统一工具专属呈现（优先于上文原始参数表要求）

用户 tmux 验收未接受 S2 原始 `key: value` 参数表，以及展开后 secondary 消失。用户明确要求生成中、执行中、完成后共享呈现逻辑，随后明确“行，你继续吧”授权在原托管 worktree 修正、检查与本地提交；仍不合并，等待再次验收。

本节替代 R2/AC3 的“完整原始参数表”形态及此前相关限制：
- 三阶段复用同一份工具专属调用展示描述与公共组合入口，不分别维护三套渲染。只根据当前 args 更新调用信息，状态/耗时与 result 作为增量内容。
- 标题在折叠和展开时都保留已到达的主信息、关键参数；展开不能丢掉 secondary。窄宽度保持安全降级，不做抖动缓解。
- 不铺原始字段名清单（如 description:/command:/background_after_seconds:）；使用既有工具专属风格。bash 的 Command: 属于调用详情，移到共享调用呈现，使生成中/执行中/完成后都能显示，结果阶段不重复。
- read 使用路径/行范围，grep/find 使用 pattern/path 与搜索选项等语义化信息；展开恢复标题容纳不下的调用细节。显式 false/zero 不虚构为启用，未到达键不占位。
- 结果正文/高亮/背景/计时和其它工具族不改。可以新增本工具族内部调用描述或布局函数，但不全局改其它族公共行为。
- 验证逐键到达、三阶段同一调用信息、展开标题保留关键参数、详情工具风格、无 raw 参数表、无重复 Command:、宽度/控件安全及其它族回归。此前 S1/S2 提交与测试结果保留为历史，不代表新验收通过。

## S4：标题颜色与原完成态一致性修正（用户已批准）

用户认可共享内容方向，但指出颜色与完成态文案不一致，提供原对照：`bash  Review nested delegation change and temporary cleanup  background after -1s  17 output lines · execution 0.0s · ctrl+o expand`，并明确“那你改正一下吧”。本阶段在原 worktree 追加修正、独立检查及本地提交，不合并。

保留 tool/name/description/mode 的 accent，次要参数、stats/timing/hint 使用 muted；expanded 不能通过把 secondary 拼到 label 导致整体染 accent。保持原 stats→execution→hint 文案与顺序，不改计时语义、不为本任务新增结果状态分支或三套呈现。新参数仍按已有预算显示，不应替换/改名既有统计。以原对照为真实注册 renderer 的回归基准，折叠/展开都测试 ANSI 颜色及可见文案，宽度控制与其它族保持。

离线演示 fixture 需补工具生命周期事件，确保 elapsed 与 final execution 展示真实 observer 行为；使用同一句 description、17行 output 和 durationMs=0 创建完成态对照，保留逐字段生成与 Ctrl+O 交互。主题显式使用 dark，终端声明 truecolor；不读取个人配置/认证，不伪称线上 provider 或用户终端完全等价。原始材料仓库外 owned tmp；修正产品与测试使用同一阶段提交，演示脚本不进仓库。当前不自动开启 tmux，等用户再次查看。

## S5：无结果时点击展开与演示鼠标接入（用户已授权）

用户确认主页面可点击，但当前 pi 宿主 createResultRegion 在 result 不存在时拒绝点击；原 demo 外层遗漏 handleMouse 转发。用户明确“行，你对应的处理一下”授权本任务在现有 worktree 修复对应四工具族交互与演示，不修改安装 pi/个人会话、不合并。

实现优先使用 renderer Component.handleMouse、state 与 invalidate 公共契约：无结果期间单卡片本地展开状态，三态共用调用布局；不修改只读 host context，不注入假 result、不访问 private ToolExecutionComponent 成员、不全局切换所有卡片。必须明确本地状态如何响应 host Ctrl+O、partial/final 到达、args 更新、重复点击与宿主已有结果点击，避免状态翻两次或到达结果后跳回。只有正文有效区域左点击切换，背景 padding/右键/链接/选择拖拽按既有宿主行为，样式/width/result/timing不改。若公共 API 无法可靠完成则报告具体限制，不偷偷 patch 安装 SDK 或扩大到第三方卡片。

演示转发 mouse 到真实 tool component，并在坐标换算时扣去实际已渲染前置标题高度，不截断实际卡片点击范围；使用 unique tmux socket 开 mouse 捕获验证时只操作 owned server，物理鼠标端到端与模拟事件证据区分。生成/运行无结果点击、result后点击、Ctrl+O互操作、outside/padding/rightclick、args更新、partial/final切换、四工具注册实际SDK与窄宽终端需回归。保留独立检查+本地阶段提交顺序；不自动启动新演示，修正后告知用户。
