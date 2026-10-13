# 下一阶段实现契约：等待与运行实例分离

这是主会话在 foundation执行期间整理的阶段契约，不是已完成代码。交付以 PRD/design为准；阶段1结束后根据实际入口/API确认。

## 拆分阶段2，避免单个实现agent包办

- 2A：新 task-ui核心契约与wait coordinator、process backend接入、普通输入交接删除、jobs attach可解除；暂时保持现有process面板为过渡，不实现最终panel。
- 2B：新的实现agent接入AgentManager/new launch/resume/queued/startup、结果retrieval、pool/notification消费，并暴露agent/workflow read source；暂不做旧UI整体删除与editor装饰。
- 3：新的实现agent处理session epoch、停止旧执行、child/worker/mention/scheduler清理；验证所有后端共享生命周期。
- 4：新的实现agent完成shared UI、editor入口和old UI移除。

各阶段停止前须actual typecheck和targeted无force-exit回归。每阶段主会话review actual diff，再委派下一阶段。不声称过渡面板就是最终结果。

## 唯一共享实例

Composition创建同一个task coordinator传入后端，而不是分别运行两个task-ui extension。可按根/子session建立各自coordination context，不用globalThis作为UI共享寻找机制。agent已有用于nested/Trellis的manager registry保留其原能力，不等于共享UI state。

## Wait lease最低契约

- identity用source/task/run（同一agent resume换run revision），label用于提示。
- lease类型launch或retrieval：同一task可有多个retrieval leases，不能互相清零通知抑制。
- finished、detached、interrupted三个结果只能选择一次；request detach不得调用ctx.abort。
- launch的onDetach解除后端全部parent cancellation links，并原task变为后台；retrieval仅解除等待。
- launch interruption调用backend stop；retrieval interruption不stop。
- registry只保存有限lease回调及清理函数；lease结束释放signal监听及等待统计，不保留完整session。
- completion刚好与detach同一事件循环时，只有winning路径消费结果或授予通知资格；dispose与多次detach幂等。

## 执行和等待的状态表

| 后端执行阶段 | launch wait detach | parent Esc | panel stop/session stop |
| --- | --- | --- | --- |
| queued | 解除parent link，迁移background admission；同一个ID，不启动第二run | 停止queue，完成promise且释放gate | 停止该ownership queue，不能迟到启动 |
| worktree starting | 解除parent link和等待，startup继续；失败归后台结果 | 停止该run，late startup仅允许清理，不继续prompt | 标closing/cancel并有界清理 |
| running foreground | 原run转background，不重启；activity/log订阅继续 | 没有detach intent时stop | 停止明确task及其children |
| running background + retrieval | 仅结束这一次wait | 仅结束wait | stop执行，其他wait收到terminal |
| settled | 若completion先胜出，返回一次inline结果 | 不复活、不重复报告 | 不停止无活动对象，保留final detail |

## process接入注意

- 当前foreground slot可立即登记，但旧quick-completion race两秒不含pausePromise；explicit detach应及时解除，不能把旧延迟当产品合同。
- foreground finally目前unlink记录/log；改为正确终态留存、取消poller/timer/signal且保留file，便于前台task可见和session切换保留。
- stats started/counting背景-only是历史实现，统一view统计与execution metrics不能以机械rename混用；UI分类由task source按真实status/mode读出。
- attachCount计数与outcomeSurfaced latch保持不同，completion callback遇active attach不发notification，取消wait后需补考虑已经settled未消费结果；不要只在proc exit一次性try notify造成completion-vs-detach丢通知。
- 新monitor契约不变：面板只调用backend共享silent stop，不额外flush pending；time/source/buffer/notice仍backend-owned。

## agent接入注意

- `spawnAndWait` gate/startup/promise需统一terminal promise，queued/no-session也有可查看状态。
- queued signal当前匿名listener与running listener必须都可解除。
- foreground resume当前独立inline分支不能仅加Promise.race，需要自己的per-run controller/promise和通知/统计一致。
- upstream settleRun foreground resultConsumed标记要改为由wait胜出和actual结果归属决定；否则manual detach仍吞后台报告。
- pool lease当前在start闭包capture，不能改isBackground后按新pool减计数；transfer current admission一次，completion release当前owned pool一次。
- child/workflow-owned execution不吃根并发pool，shared panel通过ownership查可见子状态，不把children变top-level handles。
- old foreground tool finally要分inline renderer teardown与execution activity/transcript teardown；转后台不markFinished。

## 验证不是源码字符串断言

通过fake runner/可控completion/startup/clock/signal执行实际实现：simultaneous leases、queued transfer、background满、late parent abort、foreground resume、already-aborted retrieval、多wait suppression、completion-detach同tick、manual stop retry、session late events。对node:test loader/worker的foundation测试继续保留，不能为简化测试换一份manager实现。
