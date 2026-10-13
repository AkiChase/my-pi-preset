# 后续工具包装讨论（不属于当前修复范围）

用户反馈：
- write 不要包装成一行，正文预览有价值。
- 质疑 ls 的必要性，bash 已可列目录；尚未决定删除/隐藏 ls。
- 对其他候选包装方向基本认可，但要求避免工具不存在时失败，以及对可选插件过强耦合。

设计边界建议（尚非实施授权）：
- 使用公开 registerToolRenderer 的按名称惰性 resolver，不注册工具执行、不激活工具、不 import 可选插件内部模块。
- 工具未出现时不触发适配；未匹配工具直接 next。不要仅在启动时根据工具列表建立永久判断，需支持动态注册和恢复历史。
- 存在同名工具也不代表契约相同，必须验证实际参数/结果形状。未知格式委托原 renderer，不能依赖私有 registry/state 或文本格式猜准确统计。
- expanded 委托原 renderer 时保留其 call/result 状态和 lastComponent 隔离；不能承诺原 renderer 展开即全文。
- absent/dynamic-registration/same-name-different-shape/unknown-details 必须测试。

当前任务仍只修 Read/Bash/Find/Grep；后续候选不得自动扩入或实施。
