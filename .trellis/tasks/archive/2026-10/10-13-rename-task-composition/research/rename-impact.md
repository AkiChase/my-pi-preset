# 入口重命名证据

## 基线与前置

本次只读检查基于仍含 Pretty 的当前 checkout。必须先完成 10-13-builtin-tool-renderers，使 beautify.ts 独立，bash-unified.ts 只承担 process/agent/coordinator/lifecycle/Task UI。后续实施前重新搜索，不能照搬当前 Pretty 引用或删除前置任务生成的 beautify。

## 必改引用

- extensions/bash-unified.ts：默认 factory 及 runInChildSessionContext 再导出，不能改后者符号名/语义。
- extensions/agent-tasks/__tests__/host-loading-smoke.mjs:17：通过真实 host loader 导入顶层入口及 child bridge，必须更新路径并继续执行。
- scripts/pi-manifest.test.mjs:13,56：说明与唯一入口断言。
- README.md：协调入口、加载边界与开发说明。
- extensions/agent-tasks/PROVENANCE.md:22、extensions/process-tasks/PROVENANCE.md:109,113：维护中的当前所有者路径；Pretty 相关历史描述以完成前置后的版本为准，不扩展重写来源历史。
- .trellis/spec/preset/repository-guidelines.md、extension-guidelines.md、.trellis/spec/guides/cross-layer-thinking-guide.md：当前入口路径与所有权描述。
- 当前 pretty-compat 测试也引用旧路径，但前置会移除/迁移；实施时以新 beautify 回归实际路径为准。

## 不改的内部符号

agent-runner.ts、mention-clone.ts 导入 ./child-context.ts 的 runInChildSessionContext；agent-tasks/src/index.ts 再导出同一实例。它们没有因文件名变化而需要改逻辑。只能更新确实引用旧顶层文件路径的调用。

## 资源发现与兼容

package.json pi.extensions 为 extensions/*.ts，会自动覆盖新顶层名称，不需要添加另一份显式入口。旧入口必须删除，否则转发 shim 也会被扫描并重复激活。当前无 task-composition.ts/tasks.ts 名称冲突。

不保留旧 import 路径兼容。仓库维护中的消费者成套迁移；用户自定义外部显式路径需要自行更新，README 标明路径变化。任务不修改个人 settings/安装，不尝试全机搜改。

## 验证

实际 host-loading-smoke 由 loading.test.ts 子进程执行：根/子上下文、不同 cwd、并发根会话和 registry owner 均要继续保留。除了 string grep，还要跑真实 loader 和生命周期测试。

本轮未运行测试、未安装依赖、未改产品代码。用户随后已确认新文件名 task-composition.ts。
