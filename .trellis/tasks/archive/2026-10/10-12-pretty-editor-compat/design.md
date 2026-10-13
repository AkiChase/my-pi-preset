# 技术设计（已批准正式实现）

## 边界与目标
仅修改 preset 的 Pretty 集成与小型兼容 helper，不修改 input-history、Pi core、本机配置或无关任务代码。不要求用户调整加载顺序。

## 设计方向
- `extensions/bash-unified.ts` 调用 Pretty 时使用局部兼容入口；不全局劫持所有插件的 UI API。
- Pretty 安装 editor 时，若已有 factory，先由其创建原实例，再在原实例上添加 Pretty 的输入框装饰，保留 history、subclass 行为和编辑能力。
- 没有 factory 时沿用 Pretty 原始 editor。
- 独立 helper 管理必要 render/padding/border hooks，保持原 receiver；不读私有 history、不替换原型链。
- factory 注册仍必须经过 Pi 正常 UI API；避免在实例创建时绕开 host 补全/快捷键接线。
- 装饰须幂等且可恢复，清理不得抢占后来插件的 editor 所有权。

## 正式实现必须补齐
原型证明中心方向可行，用户已批准正式实现。独立审查确认以下问题必须在接入前修复：
- 安装前检查可装饰能力与属性可写性，装饰/host 注册失败须事务式回滚 padding、hooks、factory、container 和 slot，不能让输入框不可用。
- 清理 padding 也须遵守后来插件的所有权，不无条件恢复原值。
- 不支持安全装饰的 editor 必须保留原编辑能力并可诊断降级，不能抛错误破坏 host；降级只影响 Pretty 装饰，正常支持的 input-history/editor 路径仍须保留完整外观。
- 实际 reload 的 reset-before-shutdown 顺序须回归覆盖；生命周期不只重复发送 session_start。

## 验证与剩余边界
1. 精确保留 Pretty 内嵌 working status 的方法。
2. render hooks 缺失或自定义渲染时如何降级，不无声丢失编辑行为。
3. Pretty shutdown 恢复旧 factory 与其他插件后续包装的兼容策略。
4. 最小局部 UI 适配能否覆盖上述约束；若必须改变依赖代码，先评审可发布补丁/小范围 vendor，不能直接改 node_modules。

## 隔离与集成
在独立 `feat/pretty-editor-compat` worktree，以明确提交为基线，当前记录 `07ec6bc`。基线 wrapper 是 bgTasks 版本，不搬运当前 processTasks/agentTasks 改动。本任务补丁保持局部，最终与 unified-task-panel 合并时单独检查 wrapper 和 README。

## 发布与回退
用户更新 preset 后生效，无配置迁移。变更需包含 README 说明与双顺序回归。回退只撤销本任务兼容入口/helper，不更改包列表。当前用户已批准正式集成，实施仍只在上述独立 worktree，验证和独立审查后汇报；不得自动合并回原分支。
