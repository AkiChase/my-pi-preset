# Agent 工具组实施与验证计划

## 状态与授权

用户已批准最终方案及具体 tool rule 草案，开始实施。主直接实现/自审，不启动 Agent，unused implement/check manifests 保持故意为空；start 使用 --allow-empty-context，不称完整 manifest validation 通过。无安装/个人 reload/push/历史重写/归档授权。

## S1：启动、恢复与消息参数契约

- [x] 完整读 index.ts/nested-tools.ts/spawn-input.ts/invocation-config.ts/相关 types 与实际调用方、tool-waits/backend-waits/input-errors/mention fixtures。
- [x] 建立工具专用共享准入：新建与恢复字段表、类型/非空/未知字段、能力字段 gate；prompt 必填而 type/description 模式必填。
- [x] 主恢复使用 existing.type，拒绝新建专用参数；嵌套恢复固定前台并拒绝后台字段；所有未恢复路径 isError。
- [x] 主/嵌套 message 真实 ID only；保留 @handle resolver、owner 和 running gate；明确 queued/sent。
- [x] 配置优先不变，扩展请求/实际覆盖披露；同步实际 clone/消费者的新建/恢复 payload 与 fixtures。
- [x] 参数指导/文档与合法示例同步，避免此阶段仍教恢复填 type/description。
- [x] 运行实际 host + direct admission 零副作用回归、mention model/retained-child/identity/ownership/waits；阶段自审、pnpm check 后立即精确提交。

### S1 验证矩阵

| 场景 | 断言 |
| --- | --- |
| 新建缺 type/description、未知字段、畸形 raw 对象 | 正确错误，零 spawn/schedule |
| 主恢复仅 resume/prompt；显式前后台 | 同一 agent_id、新 execution_id、既有 wait 不换实例 |
| 恢复填旧 type/description/name/start选项、嵌套后台false/true | effect 前拒绝；无法恢复/活跃实例 isError |
| 消息真实ID、别名、execution_id、越权、未运行 | 只有合法运行目标 steer/queue，成功不是处理确认 |
| 配置覆盖六类参数；省略/一致值 | 优先级不变，披露完整且不误报 |
| mention model / @handle 分流 | 新参数合法；已尝试失败不新增重试，名称仍可路由 |
| nested allowlist/depth/extensions deny/retained-child | 权限、收集 gate、cleanup 不回退 |

## S2：workflow 来源与错误契约

- [x] 完整读 workflow/saved.ts/task.ts/source 及 index workflow registration/execution、实际 workflow fixtures。
- [x] 移除 title/description，工具 schema/direct admission 来源互斥；新启动恰好一个，重放零/一个，空值非法。
- [x] 保留 resumeFromRunId/args/journal prefix 策略及 hooks API；不修改脚本内部 workflow() 来源 policy。
- [x] 修正 meta/来源/JSON args author error 的 isError 和保存前拒绝，不将 child/null 容忍改为全局失败。
- [x] 更新工具参数指导/文档、消费者和实际回归，必要资源 hash 耦合提交。
- [x] worker 自然退出、实际 host workflow 回归与 pnpm check；阶段自审后立即提交。

### S2 验证矩阵

新启动 0/1/2/3来源；重放 0/1/多个来源；空串/null/非字符串；移除字段；不存在前次执行/保存脚本不可读；meta malformed/oversized source/nonJSON args；合法 name/path/inline、新脚本重放。拒绝断言零保存/新task/worker。合法路径仍后台通知、agent_manage 可收结果；hooks author error/null/stop/session ownership 保持。

## S3：统一官方指导与配置删除、最终集成

