# Foundation 独立审查：不同 cwd 的子会话 guard

只读审查agent `422baeb7-3edd-4ef` 发现一个blocking foundation遗漏。331tests通过和same-cwd smoke不能证明worktree child isolation；阶段G0/G1的该项重新打开，继续stage2A仅允许不冲突的process/task-ui工作，agent backend集成前必须修复。

## 确认根因

- `extensions/agent-tasks/src/child-context.ts:7–14` 为module-local AsyncLocalStorage。
- `src/agent-runner.ts:623,747–760` 使用worktree configCwd加载资源，再runInChildSessionContext(loader.reload)。
- Pi1.1.0 cached loader在cwd改变时invalidate factory/jiti图，新模块创建另一个ALS，无法观察root guard async extent。
- 原 `__tests__/host-loading-smoke.mjs:50–51` sameentry/samecwd通过，缺differentcwd矩阵。

审查agent actual offline host复现：rootHasAgent true、sameCwdChildHasAgent false、differentCwdChildHasAgent true、differentCwdChildHasWorkflow true。三个load均无errors。这会在worktree子会话注册root agent/workflow工具并构造额外manager；manager global first-owner只防替换slot，不阻止activation。

## 修复所有权

定向修复agent `task-child-guard-fix` / `eea7a57d-a0eb-4a1`只修改child-context、hostloading tests、agentprovenance及自身research，与正在做process/task-ui的stage2A无重叠。

主会话明确设计：child marker ALS可通过namespaced Symbol.for保有跨jiti模块图identity；这只是共享异步上下文marker，不是global UI coordinator或第二执行registry。不采用全局boolean或env标记，确保并发root work不受影响，childshutdown不销毁shared ALS。

新增真实host测试different temp cwd、samecwd、parent after invalidation、childshutdown/rootshutdown与异步并发不泄漏。修复结果未收到前不能声称通过，不能删测试硬断言。

## 审查的其他证据

artifact/source/license一致，171specifier rewrites之外仅config/guard导出；继承any55无新增suppression。host SDK/TypeBox alias策略、croner/nanoid依赖、manifest/sync和samecwdpretty均通过。审查重新跑agent5/manifest+sync6/全check331全部通过，自然退出，但differentcwd guard仍失败。未审查后续wait/UI/lifecycle，也未以未完成阶段误判。
