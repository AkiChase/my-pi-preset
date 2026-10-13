# 阶段 2A：进程错误路径补修

## 范围与边界

按主会话限定委派，在已完成的阶段 2A 上修复三个已确认的错误路径，并纠正 README 配置清单。没有重新安排实施阶段，没有改 `agent-tasks`、`task-ui/coordinator.ts`／`types.ts`、composition、父 `implement.md`／进度文档、Monitor source／timer／pending，也未创建代理、提交、操作任务生命周期、安装、reload 或写个人配置。

## 复现与选择的局部边界

1. **前台 hint 错误**：原 `cleanup()` 先调用 poller stop 和 clear widget；两秒 `showBackgroundHint()` 抛错后 finally 的 clear 又抛，覆盖第一次错误并跳过 `lease.dispose()`，留下 running Job／launch wait／job controller。原 poller stop 抛错也会阻断 slot／hint 清理。
   - 现在启动接线、状态渲染、timer 和等待都在同一 `try/finally`。先 dispose 未完成且未 detach 的 launch，既有 `terminateJobSilently` 停止进程；观察 shell exit 后工具才以原错误拒绝。
   - 两秒首次 show 仍按原语义拒绝工具，不把显示失败伪装成成功。cleanup 的 poller stop、timer、slot、clear hint 分步执行，显示异常不影响剩余释放；最终 status 异常只停止 duration ticker，不覆盖执行错误／inline 结果。成功 detach／completed 不被重新停止。
2. **jobs attach 完成 toast 错误**：原 lease `onComplete` 已原子消费结果、释放 wait，随后 `ui.notify` 抛错却让 inline 结果拒绝，且后台通知已被抑制。
   - 只在这处完成 toast 周围隔离异常；原 `onComplete` 消费先于 cleanup 释放 attachCount 的顺序不动。实际 inline 成功返回，因此没有消费后漏报。取消 sibling 的 wait 仍不误发 finished toast／释放另一个 wait 的抑制。source snapshot/detail 不消费。
3. **显式后台启动错误**：`bash run_in_background=true` 与 `bash_bg` 原先在 spawn 后调用 `startBackgroundJob`，首次 status 渲染抛错时工具拒绝，但 job/controller/stall timer/retry 仍存活。
   - 两个 caller 的接线边界均捕获异常，调用既有 silent termination，等待 spawned exit，再原样抛出启动错误。保留日志和 terminal metadata；started、killed 各一次，controller／timer／donePromise／resolveDone／retry 释放，迟到 exit 不发送完成通知。

没有把上述边界推广为通用 SDK 异常策略；没有改 Monitor stop 的 silent 规则或增加 flush/收尾通知。

## 修改文件

| 文件 | 修改原因 |
| --- | --- |
| `extensions/process-tasks/tools/bash.ts` | 前台 teardown 不被显示异常饿死，保留主错误；显式后台接线失败回滚进程和 hooks |
| `extensions/process-tasks/tools/bash-bg.ts` | 生命周期／timeout 接线失败静默停止并原样拒绝 |
| `extensions/process-tasks/tools/jobs.ts` | 隔离可选完成 toast，已消费的 inline 结果保证返回 |
| `extensions/process-tasks/__tests__/error-paths.test.ts` | 实际工具入口、真实 lifecycle/coordinator、隔离 subprocess／可控 exit 的九条回归 |
| `README.md` | 仅替换配置清单的 process 行并补 task-ui 行，公共键归共享层，downOpener 仍预留／inactive |
| `extensions/process-tasks/PROVENANCE.md` | 中文记录这次局部偏离与 Monitor 不变边界 |
| 本文 | 复现、验证、范围及交接证据 |

## 旧代码失败证据

先只新增测试，再运行未修补的实际代码：

```sh
agent_dir="$(mktemp -d)"
PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/process-tasks/__tests__/error-paths.test.ts
# 删除该临时目录
```

结果 **9 项，1 pass／8 fail**，自然退出；日志 `/tmp/process-error-old-regression.log`。直接失败：show 的主错误被 clear 覆盖、poller stop 后未 clear、命令失败被最终 status 覆盖、两个后台入口 controller 未 abort、wait／terminal／sibling-cancel 的 toast 异常导致 retrieval 拒绝。clear-only 原来由 coordinator 隔离 cleanup 异常，单独这项旧代码能通过，不拿它冒充新增失败证据。

测试没有替换 start/terminate 等被测 lifecycle 函数；shell 使用隔离进程，hint 用假时钟推进 2000ms。后台 fixture 强制 `reg.lastSidebarContent = "force initial status write"`，捕获首次 status 调用时的真实 controller／donePromise，避免 diff-before-write 未触发导致假阳性。poller-stop 使用真实 streamLog 的 timer，模拟已清 timer 后 stop 抛错，验证后续清理仍执行。show+clear 断言同一 primary Error、wait/controller/foreground/timer 为零、进程已停、日志 ready 保留、没有完成消息。sibling-cancel 最终加强为两个 wait 同时存在再取消一个。

## 最终验证

所有检查使用临时 `PI_CODING_AGENT_DIR`；strict/full 使用已安装 Pi 1.1.0 SDK 的实际路径，仅读取安装路径，不下载或改个人配置。

| 命令 | 实际结果 |
| --- | --- |
| `node --test extensions/process-tasks/__tests__/error-paths.test.ts` | **9/9**，无 force-exit，自然退出；`/tmp/process-error-targeted.log` |
| `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts` | **320/320**，无 force-exit，自然退出；`/tmp/process-error-core-all.log` |
| `PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check` | 最终真实 strict + **359/359**；`/tmp/process-error-full-check-final.log`。包自带 force-exit，不用它证明资源自然退出 |
| `git diff --check` | 通过，含新增文件 whitespace 检查 |
| `python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-subagents-task-ux` | 通过，两份 JSONL 各 18 条；未改这些上下文文件 |

失败历史：第一次 `pnpm check` 因新测试 fixture 的完整 `UiContext` 类型不匹配而 strict 失败（缺 select/editor）；按同目录 fixture 的局部 `as never` SDK 测试边界修正，未弱化生产类型或改 SDK，重跑最终通过。没有碰到需要修改并行 agent 文件的 strict 错误。最终 359 包含并行阶段新增项，不等同于本修补新增数量。

## 交接与未验收

本次证明限定进程错误路径满足 AC9 的清理／文件保留、AC10 的 inline 单次交付、AC11 的配置清单所有权及 AC12 的离线／strict 检查部分。没有声称 G2 整体、跨 backend AC2/AC9、最终 Task Panel、editor Down 或真实 TUI 已验收。真实用户 TUI／reload 未执行；主会话应检查本次实际文件差异，结合并行 2B 结果决定阶段 gate，不由本 agent 标 ready／提交／finish。
