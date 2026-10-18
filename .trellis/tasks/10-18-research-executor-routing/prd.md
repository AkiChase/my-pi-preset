# 补齐 research 执行者选择

## 目标

让主会话在现有流程中自然考虑 `trellis-research`，避免角色虽已可用却缺少选择提示。保持文案简短，不为 research 新造流程。

## 背景

- `trellis_dispatch` 已支持 `trellis-research`，角色定义已覆盖代码和技术调研以及现有授权边界。
- workflow 目前明确要求分别选择实现和检查执行者，但没有同等简洁的调研选择提示。
- brainstorm 的证据检查步骤要求调研，但没有关联 research 执行者选择。
- 用户认可按调研价值选择执行者，并明确要求不要增加太多文案。

## 范围与决策

1. 在 `extensions/trellis/resources/templates/workflow.md` 现有执行者选择位置补齐调研：小范围查阅由主会话完成；有独立价值的代码或技术调研可委派 `trellis-research`。
2. 在 `extensions/trellis/skills/trellis-brainstorm/SKILL.md` 现有证据检查步骤补一句，引用 workflow 的调研执行者选择规则，不复制规则。
3. 不新增章节、分派门槛、调研闭环或每任务必跑要求；不改 trellis-start、research 角色、dispatch 协议或无任务支持。
4. 实施前检查相关规范、资源维护方式和现有测试；不静默更新部署资源，不覆盖当前工作区的并行修改。若需要超出上述范围的资源更新，先说明再确认。

## 验收标准

- workflow 现有选择规则包含 research，且区分主会话小范围查阅与可独立委派的调研。
- brainstorm 在现有证据检查步骤关联该规则，不重复建立一套政策。
- 改动简短，不增加新的流程阶段、运行时行为或授权要求。
- 现有角色职责、实现和检查选择规则、授权边界保持不变。
- 实施时核对实际 diff，并运行相关文档/skill 资源检查；记录准确结果及未运行限制。

## 执行计划与授权

- 轻量单阶段任务，以本 PRD 为规划材料；拟由主会话直接修改并自审，不为这次已知位置的小范围文案调整刻意派发 research。
- 经实施批准后，完成文案及必要的范围内测试，核对并行改动后提交一个经过验证的阶段；无法安全隔离提交时报告阻塞。
- 用户已批准创建任务、保存规划，并以“开始吧”批准按上述范围实施；允许范围内验证和本地阶段提交，不授权资源部署、push 或归档。
- 验证计划：运行 `agent-documents.test.mjs`、`skill-resources.test.mjs`、`workflow-policy.test.mjs` 和 `apply-template.test.mjs`，核对文案、资源哈希和 `git diff --check`。资源正文变化需要同步对应 baseline 的当前哈希，保留历史来源字段。

## 实施与验证

- 已在 workflow 核心原则的现有选择句补齐 research，并在 brainstorm 证据检查步骤关联项目规则；未新增章节。同步两个 baseline 的当前资源哈希，保留来源字段；新增一个文案回归测试。
- 主会话自审实际 diff，确认实现和检查规则、角色、协议、阶段标题及授权边界未变；不需要新增 spec。部署副本和并行修改未纳入本任务。
- PASS：`PI_CODING_AGENT_DIR=<本次独立临时 agent 目录> node --test extensions/trellis/__tests__/agent-documents.test.mjs extensions/trellis/__tests__/skill-resources.test.mjs extensions/trellis/__tests__/workflow-policy.test.mjs extensions/trellis/__tests__/apply-template.test.mjs`，退出码 0，32/32 通过，无跳过、无强制退出；包含资源哈希、引用、模板维护边界、真实 Python 阶段提取与空 manifest 默认拒绝检查。
- PASS：`git diff --check`，退出码 0。
- 预期诊断：`task.py validate` 报 implement/check 两个 manifest 均为空；本任务直接实施和自审，没有派发角色，已用 `start --allow-empty-context`。不将该诊断描述为完整任务校验通过。
- 启动警告：当前 branch 和 base_branch 均为 `main`；后续 archive 会拒绝同分支 PR 目标。本轮不创建分支或归档。
- NOT_RUN：全量测试、typecheck、真实 provider 分派及资源部署；本轮是局部文案修改，没有 TypeScript 或运行时行为变化，测试不能证明真实模型会主动选择 research。
- 提交前检查曾因 PRD 末尾多余空行失败（退出码 2，未执行 commit）；已移除空行并重新检查。
