# 实施计划

## 授权边界

用户已通过“开始吧，每个阶段check后可以commit，有问题可以提”批准本方案实施、验证与分阶段本地提交。完整范围包括共享层、三个消费者迁移与项目 dev/testing 规范；不安装、不个人 sync/reload、不修改 SDK、不 push、不归档、不动其他任务未提交改动。

## 执行与审查

主会话完成S1直接实现与复核；S2消费者迁移及fixture调整委派 trellis-implement，主保留spec/任务集成与最终实际diff复核。独立 trellis-check 审查共享 session/lifecycle、跨插件协议与消费者迁移。派发前 curate check.jsonl，仅引用真实 specs/任务研究材料并由 reviewer 完整读取源 PRD/design/implement。若独立审查不可用，报告阻塞，不将主自检称为独立审查。

## S1：共享 owner/API 与独立入口（完成）

- [x] `extensions/widget-display.ts` 和 `extensions/shared/widget-display/`：唯一宿主发布 owner、区域组合、slot registry、同步 bus 协议与有限客户端 handle。
- [x] 聚焦测试：排序、内容保留、空区域删除、缺失 owner、独立 runtime、身份、关闭/迟到、重入与异常清理。
- [x] actual SDK loader + fake UI sink：不同 facade 同 bus、不同 bus、两种加载顺序和runtime retirement/reload。
- [x] 项目 development/topic/testing specs 的共享契约、入口文档与导航；S2将删除临时legacy例外。
- [x] 独立review与main重跑：typecheck exit 0、focused 36/36自然退出、whitespace/links检查通过；checkpoint见执行记录。

## S2：全部消费者迁移与规范强制

- [x] Recap 的 publish/hide/rollback 接入 slot handle，保留现有 material/epoch fencing、主题 factory、迟到取消与保存行为。
- [x] Trellis refresh/clear 接入 slot；原有 status模式与无项目/unsupported/runtime 失败清理保持不变；Trellis 测试继续 fake pi 逻辑边界，不添加其真实终端/UI测试。
- [x] Process Tasks hint 的 show/diff/clear、session_start 与 lifecycle shutdown 全部接入；保留 belowEditor、foreground derivation与 shortcut展示。
- [x] 更新 consumer tests，新增实际 SDK fake UI 组合回归：Trellis先出现、Recap后出现仍排首，任意更新/撤销不漂移、不重建其他组件；第三方widget不清除。
- [x] 生产边界检查禁止共享owner外直接 setWidget；规范包含以后内置 widget 声明slot/使用client与清理职责。
- [x] 更新相关用户文档，明确编辑器区域固定排序与第三方限制。
- [x] 主审查actual diff + 独立 review + 聚焦回归 + full pnpm check，立即 scoped stage commit。

## 验证命令

所有执行输出放本次拥有的仓库外临时目录；设置临时 PI_CODING_AGENT_DIR 和已有 SDK PI_SDK_DIR。不使用个人文件/网络provider。

S1：新增路径确定后使用 `node --test extensions/shared/widget-display/__tests__/*.test.ts scripts/pi-manifest.test.mjs`，`pnpm typecheck`；真实SDK测试通过已有SDK并使用临时session和fake UI，不能宣称真实终端实测。

S2：`node --test extensions/shared/widget-display/__tests__/*.test.ts extensions/session-assist/recap/__tests__/*.test.ts extensions/session-assist/shared/__tests__/*.test.ts extensions/process-tasks/__tests__/hint.test.ts extensions/process-tasks/__tests__/activation.test.ts extensions/process-tasks/__tests__/lifecycle.test.ts extensions/process-tasks/__tests__/index.test.ts`；`node --test extensions/trellis/__tests__/project-activation.test.mjs extensions/trellis/__tests__/runtime-contracts.test.mjs`（根据实际affected tests补充）；`pnpm check`；`git diff --check`；相关文档links、spec英语与发现索引检查。

保持首次失败事实与修复/重跑关系，记录准确exit、environment和NOT_RUN。全套既有forced-exit不能替代focused natural-exit。final integration复查staged/unstaged/untracked与所有stage checkpoints，安全清理本次owned临时材料。

## S1 执行记录（已验证）

