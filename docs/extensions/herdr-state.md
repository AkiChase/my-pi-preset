# Herdr State：向 Herdr 上报 Pi 状态

在 Herdr TUI 管理的 pane 中同步 Pi 会话与 Working、Blocked、Idle 状态；在 herdr-core 中补齐问卷等待的 Blocked 和简短标签，其他状态由 Pi 原生上报。

仅交互式 TUI 会话启用。RPC、JSON 和 print 模式保持静默；未处于受支持的 Herdr 环境时不影响 Pi 的正常运行。

## 启用条件

环境变量由宿主提供，不要手工伪造：

| 宿主 | 必需环境 |
| --- | --- |
| Herdr TUI | `HERDR_ENV=1`、非空 `HERDR_SOCKET_PATH` 和 `HERDR_PANE_ID` |
| herdr-core | 非空 `HC_TERMINAL_ID` 和 `HC_TERMINAL_SOCKET` |

如果两套完整环境同时存在，使用 Herdr TUI 通道。

## Herdr TUI

- 会话启动时同步当前状态和会话引用。
- agent 开始执行时上报 Working；确认空闲后上报 Idle。
- Pi 的确认、选择、输入和文本编辑对话框上报 Blocked。
- 已适配的 `ask_user_question` 问卷上报 Blocked；重叠问卷保持等待，直到全部关闭。

socket 通信失败不会阻塞 Pi 的会话、工具调用或 UI。

## herdr-core

Working、Done、Error、Idle，以及 Pi 自身的权限、登录和标准对话框状态，继续由 Pi 原生上报。扩展只补已适配问卷的 Blocked；问卷关闭后恢复最新原生状态，原生权限或登录等待优先。

该通道遵循 Pi 的终端能力检测与状态上报设置，关闭原生上报时不会另外发送状态。

## 问卷标签与限制

问卷优先使用第一题 header，没有时使用问题文字。标签压成一行，最多 60 个字符。普通浏览器、设置等 custom 界面不会仅因打开而被判为问卷。

core 通道需要在扩展加载后观察到一次原生状态变化才能补报。因此，加载时已经打开的问卷可能不会立即补报；正常新一轮模型调用和空闲重载后的下一轮问卷可启用补齐。扩展不会为补报而猜测当前状态。

没有专用配置文件、命令或快捷键。该扩展不改变 Pi 的执行、输入焦点、问卷界面或后台任务调度。
