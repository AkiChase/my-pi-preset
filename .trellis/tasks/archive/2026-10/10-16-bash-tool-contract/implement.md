# 实施与验证

## 授权、边界与执行者

用户授权实施、自行迭代、check 后自动收尾。主会话直接实现；因公开工具接口和共享通知生命周期变更，派发独立 trellis-check。共享源目录执行，不创建 worktree。保留所有无关 staged/unstaged/untracked 变更；仅提交本任务精确文件。

## 阶段 1：完整 Bash 契约

产品主体已由用户更新工具时提交为 `dab5ee3f601041db158cd00b918de376e114eca8`（14 个精确文件）；本会话不重写该提交。后续仅提交共同规范与必要的新参数显示适配，避免混入 widget 并行改动。

- [x] 参数改为 background_after_seconds，移除 timeout/notify，旧调用 effects 前拒绝。
- [x] 等待阈值仅转后台；立即后台互斥；非交互显式阈值拒绝。
- [x] 删除 bash sleep 定时终止特例；保留固定等待 guard、主动 stop、取消和退出清理。
- [x] 后台自动通知，保留已消费结果不重复报告与会话 fence。
- [x] tools 简介 + rules 单个多行 Bash usage:；共同规范，不新增框架。
- [x] schema/效果前拒绝/自动后台/前台完成/后台通知/真实 SDK 最终 prompt 回归。
- [x] 更新用户文档、provenance、最小开发与测试规范。
- [x] 独立 check，主审实际 diff、自然退出聚焦验证、广泛验证；主体 checkpoint 为 dab5ee3，剩余规范/显示适配单独精确提交。

## 验证计划

使用 mktemp 创建本轮仓库外原始输出目录；PI_CODING_AGENT_DIR 指向本轮临时子目录，复用现有 SDK，不安装依赖。

- `node --test extensions/process-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts`：自然退出、共享生命周期和管理契约。
- `pnpm check`：完整类型和 configured 测试；全套带 force-exit，不替代自然退出证据。
- 新提示测试使用注册定义和真实 SDK 提示组装/参数验证，不复制产品算法、不仅匹配源文本。
- `git diff --check`、精确 diff 与链接/当前参数搜索。
- 最终归档前复核范围内 staged/unstaged/untracked、记录 checkpoint、结果和未执行限制。

真实线上 provider 行为/用户终端视觉不在本次验证承诺内；不自动安装、个人同步或 reload。

## 证据记录

- 初次 schema 聚焦测试：19/20，通过批量替换误将配置 fixture timeoutMs 改名，默认值断言失败；修复 fixture 后通过。
- 第二次 bash 聚焦：29/32，失败来自旧 timeout 用例及 SDK 未导出的子路径导入。更新契约用例，测试改用解析已安装 SDK 的 file URL 调用真实组装器；后续真实 prompt 测试通过。
- 首次 typecheck 同时发现新测试 SDK 子路径类型错误和无关 shared/widget-display/owner.ts:110 类型错误。前者已修复，后者未改；并行工作随后修复无关文件，下一次 pnpm check 类型阶段通过。
- 第三次自然退出集合：485/493，8 个失败均为旧 timeout/notify fixture 调用；保留断言意图并更新公共管理、错误路径、等待和 retained-child 用例。
- 第二次 pnpm check 类型阶段通过，测试集合失败均来自旧参数 fixture（包括 beautify 的 backend stop 用例），不是状态竞态；调用已按实际错误堆栈核查。retained-child 与 agent backend 聚焦重跑 exit=0。不能把包装 shell exit=0 视为内部检查通过。
- 规划定位命令一次 exit=1：猜测 docs/extensions/process-tasks.md 不存在、末尾 ls 无匹配；不是产品/测试失败。随后实际读取 docs/extensions/task-composition.md 完成定位。
- 最终自然退出集合：`PI_CODING_AGENT_DIR=<本轮临时agent目录> node --test extensions/process-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts extensions/beautify/__tests__/tools.test.ts extensions/beautify/__tests__/retrieval.test.ts`，524/524 PASS，exit=0。
- 更新后的 schema default 是元数据，实际 host 不自动填默认值；省略值保持 absent，execute 使用配置。符合原方案，无需新产品决策。
- 待提交 Beautify 新参数摘要：新阈值显示 background after Ns，立即后台显示 background；保留 timeout 历史/原生工具展示兼容，不允许旧参数执行。
- task validate 的 check.jsonl 3 个引用有效；unused implement.jsonl 故意为空，validate 报 1 个诊断，不宣称完整验证通过。主直接实现以 allow-empty-context start，独立 review 使用已准备 check manifest。
- 最终全套 `PI_CODING_AGENT_DIR=<本轮临时agent目录> pnpm check`：typecheck PASS，1566/1566 tests PASS，命令 exit=0（task wait 核实）。全套使用 force-exit；524/524 自然退出集合另提供生命周期证据。
- 最终独立 trellis-check：46/46 局部自然退出 PASS、exit=0；实际 diff/注册/SDK/消费/会话保护/链接复核，无阻断发现。主复核实际 scoped diff 与命令退出码，验收通过。
- 精确 spec stage patch 首次构造缺失换行，git apply --cached --check 报 corrupt patch（exit128）；重构 patch 后预检查通过，未对 index 产生失败写入。
- 非阻断历史文案仍有 research 归属陈旧描述（testing/index.md、PROVENANCE），按边界仅报告，不整理历史材料。
- 最终 follow-up checkpoint `5e47ef8e17ea0966cea64a28a5a9b5db4ac448fb`：共同规范与新参数显示。提交时误用 git commit 带路径，导致 spec 工作区的并行 widget 两个 hunk 一并提交；主立即用后续 `feb01d1` 分离该并行内容（不重写历史），工作区 widget 内容保留，累计 bash 提交范围正确。
- 收尾：归档成功到 archive/2026-10/10-16-bash-tool-contract，会话绑定清空。归档自动提交失败（原目录未追踪，pathspec 无匹配）；后续主精确提交归档目录，不混入无关 staged 内容。journal Session 24 已由 CLI 自动提交。
- 验证限制：没有独立 lint；未运行线上 provider、真实终端视觉或个人安装/reload。最终收尾材料不依赖临时日志存活。
