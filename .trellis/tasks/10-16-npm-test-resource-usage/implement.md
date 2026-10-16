# 第一批实施计划

## 授权与边界

用户已明确批准先执行第一批清单，完成后再规划下一批，复用本任务。主会话直接实施、自审；测试改动不涉及公共产品接口或生产生命周期重写，无需独立代理审查，遵守不启动 agent 的要求。批准包括范围内验证与本地阶段提交，不包括 push、归档、安装依赖或下一批实施。

现有业务行为不变，删除 GC/忙循环专项覆盖，其余通过合并/减重保留断言。不修改 SDK。保留单一全量入口，不新增测试分层。

## 第二批（用户已批准实施）

- S5：dispatch 的 13 个纯 RPC/state 用例使用 stateFixture；按 source/managed 从真实模板捕获 plain/task/implement/check 四类 query envelope，校准临时 root，由已有 mockPython 返回。产品 parser、Git snapshot、runtime 校验、文件/锁/execution 读写保持真实。role/task 之外请求拒绝；native drift、安全和 Python 互通用例不使用该 helper。完整 dispatch focused 后提交。
- S6：agent context 的 managedChild 复用一次真实 create/prepare 模板，复制后校准 Git links/marker/binding/初始化记录；target 缺 task 的专门集成仍保留原创建流程。复制目录及状态独立，真实 source query 和 binding/symlink/runtime 检查不 mock。两个变更文件自然退出 focused 后提交。
- S7：typecheck/full npm test 串行验收，记录 time 累计 CPU 和墙钟。使用新 owned 仓库外临时目录，不安装，不改生产接口。之前 full 102.92 s 是参考观察，机器负载不同不能当严格 A/B。保持任务 in_progress，下一轮另确认。

## 第二批验收记录

- S5 已完成，commit `f4b9bad`：13 个 RPC/state 用例切换 captured native query seam；只作用这组 fixture，不模拟其他 CLI。focused `node --test --test-concurrency=8 extensions/trellis/__tests__/dispatch.test.mjs`：35/35 PASS、exit 0、自然退出 41.45 s。
- S6 已完成，commit `ac2ea7a`：7 个 managedChild 用例共享一次 create/prepare 模板，按用例复制校准 Git/初始化/binding/marker 记录；所有动态身份、symlink、runtime/query 仍真实。focused 两个变更文件：63/63 PASS、exit 0、自然退出 43.22 s；dispatch 42.52 s、agent context 33.75 s（并行，不能相加）。
- S7 已完成：现有 Node v24.14.1/SDK 1.3.0/临时 agent-dir，`pnpm run typecheck` exit 0；`/usr/bin/time -l npm test` exit 0、1550/1550 PASS、78 suites、无 fail/cancelled/skipped。全量 106.91 s、user 349.22 s、sys 190.47 s，平均累计约 5.05 核；maximum resident set size 600129536 bytes，不是进程树同时 RSS。
- 全量 reporter dispatch 72.45 s、agent context 60.82 s、sync 18.69 s。相比第一批 full 102.92 s，本轮墙钟没有改善，累计 CPU 547.19→539.69 s 小幅减少但非受控 A/B、不可归因。无峰值采样，不能宣称满载已解决。
- 检查：两阶段 diff 自审、`git diff --check` PASS；不改生产实现、不删除测试、不改变发现范围/并发。未出现测试 FAIL；本 task 材料单独提交，其他会话未提交变更保留。空 implement/check manifests 是不派发代理的刻意配置，不声称 task validate 完整通过。
- 原始日志位于本轮 owned `/tmp/pi-test-resource-b2-tYcpP1`，验收后清理本目录。无需持久化原始日志，以上记录独立于临时路径。
- 第二批完成，继续复用任务，不归档。下一轮目前仅候选：实际资源占用仍主要由大量原生集成/初始化校验叠加造成，需审查其覆盖重复和进程树峰值，不能继续只凭单文件耗时猜测。

## 阶段与提交检查点

