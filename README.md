# my-pi-preset

个人 [Pi](https://pi.dev) 配置预设：用一份清单同步常用包、少量 Pi 配置和自带扩展，让不同机器保持一致。

- [插件文档](docs/index.md)：各项功能的用法、命令、配置和限制。
- [pi-preset.json](pi-preset.json)：本预设的包来源和受管理配置。

## 安装

机器上需已有 `pi`、`node` 和 `curl`：

```sh
curl -fsSL https://raw.githubusercontent.com/AkiChase/my-pi-preset/main/install.sh | sh
```

安装器是交互式终端界面。它会依次让你选择来源、同步范围和清理范围，再展示真实 dry-run 计划；确认前不会修改本机。默认同步全部范围，不默认清理任何内容。

同步完成后，在 Pi 中运行 `/reload`，或重启 Pi。

## 更新

安装命令也是更新器。需要更新预设时，重新运行：

```sh
curl -fsSL https://raw.githubusercontent.com/AkiChase/my-pi-preset/main/install.sh | sh
```

向导会获取最新预设并在应用前展示计划。不要用 `pi update --extensions` 代替它：该命令只更新已经安装的扩展包，不会按最新预设重新同步。更新完成后运行 `/reload`，或重启 Pi。

## 插件

### 内置插件

| 插件 | 一句话介绍 |
| --- | --- |
| [Session Name](docs/extensions/session-name.md) | 自动评估会话标题，也可手动刷新并保护手动命名。 |
| [Recap](docs/extensions/recap.md) | 会话结束并空闲后生成简短回顾，帮助恢复工作。 |
| [Task Composition](docs/extensions/task-composition.md) | 在共享面板中统一管理命令、持续监听、子智能体和工作流；支持后台执行、查看与控制，以及运行提醒。 |
| [Beautify](docs/extensions/beautify.md) | 精简工具结果展示，并美化输入框。 |
| [At Path Completion](docs/extensions/at-path-completion.md) | 接受 `@` 目录后继续显示原生补全候选。 |
| [Status Bar](docs/extensions/status-bar.md) | 汇总路径、Git、上下文、用量和扩展状态。 |
| [SSE Normalize](docs/extensions/sse-normalize.md) | 规整 SSE 响应换行，减少特定流解析错误。 |
| [Herdr State](docs/extensions/herdr-state.md) | 向 Herdr 上报 Pi 的工作、等待和空闲状态。 |
| [Trellis](docs/extensions/trellis.md) | 按任务推进开发：先规划、经批准再分阶段实施检查，验收后归档。 |
| [Memory](docs/extensions/memory.md) | 记住项目偏好、约定与参考资料，按需读取。 |

### 第三方插件

| 插件 | 一句话介绍 |
| --- | --- |
| [pi-cache-optimizer](docs/packages/cache-optimizer.md) | 优化提示缓存并显示命中统计。 |
| [pi-input-history](docs/packages/input-history.md) | 跨会话浏览输入历史，并用 `Alt+R` 搜索。 |
| [pi-web-access](docs/packages/web-access.md) | 提供网页搜索、内容抓取及结果分页读取。 |
| [rpiv-ask-user-question](docs/packages/ask-user-question.md) | 让模型通过选项问卷澄清需求。 |
| [pi-btw](docs/packages/pi-btw.md) | 在当前会话中临时开启旁支问题。 |

第三方插件由 Pi 安装，功能和配置以实际安装版本及上游文档为准。

## 同步范围

向导可分别同步 Packages、Settings、Keybindings、Config files 和 Extensions。默认模式只对齐清单中声明的内容，保留其他本机设置；只有在清理范围中明确勾选后，才会删除该范围内未声明的内容。清理前应先查看 dry-run 计划。

当前受管理的配置和完整说明见[同步范围与受管理配置](docs/preset.md)。

## 定制自己的预设

这是个人预设，不是面向所有人的通用配置器。若你的包、配置或扩展需求不同，请 fork 本仓库后自行修改和维护；fork 后的后续更新也由你自己负责。

fork 后可克隆自己的仓库，在仓库根目录运行：

```sh
./install.sh
```

如果你正在本地修改自己的 fork，想让 Pi 立即使用这些尚未提交或推送的改动，可在来源页选择 `Local checkout`。这样只会把本预设从当前仓库加载；第三方包仍按清单安装。

这需要一个完整、独立的 Git 仓库，因为 Pi 要读取其中的源码和依赖。通过 `curl` 运行安装器得到的临时文件，以及 Pi 管理的克隆，都不能用于这种本地调试。
