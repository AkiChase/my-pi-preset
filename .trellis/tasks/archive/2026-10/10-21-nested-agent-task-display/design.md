# 设计：嵌套 Agent 任务展示

## 问题与边界

当前嵌套关系已经由 Agent source 的 `parentKey` 表达，任务面板可以构建完整树；但 Footer overview 只保留根任务，因此嵌套子 Agent 会被省略。两处还各自把生命周期字形置于树前，并在运行时使用盲文 spinner。结果是：用户看不到完整的嵌套执行关系，也无法把同一个 Agent 在 Footer 和任务面板中的显示对应起来。

本任务只调整任务 UI 的展示模型和渲染，不改变 Agent source 的归属数据、真实管理 ID、调度或生命周期语义。

## 目标体验

运行中的嵌套 Agent 在两处都使用同一顺序：树连接符、状态字形、短名。

```text
主会话
└─ ● general-purpose-3
   └─ ● general-purpose-0
```

`●` 代表未结束的活跃 Agent；Agent 正在推理、调用工具或等待其子 Agent 时均使用该符号。Footer 和任务面板的普通行不再显示 `running`、`queued`、`thinking` 等状态文本。

## 状态字形

在 `extensions/task-ui/presentation.ts` 中维护一份静态字形映射，供 Footer、任务面板行和选中任务状态复用。

| 状态 | 字形 | 颜色 | 说明 |
| --- | --- | --- | --- |
| `queued` | `○` | `muted` | 已进入队列但未开始 |
| `starting` / `running` | `●` | `accent` | 正在进行，包含父级等待子 Agent |
| `paused` | `Ⅱ` | `warning` | 已暂停 |
| `completed` | `✓` | `success` | 完成后的短暂保留 |
| `failed` | `✕` | `error` | 失败后的短暂保留 |
| `stopped` | `■` | `dim` | 已停止后的短暂保留 |
| `interrupted` | `!` | `warning` | 会话中断 |

映射不再接收动画帧。`TaskPanel` 和 Footer owner 随之移除仅为 spinner 而存在的 250ms 重绘计时器；保留按秒更新时长和终态过期所需的计时逻辑。

## 树模型与 Footer 截断

### 共享树形数据

`TaskPanelModel` 已拥有父子展开、循环容错和树前缀计算。应提取不带选择、折叠、详情读取或面板状态的纯树行构建逻辑，供任务面板和 Footer overview 使用。提取后：

- 任务面板继续使用完整树，并保留折叠与选中行为；
- `TaskOverviewModel` 保留完整的 Agent/workflow 树快照，而不是只保存根节点；
- source 中的 `parentKey` 保持唯一的归属输入，绝不从显示文本或 `agent_id` 推断层级。

### Footer 行预算

Footer 仍保守限制行数。它按深度优先顺序选择行，但当选中一个后代时必须一并保留其所有祖先，优先保证完整的活动路径可见。预算无法容纳其余行时，在最后输出明确的汇总行，例如 `+2 hidden`；不得把活跃子 Agent 因为“不是根任务”而在无提示的情况下丢弃。

现有完成态 linger 窗口仍以根组为单位，避免一个刚完成的父/子组被 source sweep 拆开。多根任务、孤儿 `parentKey` 和循环关系继续使用当前容错行为。

## 行布局

### 任务面板

`taskLine()` 从“字形在最左侧 + 类型前缀 + 状态文本后缀”的布局改为：

```text
└─ ● general-purpose-3                 1m12s · ↓ 12k
```

- 对 Agent 行使用 source 提供的 `title`（即作用域内短名），不再添加 `agent ` 前缀；
- 对非 Agent 行保留必要类型/标题区分，防止 shell、monitor 和 workflow 不可辨识；
- 正常行移除方括号生命周期文本。时长、tokens、子项计数等非生命周期信息仍按宽度预算展示；
- 错误详情仍在详情页按现有结构以文字展示。

### Footer

Footer 使用同一棵树和同一行顺序，但不显示面板控制、选中态或详情信息。窄宽度下优先保留树结构、字形和短名；时长与 tokens 是可丢弃的次级信息。

## 影响文件

- `extensions/task-ui/presentation.ts`：静态状态字形、行布局和状态行格式。
- `extensions/task-ui/model.ts`：提取或新增可复用的纯树行构建逻辑，保持面板选择/折叠行为不变。
- `extensions/task-ui/overview.ts`：保留并选择层级行，渲染嵌套 Footer 树与可解释的截断。
- `extensions/task-ui/owner.ts`：移除 spinner 重绘调度，按新 overview 输入判断时长刷新。
- `extensions/task-ui/panel.ts`：移除仅服务 spinner 的面板动画计时器；继续保留秒级时长刷新。
- `extensions/task-ui/__tests__/overview.test.ts`、`extensions/task-ui/__tests__/panel.test.ts`：覆盖树、字形、布局、窄宽度与无 spinner 时钟行为。

是否需要调整 `extensions/agent-tasks/src/source.ts` 由实现阶段实际确认；预期不需要，因为短标题和 `parentKey` 已在 source 中正确提供。

## 风险与兼容性

- Footer 是共享 widget 的 block item，必须继续经 `createWidgetClient()` 发布，不能直接调用 host Footer setter。
- 不能以移除计时器为由停止终态 linger 过期或运行时长更新。
- 任务面板的导航、折叠、选择固定、详情读取和无 detail I/O 的渲染契约不得因树逻辑提取而退化。
- 终端宽度有限时，省略策略必须显式且宽度安全；不得假设可显示全树。
- 真实 `agent_id` 仍是 `agent_manage` 等工具的 API 身份，不能因 UI 短名策略改变。

## 回退

改动局限在渲染/派生模型层；出现回归时可回退本任务提交，不涉及数据迁移、持久化格式或外部 API 兼容迁移。
