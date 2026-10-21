# 设计：精简派发上下文并改进任务面板体验

## 1. 设计目标与边界

本设计解决两个相互独立但都会影响子代理可用性的问题：

1. Trellis 派发时将完整引用清单重复发送给模型，造成不必要的 prompt 膨胀；
2. Task Panel 把详情资料和完整会话串在一个全局滚动区中，且工具输出未折叠，长会话难以浏览。

不改变任务执行、等待、取消、parent-messaging 的语义；不新增或猜测 `waiting` 子代理状态；不改动 Pi 宿主主对话框的实现。

## 2. 派发 authority 精简

### 2.1 最小可见 header

保留既有四行 header 结构，以维持宿主对 Trellis 角色派发的识别方式：

```text
Active task: .trellis/tasks/<task>
Trellis context id: <id>
Trellis agent: trellis-<role>
Trellis authority: {"sourceRoot":"…","executionRoot":"…","requirementsFingerprint":"…"}
```

其中 task、role、context id 已分别由前三行承载。authority JSON 仅保留：

| 字段 | 作用 |
| --- | --- |
| `sourceRoot` | 子代理读取任务材料与 spec 的权威根目录 |
| `executionRoot` | 子代理查看、测试和编辑产品代码的位置 |
| `requirementsFingerprint` | 宿主将 header 与本次 native material query 绑定的完整性指纹 |

下列内容不再放入模型可见的 JSON：`materialRoot`、`taskPath`、`specRoot`、`workflowPath`、`artifacts`、`manifest`、`references`。它们由宿主的 native `queryWorktree` / `requireMaterials` 重新得到；其中 `materialRoot` 本来就等于 `sourceRoot`。

### 2.2 验证流程

1. 派发前，主会话通过 native query 取得 `SourceMaterials`，以其 fingerprint 组装最小 header。
2. 子会话的 `before_agent_start` 解析最小 header，并再次执行 native query。
3. 宿主验证 taskDir、role、source root、execution root/worktree binding 和 fingerprint 与 native facts 一致后，才绑定子会话；不匹配则保持 `task_error`，禁止本地 pointer fallback。
4. 宿主内部可保留已验证的完整 material facts，用于后续路径存在性与 binding 复核；这些 facts 不重新写回模型 prompt。

这保留现有“prompt 不是授权”的原则：模型看见的路径从不取代 native source/binding 验证。

### 2.3 子代理的读取说明

`assembleDispatchPrompt()` 只说明：

- source root 与 execution root；
- 必须读取当前任务的 `prd.md`、存在时的 `design.md` / `implement.md`、workflow；
- implement/check 角色必须读取 role manifest，并按 manifest 展开和完整读取其选中引用；
- 缺失或变化的 source material 必须报告主会话，不能回退到 execution checkout 的 `.trellis`。

不再把每条 reference 的路径、标签、hash、字节数逐行写入 instruction。manifest 是唯一面向子代理的完整引用清单。

同步更新 Trellis 角色文档和工作流中“authority 携带全部路径/reference”的表述，使其说明从 source root、taskDir、role 与 manifest 推导资料位置，而非要求模型从 header 读取整份清单。

## 3. Conversation 数据与分页

### 3.1 新的有界分页契约

保留普通 shell/monitor 的现有 raw text detail 路径。仅 agent conversation 采用结构化、可分页的 detail 契约：

- 初次请求不带 cursor，返回最新一页；
- 旧历史请求携带 source-owned opaque cursor；
- 返回值说明是否还有更早/更新的页、是否因读取预算而截断，以及可安全用于下一页的 cursor；
- cursor 不可解析为授权，不跨 task identity/run identity 复用；过期、会话压缩或 artifact 不可读时返回可显示的重置/降级状态，而不是错误地拼接消息。

`TaskDetailRequest` / `TaskDetail` 会在向后兼容现有 source 的前提下增加可选 conversation-page 字段。`TaskCoordinator` 继续限制 detail 的原始文本预算，但不得把结构化分页结果裁成无效对象。

### 3.2 首屏与自适应反向取样

首屏目标为最新 64 条可展示 entry：

1. 先从末尾读取 128 条原始 message；
2. 转换时跳过 system、隐藏 custom/context、空消息与无法展示的事件；
3. 不足 64 条时，继续以固定小页向前补取；
4. 在达到 64 条、历史起点或严格原始 message/字节扫描上限时停止；
5. 明确标记因上限或历史边界未加载的部分。

