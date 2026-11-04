# 设计：统一快捷入口与浏览器交互 owner

## 已定方案

固定 Ctrl+Shift+T：未打开/已关闭创建新实例，正在打开复用 admission，有焦点则隐藏，隐藏或被其它弹窗遮住则拉到最前。隐藏恢复保留旧实例状态；关闭后的打开从默认列表开始。用户已确认范围并批准最终方案实施。

## 1. 职责与上下文

- `task-browser/command.ts` 或窄 owner helper：维护一个 activation 当前有效会话和最多一个交互，命令与按键共用 admission/open/present 路径。
- `index.ts`：在支持项目 session_start 接入会话 owner，并在替换/退休关闭。保留 findRoot、requireRuntime 和 source-authority 验证；不要复用 display generation 来取消 viewer。
- `TaskBrowser`：继续拥有列表/章节/滚动/缓存；只在幂等外部关闭/dispose 或已有 footer hints 必须时增加最小接口，不复制状态、不重建编辑器。
- 操作函数只需要 ExtensionContext 能力，收窄现有仅因命令注册使用的 ExtensionCommandContext 参数；禁止在 raw listener 里调用 command-only waitUntilIdle/reload 等操作。

## 2. 会话级原始输入监听

在有效支持项目的 TUI session_start 安装一个 `ctx.ui.onTerminalInput`，而非每次 viewer 打开才注册。否则首次打开及关闭后重开无法从其它前台对话框触发。

普通 `registerShortcut` 通过编辑器 handler 分发，不能作为跨弹窗入口的唯一机制。采用 session raw listener 作为实际按键 owner；不依赖动态 shortcut 注册在启动时是否被 host 刷新。命令和 raw listener 使用同一个打开函数，不分别创建 controller。此方案不要求额外 /hotkeys 注册，入口由浏览器 hints 和用户文档说明。

监听同步判断当前会话 ownership、固定按键与事件类型。消费合格的 Ctrl+Shift+T 初始按下；repeat/release 消费但不切换。首次打开异步流程由 owner 承接并捕获错误，不能从同步监听泄漏 rejected promise。opening 期间重复按键仅消费，不排队隐藏。

普通键、Esc、Ctrl+C、legacy Ctrl+T 一律不消费。固定键跨弹窗提升是用户的明确意图，不再套用“可见且没焦点不处理”的问卷条件。

## 3. 状态机

| 状态 | 快捷键 | 显式打开命令 |
| --- | --- | --- |
| idle | 校验后创建新交互，进入 opening | 同左 |
| opening | 不重复打开/不排队切换 | 共享本次打开 |
| visible/focused | setHidden(true)，显示提示 | 聚焦同一实例 |
| visible/not-focused | focus()，提高层级并获取焦点 | 同左 |
| hidden | setHidden(false)，提高层级并获取焦点，撤销提示 | 同左 |
| retired | 不消费，不能复活 | 旧上下文不能打开 |

SDK `setHidden(false)` 已提高 focusOrder，无需为隐藏恢复额外调用 focus()；可见被遮挡时调用 focus()。不读私有 overlayStack，不操纵其它插件 handle。

公开 SDK 按 focusOrder 从低到高合成 overlay，因此能同时做到视觉前置和键盘聚焦。下面的问卷等 overlay 保持 pending 和原组件，不主动取消/提交；viewer 再次隐藏/关闭，SDK 选最高可见 overlay 或原焦点，owner 不自建焦点栈。

## 4. 两层生命周期

### 会话层

绑定 activation、manager 对象、session ID、项目根与 generation。session_start 的有效替换先退休旧监听与交互，随后接受新上下文；session_shutdown/reload 关闭 admission 并清理。before-switch 可能被取消，不提前退休。

没有有效支持项目或不是 TUI，不安装 raw listener。恢复/打开前仍检查当前上下文/root/source authority，不因已有实例绕过校验。布局加载和异步 factory 前后核对 generation。项目变化/授权失效不能使旧 viewer 继续恢复。

### 交互层

关闭 viewer 只结束交互，不注销会话 raw listener；允许下一次快捷打开新实例。交互拥有 handle/done/组件与提示 lease；旧 finally 只处理旧资源，不清空新 interaction。

通过 done 结束 SDK custom；不直接调用 handle.hide()，避免移除 overlay 后仍悬挂 custom promise。必要时组件外部关闭接口标记 closed 并执行 done，不能只移除屏幕而留一个仍处理输入的组件。

opening 被退休：关闭 admission、标记 generation 无效；handle/done 未就绪时保留迟到清理职责。在 custom factory 前检查当前性，必要时调用 done 并返回 inert component，防止 SDK 迟到挂载。

## 5. 临时提示与失败

专用状态 key 不覆盖 `trellis`，内容英文，例如 `Trellis Tasks hidden · Ctrl+Shift+T to restore`。它只在交互隐藏时存在，不作为新的常驻 Footer；不 setFooter/setWidget、不改 shared display registry。

恢复/关闭/失败/退休撤销本交互提示；旧 finally 不能撤销新提示。状态/通知失败不让 owner 卡在 opening，也不能阻止 done 或注销。缺失 raw listener/必要 handle 能力时不能进入不可恢复隐藏；命令原退出路径保留并告知能力限制。

不要将 run-scoped `ctx.signal` 作为整会话 lifetime：用户 abort 当前模型运行不应使快捷入口永久退休。

## 6. 验证与接口约束

主实现 + 独立 trellis-check 审查跨模块 owner 接口。Trellis 新测试保持 fake-pi/handle `.mjs` 逻辑层，不新增真实 Pi/TUI 挂载/渲染测试。

验证 session raw listener 可在 idle/hidden/visible-not-focused 收到指定键，command 与 listener 共用 owner；fake 外部 overlay 的 done/取消接口不能被调用。用同一交互身份、custom mount 次数证明没有重新创建实例，不伪造读取私有滚动字段的“完整状态快照”。

需要真实终端/物理键盘验证时单独说明授权与测试规范限制，不把公开源码支持称为已运行终端验收。

## 7. 兼容和回退

- Ctrl+Shift+T 需要扩展编码，不把 Ctrl+T/ESC 作为 fallback。
- 第三方 raw listener 先消费同键时无法保证收到；不修改其它监听/个人快捷键。
- 活跃隐藏 overlay 会阻止 SDK regular/fullscreen 模式切换；保留此约束，不通过关闭重开丢失状态来绕过。
- 不保证任意非 overlay 模态对话框的焦点回退，也不保证第三方 Footer 显示状态提示。
- 不自动刷新、不跨关闭/session/reload 保存阅读状态，不安装依赖或更改 SDK。

## 8. 规划收敛

两项产品决定已解决，公开接口支持前置行为，无阻塞技术未知。用户已批准最终方案，任务已启动；实施文件、检查点与结果见 implement.md。
