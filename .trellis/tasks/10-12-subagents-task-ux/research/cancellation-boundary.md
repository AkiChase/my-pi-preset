# 用户批准的取消边界（方案 1）

## 用户确认与语义

3B2交付后，主会话解释：shell/monitor/workflow执行线程可以直接终止，普通agent与主Pi共享进程，第三方provider/create/shutdownhook不响应取消时无法单独强杀而保留主Pi。用户先表示不理解；解释后明确回复 **“那就按 1 吧”**，选择保留当前架构、接受协作式取消。此前严格all-stop的记录是历史要求，现以本文件及修订R6/AC9为准。

## 仍需满足

- 自有shell与commandmonitor进程、WSsocket/source、workflowworker、队列、延迟启动timer、自有订阅必须实际停止/释放；不能以非协作例外豁免本仓库资源泄漏。
- 所有agent先发取消；正常响应取消的provider/startup/childhooks由真实promise追踪清理。已完成、为resume保留childsession的extensionresources也必须经过shutdown。
- 先冻结所有backend与notification，释放wait、silentstop、有界await，再封闭旧hosteffects、解除source和接口。旧task不能在新会话spawn/通知/重填state，不能自动恢复。
- 超时后保留原私有cleanupowner及磁盘log/session/memory/worktree/计划定义；不可仅因超时删除未保存/正在写文件。

## 明确不保证

- 不保证强杀任意非协作第三方进程内provider/create/shutdownhook，或撤销它们内部已开始的副作用。
- 不保证这些代码超时后绝不继续写文件；接口/通知封口不等于其内部已停止。
- 不改成普通agent独立进程/worker架构，不为此新增SDK修改或牺牲resume/扩展共享等能力。

## 验收和后续

PRD R6/AC9、design §7、implement G3、decisions、README和真实extension规范已同步；历史stage3b1/3b2交付文档可保留当时未满足严格要求的证据，后续以本批准补充为准。

主会话3B2实际strict/full459/459、agent93/93、three437/437自然退出，日志 `/tmp/pi-bg/bd8do2d17.log`。独立reviewa03ec4e7仍在执行，已告知批准后的边界；**用户选择不是审查通过，G3仍开**。只有独立审查确认自有资源/迟到回调无缺陷后，才能闭G3并分新agent实现共享TaskPanel/Down。当前不改代码架构、不安装/reload/写个人配置、不提交或finish/archive。