这样避免固定 `64 × 3` 的无效扫描，也防止异常 session 触发无限向前遍历。

### 3.3 source 实现与稳定身份

- live session：从内存 message 序列按页反向转换，不在每次 panel refresh 扫描完整 session；
- 已结束 transcript：按有界 byte range 反向读取 JSONL，使用文件位置作为分页锚点，不读取整份 `.output` 文件；
- 每条 `ConversationEntry` 获得 source-owned stable ID。展开状态、可点击区域和分页去重只依赖该 ID，不能依赖数组 index；
- tool call 与 tool result 关联使用 tool-call identity，以便为 read/write/edit 生成路径、结果和统计摘要；不展示 system 或 provider 内部消息。

### 3.4 滑动窗口

Panel 只缓存当前视口附近的有限页数/entry/字节量：

- 向上到达阈值时，在 render 外主动请求更早页；
- 向下回到已淘汰的区域时，可用 cursor 重新请求较新页；
- 超出窗口的远端页可淘汰；
- 前插或淘汰时以当前首个可见 stable ID 和其行偏移作为锚点，调整 scroll position，避免阅读内容跳动；
- source 更新追加最新消息时，只有处于尾部 follow 状态的视图自动追随。

所有 file/session detail 读取发生在 refresh、键盘或鼠标事件路径；`render()` 只消费已缓存的有界快照。

## 4. Task Detail 布局与滚动

### 4.1 固定区域

详情页由下列纵向区域组成：

```text
Task Panel · Detail
[固定且限高的 Metadata 摘要]
── Conversation · <范围/计数> ──
[独立 ScrollView：父子消息、会话与输出]
[固定状态栏]
[固定快捷键与可用操作]
```

- **Metadata 摘要**：只显示任务名、模型/配置、核心统计和有限 artifact 摘要；采用动态但有上限的高度预算，并始终为 Conversation 至少保留可用正文行数。长路径按单行截断，不可滚动；`c` 保留复制完整路径的能力。
- **Conversation 标题与 ScrollView**：标题固定，正文单独滚动。既有 Messages 区块移动到此滚动正文中，不把往来消息误归为 metadata。
- **状态栏**：位于 Conversation 下方、快捷键提示上方，始终可见。详情顶部不再重复主状态行。
- **小终端**：先保留标题、最小 metadata 摘要、至少一行正文、状态栏和操作提示；次要字段按既有宽度裁剪策略省略。

### 4.2 Follow-to-latest

Conversation ScrollView 使用 Pi 的 `follow: "end"`：

- 初次进入 detail 或切换到其他 task 时，渲染后调用 `scrollToEnd()`；
- 用户通过滚轮、`↑↓` / `j` / `k`、Home 等离开末尾时，Pi 的 ScrollView 自动解除 follow；
- 处于末尾时，新增消息使其继续跟随；
- End 回到末尾后重新启用 follow；
- 在顶部请求旧页后，按分页锚点补偿 scrollTop，不能把用户拉回最新消息。

Pi 原生 `ScrollView.isFollowingEnd` 是 follow 决策的唯一依据，Panel 不以“最近一次输入按键”猜测用户意图。

### 4.3 鼠标坐标与独立滚动

Panel 使用 native layout 已提供的 Conversation ScrollView clip rect：

1. wheel 只路由给其命中的 conversation scroll box；
2. 左键事件根据 clip、scrollTop 和渲染器记录的 line range 转换为文档行；
3. 命中一个可折叠 tool entry 时，仅切换该 stable ID；
4. 其他点击不吞掉主 TUI 的文本选择等默认行为。

Metadata、状态栏和 footer 的点击不应穿透或改变 conversation scroll position。

## 5. Conversation 压缩与鼠标展开

### 5.1 默认形态

工具输出默认紧凑，不再将完整 `entry.text` 按行直接放入 detail：

| 类型 | 默认显示 |
| --- | --- |
| bash | 命令、exit 状态、输出行数/省略量及有限尾部预览 |
| read | 路径、读取范围/行数、是否截断 |
| write | 路径、写入行数/字节数和成功/失败；成功时不回显写入正文 |
| edit | 路径和新增/删除等 diff 摘要 |
| 通用 tool result | 工具名、成功/失败和有限预览 |

