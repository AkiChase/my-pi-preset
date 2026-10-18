# Task Panel 重设计与只读 Agent 概览

## 目标
让用户在主对话中看到简洁的 Agent/workflow 运行概览，并通过一个全屏 Task Panel 浏览所有当前会话任务的树形结构、状态和有界详情。保留 FleetView 的紧凑视觉，不恢复它的独立导航系统。

## 规划授权与任务收拢
用户批准整理现有 Panel 父子任务规划，并确认滚动条常驻、概览最多五个根任务和小终端降级。最终方案呈交后，用户明确批准按三个阶段开始实施、检查及本地阶段提交。批准范围不含安装、同步、reload、push、归档或真实终端/provider 操作。

本任务成为剩余工作的唯一需求、设计、执行计划及验收入口。原 `task-panel-overview` 已解除双向父子关联，材料迁至 `merged/10-13-task-panel-overview/` 保留拆分历史，不独立实施、不再出现在根级待办列表。CLI 无 merged/cancelled 状态，故不调用会强制 completed 的 archive；原 task.json 的 planning 仅保留合并前状态，meta 记录 merged_into/disposition，不代表当前待办或产品完成。父任务 children 清空，已归档 presentation 只作为历史文档引用，其归档记录不改。

## 当前基线与前置变化
- 原先行子任务已归档至 `../archive/2026-10/10-13-task-presentation-unification/`。其最终范围收窄为主对话工具块展示、Workflow 卡片宽度/折叠、bash handling 计时与 `/task-detach` 重命名，**没有交付原计划的 Panel 共享展示接口**。以其 `implement.md` 最终记录为准；不重做已交付工作。
- `extensions/task-ui/panel.ts` 当前仍为居中双栏、即时详情和手动视口处理；`owner.ts` overlay 为 90% 宽、70% 高，尚无只读底部概览。
- 本仓 `extensions/shared/scroll-panel/{native-layout,wheel}.ts` 已由 Memory 和 Trellis Task viewer 使用，后续直接复用，不再等待邻仓或 Memory 开始实践。Task viewer 列表/详情采用 `scrollbar: "always"`。
- 前台和后台 bash 已将 description 传为 Job.name。剩余工作只核对空白回退和展示安全，不重复实现数据传递；完整命令仍由 Process TaskView.description 保留。
- Agent TaskView.title 为 alias/handle/type，description 才是委派描述；Workflow 尚未投影 meta.description。不同 kind 的标题选择不能统一成无条件 description-first，否则会把 shell 名称换回完整命令。
- 编辑器区域展示由 `extensions/shared/widget-display/` 唯一管理。旧独立前台 shell 提示仍在使用 `foreground_hint` 槽位；新概览必须通过中心声明和 client 发布，不能直接 setWidget。

## 需求

### R1：全屏单一任务浏览器
- 列表上方 Agents（含 workflow）、下方 Processes（shell、monitor），单一选择与滚动，无页签、左右分栏或内联输出。
- 同一 interaction 内切换全屏 list/detail：Enter 进入，Esc 从详情返回列表、从列表关闭。返回保留任务选择、滚动位置及折叠状态。
- 原生 overlay 使用 100% 宽高、top-left、margin 0，覆盖整个终端的对话与编辑器。打开/关闭不切换宿主 fullscreen 模式、不复制或重建编辑器，关闭恢复原焦点与文本。
- 不照搬 Task viewer 的 Ctrl+C 拦截或文档 section 导航。保留应用 select cancel 匹配、方向键/jk、Home/End、左右树操作、选中 stop/path-copy 和既有 `/tasks`/快捷入口；移除 Tab 双栏焦点切换和 PageUp/PageDown 处理/提示。

### R2：原生滚动与宿主兼容
- 列表/详情使用独立原生 ScrollView、VStack、固定 header/footer，滚动条常驻；共享 native-layout adapter 返回有界 frame，不手动 slice/updateLayout/自绘滚动条或维护重复 offsets。
- 用户接受隔离内部 layout API 的兼容风险。复用共享 adapter 的实际宿主解析与行为校验，不要求组件 class 同实例（当前宿主通过 Symbol.for 协议识别布局节点）。能力不兼容明确拒绝打开，不修改 SDK/主 layoutRoot，不回退自制方案。
- Fullscreen 通过共享 wheel bridge/公开 handleMouse 转交标准化 wheelDelta，仅正文内滚动 active ScrollView；标题、底栏和边界 wheel 也消费，防穿透。Regular 不强开鼠标捕获。
- 滚轮不改变选择；只有键盘选择变更或必要 reconciliation 才 ensure-visible，每秒刷新不拉回用户滚开的视口。返回、折叠、任务移除、内容变化及 resize 保留或收敛位置。
- 不新增任务行点击或滚动条拖动。极小终端压缩固定行，背景仍填满实际行列，不透出底层。

### R3：真实树形与终态保留
- workflow 和普通 agent 按真实 parentKey 归属，用 `├─ / └─ / │` 表达层级；不把通知批次伪造成父组，不在圆点旁加三角。
- 折叠显示后代数量，底栏按当前父行状态提示左右展开/收起；折叠包含当前选择时先移到父行，不能因 final pin 将隐藏子项重新变为孤立根行。
- 保持 orphan/cycle 容错、活跃根组保留后代、根组终态四秒，以及选中 immutable metadata/有界 final preview 保留到切换或关闭的语义。

