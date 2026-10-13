# 重命名共享任务协调入口 bash-unified

## 目标

让入口名称准确表达 agent/process 的共享任务协调职责，避免在 Pretty 移除后继续使用暗示 Bash 与美化组合的 bash-unified 名称。

## 前置条件与顺序

本任务是 `.trellis/tasks/10-13-builtin-tool-renderers` 的后续独立任务，不是其子任务。必须先完成 beautify 独立加载、移除 Pretty 适配，再规划并实施重命名。任务树不是依赖系统，该顺序在此明确记录。

用户已明确授权按顺序完成两项任务，无需逐项再审批，已确认新文件名为 `extensions/task-composition.ts`。前置 Beautify 已实施并经独立 check 47ea 通过 strict/full 583 与 natural 583；本任务已进入实施，完整保留前置未提交内容。

## 范围

- 将 `extensions/bash-unified.ts` 重命名为准确表达共享任务协调/组合职责的顶层入口。
- 同步实际 import、测试、资源发现断言、README、规范及维护中的来源说明。
- 审核对外导出的 `runInChildSessionContext` 及其调用方，重命名不得破坏公共 child marker 桥。
- 保持唯一 coordinator/lifecycle/UI owner、agent/process 初始化、根/子会话 guard、Down opener 及关闭顺序。
- 原入口应删除，不保留会被 `extensions/*.ts` 发现的兼容转发入口，避免双重加载。

## 排除范围

- 不重构任务后端，不调整执行/等待/通知/面板/快捷键语义。
- 不将 beautify 重新组合进任务入口。
- 不批量改写已归档任务的历史文件路径。
- 不修改无关未提交内容，不自动安装、同步、重载、提交或推送。

## 验收

- [x] 新名称经用户审阅确认，入口只有一份，原路径不再是资源入口。
- [x] 活跃源码、测试、README 和 owning spec 引用与新路径一致。
- [x] 真实 host loader 的根/子会话单一注册与 child marker 桥通过。
- [x] 共享生命周期与输入 Down 回归通过，行为不变。
- [x] 类型检查、完整测试、定向自然退出、资源清单与 diff-check 通过或如实记录阻塞。

## 规划审阅门

引用和 child bridge 证据见 [research/rename-impact.md](research/rename-impact.md)；合同与回滚见 [design.md](design.md)，步骤与验证见 [implement.md](implement.md)。

命名已确认，无阻塞产品选择。材料、命名、授权与前置条件已齐备；实施证据见 [research/implementation-results.md](research/implementation-results.md)，独立审查证据见 [research/check-results.md](research/check-results.md)。独立检查未发现需修复问题；最终定向 77/77、strict + 完整 583/583、完整自然退出 583/583 均通过。未执行真实 PTY/实际 input-history 包端到端验证、个人安装/同步/重载或提交归档；验收为实际宿主 seam 与隔离自动测试。
