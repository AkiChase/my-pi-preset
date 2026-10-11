# my-pi-preset

个人 [pi](https://pi.dev) 配置预设。

内容很简单：一份包清单，一个同步脚本，几个自己写的扩展。在新机器上跑一条命令，pi 就装成我平时用的样子：第三方扩展备齐，自定义状态栏就位，几个扩展之间的冲突也已经处理掉。

- 清单：[`pi-packages.json`](pi-packages.json)，记录要装哪些包、装什么版本、哪些包不能装
- 同步：[`install.sh`](install.sh) 和 [`scripts/sync.mjs`](scripts/sync.mjs)，负责把本机状态对齐到清单
- 扩展：[`extensions/`](extensions)，本仓库自带的三个扩展，pi 安装本仓库时会自动发现

本仓库自己也是清单里的一条（`git:github.com/AkiChase/my-pi-preset`），和其他包一样被 pi 管理和更新。

## 安装

在新机器上，跑一条命令就行：

```sh
curl -fsSL https://raw.githubusercontent.com/AkiChase/my-pi-preset/main/install.sh | sh
```

本地已经有检出的话，直接执行脚本，效果一样：

```sh
./install.sh
```

想先看看会发生什么，不动手：

```sh
./install.sh --dry-run
```

前提是机器上有 `pi`、`node`、`curl`。装完后在 pi 里 `/reload`，或者重启 pi。

### 命令行选项

| 选项 | 作用 |
| --- | --- |
| `--dry-run` | 只打印计划，不做任何改动 |
| `--prune` | 以清单为准，删掉清单里没有的包 |

默认是合并模式：某台机器上临时 `pi install` 的包会保留。加上 `--prune` 之后，清单就是全集。脚本只管理用户级包，项目 `.pi/settings.json` 里的包不受影响。

### 用哪个 pi

有些终端应用会在 `PATH` 前面放一个同名的 `pi` 启动器，撞上它的话 `pi install` 会去打开那个应用，而不是装包。所以脚本优先使用受管理的可执行文件 `$PI_CODING_AGENT_DIR/bin/pi`（默认是 `~/.pi/agent/bin/pi`），并且会把它实际用的是哪个打印出来。要指定别的路径：

```sh
PI_BIN=/path/to/pi ./install.sh
```

## 日常使用

```sh
pi update --extensions   # 更新本仓库的扩展，以及已装的包
./install.sh             # 清单改过之后，把这台机器对齐过去
./install.sh --prune     # 顺手清掉清单外的包
```

pi 里只有一个本仓库自带的命令：`/statusbar`，在自定义状态栏和 pi 内置 footer 之间切换。其余扩展各自的命令、快捷键和配置文件，都在下面两节里。

## 这里有什么

先放一张总表，细节看后面各小节。

| 包 | 作用 | 配置文件 | 快捷键 |
| --- | --- | --- | --- |
| [`pi-session-name`](#npmpi-session-name) | 自动生成会话标题，同步到终端标题栏 | 无 | 无 |
| [`pi-cache-optimizer`](#npmpi-cache-optimizer) | 提高缓存命中率，显示命中统计 | `~/.pi/agent/pi-cache-optimizer-config.json` | 无 |
| [`pi-input-history`](#npmpi-input-history) | 跨会话的输入历史，模糊反向搜索 | `~/.pi/agent/pi-input-history.json` | `ctrl+r`，可改 |
| [`pi-web-access`](#npmpi-web-access) | 联网：搜索、抓取、PDF、GitHub、视频 | `~/.pi/agent/web-search.json` | `ctrl+shift+s` 等，可改 |
| [`pi-memory`](#npmpi-memory) | 跨会话记忆：长期记忆、日志、便签、检索 | 无（只有 `PI_MEMORY_*` 环境变量） | 无 |
| [`@tintinweb/pi-subagents`](#npmtintinwebpi-subagents) | 子 agent 和工作流编排 | `~/.pi/agent/subagents.json` | 无（只有浮层内按键） |
| [`@juicesharp/rpiv-ask-user-question`](#npmjuicesharprpiv-ask-user-question) | 让模型给出选项，而不是自己猜 | `~/.config/rpiv-ask-user-question/config.json` | `ctrl+]`，可改 |
| [`pi-patty-bg-tasks`](#npmpi-patty-bg-tasks) | 后台任务：长命令不阻塞会话 | `~/.pi/agent/bg-tasks.json` | `ctrl+shift+b` 等，可改 |
| [`@heyhuynhgiabuu/pi-pretty`](#npmheyhuynhgiabuupi-pretty) | 终端输出美化 | `~/.pi/agent/pi-pretty.json` | 无 |

前七个是普通依赖，由 pi 从 npm 安装，来源写在 [`pi-packages.json`](pi-packages.json) 的 `packages` 里，本仓库不动它们的代码。

后两个（patty 和 pretty）比较特殊：它们以本仓库 npm 依赖的形式引入（见 [`package.json`](package.json)），由 `extensions/bash-unified.ts` 亲自加载，所以也被写进了清单的 `conflicts`，**不能**再当成普通 pi 包安装。否则 `bash` 这个工具会被注册两次，pi 直接报冲突、启动失败。

### 第三方包

下面这些「配置」小节写的都是扩展自己的配置入口，包括文件路径、键名、默认值和环境变量。pi 本体的键位怎么改、冲突怎么判，统一放在 [配置扩展](#配置扩展) 里。

#### `npm:pi-session-name`

> 来源：[npm](https://www.npmjs.com/package/pi-session-name) · [GitHub](https://github.com/ttttmr/pi-session-name)

拿会话的第一条用户输入，让当前模型生成一句短标题写进会话名，同时把 agent 的忙闲状态同步到终端标题栏（运行中 `· <会话名>`，空闲 `✳ <会话名>`）。生成失败会重试三次，之后就安静放弃，不报错。

**提供**：没有工具、命令、快捷键，只挂 `input`、`agent_start`、`agent_end` 三个事件。

**配置**：无任何配置项，标题来源和符号都写死在源码里。

#### `npm:pi-cache-optimizer`

> 来源：[npm](https://www.npmjs.com/package/pi-cache-optimizer) · [GitHub](https://github.com/jiangge/pi-cache-optimizer)

稳定化 system prompt、注入 OpenAI 兼容的 `prompt_cache_key`、按会话派生亲和性请求头，以此提高 prompt / KV 缓存命中率，并在底栏持续显示命中统计。发现模型的 compat 配置缺失时会提示并可自动修复。

**提供**：斜杠命令 `/cache-optimizer`（子命令有 `enable` / `disable` / `doctor` / `stats` / `compat` / `fix` / `rollback` / `config …`，不带参数弹交互菜单），以及底栏状态（status key `pi-cache-stats`）。

**配置**：

- 配置文件 `~/.pi/agent/pi-cache-optimizer-config.json`，主要键是 `footerMode`、`features`、`promptCacheKey.omit`，建议用 `/cache-optimizer config` 子命令改。
- 每个 feature 也有对应的 `PI_CACHE_OPTIMIZER_*` 环境变量。优先级：配置文件 > 环境变量 > 默认值。
- 统计数据在 `~/.pi/agent/pi-cache-optimizer-stats.json` 和 `pi-cache-optimizer-stats.d/` 目录。
- 底栏的 `⚠️ compat` 指 `~/.pi/agent/models.json` 里缺的 compat 键，跑 `/cache-optimizer doctor` 看缺哪个，`/cache-optimizer fix` 自动补。

#### `npm:pi-input-history`

> 来源：[npm](https://www.npmjs.com/package/pi-input-history) · [GitHub](https://github.com/ouzhenkun/pi-input-history)

pi 自带的 ↑/↓ 历史只在当前会话有效，重载就没了。这个扩展在会话启动时把当前目录下历史会话里的输入（去重后最近 100 条）灌进编辑器历史，↑/↓ 能直接翻到上个会话的 prompt。另外提供一个反向搜索浮层，模糊匹配，刚输入的内容也能立刻搜到。

**提供**：全局快捷键 `ctrl+r` 打开反向搜索浮层。浮层内：`ctrl+r` / `↑` 更旧，`ctrl+s` / `↓` 更新，`ctrl+k` / `ctrl+j` 滚动预览，`Enter` 填入，`Esc` 或 `ctrl+g` 取消。没有工具和斜杠命令。

**配置**：配置文件 `~/.pi/agent/pi-input-history.json`，四个键位都可以改，改完 `/reload`：

```json
{
  "searchShortcut": "alt+r",
  "newerShortcut": "ctrl+s",
  "scrollUpShortcut": "ctrl+k",
  "scrollDownShortcut": "ctrl+j"
}
```

历史条数（固定 100）和去重行为不可配置。默认的 `ctrl+r` 会撞 pi 的 `app.session.rename`，见 [键位冲突](#键位冲突)。

#### `npm:pi-web-access`

> 来源：[npm](https://www.npmjs.com/package/pi-web-access) · [GitHub](https://github.com/nicobailon/pi-web-access)

给 pi 接上网络。搜索聚合了 30 多家 provider（OpenAI、Brave、Tavily、Exa、Gemini、Kagi、Firecrawl 等）；抓取侧支持 URL 转 Markdown、PDF、GitHub 仓库 / Issue / PR、YouTube 字幕和本地视频抽帧。检索结果完整落盘，模型只读分页摘要，上下文不会被整页内容冲爆。附带浏览器端的「结果策展器」，可以人工筛过来源再交给模型。

**提供**：工具 `web_search`、`source_check`、`fetch_content`、`get_search_content`、`web_enable`（惰性加载器）；命令 `/websearch`、`/curator`、`/search`、`/google-account`；快捷键 `ctrl+shift+s`（策展器）、`ctrl+shift+w`（活动面板）。

**配置**：配置文件 `~/.pi/agent/web-search.json`（旧路径 `~/.pi/web-search.json` 也认）。常用键：

- `provider` / `searchProvider`：默认 `"auto"`，可写 `"all"` 或 provider 名数组。
- `shortcuts.curate`、`shortcuts.activity`：改快捷键用这两个，值是 pi 的 KeyId 字符串。
- `commands.<名字>.enabled`：禁命令在这里改，不是在 pi 全局配置里。
- `tools.<名字>.enabled`、`toolNames.<名字>`：开关或重命名工具。
- `workflow`、`toolActivation`、`maxInlineContentChars`、`fetch.defaultMode`、`proxy` 等。

```json
{
  "provider": "auto",
  "shortcuts": { "curate": "ctrl+alt+s", "activity": "ctrl+alt+w" },
  "webSearch": { "allowedProviders": ["brave", "exa", "gemini"] }
}
```

各家 API key 用环境变量提供（`BRAVE_API_KEY`、`TAVILY_API_KEY`、`EXA_API_KEY` 等），也可以写进配置文件，环境变量优先级更高。完整的 provider 和键名清单见上游 README。

#### `npm:pi-memory`

> 来源：[npm](https://www.npmjs.com/package/pi-memory) · [GitHub](https://github.com/jayzeng/pi-memory)（需要 Node ≥ 22.19）

给 pi 一份跨会话的记忆，全部是 `~/.pi/agent/memory/` 下的纯 markdown：`MEMORY.md` 放长期的决定和偏好，`daily/<日期>.md` 是追加式工作日志，`SCRATCHPAD.md` 是待办清单，`recovery/` 存可恢复的删除记录。每轮 agent 开始前把「未完成便签 + 今天的日志 + `MEMORY.md` + 昨天的日志」按优先级注入 system prompt（合计上限 16K 字符）。上下文压缩前会把当前进度写一条 handoff 进当天日志；退出时默认还会调一次模型写退出摘要。

默认是 `stable` 快照模式：只在会话开始、压缩前、写长期记忆、跨天这几个检查点刷新注入内容，中间每轮字节完全一致，这样本地前缀缓存（llama.cpp / vLLM / MLX）不会每轮失效。`PI_MEMORY_SNAPSHOT=per-turn` 换回每轮重建，并顺带开启「按当前 prompt 自动检索记忆」的注入。

**提供**：工具 `memory_write`、`memory_read`、`memory_forget`、`memory_restore`、`scratchpad`、`memory_search`、`memory_status`。没有斜杠命令，不注册快捷键，也不写状态栏。

**配置**：没有配置文件，全部走环境变量。常用的几个：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PI_MEMORY_DIR` | `~/.pi/agent/memory` | 换存储目录 |
| `PI_MEMORY_SNAPSHOT` | `stable` | 改成 `per-turn` 回到每轮重建 + 自动检索注入 |
| `PI_MEMORY_EXIT_SUMMARY` | 开启 | 设 `0` / `off` 关掉退出摘要，退出就不再调模型，瞬间退出 |
| `PI_MEMORY_EXIT_SUMMARY_MODEL` | 会话模型 | 用便宜的模型写退出摘要，格式 `provider/model-id` |
| `PI_MEMORY_QMD_UPDATE` | `background` | 写入后自动重建索引和向量；`manual` / `off` 关掉 |

另有 `PI_MEMORY_EXIT_SUMMARY_TIMEOUT_MS`（默认 10000）、`PI_MEMORY_QMD_SEARCH_TIMEOUT_MS`（默认 60000）、`PI_MEMORY_SUMMARIZE_TRANSITIONS`、`PI_MEMORY_NO_SEARCH`。

`memory_search` 需要额外装 [qmd](https://github.com/tobi/qmd)（`npm install -g @tobilu/qmd`），装了之后扩展会自己建好 `pi-memory` collection 和 path context，并在后台跑 `qmd update` / `qmd embed`；没装则只有这一个工具不可用，其余照常，`memory_status` 会告诉你当前缺什么。**本仓库不管 qmd 的安装**，要语义检索就自己在那台机器上装。

#### `npm:@tintinweb/pi-subagents`

> 来源：[npm](https://www.npmjs.com/package/@tintinweb/pi-subagents) · [GitHub](https://github.com/tintinweb/pi-subagents)

把 Claude Code 那套子 agent 和工作流编排搬进 pi。主会话可以把任务派给独立 pi 会话里的子 agent：并行或后台执行，跑到一半可以改向，支持嵌套委派、定时触发、git worktree 隔离和持久化记忆。多阶段任务可以用脚本化工作流（pipeline / parallel / 动态扇出）描述。内置三个 agent 类型：`general-purpose`、`Explore`、`Plan`。

**提供**：工具 `Agent`、`SubagentWorkflow`、`get_subagent_result`、`steer_subagent`；命令 `/agents`（交互菜单，管 agent 类型、定时任务、工作流和设置）；输入框里 `@handle <消息>` 可以直接对某个子 agent 说话。不注册全局快捷键，按键只在它自己的浮层里生效。

**配置**：

- 自定义 agent 类型是 `.md` 文件，放在 `~/.pi/agent/agents/`（全局）或 `<项目>/.pi/agents/`（项目）。frontmatter 写 `name`、`description`、`tools`、`model`、`thinking` 等，正文就是 system prompt。完整字段列表见上游 README。
- 设置文件：全局 `~/.pi/agent/subagents.json`，项目 `<项目>/.pi/subagents.json`（`/agents → Settings` 写这层）。常用键有 `maxConcurrent`（默认 10）、`maxSubagentDepth`（默认 2）、`backgroundByDefault`、`worktreeIsolation` 等，非法值按字段静默丢弃。
- `schedulingEnabled`、`workflowsEnabled`、`toolDescriptionMode`、`disableDefaultAgents` 会改动工具 schema，改了要**重启 pi** 才生效，其余即时生效。

#### `npm:@juicesharp/rpiv-ask-user-question`

> 来源：[npm](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question) · [GitHub](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)（需要 Node ≥ 22）

让模型在该问而不是该猜的地方停下来。它注册一个 `ask_user_question` 工具：模型一次最多抛 4 个问题，每题带 2 到 4 个写明含义的选项，终端底部弹出带页签的问卷，选择以结构化数据回传。选项可以带 markdown `preview`（ASCII 原型、代码片段、配置示例），渲染在选项列表右侧。每题末尾固定有一行自由作答入口。非交互运行时这个工具会自动从工具列表里消失，不会报错。

**提供**：工具 `ask_user_question`。没有斜杠命令，不注册全局快捷键；问卷内的按键见问卷底部提示，其中 `ctrl+]` 用来折叠 / 展开浮层。

**配置**：配置文件 `~/.config/rpiv-ask-user-question/config.json`（走 `XDG_CONFIG_HOME`，不在 agent 目录下），只读不写。能配四项：`collapseKey`（默认 `"ctrl+]"`，写 `"off"` 关掉）、`guidance.description`、`guidance.promptSnippet`、`guidance.promptGuidelines`（后三项调节模型提问的积极程度）。其余按键不可重映射。默认的 `ctrl+]` 会撞 pi 的 `tui.editor.jumpForward`，见 [键位冲突](#键位冲突)。

### 由本仓库代为加载的包

#### `npm:pi-patty-bg-tasks`

> 来源：[npm](https://www.npmjs.com/package/pi-patty-bg-tasks) · [GitHub](https://github.com/patty-io/pi-patty-bg-tasks)

把 Claude Code 的后台任务体验搬到 pi：长命令不再卡住会话。它覆盖内置 `bash`，跑超过 120 秒的命令自动转入后台，并提供整套作业管理。作业状态写进 session 条目，重开会话能恢复还在跑的作业；退出 pi 时统一清理。

**提供**：

- 工具：`bash`（覆盖内置，新增 `run_in_background`、`timeout`、`description` 参数）、`bash_bg`（直接后台启动）、`jobs`（list / output / kill / attach / search / cleanup / stats）、`agent_bg`（后台跑一个独立 `pi -p` 进程）、`monitor`（按事件流监听命令输出或 WebSocket）。日志默认落在 `/tmp/pi-bg/<jobId>.log`。
- 斜杠命令：`/bg` 转后台、`/bg-list` 任务面板、`/bg-version` 打印版本和路径、`/bg-config` 显示生效的配置、来源文件和加载警告。
- 快捷键（默认值，可改）：`ctrl+shift+b` 转后台，`ctrl+shift+j` / `shift+down` 打开任务面板，`ctrl+shift+x` kill 最近一个运行中的作业。

**配置**：配置文件 `~/.pi/agent/bg-tasks.json`（目录跟 `PI_CODING_AGENT_DIR`），优先级是环境变量 > 配置文件 > 默认值。文件可以不存在。每个键都能用环境变量覆盖，名字是 `BG_TASKS_` 加大写蛇形：`timeoutMs` → `BG_TASKS_TIMEOUT_MS`。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `timeoutMs` | `120000` | 前台命令跑多久后自动转后台 |
| `logDir` | `"/tmp/pi-bg"` | 日志目录，支持开头的 `~` |
| `maxConcurrentJobs` | `16` | 同时在跑的后台任务上限 |
| `maxLogBytes` | `104857600` | 日志超过这个大小就杀掉任务 |
| `outputPreviewChars` | `12000` | `jobs output` 和前台命令结束时显示多少尾部 |
| `failureTailLines` | `20` | 失败通知内联几行日志 |
| `failureTailChars` | `2000` | 这段尾部的字符上限 |
| `failureTailLinesShown` | `5` | TUI 在摘要下显示其中几行，`0` 为不显示 |
| `stallCheckIntervalMs` | `5000` | 卡死检测的轮询间隔 |
| `stallThresholdMs` | `45000` | 日志多久没增长算可疑 |
| `stallTailBytes` | `1024` | 判断交互提示符时读多少尾字节 |
| `monitorDefaultTimeoutMs` | `300000` | `monitor` 的默认截止时间 |
| `monitorMaxTimeoutMs` | `3600000` | `monitor` 的硬上限 |
| `monitorPollMs` | `200` | `monitor` 轮询间隔，同时是事件合并窗口 |
| `monitorRateWindowMs` | `10000` | 刷屏检测的滑动窗口 |
| `monitorMaxLinesPerWindow` | `500` | 一个窗口内超过这么多行就自动停掉 monitor |
| `shortcutBackground` | `["ctrl+shift+b"]` | 转后台 |
| `shortcutTaskPanel` | `["ctrl+shift+j", "shift+down"]` | 打开任务面板 |
| `shortcutKillLatest` | `["ctrl+shift+x"]` | kill 最近一个运行中的作业 |

快捷键三项都接单个键名、键名数组，或 `"off"` 关掉。这是唯一能改这些键的途径 —— `pi.registerShortcut` 收的是原始键组合、不走 keybinding id，所以 `keybindings.json` 管不到它们。默认不注册 `ctrl+b`，那是 pi 内置的 `tui.editor.cursorLeft`，见 [键位冲突](#键位冲突)。

配置文件写错不会让扩展加载失败：非法值一律回退默认值，未知键会被忽略，每条都记一句警告 —— 用 `/bg-config` 看。渲染细节（侧栏预览宽度、2 秒快速完成窗口等）仍然写死在 `extensions/bg-tasks/types.ts`，没有开放。

#### `npm:@heyhuynhgiabuu/pi-pretty`

> 来源：[npm](https://www.npmjs.com/package/@heyhuynhgiabuu/pi-pretty) · [GitHub](https://github.com/heyhuynhgiabuu/pi-pretty)

接管 pi 内置工具的渲染层：文件预览用 Shiki 做带行号的语法高亮，bash 输出和退出码上色，目录列表渲染成带 Nerd Font 图标的树。执行逻辑仍来自 SDK 的原始工具定义（通过 `deps.sdk` 注入），它只替换渲染，这正是 `extensions/bash-unified.ts` 能把它和 patty 拼起来的前提。TUI 上另有用户消息前缀、自定义 working 指示器、思考计时标签，以及基于 FFF 索引的 `@` 文件补全和 find / grep 加速。

**提供**：覆盖注册 `read`、`bash`、`find`、`grep`（`ls` 默认关闭）；命令 `/fff-health`、`/fff-rescan`（FFF 可用时）；不注册自定义键位，展开折叠用 pi 自带的 `ctrl+o`。

**配置**：配置文件 `~/.pi/agent/pi-pretty.json`（目录可用 `PRETTY_CONFIG_DIR` 改写），优先级是环境变量 > 配置文件 > 默认值。常用键：

| 键 | 环境变量 | 默认 |
| --- | --- | --- |
| `theme`（Shiki 主题） | `PRETTY_THEME` | `github-dark` |
| `icons`（`nerd` / `none`） | `PRETTY_ICONS` | `nerd` |
| `disableTools` / `enableTools` | `PRETTY_DISABLE_TOOLS` / `PRETTY_ENABLE_TOOLS` | `[]` |
| `maxHlChars` / `maxPreviewLines` | `PRETTY_MAX_HL_CHARS` / `PRETTY_MAX_PREVIEW_LINES` | `80000` / `80` |
| `workingIndicator.*` | `PRETTY_WORKING_INDICATOR` 等 | 见上游 README |
| `thinkingIndicator.enabled` | `PRETTY_THINKING_INDICATOR` | `true` |

想关掉某个工具、恢复 pi 原生渲染，写 `disableTools: ["bash","grep"]` 或 `PRETTY_DISABLE_TOOLS=bash,grep`。注意环境变量非空时是整体覆盖配置文件里的列表，不是合并。

### 本仓库自带的扩展

#### `extensions/bash-unified.ts` —— 合并 patty 与 pretty 的 bash

**要解决的问题**：patty 和 pretty 都要注册名为 `bash` 的工具，而 pi 不允许两个扩展占用同一个工具名，后加载的那个会整个加载失败。这不只是丢掉 bash 美化：pretty 整个扩展没加载，`read` / `find` / `grep` 的美化会一起没了。

**做了什么更改**：两边各只改一半。patty 的 bash 只改执行（渲染沿用 pi 原生），pretty 的 bash 只改渲染（执行交给外部传入的定义）。本扩展把两个包都自己加载，中间做一次拼接：先用 `Proxy` 把 patty 对 `bash` 的注册截下来，再通过 pretty 的 `deps.sdk` 注入点把这个定义交给 pretty。最终注册出的那个 `bash`，是 patty 的执行和参数，配 pretty 的渲染。两边其余的工具、命令、快捷键都原样放行。

两个实现细节：pretty 会用自己的 `promptSnippet` 覆盖 patty 的，模型会看不到后台任务提示，所以这里把那句补回去；patty 哪天改了入口、不再注册 `bash`，扩展会直接抛错，不静默退回 pi 原生 bash。

#### `extensions/status-bar.ts` —— 统一状态栏

**要解决的问题**：pi 把所有扩展 `setStatus()` 的内容塞在 footer 下面共用的一行里，各写各的，装得越多越乱。自定义 footer 是唯一能统一排版的入口，代价是必须自己把那些状态画出来，否则它们会直接消失。

**做了什么更改**：接管 `ctx.ui.setFooter()`，把路径、git、context、token 和各扩展状态排成固定三行：

```text
~/tools/pi-trellis  main ●2 +1 ↑2  • session name
▰▰▰▰▰▰▱▱▱▱▱▱▱▱ 39% 157k/400k (auto)        mp-messages·claude-opus-5·medium
↑112 ↓30k R5.3M W260k H83% $0.42  │  ⛁ 96% 1.2M/1.3M  │  ⚙ 2 jobs
```

- 第一行是「我在哪」：路径、git 分支与状态（`●` 改动、`+` 暂存、`?` 未跟踪、`✖` 冲突、`↑↓` 与上游的差异）、会话名。git 信息一次 `git status --porcelain=v2 --branch` 拿全，render 时按 3 秒节流异步刷新，并订阅 pi 的分支变化事件立即更新。
- 第二行是「还剩多少」：context 进度条加百分比和绝对值，按 70% / 85% 变黄变红。压缩后 token 数未知时只画空条和 `?`，不编造数字。右侧是 provider · 模型 · thinking，thinking 用 pi 自己的色标。
- 第三行是「花了多少」：累计 token（`↑` 输入、`↓` 输出、`R` cache 读、`W` cache 写）、`H` 最近一次请求的命中率、费用，后面接各扩展的状态 chip，组间用 `│` 分隔。第一次响应之前什么都不显示成错误，画一排暗色占位符等着填值。

扩展状态的收纳规则：`pi-cache-optimizer` 的长状态压成一个 `⛁ 96% 1.2M/1.3M` 的 chip，百分比旁边带的是它计算所依据的 token 对（`⛁ off` 表示禁用，`⚠` 表示 compat 不全）；不认识的状态键原样透出来，以后新装的扩展不会被吞掉。`@tintinweb/pi-subagents` 用的是 `setWidget`，画在编辑器上方，互不影响。唯一真正的冲突是另一个扩展也调 `setFooter()`，后调用的覆盖先调用的，目前清单里没有。

配色规则是「符号退后、数字读色」：箭头和字母标签统一 `dim`，颜色落在数值上。所有颜色调用都走一个 `paint()` 包装，`theme.fg()` 遇到主题未定义的 token 会抛异常，而 render 里抛异常会弄挂 TUI，所以降级成无色文本。

`/statusbar` 在自定义 footer 和 pi 内置 footer 之间切换。

#### `extensions/sse-normalize.ts` —— SSE 响应规整

**要解决的问题**：pi 1.1.0 的 Anthropic SSE 解析器在 CRLF 跨 chunk 时会报不可重试的 `Could not parse Anthropic SSE event`，一次长回答就此作废。

**做了什么更改**：包住 `fetch`，把 `text/event-stream` 响应体统一成 LF 换行（末尾的 `\r` 会留到下一个字节再判定），并丢掉没有 `data:` 行的空帧。用 `Symbol.for` 记住原始 `fetch`，重复加载不会套娃。这样处理之后，被截断的流会表现为 pi 可以自动重试的 `stream ended before message_stop`，而不是一条作废的回答。

## 配置扩展

每个扩展自己的配置细节已经写在上面各小节里了，这里只汇总文件位置，再讲两条通用规则。

### 配置文件在哪

| 文件 | 归属 |
| --- | --- |
| `~/.pi/agent/settings.json` | pi 本体。主题、默认 provider 和模型、已装包清单。`packages` 由 pi 维护，别手改 |
| `~/.pi/agent/keybindings.json` | pi 本体的键位，格式见下 |
| `~/.pi/agent/models.json` | provider 和模型定义，以及 compat 键。`pi-cache-optimizer` 的 `⚠️ compat` 指这里 |
| `~/.pi/agent/pi-cache-optimizer-config.json` | `pi-cache-optimizer` |
| `~/.pi/agent/pi-input-history.json` | `pi-input-history`，只存快捷键 |
| `~/.pi/agent/web-search.json` | `pi-web-access`，provider、key、命令开关、快捷键都在这 |
| `~/.pi/agent/pi-pretty.json` | `@heyhuynhgiabuu/pi-pretty` |
| `~/.pi/agent/subagents.json`、`<项目>/.pi/subagents.json` | `@tintinweb/pi-subagents`，项目覆盖全局 |
| `~/.config/rpiv-ask-user-question/config.json` | `@juicesharp/rpiv-ask-user-question`，走 `XDG_CONFIG_HOME`，不在 agent 目录下 |
| `~/.pi/agent/memory/` | `pi-memory` 的数据目录（不是配置），可用 `PI_MEMORY_DIR` 改写；配置只有 `PI_MEMORY_*` 环境变量 |
| 无 | `pi-session-name` 和 `pi-patty-bg-tasks` 全部硬编码，没有任何配置入口 |

`~/.pi/agent` 这个 agent 目录可以用 `PI_CODING_AGENT_DIR` 改写，上面带这个前缀的路径都会跟着走。改完文件之后在 pi 里 `/reload`；少数影响工具 schema 的键（见 pi-subagents 那节）要重启 pi。

### pi 本体的键位

`~/.pi/agent/keybindings.json` 把动作 id 映射到一个键或一组键。配置值会替换掉该动作的默认绑定，写空数组就是禁用：

```json
{
  "tui.editor.cursorLeft": ["left"],
  "app.session.rename": "ctrl+shift+r",
  "tui.editor.jumpForward": []
}
```

在 pi 里跑 `/hotkeys` 能看到当前生效的键位，完整的动作列表在 pi 文档的 `docs/keybindings.md`。

### 键位冲突

扩展用 `pi.registerShortcut("ctrl+shift+b", …)` 注册快捷键，收的是原始键组合，不是动作 id。所以 `keybindings.json` 改不了扩展的键，要换只能看那个扩展自己有没有开放配置项。

pi 的仲裁规则（见 `core/extensions/runner.js` 里的 `RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS`）分三种情况：

- 撞上保留动作（`app.interrupt`、`app.clear`、`app.exit`、`app.suspend`、`app.thinking.cycle`、`app.model.*`、`app.tools.expand`、`app.thinking.toggle`、`app.editor.external`、`app.message.copy`、`app.message.followUp`、`tui.input.submit`、`tui.select.confirm`、`tui.select.cancel`、`tui.input.copy`、`tui.editor.deleteToLineEnd`）：扩展的键被直接丢弃，只留一条 warning。想救回来，就在 `keybindings.json` 里把那个保留动作从这个键上挪走。
- 撞上非保留的内置动作：扩展赢，内置动作在编辑器里按不出来，启动时报一条非致命 warning。
- 两个扩展抢同一个键：后加载的赢，同样只有 warning。

当前这套组合里，已知的冲突有两处。仲裁规则在上面，表格里「结果」一列就是按它推出来的：

| 扩展键 | 撞上 | 结果 | 怎么处理 |
| --- | --- | --- | --- |
| `ctrl+r`（input-history 反向搜索） | `app.session.rename`（`ctrl+r`） | 扩展赢，rename 按不出来 | 二选一：把扩展的 `searchShortcut` 改成别的（如 `alt+r`），或改 `keybindings.json` 的 `app.session.rename` |
| `ctrl+]`（ask-user-question 折叠浮层） | `tui.editor.jumpForward`（`ctrl+]`） | 扩展赢 | 改它的 `collapseKey`（或设 `"off"`），或把 `tui.editor.jumpForward` 挪走 |

`pi-web-access` 的 `ctrl+shift+s` / `ctrl+shift+w`，以及 patty 的 `ctrl+shift+b` / `ctrl+shift+j` / `shift+down` / `ctrl+shift+x`，目前都没撞上内置动作。patty 刻意没注册 `ctrl+b`：那是内置 `tui.editor.cursorLeft` 的别名，抢过来会在启动时报冲突诊断。patty 这四个键都能在 `bg-tasks.json` 里改或设 `"off"`。

这些配置文件不在本仓库的管理范围内，各自的机器上自己维护。

## 工作方式

清单的格式是「包来源 → 版本」：

```json
{
  "packages": {
    "git:github.com/AkiChase/my-pi-preset": "latest",
    "npm:pi-session-name": "latest",
    "npm:some-tool": "^2.1.0"
  },
  "conflicts": ["npm:pi-patty-bg-tasks", "npm:@heyhuynhgiabuu/pi-pretty"]
}
```

- `"latest"`（也可以写 `"*"` 或 `""`）跟随最新版本。
- 像 `"0.1.7"` 这样的精确版本会被钉住，更新时不动它。
- 像 `"^2.1.0"` 这样的范围会在该范围内安装和升级。
- git 来源的版本写 tag 或 commit，例如 `"v1.2.0"`。
- `conflicts` 是绝对不能作为 pi 包安装的来源，同步时无论有没有 `--prune` 都会卸掉。同一个来源同时写进 `packages` 和 `conflicts` 会直接报错。

`install.sh` 只做引导：检查 `pi` / `node` / `curl`，拿到清单和同步脚本，然后交给 [`scripts/sync.mjs`](scripts/sync.mjs)。真正的对比和安装都在同步脚本里，它通过 pi 自己的命令（`pi install` / `pi update` / `pi remove`）落地，这样写 `settings.json` 的始终只有 pi。

| 情况 | 动作 |
| --- | --- |
| 清单里有，本机没装 | 安装 |
| 声明的版本和已装的不一致 | 安装声明的版本 |
| 清单里有，但磁盘上已经不见 | 重新安装 |
| 未固定版本，且已安装 | 更新到最新版 |
| 固定了精确版本 | 不动 |
| 本机有，清单里没有 | 保留，除非加了 `--prune` |
| 本机有，且在 `conflicts` 里 | 卸载（合并模式下也会卸） |

两个脚本都按步骤把日志打到 stderr，网络慢或被拦截时能看出卡在哪，不会像假死一样没有输出；`--dry-run` 的结果仍可直接管道给别的命令。每次调用 pi 最多等 10 分钟，超时只针对那个包报错。

## 添加扩展

放进 `extensions/` 即可，可以是单个文件（`extensions/foo.ts`），也可以是带入口的目录（`extensions/foo/index.ts`）。pi 会自动发现，不需要构建步骤。改完跑一遍 `pnpm check`，顺手更新 README 里对应的小节（这件事写进了 [`AGENTS.md`](AGENTS.md)），提交推送后，在其它机器上跑 `pi update --extensions`。

扩展要用第三方 npm 包时，把它写进本仓库 `package.json` 的 `dependencies`：pi 安装 git 来源的包时会在检出目录里装一遍运行时依赖。要是这个包本身也是个 pi 扩展（像上面的 patty 和 pretty），记得同时把它加进 `pi-packages.json` 的 `conflicts`，否则两边会各注册一遍。

## 添加第三方包

1. 把来源和想要的版本写进 `pi-packages.json`。
2. 提交并推送。
3. 在每台机器上跑 `./install.sh`；或者在需要的地方先 `pi install`，下次同步时会保留下来。

## 开发

开发用 pnpm（版本钉在 `package.json` 的 `packageManager` 里）：

```sh
pnpm install            # 装开发依赖
pnpm check              # 类型检查 + 全部测试，提交前跑这个
pnpm typecheck          # 只跑 tsc --noEmit
pnpm test               # 只跑 node --test
./install.sh --dry-run  # 看看这台机器缺什么
```

测试用 `node --test`，没有第三方框架。全部测试都不联网、不碰 `~/.pi`：`scripts/sync.test.mjs` 会在 `PATH` 里放一个假的 `pi`。

扩展 import 的 `@earendil-works/*`（pi 自己的 SDK）是 peer 依赖，运行时由 pi 提供，所以不装。类型检查和测试前会先跑 [`scripts/link-pi-sdk.mjs`](scripts/link-pi-sdk.mjs)，它在本机 pi 安装里找到这套 SDK 并软链进 `node_modules/`——类型因此永远对着真正加载这些代码的那个 pi 版本。`pnpm install` 之后链接可能被清掉，跑 `pnpm link-sdk` 重建即可；pi 装在别处时用 `PI_SDK_DIR` 或 `PI_BIN` 指过去。

另外注意：别人机器上的运行时依赖由 pi 安装，用的是 pi 自己配置的包管理器（默认 npm），它不读 `pnpm-lock.yaml`。所以 `dependencies` 保持宽松范围；`devDependencies` 不会被装到那些机器上。

仓库约定、以及「改了什么就得同步改哪一节文档」的对照表在 [`AGENTS.md`](AGENTS.md)。
