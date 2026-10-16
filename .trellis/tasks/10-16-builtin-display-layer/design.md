# 统一 widget 展示层设计

## 范围与结构

新增独立内置入口 `extensions/widget-display.ts`，实现位于 `extensions/shared/widget-display/`。入口唯一拥有宿主 `setWidget` 发布；Recap、Trellis、Process Tasks foreground hint 全部迁移为客户端。footer/status/header/overlay 保留原 owner，不包装 `ctx.ui`，不访问 SDK 私有容器、不修改已安装 SDK。

每个区域只有一个宿主 widget：aboveEditor 与 belowEditor。组合内部按已声明 slot 顺序渲染，aboveEditor 固定 Recap → Trellis；belowEditor 保留 foreground hint。未来内置 widget 通过 slot registry 声明区域和排序，不从消费者传任意数值抢优先级。更新内容不改变 slot 顺序。

## 跨插件传递与身份

使用公开 `pi.events` 传递版本化发布/撤销协议，不使用长期 global singleton，也不依赖各入口共享相同模块缓存。

SDK 已验证：每个 extension 的 `pi.events` 是不同 facade，但底层 eventBus 共享；因此不能 WeakMap keyed by facade 来共享 owner。底层 `EventEmitter.emit` 同步调用 handler，事件包装会隔离异常且 emit 本身不 await promise：协议 handler 必须同步处理 admission/ack，不借助异步返回值建立成功假象。runtime 会跟踪并取消事件订阅。

owner 的 event handler 在 factory 期间注册，但不发布 UI、不启动资源；所有入口加载完后才能进入 session_start，因此客户端先加载仍可找到 owner。通过注册请求的显式同步 ack 返回有限 session client handle；缺失 owner 时明确安全失败，不回退直接 setWidget，不暂存无限队列。客户端仅拿到发布/撤销自身 slot 的能力，不能删除整个组合或其他 slot。

共享身份由 sessionManager 对象与 getSessionId 共同确定，不能只按 cwd、session 字符串或 ui facade。handle 绑定客户端 activation token 与会话 generation，旧 handle 失效后不能覆盖/撤销新 handle 的 slot。重复 session_start 应幂等；会话切换与 reload 关闭旧 admission，再清理其 widget/组件/订阅，不能复活关闭的 owner。owner 不持有后台执行 registry 或完整日志。

## 内容与生命周期

支持文本行与组件 factory，保持现有消费者语义：Trellis/foreground hint 可使用文本行，Recap 使用现有主题组件 factory。TUI 用组合 Component；RPC 只传已有文本行能力，Recap 继续不在 RPC 展示组件 widget；print/JSON 不发布。组合处理原有 SDK string-widget 的终端列、padding 和行数限制，不无意改变当前文本缩进或换行。

slot 更新只重建其自身组件，其他 slot 的实例、状态和 focus 不受影响。组件创建、更新、dispose 与宿主 setter 可能同步重入，必须在副作用前后检查 owner/session/token；dispose 幂等、异常隔离，迟到 factory 不可安装过期组件，旧清理不得撤销新发布。排序只遍历已接受的 slot，不做 I/O或重新创建 factory。

区域为空时删除组合 widget，不显示占位。Recap 自己继续管理 idle/material/request 有效性；统一层不重写其生成契约。Process hint 保持从 foreground slots 推导内容、diff 避免无效更新，关闭 backend 时撤销自身 handle，不把后台进程生命周期交给展示层。

## 第三方与排序限制

组合内部顺序可保证；未接入第三方 widget 相对整个组合的顺序仍由 Pi 写入顺序决定。不清除/重发第三方 widget，不承诺 Recap 比所有外部插件更靠上。将来若要求该保证，需单独扩展宿主 API。

## 规范与风险

在 development/testing specs 记录内置 widget 的唯一发布 owner、slot registry、session fencing、接入步骤和验证约束。增加源码边界检查：所有生产宿主 setWidget 调用必须位于共享 owner 中；测试 fixture 的 setWidget mock 不受此限制。

需要重点核查 owner 缺失、跨 facade 但共享 bus、多个独立 bus、runtime reload、不同 manager 同 sessionId、factory/setter/dispose 重入、sink 错误及原有 consumer fallback。跨模块生命周期契约变化需要独立 review。
