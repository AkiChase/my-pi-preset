# 入口重命名独立检查结果

## 范围与结论

按 `rename-only.diff` 审查 11 个产品／规范文件，并读取本任务 check.jsonl、PRD、design、implement 与研究材料；同时核对 live checkout 的实际入口、加载测试与文档。未提供 committed Review base，因此不审查已提交历史；HEAD 全量 diff 中 Beautify 前置与 4 个 `.pi` 修改不归入本任务。

未发现需要修复的重命名问题，未修改产品代码或前置 hunks。

- supplied rename 基线中入口源码只有 default local factory `bashUnified` → `taskComposition` 变更。live `extensions/task-composition.ts` 保留同一 `runInChildSessionContext` named export、唯一 coordinator/lifecycle/UI owner、后端调用顺序、shutdown 和 Down 接线；没有引入 beautify。
- 旧 `extensions/bash-unified.ts` 实际不存在，无 shim；`package.json` 仍为 `extensions/*.ts`。manifest 测试断言新入口一次、旧入口不被发现且文件不存在，beautify 仍独立一次。
- actual host loader 和 Beautify editor harness 已迁移实际 import。loader 通过 named bridge 驱动同／不同 cwd、重建 loader graph、异步嵌套 child 与并行 root，保留 root/child 单一注册和 registry shutdown 断言。
- 活跃 `extensions`、`scripts`、README 与 `.trellis/spec` 搜索旧名，仅剩 README 显式路径迁移说明和 manifest 两项负向断言。内部 child-context 无需迁移；没有批量修改历史任务。
- README、两份 provenance 与四份 owning specs 的当前路径一致；本任务及相关维护文档共 12 份的本地相对链接／行尾空白检查通过。

## 独立实际验证

使用已有 Pi SDK **1.2.0**，只读解析 SDK 路径，每轮统一设置 `PI_SDK_DIR` 与 `mktemp -d` 的 `PI_CODING_AGENT_DIR`，finally 删除临时 agent 目录。命令：

```sh
node --test scripts/pi-manifest.test.mjs extensions/agent-tasks/__tests__/loading.test.ts extensions/task-ui/__tests__/{editor,lifecycle,sdk-runtime}.test.ts extensions/process-tasks/__tests__/activation.test.ts extensions/beautify/__tests__/*.test.ts
pnpm check
node --test 'extensions/**/__tests__/*.test.ts' 'scripts/*.test.mjs'
python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-13-rename-task-composition
git diff --check
```

| 验证 | 本次结果 |
| --- | --- |
| focused actual loader／manifest／editor／lifecycle／activation／Beautify，无 force-exit | 77/77，0 fail/skip/cancel，2.38 秒 |
| `pnpm check` | strict TypeScript 通过；完整测试 583/583，0 fail/skip/cancel，测试 20.42 秒；package test 含 force-exit |
| 完整自然退出，无 force-exit | 583/583，0 fail/skip/cancel，19.77 秒 |
| task context validate | implement/check JSONL 各 7 条，通过 |
| live workingtree diff-check | 通过 |
| 本地链接／文档空白与旧路径检查 | 通过 |
| Lint | 项目未定义独立 lint 命令，未运行 |

日志：`/tmp/task-composition-independent-{focused,check,natural}.log`。

## 未覆盖边界

没有运行真实 CLI/PTY、真实 input-history 包或在线模型，actual SDK loader/editor fixture 不代表这些端到端场景已验收。没有个人配置写入、install/sync/reload、stage/commit/push、finish/archive；没有改无关文件。本报告不将前置行为差异解释为本次 rename 变化。
