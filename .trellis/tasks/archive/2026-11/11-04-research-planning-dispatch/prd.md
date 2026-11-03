# 允许规划阶段派发 Trellis research

## 目标

让已创建但尚未启动的任务可以派发 `trellis-research`，支持先研究、完善方案，再批准实施的正常规划流程。实施和审查的状态门禁保持不变。

## 背景与已确认事实

- `extensions/trellis/lib/subagent-rpc.ts:150,171` 在入口及共享目录派发前复查中，无差别要求任务为 `in_progress`。
- `extensions/trellis/runtime/pi_trellis_worktree/manager.py:51-53` 的角色材料查询也要求 `in_progress`，因此仅修改工具入口不足以修复。
- `extensions/trellis/runtime/pi_trellis_worktree/materials.py:165-166,302-307` 的材料校验及 worktree 准备同样要求已启动。
- research 已有独立材料角色，不要求 implement/check manifest；必需材料仍包括 task.json、非空 PRD、workflow 和 spec 目录。

## 需求

### R1：按角色准入

| 角色 | planning | in_progress | 其他状态 |
| --- | --- | --- | --- |
| trellis-research | 允许 | 允许 | 拒绝 |
| trellis-implement | 拒绝 | 允许 | 拒绝 |
| trellis-check | 拒绝 | 允许 | 拒绝 |

缺失、损坏或未知任务记录继续拒绝。TS 和 Python 各自集中实现同一角色状态规则，不散落 research 特判。

### R2：任务身份与权限

会话无 active task 时，允许显式传入已有 planning task；完全无任务仍不能派发。research 不自动绑定主会话、不 start、不触发 start hooks、不修改任务状态，也不取得实施批准。research 不修改产品代码，写入源任务 `research/*.md` 仍须明确授权。

### R3：两种执行路径一致

共享源目录派发和 managed worktree prepare/readiness 均应用 R1。保留身份、材料、adapter、runtime、占用及源指纹检查；已有 binding 必须使用对应的已准备目录，不得回退源目录或临时创建 worktree。派发前复查仍执行角色状态校验，不把忽略 status 的要求指纹当作状态许可证明。

### R4：资源与指导一致

修改包内源文件、相关测试、工作流/技能/协议指导及受影响的 adapted hashes。不得直接修改已部署 `.trellis/scripts`、`.pi/skills`、`.pi/agents` 或已安装包来绕过运行时校验。保留历史 source hashes。

## 验收标准

- AC1（R1）：research 在 planning/in_progress 均成功；implement/check 在 planning 被拒绝，in_progress 保持成功；各角色对其他状态均拒绝。
- AC2（R2）：无主会话 active task，显式传 planning task 可研究；未指定任何可用 task 时失败，且无 spawn 副作用。
- AC3（R2）：研究不改变 task.json 状态、不触发 start hooks；研究产物权限指导保持明确。
- AC4（R3）：共享源目录、worktree prepare/readiness/dispatch 的角色矩阵一致；已绑定但未准备或损坏的任务不回退。
- AC5（R3）：异步查询/渲染期间状态转为不允许状态时，派发前拒绝且不 spawn；既有占用、身份和材料拒绝回归仍通过。
- AC6（R4）：资源校验、相关 Trellis TS/Python 测试及类型检查通过，记录完整集成检查结果或环境阻碍。

## 范围外

无任务 dispatch 模式；planning 阶段 implement/check；新增 OS 沙箱；自动 start/批准/创建或回退 worktree；依赖安装、个人配置同步、已部署资源更新、push、归档和历史材料清理。

## 授权边界

用户已同意创建任务及记录上述方案，并以“开始吧”批准按此方案实施。实施、验证和本阶段主会话本地提交已获授权；独立检查使用 check.jsonl。无 push、安装、个人同步、部署更新或归档授权。
