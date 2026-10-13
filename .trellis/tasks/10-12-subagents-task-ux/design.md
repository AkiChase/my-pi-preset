# 技术设计

## 1. 最小行为差距与变更边界

当前进程和 agent 各自拥有任务 UI/控制逻辑；进程可解除前台等待，agent 不可，且二者对输入和会话替换的处理不同。目标是统一当前会话的可查看任务和前台等待控制，执行引擎继续各自管理。

必要改动：

- `extensions/bg-tasks/` → `extensions/process-tasks/`：模块改名，暴露任务源适配器，覆盖前台可见性、输入触发 handoff 移除；进程执行/日志/monitor 逻辑不做无关重写。
- 新 `extensions/agent-tasks/`：完整 vendor 运行源码，归一化可解除等待、foreground resume、会话取消和任务源读模型；移除旧 widget/fleet。
- 新 `extensions/task-ui/`：任务源合并、唯一快捷键/命令入口、wait registry、共享 panel、footer、条件 Down 监听和 UI 生命周期。
- 顶层 composition：保留 `bash-unified.ts` 对 pretty 的单一 bash 注入，向两个后端传入同一个 coordinator。nested helpers 不单独声明为扩展；不要依赖扩展加载先后和进程级 globalThis 搜寻共享 state。
- `package.json`/lock、`pi-preset.json`、manifest/sync regression、README 和相关 spec：依赖、加载/冲突、配置/名称同步。

不改通用 pi SDK，不将 task-ui 变成全部工具管理器，不接管 monitor-wake 的 batching/唤醒语义。

## 2. 架构与加载

```text
preset 顶层 composition（每个根会话一份）
  ├─ process-tasks ── bash / bash_bg / jobs / monitor
  │     └─ pretty 注入：只保留一个最终 bash 注册
  ├─ agent-tasks ──── Agent / SubagentWorkflow / result / steering
  └─ task-ui ──────── /tasks /bg、共享键位、footer、panel、wait 协调
        ↑ adapters 返回任务快照和有限控制能力
```

实施采用现有 `bash-unified.ts` 作为唯一 composition owner，而非两个 standalone 扩展分别实例化 task-ui；顶层入口名称保持，不增加第二个发现入口。其他 pretty 工具继续原样注册。

完整 vendor 保留 `src` 所需辅助文件及 worker bootstrap。运行通过 pi 的 TS loader，没有新 build/dist 维护路径。`.js` specifier、Node strip TS 和 worker loader 是明确风险，必须先做真实导入及 worker 单元 smoke，必要时将引用规范为本仓库可加载的 `.ts` 或用有文档的局部 loader。不得通过 `any`/忽略 strict 来掩盖运行错误。

运行依赖 `croner`、`nanoid` 放 dependencies，SDK peers 由 host 提供。TypeBox/SDK 开发检查需要实际可解析的本机 SDK 链接或开发依赖，不能假定 npm 装 standalone agent 包会帮本 preset 提供依赖。

## 3. 任务源契约

Task source 是会话 owned adapter，不是执行状态的第二份注册表。概念读模型：

- `sourceId` + `taskId` + `runId`：进程/agent/workflow 不碰撞；resume 同一 agent 的不同 run 不混用旧等待/结果。
- `parentKey`、`kind`、标题/说明、开始/完成时间、状态（starting/queued/running/paused/completed/failed/stopped）。
- `executionMode`（foreground/background/owned）和 `waitState`（是否有主会话等待）分开。
- 统计、可复制 artifact 路径、可用操作和版本号；只保留显示元数据快照。
- 可查询 list/detail，订阅变化，打开 scoped detail 内容源，停止明确 task ownership，必要时发 steering/调用高级管理。

控制器、promises、mutable AgentRecord/Job、child session 仍在 backend。不可变快照不意味着一次复制整个 transcript；detail 使用有界内容源和 scoped subscription。adapter 销毁使所有旧通知/读源无效。

UI 不将 queued/no-session 任务隐藏：展示等待/启动状态和“对话尚未建立”，避免误以为没有任务。workflow child 与 nested agent 根据 owner hierarchy 展示，不在顶层重复出现。

## 4. 等待协调与 detach

Task-ui 拥有 foreground wait registry；后端注册某个 `task/run` 的 wait handle。每个 handle 区分：

1. 完成：返回 inline 结果并消费对应结果。
2. detach：返回原 task/run ID，解除等待但继续执行；不 abort 当前 turn，不创建新的子会话。
3. interruption：真正前台执行调用其停止能力；wait-only retrieval 仅解除等待。

`/bg` / Ctrl+Shift+B 对所有当前 handle 请求 detach，包括 bash、Agent、jobs attach 和 get_subagent_result 的结果等待。多次请求幂等，完成与 detach 竞争只能赢一次；无 handle 时只显示准确提示。

Agent backend 需要统一 queue → startup → running → settled 的 per-run promise 和 cancellation ownership：

