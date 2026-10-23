# 工具参数可见性设计

## 范围与所有权

只改 `extensions/beautify/` 呈现层。`renderers()` 工厂（`tools/shared.ts`）是 `bash`/`read`/`find`/`grep` 四工具的唯一呈现入口，本设计的所有改动都收敛在该工厂与其调用方 `tools/{bash,read,find,grep}.ts` 内，不改 `toolHeading`/`summary`/`textPreview` 的签名与其它调用方语义，不改 `index.ts` 的接管映射，不改工具执行/schema/结果正文。

`edit`/`write` 走 pi 内置渲染器，`tool-card.ts`（generic 族）与 `optional.ts`（process/agent/monitor 族）已有展开参数能力，均不在范围内。

## 数据流与既有契约

宿主 `ToolExecutionComponent` 每次 `updateArgs()` / `setExpanded()` / `markExecutionStarted()` 都会重新调用 `renderCall(this.args, theme, getRenderContext(...))`。`RenderContext` 已提供本设计所需的全部状态，无需扩展：

| 字段 | 流式期间 | 执行期间 | 完成后 |
| --- | --- | --- | --- |
| `args` | 部分对象（已到达的键） | 完整对象 | 完整对象 |
| `argsComplete` | false | true | true |
| `executionStarted` | false | true | true |
| `isPartial` | true | true | false |
| `expanded` | 用户 `Ctrl+O` 状态 | 同左 | 同左 |
| `lastComponent` / `state` | 跨帧复用的组件与 cell | 同左 | 同左 |

因此「流式中显示部分参数」不需要任何新机制：只要 `renderCall` 读 `ctx.args` 中已存在的键即可。未到达的键为 `undefined`，必须与「用户显式传了空值」区分不开时按不存在处理（不显示）。

## S1：副标题纳入非主字段

### 现状

`tools/shared.ts:29-40`：

```ts
renderCall: (_args, theme, context) => {
  const current = cell(theme, context as RenderContext);
  return { invalidate() {}, render(width) {
    const { ctx, result, theme } = current;
    const meta = describe(result, ctx);
    const display = timing?.(ctx);
    if (display) meta.stats = [meta.stats, display].filter(Boolean).join(" · ");
    const label = meta.title ?? title(name, ctx.args);
    const suffix = meta.suffix ?? (name === "read" && typeof ctx.args.offset === "number" ? `:${Math.max(1, ctx.args.offset)}` : "");
    return toolHeading(name, label, suffix, meta.stats, width, theme, ctx.expanded, meta.secondary);
  } };
}
```

`meta.secondary` 已是 `toolHeading` 的既有入参（`layout.ts:56`），`summary()` 已实现 ` · ` 分隔、按宽度从尾部丢字段、`stats` 兜底截断（`layout.ts:38-54`）。**S1 只需让 `describe` 产出 `secondary`，不改布局代码。**

### 设计

在 `tools/shared.ts` 新增一个按工具名参数化的 secondary 推导函数，供四工具的 `describe` 复用；四个工具的 `describe` 从各自的 `Metadata` 中带上 `secondary`。要点：

1. **主字段去重**：`title()` 已表达的信息不得在 secondary 重复。主字段定义为——
   - `bash`：`description`（非空 trim）或 `command`；`title()` 已把 `run_in_background`/`background_after_seconds`/`timeout` 拼在主字段尾部，这些项**不再**进 secondary。
   - `read`：`path`；`offset` 已由 suffix `:offset` 表达，**不再**进 secondary。
   - `grep`/`find`：`pattern` 与 `path`。
2. **候选集合**（仅当键存在且非 undefined 时纳入）：
   - `bash`：主字段为 `description` 时，`command` 进 secondary。
   - `read`：`limit`。
   - `grep`：`glob`、`ignoreCase`、`literal`、`context`、`limit`。
   - `find`：`limit`。
