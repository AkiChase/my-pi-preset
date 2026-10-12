# Monitor 与 bash 的 stdout/stderr 对齐

## 已确认的需求变更

用户要求命令 monitor 默认处理方式与 bash 对齐：stdout 和 stderr 都进入同一日志、不标来源，两个流的完整行都进入合并通知并算活动。stderr 内容本身不代表命令失败；自然退出结果仍按主命令退出码或信号判断，另外保留源／日志错误的失败处理。

这项决定取代原方案中“stderr 单独保存、不算活动、合流不在本次范围”的约定。历史 original-plan 和旧研究仍保留为证据，不能据此恢复旧规则。不加合流开关、严重度分类或旧参数兼容层。

## 仓库证据

- `extensions/bg-tasks/spawn.ts`：未传 errPath 时，stderr 的 fd 等于 stdout 日志 fd；共享 bash 各模式因此默认合并。不标来源、不靠 stderr 内容判退出失败。
- `extensions/bg-tasks/monitor-source.ts`：旧命令 monitor 显式传 errPath，因此例外地分开捕获，只有 stdout 日志进入 follower。这正是本次要取消的例外。
- 合并是工具接收端的输出收集，不改变 shell 内部管道。`command | grep pattern` 的 stderr 绕过 grep，但仍被工具收到；`command 2>&1 | grep pattern` 才把两个流送入 grep。

## 最小实现选择

monitor 专用 spawn 的 stdout 和 stderr 都使用 Node pipe；各自收到原始 Buffer 后按扩展观察到的回调顺序写入同一个 `.log`，使用同一 session 缓冲和通知出口。共享 bash 的 direct-file spawn 保持不变。

两个输入流分别保留有界的 UTF-8 decoder／未完成行状态，避免一个流的部分行与另一个流的内容被错误拼成同一条活动。完成行不携带来源标签；活动时间在该流完整行到达时记录，所有活动重置同一静默计时器。用户显式 `2>&1` 后会由 shell 自行形成一个流，工具仍按实际收到的管道解析。

不为了让两个流共享内核 pipe 重写用户命令、加入 eval、嵌套 shell 或 tee 辅助进程。这些方式会扩大命令执行边界；两管道写同一日志满足默认收集／通知对齐，不承诺与 bash 共享 file fd 的跨流字节顺序完全相同。

日志记录收到的原始 bytes，不人为增加换行或来源标签；跨流片段可像 bash 合并输出一样交错。通知按各流完整行到达合并，不承诺正文与日志跨流字节排列相同，也不把接收顺序当成程序事件发生的严格时间顺序。

主 shell exit 时两个流都停止普通活动、同步读取各自 Node 已缓冲 bytes 并加入日志／收尾，随后关闭两条 pipe。任一流未结束时统一说明后续输出可能未记录，不等待任何 EOF，不添加排空时限。两个流最终未换行片段均只进入收尾，跨流最终读取顺序不作保证。

## 验证重点

- 只输出 stderr、退出 0：有进度，能阻止／解除静默提醒，最终 completed。
- stdout 与 stderr 同时输出：同一日志／通知，不打来源标签；不要求跨流固定顺序。
- 两流各自分块 UTF-8 和部分行：不串行、不错误拼接字符，内存均有界。
- `command | grep` 中被过滤 stdout 不出现，绕过过滤的 stderr 仍出现；显式 `2>&1 | grep` 后被过滤 stderr 不出现。
- 显式 shell 分别重定向到文件仍生效，工具不强行截获已重定向流。
- 只有 stderr 增长也计入共享 `maxLogBytes`；通知省略的 stderr 仍算活动。
- exit／显式 stop／截止／日志保护清理两个流及 decoder，无新尾批或迟到通知。
- 后续 subagents-task-ux 接入时沿用合流后的单 logPath 和相同 Job/stop 契约，不新增 errPath 或依赖来源分类。
