# 实施与验证计划

## 执行方式与授权
主会话直接实施、自审，无子 Agent 或 worktree 创建。用户在最终方案后明确说“开工吧”，实施与范围内验证后本地提交已批准。两个角色 JSONL 为空且不用于派发，已使用 `task.py start <task> --allow-empty-context`；不把空 manifest 的 validate 诊断记为 PASS。start 提示 main 同时为 base_branch，PR/归档需另行处理；本次不创建 PR 或归档。

## 单阶段：模型选择闭环
- [x] 批准前完成 PRD/design/implement 审阅；批准后刷新任务身份、Git 状态和材料。
- [x] 读完整相关源文件、调用方、测试、共享 guides；工具/SDK 相关实现前读当前 Pi extension 文档及相关 examples/cross-references，不更改 SDK。
- [x] Trellis schema/admission 增加 model，补 stop/default/explicit/error 参数矩阵；两个 spawn 路径只转发真实 model。
- [x] 共享 Agent resolver 仅反转 model 优先级与 callerSupplied 来源；同步顶层/嵌套结果、字段与指导。
- [x] 更新离线前台/后台根/嵌套回归、默认链、错误模型与 scope，保留其他配置/恢复行为测试。
- [x] 同步 Skill、用户说明与规范；没有修改 Trellis package-owned 模板/角色/部署资源，未修改 provenance hashes 或 deployed copies。
- [x] 主会话自审实际 diff 与全体调用方；运行下列验证，记录失败原因、修复与重跑关系。
- [x] 全部耦合变更已验证，进入主会话本地提交检查点（无 no-commit 指示），提交说明 `feat(agents): support per-dispatch model overrides`；不 push、不自动归档或 journal 收尾。

## 验证命令
所有命令使用已有 SDK/Node/依赖，配置读取隔离到本次创建的仓库外临时目录；原始输出也写该自有目录。使用 Node 入口或确认已安装的包管理器，禁止下载、install 与冷 HOME 的 Corepack 启动。首次执行前核实命令脚本与当前测试 discovery。

1. `node --test extensions/trellis/__tests__/dispatch-params.test.mjs extensions/trellis/__tests__/dispatch.test.mjs`：自然退出，参数契约、shared/managed 转发与生命周期回归。
2. `node --test extensions/agent-tasks/__tests__/tool-contract.test.ts extensions/agent-tasks/__tests__/input-errors.test.ts`：自然退出，解析、根/嵌套显式/默认/错误、指导与其他配置保持。
3. `node --test extensions/trellis/__tests__/*.test.mjs extensions/agent-tasks/__tests__/*.test.ts`：受影响完整 owner 回归，自然退出；不请求线上 provider。
4. `pnpm check`：先核实现有可用入口，再在临时 agent-dir/已有 SDK 环境运行 strict typecheck + 配置完整 suite。配置 full suite 的 forced exit 不当成自然退出证据。
5. `git diff --check`、相关 Markdown 链接/指导与 current task/artifacts 检查。

缺依赖、SDK 或兼容 Node 时记录阻塞/NOT_RUN，不下载修复。Trellis fake-pi 和 Agent 离线 seam 不证明真实在线模型或完整 managed provider 端到端；本次不授权真实 TUI、在线模型、安装、个人 sync/reload。

## 验证记录

环境：macOS、Node v24.14.1、已安装 Pi 1.5.2 SDK；原始日志与隔离 agent-dir 使用本次自有目录 `/tmp/pi-dispatch-model.3ZVY3y`。未安装、下载依赖或请求线上模型，SDK link 报告 0 new of 8。以下日志在当前运行期间保留，最终结论不只依赖临时路径。

