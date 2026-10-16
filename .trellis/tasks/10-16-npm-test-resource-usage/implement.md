# 第一批实施计划

## 授权与边界

用户已明确批准先执行第一批清单，完成后再规划下一批，复用本任务。主会话直接实施、自审；测试改动不涉及公共产品接口或生产生命周期重写，无需独立代理审查，遵守不启动 agent 的要求。批准包括范围内验证与本地阶段提交，不包括 push、归档、安装依赖或下一批实施。

现有业务行为不变，删除 GC/忙循环专项覆盖，其余通过合并/减重保留断言。不修改 SDK。保留单一全量入口，不新增测试分层。

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