折叠形态使用非常小的 visual-line 预算；展开后也使用明确的 visual-line/字符上限，而不是允许一次点击把数千行塞回详情。超出部分显示“还有 N 行/字符”或 source-truncated 提示。错误结果优先保留错误摘要。

### 5.2 交互与缓存

- 唯一的展开方式是鼠标点击对应工具结果；不增加全局展开，也不占用键盘快捷键。
- `ConversationRenderer` 从单纯 `string[]` 结果升级为包含 rendered lines 与 stable-ID line ranges 的有界 render model。
- Panel 维护 `expandedEntryIds`，按 task identity/run identity 隔离；普通刷新、追加最新消息和向前分页不会清空它。
- Markdown 仅用于 assistant 正文；工具 output 使用文本预览，避免在折叠时解析大段 Markdown。

## 6. 状态呈现

新增共享的状态 presenter，供列表行、详情状态栏与必要的摘要复用：

| 真实状态 | 图标 | 颜色 | 动效 |
| --- | --- | --- | --- |
| queued | `○` | muted | 无 |
| starting | spinner | warning | 有 |
| running | spinner | accent | 有 |
| paused | `Ⅱ` | warning | 无 |
| completed | `✓` | success | 无 |
| failed | `✕` | error | 无 |
| stopped | `■` | dim | 无 |

没有 `waiting` 行，因为当前 runtime 没有可靠的对应状态。状态栏按“状态、名称、当前 activity、耗时、次级 turn/tool/token”排序；窄宽度时优先保留状态、名称和错误/暂停事实。

面板打开且存在 starting/running task 时，才以受控频率更新 spinner 帧；其他情况下不为动画发起高频重绘。无法动画时渲染静态可读 fallback，文字状态始终存在，不依赖颜色。

## 7. 文件责任与兼容性

| 区域 | 预期责任文件 |
| --- | --- |
| authority 组装/解析/校验 | `extensions/trellis/lib/task-context.ts`、`extensions/trellis/index.ts` |
| Trellis 角色与工作流契约 | `extensions/trellis/agents/trellis-*.md`、`extensions/trellis/resources/workflow.md` 及相关测试/资源元数据 |
| 结构化会话分页与 tool 关联 | `extensions/agent-tasks/src/conversation-entries.ts`、`extensions/agent-tasks/src/source.ts` |
| Task UI 类型与 coordinator | `extensions/task-ui/types.ts`、`extensions/task-ui/coordinator.ts` |
| 详情布局、滚动、鼠标事件 | `extensions/task-ui/panel.ts`、`extensions/task-ui/detail-view.ts` |
| 会话折叠 renderer 与状态 presenter | `extensions/task-ui/conversation.ts`、`extensions/task-ui/presentation.ts` |
| 用户可见 Task Panel 说明 | `docs/extensions/task-composition.md` |

其他 TaskSource 必须保持兼容：若未提供结构化分页会话，Panel 继续显示现有有界 raw output detail。

## 8. 失败、降级与回滚

- native authority query、fingerprint 或 binding 校验失败：维持当前 `task_error` 行为，不降级到 execution checkout materials；
- manifest/reference 在子代理读取期间缺失或变化：报告 source error，不把内容复制进 prompt；
- transcript 不可读、cursor 失效或 page 读取异常：保留已加载页，显示明确降级提示与 artifact 路径，不显示拼接错误的历史；
- layout/native scroll incompatibility：沿用现有 fail-closed Task Panel 行为；
- 任一实现阶段失败可回滚该阶段提交，不改变任务执行或持久化会话格式。

## 9. 验证策略

1. Trellis `.mjs` fake-host tests：最小 header、native 重新比对、伪造/缺字段/错误 fingerprint、prompt 不含 reference path/hash/size、普通与受管派发。
2. agent-tasks tests：自适应反向取样、stable ID、live/JSONL 页游标、边界/失效/预算/隐藏角色和 tool-call/result 关联。
3. task-ui tests：固定 metadata/状态/footer 区域、独立 conversation scroll、初始尾随与离开尾部后的不追随、分页锚点、窗口淘汰重载、点击单项展开、窄宽度/Unicode/resize。
4. status presenter tests：所有真实状态、spinner 静态 fallback、无 waiting 映射。
5. 执行受影响 focused suites、strict typecheck 与最终 `pnpm check`；在真实安装 Pi 中进行一次手工 TUI 冒烟确认（布局、滚轮、点击、follow）。
