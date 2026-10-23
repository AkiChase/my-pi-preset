# 共享对话交互作用域设计

## 共享边界

新增 `extensions/shared/interaction/dialog.ts`，以一次完整 callback 执行为交互单位。owner 在扩展 factory 内按用途创建，不订阅 Pi 事件、不存储领域配置、不持有 import-time 全局状态。现有 overlay 运行时保持独立；将纯 `InteractionResult<T>` 类型移至 `result.ts`，overlay 保留类型 re-export，使原调用方无需迁移。

建议接口（名称可在实现中做不改变语义的小幅调整）：

```ts
interface DialogScope {
    readonly signal: AbortSignal;
    isCurrent(): boolean;
    checkpoint(): void;
    select(title: string, options: string[], opts?: { timeout?: number }): Promise<string>;
    input(title: string, placeholder?: string, opts?: { timeout?: number }): Promise<string>;
    confirm(title: string, message: string, opts?: { timeout?: number }): Promise<boolean>;
}
```

`createDialogOwner()` 返回 `run(ctx, options, callback)` 与 `cancel()`。options 包含 `isCurrent()`、可选外部 signal，以及可选同步 `onSettled(result)`；run 返回 `Promise<InteractionResult<T>>`。onSettled 是当前执行的结果通知/业务收尾入口，不是资源释放入口：共享模块始终自行清理。它只对结算时仍拥有该 slot 且领域准入有效的执行调用；旧执行无权调用它。使用这一入口避免消费者在无条件 await/finally 后重复搭建版本保护。hook 不允许异步收尾；hook 失败返回 error，不重试。同步重入后必须重新检查 slot，不能释放新执行。

## 生命周期与结果

- 每次 run 创建不可混淆的执行身份、私有 controller 和终止状态；替换先封闭旧执行准入，再 abort，旧清理只作用于旧资源。
- run 的线性化顺序必须覆盖 abort listener 同步再次 run/cancel 的情况：后发生的新执行获胜，外层旧调用不能重新占据 slot。以身份/序号准入实现，不使用全局互斥或轮询。
- 显式 owner.cancel、被新 run 替换、外部 signal abort、领域 isCurrent 返回 false：结果为 stale，与现有 overlay 外部撤销语义保持一致。用户 select/input 返回 undefined：cancelled。正常 callback 返回值：completed。能力缺失：unsupported。普通宿主、业务、准入谓词或收尾错误：error；已确认失效的旧业务异常不发送当前领域错误提示。
- 能力准入使用 hasUI 和实际 dialog 方法，不把 RPC 当作不支持；print/无 UI 不打开对话。timeout 原样传给宿主，宿主 undefined 只能记作 cancelled，不能识别具体按键或超时原因。
- 每个步骤调用前后 checkpoint，并将本次 signal 传给宿主。空 input 字符串正常返回；confirm false 正常返回，不假装知道是拒绝还是 Esc。
- 控制流使用每次执行私有退出标记，不能把任何 AbortError 都当作用户取消。退出状态一旦记录，即使 callback catch 吞掉标记并返回，run 也不能报告 completed；已结束作用域的下一次调用或 checkpoint 必须拒绝。
- 对话等待与执行边界观察终止通知，主动取消及时释放 run；宿主迟到 resolve/reject 和 callback 迟到拒绝始终有处理器，不产生 unhandled rejection，不复活 scope。
- isCurrent 是消费者谓词，不提供变化通知：若领域只改变谓词而不调用 cancel，也没有新步骤到达，就不能保证即时释放。消费者负责在主动失效事件取消 owner；不新增轮询。
- run 返回不代表任意 callback 已停止。任意 await 之后的副作用必须 checkpoint；模块不能抢占同步代码、吞掉任意用户 catch 后的代码、取消任意 Promise 或撤销已开始写入。
- 正常结束也封闭 scope 并释放 listener/controller。退休后的 isCurrent 返回 false；终止 signal 的 abort listener 可能同步重入，资源清理、onSettled 准入和返回结果不得因此误操作新 owner。

