# 技术设计：共享任务协调入口重命名

## 1. 状态

只做重命名与引用迁移，不重构执行或 UI。前置为 10-13-builtin-tool-renderers 完成独立 beautify 与 Pretty 移除。前置已实施并独立审查通过，本任务处于 in_progress；授权与验证证据见 [research/implementation-results.md](research/implementation-results.md)。

用户已确认新文件名 extensions/task-composition.ts。相比 tasks.ts，它表达组合入口而非任务工具或面板；相比 bash-unified.ts，它覆盖 agent/process 全部职责。

## 2. 合同

- 将 extensions/bash-unified.ts 移动到确认后的新路径；默认 factory 本地函数名可同步为 taskComposition，不改变 factory 签名或行为。
- 保留 runInChildSessionContext named export，仍导出 agent-tasks 使用的同一 child-context 实例。
- coordinator/lifecycle/UI owner 数量、process/agent factory 调用顺序、root/child guard、Down opener、shutdown 与 wait 协议完全保持前置任务的结果。
- beautify.ts 独立，不能因重命名重新归入协调入口。
- package.json extensions/*.ts 保持原状，新入口只发现一次；旧路径无转发 shim，否则双激活。
- 不修改对外命令、工具名、配置文件名、键位或后端 registry identity。

## 3. 消费者迁移

按 research/rename-impact.md 与实施时重新搜索结果更新真实路径消费者：host-loading-smoke、manifest regression、前置后的 beautify 测试（如有）、README、维护中 PROVENANCE 与 owning spec。内部 child-context 导入不盲目替换。

用户自定义外部旧路径不自动迁移；README 明确旧入口删除及新入口路径。常规按 package manifest 加载者无设置变化。不读写个人 settings，也不保留双入口作为兼容。

历史已归档任务、journal 与研究证据不批量改路径；其中旧名代表当时事实。

## 4. 验证和回滚

实际 host-loader 验证 named export/根子上下文/不同 cwd/并发 registry owner，不仅依赖文字 grep；资源断言新路径一次、旧路径不存在。执行回归覆盖 task-ui/process/agent lifecycle 与 Down 输入。

提交前使用独立 check 全量本任务 diff，pnpm check 与相关定向无 force-exit 测试；环境隔离按 preset testing guidelines。不启动模型、个人 install/sync/reload。

回滚移动和引用必须成套，不同时留两份顶层入口；仅恢复本任务 hunks，不回退 beautify 前置工作、不 reset 无关改动。

## 5. 审阅门

新文件名已确认，PRD 与执行清单已收敛。用户已授权顺序完成两项任务，前置独立 check 已通过，主会话已启动本任务；实施不自动提交、安装或归档。
