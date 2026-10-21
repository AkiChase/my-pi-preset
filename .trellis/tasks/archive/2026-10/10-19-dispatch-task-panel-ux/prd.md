# 精简派发上下文并改进任务面板体验

## 目标

减少 Trellis 派发角色时占用模型上下文的无效元数据，并让 Task Panel 的详情页能有效呈现长时间运行的子代理：工具结果默认紧凑、会话区域独立滚动、状态稳定可见且语义清晰。

## 背景与已确认事实

- Trellis 当前会把每个选中引用的绝对路径、SHA-256、字节数和标签序列化到子代理 prompt 的 `Trellis authority` JSON 中。该 header 只包含路径型元数据，不会注入被引用文件的正文。
- `extensions/task-ui/detail-view.ts` 与 `panel.ts` 当前将元数据、父子消息、Conversation、输出拼接在同一个 `ScrollView` 中；不存在受限高度的会话区域，也没有跟随最新消息的行为。
- `extensions/task-ui/conversation.ts` 会完整渲染 bash 与通用 tool result 的正文；目前没有单条展开状态、鼠标交互或收起/展开能力。
- Pi 主交互界面的默认行为是预览工具输出：通用 tool fallback 默认预览 10 行，bash 默认预览 20 行，两者都支持按工具单独展开。
- Task Panel 对 `running` 使用静态 `●`，其余状态使用 `○`；列表和详情 header 都会使用该符号，没有活动动效，也无法用图标完整区分任务生命周期。

## 范围

### 1. 精简 Trellis 派发 authority

- 将 prompt 中的逐引用 authority 元数据缩减为角色定位和校验 source material 所必需的最小字段。
- 保留宿主侧校验、source root 与 execution root 的分离，以及“prompt 文本本身不构成授权”的规则。
- 保留 manifest 作为完整文件选择清单；不再为子代理重复内联每个引用的路径、hash 和大小。
- 更新协议解析/校验与聚焦测试，确保精简后的形式仍能抵御伪造，并兼容普通派发和受管派发。

### 2. 重构 Task Detail 信息架构

- 将 Task Detail 从一个全局滚动区域拆为独立视觉区域：
  - 紧凑且有高度上限的元数据/header 区；
  - 独立滚动的 Conversation/Output 区；
  - 始终可见的底部状态栏及快捷键/操作区。
- 元数据和 artifacts 应可见，但不能因长路径或大量字段占满详情视口。
- 将所选任务的实时状态摘要放至底部，不再作为详情顶部的主要视觉元素。
- 打开会话时定位至最新可用消息。视口处于底部时，新增消息自动跟随；用户向上浏览历史后，不得强制跳回底部。

### 3. Conversation 紧凑显示与逐项展开

- tool call 与 tool result 默认使用紧凑摘要；不得因子会话中存在长 bash/read/write/tool-result 正文就全部展开渲染。
- 在适用处对齐 Pi 主对话框：默认简短预览、显示被省略内容数量，并支持逐项展开/收起。
- 为 bash、read、write、edit 和通用 tool result 提供合适摘要，例如命令/路径、状态、行数或 diff 统计；write 默认不显示写入正文。
- 仅通过鼠标点击紧凑工具结果来展开或收起对应单项；不提供全局展开，也不为该功能增加键盘快捷键。
- 普通实时刷新不得丢失某条工具结果的展开状态。

### 4. 状态语义与活动反馈

- 用列表行和详情底部状态栏共用的状态呈现模型取代静态运行紫点。
- 为 queued、starting、running、paused、completed、failed、stopped 使用不同的图标、文字与颜色语义，不得仅依赖颜色。当前不存在可靠来源的 `waiting` 子代理状态；本任务不得伪造或启发式推断该状态。
- starting/running 使用轻量活动指示；动画不可用或关闭时，回退为静态且可理解的状态符号。
- 详情状态栏按重要性展示：状态、任务名、阻塞/当前活动、耗时、次级 activity/token 计数。

## 约束

- 除非后续设计明确批准，不改变现有任务控制、steering composer、任务选择/树导航和任务资料来源语义。
- 不在 authority 中嵌入文件正文，也不得因为提供了 authority 元数据就声称子代理已阅读资料。
- 不得削弱 source root containment、source/execution root 分离或派发 header 防伪能力。
- 代码与代码注释使用英文；Task 文档使用中文。
- 本任务为复杂任务：在执行前必须创建 `design.md` 与 `implement.md`、完成计划评审，并取得明确的实现授权。

## 不在范围内

- 重做 Pi 宿主的主交互对话渲染器。
- 改变代理执行、等待、取消或 parent-messaging 的语义；仅改进其在 Task Panel 中的呈现。
- 增加完整的会话搜索或导出系统。
- 改动无关的 Task Panel 列表/树数据模型行为。
- 推送、发布或部署扩展。

