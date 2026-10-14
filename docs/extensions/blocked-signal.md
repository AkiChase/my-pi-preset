# Blocked Signal：交互等待状态提示

需要你回答、选择、确认或编辑文本时，向支持的终端宿主提示「Pi 正在等你」。没有相应宿主环境时保持静默。

## Herdr

在 Herdr 中运行时报告 Blocked 状态，覆盖 Pi 的标准选择、确认、输入和文本编辑对话框，以及已适配的 `ask_user_question` 问卷。

启用要求同时具备以下宿主环境变量：

- `HERDR_ENV=1`
- 非空的 `HERDR_SOCKET_PATH`
- 非空的 `HERDR_PANE_ID`

这些值应由实际宿主提供，不要为了启用通知伪造它们。

## 直接运行在 cmux 中

补充问卷和文本编辑的等待通知。通知标题为 `pi is waiting`，正文为当前提示标签，不会把 cmux 面板的代理状态直接改成 Blocked。标准确认、选择、输入由 cmux 自身的 Pi hooks 处理，本扩展不重复通知。

启用要求以下环境变量均非空：

- `CMUX_SOCKET_PATH`
- `CMUX_WORKSPACE_ID`
- `CMUX_BUNDLED_CLI_PATH`：宿主提供的通知 CLI 路径。

`CMUX_PI_HOOKS_DISABLED=1` 可关闭直接 cmux 的补充通知。同时处于 Herdr 和 cmux 时优先使用 Herdr，避免重复通知。

## 标签与清除

优先显示标准对话框标题；问卷优先显示第一题 header，没有时使用问题文字。标签会压成一行，最多显示 60 个字符。对应等待结束或会话退出时清除本扩展的提示，重叠问卷不会为同一段持续等待重复通知。

## 配置与限制

没有专用配置文件、命令或快捷键。Viewer、Task Panel 等浏览面板不会自动标为等待用户；未适配的第三方 custom 问答也不会自动通知。

通知失败不会阻止 Pi 会话继续。本扩展不修改 Pi 的 OSC 状态，不暂停模型或后台任务。浏览面板仍可能接管键盘，没有 Blocked 提示不代表可以安全投递聊天输入。
