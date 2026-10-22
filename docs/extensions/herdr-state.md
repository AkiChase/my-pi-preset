# Herdr State：向 Herdr 上报 Pi 状态

在 Herdr 管理的 Pi pane 中，上报当前会话和代理状态，让 pane 能显示 Working、Blocked 或 Idle。未处于 Herdr pane 时保持静默，不影响 Pi 的正常运行。

## 启用条件

宿主必须提供以下环境变量：

- `HERDR_ENV=1`
- 非空的 `HERDR_SOCKET_PATH`
- 非空的 `HERDR_PANE_ID`

仅交互式 TUI 会话会上报状态；RPC、JSON 和 print 模式不会打开终端状态通道。不要手工伪造这些变量。

## 上报时机

- 会话启动和 agent 开始工作时上报 Working；agent 确认空闲后上报 Idle。
- Pi 的确认、选择、输入和文本编辑对话框会上报 Blocked。
- 已适配的 `ask_user_question` 问卷也会上报 Blocked；重叠问卷会保持同一段等待状态，直到全部关闭。
- 标准对话框优先使用标题作为标签；问卷优先使用第一题 header，没有时使用问题文字。标签会压成一行，最多 60 个字符。

socket 通信失败不会阻塞 Pi 的会话、工具调用或 UI 生命周期。

## 更新直接扩展

本预设将 Herdr 状态功能作为自身扩展加载。更新前若需要清理用户 agent 目录里的手工直接扩展，先预览再执行：

```sh
./install.sh
```

在同步范围和清理范围中都选中 `Extensions`，审阅真实 dry-run 计划，确认后按 Enter 执行。清理会删除未列入 `preserve.extensions` 的直接扩展入口。

完成后执行 `/reload` 或重启 Pi，使扩展发现结果重新生效。

## 配置与限制

没有专用配置文件、命令或快捷键。该扩展只负责 Herdr pane 状态，不改变 Pi 的执行、输入焦点或后台任务调度。
