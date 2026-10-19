# 设计：Request Triage 与 AGENTS 区块刷新

## 1. 文档资源（R1–R3）

### 1.1 `resources/templates/agents-block.md`
按官方结构重写，保留 `<!-- TRELLIS:START -->` 和 `<!-- TRELLIS:END -->` 标记：

```
<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Pi Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, request triage, when to create tasks, skill routing
- `.trellis/spec/` — coding guidelines (read the relevant index before writing code)
- `.trellis/workspace/` — per-developer journals
- `.trellis/tasks/` — active and archived tasks (PRDs, design, implementation records, context manifests)

Trellis skills live in `.pi/skills/`; Trellis roles live in `.pi/agents/`.

Managed by Pi Trellis. Edits outside this block are preserved; edits inside may be replaced by Update resources (the previous file is backed up).
<!-- TRELLIS:END -->
```

不写 `/trellis-init` 的使用说明，也不写授权规则。

### 1.2 `resources/templates/workflow.md`
- **Phase Index 之后新增 `### Request Triage`**，内容沿用官方语义，并按 Pi 补充：
  - 只读探索、研究、解释：不需要 task。
  - 简单对话或小任务：只问一句“这轮要不要建 Trellis task”。用户说不要，本会话就跳过 Trellis 的 task 流程，直接修改。
  - 复杂任务：询问能否建 task 并进入 planning。用户拒绝时，不做大范围的内联实现，改为解释、澄清范围或建议拆小。
  - 同意建 task 不等于批准实现。
  - **不建 task 的直接修改**：用户的明确请求就是这次修改的批准，范围限于这条请求。仍要读相关 spec、自查、运行相关检查。改动留在工作区，不附带提交授权，用户另行明确要求才提交。范围扩大、需要设计取舍，或涉及高风险改动（权限、破坏性数据操作、公共兼容性、跨模块契约）时，停下来重新询问是否建 task。
- **Core Principles**：把 `Create a task only when preparing changes and after user approval.` 改为指向 Request Triage 的表述：建 task 需要用户同意；小任务在用户拒绝建 task 后可以直接修改。其余约束不变，例如 `Never infer approval from status`、push/archive 需要单独批准、task 内的阶段提交规则。
- **`[workflow-state:no_task]` breadcrumb**：

  ```
  No active task. Read-only exploration needs no task. Classify the request before changing anything.
  Simple conversation / small task: ask only whether this turn should create a Trellis task. If the user says no, skip Trellis for this session: edit directly within the request, self-check, leave changes uncommitted unless asked.
  Complex task: ask whether you may create a Trellis task and enter planning. If the user says no, explain, clarify scope or suggest a smaller split.
  ```
- 部署副本与模板的现有差异（research 那句）由 Update resources 统一对齐，以模板为准。

### 1.3 Skills
- `skills/trellis-start/SKILL.md` Step 4 的 No active task 分支：只读不需要 task；用户明确选择已有 task 时用 `active` 绑定；新工作按 workflow 的 Request Triage 分流，小任务经用户拒绝建 task 后走 direct edit。
- 各技能 “Pi Execution Boundary” 中的 `Read-only work needs no task; modifications require approval.` 在新规则下仍然成立（直接修改同样需要用户的明确请求），**保持不改**，避免无谓的哈希变动。
- 只修改实际冲突的措辞：已确认 `trellis-start:62` 有冲突，其余在实施时再 grep 一遍 `task/planning approval`、`New work still requires` 确认。

### 1.4 Baseline
- `template-baseline.json`：更新 `agents-block.md`、`workflow.md` 的 sha256。
- `skill-baseline.json`：更新改动过的技能文件的 sha256。
- runtime baseline 不变，runtime release id 也不变。

## 2. AGENTS 区块刷新（R4）

### 2.1 对 PRD 的一处修订：不在 manifest 中记录区块哈希
PRD R4 原计划由 manifest 记录区块哈希，用来区分“未修改”和“已修改”。但用户已经决定：已修改或无记录的旧区块也是**备份后替换**。这样两种情况的处理方式完全相同，manifest 里的哈希只会影响预览时显示的标签。

而增加 manifest 字段的代价不小：
- `validateManifest` 和 `oldManifest` 都对键集合做精确校验，必须把 schema 升到 4；
- 这会牵动 initialize、adoption、apply template、runtime 校验（`verifyRuntime`）、诊断这几条路径，以及大量 fixture；
- 运行中的其他会话在读取新 manifest 时，也存在兼容性风险。

**设计：** 以当前模板内容作为唯一判断依据。区块与模板逐字节相同就是 Current，否则一律在确认后备份并替换。manifest 结构不变。实施前需要你确认这处对 PRD 的修订。

### 2.2 托管区块范围
`.gitignore` 的 `# pi-trellis:ignore` 区块有同样的问题：它也只在 initialize 时写入。两者使用同一个 `replaceBlock` 路径，所以**一并纳入**，规则完全一致。`.gitattributes` 的 journal 属性是追加单行，不属于区块，不纳入。

