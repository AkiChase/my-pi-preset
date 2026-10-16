# 实施记录

## 当前状态

主会话直接实施、自审；未派发、不安装、不push、不归档。任务保持 `in_progress`。测试入口、发现 glob 和文件并发8不变；不改 SDK、生产 Trellis runtime/Git/query/初始化算法。其他任务变更未纳入提交。

## 已完成

1. **基础减重**：外层并发固定8，移除内层并发；删除已批准的 GC/忙循环专项；合并 process/workflow 等待与重复 shell 测试。
2. **Trellis 低成本化**：schema、CLI参数、active/start/developer、binding identity 等矩阵移至真实纯函数或单进程 Python；复用 runtime/template/worktree 基线；消除重复 snapshot 和重复初始化。
3. **Trellis smoke-only**：仅执行真实初始化、Git worktree、deployed Python CLI、managed/source dispatch、managed child/Git identity 的代表 smoke；其余状态、prompt、record、schema、materials 仍由独立纯 Node/Python 测试覆盖。随后合并剩余 dispatch/context/worktree/preparation fixture。
4. **sync/memory**：`sync.mjs` 导出真实计划函数并包装 CLI `main()`；sync 从几十次 Node CLI 启动缩为直接 plan 测试加4条CLI smoke。memory panel 从4320 render缩为324个边界组合，store overflow从230降至201文件。

## 覆盖取舍

保留真实边界：fresh init + interrupted retry、Git create/source dirty preservation、prepare/recover/remove、deployed CLI/Node-Python互通、managed/source dispatch、source/target drift、runtime篡改、managed child authority/CLI路径、非标准Git checkout。

不再逐组合运行：角色/参数/record/manifest字段矩阵、同一安全规则的多角色多状态原生链路、重复root block/guard/init事务。纯测试不能证明每个跨层组合；这是用户批准的 smoke 取舍。

## 验证与性能

- 所有阶段定向测试自然退出、exit0；当前最终 typecheck exit0。
- 最终全量：`npm test` exit0，**1416/1416**，78 suites，0 fail/cancelled/skipped；**72.10s wall / 355.83 CPU s**。
- 同批前一轮：83.12s / 390.62CPU s；观察减少11.02s/34.79CPU s，非严格A/B，不主张因果或峰值问题已解决。
- CPU 采样的一轮全量：76.79s、376.13CPU s；200ms进程树采样峰值约560%（5.6核）、P90约452%（4.5核）。短命Python/Git可漏采样，累计CPU更可靠；树RSS求和不能当物理内存峰值。
- **query Git 去重**：`records.repository_identity()` 合并 `--show-toplevel --git-common-dir`；managed query 先读target identity、验证source binding后才最终完整读取target，避免未使用的早期worktree list，同时保留最终target Git/marker/branch验证。Python38/38、deployed CLI/dispatch smoke7/7、typecheck通过。全量受并行 agent-task 修改影响，1400/1419、19失败；错误均为agent runner前端/通知断言，不是Trellis失败，未修范围外代码。

## 限制与材料

全量配置使用force-exit，不能证明自然资源释放；真实 provider/TUI 未运行。没有独立 lint 脚本。已清理本任务大部分临时材料；未解决外部契约诊断日志保留于 `/tmp/pi-test-critical-xMwjgJ`、`/tmp/pi-test-b6-hx55Py`、`/tmp/pi-test-b7-884FfT`。后续生产 query/初始化性能重构需单独批准。
