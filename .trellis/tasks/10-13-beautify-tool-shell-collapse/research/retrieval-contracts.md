# 结果读取工具合同研究

已完整读取 process-tasks/tools/jobs.ts（440行）与bash.ts，及agent-tasks/src/index.ts:2842-2953所覆盖完整get_result定义/格式化函数。

- jobs六action均details undefined；execute返回AgentToolResult<undefined>。output读取已返回byte范围，attach raw partial来自streamLog，final只报告状态/使用output指南，不包含全量log。停止跟随与停止执行分离。展示不可额外读取、消费或停止任务。
- get_result无自定义renderer，formatRetrievedAgent返回固定头部+正文，verbose追加conversation；not found不是isError，wait释放/cancel也非agent停止。metadata只有文本，不能import manager或session求实时数据。
- Bash后台返回details为空，显式/手动/超时后台是固定完整返回句，不应通过正文任意关键字判别。
- 适配新增两个工具时无需修改后端details，只做guarded文本展示；未知形状回原renderer。不存在工具不触发resolver执行，更不能注册假工具。

用户最后明确：仅新增get_subagent_result/jobs；write/ls/bash_bg/monitor不加入。当前planning，最终方案待下一轮审批。