### 2.3 `resourcePlan` 新增区块评估
在 `resources.ts` 中新增：

```ts
const ROOT_BLOCKS = [
  ["AGENTS.md", "agents-block.md", "<!-- TRELLIS:START -->", "<!-- TRELLIS:END -->"],
  [".gitignore", "root.gitignore-block.txt", "# pi-trellis:ignore:start", "# pi-trellis:ignore:end"],
] as const;
export function reviewRootBlocks(root): { path; state; next?: Buffer; before: Stamp | null }[]
```

- 计算方式：`next = replaceBlock(existing, template(source), start, end)`，与 adoption 使用同一套语义。区块不存在时追加，文件不存在时创建。
- 状态：
  - `next` 与现有内容相同 → `Current block`。
  - 不同 → update 模式下为 `Block update — backup and replace`，加入 changes 并标记 `backup: true`；repair 模式下为 `Block update available`，不写入。
- 区块重复、残缺，或区块外有未知标记时，`replaceBlock` 抛错，作为 conflict 处理，状态为 `Malformed block — preserved`。这一行进入 `report.conflicts`，Update resources 会整体阻止更新（沿用现有冲突语义），不会有任何写入。
- 文件不存在（极少见）时按 `Missing block — will restore` 创建。不需要备份，因为没有原文件。
- `Change` 增加可选字段 `backup?: boolean`；plan 签名包含该字段。

### 2.4 `applyResourcePlan` 备份
- 返回值从 `void` 改为 `string | undefined`（备份目录）。
- 在锁内、任何写入之前，对所有 `backup: true` 且 `before !== null` 的 change：先核对当前 stamp 与 `before` 一致，再用 `atomicFile` 把原文件复制到 `.trellis/.runtime/resource-backups/<uuid>/<path>`，目录权限 0o700。之后再执行现有的发布流程。
- 失败时的错误信息附带备份路径，不做自动回滚，与 Apply template 的做法一致。
- 区块文件的写入保留原文件的 mode。

### 2.5 `/trellis-init` UI（`command.ts`）
- 确认对话框中的 `Backup` 行：如果有区块变更，显示 `.trellis/.runtime/resource-backups/ (managed blocks only)`，否则保持 `none (no automatic rollback)`。
- 变更标签：区块行显示 `Update block`。
- 结果通知中显示备份路径。
- 现有的 `unchanged`、“update available” 判断自动包含区块变化，因为它们都基于 `changes`。

### 2.6 Check project（`diagnostics.ts`）
新增 `inventory:root-block` 诊断项，复用 `reviewRootBlocks`：
- 全部 Current → info/pass。
- 有过期区块 → warning，提示 `Choose /trellis-init → Update resources (previous file is backed up)`。
- 有格式错误的区块 → error，提示需要手工修复标记。

Check 只做报告，不写入。

### 2.7 不改动的部分
- Initialize 遇到已存在但内容不同的区块仍然报错（`appendBlock` 语义）。已初始化的项目应走 Update resources。
- Apply template 的 scope 列表不变。
- manifest schema 不变。

## 3. 文档与规范
- `docs/extensions/trellis/initialization.md`：说明 Update resources 也会刷新 AGENTS.md 和 .gitignore 中的 Trellis 区块，并在替换前备份到 `.trellis/.runtime/resource-backups/`。
- `.trellis/spec/development/index.md` 第 99 行：在 project copies 列表中补充 root managed blocks（AGENTS.md / .gitignore），同样通过 Update resources 发布。

## 4. 测试
- `workflow-policy.test.mjs`：断言模板包含 `### Request Triage`；`no_task` 区块包含 “ask only whether this turn should create a Trellis task” 和 “skip Trellis”；不再包含 `ask for task/planning approval`；`trellis-start` 包含 direct edit 分支。
- `resource-update.test.mjs`（新增用例）：
  1. 区块是当前模板：Current，无 change。
  2. 旧版区块（不同内容）：update 后区块等于模板，区块外的前后缀逐字节不变（包括 CRLF 前缀）；备份文件等于原文件；返回备份路径。
  3. 区块缺失但文件存在：追加，并备份。
  4. 区块格式错误（重复标记）：作为 conflict 处理，无写入，不创建备份目录。
  5. repair 模式：只报告，不写入。
  6. `.gitignore` 区块同样被刷新。
  7. preview 之后 AGENTS.md 被改动：apply 报 `Project or package changed`，无写入。
- 诊断：区块过期时报告 `inventory:root-block` warning。
- 回归：`initialization.test.mjs`（第 122 行用例使用的是模板本身，会自动跟随）、`adopt-block.test.mjs`、`apply-template.test.mjs`、`skill-resources.test.mjs`（技能哈希）。

## 5. 风险与回滚
- 区块替换前有备份；除此之外，每个阶段都单独提交，可以 `git revert`。
- 运行中的其他 Pi 会话：manifest 结构没有变化，runtime release 也没有变化，不影响它们的执行。
