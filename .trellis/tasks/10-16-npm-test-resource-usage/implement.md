# 实施与验证记录

## 执行约束

主会话实施、自审，不派发agent。各阶段检查后立即本地提交；不push、安装、改生产算法或归档。保留并行修改。测试用已有Node v24.14.1/SDK1.3.0及临时agent-dir；定向命令不force-exit，全量保留既有配置。任务in_progress，下一批须批准。

## 阶段检查点

| 批次 | 提交 | 定向结果（自然退出） |
| --- | --- | --- |
| 1 调度/GC | `f7e395b` | editor/owner/两Trellis文件117/117，55.07s |
| 1 进程合并 | `18daf87` | waits/spawn/lifecycle27/27，0.78s |
| 1 workflow减重 | `3c16f63` | 五文件121/121；最后两文件87/87，19.15s |
| 2 RPC/state | `f4b9bad` | dispatch35/35，41.45s |
| 2 managed模板 | `ac2ea7a` | 两文件63/63，43.22s |
| 3 schema降层 | `ff2167c` | 85/85，20.47s |
| 3 模板/snapshot | `ab71833` | 100/100，27.64s |
| 3 readiness复用 | `5a0de56` | worktree-cli15/15，26.29s |
| 4 Python矩阵/update | `126e890` | 三文件20/20，21.66s |
| 4 admission降层 | `5a253d6` | Python37/37；两Node文件27/27，17.90s |
| 5 identity降层 | `ccbbb73` | context/worktree40/40，25.21s |
| 6 setup query | `40f8b25` | 修复夹具后dispatch35/35，40.02s |
| 6 authority合并 | `fcf40ca` | dispatch34/34，37.94s |
| 7 初始化基线复用 | `6430098` | initialization/init-review/init-diagnostics70/70，26.16s/42.44CPU s |

所有成功阶段exit0、无fail/cancelled/skipped，选中文件和staged diff自审/whitespace通过。净测试数变化源于已批准删除/合并，不代表少测相同输入；具体覆盖取舍见design。空implement/check.jsonl因不派发而保留，不声称task validate完整通过。

## 整体验证

命令依次为 `pnpm run typecheck`、`/usr/bin/time -l npm test`；Trellis单组为 `/usr/bin/time -l node --test --test-concurrency=8 --test-force-exit extensions/trellis/__tests__/*.test.mjs`。

| 时点 | 全量结果 | wall / 累计CPU | typecheck |
| --- | --- | --- | --- |
| 批次1 | 1550/1550，78 suites，exit0 | 102.92s / 547.19s | exit0 |
| 批次2 | 1550/1550，78 suites，exit0 | 106.91s / 539.69s | exit0 |
| 批次3 | 1543/1543，78 suites，exit0 | 90.38s / 473.08s | exit0 |
| 批次4 | 1543/1543，78 suites，exit0 | 84.78s / 459.98s | exit0 |
| 批次6 | 1299/1341，42 fail，68 suites，exit1 | 88.67s / 452.52s | exit2 |
| 批次7 | 1508/1535，27 fail，78 suites，exit1 | 85.26s / 443.04s | exit0 |

Trellis：批次3全组exit0、69.91s/350.07CPU s；批次6 460/460 exit0、75.78s/338.71CPU s（dispatch63.72s/context51.58s）；批次7 454/454 exit0、66.99s/317.28CPU s。均无cancelled/skipped；单组仍force-exit，不证明整体自然退出。

## 失败与诊断事实

- 批次6首次snapshot定向失败：34pass/1fail，模板捕获的sourceFingerprint在复制root后不再匹配真实status。只该case改当前副本真实query捕获两角色，随后复用；未伪造指纹或削弱current→stale断言。rerun35/35通过。
- 批次5前两次全量诊断exit1、1345tests/42fail；恢复PI_SDK_DIR后仍失败。批次6typecheck/full错误包括runtimeTaskTool/registerRuntimeTaskTool导出移除、task_id/run_id→agent_id/execution_id与task_manage→agent_manage/process_manage不匹配。来自另一任务在途工具契约修改，未修范围外代码。
- 批次7typecheck恢复通过，但full仍27fail：agent/backend、Beautify、Task UI测试仍引用旧管理工具/元数据，典型process-harness读取不存在工具execute、嵌套delegation期待旧task_id/run_id文本。Trellis全通过不等于全仓交付通过；未修改这些断言。运行期间subagent-rpc.ts也出现另一任务未提交修改，未纳入本批。
- 临时诊断driver曾三次失败：CLI Python wrapper未转发-c导致35测试夹具连锁失败，修正passthrough后35/35；初始化计数hook未匹配packageResources签名导致三入口未加载，收窄后76/76；这些是诊断工具失败，不是产品回归，未将失败轮作性能基线。
- 第五批全仓diff check发现范围外facade.ts EOF空行；本任务选中/staged检查通过，未修其他任务。

## 第七批授权与落地

用户批准I1/I3/I4/I5/I6及精简任务材料。十forged recovery共用一次真实first-write中断，各例独立复制/rehome planHash；四onboarding字段共用真实join模板；两个handler改copyRuntimeFixture；重复manifest中断合并并保留verifyRuntime拒绝/真实重试；diagnostics六输入恢复同一夹具，移除重复engine校验。只改三测试文件，生产算法/入口/并发不变。定向70/70通过后立即提交；文档再整理为PRD约27行、design约40行及本记录，保留关键结果和失败。

## 资源结论与临时材料

Trellis原模块CPU占比81.2%，后续诊断重点见design。多轮局部收益没有稳定转化为全量wall下降；不承诺满载/瞬时峰值已解决。跨轮负载、缓存和并行修改不同，失败轮不与成功轮当A/B。ps采样会漏短命/reparent子进程；RSS指标不是全进程树同时峰值，逻辑读取不是物理吞吐。

已核对并清理的owned目录：批次1–5与初始化只读实验；旧原始证据不迁移/清理。未解决全仓失败所需日志保留：`/tmp/pi-test-critical-xMwjgJ`、`/tmp/pi-test-b6-hx55Py`、`/tmp/pi-test-b7-884FfT`。日志保留用于并行契约诊断，不持久化进research/evidence。无独立lint脚本、不声称lint或真实provider/TUI验证。任务不归档；main与base相同的历史task分支限制仍未修改。
