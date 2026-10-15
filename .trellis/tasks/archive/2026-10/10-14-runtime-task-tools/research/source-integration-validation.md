# 主目录整合验证（2026-10-15）

## 范围与保存

base `3bedbcc`、source已提交基线 `8158d31`、target existing `trellis/10-14-runtime-task-tools` dirty实现。99个extension路径仅应用本任务必要新接口/后端/展示/测试差异；source-only spawn-input和通知requestId/diagnostic/delivery/group改动保留；source其他插件不回退。四用户页按source当前文档组织更新，保通知专项用户说明并用task_manage读取结果。

三方冲突由主会话审查：manager imports两owner合并；PROVENANCE保两个独立成果；Beautify布局/标题测试保持target已迁相同断言；tool-waits普通Agent仅输出research合并候选，主会话核53测试声明（38共有＋11source＋4target）、无遗漏/重复、helper EventBus/RPC/entries/hostsend都保留后应用。

所有source路径写入前核HEAD及每文件source/target SHA-256，未知drift拒绝；无reset/整branchmerge/旧worktree整文件覆盖source。其他task所有存量文件指纹前后不变；无productcommit/push/install/sync/reload。

## 首败与修复

首次整合strict job `bfb4ufii1` exit2，7个TS错误：Beautify retrieval source-only追加测试被三方merge保留，但引用已删除agentContract/jobsContract/agentHeader。不是执行产品失败，也不恢复旧alias/adapter。

主会话把此追加测试迁至新task_manage已返回detail和真实名称/展开断言；原target七action×pending/terminal/expanded×width矩阵仍在，旧工具未知renderer委托负向测试仍保留。无宽度断言弱化。随后整合freshchecks全通过。

## 自动检查

```sh
agent_dir=$(mktemp -d /tmp/runtime-integrated-check2.XXXXXX)
trap 'rm -rf "$agent_dir"' EXIT
export PI_CODING_AGENT_DIR="$agent_dir"
node node_modules/typescript/bin/tsc -p tsconfig.json
node --test extensions/agent-tasks/__tests__/tool-waits.test.ts \
  extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/retrieval.test.ts
node --test 'extensions/**/__tests__/*.test.ts' 'scripts/*.test.mjs'
```

job `bq27yh362` exit0：strict PASS，focused119/119（22.91s），full773/773／72suites（24.46s），0fail/cancelled/skipped，全部自然退出无forceexit。日志 `/tmp/pi-bg/bq27yh362.log`。计数包括source当前其他已完成工作，不按target725差值虚构本任务新增数。无独立lint脚本；没有执行会link依赖的pnpmcheck。

## 真实 CLI source验证

```sh
python3 .worktree/10-14-runtime-task-tools/.trellis/tasks/10-14-runtime-task-tools/research/tmux-runtime/driver.py \
  --run --implementation-settled --label main-source-integrated --workflow --target "$PWD"
python3 .worktree/10-14-runtime-task-tools/.trellis/tasks/10-14-runtime-task-tools/research/tmux-runtime/check-background.py \
  .worktree/10-14-runtime-task-tools/.trellis/tasks/10-14-runtime-task-tools/research/tmux-runtime/evidence-main-source-integrated
```

job `boz8snhmu` exit0，functional8/8＋实际SGR逐cell8/8 PASS；实际生产扩展-e路径在source，不是旧target。矩阵与此前tmux报告一致：dark/fullscreen三width/CtrlO、typederror、bashidentity/paging/searchstats/partial/bg/final/PID、actualchild完整563char显式/继承model、monitorEscwaitstopPIDfinite、workflowreturn。所有环境temp／env-i／unique-L／offline本地provider，无个人auth或网络。完整report/raw/screens在target研究 evidence-main-source-integrated；main最终归档前保存精确报告依赖。它不覆盖nested/provider所有组合，后者actualSDK注册回归提供独立证据。
