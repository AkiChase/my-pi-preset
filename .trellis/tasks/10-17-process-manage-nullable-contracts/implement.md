# process_manage 执行计划

## 当前状态与授权

用户已审阅并批准实施本计划，包括 scoped local commit，不包含 push、安装、reload、历史改写或归档。用户明确 tool 参数用法只面向 Agent；本任务不修改 `docs/` 和 `.trellis/spec/`，不自动清理历史内容。

## S1：完整入口契约与调用链（单一耦合阶段）

- [ ] 实施前刷新 Git/任务状态，完整读取将改动的源码、调用方与测试，保留并行改动。
- [ ] 在 tools.ts 增加 ProcessManagementParams / parseProcessManagementParams，复用已有 shallow 控制解析 helper，保留内部 optional 类型。
- [ ] 同阶段更新 process schema、execute、validate helper、action 错误反馈和完整模型示例。
- [ ] 同阶段更新 Beautify process parser 使用；不更改结果 envelope 或生命周期。
- [ ] 添加 host/direct schema、缺字段/unknown-null、action 全矩阵、默认值与显式值、冻结输入/零 capability 调用测试。
- [ ] 迁移实际 registered tool 测试调用；保留内部 facade optional 测试及 Agent 回归。
- [ ] 验证注册工具搜索、分页、统计、wait/stop、目标 scope、partial/final 渲染与真实 SDK prompt assembler。
- [ ] 主会话自查实际 diff；独立 trellis-check 检查 schema/parser/执行/渲染一致性及回归证据。
- [ ] 修复范围内发现、重跑受影响检查，审查每个验收标准。
- [ ] 精确暂存本阶段文件并立即 scoped commit；记录 hash、命令、环境、退出码和限制。不使用 git add .；混合并行 hunk 无法安全拆分时先报告阻塞。

schema、parser、指引、renderer 和对应测试必须一起落地；不得先提交只改 schema 的不一致状态。无必要拆成多个实现阶段。

## 验证命令（计划，全部 NOT_RUN）

先通过已安装 SDK 解析路径并创建 repository-external owned 临时 run/config 目录；设 `PI_SDK_DIR` 和 `PI_CODING_AGENT_DIR`，不得读取个人配置或下载安装。原始输出保存在本 run 的临时目录；最终记录需自包含。命令结束核验自然退出及资源释放后才清理 owned 目录；诊断未解决时保留并报告。

```sh
node --test extensions/runtime-tasks/__tests__/nullable-controls.test.ts extensions/runtime-tasks/__tests__/schema-integers.test.ts extensions/runtime-tasks/__tests__/contracts.test.ts extensions/runtime-tasks/__tests__/public-process.test.ts extensions/runtime-tasks/__tests__/prompt.test.ts extensions/beautify/__tests__/retrieval.test.ts extensions/beautify/__tests__/registered-agent.test.ts
node --test extensions/runtime-tasks/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts
node --test extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts extensions/agent-tasks/__tests__/loading.test.ts
pnpm check
git diff --check
```

聚焦和集成命令不加 --test-force-exit。最终执行前确认文件存在；若实际迁移涉及其他测试，按影响补充，不缩减原有断言。pnpm check 使用项目配置的强制退出套件，不作为自然退出证据。真实在线 provider 手工验收另行由用户完成/授权，不以离线 host/schema 测试替代；本轮规划未运行任何测试。

## Dispatch 上下文与材料

建议主会话实施，因此 implement.jsonl 保持未使用。独立检查前需整理 check.jsonl，仅引用真实相关 spec/research 文档，并让 reviewer 完整读取 PRD/design/implement、workflow 和引用。

适用规范：`.trellis/spec/development/index.md`、`.trellis/spec/testing/index.md`、`.trellis/spec/guides/index.md` 与两个 thinking checklist。实施前按 before-dev/check 技能再次确认。若无实现 dispatch，approved start 使用 --allow-empty-context 处理未使用的 implement.jsonl；task validate 的空 manifest 诊断不应声称为 full PASS。

独立 reviewer 不递归 dispatch、不提交、不安装、不写 task/spec；原始输出只放其 repository-external owned 临时目录，返回简洁发现与必要临时路径。task 绑定 worktree 时遵守 managed protocol，不用临时 isolation 绕过。

## 执行记录

