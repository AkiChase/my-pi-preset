# 迁移面研究

旧工具耦合不限 registration：

| 层 | 需核对的内容 |
| --- | --- |
| 执行 | process 的 jobs actions、bash_bg notify/timeout；agent retrieval、nested tools、workflow terminal |
| 子会话 | allow/deny、readmission、late registration、同名 customTool 覆盖 |
| 展示 | Beautify resolver、固定信封 guard、字节范围、等待状态、背景和原 renderer 委托 |
| 提示与测试 | 默认 agent、schedule/workflow 文案、实际 loader/tool fixtures |
| 文档 | 用户工具入口；PROVENANCE 本地偏离；开发测试规范 |
| 外部 | pi-trellis ordinary Agent hook、RPC提示、provider probe |

前置 Beautify 的 `clipPlain` 必须保留。外部生成资源不手改；RPC真实ID和协议保持，工具名检测由关联任务更新。

实施期间 main 有其他插件和通知任务成果，需局部三方整合而非旧 worktree 全量覆盖。最终设计见 [design.md](../design.md)，集成证据见 [source-integration-validation.md](source-integration-validation.md)。