3. **格式化**：布尔为 `ignoreCase`/`literal` 这类 flag 用参数名本身（pi schema 即 `ignoreCase`/`literal`，与现有 `title()` 的展示风格一致）；数字为 `limit 400`；字符串为 `glob *.ts`。空字符串按不存在处理。
4. **与 stats 的关系**：`renderCall` 中 `meta.stats` 由 `describe` 与计时器合成，`secondary` 与之并列进入 `toolHeading`，由 `summary()` 统一在宽度不足时降级。流式期间 `stats` 为空，secondary 获得最宽松空间。
5. **不得新增字段排序/数量上限**（用户明确不需要抖动缓解）；字段顺序由实现按信息价值自定，写入测试以固定当前行为即可。

### 复用边界

不得复制 `summary()` 的丢字段逻辑，也不得自行拼接后再截断——secondary 字符串原样交给 `toolHeading`，降级由既有布局负责。布尔/数字/字符串的格式化属本工具族自有展示语义，放在 `tools/shared.ts` 与四工具 describe 附近，不放进通用 `layout.ts`。

## S2：展开态完整参数表

### 现状

`renderCall` 的 `render(width)` 只返回 `toolHeading(...)` 的 1..n 行；`renderResult` 仅在有 result 且 `ctx.expanded` 时返回 body。因此执行中（无 result）展开无任何新增内容。

### 设计

`renderCall` 返回的组件在 `ctx.expanded` 时，于标题之后追加参数表行：

1. **复用 `tool-card.ts:54-72` 的 `argumentsText`**：逐 `key: value`，多行值以两个空格缩进，`displayValue` 用 `JSON.stringify(value, null, 2)`。将其从 `tool-card.ts` 导出（或提取到两族共享模块）供 `tools/shared.ts` 使用，**不新造第二套格式化**。
2. **预览契约复用 `card-primitives.ts` 的 `textPreview`**：折叠 3 行 + `… (N more lines, expand)` 提示的既有规则不适用于此处——展开态本就应给全量，故展开参数表直接给 `wrap()` 全量行，不走 `textPreview` 的 3 行预算。窄终端由 `wrap` 负责换行，宽度不溢出由 `wrap` 的 `visibleWidth` 逐段累加保证（`layout.ts:24-36`）。
3. **状态覆盖**：参数表只依赖 `ctx.args`，与有无 result 无关，因此流式中/执行中/完成后三种状态天然一致。有 result 时参数表与 result body 的先后顺序保持「先参数表、后正文」，与 `tool-card.ts` `defaultDescription` 中 `[argumentsText(args), output].join("\n")` 的既有顺序一致。
4. **组件复用**：`renderCall` 返回的组件需跨帧复用（宿主传 `lastComponent`），参数表随 `ctx.args` 增长增量更新；不得每次渲染重建导致高亮/计时状态丢失。四工具中 `read`/`bash` 已有自己的 drawing/cell 复用机制，参数表作为其子节点追加，不破坏既有 `state` key。
5. **`expanded` 与 `renderResult` 的边界**：`renderResult` 继续只负责 result body；参数表不移交 `renderResult`，避免 result 到达前后参数表消失。

## 验证与回滚

见 `implement.md`。关键风险：

- **宽度回归**：`tools.test.ts` 既有断言 `rows.every(line => visibleWidth(line) <= Math.max(width, 5))` 覆盖宽度 [1,2,8,20,40,80,120]，必须继续通过；新增宽度 10–400 的扫描用例固定「非 taskTool 折叠恒 1 行、0 溢宽」。
- **既有快照/字符串断言**：`tools.test.ts`、`shell-collapse.test.ts`、`tool-call-heading.test.ts`、`retrieval.test.ts`、`terminal-layout.test.ts` 中有针对四工具标题/统计的精确匹配，secondary 与参数表会改变输出，需逐条核对是「预期内变化」而非「信息丢失」。
- **主字段重复**：`bash` 的 background/timeout 与 `read` 的 offset 已在主字段表达，重复进入 secondary 会造成信息冗余，需专门断言不重复。
- **流式部分对象**：未到达键不得渲染为 `undefined`/`null`；需以「逐键递增」的阶段性用例覆盖。
- **其它族不回退**：`edit`/`write`/`subagent_run`/`process_manage`/`agent_manage`/`monitor`/MCP 的既有断言必须原样通过。

每阶段独立审查与测试后提交；出现行为回归只撤回本阶段相关新增（S1 的 secondary 推导 / S2 的参数表追加），不改布局层公共函数与执行策略，不改并行修改。

