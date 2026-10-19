# Restore Trellis request triage and AGENTS block

## 背景

当前 pi-trellis 在无活动任务时，会把 agent 引向“改代码必须先开 task”。证据：

- `extensions/trellis/resources/templates/agents-block.md` 把授权规则写进 AGENTS 区块：`Task creation, implementation, Git commits and archival require user approval`，把“批准”与“建任务”并列。区块首行还在教 agent 怎么用 `/trellis-init`，这是写给人看的操作说明。
- `workflow.md` 的 `[workflow-state:no_task]` breadcrumb：`Before modifying code, ask for task/planning approval.`，没有对请求分类。
- `trellis-start` SKILL 的 description 写着 “routes to brainstorm, direct edit, or task workflow”，但 Step 4 正文没有 direct edit 分支。

官方 Trellis（`mindfold-ai/Trellis` main 分支）的做法：
- AGENTS 区块只做目录指引，指向 `.trellis/` 下的资源，不写授权规则。
- `workflow.md` 有 `### Request Triage` 一节，`no_task` breadcrumb 的意思是：先判断请求大小；简单对话或小任务只问一句“这轮要不要建 Trellis task”，用户说不要就本会话跳过 Trellis；复杂任务才询问能否建 task 并进入 planning。

另一个独立缺陷：已经初始化的项目没有任何入口会刷新 AGENTS.md 托管区块。
- Initialize 遇到已有区块而内容不同时报错，不会更新。
- Update resources 不处理 AGENTS.md。
- Apply template 的 `TEMPLATE_PATHS` 不包含 AGENTS.md。
- Check project 不检查区块是否过期。
- manifest 不记录区块哈希。

本项目 `AGENTS.md` 的区块是 2026-10-14 由迁移前的外部 pi-trellis 包写入的（提交 `3bedbcc`），和本仓库历史上任何一版模板都不一致。

## 目标

1. 小改动能按官方方式分流，不必开 task。
2. AGENTS 区块回到官方风格，只做目录指引，规则统一由 `workflow.md` 承载。
3. 已初始化项目可以通过 Update resources 把 AGENTS 区块刷新到当前模板，过期状态能被 Check project 发现。

## 需求

### R1 AGENTS 区块
- 按官方风格重写 `agents-block.md`：说明项目由 Trellis 管理，列出 `.trellis/workflow.md`、`spec/`、`workspace/`、`tasks/` 的用途，以及 Pi 下的技能和角色位置（`.pi/skills/`、`.pi/agents/`），并声明区块由 Trellis 管理、可能被覆盖。
- 删除 `/trellis-init` 的使用说明，删除授权规则。

### R2 Request Triage 与 `no_task` breadcrumb
- 在 `workflow.md` 模板中加回 `Request Triage` 一节，并把 `no_task` breadcrumb 改为官方语义：
  - 简单对话或小任务：只询问本轮是否创建 Trellis task；用户拒绝则本会话跳过 Trellis。
  - 复杂任务：询问能否创建 task 并进入 planning；用户拒绝时不做大范围的内联实现。
  - 只读探索不需要 task。
- 不在官方方案上进一步放宽：小任务仍要先问这一句。
- 保留本项目已有的、作用于 task 流程内部的约束，例如不能从任务状态推断授权、push 和归档需要单独批准、阶段提交规则。
- 用户拒绝建 task 后的直接修改：仍需读相关 spec、做自查并运行相关检查。改动留在工作区，不附带提交授权；只有用户另行明确要求时才提交。这条要写进 Core Principles，不能让 agent 自行推断。

### R3 trellis-start Step 4
- 在 No active task 分支中补上分流：按 Request Triage 处理，小任务经用户拒绝建 task 后走 direct edit，使正文与 description 一致。
- 检查其他技能（如 `trellis-brainstorm`、`trellis-meta` 的 customize 引用、各技能里的 “Pi Execution Boundary” 段落）中是否有与新规则冲突的“修改必须先开 task”类措辞，同步修正。

### R4 AGENTS 区块刷新（Update resources）
- Update resources 负责刷新 AGENTS.md 托管区块，行为与官方 `trellis update` 的按块替换一致：只替换 `<!-- TRELLIS:START -->` 到 `<!-- TRELLIS:END -->` 之间的内容，区块外的项目内容原样保留。
- 不在 manifest 中记录区块哈希：以当前模板为唯一判断依据，manifest schema 不变（见 design 2.1）。
- 刷新规则：
  - 区块与 manifest 记录一致：直接替换。
  - 区块被修改过，或属于没有记录的旧版本：在预览中明确标出，用户确认后先把原 AGENTS.md 备份到 `.trellis/.runtime/` 下，再替换。
- 区块重复、残缺或格式错误时报错，不做任何写入（沿用 `replaceBlock` 的现有校验）。
- Check project 报告 AGENTS 区块缺失、过期或被修改。

### R5 资源与部署同步
- 更新 `template-baseline.json`、`skill-baseline.json` 中受影响的哈希，以及其他需要变更的 baseline。
- 对齐本项目的部署副本（`AGENTS.md` 区块、`.trellis/workflow.md`、`.pi/skills/`），并通过新的 Update resources 路径验证刷新确实生效。
- 部署副本 `.trellis/workflow.md` 当前与包内模板不一致（模板多了 research 那句），以包内模板为准。

## 验收标准

- [ ] `agents-block.md` 为官方风格目录指引，不含 init 操作说明和授权规则。
- [ ] `workflow.md` 模板包含 Request Triage；`no_task` breadcrumb 体现小任务只问一句、用户拒绝即跳过 Trellis。现有的 `no_task` / `task_error` 分流测试和 breadcrumb 解析仍然通过。
- [ ] `trellis-start` Step 4 有 direct edit 分支，与 description 一致；其他技能中没有冲突措辞。
- [ ] Update resources 能把旧版或过期的 AGENTS 区块刷新为当前模板，区块外内容逐字节不变；有针对未修改、已修改、旧版无记录、格式错误四种情况的测试。
- [ ] Check project 能报告 AGENTS 区块过期。
- [ ] baseline 哈希与资源一致，相关测试套件通过。
- [ ] 本项目的部署副本已刷新，并与包内模板一致。

## 不在范围内

- 不改 Apply template 的 scope 列表。
- 不修改历史任务和归档。
- 不 push。

## 已定决策

- AGENTS 区块由 Update resources 负责刷新，Apply template 不负责。
- 无 task 的直接修改不附带提交授权。
- 被修改过或无记录的旧区块：备份后替换。
- 不在官方方案上进一步放宽小任务分流。
- manifest 不记录区块哈希，schema 不变。
