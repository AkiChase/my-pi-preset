# 实施与验证计划

## 状态和执行者

用户已批准实施，S1/S2 已完成并验证。主实现和自审，不启动 Agent，不建立临时/托管 worktree。公开接口/权限通常要求独立 review；本次受明确不启动 Agent 限制，独立 Agent review 不可用，不以自审替代称谓。实际注册、SDK、loader、权限与生命周期回归覆盖风险；如用户另允许独立 reviewer 再准备 check manifest。

## S1：管理入口和身份迁移

耦合接口必须同阶段一致，不先删除旧入口再留下错误调用。

- [x] 纯 execution_id 编码/解析，subagent exec_ canonical base64url tuple，workflow 现有 wf_ ID。
- [x] process_manage/agent_manage 扁平闭合 schema、动作允许字段与类型防御。
- [x] 内部精确 capability/coordinator 身份复用；公开 v2 envelope/launch 投影和错组/stale 拒绝。
- [x] composition 两入口与 child handoff，Agent nested factory/fallback/active allowlist/deny/narrow/depth/owner gates。
- [x] 启动/恢复/通知、bash 指导、Agent/workflow 结果、Trellis dispatch 与包内相关资源全面迁移，无 task_manage 兼容。
- [x] renderer、用户文档/spec、adapted hashes 与必要测试同阶段更新；不手改项目生成资源或历史 baselines。
- [x] 真实 host schema、公开分流、resume 旧句柄拒绝/已 admitted wait、消费/通知/stop、retained-child scope 和 fake-pi Trellis 测试。
- [x] 主完整差异审查、检查后精确 commit。混合文件用 scoped patch stage，commit 不带路径以免提交工作区未选 hunk。

## S2：Monitor 契约与最终工具组验证

- [x] Monitor usage 多行单组、process_manage 协作、配置 cadence/0 语义与示例。
- [x] 正有限时间 schema、直接调用顶层/ws 字段/形状防御，效果前拒绝，保持合法 source/notification/session 策略。
- [x] 实际 SDK schema、注册与 prompt 组装：单组、peer 保留、disabled/hidden 排除、当前身份/默认值一致。
- [x] docs/spec 和必要回归同步。
- [x] 自然退出集成、pnpm check、差异和资源检查后精确 commit。

## 检查命令

每次输出收集先建立 mktemp 仓库外自有目录，PI_CODING_AGENT_DIR 隔离，复用现有 SDK；不安装依赖、不使用个人目录。所有临时脚本/log 放该目录，结果记录在 implement.md。

- `node --test extensions/runtime-tasks/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts`：自然退出、管理/日志/通知与 wait/stop/session。
- `node --test extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts extensions/agent-tasks/__tests__/loading.test.ts extensions/agent-tasks/__tests__/runner-cancellation.test.ts`：实际子会话/权限/停止和 loader；若具体新测试命名变化，先确认文件再运行。
- `node --test extensions/beautify/__tests__/*.test.ts`：新/历史 envelope display、未知回退、参数结果身份与零执行所有权。
- `node --test extensions/trellis/__tests__/*.test.mjs`、`scripts/pi-manifest.test.mjs`：包内资源/指引、fake-pi 和 hashes。
- `pnpm check`：strict typecheck + configured 全套；全套 force-exit 不代替自然退出证据。
- `git diff --check`、相对链接/JSONL/hash、最终注册工具与旧运行指导引用搜索；不将历史文档/厂商引用自动改写。

每阶段只报告实际命令、环境、exit 和结果；失败保留原因与重跑关系。脚本/模拟 provider 不证明线上模型质量或真实终端视觉。

## 生命周期

实施批准包含 scope 内阶段本地提交，不包括 push/历史重写/安装。用户已最终验收并明确授权收尾，允许本任务 archive/journal 和范围内本地提交。main 直接实现 unused role manifests 故意为空，start 使用 allow-empty-context；未将空引用诊断宣称为完整 manifest 验证通过。

## 执行进展与证据

用户已批准实施；task start 已完成，当前 in_progress，主直接实现/自审，不启动 Agent。自有输出目录 /tmp/runtime-contract-2ciFiy。

S1 完成：新增 execution-id.ts、tools.ts 与公开 launch v2；composition 与 retained-child gate 迁至新入口；公共标题组件已导出并接入 subagent_run。通知、Trellis、renderer 与实际调用测试已迁移并完成回归。

