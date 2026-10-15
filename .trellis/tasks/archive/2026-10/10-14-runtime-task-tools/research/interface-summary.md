# 接口研究摘要与必读锚点

本摘要用于上下文注入。完整研究 `runtime-interface-map.md` 超过32KiB注入上限，实施／检查按下面章节按需完整读取，不能把截断当已读全文。

## 已确认产品决策

用户要求六工具：bash、monitor、subagent_run、subagent_workflow、subagent_message、task_manage。删bash_bg及旧jobs／get_subagent_result。task_manage统一四类管理并可wait指定subagent返回最终回答；不考虑旧alias、旧名renderer、ID／history迁移。完整研究第9章是研究时的候选清单，旧兼容问题已由后续用户明确否决，不能重新引入。

## 必须保留的技术事实

1. 根composition拥有唯一coordinator/lifecycle/UI，新增task_manage必须单次注册。TaskView仅冻结读模型，16KUI详情不能替代模型最终答案。见完整研究§1、§6。
2. 现有身份tuple为sourceId/taskId/runId。subagentresume稳定record ID＋新run；manager不持任意历史run库，wait捕获旧terminal，不能await后重解到新run。workflowreplay新ID，与pause-resume不同。见§2。
3. process output终态消费、search不消费；wait复用retrieval leases，取消只结束wait，不停止运行。process终态与真实OSexit分离。agentconsume/notification reconsider要一起复用，不能只抽formatter。见§3、§4。
4. workflow没有模型按IDterminal检索／等待、resultConsumed／wait suppression，必须补齐。scriptreturn、progresslogs、journal是不同通道；workertermination不证明hostgatecallback结束。见§4.3。
5. child仍加载local process backend；nested当前customTools只管理ownedchildren。SDKcustomTools同名覆盖extension工具，因此不能用nested-onlytask_manage覆盖childprocess-onlytask_manage。新接线应明确scoped能力handoff，不拿root全局manager，不给childroot/sibling权限。见§5。
6. bash_bg独有有效notify:false必须迁入bash；timeout不是普通后台硬截止。name已对应description。不能仅删除文件丢suppressed通知与rollback测试。见§3.1。
7. 新公开结果应冻结合同后迁移Beautify，不只改resolver名。新metadata严格guard／unknownfallback，背景clipPlain防护、oncepadding、partial→final槽隔离、已返回全文与无I/O消费保留。见§7，另读beautify-migration.md。
8. 当前RPC subagents:rpc ping/spawncwd/stop/consume协议独立于模型工具名，保真recordID与managedoccupancy。外部pi-trellisordinaryhook只识别Agent，改subagent_run会漏材料注入／worktree门禁，必须单独确认外部同步范围，不私改.pi/git或自动install。见§8。

## 最新基线

Beautify已归档completed，归档terminal-fix-report最终自动671/671及dark/fullscreen定向tmux9PASS仅覆盖有限矩阵，不能称新task_manage终端已验收。研究文件开头旧beautify-migration.md状态引用是研究当时快照；现在该文件已修正。

## 草案与待决范围

design.md／implement.md已提出最小合同、scope、参数、child接线和验收；都是待审阅草案，未经start。外部pi-trellis门禁同步的taskowner／交付顺序为当前阻塞决策，其余工程默认也随最终方案审阅，不从研究候选直接获得实施授权。