- queue parent listener 必须可注销；不能保留现有匿名队列 listener 再仅注销 running listener。
- parent abort link 在 detach 之前负责 stop；detach 必须取消 queue/start/run 的全部关联，后端 child controller 仍用于面板 x/会话关闭。
- worktree 启动阶段仍可解除等待；启动成功/失败由同一 task 生命周期报告，不错误返回“已完成”。
- foreground resume 使用和新 run 一致的 controller、promise、活动、转后台和消费规则，而非旧 inline-only resume 分支。
- detach 后 tool finally 只释放自己拥有的 inline renderer/timer，不删除仍在运行的后端 activity/transcript。

并发池与 execution mode 不能用同一个 bool 推导。已经开始的前台工作转后台必须继续；后台容量已满时允许现有 run 占用持续 slot，使后续新 admission 等待，不能停掉或重启该 run。排队前台 task 转后台则迁移 admission 归属；原队列 gate 和计数释放幂等。若实际池实现更复杂，在 G2 前补充状态表，不绕过限制制造幽灵计数。

普通输入事件不参与此 registry：移除 process-tasks 旧 input interception，保留 Pi 原生消息机制。定向 agent mention/steering 由 agent backend 正常路由，不因普通提交而自动 detach。

## 5. UI、分组与展示保留

一个双栏 overlay：左侧树形任务列表，右侧详情。选择更新立即生效，Tab 切换焦点，箭头/jk/PgUp/PgDn 导航或滚动，Esc 关闭，c 复制文件路径，x 停止选定活动对象。普通查看不改变等待。

- 左列表默认 workflow 展开，普通 nested agent 也按父子关系展示；Left/Right 仅作用于列表焦点。
- expansion 与 selection 用稳定 identity，不使用瞬时 row index 存长期选择；新组默认展开，刷新不覆盖用户收起。
- workflow selected detail 展示真实 metadata/phases/progress；child detail 展示 live conversation，未创建 session 时展示 starting/queued。
- 普通常规对话详情复用source的有界transcript/内存文本内容，不完整移植旧Markdownrenderer，也不嵌入旧viewer的整页chrome/steeringfocus；高级conversationviewer与workflowcontrols保留 `/agents` 管理路径。核心详情选择即看，无第二层弹窗；富文本保留范围如实说明。
- 四秒终态窗口用于独立 task 或整个父组；活跃 workflow 的 child completion 不单独被该窗口剔除。选中的最终 metadata/detail artifact 由本次 panel 保留，关闭或换选项才释放。
- 视觉保留不等于结果消费或后端 session 回收。进程原十分钟 metadata sweep 保持；agent/workflow 必须延后清理活跃 owner 所需 child 结果、未消费结果、explicit resume 所需记录，避免统一成进程 TTL 后丢能力。
- footer 分类显示真实 task/monitor/agent/workflow 活动数量，不把 group+children全部重复记成独立 work。模式/等待详情放面板，不让 footer挤占对话空间。

## 6. 条件 Down 与焦点安全

采用编辑器本地 input decorator，不用 registerShortcut("down") 抢内置 editor 导航，也不再维护上游 FleetView 那种全局 terminal-input 导航监听。当前 SDK 提供 `getEditorComponent`/`setEditorComponent`（types.d.ts:175–177），Editor 提供 focused 属性（pi-tui editor.d.ts:36）；原 CustomEditor 的 app keybindings 和 extension shortcuts 必须通过原 handleInput 继续处理。

- 首次安装默认/自定义编辑器均保留已有liveinstance，不重新调用factory重建。通过公开 `ui.custom` 的同步完成、不挂载probe取得真实TUI；已有overlay不调用done以免关闭其他弹窗。在破坏性SDKsetter之前完成focusedliveeditor/descriptor预检与handleInput装饰，不支持的编辑器安全跳过，仍挂载/渲染/可编辑。
- Pi1.1.0对同一instance仍冗余setText/provider/appearance/callback/actionMap接线；同步handoff短暂屏蔽public重复写入，finally恢复仍owneddescriptor，保留草稿/cursor/undo/historybrowse/paste/autocomplete。后续factory正常委托predecessor并在实际返回对象上装饰，不复制privateeditingstate。
- Down press非repeat、文本严格 `=== ""`、有freshmodel可查看tasks、publiceditorfocused与TUIgetFocusedComponent身份一致、无autocomplete/可见overlay/重入开窗才处理。原 `isShowingAutocomplete` 公开方法优先，其他输入委托原handleInputreceiver。
- 关闭先清资源cell/access/screen/target并解除自己的实例lease，不通过hostsetter恢复factory重建丢state；lateropaque包装只保留退休透传，不保旧ctx/TUI/coordinator/panel（真实GC4/4）。后续不委托原factory的独立editor不保证继承Down，显式入口仍可用。

旧 FleetView 的 TUI-private focusedComponent 和 unknown-focus 放行不再复用；也不靠已移除 widget 捕获 TUI。G0/G4 必须证明公共 factory 装饰在当前 host 的实际焦点路径有效、默认编辑器和 custom editor 都保留原功能；若做不到，回到规划，不用 global input fallback 偷抢 Down。

