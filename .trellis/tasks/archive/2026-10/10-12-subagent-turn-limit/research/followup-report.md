# 轮次冻结后续实现与验证

## 范围与复核结论修正

用户明确确认不存在历史定时任务数据；`check-report.md` 的第 2 项及“先确认历史兼容决策”的建议已不适用。本次不增加迁移、来源标记或兼容策略，可信 ScheduleStore JSON 格式与 scheduler/RPC 接口保持不变。README 删除该历史警告，仍说明可信程序入口和用户配置能力。

## 局部修复

- `extensions/agent-tasks/src/agent-manager.ts`：新建 admission 只解析一次有效上限，record／invocation 共用该值；new runner 接收 `record.maxTurns ?? 0`，避免 async env/reload/create/bind 后以 undefined 重读配置。resume admission 仍按当前用户配置与存储类型重新解析本次上限，实际 resume runner 同样接收明确的 `0` 无限。
- `agent-runner.ts` 已检查：new 的 resolver 使用 nullish fallback，显式 `0` 会规范化为无限但不会回读默认值；resume 只 normalize 入参，不回读配置，计数与软／硬限额代码无需修改。展示层仍使用 undefined 表示无上限，不显示误导性的 `≤0`。
- `__tests__/runner-cancellation.test.ts`：复用现有 typed env/loader/create seam 和 delayed bind fixture，执行实际 manager + runAgent/resumeAgent；新增有限 `2 → 3` 与无限 `undefined → 3` 两例。检查真实 steer 发生轮次、record／invocation／source／完成 callback、new/resume runtime 入参，以及订阅释放；resume seam 在真实 resume 前再次改默认值为 9，验证本次预算不变。
- `__tests__/tool-waits.test.ts`：仅更新 runtime 无限断言为 `0`，用户／frontmatter 显示、通知和 source 仍断言 undefined。已有实际根／嵌套／schedule／RPC 回归继续执行。
- `README.md`、`extensions/agent-tasks/PROVENANCE.md`：说明每次运行冻结有效上限及 delayed bind 回归；移除历史 schedule 警告，不增加机制。

## 红绿证据

所有验证在当前 worktree 执行。只读 SDK 路径来自现有 `node_modules/@earendil-works/pi-coding-agent` realpath 的上两级；每条命令创建独立临时 `PI_CODING_AGENT_DIR` 并在结束后删除。未读取／写入个人配置，未运行模型、真实 git、安装或网络。

公共前缀：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
# 下列命令均传 PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir"
# 保存退出码后 rm -rf "$agent_dir"
```

| 命令 | 实际结果 | 原始日志 |
| --- | --- | --- |
| `node --test --test-name-pattern='freezes .* turns across' extensions/agent-tasks/__tests__/runner-cancellation.test.ts`（修复前） | 0/2，exit 1；有限实际 steerAt=3 而预期2；无限实际 steer=1 而预期0 | `followup-red.log` |
| `node --test extensions/agent-tasks/__tests__/{runner-cancellation,backend-waits,tool-waits}.test.ts`（修复后） | 91/91，exit 0，自然退出 | `followup-focused.log` |
| `node --test extensions/agent-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/pretty-compat/__tests__/*.test.ts` | 509/509，exit 0，无 force-exit，自然退出 | `followup-natural-exit.log` |
| `pnpm check` | strict typecheck通过，531/531，exit 0 | `followup-check.log` |
| `git diff --check` | exit 0 | 无输出 |

完整项目脚本仍使用已有 `--test-force-exit`，自然退出证据来自单独的两条 node 命令，不混淆。日志中的故障注入诊断／SDK experimental warning 不等于测试失败，最终计数均为 fail 0。

## 验收与交接

模型两处 schema 删除／旧参数忽略、模型 schedule 不持久化预算、用户 global/frontmatter（含0）和可信 scheduler/RPC 保留、new/resume/嵌套 source／通知有效值一致的既有回归均通过；本次新增实际 runner 回归关闭确认的 per-run 漂移问题。执行代码保持默认无限及原软／硬限额行为。

计划1–5按局部后续修复执行。计划6独立检查、计划7规范更新／提交／合并仍归主会话，本代理按用户约束不派发其他代理、不提交、不合并、不运行任务生命周期、不修改个人安装或其他 worktree。没有新配置系统或历史处理。尚未做独立二次审查、真实在线模型／TUI验证；离线结果不宣称覆盖这些范围。主会话可据此安排独立复核。
