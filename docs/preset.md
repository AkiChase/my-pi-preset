# 同步范围与受管理配置

同步只管理用户级包和 agent 目录中的受管内容，不修改项目 `.pi/`。

安装器可分别同步 Packages、Settings、Keybindings、Config files 和 Extensions。默认模式只对齐清单中声明的内容，保留其他本机设置；只有在清理范围中明确勾选后，才会删除该范围内未声明的内容。清理前应先查看 dry-run 计划。

当前清单会管理以下配置：

- `settings.json` 中的 `retry.maxRetries: 5`；
- `keybindings.json` 中的 `tui.editor.jumpForward: []`；
- `pi-input-history.json` 中的 `searchShortcut: "alt+r"`。

其他插件配置按各自文档维护。agent 目录默认为 `~/.pi/agent`，可用 `PI_CODING_AGENT_DIR` 改写。
