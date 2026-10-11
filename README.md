# my-pi-preset

我自己用的 [pi](https://pi.dev) preset（个人配置预设）。

一份包清单 + 一个同步脚本 + 几个自写扩展。在任何一台新机器上跑一条命令，就能得到和我日常一样的 pi：装好我要的第三方扩展、补上我自己写的状态栏和几个修补扩展，并且解决掉几个扩展之间的冲突。

- 清单：[`pi-packages.json`](pi-packages.json) —— 要装哪些包、什么版本、哪些包绝对不能装。
- 同步：[`install.sh`](install.sh) + [`scripts/sync.mjs`](scripts/sync.mjs) —— 把本机状态对齐到清单。
- 扩展：[`extensions/`](extensions) —— 本仓库自带的三个扩展，pi 安装本仓库时自动发现。

本仓库自身也是清单里的一条（`git:github.com/AkiChase/my-pi-preset`），所以它和其它包一样被 pi 管理和更新。

## 安装

新机器上，一条命令：

```sh
curl -fsSL https://raw.githubusercontent.com/AkiChase/my-pi-preset/main/install.sh | sh
```

已经有本地检出时，直接跑脚本，效果一样：

```sh
./install.sh
```

只想看会发生什么，不改动任何东西：

```sh
./install.sh --dry-run
```

前置条件：机器上已有 `pi`、`node`、`curl`。装完后在 pi 里 `/reload`，或重启 pi。

### 命令行选项

| 选项 | 作用 |
| --- | --- |
| `--dry-run` | 只打印计划，不做任何改动 |
| `--prune` | 以清单为准，删掉清单里没有的包 |

默认是合并模式：某台机器上临时 `pi install` 的包会保留。加 `--prune` 后清单即全集。脚本只管理用户级包，项目 `.pi/settings.json` 里的包不受影响。

### 用哪个 pi

有些终端应用会在 `PATH` 更靠前的位置放一个同名的 `pi` 启动器，命中它的话 `pi install` 会去打开那个应用而不是装包。所以脚本优先使用受管理的可执行文件 `$PI_CODING_AGENT_DIR/bin/pi`（默认 `~/.pi/agent/bin/pi`），并把最终用的是哪个打印出来。要指定别的：

```sh
PI_BIN=/path/to/pi ./install.sh
```

## 日常使用

```sh
pi update --extensions   # 更新本仓库的扩展，以及已装的包
./install.sh             # 清单改过之后，把这台机器对齐过去
./install.sh --prune     # 顺手清掉清单外的包
```

pi 里可用的自有命令：`/statusbar` 在自定义状态栏和 pi 内置 footer 之间切换。

## 这里有什么

### 第三方包

都写在 [`pi-packages.json`](pi-packages.json) 的 `packages` 里，由 pi 自己从 npm 安装，本仓库不改它们的代码。

| 包 | 来源 | 作用 |
| --- | --- | --- |
| `pi-session-name` | [npm](https://www.npmjs.com/package/pi-session-name) | 从第一句 prompt 自动生成简短的 session 标题，并把 agent 的运行 / 空闲状态写进终端标题 |
| `pi-cache-optimizer` | [npm](https://www.npmjs.com/package/pi-cache-optimizer) | 稳定化 prompt、补 OpenAI 兼容的 cache key，提高 prompt / KV 缓存命中率，并统计命中率 |
| `pi-input-history` | [npm](https://www.npmjs.com/package/pi-input-history) | 跨 session 的 prompt 历史和模糊反向搜索 |
| `pi-web-access` | [npm](https://www.npmjs.com/package/pi-web-access) | 联网能力：web 搜索、URL 抓取、GitHub 仓库克隆、PDF 提取、视频理解，支持一大堆搜索 provider |
| `@tintinweb/pi-subagents` | [npm](https://www.npmjs.com/package/@tintinweb/pi-subagents) | 类 Claude Code 的子 agent 与 workflow 编排：并行执行、实时 widget、自定义 agent 类型、运行中干预 |
| `@juicesharp/rpiv-ask-user-question` | [npm](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question) | 给模型一个结构化提问工具，让它在要猜的时候改成给我几个选项 |

### 由本仓库代为加载的包

这两个包以本仓库的 npm 依赖形式引入（见 [`package.json`](package.json)），由 `extensions/bash-unified.ts` 亲自加载，因此同时被列在清单的 `conflicts` 里——**不能**再作为 pi 包单独安装，否则同一个 `bash` 工具会被注册两次，pi 直接报冲突、启动失败。

| 包 | 来源 | 作用 |
| --- | --- | --- |
| `pi-patty-bg-tasks` | [npm](https://www.npmjs.com/package/pi-patty-bg-tasks) | 后台任务：`run_in_background`、超时自动转后台、Ctrl+B 手动转后台、`jobs` / `monitor` / `bash_bg` 工具 |
| `@heyhuynhgiabuu/pi-pretty` | [npm](https://www.npmjs.com/package/@heyhuynhgiabuu/pi-pretty) | 终端输出美化：文件读取语法高亮、bash 输出着色、目录树视图等 |

### 本仓库自带的扩展

#### `extensions/bash-unified.ts` —— 合并 patty 与 pretty 的 bash

**要解决的问题**：`pi-patty-bg-tasks` 和 `@heyhuynhgiabuu/pi-pretty` 都要注册名为 `bash` 的工具，而 pi 不允许两个扩展占用同一个工具名——后加载的那个会整个加载失败：

```text
Error: Failed to load extension ".../pi-pretty/src/index.ts": Tool "bash" conflicts with .../pi-patty-bg-tasks/index.ts
```

这不只是丢掉 bash 的美化：pretty 整个扩展都没加载，`read` / `find` / `grep` 的美化也一起没了。而用 pretty 自带的 `disableTools` 把它的 bash 关掉，虽然能启动，但又丢了最常看的 bash 输出美化。

**做了什么更改**：好在两边各只改一半——patty 的 bash 只改**执行**，渲染沿用 pi 原生；pretty 的 bash 只改**渲染**（`renderCall` / `renderResult`），执行转给外部传进来的 bash 定义。于是本扩展把两个包都自己加载，并在中间做一次拼接：

1. 用一个 `Proxy` 包住 `pi`，把 patty 对 `bash` 的注册**截下来**而不是真的注册，拿到它的工具定义。
2. 通过 pretty 的 `deps.sdk` 注入点，把这个定义当作「SDK 的 bash」交给 pretty。
3. pretty 注册出唯一的那个 `bash`：patty 的 `execute` 和参数，配 pretty 的渲染。

两边其余的东西（patty 的 `jobs` / `monitor` / `bash_bg` / 快捷键，pretty 的 `read` / `find` / `grep` 与编辑器美化）都原样放行，上游升级照常跟。

**实现细节**：

- pretty 会用自己的 `promptSnippet` 覆盖掉 patty 的，导致模型看不到后台任务的提示，所以这里把 patty 的那句补回去。两边的 `promptGuidelines` 是叠加的，不用管。
- 如果哪天 patty 改了入口、不再注册 `bash`，扩展会直接抛错，而不是静默退回 pi 原生 bash——后者排查起来很费劲。
- patty 的 bash 返回里没有 `details`，pretty 的 `renderResult` 会走按文本推断退出码的兜底分支。非零退出时显示的退出码可能不精确（比如 `exit 3` 显示成 1），耗时和行数都正常。

#### `extensions/status-bar.ts` —— 统一状态栏

**要解决的问题**：pi 把所有扩展 `setStatus()` 的内容塞在 footer 下面共用的一行里，各写各的，装得越多越乱。自定义 footer 是唯一能统一排版的入口，代价是必须自己把那些状态画出来，否则它们会直接消失。

**做了什么更改**：接管 `ctx.ui.setFooter()`，把路径、git、context、token、各扩展状态合并成固定三行：

```text
~/tools/pi-trellis  main ●2 +1 ?1 ↑2  • pi-trellis-design.md
▰▰▰▰▰▰░░░░░░░░ 39% 157k/400k (auto)              mp-messages·claude-opus-5·medium
↑112 ↓30k R5.3M W260k CH95% $0.420  │  ⛁95%  │  trellis: 00-bootstr… ▸ in_progress
```

- 第一行是「我在哪」：路径、git 分支与状态（`●` 工作区改动、`+` 暂存、`?` 未跟踪、`✖` 冲突、`↑↓` 与上游的差异）、session 名。git 信息来自一次 `git status --porcelain=v2 --branch`，在 render 里按 3 秒节流异步跑，并订阅 pi 的分支变化事件立即刷新。
- 第二行是「还剩多少」：context 进度条 + 百分比 + 绝对值，按 70% / 85% 变黄变红；压缩后 token 未知时只画空条和 `?`。右侧是 provider·模型·thinking，thinking 用 pi 自己的 `thinking*` 色标，和界面其它地方的颜色一致。
- 第三行是「花了多少」：累计 token、费用，以及其它扩展通过 `ctx.ui.setStatus()` 发布的状态，组间用 `│` 分隔。

配色规则是「符号退后、数字读色」：箭头和字母标签统一 `dim`，颜色落在值上——当前目录白色加粗（父路径置灰）、分支 `accent`、改动黄 / 暂存绿 / 冲突红、cache 读绿（赚到的）写黄（1.25x 溢价）、命中率按 50 / 80% 分档、费用 `accent`。所有颜色调用都走一个 `paint()` 包装：`theme.fg()` 遇到主题未定义的 token 会 `throw`，而 render 里抛异常会直接弄挂 TUI，所以降级成无色文本而不是崩掉。

和其它扩展的关系：`pi-cache-optimizer` 的长状态被压成一个 `⛁<命中率>%` 的 chip（`⛁off` 表示它被禁用，`⚠` 表示 compat 配置不全，详情仍可用它自己的命令查）；无法识别的键原样透出，这样以后新装的扩展不会被吞掉。`@tintinweb/pi-subagents` 用的是 `setWidget`，画在编辑器上方，互不影响。唯一真正的冲突是另一个扩展也调 `setFooter()`（后调用的覆盖先调用的），目前清单里没有。

`/statusbar` 在自定义 footer 和 pi 内置 footer 之间切换。

#### `extensions/sse-normalize.ts` —— SSE 响应规整

**要解决的问题**：pi 1.1.0 的 Anthropic SSE 解析器在 CRLF 跨 chunk 时会报不可重试的 `Could not parse Anthropic SSE event`，一次长回答就此作废。

**做了什么更改**：包住 `fetch`，把 `text/event-stream` 响应体统一成 LF 换行，并丢掉没有 `data:` 行的空帧。用 `Symbol.for` 记住原始 `fetch`，重复加载不会套娃。

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

放进 `extensions/` 即可，可以是单个文件（`extensions/foo.ts`），也可以是带入口的目录（`extensions/foo/index.ts`）。pi 会自动发现，不需要构建步骤。提交推送后，在其它机器上跑 `pi update --extensions`。

扩展要用第三方 npm 包时，把它写进本仓库 `package.json` 的 `dependencies`：pi 安装 git 来源的包时会在检出目录里跑 `npm install`。要是这个包本身也是个 pi 扩展（像上面的 patty 和 pretty），记得同时把它加进 `pi-packages.json` 的 `conflicts`，否则两边会各注册一遍。

## 添加第三方包

1. 把来源和想要的版本写进 `pi-packages.json`。
2. 提交并推送。
3. 在每台机器上跑 `./install.sh`；或者在需要的地方先 `pi install`，下次同步时会保留下来。

## 开发

```sh
node scripts/sync.test.mjs   # 同步逻辑的离线自测
./install.sh --dry-run       # 看看这台机器缺什么
npm install                  # 装扩展用到的第三方依赖（pi 装 git 包时会自己跑）
```

自测脚本会在 `PATH` 里放一个假的 `pi`，所以不会碰你的配置，也不联网。
