# 技术设计

## 真实验收修正（覆盖旧工具默认/参数入口设计）

问题owner为task-ui/detail-tool-card.ts的通用self-shell describe与conversation.ts附加提示/参数命中，而非公共SDK不可复用。修正只替换展示适配、面板统一展开和相关tests/docs：优先直接调用beautify工具factories原renderCall/renderResult，宿主shell、padding、背景、标题保持；write/edit安全native展示，不允许edit预执行读取文件。禁止再次复制一套card heading/layout；工具时间与Interrupted采用最小兼容metadata适配。删除独立参数reader/点击分区和常驻标签，Ctrl+O复用公共key匹配并按主页面全工具语义作用于已加载工具及新到达工具。保持稳定配对与展开锚点、queue独立focus、输入独占和关闭清理。source有界参数/结果保留供renderer使用，不改变投递/结果消费。

完整Pi CLI/InteractiveMode隔离加载当前仓库renderer/详情extension，用相同离线SDK事件与临时工具文件生成折叠/展开/窄屏/主题对照；真实capture原始输出在owned tmp，main验收后记录命令结果与不足，不先声称视觉通过。并行 `.trellis/tasks/10-22-beautify-tool-args-visibility` 与 `.probe-count.mjs` 不属本任务，不读取或修改其私有产物来推断授权。


## 边界与所有权

保留 runner → AgentManager → TaskSource → TaskPanel 的现有链路。公共 ToolExecutionComponent 只需 ToolRenderers 而非执行定义，用户已批准阶段3复用它与已审计的 beautify factories；不向 UI 发布 child session、registry 或任意闭包 renderer。执行、queue 和结果消费仍由现有 owner 控制；UI 只读取有界不可变快照。

预期涉及 agent-tasks 的 runner/types/manager/source/conversation 转换，task-ui 的 types/conversation/panel/presentation 及相应测试。必要时提取不依赖执行上下文的展示辅助函数到现有 shared/beautify 层，不能为复用而改变主页面执行行为。用户文档只更新已有 Agent 功能页。

## 工具运行态

- runner 将实际工具事件的 toolCallId 与结束 durationMs 向 manager 传递；准备阶段合成 activity 不冒充实际工具调用。
- manager 按 task/run 与调用 ID 管理有界的工具状态。执行中使用单调计时，完成优先采用宿主提供的 execution duration；未知历史耗时不展示推算值。
- source 输出有界调用快照，详情页将调用和结果按 ID 关联；保留缺失调用/结果的可读回退。
- 顶部复用现有固定一行标题，显示 Agent 名称＋明确状态；运行普通背景，完成成功背景，停止/中断警告背景，失败错误背景。整行背景持续保留，不改变正文背景，不新增重复标题。
- 调用卡标题遵循主 Agent beautify 的工具名、路径/命令、状态及 elapsed/execution 排列与语义色；停止后未完成工具显示 Interrupted 并冻结 elapsed。Agent 总耗时保留底部统计，窄屏保护状态和耗时。
- 总运行时长与当前工具耗时分别标注。复用面板的秒级重绘，不在渲染阶段读文件，不为每个卡片新建独立 interval。
- stop、terminal、resume、shutdown 清理/冻结旧运行态，迟到事件受当前 run guard 约束。并行同名调用不会因名称相同互相覆盖。

## 消息队列

- session 准备前使用现有 pendingSteers，准备后使用 SDK 公共 steering/follow-up queue 快照与 queue_update 事件。
- manager/source 负责准备前后衔接和变更发布；UI 不仅依赖已进入 session.messages 的 User 消息，也不把 mailbox pending question 当作输入队列。
- 详情页在输入区附近显示固定高度独立滚动的 Pending 区：最多 3 个正文视觉行，少于 3 条按实际数量，小终端缩为 1 行，无消息时收起。标题显示数量与当前范围，采用细滚动条；不保留此前候选的点击数量行展开模式。
- Tab 在会话/队列区切换焦点，↑↓ 滚动当前区域，标题语义色表示焦点；鼠标滚轮按区域路由，composer 打开时独占输入。默认末尾跟随，手动浏览后新增/消费消息保持稳定锚点。
- 点击待处理项在现有输入区域只读查看完整内容，Esc 返回，不触发发送/撤回。点击 Failed 项恢复原文到 composer，手动发送，成功入队后替换失败项；不自动重发或在恢复时删除失败项。
- 异步 steer 拒绝不再静默吞掉；将失败以 run-scoped 可读反馈投影给 UI，不能虚报成功或影响后续执行。
- 队列区优先确保正文、状态、输入及可用操作。消息实际进入 conversation 后从待处理列表移除，避免重复。
- 不新增 queue 编辑、撤回、附件或 workflow child steering 能力；不改变公开工具 schema。

## 工具摘要与展开

- 复用公共 ToolExecutionComponent 和已审计 beautify read/grep/find/generic factories；bash/write/edit 使用薄展示 policy 保留已批准默认规则。主页面真实 bash 折叠0行、write 原生10行、edit 不限展开，不把“组件共享”错误宣称为所有行为完全照搬。
- 原生 edit renderCall 在 argsComplete 后生成预执行 diff 并读文件，必须抑制该分支，仅用有界保留的 result.details.diff/firstChangedLine；缺失可读回退，不现场 I/O。
- source 保留有界参数、文本结果和审计过的展示 metadata，标记 complete/truncated/unavailable；参数及配对缓存计入 page/global byte cap，不传残缺结构给 native renderer伪装完整。不会保证任意超大历史参数全量可见。
- 用户确认：展开优先每工具原布局；独立紧凑“查看参数”入口可在运行中/完成后只读查看全部已加载参数，超限提示，Esc 返回，不新增固定 Arguments/Output 双栏目。
- cache仅驻留工具卡，按 toolCallId 稳定配对；panel 负责 running 卡点击展开，避免 SDK 无 result 不 toggle 和双重 toggle。共享 renderer invalidate 清除 panel 缓存后 requestRender，淘汰/关闭撤销异步重绘与 highlighter。
- SDK component 使用全局宿主主题，真实 TUI 路径与未初始化测试可读回退分别验证。
- 按调用 ID 形成一个工具展示单元，合并调用与结果的标题、参数、状态和计时；无法配对的旧/外部记录保持独立可读。
- read/grep/find 默认摘要；通用工具输出默认最多 3 个视觉行，写入成功保留摘要不泄露正文。
- 展开显示当前 source 已加载的全部有界内容，取消独立的 40 行显示层上限。源截断提示保留，不触发自动无限分页或额外读取。
- 继续按稳定展示 ID 管理展开状态、鼠标命中范围和滚动锚点；合并工具卡后不得丢失跨页结果，省略数量只基于实际已知数据。

## 风险与验证

- queue_update 发生在实际 User 消息入历史之前，需要同时验证 queue 变化与会话刷新时序。
- session 创建时的早期 steering、重复消息、resume/stale 事件和准备阶段 activity 需要专项回归。
- 卡片配对不能假定调用与结果总在同一页；分页边界与缺失数据需显式回退。
- 已安装 SDK 公共接口通过实际 AgentSession/组件测试确认，不修改 SDK、不依赖个人 config。
- 静态组件测试不证明真实终端外观；终端验证仅使用隔离测试目录和离线 provider，若无法运行如实记录 NOT_RUN。

## 回滚

按阶段提交，代码/测试/必要文档保持同阶段一致。发生问题在已授权范围内修复或停止汇报；不重写已有历史，不清理其他会话改动，不安装或同步个人环境。
