# 独立审查发现与修复要求

## 结果

只读 trellis-check `fa03e0b2-e897-450` 完成审查，定向测试 155/155 通过，但额外复现发现三项需修复问题。主会话使用临时日志目录、假源和内存缓冲分别重现了三项，因此不把测试全绿当作交付完成。

## 1. 启动后接线抛错导致资源残留（AC18）

位置：`monitor-session.ts` 的 `startBackgroundJob` 和随后 abort 监听安装，`tools/monitor.ts` 启动 catch。

`startBackgroundJob` 创建 job abort、日志检查 timer 后会 renderSidebar。若 UI setStatus 同步抛错，调用没有返回，monitor 清理监听尚未安装，工具只删 registry 和减 started。主会话复现：`source stops=0, registered aborts=1, jobs=0`。

修复须在 monitor 自己的启动异常路径中清理源、进程组、timer、abort/completion runtime references，再把异常交回工具回滚注册表。不依赖尚未返回的 startBackgroundJob，不为异常路径产生结束通知，不改变 shell 常规启动协议。

测试包含 UI 接线失败后无注册/控制器/源/fd/timer 残留，以及迟到源回调不发送消息。清理使用共享生命周期能力，不引入第二套通用 rollback 框架。

## 2. null/undefined 通知异常被误归为源失败（AC10）

位置：`monitor-session.ts` 的 emit catch、`notify.ts` 的 sendTaskNotification catch。

`(err as Error).message` 没有运行时校验，通知 sink 抛 null/undefined 时 catch 再抛 TypeError。命令源 receive 包裹 sink 调用，随后把这次异常当成 log/pipe 错误，停止源。主会话直接对 null sink 调用 event 已复现 TypeError；reviewer 还用假双 pipe 复现源失败。

修复安全转换 unknown（例如 `err instanceof Error ? err.message || String(err) : String(err)`），确保 progress 和 terminal 出口都不因 null/undefined 再抛，不停止源、不错误标记结果已告知。无需新 retry/error framework。覆盖 progress/absent/resumed/terminal 及自动截止收尾抛 null/undefined 的回归，至少证明真实源接收路径不误失败。

这是注入错误路径，不声称当前 Pi SDK 会抛 null；目标是出口的错误隔离契约完整。

## 3. 预览二次合并的零预算分类错误（AC12）

位置：`monitor-buffer.ts` addLine 的零预算判断与 add(preview)。

合法 50 行/200 字符上限下，先合并空消息，再合并 `x.repeat(198) + '\n😀'` 的 source preview：实际得到 3 个显示行、omittedLines=0、truncatedLines=1；直接原文前缀应是 2 个显示行、omittedLines=1、truncatedLines=0。

第二次合并收到 text 为空、missingChars=2 的行，不能认为“空行无预算也可接纳”。零预算条件同时检查 missingChars；保持真实空行与完全省略非空行的区别。增加直接摄入与 preview 再合并等价回归，省略字符数准确、前缀封闭、Unicode 不拆代理对。

## 修复与复验状态

三项问题已由 `trellis-implement` `ed53d7e5-a519-433` 定向修复，新增 13 项回归。主会话直接核对修复代码并重跑独立全量检查。

只读 reviewer `27f159d8-f0d1-46b` 确认三项产品修复有效、未发现已确认残留产品缺陷，但指出 deadline 异常测试实际被 oversize 抢先触发。主会话只修测试：deadline 分支使用正常日志上限、oversize 保留超限日志；捕获所有尝试提交的正文并断言 timeout 或 log-size 原因，验证 999 毫秒仍 running、1000 毫秒才停止。attach 抑制分支独立配置并断言没有多余提交。

修后 monitor-session 33/33，`pnpm check` 325/325，bg-tasks＋manifest 不带 force-exit 308/308 全部通过。窄范围只读 reviewer `5c203cda-58c0-43d` 已完成最后复查：deadline/oversize 定向 11/11，路径区分有效，无剩余发现。三项原问题与测试缺口已闭合，ready to finish；未提交、finish 或 archive。
