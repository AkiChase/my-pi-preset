# 与后续 subagents-task-ux 的顺序及边界

## 执行顺序

用户明确要求：先完成本任务 `10-12-monitor-wake`，随后再做 `10-12-subagents-task-ux`。后者以本任务完成并验证后的产品代码为基线，不并行修改相同文件，也不因预期重命名提前重构当前执行层。

本任务仍为当前 active task。未启动、切换或修改后续任务的规划文件；其未决的工具／配置命名、能力兼容和子任务保留策略仍由后续任务解决。

## 后续任务的已确认范围

依据完整阅读后续 task 的 PRD 和四份研究文件（目前没有 design.md、implement.md）：

- vendor `@tintinweb/pi-subagents` 0.20.0，执行后端独立保留。
- 模块命名为 `process-tasks`、`agent-tasks`、`task-ui`；由后续任务重命名当前 `extensions/bg-tasks/`。
- 一个共享 Task Panel 和 footer，包含前台／后台／排队的进程、monitor、agent、workflow；面板通过各执行后端的 adapter 获取只读快照和控制入口。
- 共享快捷键负责释放前台等待及打开面板；空编辑器 Down 入口由后续任务提供。普通消息不再触发旧 input 拦截和隐式 detach。
- 面板 x 只停止选中任务；Esc 在面板只关闭，前台执行取消与后台结果等待取消的语义独立处理。
- 会话退出／切换停止旧任务并关闭 UI；不让迟到事件进入新会话，不复活任务，保留磁盘日志／transcript。
- 后续任务自身明确把 monitor 唤醒／合并及显式停止通知归给当前任务，不应重写这部分行为。

资料中的较早“共享面板尚未确认”等段落已经落后于其 PRD；以较新的明确决定为准。研究行号是旧实现定位，不代表后续必须恢复旧行为。

## 当前实现必须保护的接口与语义

| 边界 | 本任务约束 | 对后续任务的意义 |
| --- | --- | --- |
| 执行目录和资源加载 | 保持 `extensions/bg-tasks/` 和顶层 wrapper 的加载关系；monitor 新 helper 都在内部 | 后续整组重命名和 adapters 不需要剥离本任务偷偷新增的执行/UI 包 |
| Job 生命周期 | 保持 `kind: "monitor"`、现有运行／终态 `Job.status`、ID、pid、logPath、started/terminal 计数 | 混合列表可沿用执行状态快照；absent/resumed 是通知状态，不是新的任务运行状态 |
| 资源归属 | monitor buffer、timer、source handler 属于 session 闭包，stop/abort 幂等清理；不放在 panel 快照 | task-ui 不需读取内部调度，也不保留闭包/controller/fd |
| 显式停止 | `terminateJobSilently`、`jobs kill` 和现有 panel x 均不新增尾批／收尾；停止仍是 backend 能力 | 后续 shared panel 的 stop adapter 可调用同一入口，无需复制通知抑制和清理逻辑 |
| 通知 | 保持 `EVENT.monitorEvent`、`EVENT.taskNotification` 和 `DELIVER_STEER` 的归属；内容本身可见，不依赖面板开关 | shared task-ui 不能变成第二个通知生产者；检查/关闭面板不启动、取消或消费 monitor 通知 |
| 结果抑制 | progress/absent/resumed 不设置 `outcomeSurfaced`；terminal 仍遵守该标记及 `attachCount` | 实时通知不会使后续真正结果丢失；等待/结果工具与统一 panel 可按各自契约取用 |
| 日志与事件输入 | stdout/stderr 默认写同一 logPath，完整行都进入同一通知调度；两流 decoder／部分行保持源内部独立，不标来源 | 后续读取单日志、调用既有 stop 即可，不恢复 errPath 例外，不让 task-ui 判断 stderr 是否失败 |
| 日志保护 | 共享阈值和检查周期保留；同一日志包含两流，stderr-only 也受保护；monitor 专用回调拥有超量收尾，shell 默认路径不变 | 不形成新的 UI 锁或通用执行状态；搬到 process-tasks 时可一起迁移 |
| 终态消息 renderer | 只识别 monitor 的有类型可选载荷，保留 shell 默认渲染，不引用 BgTaskPanel/registry 私有状态 | renderer 可随执行后端迁移，不与将被删除/抽出的面板实现互相绑定 |
| 会话隔离 | 保留 registry identity／abort 检查；旧 timer、source exit、WS 回调不通知新会话 | 共享 session teardown 可统一编排执行后端，不会重新引入旧通知 |
| 配置 | 本任务只删除已批准的 monitor 旧字段，不重命名 bg-tasks.json、公用 command、shell 字段 | 后续公共命名／兼容决定仍可独立做，不与本次直接删除 monitor 旧参数混淆 |

不提前提供一个“通用 TaskProvider”框架。当前只保持可迁移的独立后端和小范围回调，后续再按其完整需求设计共享 task-ui。

## 实现与交付检查

- 当前 `ui.test.ts`、`shortcuts.test.ts`、`take-control.test.ts`、`bash-survive.test.ts`、`jobs.test.ts`、`registry.test.ts`、`index.test.ts` 的非 monitor 交互契约不变。本任务不实现后续的 Down 入口、前台面板可见性、input 拦截删除或目录命名。
- 增加 monitor 的 panel/shared-stop 回归：pending 输出和静默 timer 存在时显式 stop 仍无新消息、资源释放、迟到 exit 无效。
- 验证 progress/absent/resumed 期间 job 仍 running、结果抑制未被消费；查看／关闭现有 panel 不改变 buffer/timer/终态处理。
- 验证自然结束、显式截止、日志保护通过共享终态函数计数一次，保留期和快照字段不变。
- 本任务交付记录列出新源契约、可选 monitor 通知载荷和超量处理回调、已删除配置及新测试；后续整组改名时一并迁移，不恢复旧被动通知或 `persistent`／速率停止。
- 后续开始前重新读取本任务的最终 PRD、设计与验证记录，并更新其旧 baseline／行号。若本任务归档，使用实际 archive 路径，不依赖仍存在 active 目录。
- 原始日志观察边界（主 shell exit 即结束，不等 EOF）是已确认的执行契约，不由 shared panel 的可见性或结果等待改变。

## 范围保护

本任务只更新自己的规划和产品代码（获准后）。不替后续任务解决仍未确认的公共命名／兼容策略，不翻译或修改另一个 Agent 的 task 文件，不做 agent vendor，不动 preset 第三方包来源，也不引入重复入口／shortcut。
