# 技术方案

## 最小行为差距与所有者

当前所有角色均要求 `in_progress`；目标只增加 research 对 `planning` 的支持。任务状态不代表用户授权证明，允许状态只是派发的必要条件，主会话仍须取得对应的研究或实施授权。

状态门禁跨 TS dispatch 和 Python native query/materials/prepare。research 已有独立材料角色，复用现有上下文、目录选择和执行占用机制，不新增执行模式或任务状态。

## 角色状态策略

TS 侧在 Trellis 现有任务/角色上下文模块集中定义状态断言，由 dispatch 入口及派发前复查调用；Python 侧在现有材料模块集中定义等价断言，由 query、执行材料校验和 prepare 调用。research 允许 `planning` / `in_progress`，implement/check 只允许 `in_progress`，其他值 fail closed。避免新增协议字段或冗余跨语言配置文件，以两侧矩阵测试约束一致性。

`source_materials(..., approved=False)` 是已有只读材料分析入口，不无差别升级成派发准入：执行入口在请求批准/执行校验时使用角色规则。保留原生诊断结构，并使错误说明角色及允许状态。

## 数据流及复查

1. 主会话解析显式 task 或会话 task，校验源根、runtime、adapter 和任务身份。
2. 根据角色校验任务状态；原生角色材料查询使用同一规则。
3. 未绑定任务在共享源目录派发；已绑定任务继续走 managed readiness，禁止回退。
4. 渲染前后重新查询材料/状态、binding 和必要的 checkout 快照，保留锁与占用检查。
5. 写入执行记录并通过现有 provider RPC spawn；子会话 `inheritDispatchTask` 重新查询原生角色材料，因而必须能接受 planning research。

源指纹刻意排除运行状态，不能替代状态复查。planning → in_progress 是 research 的合法转换；变为其他不允许状态须在派发前拒绝。子会话启动后已有 `requireChildAuthority` 的身份/路径复查语义不变，不新增自动取消。

## 预计变更边界

- `extensions/trellis/lib/task-context.ts` 或同层已有任务策略所有者：TS 角色状态断言。
- `extensions/trellis/lib/subagent-rpc.ts`：入口及共享路径复查使用角色规则，校正 tool 的阶段指导。
- `extensions/trellis/runtime/pi_trellis_worktree/materials.py`：角色执行资格与 prepare/materials 使用同一策略。
- `extensions/trellis/runtime/pi_trellis_worktree/manager.py`：query 委托策略，移除无差别状态门禁。
- `extensions/trellis/__tests__/` 及其 `python/`：状态矩阵、两条目录路径、子上下文和无副作用拒绝回归。
- `extensions/trellis/resources/`、`skills/`、`agents/`、`protocol/`：只修改实际冲突的阶段/权限指导，更新对应 adapted hashes；具体资源由实施前完整阅读确定。

`index.ts` 的 child authority 查询应复用原生规则，不单独增加 research 绕过。其完整调用链和现有测试必须在实施前阅读并验证。

## 权限、兼容和失败

不改变 task 参数和 agent_id 接口。无 active task 可显式指定任务，但完全无任务仍拒绝。research 的产品代码只读约束和源研究目录写授权保持不变；本修复不是 OS 沙箱。

worktree 创建/准备仍须已有用户授权、兼容 runtime 和持久 adapter，不能自动安装或更新部署。status/prepare/default implement 的行为不得被 research 例外放宽。未知身份、材料、占用和不确定启动仍按原机制拒绝或保留 lease。

## 验证与回滚

以既有 fake-pi dispatch 和 Python 临时仓库测试为主要证据，覆盖 child startup 的原生查询和矩阵一致性；不调用真实模型、个人配置或生产 worktree。耦合的代码、测试、指导和 adapted hashes 作为单阶段提交，失败时在未提交阶段修复，不部分交付。需要撤回时由主会话在授权内还原本阶段，不改写既有历史或部署目录。
