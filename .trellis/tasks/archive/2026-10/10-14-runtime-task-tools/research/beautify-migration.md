# Beautify 迁移研究

研究时旧 resolver 使用 `agentContract/jobsContract`，参数和固定正文信封分别绑定 `get_subagent_result/jobs`。新接口不能仅改名字或放宽旧 guard。

前置任务 `10-13-beautify-tool-shell-collapse` 已归档。其 `terminal-fix-report.md` 验证 `clipPlain` 消除 SDK 截断引入的 full reset，保留整行背景；dark/fullscreen 定向 tmux 9 项通过。该历史结果不覆盖新接口。

需要迁移的耦合点：

- resolver、可选 adapter、参数／结果 guard 和实际注册工具测试。
- description、状态／用量、字节范围、partial/final、released/cancelled。
- 原 renderer state/lastComponent、dynamic/unknown 委托、一次 padding、窄宽和背景。
- 展开仅用已返回内容，不读后端或消费；不新增启动工具 renderer。

最终选择与合同在 [design.md](../design.md#返回与展示)，回归结果在 [implement.md](../implement.md#最终验收)。
