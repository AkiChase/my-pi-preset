# my-pi-preset

个人 [pi](https://pi.dev) 配置预设。

内容很简单：一份清单，一个同步脚本，几个自己写的扩展。在新机器上跑一条命令，pi 就装成我平时用的样子：第三方扩展备齐，自定义状态栏就位，几个扩展之间的冲突也已经处理掉，pi 本体的几个偏好和键位也一并对齐。

- 清单：[`pi-preset.json`](pi-preset.json)，记录要装哪些包、装什么版本、哪些包不能装，以及哪些 pi 设置和键位由本仓库说了算
- 同步：[`install.sh`](install.sh) 和 [`scripts/sync.mjs`](scripts/sync.mjs)，负责把本机状态对齐到清单
- 扩展：[`extensions/`](extensions)，本仓库自带的四个扩展，pi 安装本仓库时会自动发现

本仓库自己也是清单里的一条（`git:github.com/AkiChase/my-pi-preset`），默认和其他包一样从远程安装、被 pi 管理和更新。本地开发可用 `./install.sh --dev` 只把本仓库切换为当前检出，第三方包仍按清单使用远程来源。

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

### 测试本地修改

普通 `./install.sh` 即使用了本地清单，装的仍是远程版；未提交、未推送的扩展修改不会被加载。想直接测试当前检出：

```sh
pnpm install               # 先装本地运行时和开发依赖；pi 不会替本地包装依赖
./install.sh --dev --dry-run
./install.sh --dev
```

然后在 pi 里执行 `/reload`，用 `/bg-version` 确认路径指向当前检出的 `extensions/bg-tasks`，而不是 `~/.pi/agent/git/`。没有构建或复制步骤，改本地文件后再 `/reload` 即可。

`--dev` 的路径取自执行的 `scripts/sync.mjs` 所在的 git 检出，不取当前工作目录；带空格的路径也支持。它只在内存中替换本仓库的来源，**不改 `pi-preset.json`**。第三方包、配置、域选择和 prune 的语义都不变。切换时会先移除用户级远程注册（包括不同 URL 写法和 ref），再注册本地绝对路径；两份已同时存在时只移除相反来源。本地已经注册则保留，不调 `pi update`。

测试完，在同一个检出执行普通 `./install.sh`，会先移除这个检出的本地注册，再安装或更新清单里的远程版；随后 `/reload`。任一来源切换的移除失败都会中止，避免继续安装造成重复工具注册。切换只在 `packages` 域被选中时发生；`--sync settings` / `--sync none` 不会切换来源，`--dry-run` 不执行安装、更新、移除或配置写入。

`--dev` 必须从本仓库完整的独立 git 检出执行；不要在 pi 管理的 `~/.pi/agent/git/` 克隆中使用，否则移除远程来源会删掉当前检出，脚本会拒绝这种切换。下载的单文件或 `curl | sh` 也不支持，脚本会报错而不是把临时目录装进去。脚本仍只管用户级包，不修改项目 `.pi/`，也不会移除另一条本地检出路径；如手动安装过这些来源，需自行检查重复注册。

清单文件从 `pi-packages.json` 改名成了 `pi-preset.json`。本地还是老检出、或者手里存了老 `install.sh` 的机器上，它会去下一个已经不存在的文件并报 `could not download pi-packages.json`；`git pull` 或者重跑上面那条 curl 命令即可。

### 命令行选项

同步分四个域：`packages`（走 `pi install` / `pi update` / `pi remove`）、`settings`（写 `~/.pi/agent/settings.json`）、`keybindings`（写 `~/.pi/agent/keybindings.json`）、`files`（写 agent 目录下各扩展自己的配置文件，比如 `pi-input-history.json`）。每个域可以单独选，选中的域各自跑在两种模式之一。

| 选项 | 作用 |
| --- | --- |
| `--sync <域>` | 要对齐哪些域，逗号分隔，可写 `all` / `none`，默认 `all` |
| `--prune [<域>]` | 哪些域完全以清单为准，默认 `none`；裸写 `--prune` 或 `--prune all` 等于「`--sync` 选中的全部域」 |
| `--dev` | 只把本仓库替换为执行脚本所在 git 检出的绝对路径，第三方包仍用远程；只在同步 `packages` 时切换 |
| `--dry-run` | 只打印计划，不做任何改动 |

```sh
./install.sh                             # 四个域全同步，全 merge；本仓库用远程
./install.sh --dev                       # 本仓库用当前检出，第三方包仍用远程
./install.sh --sync settings             # 只对齐设置，不碰包
./install.sh --prune packages            # 包以清单为准，配置仍是 merge
./install.sh --prune                     # 四个域都以清单为准
./install.sh --sync packages,settings --dry-run
```

两种模式：

- **merge**（默认）：只对齐清单声明的那些条目，清单没提的一律不动（`conflicts` 和本仓库 dev/远程来源切换除外，避免重复注册）。某台机器上临时 `pi install` 的包会保留，手改的其它设置键也会保留。
- **prune**：那个域里清单就是全集 —— 没声明的包卸掉、没声明的设置键和键位删掉；`files` 域下则把声明过的文件当全集，没声明的键删掉（没声明过的文件仍然一个字也不碰）。例外是 `preserve` 白名单和 pi 自己维护的 `packages` / `lastChangelogVersion`，细节见 [声明设置和键位](#声明设置和键位)。

`--prune` 里写了 `--sync` 没选的域会直接报错，不会静默忽略。脚本只管用户级的包和 agent 目录下的配置，项目 `.pi/` 里的东西不受影响。

### 用哪个 pi

有些终端应用会在 `PATH` 前面放一个同名的 `pi` 启动器，撞上它的话 `pi install` 会去打开那个应用，而不是装包。所以脚本优先使用受管理的可执行文件 `$PI_CODING_AGENT_DIR/bin/pi`（默认是 `~/.pi/agent/bin/pi`），并且会把它实际用的是哪个打印出来。要指定别的路径：

```sh
PI_BIN=/path/to/pi ./install.sh
```

## 日常使用

```sh
pi update --extensions   # 更新本仓库的扩展，以及已装的包
./install.sh             # 清单改过之后，把这台机器对齐过去
./install.sh --sync settings  # 只把设置对齐过去
./install.sh --prune     # 顺手清掉清单外的包、设置键和键位
```
pi 里只有一个本仓库自带的命令：`/statusbar`，在自定义状态栏和 pi 内置 footer 之间切换。其余扩展各自的命令、快捷键和配置文件，都在下面两节里。

## 这里有什么

先放一张总表，细节看后面各小节。

| 包 | 作用 | 配置文件 | 快捷键 |
| --- | --- | --- | --- |
| [`pi-session-name`](#npmpi-session-name) | 自动生成会话标题，同步到终端标题栏 | 无 | 无 |
| [`pi-cache-optimizer`](#npmpi-cache-optimizer) | 提高缓存命中率，显示命中统计 | `~/.pi/agent/pi-cache-optimizer-config.json` | 无 |
| [`pi-input-history`](#npmpi-input-history) | 跨会话的输入历史，模糊反向搜索 | `~/.pi/agent/pi-input-history.json`，由清单声明 | `alt+r`，可改 |
| [`pi-web-access`](#npmpi-web-access) | 联网：搜索、抓取、PDF、GitHub、视频 | `~/.pi/agent/web-search.json` | `ctrl+shift+s` 等，可改 |
| [`pi-memory`](#npmpi-memory) | 跨会话记忆：长期记忆、日志、便签、检索 | 无（只有 `PI_MEMORY_*` 环境变量） | 无 |
| [`@tintinweb/pi-subagents`](#npmtintinwebpi-subagents) | 子 agent 和工作流编排 | `~/.pi/agent/subagents.json` | 无（只有浮层内按键） |
| [`@juicesharp/rpiv-ask-user-question`](#npmjuicesharprpiv-ask-user-question) | 让模型给出选项，而不是自己猜 | `~/.config/rpiv-ask-user-question/config.json` | `ctrl+]`，可改 |
| [`@tifan/pi-recap`](#npmtifanpi-recap) | 会话回到现场：一行 recap，离开后自动生成 | `~/.pi/agent/extensions/pi-recap.json` | 无 |
| [`pi-patty-bg-tasks`](#npmpi-patty-bg-tasks) | 后台任务：长命令不阻塞会话 | `~/.pi/agent/bg-tasks.json` | `ctrl+shift+b` 等，可改 |
| [`@heyhuynhgiabuu/pi-pretty`](#npmheyhuynhgiabuupi-pretty) | 终端输出美化 | `~/.pi/agent/pi-pretty.json` | 无 |

前八个是普通依赖，由 pi 从 npm 安装，来源写在 [`pi-preset.json`](pi-preset.json) 的 `packages` 里，本仓库不动它们的代码。

后两个（patty 和 pretty）比较特殊：patty 已拷贝为本仓库的代码，pretty 是本仓库的 npm 运行时依赖（见 [`package.json`](package.json)）；两者由 `extensions/bash-unified.ts` 亲自加载，所以也被写进了清单的 `conflicts`，**不能**再当成普通 pi 包安装。否则 `bash` 这个工具会被注册两次，pi 直接报冲突、启动失败。

除了包，清单还声明了两类本机配置：pi 本体的几个偏好 —— 失败重试次数 `retry.maxRetries: 5`，以及把被扩展抢走的内置键 `tui.editor.jumpForward`（`ctrl+]`）禁掉；以及 `pi-input-history` 的搜索键 `searchShortcut: "alt+r"`。格式和语义见 [声明设置和键位](#声明设置和键位)，键位那条的来由见 [键位冲突](#键位冲突)。

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

**提供**：全局快捷键 `alt+r` 打开反向搜索浮层。浮层内：`alt+r` / `↑` 更旧，`ctrl+s` / `↓` 更新，`ctrl+k` / `ctrl+j` 滚动预览，`Enter` 填入，`Esc` 或 `ctrl+g` 取消。没有工具和斜杠命令。

**配置**：配置文件 `~/.pi/agent/pi-input-history.json`，四个键位都可以改，改完 `/reload`：

```json
{
  "searchShortcut": "alt+r",
  "newerShortcut": "ctrl+s",
  "scrollUpShortcut": "ctrl+k",
  "scrollDownShortcut": "ctrl+j"
}
```

历史条数（固定 100）和去重行为不可配置。`alt+r` 这条声明在清单里（`files` 域），同步到每台机器；其余三个键保持上游默认值，没有写进清单。扩展自己的默认值是 `ctrl+r`，会撞 pi 的 `app.session.rename`，所以才改到 `alt+r`，见 [键位冲突](#键位冲突)。

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

#### `npm:@tifan/pi-recap`

> 来源：[npm](https://www.npmjs.com/package/@tifan/pi-recap) · [GitHub](https://github.com/tifandotme/pi-extensions/tree/master/packages/pi-recap)（需要 pi 0.84.2 以上）

回到一个会话时不用重读整条 transcript。它在编辑器上方显示一行 recap：先说你当初为什么开这个会话，再补当前状态、关键决定、相关文件或命令、以及下一步大概要做什么。recap 用的是 pi 的当前会话上下文（跟随当前分支、尊重压缩），不去扒完整的会话文件或终端历史；最新一条 recap 存在 LLM 上下文之外。

触发时机：`/recap` 当场生成一条新的；agent 结束后等 5 分钟，如果你一直闲着就自动生成一条；resume 时若已存的 recap 仍对得上最新会话状态就直接显示，过期或缺失则重新生成；你发出任何非 `/recap` 消息时 recap 清掉。

**提供**：命令 `/recap`（生成并显示）、`/recap status`（看所选模型、当前模型、新鲜度、是否可见）、`/recap config`（选 recap 模型）、`/recap help`。用 `setWidget` 画在编辑器上方，和 `@tintinweb/pi-subagents` 一样，互不影响；不注册全局快捷键。

**配置**：配置文件 `~/.pi/agent/extensions/pi-recap.json`（在 agent 目录的 `extensions/` 子目录下，不是根目录），只有一个键 `model`，形如 `{ "model": "provider/model-id" }`。扩展自己读写它：`/recap config` 选模型时写入，选「Use default」时删掉。上游默认模型是 `openai-codex/gpt-5.6-luna`，**本机没有这个 provider**，所以首次用必须跑一次 `/recap config` 选一个本机已认证的文本模型（如 `mp-messages/deepseek-v4.1-flash`），否则 recap 会报没有可用模型。因为这个文件在 `extensions/` 子目录里、而清单的 `files` 域只认 agent 根目录下的文件名，所以它**不由清单声明**，每台机器各自 `/recap config` 一次。

### 由本仓库代为加载的包

#### `npm:pi-patty-bg-tasks`

> 来源：[npm](https://www.npmjs.com/package/pi-patty-bg-tasks) · [GitHub](https://github.com/patty-io/pi-patty-bg-tasks)

把 Claude Code 的后台任务体验搬到 pi：长命令不再卡住会话。本仓库使用的是一次性拷贝后独立修改的 fork（来源见 [`PROVENANCE.md`](extensions/bg-tasks/PROVENANCE.md)），不是 npm 包依赖。它覆盖内置 `bash`，跑超过 120 秒的命令自动转入后台。注册表只属于当前会话，不持久化、不恢复进程；退出 pi 或切换会话时停止运行中的任务，后台日志保留在磁盘。

**提供**：

- 工具：`bash`（覆盖内置，新增 `run_in_background`、`timeout`、`description` 参数）、`bash_bg`（直接后台启动）、`jobs`（list / output / kill / attach / search / stats；output 支持按字节 offset 翻页读大日志，search 支持限定单任务、忽略大小写、上下文行）、`monitor`（按事件流监听命令输出或 WebSocket）。日志默认落在 `/tmp/pi-bg/<jobId>.log`。
- 斜杠命令：`/bg` 转后台、`/bg-list` 任务面板、`/bg-version` 打印版本和路径、`/bg-config` 显示生效的配置、来源文件和加载警告。
- 快捷键（默认值，可改）：`ctrl+shift+b` 转后台，`shift+down` 打开任务面板。没有全局「kill 最近任务」快捷键。

**交互**：平时只在底栏显示正在运行的普通后台任务和 monitor 数量，例如 `▶ 2 tasks · ◉ 1 monitors · shift+down`；前台 bash 不计入，不再显示编辑器上方的后台状态条。前台命令超过 2 秒时的「转后台」提示仍保留。

`shift+down` / `/bg-list` 打开一个双栏悬浮窗：左边是任务列表，右边立即显示所选任务的命令、状态、耗时、日志路径和实时输出，不需要 Enter，也不会再打开下一层菜单或编辑器。

| 窗口内按键 | 行为 |
| --- | --- |
| `↑↓` / `j` / `k` | 列表焦点下选择任务，详情立即跟随；输出焦点下滚动日志 |
| `Tab` | 切换列表与输出焦点（窗口提示为 `switch`） |
| `PageUp` / `PageDown` | 列表跨页选择；输出翻页滚动 |
| `Home` / `End` | 输出焦点下到当前日志预览的开头 / 末尾 |
| `x` | 停止当前选中的运行中任务，终态任务不显示此操作 |
| `c` | 将日志文件的绝对路径复制到系统剪贴板，不复制内容、不提交给 Agent |
| `Esc` | 关闭整个窗口 |

不提供重跑、删除条目或清理日志的按键。输出默认跟随尾部，往上滚后不会因新输出跳回底部；实时预览最多读取 `outputPreviewChars` 字节，窗口注明字节范围与省略的早期字节。需要完整日志时复制路径读取文件，或让 Agent 调 `jobs` 的 `output` action 按字节分页。

**生命周期**：所有终态任务（completed / failed / killed）完成 4 秒后从面板列表隐藏。当前选中的任务例外，在这次打开的窗口内保留最终详情和输出，切换到其他任务或关闭窗口才释放。终态注册表记录完成 10 分钟后由每 60 秒运行一次的定时器回收，通知送达不会提前移除；`jobs list` 在这段保留期内仍能列出它们。回收后按 ID 调 `jobs output` 会报未知任务，但对话里的绝对日志路径仍可读取。扩展不主动删除后台日志，也没有 `jobs cleanup`；默认 `/tmp/pi-bg` 可能被操作系统清理，长期保留请配置 `logDir`。

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
| `monitorPollMs` | `200` | `monitor` 读日志的轮询间隔 |
| `monitorFlushMs` | `2000` | 事件合并窗口。安静后的首批立刻发，之后窗口内攒成一条 |
| `monitorMaxLinesPerEvent` | `50` | 单条事件最多几行，多出来的计入「未显示」 |
| `monitorRateWindowMs` | `10000` | 刷屏检测的滑动窗口 |
| `monitorMaxLinesPerWindow` | `500` | 一个窗口内超过这么多行就停止发内容、只报抑制条数（monitor 继续跑） |
| `monitorMaxOverflowWindows` | `3` | 连续这么多个窗口都溢出才真的杀掉 monitor |
| `shortcutBackground` | `["ctrl+shift+b"]` | 转后台 |
| `shortcutTaskPanel` | `["shift+down"]` | 打开任务面板 |

快捷键两项都接单个键名、键名数组，或 `"off"` 关掉。这是唯一能改这些键的途径 —— `pi.registerShortcut` 收的是原始键组合、不走 keybinding id，所以 `keybindings.json` 管不到它们。默认不注册 `ctrl+b`，那是 pi 内置的 `tui.editor.cursorLeft`，见 [键位冲突](#键位冲突)。

配置文件写错不会让扩展加载失败：非法值一律回退默认值，未知键会被忽略，每条都记一句警告 —— 用 `/bg-config` 看。旧 `shortcutKillLatest` 配置已移除，文件里保留它会显示未知键警告。渲染与生命周期细节（2 秒快速完成窗口、4 秒展示、10 分钟保留、60 秒回收间隔等）仍写死在 `extensions/bg-tasks/types.ts`，没有开放。

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

**和 vendor 目录的关系**：patty 的代码 vendor 在 `extensions/bg-tasks/`，由本扩展当库 import。pi 的自动发现会把 `extensions/` 下**带 `index.ts` 的子目录也当成一个独立扩展**，于是 `bg-tasks` 会被再加载一遍，`bash` / `bash_bg` / `jobs` / `monitor` 和两个快捷键全部注册两次，启动时一片冲突警告。挡住这件事的是 [`package.json`](package.json) 里的 `pi.extensions` 声明（只列 `extensions/*.ts`），见 [添加扩展](#添加扩展)。

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

#### `extensions/blocked-signal.ts` —— 告诉终端复用器「在等你」

**要解决的问题**：扩展弹对话框时 pi 的这一轮还没结束，`agent_settled` 不会触发，于是所有盯着它的集成都以为 pi 还在干活。最难受的是 `ask_user_question`：问卷能在那儿挂几分钟，herdr 面板一直是 Working，cmux 也不弹通知，人在别的窗口根本不知道该回来了。

pi 自己其实把信号发出来了 —— `ui_prompt_start` / `ui_prompt_end` 包住每一次阻塞式 `ctx.ui.*`（select / confirm / input / editor / custom），而且只对最外层那一次发，一进一出严格配对。问题在两边的集成都没订阅它：

- herdr（0.9.1，装在 `~/.pi/agent/extensions/herdr-agent-state.ts` 的集成是第 9 版）只在**别的**扩展往 pi 事件总线上发 `herdr:blocked` 时才报 blocked，而没有任何扩展会发。它给另一个 agent 写的同类集成（`HERDR_INTEGRATION_ID=omp`，第 10 版）是直接订阅那个 agent 的 approval / ask 事件的，所以这更像是 pi 这份集成没跟上。
- cmux（0.65.0）在它生成的 `~/.pi/agent/extensions/cmux-session.ts` 里给 `ui.confirm`、`ui.select`、`ui.input` 打了猴补丁来发 `questionAsked` 钩子，偏偏漏了 `ui.custom` 和 `ui.editor` —— 问卷正是用 `ui.custom` 画的。

**做了什么更改**：订阅那对事件，转发给两个 sink，各自只在自己宿主的环境变量齐备时才启用（都不在就直接返回，不留任何监听）：

- **herdr**：发 `herdr:blocked`，`{ active: true, label }` 进、`{ active: false }` 出。herdr 那边自己计数，所以每个 `true` 必须配一个 `false`，中途 `/reload`、`session_shutdown` 都做了兜底。面板因此变成 Blocked，`herdr agent wait --until blocked` 也能停住了。
- **cmux**：只在**没有** herdr 的时候才挂上 —— herdr 自己会把 `pi needs attention: <cwd>` 这种 toast 转发给它所在的终端（实测：面板变 blocked 时 cmux 真的弹了通知，而光打一个 BEL 什么都不弹），叠上去就是一次提问响两声。pi 直接跑在 cmux 面板里时才用这个 sink：走文档里的 `cmux notify`（横幅+侧栏徽标+面板高亮），答完按 id `cmux dismiss-notification` 撤掉，不用 `notify --clear`，免得连带清掉别人的通知。只对 cmux 自己没补的 `custom` 和 `editor` 发；`CMUX_PI_HOOKS_DISABLED=1` 这个它自己的开关也认。面板状态仍然属于 cmux 自己那份集成（装法 `cmux hooks pi install`，注意 `PATH` 里要让 cmux 的 `pi` shim 排在前面才会自动注入）。

标签尽量给得有意义：有 `title` 就用 `title`；问卷没有 `title`，所以额外听一条 `rpiv:ask-user:prompt`（只认频道名，不 import 那个包），拿第一题的 header 当标签，比如 `Auth method`；都没有就退回按种类写死的一句话。

**没做的事**：pi 自己的 OSC 7501 program status 没有补。pi 对 select / confirm / input / editor 会报 `blocked`，对 `ctx.ui.custom()` 不报（1.1.0 的 `showExtensionCustom` 没调 `programStatus.setBlocked`），这是上游的坑；而 herdr 0.9.1 和 cmux 0.65.0 都不读这个协议，绕它没有收益。

## 配置扩展

每个扩展自己的配置细节已经写在上面各小节里了，这里只汇总文件位置，再讲两条通用规则。

### 配置文件在哪

| 文件 | 归属 |
| --- | --- |
| `~/.pi/agent/settings.json` | pi 本体。主题、默认 provider 和模型、已装包清单。`packages` 由 pi 维护，别手改；被清单声明的键由本仓库维护，见 [声明设置和键位](#声明设置和键位) |
| `~/.pi/agent/keybindings.json` | pi 本体的键位，格式见下；被清单声明的动作 id 由本仓库维护 |
| `~/.pi/agent/<名字>.json` | 各扩展自己的配置文件，见上表；其中被清单 `files` 域声明的由本仓库维护，见 [声明扩展的配置文件](#声明扩展的配置文件) |
| `~/.pi/agent/models.json` | provider 和模型定义，以及 compat 键。`pi-cache-optimizer` 的 `⚠️ compat` 指这里 |
| `~/.pi/agent/pi-cache-optimizer-config.json` | `pi-cache-optimizer` |
| `~/.pi/agent/pi-input-history.json` | `pi-input-history`，只存快捷键；其中 `searchShortcut` 由清单声明 |
| `~/.pi/agent/web-search.json` | `pi-web-access`，provider、key、命令开关、快捷键都在这 |
| `~/.pi/agent/pi-pretty.json` | `@heyhuynhgiabuu/pi-pretty` |
| `~/.pi/agent/subagents.json`、`<项目>/.pi/subagents.json` | `@tintinweb/pi-subagents`，项目覆盖全局 |
| `~/.config/rpiv-ask-user-question/config.json` | `@juicesharp/rpiv-ask-user-question`，走 `XDG_CONFIG_HOME`，不在 agent 目录下 |
| `~/.pi/agent/extensions/pi-recap.json` | `@tifan/pi-recap`，只有 `model` 一键；在 `extensions/` 子目录下，不由清单声明 |
| `~/.pi/agent/memory/` | `pi-memory` 的数据目录（不是配置），可用 `PI_MEMORY_DIR` 改写；配置只有 `PI_MEMORY_*` 环境变量 |
| `~/.pi/agent/bg-tasks.json` | `pi-patty-bg-tasks`（本仓库代为加载），超时、并发、日志目录、快捷键。所有键也能用 `BG_TASKS_*` 环境变量覆盖 |
| 无 | `pi-session-name` 全部硬编码，没有任何配置入口 |

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

当前这套组合里，已知的冲突有一处。仲裁规则在上面，表格里「结果」一列就是按它推出来的：

| 扩展键 | 撞上 | 结果 | 怎么处理 |
| --- | --- | --- | --- |
| `ctrl+]`（ask-user-question 折叠浮层） | `tui.editor.jumpForward`（`ctrl+]`） | 扩展赢 | 已处理：清单把 `tui.editor.jumpForward` 设成 `[]` 禁掉 |

「已处理」指的是 [`pi-preset.json`](pi-preset.json) 的 `keybindings` 里那条空数组。扩展的键本来就会赢，把被抢走的内置动作显式禁掉，图的是启动时不再报那条冲突 warning、以后也不会以为这个内置键还能用。不想这样就把清单里那条改成别的键，或者改成 `null` 让它从所有机器上消失。

曾经还有第二处：input-history 的反向搜索默认是 `ctrl+r`，正好是 `app.session.rename`（重命名会话）。当时的做法也是把重命名禁掉。现在清单直接把 `searchShortcut` 改成了 `alt+r`（`files` 域，见 [配置文件在哪](#配置文件在哪)），`ctrl+r` 没人抢了，重命名也就回到了 pi 的默认行为。

`pi-web-access` 的 `ctrl+shift+s` / `ctrl+shift+w`，以及 patty 的 `ctrl+shift+b` / `shift+down`，对着 pi 的动作表逐个核过，都没撞上内置动作 —— `shift+down` 尤其容易让人起疑，但内置用的是 `down`（`cursorDown` / `select.down`）、`ctrl+shift+down`（`altScreen.nextPrompt`）和 `alt+down`（`models.reorderDown`），没人要 `shift+down`。patty 刻意没注册 `ctrl+b`：那是内置 `tui.editor.cursorLeft` 的别名，抢过来会在启动时报冲突诊断。patty 这两个键都能在 `bg-tasks.json` 里改或设 `"off"`。后台任务面板不监听裸 `↓` / `←`，不会和 subagents 的列表入口争抢按键；只在悬浮窗打开时处理导航。

可管理范围就是清单里声明了的那几项：`settings.json` 的 `retry.maxRetries`、`keybindings.json` 的 `tui.editor.jumpForward`、`pi-input-history.json` 的 `searchShortcut`。其余配置文件、其余键都不在本仓库的管理范围内，各自的机器上自己维护。

## 工作方式

清单 [`pi-preset.json`](pi-preset.json) 分六段：

```json
{
  "packages": {
    "git:github.com/AkiChase/my-pi-preset": "latest",
    "npm:pi-session-name": "latest",
    "npm:some-tool": "^2.1.0"
  },
  "conflicts": ["npm:pi-patty-bg-tasks", "npm:@heyhuynhgiabuu/pi-pretty"],
  "settings": { "retry": { "maxRetries": 5 } },
  "keybindings": { "tui.editor.jumpForward": [] },
  "files": { "pi-input-history.json": { "searchShortcut": "alt+r" } },
  "preserve": { "settings": ["theme", "defaultModel"], "keybindings": [] }
}
```

### 包

`packages` 的格式是「包来源 → 版本」：

- `"latest"`（也可以写 `"*"` 或 `""`）跟随最新版本。
- 像 `"0.1.7"` 这样的精确版本会被钉住，更新时不动它。
- 像 `"^2.1.0"` 这样的范围会在该范围内安装和升级。
- git 来源的版本写 tag 或 commit，例如 `"v1.2.0"`。
- `conflicts` 是绝对不能作为 pi 包安装的来源，同步时无论有没有 `--prune` 都会卸掉。同一个来源同时写进 `packages` 和 `conflicts` 会直接报错。

### 声明设置和键位

`settings` 跟 `settings.json` 长得一样，但**声明的单位是叶子**：对象递归合并到叶子，数组和标量整体替换。所以下面这段只管 `retry.maxRetries`，本机自己调过的 `retry.baseDelayMs` 不会被动：

```json
"settings": { "retry": { "maxRetries": 5 } }
```

几条规则：

- **删除也是声明的一部分**。要把一个键从所有机器上摘掉，不是把它从清单里删掉，而是把值写成 `null`（`"markdown": { "mermaid": null }`）。这条墓碑留在清单里，所有机器同步过一轮后再清掉 —— 也正因为有它，本仓库不需要任何记录「上次改过什么」的状态文件。
- **设置用嵌套，不用点号路径**。顶层键里带点会报错：`"markdown.mermaid"` 会变成一个 pi 根本不认的键。更深的键允许带点，因为真有（`modelThinkingLevels` 是用 `provider/model-4.1` 这种做键的）。
- **`keybindings` 是平的**，一个动作 id 就是一个条目，整体替换。`"ctrl+r"` 和 `["ctrl+r"]` 算同一个值，不会因为写法不同而重写文件；`[]` 是「禁用这个动作」这个合法值，`null` 才是墓碑。
- **`preserve` 只在 prune 模式下有意义**：列进去的路径和它底下的一切即使没声明也不会被删。这是「真·偏好、但每台机器不一样」的键的逃生口，现在里面是 `theme`、`defaultProvider`、`defaultModel`、`defaultThinkingLevel`。`preserve.settings` 的条目是**路径**，所以 `"retry.baseDelayMs"` 的点按层级解析；要保护本身带点的键，写成段数组 `["modelThinkingLevels", "openai/gpt-4.1"]`。`preserve.keybindings` 的条目则是动作 id 原文，不切点号。
- **`packages` 和 `lastChangelogVersion` 硬保护**：这两个键是 pi 自己在写，无论哪种模式都不碰，写进清单还会报错。
- 声明和 `preserve` 撞上同一个路径会报错，因为那是两个矛盾的意图。

### 声明扩展的配置文件

`files` 域管的是 agent 目录下那些扩展自己的 JSON（`pi-input-history.json`、`bg-tasks.json`、`web-search.json` …）。键就是文件名，值就是那个文件的内容，语义与 `settings` 完全一致：叶子级合并、`null` 是墓碑、顶层键不能带点。

```json
"files": {
  "pi-input-history.json": { "searchShortcut": "alt+r" }
}
```

几条规则：

- **只能是 agent 目录下的文件名**，不带路径。`~/.config/rpiv-ask-user-question/config.json` 这种不在 agent 目录里的配置暂不支持 —— 多一个根目录就得多一套 XDG 解析。带 `/`、`..` 或不是 `.json` 的名字会报错。
- **几个文件硬保护**：`settings.json` / `keybindings.json` 有自己的域；`auth.json` 放凭证；`trust.json` / `models-store.json` 是 pi 本机的状态；`models.json` 会被 `pi-cache-optimizer` 在它自己的事务锁下重写，从这边打叶子补丁会撞上。写进 `files` 会直接报错。
- **`--prune` 只作用在 `files` 声明过的文件上**。清单没提的文件永远不被读、不被写、不被删；而被声明过的文件在 prune 下就是「全文以清单为准」，所以只把清单当「改其中几个键」用。（声明了但本机不存在的文件，同步时会直接建出来，不存在「不碰」这个选项。）
- **`preserve.files` 按文件名分组**：`"preserve": { "files": { "pi-input-history.json": ["scrollUpShortcut"] } }`。保护一个没人声明的文件里的键等于什么都没保护，所以那种写法会报错。
- 自动写入只关心键与值：两空格缩进，保留现有键的顺序（新键追加到末尾），跟 pi 自己写文件的习惯一致。

### 怎么落到本机

`install.sh` 只做引导：检查 `pi` / `node` / `curl`，拿到清单和同步脚本，然后交给 [`scripts/sync.mjs`](scripts/sync.mjs)。包部分通过 pi 自己的命令（`pi install` / `pi update` / `pi remove`）落地，配置部分由同步脚本直接写 agent 目录下的 JSON。

| 情况 | 动作 |
| --- | --- |
| 清单里有，本机没装 | 安装 |
| 声明的版本和已装的不一致 | 安装声明的版本 |
| 清单里有，但磁盘上已经不见 | 重新安装 |
| 未固定版本，且已安装 | 更新到最新版 |
| 固定了精确版本 | 不动 |
| 本机有包，清单里没有 | 保留，除非该域在 `--prune` 里 |
| 本机有包，且在 `conflicts` 里 | 卸载（merge 模式下也会卸） |
| `--dev`，本仓库远程来源已注册 | 先卸载该仓库的远程注册，再注册当前检出的绝对路径（merge 也切换） |
| `--dev`，当前检出已注册 | 保留本地来源，不更新；第三方包照常对齐 |
| 同一检出执行普通安装，本仓库本地来源已注册 | 先移除这个本地注册，再安装或更新清单的远程版 |
| 来源切换的移除失败 | 中止，不再执行安装或配置写入 |
| `packages` 未选中或 `--dry-run` | 不切换来源；dry-run 仅显示计划 |
| 声明了设置键，本机值不同或缺失 | 写成声明的值 |
| 声明了设置键，本机值已一致 | 不动，也不重写文件 |
| 声明成 `null` | 从本机删掉（本来就没有就什么都不做） |
| 本机有设置键或键位，清单没声明 | 保留，除非该域在 `--prune` 里且没被 `preserve` 盖住 |
| 扩展配置文件被 `files` 声明，本机没这个文件 | 建出来，只写声明的键 |
| 扩展配置文件未被 `files` 声明 | 永远不碰 |

写配置文件时的几个细节：

- 先跑包，再写配置，并且**写之前重新读一遍文件**。`pi install` 会把 `packages` 写进 `settings.json`，按路径打补丁而不是整文件覆盖，才不会把它刚写的东西抹掉。
- 保留现有键的顺序，新键追加到末尾；格式跟 pi 自己写的一致（两空格缩进、末尾不加换行）；内容没变就不动文件。先写临时文件再 `rename`，不会留下写到一半的 JSON。
- 写 `settings.json` 前会拿 pi 用的那把锁（`settings.json.lock` 目录，pi 1.1.0 用 proper-lockfile 做的就是这个），所以跟正在跑的 pi 互斥。超过 10 秒的锁当残留处理。
- 目标文件存在但 JSON 坏了就报错退出，绝不覆盖 —— 那更像是一个改到一半的手改，不是该扔掉的东西。
- 改完在 pi 里 `/reload`。pi 正在跑的时候同步也不会丢：它存盘时也是重读文件、只合并自己改过的字段（`persistScopedSettings`）。真正会输的情况是同一个字段两边都在改。

两个脚本都按步骤把日志打到 stderr，网络慢或被拦截时能看出卡在哪，不会像假死一样没有输出；`--dry-run` 的结果仍可直接管道给别的命令。每次调用 pi 最多等 10 分钟，超时只针对那个包报错。

## 添加扩展

放一个 `.ts` 文件进 `extensions/` 即可，不需要构建步骤。改完跑一遍 `pnpm check`，顺手更新 README 里对应的小节（这件事写进了 [`AGENTS.md`](AGENTS.md)），提交推送后，在其它机器上跑 `pi update --extensions`。

加载的范围由 [`package.json`](package.json) 的 `pi.extensions` 声明，而不是自动发现：

```json
"pi": { "extensions": ["extensions/*.ts"] }
```

这条 glob 不跨目录，所以顶层每个 `.ts` 都会自动加载，而 `extensions/` 下的子目录一律不会。必须这么写：pi 的自动发现会把任何 `extensions/<name>/index.ts` 也当成独立扩展，`extensions/bg-tasks/`（vendor 进来、由 `bash-unified.ts` 当库 import 的那份）会因此被加载两遍、工具和快捷键全部冲突。`scripts/pi-manifest.test.mjs` 盯着这件事。

两个后果：真想加一个目录式扩展（`extensions/foo/index.ts`），得把它单独列进 `pi.extensions`；有了这段声明，pi 对 `skills/` / `prompts/` / `themes/` 的自动发现也一并关掉，将来真要放这些资源，同样得在 `pi` 里声明（测试会提醒）。

扩展要用第三方 npm 包时，把它写进本仓库 `package.json` 的 `dependencies`：pi 安装 git 来源的包时会在检出目录里装一遍运行时依赖。要是这个包本身也是个 pi 扩展（像上面的 patty 和 pretty），记得同时把它加进 `pi-preset.json` 的 `conflicts`，否则两边会各注册一遍。

## 添加第三方包

1. 把来源和想要的版本写进 `pi-preset.json` 的 `packages`。
2. 提交并推送。
3. 在每台机器上跑 `./install.sh`；或者在需要的地方先 `pi install`，下次同步时会保留下来。

## 开发

开发用 pnpm（版本钉在 `package.json` 的 `packageManager` 里）：

```sh
pnpm install            # 装开发依赖
pnpm check              # 类型检查 + 全部测试，提交前跑这个
pnpm typecheck          # 只跑 tsc --noEmit
pnpm test               # 只跑 node --test
./install.sh --dev      # 本仓库切到当前检出；之前需 pnpm install
./install.sh --dev --dry-run  # 看本地测试模式的切换和同步计划
./install.sh --dry-run  # 看看这台机器缺什么
```

测试用 `node --test`，没有第三方框架。全部测试都不联网、不碰 `~/.pi`：`scripts/sync.test.mjs` 会使用假的 `pi`，并把 `PI_CODING_AGENT_DIR` 指到临时目录，所以配置读写都发生在那里。它还用带空格路径的临时 git 检出验证 `install.sh --dev`：远程/本地双向切换、不同 git 写法和 ref、重复执行、两份同时注册、移除失败中止、dry-run、域选择、非法检出及管道安装拒绝；第三方包和 prune 保持原来的行为。`scripts/pi-manifest.test.mjs` 只读本仓库的 `package.json`，校验 `pi.extensions` 还盖得住所有顶层扩展、且没把 `extensions/` 下的子目录放进来。

扩展 import 的 `@earendil-works/*`（pi 自己的 SDK）是 peer 依赖，运行时由 pi 提供，所以不装。类型检查和测试前会先跑 [`scripts/link-pi-sdk.mjs`](scripts/link-pi-sdk.mjs)，它在本机 pi 安装里找到这套 SDK 并软链进 `node_modules/`——类型因此永远对着真正加载这些代码的那个 pi 版本。`pnpm install` 之后链接可能被清掉，跑 `pnpm link-sdk` 重建即可；pi 装在别处时用 `PI_SDK_DIR` 或 `PI_BIN` 指过去。

另外注意：别人机器上的运行时依赖由 pi 安装，用的是 pi 自己配置的包管理器（默认 npm），它不读 `pnpm-lock.yaml`。所以 `dependencies` 保持宽松范围；`devDependencies` 不会被装到那些机器上。

仓库约定、以及「改了什么就得同步改哪一节文档」的对照表在 [`AGENTS.md`](AGENTS.md)。
