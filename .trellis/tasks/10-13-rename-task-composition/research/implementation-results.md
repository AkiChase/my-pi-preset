# 入口重命名实施结果

## 授权与前置

用户已明确批准按顺序完成 Beautify 与本任务，无需逐项再审批。主会话提供前置独立 check 47ea 通过的 strict/full 583/583 与 natural 583/583 证据，并已将本任务启动为 in_progress。本 agent 不执行生命周期管理。

实施开始时 checkout 存在 Beautify 前置未提交改动、4 个 `.pi` 集成修改与其他 UI 规划任务；全部保留。未改前置任务历史规划/研究、内部 child-context、后端执行、Down 或生命周期实现。

## 本任务新增 diff

相对于本 agent 开始时的 live checkout，而非 HEAD：

- `extensions/bash-unified.ts` → `extensions/task-composition.ts`；源码唯一内容变化是 default local factory `bashUnified` → `taskComposition`。`runInChildSessionContext` named export、imports、coordinator/lifecycle/UI owner、调用顺序、shutdown 与 Down 完全不变。
- `extensions/agent-tasks/__tests__/host-loading-smoke.mjs` 与 `extensions/beautify/__tests__/harness.mjs` 更新实际加载路径。
- `scripts/pi-manifest.test.mjs` 更新唯一新入口断言，并新增旧路径不在声明结果、旧文件不存在两项断言。
- `README.md` 更新活跃入口说明，明确旧入口删除无 shim、显式路径用户需自行迁移，manifest glob 加载者无需配置变化。
- `extensions/{agent-tasks,process-tasks}/PROVENANCE.md` 更新维护中的实际 owner 路径；没有改上游来源、版本或许可证。
- 4 个 owning specs：preset 的 repository/extension/testing guidelines 与 guides 的 cross-layer-thinking guide 更新路径；testing guide 明确实际 loader 的新入口与 named bridge。
- 本任务 `prd.md`、`design.md`、`implement.md` 更新授权、前置与实施验收状态，独立 check 留待主会话。

重命名单独 diff 见 [rename-only.diff](rename-only.diff)，基于开始实施时内存快照生成，排除 Beautify 前置 hunks。`package.json` 与扩展 glob 未在本任务变更，beautify 仍独立加载，旧入口不存在。

## 实际验证

现有 installed SDK 为 Pi 1.2.0。所有测试均使用只读解析出的 `PI_SDK_DIR` 和 `mktemp -d` 的 `PI_CODING_AGENT_DIR`，结束后删除临时配置目录；不访问个人配置，不安装另一套 SDK。

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
export PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir"
# 每次 shell 用 trap 删除 agent_dir
node --test scripts/pi-manifest.test.mjs extensions/agent-tasks/__tests__/loading.test.ts extensions/task-ui/__tests__/{editor,lifecycle,sdk-runtime}.test.ts extensions/process-tasks/__tests__/activation.test.ts extensions/beautify/__tests__/*.test.ts
pnpm check
node --test 'extensions/**/__tests__/*.test.ts' 'scripts/*.test.mjs'
python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-13-rename-task-composition
git diff --check
```

| 检查 | 结果 |
| --- | --- |
| 实际 host loader + manifest + editor/lifecycle/activation + Beautify 定向自然退出 | 77/77，0 fail/skip/cancel；约 2.49 秒 |
| `pnpm check` | strict TypeScript 通过；完整测试 583/583；约 20.46 秒（package test 含 force-exit） |
| 完整无 force-exit 自然退出 | 583/583，0 fail/skip/cancel；约 20.41 秒 |
| task context validate | implement/check JSONL 均 7 条，通过 |
| 活跃路径搜索 | 仅 README 迁移说明和 manifest 旧路径不存在的负向断言保留旧名，生产消费者无旧路径 |
| 本任务改动文档相对链接与空白 | 通过；另以全 workingtree `git diff --check` 验证 |

临时日志为 `/tmp/task-composition-focused.log`、`/tmp/task-composition-check.log`、`/tmp/task-composition-natural.log`；它们不是分发资源。

## 边界与后续

本次未运行新一轮真实 CLI/PTY、真实 input-history 包、在线模型或个人 install/sync/reload；实际 SDK loader/editor fixture 不能声称覆盖上述端到端场景。没有新增 lint 命令（项目未定义）。

未 stage/commit/push/install/sync/reload/finish/archive，未修改 4 个 `.pi` 文件或其他 task。独立 check 尚未运行，由主会话派发。本任务成套回滚仅撤销移动、local factory 名与本任务引用 hunks，不恢复 HEAD、不撤销 Beautify 前置或无关改动，也不同时留下两份入口。
