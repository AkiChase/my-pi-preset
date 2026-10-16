# 实施计划

## 授权边界

用户已通过“开始吧，每个阶段check后可以commit，有问题可以提”批准本方案实施、验证与分阶段本地提交。完整范围包括共享层、三个消费者迁移与项目 dev/testing 规范；不安装、不个人 sync/reload、不修改 SDK、不 push、不归档、不动其他任务未提交改动。

## 执行与审查

主会话直接实现，理解跨入口与消费者契约后控制修改范围；独立 trellis-check 审查共享 session/lifecycle、跨插件协议与消费者迁移。派发前 curate check.jsonl，仅引用真实 specs/任务研究材料并由 reviewer 完整读取源 PRD/design/implement。若独立审查不可用，报告阻塞，不将主自检称为独立审查。

## S1：共享 owner/API 与独立入口

- [ ] `extensions/widget-display.ts` 和 `extensions/shared/widget-display/` 实现唯一宿主发布 owner、区域组合、slot registry、同步 bus 协议与有限客户端 handle。
- [ ] 聚焦测试覆盖排序不随发布/更新变化、文本/组件保留、空区域删除、无 owner、独立 runtime、相同 id 不同 manager、关闭/迟到、factory/setter/dispose 重入与异常清理。
- [ ] 通过实际 SDK loader + fake UI sink 验证不同 pi.events facade 共享 underlying bus、reload订阅清理、客户端先后加载均可使用；不以模块缓存单例替代 cross-entry 证明。
- [ ] 项目 `.trellis/spec/development/index.md` 必须写入强制 dev 规范（可链接有必要的新专题 spec）：唯一 owner、声明 slot/区域/排序、client 接入、session/activation fencing、撤销/清理职责、禁用消费者直接 setWidget、第三方边界；不能只写在 task design 或用户文档。
- [ ] `.trellis/spec/testing/index.md` 写入入口检查及排序、身份、reload、重入/失败清理等验证要求，保持 development/testing 索引和 spec discovery 有效。S1先记录已实现shared契约，S2与全部消费者迁移一起更新最终约束。
- [ ] 主自检与独立 review，focused natural-exit + typecheck/affected loader tests，通过后立即 scoped stage commit。

## S2：全部消费者迁移与规范强制

- [ ] Recap 的 publish/hide/rollback 接入 slot handle，保留现有 material/epoch fencing、主题 factory、迟到取消与保存行为。
- [ ] Trellis refresh/clear 接入 slot；原有 status模式与无项目/unsupported/runtime 失败清理保持不变；Trellis 测试继续 fake pi 逻辑边界，不添加其真实终端/UI测试。
- [ ] Process Tasks hint 的 show/diff/clear、session_start 与 lifecycle shutdown 全部接入；保留 belowEditor、foreground derivation与 shortcut展示。
- [ ] 更新 consumer tests，新增实际 SDK fake UI 组合回归：Trellis先出现、Recap后出现仍排首，任意更新/撤销不漂移、不重建其他组件；第三方widget不清除。
- [ ] 生产边界检查禁止共享owner外直接 setWidget；规范包含以后内置 widget 声明slot/使用client与清理职责。
- [ ] 更新相关用户文档，明确编辑器区域固定排序与第三方限制。
- [ ] 主审查actual diff + 独立 review + 聚焦回归 + full pnpm check，立即 scoped stage commit。

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
- S1 将提交共享owner、tests、基础spec与入口文档；消费者仍是明确S2迁移项。

## 交付限制

真实终端视觉、键盘、resize/theme交互与线上生成质量若未运行须明确 NOT_RUN。组合内部稳定排序不等于控制未接入第三方 widgets。缺失共享 owner 不静默 fallback；用户需保持新内置入口加载（manifest与文档说明）。