## 验收标准

- [ ] 被派发的 Trellis 角色获得显著更短的 authority header，不再列出每个选中引用的路径/hash/大小；宿主仍能拒绝伪造、格式错误或 source 不匹配的 header。
- [ ] 子代理仍获得明确的 source material root、task path、workflow path、manifest 位置及（适用时）独立 execution root。
- [ ] Task Detail 视觉上分离有上限的元数据区、独立滚动的 Conversation/Output 区和持续可见的底部状态/操作区。
- [ ] 打开或自动跟随会话时显示最新消息；用户手动浏览历史后，自动定位暂停，直至用户回到会话底部。
- [ ] 长 bash 与 tool-result 正文默认紧凑，提供省略内容提示，且可通过鼠标点击逐条展开/收起。
- [ ] read/write/edit/通用 tool result 的默认展示简洁，尤其 write 不默认回显完整写入内容。
- [ ] 列表行和详情状态栏使用一致的真实状态映射；running/starting 明确呈现活动感，终态、排队态和暂停态不依赖颜色即可区分；不得展示未经运行时支持的 waiting 状态。
- [ ] 聚焦单元测试覆盖 authority 组装/解析、详情分区与 follow 行为、会话压缩/展开、状态映射；已有相关测试通过。

## 已确认的 UX 决策

- **工具结果展开：**仅通过鼠标点击紧凑工具结果来展开或收起对应单项；不提供全局展开，也不为该功能增加键盘快捷键。
- **元数据溢出：**使用不可滚动的固定摘要和截断值；完整路径仍可通过现有复制动作取得。Conversation 始终优先获得详情视口空间。
- **子代理历史加载与驻留：**默认快速显示最新的有界会话窗口；最新窗口采用自适应反向取样：先读取目标展示条数的两倍原始消息，过滤后不足再继续向前补取，直到填满目标展示条数、到达历史起点或达到严格扫描上限。用户向上滚动至窗口顶部时按页加载更早消息；完整历史不在每次刷新时全部加载，工具结果仍默认折叠。已加载页采用滑动窗口：仅保留当前视口附近的有限消息页，滚动离开窗口后可按游标重新加载较早/较新页。总渲染量保持上限，分页、淘汰和重新加载不得造成阅读位置跳跃。
- **等待状态：**本任务仅呈现现有真实状态。当前 `waitCount`、parent request pending 和缺少 tool activity 都不构成子代理 waiting 状态；不新增 waiting runtime 合约，也不使用启发式推断。

## 实现护栏与风险

- **authority 重复信息：**当前详细 references 不仅出现在 authority JSON 中，也会再次逐行写入 child prompt 的 source-authority instruction；精简方案必须同时删除这两处面向模型的重复清单，不能只缩短 JSON。
- **authority 校验：**child startup 应从本地重新查询受信任的 native source materials，并以最小 authority 的 root/task/role/fingerprint/manifest 字段比对；不能因删掉 references 就改为信任 prompt 中的任意路径。
- **稳定条目身份：**Conversation entry 需要稳定 ID，不能以数组下标保存展开状态；向前分页插入旧消息后，下标会变化，导致点击展开状态串到其他消息。
- **鼠标命中：**当前 Task Panel 只处理滚轮；为满足“仅鼠标点击展开”，需要为每条可折叠 entry 建立可测试的点击区域，并与 Conversation 独立滚动坐标正确映射。
- **分页来源：**live session 与已落盘 JSONL transcript 都必须支持有界的“向前一页”读取；不可在每次更新时重新扫描完整 session 或文件。加载失败、文件不可读、历史达到边界时必须给出明确提示。
- **分页后的内存/渲染上限：**加载更多历史不能令详情页无限积累并在每次刷新重新渲染全部消息；需要采用有界窗口或可见区域虚拟化，并保持浏览位置稳定。
- **等待态语义：**已明确不在本任务中展示或实现 waiting；不得把现有 `waitCount`、parent request pending 或缺少 tool activity 映射为该状态。
- **动画预算：**当前面板仅以 1 秒 timer 刷新；运行指示器需要受限频率、仅在可见且有活动任务时更新，并在不支持或关闭动画时稳定回退，避免无意义的高频全屏重绘。
- **隐藏内容边界：**Task Panel 继续只显示允许呈现的 user/assistant/tool/bash 等结构化条目；不得因历史分页意外展示 system、隐藏 custom/context 或 provider 内部消息。

## 技术待确认项

- 设计 live session 和 JSONL transcript 的可验证分页游标、失效/重试行为和 artifact 不可读时的降级提示。
- 定义滑动窗口的页数/条目和字节上限，并保证向前加载、淘汰和重新加载不会造成滚动跳跃。
