# 统一工具卡片与会话通知渲染：技术设计

## 设计目标

公共呈现层只负责标题+正文、主题、宽度降级、折叠预览、交互 shell 和实时显示状态。执行 owner、结果 delivery、消息消费和业务状态解释继续归原模块。

设计遵循：先保全 renderer/执行所有权，再统一可安全接入的表面；不能从不透明组件中猜测标题或正文。

## 模块边界

| 层 | 所有者 | 责任 |
| --- | --- | --- |
| 公共呈现 primitive | `extensions/beautify/` | Card 标题/正文布局、文本预览、theme/width 处理、self shell、通用工具兜底、实时 elapsed 显示。 |
| 工具适配器 | 各工具 owner | 提供身份、摘要、调用 marker/统计、无标题正文及可选展开信息；不重复创建 shell 或执行。 |
| 通知/entry 适配器 | agent/process/trellis owner | 将已有结构化通知或 entry 数据转换为公共 card 数据；不重组 delivery。 |
| 执行与 delivery | 现有 manager/registry/delivery | spawn、wait、cancel、grouping、reply 匹配、消息发送、日志和控制器；不因 UI 迁移改变。 |

公共 primitive 是无注册副作用模块；工具和通知 import primitive，不 import Beautify extension entry。

## 公共 card 合同

概念数据形状如下；具体 TypeScript 名称和文件由实施阶段按现有类型收敛：

```ts
interface CardTitle {
  identity: string;
  summary?: string | SummaryRenderer;
  marker?: DisplayField;
  statistics?: readonly DisplayField[];
}

interface CardView {
  title: CardTitle;
  body: HeaderFreeBody;
  hiddenInformation?: boolean;
}
```

- `SummaryRenderer` 只得到分配宽度、theme 和 expanded 状态；返回受限的标题片段，不能返回任意卡片组件、占用 marker 区或自行换出额外标题。
- `DisplayField` 由适配器给出已解释的 label/tone；公共层不把 agent/process/monitor 原始状态合并为新的业务 enum。
- `HeaderFreeBody` 是无标题正文。文本 body 可由公共层严格裁剪；复杂 body 必须保留其原组件和交互，不能通过抓取 ANSI/text 私有字段再重新组合。
- 通用工具兜底产生参数+结果文本 body；专用适配器按需要在 expanded body 中组织参数、目标信息和输出。

## 标题与正文布局

### 标题

1. 身份始终优先保留；摘要是可缩短区域。
2. 单行优先；先移除次要字段和展开提示，再缩短摘要。
3. 若最小可辨摘要与 marker/statistics 无法同行，marker/statistics 整体下移；极窄宽度继续按 terminal columns 换行。
4. 不强制右对齐，避免实时时间增长时摘要不停跳动。
5. 单一业务对象可有标题 marker；聚合消息不伪造一个整体业务状态。

### 正文

- collapsed 时以真实 `render(width)` 的物理文本行计数，最多 3 行；标题不计入，展开提示另占一行。
- 错误先进入同一预算；正文相同错误不重复。
- expanded 时保留完整可用正文。交付层已有截断、日志/manifest 路径或省略信息必须原样表达，不能暗示可恢复。
- 图片由宿主在 renderer 外附加，不进文本三行预算，也不截切。
- 涉及 mouse、OSC8、异步 highlighter/preview 或空 body 时，wrapper 必须保持原组件和 invalidation/事件所有权；不能把组件一律转换成字符串。

## 工具接入策略

### 公共 self-shell factory

公共 factory 返回 `renderShell: "self"`，唯一拥有：

- Box/背景/padding；
- 展开点击区域和标题/正文组合；
- 统一标题算法；
- collapsed 文本预览；
- 运行 elapsed 与终态 execution 显示。

自有或明确协作的工具直接采用 factory 并提供 header-free body。它们不得再把旧完整 renderer 嵌套进公共 card。

### 全局 resolver

`pi.registerToolRenderer((name, next) => …)` 的职责仅是路由：

| 下游结果 | 行为 |
| --- | --- |
| `next()` 为 `undefined` | 返回公共 self-shell 的通用工具兜底。 |
| `next()` 提供任意 renderer | 完整原样委托。 |
| 自有/协作工具 | 其注册或明确路由直接使用公共 factory。 |

不使用工具名、`renderShell` 值、组件第一行、ANSI 或私有字段自动拆解已有 custom renderer。

### 原生与外部边界

第一版保留 Pi 原生 `edit/write/read/ls/codemode` renderer 及未知 external custom renderer。原因是 Pi 公开 `ToolRenderers` 只有 `renderCall`、`renderResult`、`renderShell`，没有 title/body/native-clock 的语义 seam：

- write 可将标题和流式正文放在同一不透明组件；
- edit 可把标题、异步 diff 和回写状态放在 call Box；
- codemode 和外部 web renderer 可在 call/result 两侧各自拥有正文、进度和计时。