| 检查 | 命令与输入 | exit / 结果 |
| --- | --- | --- |
| 首轮定向 | `PI_CODING_AGENT_DIR=<run>/agent node --test extensions/trellis/__tests__/dispatch-params.test.mjs extensions/trellis/__tests__/dispatch.test.mjs extensions/agent-tasks/__tests__/tool-contract.test.ts extensions/agent-tasks/__tests__/input-errors.test.ts` | 1 / FAIL，58 tests，56 pass，2 fail。根前台/后台测试的 runner fixture 错把 manager 侧 invocation 当成 runAgent options 字段，导致断言 other 对 undefined；生产模型选择已为 other。修复 fixture 为两次调用分别断言 other/pinned，保留实际 session/结果模型校验。 |
| 受影响 owner 自然退出重跑 | `PI_CODING_AGENT_DIR=<run>/agent node --test extensions/trellis/__tests__/*.test.mjs extensions/agent-tasks/__tests__/*.test.ts` | 0 / PASS，796 tests，796 pass，0 fail/cancelled/skipped，91.674 秒。包含修复后的定向用例，未用 force-exit。 |
| 首轮完整检查 | `COREPACK_ENABLE_NETWORK=0 PI_SDK_DIR=<installed-sdk-node_modules> PI_CODING_AGENT_DIR=<run>/agent pnpm check` | 1 / FAIL；strict typecheck PASS，完整 suite 1922 tests，1921 pass，1 fail。唯一失败是无关的 `scripts/package-manager.test.mjs`：当前选择的 pnpm 10.33.0 不接受 fixture 的 `--registry ... run check` 组合，未改该测试或生产包管理配置。 |
| 兼容入口初次尝试 | 尝试缓存 pnpm 12.21.0 的 `bin/pnpm.cjs`，并作为 `PNPM_TEST_BIN` 跑 package-manager.test.mjs | 1 / FAIL；该缓存版本没有 .cjs 入口，MODULE_NOT_FOUND，5 tests 中3 pass/2 fail；未进行安装。随后实际列目录找到已安装的 `pnpm-native`。 |
| 兼容入口验证 | 已安装 `pnpm-native --version` 返回 12.21.0；`PNPM_TEST_BIN=<cached-12.21.0>/pnpm-native PI_CODING_AGENT_DIR=<run>/agent node --test scripts/package-manager.test.mjs` | 0 / PASS，5 tests，5 pass，0 fail；真实 CLI cold-HOME 用例零 registry 请求、没有安装。 |

| 完整检查最终重跑 | `COREPACK_ENABLE_NETWORK=0 PNPM_TEST_BIN=<cached-12.21.0>/pnpm-native PI_SDK_DIR=<installed-sdk-node_modules> PI_CODING_AGENT_DIR=<run>/agent pnpm check` | 0 / PASS；strict typecheck PASS，完整 suite 1922 tests，1922 pass，0 fail/cancelled/skipped，74.240 秒。仅为无关 fixture 指定已验证的本地原生入口；配置 full suite 仍使用 force-exit，不作为自然退出证据。 |

## 最终自审与限制
- 实际 diff 确认 model 的选择和来源同步改变，角色默认不再遮蔽显式模型错误或 scope 拒绝；其他配置仍走原 resolver，resume 与目录/权限逻辑不变。删除的仅是 model 被角色覆盖的冗余分支，sessionRequestedModel 继续记录实际解析请求，现场 session 快照 owner 不变。
- Trellis 注册 schema 与 direct admission 均测试必填/哨兵/非法值与 stop 排斥；两条 RPC options 仅在真实 model 存在时添加覆盖值。新 case 已加入实际执行的 smoke 集合，不只是定义了一个不会运行的测试。
- 工具字段、官方指导、Skill、用户说明与开发规范均同步；规范记录内部模型选择契约与回归 owner，不新增面向用户的 tool 参数调用教程。
- `git diff --check` 通过；首次 staged 检查发现新建 implement.md 末尾多一个空行（exit 2），已移除后重跑。任务材料仅 PRD/design/implement/task metadata 与空角色 JSONL，没有 raw logs/research/evidence 写入。Git 未出现锁文件、package manifest 或部署资源变更，SDK link 为 0 new；没有安装、下载或个人配置修改。
- 无独立审查，结论来自主会话自审。线上模型、真实 managed-provider 端到端、真实 TUI、个人安装/sync/reload：NOT_RUN，本次未授权；fake RPC/离线 runner seam 不能替代这些层级。
- task.py start 的 main/base_branch 提示仍保留；本次只本地提交，不创建 PR、不改历史、不归档或清绑定。
- 本阶段提交检查点：`feat(agents): support per-dispatch model overrides`。提交包含上述耦合源码、测试、指导/规范和任务材料；提交后用 Git 状态核实。