# 已确认决策与规划边界

本文以用户本轮确认的产品选择为准；早期研究中尚未解决的条目由 [PRD](../prd.md) 覆盖。技术名、代码路径和历史锚点不改写。

## 已确认

1. 不合并执行引擎；采用一个任务面板，后台进程、monitor、agent、workflow 分类型呈现。
2. 模块命名 `process-tasks`、`agent-tasks`、`task-ui`。这是 preset 内的代码，不需要发布三个包。
3. 面板包括前台/后台/排队任务，打开不会解除等待；「等待已在后台运行的任务」不等于「前台执行」。任意 read/edit/提问工具不加入任务列表。
4. `Ctrl+Shift+B` / `/bg` 显式解除所有前台等待，运行实例继续。agent 无定时转后台，bash 超时转后台不变。
5. 普通用户消息不触发转后台，移除旧 bg-tasks 的输入转后台/abort/resubmit 路径。Pi 原生消息调度保持所有权。
6. 主会话 Esc 中断真正前台执行会停止它；取消后台任务的等待只结束等待。面板 Esc 关闭面板，x 停止选中对象。
7. 会话替换/关闭停止自有旧执行（含进程、monitor、队列、workflow worker、子任务、延迟启动），保留文件、不自动恢复、不向新会话交付旧事件。3B2 后用户明确选择方案 1：普通 agent 保留进程内架构，对不响应取消的第三方 provider/create/shutdown hook 采用取消请求、有界等待、旧接口/通知封口与迟到 cleanup owner 保留，不保证强杀或阻止其内部写入；自有可终止资源不豁免。
8. workflow 默认展开，面板内可收起；选择即显示详情，无第二个菜单/弹窗。workflow 活跃期间保留已完成子 agent，整体完成后统一进入终态展示窗口；当前详情仍保留。
9. 移除上方 AgentWidget、下方 FleetView 和旧设置，不提供可选旧模式。
10. 空输入框、有可查看任务、编辑器持有焦点时，Down 打开任务面板；前台-only 也可打开。默认显式键仍是 Shift+Down，不是 Shift+J；其他 UI/普通文本编辑不得受影响。
11. 不需要兼容旧名。配置采用 process-tasks.json / agent-tasks.json / task-ui.json，进程环境变量 PROCESS_TASKS_*。/tasks 取代 /bg-list；保留仍准确的 /bg、/agents 和工具名，不因目录对称随意改名。
12. 保留非旧概览 UI 的有用 agent/workflow 能力，不将「无需兼容旧接口」理解为「可以删除调度/steering/resume 等能力」。

## 技术策略（已批准，按阶段验证）

- 采用现有四秒终态展示窗口；workflow 子结果按父 run 生命周期保留。展示过滤不等同于会话/结果回收，不允许吞未消费结果。
- 独立 agent 的嵌套工作按真实父子关系呈现；workflow、父 agent、子 agent 的停止范围和通知来源须显式标识。
- task-ui 只协调 UI、入口和等待，后端保有所有可变会话/进程控制状态；适配器返回不可变读模型和有限能力。
- 运行中的前台 agent 转后台不应因后台池满而停掉/重启任务；应在不损坏并发记账的前提下让已运行工作继续，后台后续 admission 按限制等待。排队前台任务转后台需独立处理其排队归属。
- basename/命令直接改为规范名，不做自动用户目录迁移。实施之后如需更新本机配置和安装来源，应单独取得用户对实际操作的授权，不用真实状态变更代替测试。

## 当前技术风险

loader 和 worker 在源 TypeScript 下的运行一致性；可解除的队列/启动/运行/foreground resume 取消关联；同一完成与 detach 竞争；焦点安全的 Down 监听；跨会话晚到异步活动；workflow 用户停止与自动 retry 竞争。设计/实施计划必须为这些风险提供验证门，不得声称虚拟 TS 检查已证明实际运行。

## 范围控制

独立 `.trellis/tasks/10-12-monitor-wake/` 拥有 monitor wake/batching/inactivity 等语义，本任务不接管该需求。monitor 的注册/配置路径可能因 process-tasks 改名机械变化，必须保留其逻辑且与相邻工作协调。

任务处于 in_progress；vendor、共享等待、生命周期、核心面板与 Down 均已实施，独立审查发现已关闭。最终自动 strict/full 483/483、三模块 461/461 自然退出与授权隔离真实 PTY 19 项核心检查通过；详见 [final-acceptance.md](final-acceptance.md)。当前只整理提交范围，不重做开发／测试矩阵，不自动提交、归档或修改日常 Pi 的个人配置和安装。早期阶段的待实施／待审查记录是历史证据，不再代表当前状态。
