# Bash 契约设计（规划草案）

## 已确认的说明接入

沿用 Pi 官方字段，不新增公共组装器或独立 system 区块：

- description：整体工具说明。
- promptSnippet：tools 中的一句话索引。
- promptGuidelines：一个多行 Bash usage: 条目，在 rules 中形成具名总项与缩进子项，示例集中一个子项。
- schema：字段含义、单位、范围与适用条件。
- execute：效果前校验组合，错误必须可纠正。

覆盖注册继续使用 ...originalBash 后显式设置上述字段，替换而不是追加原生指导。最终提示验证须使用真实 SDK 组装行为，并检查其他工具保留、原生指导未叠加。共同编写规范由开发 spec 承载，不需要新产品框架。

## 行为边界与所有权

最小差距：模型看到的 timeout 名称与真实前台等待后转后台行为不同；notify 暴露可关闭的后台通知且与自动后台不统一。

实际所有者：tools/bash-params.ts 拥有 schema；tools/bash.ts 拥有启动、前台等待和转后台；lifecycle.ts、notify.ts 拥有完成交付和防重复；task_manage 仅作为管理协作入口，不在本任务中改造。

目标参数为 command、description、run_in_background、background_after_seconds。阈值为正有限秒数，受 Node 定时器安全上限约束；立即后台与显式阈值互斥。移除 notify 参数。旧 timeout/notify 在 schema 和直接执行入口拒绝，不做映射；错误反馈可纠正，但不加入 prompt。

## 已确认的现状与待决策

- 非交互模式保持默认前台等待至完成；显式传 background_after_seconds 时在启动前拒绝并说明该模式不支持。此决定已获用户确认。立即后台参数仍保留，不因本决定自动扩展改造范围。
- isAutoBackgroundAllowed 仅排除首词 sleep；允许的 sleep 1.5 等会走特殊超时终止路径。这不是新阈值的正确语义，拟去掉 bash 等待计时器中的命令终止分支，保留 effects 前的固定等待拒绝机制及主动停止/退出清理。
- 显式后台当前还带特殊 sleep 超时计时器；移除该计时器，不新增硬运行期限。
- notify=false 通过 NotificationOwner=suppressed 实现；删除 bash 的可关闭通知入口，其他实际消费者须核查后才能删除共用枚举分支。
- 终态读取/wait 可标记结果已报告；主动 stop 和退出会静默结束。这些防重复和旧会话保护不能被“后台必通知”绕过。后台完成应有交付，不意味每个关闭/停止路径额外发第二条消息。
- 继承的 outputSchema 使用 exit_code=0 表示未完成的占位值；保持该兼容契约，说明中必须强调启动非成功，不在本任务中更改输出 schema。

## 预计文件

- tools/bash-params.ts、tools/bash.ts：参数、指导、前台阈值逻辑。
- lifecycle.ts：移除已无必要的 bash 特例，保留 monitor 及共享生命周期。
- process-tasks 相关测试：旧接口回归更新、新组合、通知和自然退出。
- docs/extensions/task-composition.md、process-tasks/PROVENANCE.md：现行用法及本地偏离记录；不篡改历史基线。
- .trellis/spec/development/index.md、testing/index.md：最小共同工具指导规范及最终提示验证约束。

不做：全面改造 task_manage/subagent/monitor；新提示框架；SDK 改动；安装/reload；运行时限新参数；无关 Git 变更。

## 最终实施决定

旧参数不兼容；非交互行为已确认。配置 timeoutMs 与环境变量保持现有接口，避免额外迁移。后台正常完成自动交付，保留终态结果消费、防重复、静默主动停止和会话保护。用户已授权完善文档并开始实施、迭代、check 和自动收尾。

## 最终 promptGuidelines 草案

```text
Bash usage:
  - Use bash for finite shell commands. Use monitor for ongoing event streams or per-event notifications.
  - Commands run in the foreground by default. Keep short commands in the foreground.
  - Set run_in_background=true to start in the background immediately.
  - In interactive mode, background_after_seconds controls how long to wait in the foreground before backgrounding a still-running command (default: configured seconds). It does not terminate the command. Do not combine it with run_in_background=true.
  - In non-interactive mode, foreground commands wait until completion; background_after_seconds is not supported. Background tasks remain session-owned and are stopped when the session closes.
  - Foreground completion returns a tool result; background completion sends a notification automatically unless its final result has already been delivered. Do not poll list/status merely to detect completion.
  - A background launch result means started, not successfully completed. Keep the returned task_id and run_id. Use task_manage status/output/wait/stop to inspect, read, await, or stop the bash task; do not include task_type in these targeted calls. task_manage also manages monitor, subagent, and workflow tasks.
  - Never use sleep merely to wait for a task. Use task_manage action="wait", or a condition loop that exits when ready.
  - Examples:
    Foreground: {"command":"git status --short","description":"Inspect working tree"}
    Immediate background: {"command":"npm test","run_in_background":true,"description":"Run tests"}
    Background after 10s (interactive): {"command":"npm test","background_after_seconds":10,"description":"Run tests"}
```

默认值使用实际配置动态生成；不另追加相同规则。多行 guideline 经 Pi 组装后为一个顶层条目。