1. **S1 调度与 GC 精简**：package test 并发 8、两处 Trellis 内层并发移除；删除三组 GC 用例和专用 driver；更新测试规范过时的 GC 要求。检查三组 editor/owner 和两组 Trellis 测试、静态配置/glob，然后提交。
2. **S2 进程回归合并**：L3/L9/L10/L11；合并 bash-survive、合并输出/错误码 shell、改启动握手/清理超时与临时目录、合并简单状态断言并删除默认字段断言。运行 process waits/spawn/lifecycle 无强制退出，提交。
3. **S3 workflow/runner 减重**：L1/L2/L4–L8/L12；去除重复 worker stop、CLI 用挂起脚本、收窄 clone 接线、参数化 subscription setup、合并 completed shutdown 入口与资源状态、非 worker 通知 fake timer。运行 agent 五个已审文件无强制退出，提交。
4. **S4 最终整合**：既有 SDK/临时 agent-dir 隔离下运行 `pnpm run typecheck`、`npm test`；记录墙钟、CPU 累计/采样和退出码。检查配置、全量发现、git diff 与证据；必要整合修复单独提交。第一批完成后任务保持 in_progress，不归档。

## 验证与性能方案

- 所有原始日志/临时采样脚本放在本会话 `mktemp -d` 的仓库外目录。
- 只使用既有 node_modules 和 SDK；`PI_SDK_DIR` 从既有 SDK link realpath 推导，每次检查创建临时 `PI_CODING_AGENT_DIR`。
- Focused：`node --test --test-concurrency=8 <阶段文件>`，不强制退出；阶段依序执行，不同时跑测试套件。
- 最终：`pnpm run typecheck` 与 `npm test`，串行执行。不存在独立 lint 脚本，不伪造 lint PASS。
- 不重跑旧配置全量满载基线；以只读记录（10 核、旧外层 9、内层 10）及减少的 worker/进程/GC 调用作为结构对照。最终采样记录实际负载，不声称因果改善百分比。后续如需严格 A/B 基线另行规划，避免本轮额外满载运行。
- 命令失败保留事实，定位并重跑；记录未运行和自然退出限制。

## 进度与证据

- 开始时相关产品文件已干净；其他会话已提交原有相关修改，仍需每阶段复核 Git。
- [x] S1：`f7e395b`。并发 8、内层串行、三组 GC 删除及当前规范/Beautify 验证说明更新。focused 117/117 PASS，exit 0，自然退出约 55.07 s。
- [x] S2：`18daf87`。删除重复 bash-survive 文件；输出两流/exit 合并，启动握手、清除 race timer、临时目录 cleanup；status 参数表合并。focused 27/27 PASS，exit 0，自然退出约 0.78 s。日志有既有 fake UI cleanup 的已隔离错误输出，未导致测试失败。
- [x] S3：`3c16f63`。busy 用例删除、CLI 改挂起、worker stop 合并、clone 接线收窄、new/resume subscription 参数化、hook 状态替代真实空 timer、两组无 worker 通知 fake timer。五个审查文件 121/121 PASS、exit 0、约 19.58 s；最终移除 factory 空 interval 后重跑两个变更文件 87/87 PASS、exit 0、约 19.15 s。未全面替换其余通知等待；running/throwing sibling 路径保留各自断言，completed 两入口参数化合并。
- [x] S4：`pnpm run typecheck` exit 0；`/usr/bin/time -l npm test` exit 0，1550/1550 PASS、78 suites、0 fail/cancelled/skipped。Node v24.14.1，现有 Pi SDK 1.3.0，临时 `PI_CODING_AGENT_DIR`，未安装依赖。

### 最终资源观察与限制

全量墙钟 102.92 s，user 352.57 s、sys 194.62 s；累计 CPU / 墙钟约 5.32 核，不是 CPU 峰值。time 报告 maximum resident set size 650739712 bytes，不能解释为整个进程树同时 RSS 峰值。未进行定时 CPU 采样、旧配置 A/B 基线、真实终端或 provider 验证，不能宣称满载已解决或改善百分比。

实测 full reporter：dispatch suite 81.07 s，agent context suite 66.00 s，sync 脚本入口 17.70 s；套件并行，时间不能相加。当前发现 139 个入口（删除一个 bash-survive），GC driver 不属于入口。所有 staged stage diff 自审和 `git diff --check` 通过，未混入其他会话改动。任务在 main 上记录 branch，CLI 提示日后 archive 的 branch/base 相同限制；本轮无归档授权，不改 branch、不创建 worktree。

原始输出目前在本会话 owned `/tmp/pi-test-resource-bhpEjA/`；确认结果后按 owned 范围清理，不保留为仓库证据。未发生测试 FAIL；工具精确编辑/参数拒绝在执行前返回，不属于测试失败。

第一批自验收完成。用户已授权完成后只读探索下一批；下一批具体改动仍需确认，任务继续 in_progress。
