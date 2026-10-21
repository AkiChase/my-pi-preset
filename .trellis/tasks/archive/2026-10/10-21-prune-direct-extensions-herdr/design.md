# 统一清理手工扩展并直连 Herdr：设计

## 1. 问题与目标边界

Pi 包管理的 `packages` 域只知道 `pi list` 中的 User packages；用户扩展目录的直接入口不在该清单中。因此，裸 `--prune` 目前不能恢复“只留下本预设声明资源”的状态。与此同时，等待用户输入的 Herdr Blocked 状态依赖另一个由 Herdr 放入该目录的扩展，形成仓库扩展 → 私有事件 → 手工扩展 → Herdr socket 的分层链路。

本设计只解决两件事：

1. 将 `<agent-dir>/extensions/` 中 Pi 可发现的直接扩展入口纳入同步脚本的选择和 prune 计划；
2. 将 Herdr 状态上报变为本预设包内的直接实现。

它不把手工扩展复制进仓库，也不管理 project `.pi/extensions/`、settings 中显式额外资源路径、非扩展 JSON、认证或任何外部直接扩展的安装过程。

### Change Boundary

- **最小行为缺口**：同步脚本没有用户直接扩展域；Herdr 的状态上报跨越两个独立扩展，且本预设不拥有 socket 对接。
- **实际 owner**：清理选择、计划和删除属于 `scripts/sync.mjs`，而非 `install.sh` 或 Pi package 配置；Herdr 生命周期与 prompt 追踪属于顶层预设扩展，不能由静态文档或手工脚本替代。
- **预期文件**：同步脚本、同步测试和 manifest 共同定义新域；旧 Blocked Signal 入口/测试/文档由 Herdr State 入口/测试/文档替换；README 和 docs index 更新可发现性。
- **明确排除**：不重构 Pi 或 Herdr、不增加外部扩展安装器、不兼容遗留 Herdr 脚本、不引入 cmux fallback，也不扩展到 project 资源。
- **局部重构证明**：通过旧 label/问卷等待行为的等价测试、直连 transport 协议测试和删除 `CMUX_` / `herdr:blocked` 引用的 tree search 证明重命名没有保留旧的宿主路径。


## 2. 手工扩展域

### 2.1 域名与清单

新增同步域 `extensions`。它的受管根固定为 Pi 解析出的用户 agent directory 下的 `extensions/`，不会从设置、cwd 或任意外部路径推导。

`pi-preset.json` 的 `preserve.extensions` 是可选的直接入口名列表；名称只能是该目录下一层的普通文件名或目录名，禁止绝对路径、路径分隔符、`..` 和隐藏项。该列表只在 prune 时保留现有的外部入口，不能安装、复制或更新它们。当前预设将其保持为空，因此全量 prune 会移除全部候选手工扩展。

沿用现有的同步约定：

| 命令模式 | `extensions` 行为 |
| --- | --- |
| 默认 / merge | 发现候选项并在计划中显示 `keep`，不改动磁盘。 |
| `--prune extensions` | 删除不在 `preserve.extensions` 中的候选直接扩展。 |
| 裸 `--prune` | 因 `extensions` 进入默认的全部同步域，也会 prune 它。 |
| 未选择 `extensions` | 不读取扩展目录、不创建目录、不删除文件。 |
| `--dry-run` | 只列出 `keep` / `remove`，不改动任何扩展文件。 |

### 2.2 候选发现和删除边界

候选项限定为 Pi 用户扩展目录第一层中可能被 Pi 自动发现的资源：

- 直接的 `.ts` 或 `.js` 文件；
- 包含 `index.ts`、`index.js` 或有效 Pi `package.json` 扩展声明的直接子目录；
- 解析符号链接以判断它是否为文件或目录入口，但删除时只移除该目录项/链接，不跟随到链接目标。

Pi 若把扩展根本身解析为一个 package / `index` 入口，脚本应拒绝 prune 并给出明确错误，而不是递归删除整个共享根。这个 fail-closed 边界避免把与扩展共存的任意根目录 JSON 或资源误删。根目录不存在、不可读或没有候选项不是错误。

直接文件入口删除时只移除该入口自身；不会按名称推断或删除任何侧车、JSON 或其他未知文件。目录候选按目录项整体删除；普通 `pi-recap.json` 永远不是候选。

同步计划条目保留绝对执行路径供删除，但向用户展示相对 `<agent-dir>/extensions/` 的入口名。删除使用 Node 内置 `rmSync`，每个失败独立记录并令最终命令失败，不继续伪称完整成功。

### 2.3 执行次序

现有包动作仍先于配置写入。扩展目录删除作为独立文件系统动作在包和 JSON 写入之后执行，和配置写入一样参与总步骤数与失败汇总。它不调用 `pi`、不写 `settings.json`，也不与 JSON lock 复用。

`--prune` 在正在运行的 Pi 会话中改变磁盘资源；同步完成后的 `/reload` 或重启仍是用户显式要求的加载边界。脚本不自动 reload。

## 3. Herdr 直连扩展

### 3.1 入口与职责

