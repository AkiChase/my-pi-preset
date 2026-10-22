# 实施记录

## 授权与执行方式

用户已确认 demo 样式并明确授权正式实现；允许清理这次 demo 文件。主会话实现；涉及公开入口变化、prune 删除确认及子进程取消，使用独立 trellis-check 审查。无 worktree 绑定，review 在共享目录进行；主会话与 review 不同时编辑重叠文件。允许阶段验证后本地提交，不 push、不归档任务。

## 阶段与提交点

单个耦合阶段：Node 向导 + shell 引导 + 测试 + 用户文档同步，独立审查和验证后一起提交。不能先单独提交入口导致 curl 下载缺失文件。

- [x] 实现来源/同步/清理/预览/确认状态机与无边框键盘 TUI。
- [x] 复用 sync.mjs 生成真实计划与执行；子进程取消、错误传播、终端恢复。
- [x] 更新 install.sh 无参数启动/TTY/下载清理。
- [x] 更新 README 和引用安装参数的两个用户页面。
- [x] 增加状态、渲染、fake sync、fake curl 与 PTY 验证。
- [x] 独立 review，修复与重跑。
- [x] 删除 `local/interactive-installer-demo.mjs`。
- [x] Git diff/语言/文档链接检查；阶段本地提交。

## 验证命令

- `node --test scripts/install.test.mjs scripts/sync.test.mjs scripts/pi-manifest.test.mjs`
- `node --check scripts/install.mjs`、`sh -n install.sh`、`git diff --check`
- 临时目录 + fake Pi 的 Python PTY 驱动，验证真 dry-run/确认后写入/退出恢复；原始输出放在 `/tmp/pi-installer-run.yQURV6`。
- 使用已装 SDK、隔离 agent 目录运行 `pnpm check`；缺少依赖不下载。

## 验证记录

- task start 成功；`task.py validate` 返回 1，因为直接实现不派发 implement，implement.jsonl 故意为空，check.jsonl 四条引用有效。非全量 context validation PASS。任务在 main 上记录，CLI 警告与 base 相同不适于 PR/archive；本轮不授权归档。
- 初始集中 suite PASS。初次 Python PTY driver 在 shell 退出等待时失败：驱动未读取终端恢复输出，修正驱动 drain 后本地 shell PASS。
- curl 管道 PTY 首次失败：macOS mktemp 使用 `/var` 路径，而 Node 模块 URL 为物理 `/private/var`，入口 guard 未触发，表现为退出 0 但无向导。shell 临时路径 `pwd -P` 修正后管道 fixture PASS。Node installer guard 也改为 realpath 验证，覆盖独立临时 fixture。
- 第一位 trellis-check 被用户因卡顿停止，只有部分发现：小终端确认输入被裁剪。改用固定保留 footer、动态计算换行、35x20 最小门禁后修复。其未完成结果不能作为独立验收。
- 重新 trellis_dispatch 因 native query JSON 截断失败；没有静默切换 worktree。任务无绑定，随后使用普通隔离工具集的 read-only general-purpose agent 作窄范围独立审查。
- 独立审查发现 APPLY 后 TUI 抢占子进程 stdin；执行前移除 keypress 监听并暂停输入，保留信号取消。新增 PTY 子进程 readline prompt，输入 `q` 由子进程独占接收且执行成功。第一次新增 prompt fixture 因 macOS临时路径入口 guard 失败，realpath 修正后通过。
- 最终集中命令 `node --test scripts/install.test.mjs scripts/sync.test.mjs scripts/pi-manifest.test.mjs`：33 项 PASS，0 FAIL，退出 0；包含真实离线 PTY、fake Pi、fake curl、确认前无写入、确认后配置写入、取消、下载清理、子进程输入交接。
- 首次隔离 `pnpm check`：类型检查与 1624 tests PASS，0 FAIL，退出 0（在最后输入交接/新 fixture 之前）；最终版本重新执行：类型检查与 1626 tests PASS，0 FAIL，退出 0。
- 独立 reviewer 复查输入交接修复，无剩余重要问题（窄范围代码检查，不代替测试）。主会话核验真实 PTY 和完整 test 输出。
- 变更用户文档本地链接存在性检查 PASS。
- `node --check scripts/install.mjs`、`sh -n install.sh`、`git diff --check` PASS。spec discovery 为 single-repo development/testing；用户 docs 已无 install.sh 旧参数调用。
- 不运行真实安装、联网依赖下载、个人配置同步、reload。全套采用已有 SDK 与临时 agent/config；PTY fake Pi 不访问个人状态。

## 后续阶段：简化确认及本地依赖

用户追加授权：审阅页 Enter 直接执行，移除 APPLY 页；本地来源且选中 Packages 时先执行 pnpm install。来源/审阅页明确展示依赖步骤，只在执行确认后启动，不自动安装 pnpm，失败/取消阻断 Pi 同步。配置域/远程来源不安装依赖。

- 实现与 docs/spec 同步；保留原独占 stdin 和进程组取消逻辑。
- 新增 fake pnpm PTY 验证：预览无依赖安装、正确 cwd、先 pnpm 后 Pi、本地安装失败 exit 7 不开始同步、local config-only 不运行 pnpm。
- 首次 fixture cwd 断言 FAIL：macOS /var 临时目录别名与物理 cwd 不同；仅修正 fixture 使用 resolve 后复跑 PASS，不修改产品逻辑。
- 最终集中 suite 33/33 PASS；隔离 pnpm check 类型检查和 1626/1626 tests PASS（exit 0）。之后补充 config-only fixture，重跑集中 suite PASS。
- 独立 general-purpose reviewer 窄范围读取代码：无发现；main 核对实际测试结果。node syntax 与 git diff --check PASS。
- 本阶段作为独立验证点提交；不 push、归档或实际安装。原始日志使用本轮拥有的 `/tmp/pi-installer-followup.pe4q2w`，核验后清理。
