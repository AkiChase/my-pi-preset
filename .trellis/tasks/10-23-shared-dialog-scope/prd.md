# 共享对话交互作用域

## 目标

在现有内部 interaction 模块中，以一次完整交互为共享单位，简化 Recap 与 Session Name 的配置流程。业务代码描述正常步骤，取消、失效、独占所有权与条件释放由共用机制承担，而不是对每次宿主调用做薄包装。

## 背景与证据

- `extensions/shared/interaction/overlay.ts` 已提供浮层生命周期与 `InteractionResult<T>`，本期不改变其现有行为。
- `extensions/session-assist/recap/index.ts:259` 的 `configure()` 已维护配置 dialog controller、身份和每步 admission 检查；`closeDialog()` 同时协调手动生成，因此不能简单删除整个 command version 机制。
- `extensions/session-assist/session-name/index.ts:262` 起的配置对话只检查 `active`，未传取消信号，也未建立独立配置交互身份；这构成需用回归测试验证的迟到处理风险，不记作已复现故障。
- 安装 SDK 的 select/input/confirm 支持 signal。input 空字符串有效；confirm 返回 false 不能区分拒绝与用户取消。

## 范围与要求

1. 在 `extensions/shared/interaction/` 内设计消费者调用的交互 owner 和作用域，不增加 Pi 加载入口、独立包或 workspace。
2. owner 按业务用途创建；新执行替换旧执行，显式 cancel 撤销当前执行，旧流程退出不得清除新流程所有权。
3. 作用域的 select/input 自动传 signal、检查调用前后有效性；取消或失效结束整条流程，不要求业务逐步解包 tagged result。
4. 完整执行边界复用 `InteractionResult<T>`；纯类型抽到 result.ts，overlay 保留 re-export。普通异常与每次执行私有退出标记明确区分；不得通过宽泛识别 AbortError 把错误归为取消。仅对仍拥有 slot 且领域准入有效的执行调用同步 onSettled，集中结果提示与业务收尾，避免消费者另建 finally 身份保护。
5. 提供 checkpoint、isCurrent 与 signal 供业务边界使用；confirm 保留宿主 boolean 语义，不虚构取消信息。
6. 消费者决定取消事件，不在模块内自动订阅全局生命周期。Session Name 的配置 owner 与命名请求取消机制独立。
7. 迁移 Recap 与 Session Name 配置流程；保留各自模型/认证验证、调度、配额、持久化与既有界面职责。
8. 取消应及时释放共用执行等待，安全处理宿主迟到 resolve/reject；不得承诺停止任意业务 Promise 或已开始的副作用。
9. 保存前保护不等于事务；Recap 保存内部的有效性检查保留。Session Name 的本地 saveConfig 接受选定字段 patch，合并新鲜读取并返回完整配置，保留等待期间外部更改的未选字段和未知字段；不扩展为通用配置存储层。
10. Session Name 配置交互在恢复、会话导航/切换/派生前及 shutdown 撤销；不随命名请求、新输入或标题变化取消。未知菜单响应不得写入。Recap 保留现有撤销政策。
11. 消费者主动失效事件必须调用 cancel；仅谓词变化无法保证即时释放。任意非对话 await 后的副作用仍需 checkpoint，模块不保证任意 callback 被抢占。

## 验收标准

- 两个消费者的正常对话路径不再反复传 signal 或编写取消/失效分支，也不再自行维护配置 dialog controller 与 identity。
- 替换、主动取消、会话失效、迟到返回/拒绝和旧 finally 与新执行重叠均有测试；失效后不打开下一步、不应用结果。
- input 空字符串仍交由业务验证，confirm false 不被误标为可辨识的用户取消。
- Recap 现有配置字段保留、模型/认证验证和调度回归继续通过；Session Name 自动命名配额与标题所有权回归继续通过。
- 模块自身、消费者回归及适当的安装 SDK 边界验证通过，最终执行项目 `pnpm check`。模拟测试与真实终端验证分开记录。

## 不在范围内

- Trellis 初始化对话迁移、菜单 DSL、声明式配置 schema、全局交互事件订阅。
- 浮层消费者再迁移、Widget Display 或 scroll-panel 职责调整。
- 任意异步写入事务封装、通用 commit API、依赖安装或个人配置操作。
- 发布包、push、历史重写、归档或日志收尾。

## 授权与规划状态

用户已审阅最终计划并明确要求“开始吧”，批准按三个阶段实施、检查与本地提交。任务已 start；除获批范围外不授权 push、安装、历史重写或归档。

已完成源码、规范与相关测试证据检查，形成 `design.md` 与 `implement.md`。主会话直接实施，跨模块生命周期契约由 trellis-check 独立审查；check.jsonl 已准备，implement.jsonl 故意为空。规划材料检查不代表产品验证。

内部退出标记、宿主迟到结果、同步重入、收尾准入与配置保存边界已列入设计和验收；实际执行证据与阶段进度以 implement.md 为准。
