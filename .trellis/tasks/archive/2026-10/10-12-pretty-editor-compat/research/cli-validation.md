# 真实 CLI 集成验证

## 最终结论
实际安装 **Pi 1.1.0 CLI** + 实际 **pi-input-history 1.1.3** + 隔离 worktree 的生产 **`extensions/bash-unified.ts`**，两种加载顺序 × cold / 实际 `/new` / 实际 `/reload` 的 **6 个验证组合全部通过**。

每个组合均证明 ↑/↑/↓/↓ 跨 session 历史、Alt+R 真实搜索 overlay、fuzzy query、Enter 接受、Escape 取消保留草稿，以及 Pretty 装饰。不是只调用 helper 或模拟 runtime/session_start。本轮只补集成证据，不操作任务 finish/commit，也不宣称所有终端或未来版本兼容。

## 环境与边界
- 写入范围：`/Users/jyxc-dz-0101322/tools/my-pi-preset-pretty-editor-compat/.trellis/tasks/10-12-pretty-editor-compat/research/`。无生产修改，无依赖安装/源码修改，无 commit/finish，无原忙碌 worktree 操作。
- Node：`/opt/homebrew/bin/node`。
- 实际 CLI：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`；实际 `--version` 输出 `1.1.0`。直接执行安装包声明的 CLI entry，不绕到 SDK harness。
- history：`/Users/jyxc-dz-0101322/.pi/agent/npm/node_modules/pi-input-history`，只读使用实际 source，1.1.3。生产回归测试仍为离线 fixture，没有引入本机 source 依赖。
- Pretty：隔离 worktree 安装的 0.6.31，生产 wrapper 同时运行 bg-tasks/Pretty 注册；实际工具集合只有一个 `bash`。
- 每次创建 `<tmp>/home`，同时设为 **HOME 和 cwd**；agent/config=`<tmp>/home/.pi/agent`。临时 cwd 不在任何原 worktree 下，未读个人 auth/config。
- 环境显式白名单，不继承凭据、个人配置变量或 Trellis 指针。具体 temporaryRoot、全部 env、settings、seed、CLI argv 存在各结果 JSON。
- flags 禁用 context/skills/prompts/MCP，`--no-approve` 不加载项目 trust-gated 资源。只声明两个本地包和临时 observer，不隐式发现原项目设置。
- `models.json` 自建 `offline-validation/never-request`，dummy key、`http://127.0.0.1:9/v1`，未提交模型提示。`PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0`，cacheWarming/compaction/retry 关闭。
- 临时 Node preload 拒绝 net/tls/http/https/fetch 并记录尝试，最终两次 **networkAttempts=[]**。observer 无 `UNEXPECTED_MODEL_PROMPT`，全部 debug `agentMessageRoles=[]`、54 个 editor snapshots 的 `branchUsers=0`。
- FFF 利用 Pretty README 的“exact HOME 默认不扫描”：cwd=HOME，`PRETTY_FFF_HOME_SCAN=0 PRETTY_FFF_ROOT_SCAN=0`；没有注入 FFF seam。模块实际加载，但全部 snapshots `fffAvailable=false`，没有索引。
- `finally` 发送 `/quit`（故障时有 TERM/KILL 兜底）、关闭 PTY、删除 temp tree。最终两次 CLI **exitCode=0、temporaryTreeRemoved=true**，没有遗留 CLI 或临时配置。

## 配置和 seed
临时 settings `packages` 为以下两项，pretty-first 交换其顺序：

```json
[
  {
    "source": "/Users/jyxc-dz-0101322/.pi/agent/npm/node_modules/pi-input-history",
    "extensions": ["index.ts"], "skills": [], "prompts": [], "themes": []
  },
  {
    "source": "/Users/jyxc-dz-0101322/tools/my-pi-preset-pretty-editor-compat",
    "extensions": ["extensions/bash-unified.ts"], "skills": [], "prompts": [], "themes": []
  }
]
```

临时 `pi-input-history.json` 用文档配置 `{"searchShortcut":"alt+r"}`。observer 只注册 lifecycle 记录及 Alt+Z 读取公开 `ctx.ui.getEditorText()`，不包装或改 editor。实际启动资源列表包含 `bash-unified.ts, observer.ts, pi-input-history`。

启动前实际 SDK `SessionManager.create(cwd)`，两次 `appendMessage(user)`：
1. `CLI history older alpha`
2. `CLI history latest beta`

实际 `SessionManager.list(cwd)` 返回一个 previous session。CLI fresh session ID 与 seed 不同、branch 为空。没有把 resumed 会话输入冒充跨 session 历史。

## 精确命令和最终结果
在授权 worktree 运行：

```sh
cd /Users/jyxc-dz-0101322/tools/my-pi-preset-pretty-editor-compat
python3 .trellis/tasks/10-12-pretty-editor-compat/research/cli-validation.py --order both --tui-mode regular
```

最终 job `byxaqizsb` **退出 0**；stdout 原样保存到 [cli-results.txt](cli-results.txt)。每个顺序：27 editor snapshots、6 actual debug captures、9 PTY display captures，CLI 退出 0。实际 PTY 120×40；history-first 原始输出 48,974 bytes，pretty-first 49,135 bytes。