- [x] 完整读 settings 与 menu/save wiring、原 full/compact/custom/workflow 全部说明和相关消费者，建立内容保留清单。
- [x] 删除模式配置/类型/setter/sanitizer/UI/save snapshot 和模板读取，不删除用户文件；共享纯 builder，动态内容无需模板。
- [x] 三工具各一组 usage，主/嵌套正确区分；明确默认、配置优先、参数表、结果和管理协作，例子集中。
- [x] workflow 脚本必需 API 与限制保持，巨大 description 不再承载整篇使用文档；同阶段完成 SDK prompt integration。
- [x] docs/spec/必要包资源哈希/manifest 同步，搜索所有 live removed guidance/config 与多来源例子，保留历史证据。
- [x] 实际 SDK prompt：单组、peer、hidden/disabled、配置true/false、工作树/调度开关、可用Agent列表；旧模板存在且非法也不读取、不改变官方指导。
- [x] 自然退出集成、完整 pnpm check、git diff --check 与最终 scope 自审后立即提交。

## 验证命令

执行前创建仓库外自有 mktemp 目录，日志/临时 drivers 放其中；所有测试设置 PI_CODING_AGENT_DIR 到隔离配置，复用现有 SDK，不安装。以下文件名已核对存在；新增针对性测试加入标准 discovery。

```sh
node --test extensions/agent-tasks/__tests__/input-errors.test.ts extensions/agent-tasks/__tests__/foundation.test.ts extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts extensions/agent-tasks/__tests__/loading.test.ts
node --test extensions/agent-tasks/__tests__/workflow.test.ts extensions/agent-tasks/__tests__/workflow-failures.test.ts extensions/agent-tasks/__tests__/workflow-failure-host.test.ts
node --test extensions/runtime-tasks/__tests__/retained-child.test.ts extensions/runtime-tasks/__tests__/execution-id.test.ts extensions/runtime-tasks/__tests__/prompt.test.ts
node --test --test-concurrency=8 extensions/agent-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts
node --test extensions/trellis/__tests__/*.test.mjs scripts/pi-manifest.test.mjs
pnpm check
git diff --check
```

不使用全套 force-exit 证明自然清理。范围内注册工具的 prompt assembler 用实际 SDK introspection 测试（参考现有 runtime prompt 测试）。新增具体测试可取 tool-contract/prompt 命名，执行时记录实际命令，不把计划命令称为已运行。

## 提交与报告

每阶段代码/测试/指导/消费者一致后自审与提交，普通 git commit 不带路径。混合文件仅选择本任务 hunks；无法安全分离则报告，不提交并行改动。独立审查不可用，不称自审独立。

执行记录包含精确命令、环境、exit、计数、失败原因与重跑；不把模拟模型/组件称线上质量或真实终端视觉。无新增产品执行测试已运行；本轮只完成规划和源码定位。

## 最终批准前检查

- [x] 用户范围选择已反映到 PRD，冲突报错旧决策已替换为配置优先。
- [x] PRD 收敛，无重复临时 brainstorm/未解决产品选项。
- [x] 三阶段可独立验证并有立即提交 checkpoint。
- [x] 主实现/自审与 no-Agent 约束明确。
- [x] 用户审阅完整摘要和具体 tool rule，批准实施，随后 start。

## 执行记录

