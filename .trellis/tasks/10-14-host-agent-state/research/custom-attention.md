# 规划补充：custom 问答身份已有公开事件

核对已安装 `@juicesharp/rpiv-ask-user-question`：

- `events.ts:24-39` 定义稳定公开频道 `rpiv:ask-user:blocked`，payload `{ active: boolean }`；注释明确覆盖 TUI/RPC，finally 释放。
- `ask-user-question.ts:444-472` 在真正挂载问卷前 emit true，并在 finally emit false。问卷预加载失败不会发 true；比 prompt label 事件可靠。
- `ask-user-question.ts:403-429` 的 `rpiv:ask-user:prompt` 在异步加载前发出，仅适合作为文字标签，不适合当作待回答状态的证明。

建议的 preset 修正不需要修改 Pi SDK 或 Viewer：

1. 标准 select/confirm/input/editor 继续按 ui_prompt_start/end 处理。
2. custom 不默认映射为 attention；现有问卷直接使用 `rpiv:ask-user:blocked`。
3. 聚合标准 prompt 与明确问卷的 active 状态，避免 RPC select/input 或嵌套弹窗造成双重 true/false 和重复通知。识别关闭时实际打开的类别，忽略未 block 的 custom end；shutdown 幂等释放。
4. 后续其他自定义审批需要显式接入 attention 信号，不靠标题/工具是否执行猜测。

兼容代价：没有显式事件的未知 custom 问答不会再自动触发 blocked。应由用户确认此默认策略。浏览面板虽不再被当作 attention，但 Herdr 终端 prompt 输入安全保护是另一问题，不得宣称已修复。

Herdr 状态调研另由只读 agent 核实 v9 与官方接口；当前不编辑个人集成、不添加第二 socket 状态发布器。