移除顶层 `extensions/blocked-signal.ts`，新增顶层 `extensions/herdr-state.ts`；`package.json` 的 `extensions/*.ts` 模式自动将其作为本预设资源加载。相应用户文档改为 `Herdr State`。

新入口在以下条件同时成立时启用：

- `HERDR_ENV === "1"`；
- `HERDR_SOCKET_PATH` 非空；
- `HERDR_PANE_ID` 非空；
- 会话 context 的 `mode === "tui"`。

未满足任一条件时不注册 socket 状态副作用，Pi 的普通生命周期和输入行为保持不变。

### 3.2 传输协议

实现以当前 Herdr Pi v9 模板为协议参考，但由本仓库维护：

- Unix socket（Windows 命名管道路径按 v9 规则转换）；
- `pane.report_agent_session` 上报 `pane_id`、`source: "herdr:pi"`、`agent: "pi"`、递增序列与会话文件路径或 ID；
- `pane.report_agent` 上报同一身份、递增序列、`working` / `blocked` / `idle` 和可选短标签；
- 会话文件路径用 `path.posix.isAbsolute` 或 `path.win32.isAbsolute` 判断，非绝对路径回退为 session ID；
- 每次发送使用短连接、500 ms 首次尝试和 1500 ms 重试，socket / JSON / 回调错误全部吞掉并 fail-open。

状态发送使用单一排队器；最新状态覆盖尚未发送的旧状态，避免慢 socket 造成并发乱序。会话关闭后禁止继续发布异步完成的初始上报。

### 3.3 状态机与等待追踪

状态优先级固定为：`blocked` > `working` > `idle`。

| 输入 | 状态影响 |
| --- | --- |
| `session_start`（TUI） | 记录 session ref、报告会话、按 `ctx.isIdle()` 发布 working 或 idle。 |
| `agent_start` | 更新 session ref，发布 working（除非仍有等待）。 |
| `agent_settled` 且 `ctx.isIdle() === true` | 发布 idle（除非仍有等待）。 |
| 非 custom `ui_prompt_start` | 开始标准交互等待，发布 blocked 和提示标题/默认标签。 |
| `rpiv:ask-user:prompt` + `rpiv:ask-user:blocked(active:true)` | 开始问卷等待，优先用第一题 header / question 标签。 |
| 对应 end / `active:false` | 引用计数降为零后恢复 working 或 idle。 |
| `session_shutdown` | 关闭状态机、清空本地等待信息，忽略迟到事件与异步传输完成。 |

沿用当前已验证的标签清洗、重叠问卷计数和浏览器 custom UI 静默语义，但将 sink 抽象收窄为内部 Herdr reporter。新代码既不发出也不依赖 `herdr:blocked`，也不保留 cmux CLI、环境变量或 child-process 调用。

### 3.4 不兼容迁移

这是刻意的无兼容迁移：新扩展不会检测、关闭或适配旧 `herdr-agent-state.ts`。用户先运行带 `extensions` 域的 `--prune`，确认 dry-run 后实际删除旧脚本，再 reload / 重启 Pi。普通 merge 更新后若用户跳过 prune，旧脚本的并存行为不在支持范围内。

该选择避免让临时升级状态永久留在运行时代码；README 与 Herdr State 文档会写清正确迁移命令和清理边界。

## 4. 文件变更

| 文件 | 变更 |
| --- | --- |
| `scripts/sync.mjs` | 增加域、清单 preserve 解析、候选发现/计划/删除、帮助和执行汇总。 |
| `scripts/sync.test.mjs` | 增加纯计划和 CLI 临时 agent-dir 的选择、merge、prune、干跑、目录、侧车、错误和安全边界测试。 |
| `pi-preset.json` | 显式添加空的 `preserve.extensions`。 |
| `extensions/blocked-signal.ts` | 删除。 |
| `extensions/herdr-state.ts` | 新增直接 Herdr 状态机和 socket reporter。 |
| `extensions/__tests__/blocked-signal.test.ts` | 删除或以 `herdr-state.test.ts` 替换。 |
| `README.md`、`docs/index.md`、`docs/extensions/blocked-signal.md` | 更名、更新导航和同步说明。 |
| `docs/extensions/herdr-state.md` | 新增当前 Herdr-only 行为、环境条件、迁移与限制说明。 |

## 5. 验证与回滚

- 同步测试使用临时 `PI_CODING_AGENT_DIR` 和 fake `pi`，绝不读写真实 `~/.pi/agent`；覆盖未选择域不触碰目录、dry-run 无写入、merge 保留、prune 删除文件/目录/侧车、保留列表、根 package fail-closed 和删除错误。
- Herdr 测试以 typed fake Pi 和注入的 transport seam 驱动真实已注册 handlers；断言 session/state 协议消息、状态优先级、问卷嵌套、标准对话框、关闭 fencing、socket 失败和跨平台绝对路径。
- 运行相关 focused tests、`scripts/pi-manifest.test.mjs`、类型检查和完整 `pnpm check`，均使用临时 agent dir。
- 回滚是恢复本仓库旧提交并在需要时通过 Herdr 自己的 `herdr integration install pi` 恢复其手工扩展；本任务不会自动调用该命令。