目前为规划；参数表的具体挂载方式（独立子组件 vs 并入既有 drawing）在实施时按四工具既有组件结构确定，不以本设计的措辞限制实现。

## S3 验收修正设计（替代此前原始参数表设计）

以内容职责拆分，不按阶段拆分：当前 args → 单一工具专属 call description（标题、关键选项、展开详情）→ 公共布局；同一个 cell 追加动态 stats/timing/result。生成/执行/完成调用相同 descriptor，不写三套分支。

移除 shared.ts 对通用 argumentsText 参数清单的接入；bash 原有 Command: 格式作为调用详情恢复，描述与命令均已到达时可在展开详情读取完整命令，结果 draw 不再重复它。read 的范围/limit、grep/find 的选项由调用 descriptor 统一格式化，标题展开时仍保持语义参数且细节可换行。保持其它工具族 toolHeading 语义不变，优先本四工具族专用/复用布局。参数未到达只略去；宽度降级不做抖动控制。

完整读取相关 shared/layout/tool-card/call heading 四工具及现有测试后选最小实现，不把这个设计变成泛用框架。

## S4：标题颜色与原完成态一致性修正（用户已批准）

用户认可共享内容方向，但指出颜色与完成态文案不一致，提供原对照：`bash  Review nested delegation change and temporary cleanup  background after -1s  17 output lines · execution 0.0s · ctrl+o expand`，并明确“那你改正一下吧”。本阶段在原 worktree 追加修正、独立检查及本地提交，不合并。

保留 tool/name/description/mode 的 accent，次要参数、stats/timing/hint 使用 muted；expanded 不能通过把 secondary 拼到 label 导致整体染 accent。保持原 stats→execution→hint 文案与顺序，不改计时语义、不为本任务新增结果状态分支或三套呈现。新参数仍按已有预算显示，不应替换/改名既有统计。以原对照为真实注册 renderer 的回归基准，折叠/展开都测试 ANSI 颜色及可见文案，宽度控制与其它族保持。

离线演示 fixture 需补工具生命周期事件，确保 elapsed 与 final execution 展示真实 observer 行为；使用同一句 description、17行 output 和 durationMs=0 创建完成态对照，保留逐字段生成与 Ctrl+O 交互。主题显式使用 dark，终端声明 truecolor；不读取个人配置/认证，不伪称线上 provider 或用户终端完全等价。原始材料仓库外 owned tmp；修正产品与测试使用同一阶段提交，演示脚本不进仓库。当前不自动开启 tmux，等用户再次查看。

## S5：无结果时点击展开与演示鼠标接入（用户已授权）

用户确认主页面可点击，但当前 pi 宿主 createResultRegion 在 result 不存在时拒绝点击；原 demo 外层遗漏 handleMouse 转发。用户明确“行，你对应的处理一下”授权本任务在现有 worktree 修复对应四工具族交互与演示，不修改安装 pi/个人会话、不合并。

实现优先使用 renderer Component.handleMouse、state 与 invalidate 公共契约：无结果期间单卡片本地展开状态，三态共用调用布局；不修改只读 host context，不注入假 result、不访问 private ToolExecutionComponent 成员、不全局切换所有卡片。必须明确本地状态如何响应 host Ctrl+O、partial/final 到达、args 更新、重复点击与宿主已有结果点击，避免状态翻两次或到达结果后跳回。只有正文有效区域左点击切换，背景 padding/右键/链接/选择拖拽按既有宿主行为，样式/width/result/timing不改。若公共 API 无法可靠完成则报告具体限制，不偷偷 patch 安装 SDK 或扩大到第三方卡片。

演示转发 mouse 到真实 tool component，并在坐标换算时扣去实际已渲染前置标题高度，不截断实际卡片点击范围；使用 unique tmux socket 开 mouse 捕获验证时只操作 owned server，物理鼠标端到端与模拟事件证据区分。生成/运行无结果点击、result后点击、Ctrl+O互操作、outside/padding/rightclick、args更新、partial/final切换、四工具注册实际SDK与窄宽终端需回归。保留独立检查+本地阶段提交顺序；不自动启动新演示，修正后告知用户。
