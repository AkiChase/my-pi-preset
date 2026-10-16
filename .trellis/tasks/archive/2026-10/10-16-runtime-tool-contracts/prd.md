# 运行任务管理接口拆分与 Monitor 契约规范化

## 目标

把混合的 task_manage 拆成 process_manage 和 agent_manage，明确进程日志与 Agent/workflow 执行结果的职责，减少组合参数与双 ID。沿用 bash 工具说明规范，完善 monitor 与两组管理协作。

## 授权

用户已批准开始实施，并确认公共工具调用标题组件增量；随后明确授权“收尾”，包含本任务验收、归档、journal 和范围内本地提交。主自行实现、自审，不启动 Agent。不包含安装、push 或历史重写。

## 范围与决策

- process_manage：bash/monitor，task_id，list/status/output/wait/stop/search/stats；日志字节分页/正则搜索，不接受 run_id/verbose。
- agent_manage：subagent/workflow，execution_id，list/status/output/wait/stop；kind 仅 list 筛选，verbose 仅 subagent output/wait。
- 稳定 agent_id 留给 subagent_message 和 subagent_run resume；每次 Agent 执行生成新的 execution_id。workflow 不当成 Agent 会话，仍与 Agent 共用执行管理，不独立 workflow_manage。
- Agent resume 后旧 execution_id 新请求报失效；已开始 wait 保持原实例绑定。当前已完成执行可正常取结果。不新增历史结果仓库，不删除对话/日志文件。
- 旧 task_manage 移除，不保留别名、路由、字段或配置映射；产品内调用指导、通知、资源与测试迁移，外部由用户迁移。
- 从 Beautify 导出无副作用、独立可用的公共标题组件，复用现有 toolHeading。自定义 renderCall 不导入扩展 index；仅统一工具原名与摘要，不注册执行/消费结果/另包背景。此次接入 Agent 和新管理工具，不全面重做其他插件结果渲染。
- 对话内工具标题与 label 使用真实 lowercase snake_case 名称：subagent_run、subagent_message、subagent_workflow、monitor、process_manage、agent_manage；Agent 类型/别名作为次级信息，不替代工具名。用户已明确要求同步，包含嵌套入口与默认/定制 renderCall 回归，不扩大到 Agent 菜单业务名称。
- 保留共享后端、精确内部身份、coordinator、Task Panel、owner scope、通知消费、防重复与 session fence。不改调度/worktree 策略，不搬迁 workflow 模块。
- monitor 保持合法接口行为；时间 schema 明确正数，直接调用未知/非法形状在 effect 前拒绝；不改通知节奏与 source/终止行为。
- 使用官方 description/promptSnippet/promptGuidelines，tools 一句、rules 单组 usage、示例集中；不新增 prompt 组装框架，不常驻迁移历史。

## 工具组协作

| 启动/操作 | 管理与结果 |
| --- | --- |
| bash 有限命令 / monitor 持续观察 | process_manage 使用 task_id |
| subagent_run 启动/恢复 Agent / subagent_workflow 启动/重放脚本 | agent_manage 使用 execution_id |
| subagent_message 运行中发消息 / subagent_run resume 会话 | 使用稳定 agent_id，不进入结果管理入口 |

具体参数表、英文指导、公开 envelope version:2、句柄编码与迁移文件范围见 design.md。

## 现状证据

- runtime-tasks/facade.ts、contracts.ts：七分支重复 schema 与按 action/target 的实际校验；内部 adapter 可以继续共享，但模型接口无需统一。
- agent-tasks/src/agent-manager.ts：beginRun 创建精确新身份，resolveTerminal 固定旧结果，runs 仅索引当前实例。
- agent-tasks/src/workflow/task.ts、index.ts：每次重放新 wf_ ID，区别于 Agent session resume。
- task-composition.ts、agent-runner.ts、child-handoff.ts：共享注册与嵌套管理准入绑定旧工具名，迁移必须保持禁止/允许与 parent run fence。
- process-tasks/tools/monitor.ts：扁平 schema、runtime XOR、现有零散说明，缺少直接未知参数防御和 schema 正数时间约束。

## 验收

1. 仅注册两个新管理工具，无 task_manage 执行兼容入口；schema 字段一次定义，错动作/字段/类型/跨组拒绝且零后端副作用。
2. 启动、list、结果、通知、Trellis 指引一致使用新公开身份；模型不必组合双 ID；句柄篡改不能绕过权限。
3. Agent resume 后旧句柄新查询失效；既有 wait 原结果、当前实例消费/停止与通知防重复保持；workflow 新旧独立执行不混淆。
4. 真正保留 nested/retained-child、extensions:false/isolated/deny/narrow/depth/owner 安全边界；没有收集入口不能启动后台孩子。
5. monitor 合法行为保留，非法数值/未知字段/形状/XOR 在登记和 source effect 前拒绝，cadence/default 准确。
6. 最终 SDK prompt 有各工具一个 usage 组，工具启用/隐藏与 peer 指导正确；文档资源 hashes 同步。
7. 自然退出生命周期回归、全套类型/测试、Trellis fake-pi/renderer/resource 验证通过；失败与未跑限制如实记录。

## 排除与风险

不安装、不自动个人 sync/reload、不 push、不重写历史。不全面改造 Agent/workflow 脚本能力、不新增暂停/跳过/重试、不新建存储。

公开接口和权限迁移通常要求独立检查，但用户要求不启动 Agent，本方案主实现/自审不宣称独立复核。实施批准前呈现此限制和完整计划；未批准不开始。