## 消费者迁移

### Recap

`configure()` 使用专用 configuration owner；`closeDialog()` 将配置撤销交给 owner，同时保留 commandVersion、manualPending、manualWait 的手动生成协调。配置领域准入保留 owns(ctx)、捕获 epoch 和必要 commandVersion；共享 slot 替代 dialog controller/identity。

- 现有 closeDialog 调用事件不变；不修改自动生成窗口、计时器、模型请求与 widget 发布机制。
- 保留模型认证/能力重新验证、标签净化、patch 保存和保存内部 admitted 检查。
- 对话用 flow.select/input，取消判断由整次 run 收口；保存前后 checkpoint。
- 现有载入错误、业务指导、保存失败提示仍由消费者负责，不搬入模块。
- 当前执行的结束调度与最终错误处理放入同步 onSettled，取代配置 dialog 的身份 finally；旧执行不得为新配置恢复计时器。schedule 本身的既有领域准入不放入共享模块。

### Session Name

配置使用独立 owner，不复用命名 epoch/controller。配置 owner 在 restore、session_before_tree、session_before_switch、session_before_fork、session_shutdown 与新配置执行时撤销；before 事件只取消当前交互，不永久销毁 activation。捕获 session manager 身份及 session ID 做领域准入。新输入、agent_start、自动命名和标题变化不直接撤销配置 owner，保持配置与命名请求分离；自动命名的原有取消政策不改。

- 菜单文字、选项、区间验证、两次自动机会与标题所有权保持不变；未知菜单响应拒绝写入，不再被当作 Disable。
- saveConfig 保持本地配置存储职责，支持本次选定字段的 Partial<NameConfig> patch、可选 admitted 检查并返回完整 NameConfig。完整旧参数仍兼容。
- 新鲜读取后合并 patch，验证完整配置，在临时写入/rename 前检查准入；保留未选字段和未知字段，拒绝 malformed 配置。配置 callback 用返回值更新内存，而不是发布旧快照。
- 禁用 automatic 后仍只取消命名请求，不取消刚完成的配置 owner，不返还或增加机会。
- 内部 patch 保存是为单字段交互避免覆盖等待期间变化所需的小范围调整，不抽通用存储层、不引入锁/事务框架。

## 文件与职责

- `extensions/shared/interaction/{dialog,result}.ts`：新增共享对话机制和纯结果类型。
- `extensions/shared/interaction/overlay.ts`：仅移动结果类型并 re-export，保留 API/行为。
- `extensions/shared/interaction/__tests__/{dialog,sdk-dialog}.test.ts`：机制和实际安装宿主对话边界。
- 两个消费者 `index.ts`、相关 `harness.ts` 和 menu/runtime/config tests：迁移与行为证明。
- Session Name `config.ts` 与 config tests：patch/新鲜读取/保存准入。
- 规范仅在最终证据支持可复用契约时更新；不增加用户迁移文档，不改 manifest、加载入口或 SDK。

## 验证与风险

重点测试：取消前/等待中/返回后，非协作宿主，迟到拒绝，替换期间旧 finally，取消 listener 同步重入，准入谓词/宿主/hook 抛错，吞掉退出标记，退休 scope，confirm false，input 空字符串，RPC 能力与 unsupported。

安装宿主边界采用已有测试专用动态加载方式，调用真实 InteractiveMode 的 selector/input/confirm 方法，使用窄宿主环境提供安装/移除方法；不复制宿主算法，不将 fake 宿主容器说成真实终端。验证 signal 关闭自身对话、正常返回、否定/取消语义与清理。RPC 使用契约化边界测试，不修改 SDK 私有实现。

独立审查必须核对机制和两个消费者的交互保护确实删减，不接受只换一种逐步判断语法。若收尾 hook 或控制流要求导致消费者重新维护 dialog identity，先调整设计，不能通过再加一层 owner 掩盖失败。

回退按阶段恢复内部调用方式；无配置格式版本迁移，已有文件可继续读取。未授权真实终端/provider 验证、安装、push、归档或历史重写。