- 主会话实现共享 owner/client/contracts、独立 widget-display 入口与基础回归；dev/testing 规范、README 与用户页接入。
- 临时执行目录 `/tmp/widget-display.T4VDP6`，隔离 agent 子目录；当前已安装 SDK 解析到 Pi 1.3.0（不是前任务使用的 1.2.0）。没有安装或个人配置操作。
- 首次 `pnpm typecheck` exit 2：共享 owner 闭包引用 Session 类型收窄错误（已修正）与另一个会话新增 `process-tasks/__tests__/bash-prompt.test.ts` 的 SDK system-prompt.js 引用不可解析；后者不擅自修改。
- 基础 focused `node --test extensions/shared/widget-display/__tests__/*.test.ts scripts/pi-manifest.test.mjs` 17/17 PASS，自然退出。
- 新增 actual SDK loader 用例后 focused 17 PASS/1 FAIL：fixture 直接调用 loadExtensionFromFactory 时未传 required runtime，导致 undefined.assertActive；不是产品 owner failure。独立 reviewer 接管共享代码/tests 的修复和深度复核，主会话不并行修改同文件。
- 独立 `trellis-check` 已派发，共享源目录，限定新共享层/S1 tests，禁止改其他任务文件或提交；重点补 factory/setter/dispose 重入、失败 mount recovery、客户端 shutdown ack、session isolation 与 subscription retirement。
- 文档/spec 相对 links 检查与 `git diff --check` PASS；spec discovery 确认为 development/testing。
- 独立 reviewer 完成并修复：串行宿主写入、双区域先关 admission、deferred factory/reentrant ack fencing、失败 mount rollback/retry、独立 loader graph/runtime 隔离。主已完整读取最终 owner/client/tests，确认仅修改授权共享代码。
- 工具更新后旧 agent ID 在当前 scope 无法 retrieval；保留其已送达完成通知，不推测截断结果；main 依据实际文件重新验证。
- main 最终 `pnpm typecheck` exit 0；focused 36/36 PASS 自然退出，exit 0；`git diff --check` exit 0。之前外部 bash-prompt SDK 引用错误已随其他会话修复消失，main未修改该文件。
- S1 checkpoint `24f15e2`；提交后发现spec文件混入并行Bash规范hunks，用追加 `e710dd7` 分离并恢复对方内容为未提交状态，没有重写历史或丢弃并行工作。
- S2迁移范围已派发 implement role，主不编辑消费者/fixture文件，只维护spec/任务材料。第一次派发因空implement.jsonl被拒（未启动agent），curate真实spec引用后成功派发。

## S2 执行记录（已验证）

- implement role完成三个消费者与测试fixture迁移，主读取actual product diff确认client activation scope、Recap factory有效性、Trellis刷新generation、hint freeze/display差分。
- 实现角色验证：扩展focused 242/242自然退出，最终affected rerun 78/78、typecheck通过；full首次1565 tests中8失败（1 shared ordering、5 Trellisunsubscribe fixtures后修复、2全量fixture问题）。日志保留 `/tmp/widget-consumers.A5WCbd`，未提交。
- main修复shared consumer-first second-session startup loss：真实session_start handler通过版本化bus同步activate owner，任意set不授予切换session权限。修正直接受影响的beautify mock on unsubscribe、agent host loading shutdown计数5。
- main重跑shared/activation/boundary/Recap/process hint+activation/Trellis project activation：118/118自然退出，exit0。
- 已派发S2独立review，允许只修授权widget/consumer/test/docs；主并行只维护spec/task，不重叠代码。
- 独立review发现并修复Trellis stale manager刷新可推进generation/清除当前display的问题，补factory scoped manager/session identity fencing与late startup回归；actual SDK loader补两种顺序下initial/later session自动发布。
- 独立focused 246/246、extra 25/25通过；最终独立 `pnpm check` 1567/1567 exit0。之前full第一次retained-child.test.ts的400 setImmediate启动等待在并行负载中到期；原fixture不改，单独复现与不重叠最终全量通过，失败保留 `/tmp/widget-review.boPwpr/final-full.log`。
- main完整读final共享与消费者diff并核对review改动；主final focused 168/168自然退出、`pnpm check`类型与全量1567/1567、82 suites exit0。现有full forced-exit不替代focused自然退出。
- `git diff --check`与spec links/discovery PASS；无独立lint script。testing spec历史dated logs/research冲突在主授权规范维护范围修正为implementation记录+仓库外raw+selected evidence。
- 全部规范legacy例外已去除；S2准备即时提交，保留并行Bash spec hunks不纳入本提交。真实终端/线上质量NOT_RUN，无个人reload、install或push。

- S2 checkpoint `8841a56`（`feat(widget-display): migrate all built-in widgets to stable slots`），包括全部消费者、聚焦/loader/源边界测试及最终dev/testing规范。main staged diff逐项核对只包含widget hunk；另一会话Bash规范已独立提交，保留其内容不删除。
- 本任务实施两阶段完成，暂保持active/in_progress等待用户验收与归档授权；未运行真实终端或线上模型。临时raw main/implement/check目录已在检查完失败/重跑关系后安全清理（仅本次owned目录），无repo原始日志。

## 规范精简

用户要求规范避免多余内容。已精简dev index/topic为slot注册、client接入、排序和内容所有权约束；删除内部bus/lease机制与具体清理测试场景清单。testing spec只保留验证入口与影响范围，具体场景仍在测试代码，未修改产品或测试行为。主自检相对links与git diff --check均PASS；纯规范修改不重跑产品全量测试。

## 交付限制

真实终端视觉、键盘、resize/theme交互与线上生成质量若未运行须明确 NOT_RUN。组合内部稳定排序不等于控制未接入第三方 widgets。缺失共享 owner 不静默 fallback；用户需保持新内置入口加载（manifest与文档说明）。
