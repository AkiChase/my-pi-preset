# 架构规划复核

Plan agent `30883f3f-e653-455` 只读复核，未改文件。其输出已由主会话归纳进 design/implement；以下保留关键证据和采用/不采用的建议。

## 采用的边界

- `bash-unified.ts` 演进为一个 composition owner，创建 session-owned coordinator，注入两个后端并维持 pretty bash 的唯一最终注册。不以 process-global UI coordinator处理子会话。
- task-ui 管 view/entry/wait leases，backend 管 executions/controllers/notifications。检视 panel 不消费结果或抑制通知。
- 每次 run 从排队/启动前创建 terminal promise；foreground resume 走同样的 managed path，避免旧 inline-only 分支失去可解除能力。
- admission lease 与 execution mode 分开；已经运行的 foreground 转后台可短暂超后台 admission limit但不停止/重排，后续新任务等待；queued 转后台迁移队列归属并幂等 release。
- 自然完成报告 latch 加 scoped waiter suppression；delayed nudge 真正投递时再核对结果已消费/epoch，取消 wait 不永久吞通知。
- workflow 普通 stop 与 skip/retry 不同：用户停止 execution intent阻止自动 retry，仍保留显式高级 retry/失败依赖规则。

## 编辑器本地 Down 装饰

Plan 建议使用公开 `getEditorComponent`/`setEditorComponent`，而不是全局 raw input。主会话直接验证 installed SDK types.d.ts:175–177 存在该工厂 API、pi-tui editor.d.ts:36 有 focused 属性、CustomEditor 声明有 app callbacks 与 extension shortcut 路由。

既有 factory得到实际组件后装饰 handleInput，保留组件 identity、Focusable、callbacks；默认编辑器用最小 CustomEditor子类并 super回退。仅 focused/空文本/Down press/无 autocomplete/eligible tasks处理。session teardown只在当前 factory仍属于自己时恢复 predecessor。须运行验证草稿/history/undo/粘贴/图片/autocomplete/submission不会被 editor替换破坏，不能把声明有 API当作真实运行已通过。

面板内部显式将 background chord交给 coordinator，避免 overlay focus导致原 registerShortcut无法触发。

## 主会话直接核验的前台清理风险

`extensions/bg-tasks/tools/bash.ts:302–305` 在未 handedToBackground 时删除 job并 unlink logPath。统一面板展示前台任务与保留 session终止 artifacts意味着必须改该路径：停止/切换后保存最终状态和文件，而不只处理原 background jobs。

## Loader / worker

Plan 发现 workflow workers是 inline CommonJS strings，不能把 worker源码/用户 workflow .js名字机械替换为 .ts；实际 source relocated运行和测试loader仍需要 G0 gate。保留 host TypeBox和 SDK解析，runtime依赖正常声明，无第二 build树。

## Trellis 组织选择

复核认为可拆成 integration parent/children；本任务采用单 task内阶段 gates，因为当前一次用户请求的 loaded composition、wait lifecycle和 mixed UI紧密互依，不能独立交付一个不工作面板。未新建子任务、未激活实施。runtime父子所有权则必须实现，用于停止范围与组保留。

## 状态

设计和实施计划已补入上述边界。所有结果是规划，不表示新 source已经加载、运行验证或测试通过。最终批准前只写任务文档。
