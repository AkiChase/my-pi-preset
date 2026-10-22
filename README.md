# my-pi-preset

个人 [Pi](https://pi.dev) 配置预设：一份包清单、一个同步脚本和一组自带扩展，让不同机器使用同一套插件、配置与快捷键。

- [pi-preset.json](pi-preset.json)：包来源、版本、冲突和受管理配置。
- [插件文档](docs/index.md)：全部预设插件的用法、命令、配置和限制。

## 安装

机器上需已有 `pi`、`node` 和 `curl`：

```sh
curl -fsSL https://raw.githubusercontent.com/AkiChase/my-pi-preset/main/install.sh | sh
```

已有本地检出时：

```sh
./install.sh
```

安装器是无边框的交互式终端界面，不接受命令行选项。使用方向键移动、空格勾选、`A` 全选/全不选、`Enter` 前进、`Esc` 返回、`Q` 退出。同步范围默认全选，清理范围默认全不选；清理选中的域使用 prune，其余同步域使用 merge。Esc 的按键判定等待为 100ms。

执行前会生成真实 dry-run 计划，显示全部域的 Merge / Prune / Skip 状态；方向键或 PageUp/PageDown 可滚动计划。输入大写 `APPLY` 并按 Enter 才执行，退出则不应用更改。没有可交互终端时拒绝运行，不支持无人值守安装。

完成后在 Pi 中 `/reload`，或重启 Pi。脚本只管理用户级包、agent 目录内的受管配置和直接扩展入口，不修改项目 `.pi/`。

### 使用本地检出

普通安装仍使用清单中的远程来源。要加载当前检出：

```sh
pnpm install
./install.sh
```

在来源页选择 `Local checkout`，然后审阅计划并确认。第三方包仍按清单安装，本地源码直接加载，不修改清单，也不会由向导安装本地依赖。随后 `/reload`，可用 `/process-tasks-version` 查看加载路径。切回远程版，在同一个检出再次运行向导并选择 `Remote preset`。

本地来源要求完整独立检出，不能使用 Pi 管理的克隆或 curl 下载的临时文件。来源切换的移除失败会中止后续安装和配置写入，避免重复注册。未选择 Packages 或未确认执行时不会切换来源。

脚本优先使用 agent 目录中的 `bin/pi`，并打印实际路径；需要指定时：

```sh
PI_BIN=/path/to/pi ./install.sh
```

## 插件

详细说明只维护在对应文档中，README 不重复配置表和快捷键。

### 本仓库自带

| 插件 | 一句话介绍 |
| --- | --- |
| [Session Name](docs/extensions/session-name.md) | 自动评估会话标题，也可手动刷新并保护手动命名。 |
| [Widget Display](docs/extensions/widget-display.md) | 统一内置插件的编辑器区域信息，保持稳定排列。 |
| [Recap](docs/extensions/recap.md) | 会话结束并空闲后生成简短回顾，帮助恢复工作。 |
| [Task Composition](docs/extensions/task-composition.md) | 在共享面板中管理命令、子 Agent 和 workflow 的执行与等待。 |
| [Monitor](docs/extensions/monitor.md) | 持续监听命令或 WebSocket，分批通知并提醒静默与恢复。 |
| [Beautify](docs/extensions/beautify.md) | 精简工具结果展示，并美化输入框。 |
| [At Path Completion](docs/extensions/at-path-completion.md) | 接受 `@` 目录后继续显示原生补全候选。 |
| [Status Bar](docs/extensions/status-bar.md) | 汇总路径、Git、上下文、用量和扩展状态。 |
| [SSE Normalize](docs/extensions/sse-normalize.md) | 规整 SSE 响应换行，减少特定流解析错误。 |
| [Herdr State](docs/extensions/herdr-state.md) | 向 Herdr 上报 Pi 的工作、等待和空闲状态。 |
| [Trellis](docs/extensions/trellis.md) | 按任务推进开发：先规划、经批准再分阶段实施检查，验收后归档。 |
| [Memory](docs/extensions/memory.md) | 记住项目偏好、约定与参考资料，按需读取。 |

Monitor 属于 Task Composition，不是额外顶层入口；Agent、进程和共享面板的说明统一收在 Task composition 文档中。

### 第三方插件

| 插件 | 一句话介绍 |
| --- | --- |
| [pi-cache-optimizer](docs/packages/cache-optimizer.md) | 优化提示缓存并显示命中统计。 |
| [pi-input-history](docs/packages/input-history.md) | 跨会话浏览输入历史，并用 `Alt+R` 搜索。 |
| [pi-web-access](docs/packages/web-access.md) | 提供网页搜索、内容抓取及结果分页读取。 |
| [rpiv-ask-user-question](docs/packages/ask-user-question.md) | 让模型通过选项问卷澄清需求。 |
| [pi-btw](docs/packages/pi-btw.md) | 在当前会话中临时开启旁支问题。 |

第三方包由 Pi 安装，本仓库不修改其代码。清单目前使用 `latest`，实际功能以安装版本为准。清单中的 `conflicts` 用于防止功能重复加载，同步时会移除这些冲突来源。

### 从 pi-memory 迁移到内置 Memory

本预设以前安装外部的 `pi-memory` 包，现在改用自带的 [Memory](docs/extensions/memory.md)。清单已把它从 `packages` 移到 `conflicts`，同步时会移除，即使使用默认 merge 模式也一样。

两个插件都以 `memory_read`、`memory_write` 这类名字注册工具。如果旧的 `pi-memory` 还装着，Pi 启动时会提示 `Tool "memory_write" conflicts with ...` 这类扩展错误，两边仍都会加载，同名工具取先注册的一方，实际由哪一边提供取决于加载顺序。执行同步卸载、再重启 Pi 之后即可确定只会加载内置实现。

内置 Memory 只用 `~/.pi/agent/memory.json` 保存开关，你的记忆放在 `~/.pi/agent/memory/projects/<项目>/`。旧插件写在同一个 `memory` 目录下的 `MEMORY.md`、`SCRATCHPAD.md`、`daily/` 和 `recovery/` 不会被自动转换，也不会被本预设自动删除，两者互不干扰。需要保留的内容请先自行复制；确认不再需要后，由你手动删除。

## 同步与更新

```sh
pi update --extensions
./install.sh
```

向导会依次显示来源、同步范围和清理范围。所有选择均在审阅页回显，包括跳过项；取消后重新运行可重新选择。

| 界面选择 | 用途 |
| --- | --- |
| 同步范围 | 选择 Packages、Settings、Keybindings、Config files、Extensions；默认全选。 |
| 清理范围 | 仅列出已选同步域，默认全不选；勾选后使用 prune。 |
| 来源 | 默认远程预设；完整本地检出可选择本地源码。 |
| 计划审阅 | 读取当前状态并展示 dry-run 结果，不执行更改；输入 `APPLY` 后才执行。 |

默认 **merge**：对齐清单声明的内容，保留未声明值；**prune**：删除选定域中未声明且未受保护的内容。`conflicts` 中的包即使在 merge 模式也会移除，清单声明的 `null` 也会删除对应配置。`extensions` 域只处理用户 agent 目录下的直接 Pi 扩展入口。

计划预览与执行使用相同选择，但不会锁定其间的外部配置修改；同步器在执行时重新读取状态。

### 受管理的配置

当前清单只声明三项配置：

- `settings.json` 的 `retry.maxRetries: 5`。
- `keybindings.json` 的 `tui.editor.jumpForward: []`，禁用与问卷折叠键冲突的内置动作。
- `pi-input-history.json` 的 `searchShortcut: "alt+r"`。

其余插件配置按对应文档自行维护。agent 目录默认 `~/.pi/agent`，可用 `PI_CODING_AGENT_DIR` 改写；问卷等采用其他配置目录的插件不跟随这个变量。

### 修改清单

`packages` 是“来源 → 版本”：`latest` 跟随更新，精确版本固定，范围版本在范围内升级，Git 来源可指定 tag 或 commit。添加包后提交到自己的仓库，再在各机器运行同步；不要把同一来源同时声明为安装包和冲突包。

`settings` 和 `files` 按嵌套叶子合并；数组和标量整体替换。`keybindings` 按完整动作 ID 对齐。`null` 表示删除声明项，`[]` 可用于禁用键位；仅从清单移除一个键不会在 merge 模式自动删除本机值。

`preserve` 为 prune 保留机器各自的偏好，当前包括主题、默认 provider、模型和思考等级。`preserve.extensions` 可保留用户扩展目录中指定的直接入口名；它不安装或更新这些入口。声明与保护路径不能重叠。Pi 自己维护的 `settings.packages` 和 `lastChangelogVersion` 不受同步管理。

`files` 只接受 agent 根目录内声明的 `.json` 文件名；不支持子目录或其他配置根目录。未声明的文件不会被读取、写入或清理。认证、信任、模型等受保护文件不能加入此域。prune 会清理声明文件中的未保护叶子，使用前先看 dry-run。

`extensions` 只扫描 agent 根目录 `extensions/` 第一层的直接 `.ts` / `.js` 文件，以及带 `index.ts`、`index.js` 或 Pi package 扩展声明的直接子目录；隐藏项和 `node_modules` 不在范围内。merge 模式不会改动它们；prune 会删除未列入 `preserve.extensions` 的入口。普通 JSON 和其他非扩展文件不会被递归清理；如果 `extensions/` 根目录自身是一个 Pi extension package / index，脚本会拒绝 prune，避免误删共享目录内容。

配置内容不变时不会重写；遇到坏 JSON 会报错，不覆盖。日志写入 stderr，便于看出同步进行到哪一步。更新配置后 `/reload`；个别影响工具开关的插件设置需要重启，见各插件文档。
