# 主会话复核与独立审查

## 主会话已完成的验证

实现子 Agent 完成后，主会话读取实际代码差异、新增的 buffer/source/session、工具参数、消息载荷及共享生命周期修改，不只依据子 Agent 总结判断。

- 原共享 shell `spawn.ts`、任务面板交互、快捷键/input、注册表、manifest 未修改；monitor 内部 helper 保持嵌套，不新增自动加载入口。
- 对新增的 typed monitor 载荷、共享 `handleOversize`、双流 source 和 Job 状态／结果标记边界进行了直接阅读。
- 新增中文 [monitor-contract.md](../../spec/preset/monitor-contract.md)，并由 preset 索引和扩展规范链接，记录可迁移的接口、验证矩阵和错误／正确例子。该规范不替代独立实现审查；如审查发现问题，同步调整实现与规范。
- 直接阅读发现 `types.ts` 的投递常量注释仍称 monitor 被动、不唤醒；已作注释修正，明确 monitor 使用 steer，Pi 1.1.0 接收边界为整批 assistant 工具结束后。常量及执行逻辑未改变。

## 独立重跑结果

后台任务 `bn76ziadn`，日志 `/tmp/pi-bg/bn76ziadn.log`。使用已有 SDK、临时 `PI_CODING_AGENT_DIR`，与实现 Agent 的运行独立：

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 严格 typecheck 通过；312 tests / 77 suites，312 pass，0 fail/cancelled/skipped |
| `node --test extensions/bg-tasks/__tests__/*.test.ts scripts/pi-manifest.test.mjs` | 不带 force-exit；295 tests / 72 suites，295 pass，0 fail/cancelled/skipped，正常退出 |
| task 上下文校验 | 新规范加入后两份清单各 12 条，全部通过 |
| `git diff --check` | 通过 |
| 新规范相对链接检查 | 通过 |

不以 Node 单元测试替代真实 Agent 多条唤醒的端到端体验，也不承诺独立回复或发送端事件顺序。

## 独立代码审查状态

只读 `trellis-check` `fa03e0b2-e897-450` 已完成：常规定向测试不带 force-exit，155/155 通过；额外实验发现启动异常清理、null/undefined 通知错误隔离、Unicode 二次合并省略分类三项缺陷。主会话分别复现全部问题，详见 [review-findings.md](review-findings.md)。

已派 `trellis-implement` `ed53d7e5-a519-433` 完成三项定向修复和 13 个新增回归；主会话直接核对 startup catch 清理、unknown 异常转换及 missingChars 判断，并重跑检查。只读 reviewer `27f159d8-f0d1-46b` 确认三项原产品缺陷已修复，未发现已确认残留产品缺陷；发现自动截止异常回归被初始日志超限抢先触发，要求补齐真实截止路径。

## 修复后的主会话独立检查

后台任务 `bdjvpgkoo`，日志 `/tmp/pi-bg/bdjvpgkoo.log`，复用已有 SDK、临时 agent 配置：

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 严格 typecheck 通过；325 tests / 77 suites，325 pass，0 fail/cancelled/skipped |
| bg-tasks 全部测试＋manifest | 不带 force-exit；308 tests / 72 suites，308 pass，0 fail/cancelled/skipped，正常退出 |
| task 上下文、spec/task 文档链接、格式 | 通过，两份清单各 12 条 |
| 保护边界 | shell spawn、panel、registry、input、shortcuts、依赖和加载 manifest 没有产品改动；后续 task 保持 planning |

## 截止测试覆盖修复后的检查

主会话只修改 `monitor-session.test.ts`：deadline 测试的日志低于上限，oversize 测试不加总截止；捕获抛错前提交正文，断言停止原因为 timeout 或 log-size，不能被另一条路径代替。attach 抑制也采用各自独立触发条件。更新规范中的测试防串路要求，不改变产品逻辑。

后台任务 `bs8usyid8`，日志 `/tmp/pi-bg/bs8usyid8.log`：

- monitor-session 全部测试：33/33，不带 force-exit，正常退出。
- `pnpm check`：325/325，strict typecheck 通过。
- bg-tasks＋manifest 不带 force-exit：308/308，正常退出。
- 上下文清单各 12 条，格式校验通过。

最后一项只读覆盖复查 `5c203cda-58c0-43d` 已通过，无剩余发现。独立运行 `--test-name-pattern='deadline|oversize'` 为 11/11，不带 force-exit，正常退出；确认移除 deadline 时截止用例不能由 oversize 代替通过。未做修改式 mutation 测试。

## 最终结论

首次三项产品缺陷和后续测试覆盖缺口均已修复、独立核实。当前 19 条验收的离线实现与测试通过，代码 ready to finish；真实 Agent 回复／真实网络 WebSocket 未作端到端体验验证，不承诺端到端送达或每条事件独立回复。

未提交、finish 或 archive，当前任务仍为 `in_progress`。后续 task 的规划可能由另一会话继续更新，本会话没有修改其文件；实施顺序仍为先当前 monitor，再后续 subagents-task-ux。