面板持焦点时 opener 不接收输入。全局 registerShortcut 不保证在 overlay 持焦点时触发，因此面板 input 显式调用同一个 coordinator 处理配置的转后台键；不能出现“打开面板后 Ctrl+Shift+B 失效”。关闭面板和解除等待仍是两个独立动作。会话替换/关闭恢复装饰并释放订阅，按键释放事件不打开面板，原 Left 行为保持不变。

## 7. 会话生命周期与通知

Composition 创建单个 activation 的 `TaskLifecycle` 与 coordinator，两个 backend 注册 participant；Pi 1.1.0 真正换代时关闭旧 factory，再创建新 factory，不复活旧实例。关闭顺序：

1. 标记 closing/更换 epoch，冻结旧 task admission 和向外 notification。
2. 关闭 UI，释放 waits 和 input/detail subscriptions。
3. 停止 scheduler timers、pending nudges/group batch、mention clones/异步 fallback、workflow worker、queued/run/nested tasks及进程。
4. 有界 await backend 的真实执行和 child cleanup，最后封闭旧 host 副作用、注销 source；迟到清理仍有原 owner，磁盘 artifact 保留。
5. 新会话注册全新 adapter 和入口；旧异步回调检查 activation，不能向新会话 spawn 或发消息。

**用户确认的取消边界（3B2 后选择方案 1）：**普通 agent 保留进程内架构，不新增强制隔离。自有 shell/monitor、workflow worker、队列和定时启动要实际停止；正常响应取消的 provider 和 child hooks 要完成清理。对于不响应取消的第三方进程内代码，只保证发送取消、有界等待、封闭旧接口/通知并保留迟到 cleanup owner，不保证强杀或停止其内部文件写入。该例外不能用来豁免本仓库自有进程、socket、timer 或 worker 的资源泄漏。

关闭过程覆盖已完成、为 resume 保留的 child sessions：它们仍可能拥有扩展后台资源。manager 使用 `freezeAdmission → stopForShutdown → drainExecution → sealHostEffects → dispose`，不能把提前 resolve 的 terminal 当作真实执行退出，也不能以 SDK core dispose 代替扩展 shutdown hooks。协议预算后不启动新的旧 host effects；已经开始的非协作第三方 hook 仍受上述边界约束。

持久化 schedule definition、记忆和会话文件不是 executing runtime，不因停止旧任务被删；它们只有在新会话明确上下文下注册才可按计划工作。自有进程与 worker 不得在退出后继续执行；非协作第三方进程内代码的限制如上。前台 bash 已按幂等终态保留日志与 metadata，停止/切换不能删除它们；面板最后详情通过有限快照保留，不靠活跃控制器。

完成通知是后端结果所有权，task-ui 只读。fresh/foreground/resume/retrieval completion 都根据 per-run 消费状态决定 inline vs notification。detach 转换成后台结果资格；取消 wait 不永久消费；停止操作在本次 action反馈，不能将转后台错误标成 completed。workflow通知按 run owner 保留 grouping，UI 不自行复制 agent completion 消息。独立 monitor-wake 继续拥有其 stream delivery。

## 8. 配置与命令

| 所有者 | 新接口 |
| --- | --- |
| process-tasks | `process-tasks.json`、`PROCESS_TASKS_*`；进程日志/超时/monitor 配置 |
| agent-tasks | 全局 agent-dir 和项目 `.pi/agent-tasks.json`；保留 discovery/运行/调度相关配置，移除 widget/fleet/UI配置 |
| task-ui | `task-ui.json`；共用 panel/background chords、Down opener 开关和面板显示选项，defaults 明确且离线可测 |
| 公共控制 | `/tasks`、`/bg`；Shift+Down、Ctrl+Shift+B、有条件 Down |
| agent管理 | `/agents` 与 agent类型/调度/workflow管理 |
| 诊断 | 用 `/process-tasks-config`、`/process-tasks-version` 替代旧 bg-config/bg-version 名称；UI配置诊断归共享层 |

不实现旧 file/env/command fallbacks。准确的 tool names保持；old string only用于 upstream provenance、冲突包来源及变更说明，不用于执行别名。用户配置或安装来源的真实切换需要额外授权，自动测试只操作临时目录。

## 9. 风险与验证

详见 [implement.md](implement.md) G0–G4 和 PRD AC1–AC12。优先验证 loader/worker真实运行、detach parent links、queued/startup/resume/completion竞态、wait取消、session epoch、焦点-safe Down、选择快照和 workflow child stop。虚拟 typecheck仅为研究证据，不代替 pnpm check。

本文记录批准后的架构与实际实施策略；G0–G4的限定范围验证已完成。最终strict/full483/483、三模块461/461无forceexit自然退出、独立审查及隔离真实PTY19项核心交互通过。第三方协作式取消与未覆盖场景见 [final-acceptance.md](research/final-acceptance.md)，不能扩大为任意provider/插件全矩阵。当前任务保持in_progress，只整理 [commit-plan.md](commit-plan.md)，不自动提交、归档或切换日常Pi安装。
