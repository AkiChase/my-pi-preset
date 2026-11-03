# 实施与验证记录

## 授权、阶段与提交检查点

用户以“开始吧”批准已记录方案的实施、验证及本阶段主会话本地提交。主会话直接实施，`trellis-check` 独立只读审查。只完成一个耦合阶段：角色状态策略、TS/Python 准入、回归、包内指导和 adapted hashes 一起提交。

任务已 start，为 `in_progress`。`implement.jsonl` 有意为空，直接实施无需派发 manifest；`check.jsonl` 有三个有效 spec 引用。start 使用 `--allow-empty-context`，不代表完整 task validate 通过。

阶段检查点提交消息：`fix(trellis): allow planning research dispatch`。本记录与实现同一提交，具体哈希见 Git 历史和交付回复。不 push、不改写历史、不安装、不部署、不自动归档或写 journal。

## 完成项与验收映射

- [x] AC1：TS `requireDispatchStatus` 与 Python `require_execution_status` 集中定义一致的角色矩阵。research 允许 planning/in_progress，implement/check 只允许 in_progress，其他值拒绝。
- [x] AC2：注册工具测试覆盖无 active task 时显式选 planning task；完全无任务拒绝，零 spawn。
- [x] AC3：dispatch 和 child startup 检查 task.json 不变、父会话 pointer 不变及不创建 lifecycle/session 副作用（child 自身独立源 pointer 除外）。research 产品代码只读、产物写入须明确授权的指导保留。
- [x] AC4：共享目录、managed prepare/readiness/dispatch 以及 child authority 初始化都支持 planning research；没有有效材料或准备的 binding 继续拒绝，不回退。
- [x] AC5：源指纹仍排除 status，派发前另行读取状态；两种路径均测试 final native facts 返回后状态变为 completed 时拒绝且无 lease/spawn。材料/身份/占用及相关 stop/shutdown 回归通过。
- [x] AC6：包内 workflow、brainstorm skill、research role、协议和 dispatch 指导保持一致，更新四类 adapted hashes 与 runtime release identity，历史 source metadata 不变。
- [x] 独立审查和主会话实际 diff 复核完成；现有源码无需另加 index.ts research 绕过。
- [x] 规范评估：本规则已保存在包内 workflow/role/skill/protocol，项目开发规范的资源所有权及跨层检查规则已覆盖，无需重复新增 project spec。

## 执行环境与验证

环境：macOS，Node `v24.14.1`，pnpm `10.33.0`，Python `3.14.7`。已有 SDK：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.4.0/node_modules`。所有 Node/pnpm 检查设置该路径为 `PI_SDK_DIR`，`PI_CODING_AGENT_DIR=/tmp/trellis-research-planning.nD1FXA/agent`；没有依赖下载或个人配置同步。link-sdk 报告新增链接 0/7。

| 检查 | 命令 | 退出码 / 结果 |
| --- | --- | --- |
| 首轮 focused | `node --test extensions/trellis/__tests__/dispatch.test.mjs extensions/trellis/__tests__/task-context.test.mjs extensions/trellis/__tests__/agent-context-integration.test.mjs extensions/trellis/__tests__/preparation.test.mjs extensions/trellis/__tests__/python-worktree.test.mjs` | 0，45 PASS |
| 原生 Python | `python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'` | 0，39 PASS |
| 首轮 Trellis 全套 | `node --test extensions/trellis/__tests__/*.test.mjs` | 0，372 PASS |
| 首轮项目集成 | `pnpm check` | 0，严格类型检查及 1740 PASS |
| 最终 focused（同上） | 加入 4 个已有 stop/shutdown 用例后重跑 | 0，49 PASS，约 41.4 秒 |
| 最终 Trellis 全套（同上） | 包含最终注册用例、资源 provenance 与 policy 检查 | 0，376 PASS，约 52.7 秒 |
| 最终项目集成（同上） | 严格类型检查及全量测试 | 0，1744 PASS，约 74.0 秒 |
| 空白检查 | `git diff --check` | 0 |
| 任务 manifest | `python3 .trellis/scripts/task.py validate .trellis/tasks/11-04-research-planning-dispatch` | 1，唯一诊断为有意为空的 implement.jsonl；check.jsonl 三项有效，不能描述为完整通过 |

focused/Trellis 检查不使用强制退出；项目全套按现有配置使用 `--test-force-exit`，其 PASS 不单独证明自然退出。Python 日志中的 removed CLI parser 错误文本来自预期拒绝用例，不是测试失败。

## 负对照、审查与重跑关系

主会话在拥有的仓库外临时目录复制 Python runtime/测试，把 research 规则恢复为旧的统一 `in_progress` 门禁，再运行 `test_worktree.py` 对应的 unittest discovery。退出码为 1，30 个用例中仅新增矩阵的 planning/research 子用例报 `source_not_approved`。这是预期负对照 FAIL，证明新增回归能捕获原缺陷；真实仓库源码未被还原，正常 Python 39 项通过。

独立 reviewer `agent_trellis_check_0_c6ba2506` 完整读取任务、workflow、check.jsonl 全部引用、17 个改动文件和关键调用链，未发现阻断问题，未改仓库。其 provenance 证据确认所有当前 hashes、runtime releaseId 和历史 source metadata；主会话实际读取并复核输出。

reviewer 指出 smoke 白名单意味着未注册的 stop/shutdown 声明不算执行。主会话因此纳入 4 个相关已有用例：managed stop 参数/终态 lease、managed shutdown unknown、source stop/shutdown、stop 拒绝保留 lease，复跑最终三层检查均通过。与审查保存的 diff 比对，生产代码/资源/指导完全不变，后续只增加这 4 项测试注册，主会话自查该测试变化。

未发生实际产品测试失败。规划定位搜索曾使用不存在的文件/glob，后续按实际目录补齐；不是产品回归。start 在 main 记录分支，CLI 警告它也是 base_branch，未来同分支 PR/归档会拒绝；本轮不创建 PR 或执行归档，不替用户自动改分支。

## 材料保留与限制

原始日志、negative runtime 副本和 reviewer 输出只在 `/tmp/trellis-research-planning.nD1FXA`；主会话已核实所有结果，无未解决诊断。任务仅保留 PRD、design、本记录、task.json 及两份角色 manifest，无 research/evidence 报告或原始输出。主会话确认本轮命令与 reviewer 均已终止后，仅删除本轮拥有目录 `/tmp/trellis-research-planning.nD1FXA`，并检查目录已不存在，清理成功。本记录保留所有最终结果和预期负对照失败事实，不依赖临时日志。

NOT_RUN：真实在线模型/provider 端到端派发、个人安装/同步、已部署资源更新、生产 managed worktree、TUI。fake-pi/临时仓库回归不等同这些证据。修改的包内 runtime 需要后续显式部署更新；已安装包和本项目生成的部署副本均未为此手工修改。任务保留 active/in_progress 等待验收，不自动归档。