- 初次至第三次 typecheck 失败：删除旧公开注册后测试 fixture 导入和旧 launch 字段未迁移；逐步修复，未将这些失败归为无关基线。
- 第四次 typecheck 失败：新测试联合类型需 narrow execution_id、一个旧 metadata 断言引用；已修正。
- 首次聚焦 12/13 PASS：公共标题复用 keyHint 依赖全局 theme 初始化，违反独立使用预期。新增内部可关闭 hint 参数，公共组件不访问全局 hint，原有调用默认保持。
- 第二次聚焦 13/13 PASS，exit0：execution 规范编码、旧实例拒绝/既有 wait、schema admission 与独立标题测试。
- 第五次 typecheck 仍发现另一个旧 metadata 断言，修正后主迁移进入较大回归。
- S1 process 完整自然退出集合 391/391 PASS（此前7失败为旧身份文本与 fixture closure 未接新 facade）；retained-child 9/9 PASS，Agent/workflow actual factory 60/60 PASS，实际 cached loader 2/2 PASS，Trellis dispatch fake-pi PASS。
- 首次全套类型通过、1529/1536 PASS：7失败为旧身份/工具集合/实际 renderer与shared wait调用。迁移后第二次全套1535/1536 PASS，唯一失败在retained-child第一轮实际加载等待；固定400个setImmediate轮询仅约171ms，不等价于加载超时。改为10秒wall-clock预算/5ms轮询，保留失败条件与总test期限。
- S1 综合自然退出（runtime/process/task-ui/Agent actual factory/backend/loading/Beautify，concurrency8）635/635 PASS exit0。补充审阅handle kind与launch v2严格匹配后，最终全套1536/1536 PASS，类型通过。
- 未启动Agent；所有检查为main自审/实际测试，不宣称独立review。S1/S2 分别完成提交，见最终验收记录。

## 规划事实

- 完整读取 runtime facade/contracts/launch、Agent/Workflow management、process management、workflow task/source、AgentManager spawn/resume 与 retained-child loader gates。
- 规划阶段尚未运行产品测试；后续实际验证及失败重跑已记录于上文。
- 名称、两组职责、单执行句柄、不支持被替换 Agent 旧结果以及无兼容策略获批后实施。

## 最终验收记录

- S1 checkpoint `af02794`：64 个 scope 内文件，两管理入口/身份/消费者与公共标题迁移。主自审自然退出集合 635/635 PASS exit0，全套 pnpm check 类型 PASS、1536/1536 PASS exit0。
- S2 checkpoint `79a60fc`：monitor 指导/严格输入与最终 SDK prompt。聚焦 PASS；首次新增 prompt fixture 类型转换导致 typecheck 失败，修正 typed callback 后类型通过。自然退出集合 490/490 PASS exit0，最终 pnpm check 类型 PASS、1539/1539 PASS exit0。
- 所有产品验证采用 `PI_CODING_AGENT_DIR=/tmp/runtime-contract-2ciFiy/agent`，复用现有 SDK。全套配置 force-exit 不用于声称自然清理，独立自然退出集合提供生命周期证据。
- 最终 git diff --check PASS；主检查提交 scope 与运行工具引用，当前产品无 task_manage 注册/调用指导。旧历史 renderer 测试可读不代表执行兼容。未改项目生成资源、未新增基线 hash 行；仅包内 protocol 文案更新，其不属于 Python/agent/skill adapted baseline 清单。
- 主实现/自审，未启动 Agent，无独立 review；明确用户限制下的可用证据，不称独立审查。无线上 provider/真实终端视觉、个人安装/reload、push；未删除会话历史。
- 两阶段完成，用户明确授权“收尾”。本任务直接在 main 实施、无 PR/专属分支，因此归档使用 --skip-branch-validation，不伪造分支元数据。
- 最终产品相关文件无未提交改动；复用未变更代码的既有测试结果，本次不宣称重新运行全套。仓库其余并行改动保留。
- 后续候选：subagent_run、subagent_message、subagent_workflow 的整体参数/成组指导/返回契约规范化。本任务只迁移必要身份与管理引用，未整体改写其长说明或脚本 API；下一任务尚未创建或批准实施。
- 原始输出已完成检查，最终结果与失败原因已自包含记录。收尾仅清理本轮自有 /tmp/runtime-contract-2ciFiy，不触碰其他临时目录或历史材料。
