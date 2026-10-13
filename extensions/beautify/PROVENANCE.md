# beautify 来源与维护边界

本模块由本仓库自行实现，不是 Pretty 源码的 vendor 副本；没有复制其 renderer、prompt-editor、执行包装或 lifecycle Proxy。测试中的 history-fixture 也是独立合同 fixture，不是实际 pi-input-history 包。

规划参考 pi-pretty 0.7.0（上游 commit `862708e`）的语言支持、80k 高亮上限和 128 项缓存思路；语言扩展名表为兼容性数据，保持原表与 Dockerfile/Makefile/GNUmakefile 三个 basename 特例，不增加内容猜测或额外语言。独立审查已撤回实施时新增的 ex/exs/erl/hs/scala/tex/ini/conf/diff/r 等映射及通用无扩展名匹配。新实现直接使用公开 Shiki API 与 Pi 的 resolver/editor hooks，固定 one-dark-pro，额外增加 2Mi 字符缓存预算和 activation/revision 防迟到刷新。未引入 Pretty 版权代码，因此不发放其 MIT 源码／许可证副本。

公开运行时依赖：`shiki`、`@shikijs/cli ^4.0.2`（本次 lock 解析为 4.5.0）。Pi SDK 由宿主提供，不安装第二套 runtime。`extensions/beautify.ts` 为唯一加载入口，嵌套工具、editor、测试都不独立 discovery。

编辑器外观只装饰活实例的 render、top-border 和 padding 方法；原生 layout、IME cursor marker、paste/undo/history、输入与鼠标处理仍由宿主负责。局部复用本仓库 `editor-handoff` 的 public descriptor 事务与同步屏蔽接线，不读取编辑器私有状态。未知 shape 保守降级，后来的 wrapper 清理后继续无资源透传。

Pretty 的 FFF、LS、文件补全、用户消息前缀、Working/Thinking 动画、Claude 连续工具分组与 Edit/Write 摘要不迁移。standalone Pretty 只保留在 conflicts 中禁止共存；其个人旧配置不读写，不删文件。