强拆会导致丢正文、双标题、双 shell 或破坏交互。后续只有宿主新增公开语义接口，或某个工具提供可验证协作 adapter 时才专项迁移。

## 时间与状态

### 调用状态

调用 adapter 使用：`Pending`、`Running`、`Completed`、`Failed`、`Cancelled`。

- `Cancelled` 只接受可靠结构化证据；wait release、目标 stopped 或错误文本不能自动推断取消。
- background admission 成功不代表目标完成；查询失败目标不代表查询调用失败。

### 实时 elapsed 与终态 execution

- `tool_execution_start` 起记录 monotonic start，运行中显示 `elapsed` 并按需 invalidate。
- 该事件在参数准备、schema 校验和 `beforeToolCall` 前，因此 elapsed 表示处理已持续多久，不等于 `.execute()`。
- 最终结果有 `context.durationMs` 时，显示字段明确切换为 `execution`；它是 `.execute()` 实际耗时。
- 拒绝、校验失败、未知工具等没有 `durationMs` 时只显示状态。
- history 使用宿主已持久化的 `durationMs`，缺失则无时间；不保存 call 时钟，不创建 display sidecar，不向严格 `runtimeManagement`/`runtimeLaunch` envelope 添字段。
- activation state 只保留 active call 的 start/redraw。`tool_execution_end`、reload、session switch、shutdown 都必须停止 timer、清除 redraw 引用，且不能驱逐 active calls 或让旧 id 复活。

目标 agent/process/workflow runtime 与工具 elapsed/execution 是不同字段，适配器可放在正文。

## 通知、消息与 entry

### 单一对象与聚合消息

- 单一对象通知可把精确业务 label/tone 放到标题，如 `Turn limit reached`、`Stopped`、`Quiet`。
- agent group：模型仍保留一次分组 delivery；用户侧按成员显示独立 card，每张独立预览预算，partial/剩余运行说明保留。
- monitor：维持实际发送消息粒度。现有 monitor batch 渲染为一张公共 card，整体适用三行预算；成员状态、preview、log/manifest 路径和省略说明在正文。未 batch 的 monitor 消息保持单卡。UI 不重新拆包或重组。
- monitor adapter 必须保留 progress、absent、resumed、completed、failed、killed、input stall、output overflow、mixed-source、manifest 成功/失败含义；silence/stall 不被标成完成。

### reply/notice 去重

现有行为不变：未匹配 waiter 的消息可先成为 entry 再被 held；匹配 waiter 的 reply 只在工具结果中出现。

显示层使用真实消息身份 `{executionId, seq, requestId}`，而不是正文相似度：

1. entry payload 增加/保留可用序列身份；
2. 只有 entry 发布成功、且仍位于当前 `buildContextEntries()` 可见 transcript 时，抑制工具正文中同一身份的显示副本；
3. compaction/tree 使 entry 不可见后，工具正文恢复可见；
4. 发布失败、旧记录、非法身份或没有 entry 的 matched reply 一律 fail-open 显示正文；
5. 原模型 content 不变，适配器遍历所有相关 text blocks，不能只取 `content[0]`。

这表示“已发布到当前可见会话表面”，不声称物理终端像素已被用户看见。

### Trellis Check 与 workflow

- Trellis Check 的 `trellis-check-report` renderer 改用公共 card，但复用 `isDiagnosticReport`、`diagnosticReportLines`、计数 tone、报告上限和省略语义；不改检查逻辑、菜单或 toast。
- Workflow 只迁移实时 tool card 与已有通知中已有的数据。CLI/history workflow entry 不新增 error/value/pause/replay 展示快照，保留当前诚实降级。

## 非覆盖边界

- isolated / `extensions:false` / headless child 不承诺自动加载公共 UI。
- mention clone、RPC 等没有真实 transcript tool call id 的启动不制造工具卡或 elapsed。
- `ctx.executeTool()` 嵌套调用由调用方呈现，不凭空创建顶层 card。
- HTML 导出仅验证宿主实际调用 extension renderer 的路径；不承诺原生工具、custom entry/message 或 standalone export 的全统一。
- 不修改 Task Panel、任务浏览器、问卷/权限弹窗、editor/widget/status/toast、外部包或宿主。

## 主要风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 复杂 renderer 被统一外框破坏 | 只迁移自有/协作工具；未知/原生 custom renderer 原样委托。 |
| native 与公共时间重复 | 自有 adapter 删除旧显示时间；实际 host fixture 覆盖。 |
| reply 去重遗漏或误抑制 | 只用结构化身份+当前可见 entry；无证据 fail-open。 |
| 三行预览破坏复杂 body | 仅严格裁剪文本 body；组件 body 保留原组件，测试 mouse/invalidation/image。 |
| timer/activation 泄漏 | session/reload/shutdown、并行调用、自然退出 focused tests。 |