- 本轮自有输出目录：/tmp/agent-contract-ml1JvY；验证设置 PI_CODING_AGENT_DIR 指向其中 agent 子目录。
- S1 主/嵌套工具专用准入、恢复字段、真实消息 ID、六类配置覆盖披露和成组指导已完成。
- 初次类型检查 FAIL：嵌套 AgentStatus 没有 paused，移除错误比较后 typecheck PASS。
- 初次聚焦 FAIL：旧 fixtures 给 resume 补 type/description，且 direct test 期待忽略 max_turns；迁移为拒绝并保留正确 user-turn-budget 生命周期断言。重跑 78/78 PASS。
- 首次 pnpm check 1415/1419 PASS：4 项 input-errors 仍断言 throw/旧冲突字段/含undefined的覆盖快照；修正后 input 集合 PASS。
- S1 自然退出集合 104/104 PASS。第二次全套1419/1420 PASS：未修改 task-ui editor 的 Date.now()-3999 可见期断言因跨过4000ms失败；单文件重跑 PASS，未修改或放宽 UI 测试。第三次 pnpm check 类型 PASS、1420/1420 PASS exit0。
- 最终恢复披露审阅修正：恢复不重复输出原启动请求覆写，主恢复只披露本次 mode 覆写，嵌套恢复无本次启动覆写。修改后实际 input/tool-waits/backend/retained-child 自然退出重跑 PASS（101项）；未因此声称重新运行完整套件。
- 所有输出位于 /tmp/agent-contract-ml1JvY，环境 PI_CODING_AGENT_DIR=/tmp/agent-contract-ml1JvY/agent；无独立Agent审查/线上provider/真实终端视觉。
- S1 checkpoint `05905e5` 已提交。
- S2 checkpoint `21c273e` 已提交：来源互斥、删除无效标题字段、复用 validateScript/assertBoundarySafe 在保存前拒绝。首次聚焦 FAIL 为纯工具 helper 引入 runtime.ts 的 Node strip-only 参数属性加载限制；将 JSON 验证留在真实 host owner、工具字段 helper 保持纯净后聚焦 PASS。首次全套1421/1422 PASS：旧测试预期 BigInt args 创建失败任务，迁移为保存前拒绝并断言执行数未变。自然退出165/165 PASS，最终类型/全套1422/1422 PASS。
- S3 已删除三模式配置、UI、持久化 wiring、模板读取；官方三工具规则在实际 SDK prompt 成组。首次聚焦21/22 PASS：message 仍保留长 description，缩为职责一句后22/22 PASS。自然退出集成404/404 PASS。
- S3 第二次配置全套仍1422/1423 PASS，唯一同一UI时间边界；单文件与本任务聚焦37/37 PASS。未修改UI测试，降低全套 file concurrency=1 后同样 discovery 的1423/1423 PASS exit0，保留默认并发8失败事实，不宣称 pnpm check 完整通过。
- 最后仅修改workflow两条指导文字（重放args不继承，低核心并发至少1）；actual SDK prompt/准入聚焦重跑PASS。类型检查PASS，git diff --check PASS；自然退出404/404 PASS覆盖S3产品/生命周期。
- 用户另批准范围外小修复：仅 editor.test.ts 的4000ms可见期测试使用 t.mock 固定 Date.now，保持3999/4000精确边界，不改产品时间政策。聚焦13/13 PASS、默认并发 pnpm check 类型与1423/1423 PASS exit0；单独提交 `fab4a79`。此前并发失败事实保留，最新默认全套已通过。
- S3 checkpoint `b889368` 已提交。三个阶段完成；任务仍 in_progress 等待用户验收/收尾授权，不自动archive/journal。任务文档当前未纳入Git，最终收尾时选择保留材料并提交。
- 自审修正规划误列 nested name：该入口 schema 和 options 原本无 name，指导/准入同步不提供此字段，不扩大能力。S3 scope验收通过，默认全套的非本任务UI时间边界作为已知未修复限制报告。

## 最终验收与收尾

用户已验收并明确授权收尾。提交：05905e5（启动/恢复/消息）、21c273e（workflow准入）、b889368（统一指导）、fab4a79（测试时钟）。最新默认并发 pnpm check 类型与1423/1423 PASS，UI聚焦13/13 PASS，S3自然退出404/404 PASS；历史失败及修复原因保留于前文。实施清单表示阶段完成，不宣称每条计划命令均执行。

无独立Agent审查、线上provider或真实终端视觉；未安装/reload/push/重写历史。产品改动已提交，其他并行改动保留。用户模板文件未删除。只保留PRD/design/implement/元数据及故意为空的角色JSONL，不归档原始日志。

第一次收尾bash在准入层被Trellis runtime release检查阻止，没有启动命令或归档。用户执行Check后重新准入成功；Check为只读，20项通过、2项未验证，不将其称为全面运行环境验证。任务直接在main实施且无PR，归档使用 --skip-branch-validation，不伪造分支。

已核查本轮日志与失败诊断，结论自包含；清理仅限自有 /tmp/agent-contract-ml1JvY。未授权开始下一任务；建议先只读核查剩余工具归属和契约缺口，再决定下一组范围。