脚本 [cli-validation.py](cli-validation.py) 包含完整 temp settings/env、seed JS、observer、network guard、预期和 finally。进程实际 argv：

```sh
/opt/homebrew/bin/node /Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js \
  --offline --no-approve --no-mcp --no-skills --no-prompt-templates \
  --no-context-files --no-themes --provider offline-validation --model never-request --tui-mode regular
```

| 实际 CLI 验证 | history-first cold | history-first /new | history-first /reload | pretty-first cold | pretty-first /new | pretty-first /reload |
|---|---|---|---|---|---|---|
| ↑ latest、↑ older、↓ latest、↓ 空 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| Pretty decorated input + latest (`/debug`) | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| Alt+R real overlay `[1/2]` | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| `ol al` fuzzy => older `[1/1]` | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| Enter 仅填 editor，不请求模型 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| CSI-u Escape cancel 保留 unsent draft | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |

完整逐项证据（每份约 109KB，含 bounded PTY tail，不保存无限日志）：
- [cli-regular-history-first.json](cli-regular-history-first.json)
- [cli-regular-pretty-first.json](cli-regular-pretty-first.json)

JSON `snapshots` 的 `label/editor/sessionId` 给出输入与生命周期；`debug.rendered` 是 actual CLI `/debug` 文件解析，`display` 是按键后的 actual PTY 输出，`actions` 保存精确发送字节，`events` 保存 actual runner lifecycle。

## Session / runner 实证
| 顺序 | cold session ID | `/new` 后 ID | `/reload` 后 ID |
|---|---|---|---|
| history-first | `01a12fc7-0bbd-7295-be5b-a892aae56e60` | `01a12fc7-0ee8-7295-be5b-a89436aac6a3` | `01a12fc7-0ee8-7295-be5b-a89436aac6a3` |
| pretty-first | `01a12fc7-1366-71be-b883-b624846defb1` | `01a12fc7-1675-71be-b883-b62740a5a41b` | `01a12fc7-1675-71be-b883-b62740a5a41b` |

两次均有 **3 start + 3 shutdown**：cold start → `/new` old shutdown/new start（ID 改变）→ `/reload` old shutdown/new start（ID 保留）→ `/quit` shutdown。不是重复发送 session_start。

每阶段 actual `/debug` 显示 `╭…╮ / │ ❯ CLI history latest beta … │ / ╰…╯`，message roles 为空；历史位于 decorated editor，不是 transcript。Actual PTY search 有 `(reverse-search) [1/2]`、latest preview；query 后 older preview `[1/1]`；Enter 后公开 editor=older，取消后 editor=`CLI unsent draft`。

按键：Up=`ESC[A`、Down=`ESC[B`、Alt+R=`ESC r`、observer Alt+Z=`ESC z`、Ctrl+Shift+D=`ESC[100;6u`、Escape=`ESC[27u`；`/new\r` 和 `/reload\r` 走真实 CLI slash command。普通文本从未按 Enter 发送模型，Enter 只用于 slash commands/搜索接受。

## 中间失败、同步修订与限制
- 前轮 lone ESC 等待差分输出重印 draft 超时；改 CSI-u Escape + 直接读 editor 后已在 6 个组合通过，无需 Ctrl+G fallback。
- 本轮首次重跑 job `bci9yjc9q` 退出 1：history-first 全部通过，pretty-first cold/new 通过，reload 的 observer snapshot 发送过早。保留 [cli-attempt-csi-history-first.json](cli-attempt-csi-history-first.json)、[cli-attempt-csi-pretty-first.json](cli-attempt-csi-pretty-first.json)，不抹掉失败。
- 原因是 observer session_start 在 Pretty 异步 FFF 初始化/host setupExtensionShortcuts 完成前触发。测试现在在 `/reload` 后等待实际 CLI `Reloaded keybindings, extensions, skills, prompts, themes, and context files`，然后发送快照。未改生产代码或插件顺序。
- `/debug` 的 base `ui.render(width)` 不包含 overlay，所以 overlay 证据使用实际 PTY ANSI 输出，未把缺失 overlay 伪称 debug 成功。
- actual 启动报告 `fd not found. Offline mode enabled, skipping download.`；没有下载 fd，不影响已验证历史功能。
- 两次 actual `/reload` 均出现 HOME 目录 FFF 拒绝扫描 warning（`Can not run certain FFF features in a file system root or home directories`），原样保留 tail。这是本测试环境的 FFF 安全拒绝，不隐瞒或改依赖；没有 finder，历史/编辑器/搜索验证成功。是否需消除该 reload warning 是另外的问题，不在本任务实施范围。
- 本轮验证 **regular TUI**，未测 fullscreen、真实模型调用、native FFF 搜索、极窄屏等；不把既有 fixture 单元测试或本 CLI 结果扩展为这些能力的通过证据。

以上已闭合此前“真实 input-history、生产 wrapper、CLI `/new`/`/reload` Up+Alt+R”缺口。任务审查/提交/收尾仍留主会话决定。