### R4：一致状态与安全宽度
- Panel/概览统一 `●` running、`○` 非运行态，状态文字与语义色区分 starting/queued/paused/completed/failed/stopped；选中背景不改变圆点含义。不得新增 emoji 图标。
- Agent 主标题优先非空 description，回退 title/type；workflow 优先可读 description，回退 name/ID；shell/monitor 优先可读任务名称，回退命令/观察目标。完整原文留在详情，不改执行参数。
- 列表/概览保护状态、实际等待与耗时/tokens，安全处理外部 ANSI/控制字符，按终端列宽截断；详情完整换行展示标题、描述、命令和阶段文案。树深度、极窄屏及嵌套 ANSI reset 不破坏布局和连续选中背景。
- Waiting 与 Background 独立，等待来自真实 waitCount，不从 executionMode 推导；owned 不是主会话 waiting。全局解除全部等待和选中任务 stop/copy 明确分开。

### R5：输入框下方只读概览
- 通过 Widget Display 在 belowEditor 展示 agent/workflow 根任务，每项单行，耗时与 `↓ tokens` 右对齐；最多五个根任务，小终端按总高度保守缩减，并明确 hidden count。用户接受极端拥挤时宿主进一步裁剪，不能保证 hidden count/footer 始终可见；不为实际分配高度增加内部兼容接口。空态隐藏、终态短暂保留。
- 不重复铺开子任务、不求和父子 tokens；根项使用现有 stats。Agent tokens 为 input+output+cacheWrite，不含 cacheRead；resume tokens 为 lifetime，耗时为当前 run。Workflow totals 可能滞后，不修计费契约或制造全局累计。
- 不恢复 main 行、原 FleetView 的 ←/↓ 激活、键盘导航、独立 viewer 或 aboveEditor agent-widget。不拦截输入、不调用 detail、不持有 selected pin。
- Widget Display 不可用时不绕过它直接发布；任务底栏与 Panel 仍保持自身可用性。owner 持有订阅、clock/expiry 和清理，空态停止无用计时，reset/shutdown/迟到回调不复活 UI。

### R6：移除独立 shell 提示并收敛等待说明
- 删除独立前台 shell 命令/耗时及转后台快捷键两行提示，移除 hint renderer、专有状态和接线；不新增 shell widget，也不把 shell/monitor 放进 Agent 概览。
- 共享底栏/Panel 表达真实等待关系及配置驱动的全局解除入口；快捷键未绑定时使用 `/task-detach`，不恢复 `/bg` 别名。
- 保留前台/后台执行、阈值自动转后台、取消、日志、通知、结果消费、Trellis 环境隔离和共享 Process TaskSource 计时刷新。旧两秒窗口若仍影响工具输出流转，不随删除 UI 而改变执行行为。

## 非目标
- 不重写执行后端、调度、通知、取消、结果消费或 token accounting。
- 不重做已交付的主对话工具块/Workflow 卡片/handling clock，不扩改现有 `/agents` 专用查看器导航。
- 不纳入运行任务模型摘要、双向消息/blocked/resume 扩展或其他未完成任务。
- 不新增上下文百分比、compaction 统计、日志全量加载、历史任务恢复、点击/拖动或新的配置界面。
- 不修改 SDK、邻仓、个人配置或生成 Trellis runtime；不自动准备 worktree、下载依赖或执行真实 provider/终端测试。

## 验收标准
- AC1 / R1：全屏上下分区、Enter→详情、Esc→列表/关闭，返回定位和折叠保持；无旧双栏/Tab焦点/分页。
- AC2 / R1-R2：regular/fullscreen 打开/关闭、空态、小屏、主题与 resize；布局/背景满终端，关闭后编辑器焦点与原文本恢复。
- AC3 / R2：列表/详情常驻原生滚动条、固定 header/footer、窄屏/中文/ANSI 宽度正确；滚轮不改选择、刷新不拉回，变化时位置合理收敛。真实 Fullscreen 滚轮及边界不穿透单独验证，模拟不替代真实验收。
- AC4 / R3：真实多级树、折叠数量/选择、orphan/cycle、根组保留与 selected bounded final snapshot 均有回归。
- AC5 / R4：各 kind 可读标题、状态圆点、连续选择背景、等待维度和保护统计一致；详情保留完整命令及 Trellis 前缀，执行参数不改。
- AC6 / R5：只读根概览最多五项、小屏缩减/隐藏数量、空态/expiry/主题/reset/shutdown 正确；无输入拦截、detail 读取或重复统计，遵守 Widget Display 唯一发布边界。
- AC7 / R6：超过两秒的前台 shell 无独立提示，多 shell/agent/retrieval 等待只由共享 UI 说明；detach 不停止执行，共享进程耗时继续更新，无残留 widget/timer。
- AC8：定向自然退出测试、TypeScript、全量检查、独立审查、当前文档/链接/资源声明和实际宿主验证；任何未获授权/未运行项明确 NOT_RUN，不把启动 reviewer 或历史 PASS 当作验收。

## 决策与历史追溯
- 2026-10-14 批准删除独立 shell 提示，并将原全宽弹窗改为全屏列表/详情；只批准规划更新。
- 2026-10-15 批准原生连续滚动及隔离内部 layout+公开 wheel 路径，接受内部 API 风险；原邻仓参考 `../pi-trellis/.trellis/tasks/10-15-task-viewer-mouse-scroll/` 仅是技术来源，不再是执行依赖。
- 本轮用户确认常驻滚动条，与当前 Task viewer 统一；确认概览最多五根项、小终端缩减和 hidden count。
- 原 FleetView 研究见 `research/current-ui-and-fleet.md`；其中临时路径、旧标题投影及工作区状态是历史观察，不是当前依赖/验收证据。
- 当前工作区含已有 Panel 规划与其他任务修改；实施前重新核对实际归属，保留所有并行修改，特别是 lockfile 镜像清理任务，不归入本任务。