- 已按用户批准执行 `task.py start 10-17-process-manage-nullable-contracts --allow-empty-context`，任务进入 in_progress。未使用 implement manifest；check manifest 已整理。CLI 将当前 main 记为 task branch 并提示归档时同 base branch 不可用；本轮不归档、不改分支/历史。
- 产品变更只有 `extensions/runtime-tasks/tools.ts` 与 `extensions/beautify/tools/management.ts`；其他产品目录改动仅为注册工具测试调用迁移及回归测试。新增 test-only `process-input.ts`，不补齐产品调用。`docs/` 和 `.trellis/spec/` 无本任务 diff。
- 环境：Node v24.14.1、现有 SDK `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.3.0/node_modules`；所有测试设置 PI_SDK_DIR 与 PI_CODING_AGENT_DIR=`/tmp/process-nullable-4Jp3BR/agent`。原始日志暂存 owned `/tmp/process-nullable-4Jp3BR`，没有下载依赖。
- 首次 pnpm typecheck：exit 2，test-only envelope 返回 interface 无 index signature，无法作为 SDK JsonObject/renderer Args；给 test helper 返回类型补充标量 Record 交集。第二次 exit 2，新 prompt 测试直接访问通用 TSchema.properties；改为序列化 schema 检查。第三次 typecheck PASS，但聚焦测试 exit 1（29/30）：required 数组顺序与 helper 对象 key 顺序不同；改为集合排序比较，没有改变产品行为。
- 初版聚焦命令（implement 验证列表首条）：28/28 PASS，exit 0。扩展 coverage 后的单次字段顺序失败见上；完整新增 coverage 已由后续集成/全量覆盖。
- 首次自然退出集成（验证列表第二、第三条合并）：exit 1，642 tests，606 PASS、36 FAIL。失败均为 jobs 别名及 `.mjs` loader/log probe 的旧缺字段调用在入口被拒绝，无法触发原日志/生命周期断言；补齐这些注册工具 fixture 调用，不放宽原断言、不增加产品兼容。
- 同合并命令重跑：642/642 PASS，exit 0，约 19.6s，未使用 --test-force-exit。覆盖 runtime/process/task-ui/Beautify 全套及 Agent tool-waits/backend-waits/loading。
- `pnpm check`：1431/1431 PASS，exit 0，约 47.6s（typecheck + 项目配置的强制退出全量测试）；不作为自然退出证据。
- 初次 `git diff --check` 发现新增测试 EOF 多余空行，已删除，待最终重跑。独立审查、最终 scoped commit 仍待完成。真实在线 provider 与物理终端验收 NOT_RUN，不以离线结果替代。

## 最终结果

S1 已实施、验证、独立审查并提交：`ebfabce fix: require nullable process management controls`（23 个精确产品/测试文件）。未混入并行 `.trellis`/`.pi` 改动。

独立 `trellis-check` 审查（agent a18487d3-5a30-4ce）：发现唯一 P2 为 Bash 的协作指引仍要求省略 task_type。主会话仅把该句改为 targeted calls 的 null 要求，并把真实 Bash 注册加入 SDK prompt assembler 回归。该修复属于 R4 指引一致性，不改 Bash schema/执行。Reviewer 只读复核实际两文件 diff 后关闭发现，无新增发现。

Reviewer 独立聚焦七文件自然退出 30/30、直接 tsc 和 scoped diff-check 均 exit 0；主会话已检查其原始日志。修复后主会话命令 `node --test extensions/runtime-tasks/__tests__/prompt.test.ts extensions/runtime-tasks/__tests__/nullable-controls.test.ts extensions/beautify/__tests__/retrieval.test.ts extensions/process-tasks/__tests__/bash-schema.test.ts`：38/38 PASS，exit 0，自然退出。最终 `pnpm check` 再跑1431/1431 PASS、exit 0；最终 `git diff --check` 和 staged check PASS。此前642/642自然退出结果仍适用于未改执行逻辑；指引修复另有最终38/38自然退出覆盖。

PRD AC1–AC7 的本地实现、行为测试、指引/渲染一致性与独立审查均满足。真实 provider、物理终端验收仍 NOT_RUN；等待用户验收后才完成/归档。未改 `docs/` 或 `.trellis/spec/`，未安装、reload、push、归档或启动另两个任务。

`task.py validate` 仍报告 implement.jsonl 为0 entries，check.jsonl 4 entries通过；这是有意不使用 implement dispatch 的诊断，启动已显式 allow-empty，不宣称 full context validation PASS。

owned `/tmp/process-nullable-4Jp3BR` 与 reviewer `/tmp/process-nullable-review-pCkbWY` 的必要日志已核验，失败事实及重跑关联已记录于上文；终态后清理仅这两个目录。任务保持 in_progress 等待用户验收，无生命周期完成授权。

## 最终检查与记录

对照 PRD AC1–AC7，检查实际 tracked/untracked 和 stage diff，记录 PASS/FAIL/NOT_RUN、失败原因及重跑关联。不向长期 spec 填入一次性设计，不在用户 docs 教模型调用 JSON。不自动启动另外两个任务或修改它们的材料；finish/archive/journal 需要后续授权。
