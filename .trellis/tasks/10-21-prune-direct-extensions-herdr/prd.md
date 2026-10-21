# 统一清理手工扩展并直连 Herdr

## Goal

让本预设的同步脚本能够在 `--prune` 下管理 Pi 用户扩展目录中手工放置、实际可被 Pi 加载的扩展；同时将 Herdr 状态上报实现纳入本预设，使其不再依赖 `~/.pi/agent/extensions/herdr-agent-state.ts` 的事件转发器。

用户价值是：`./install.sh --prune` 的受管范围完整且可预测，Herdr 的 Working / Blocked / Idle 状态不依赖机器上另行安装的 Pi 集成脚本。

## Confirmed Facts

- 当前同步域只有 `packages`、`settings`、`keybindings`、`files`（`scripts/sync.mjs:32`）。包清理只根据 `pi list` 的 User packages 建计划（`scripts/sync.mjs:455-492`、`scripts/sync.mjs:495-564`），不会扫描 `<agent-dir>/extensions/`。
- Pi 会从 `<agent-dir>/extensions/` 加载直接的 `.ts` / `.js` 文件和带 `index.ts` / `index.js` 的子目录；用户扩展目录默认为 `~/.pi/agent/extensions/`。当前没有 `~/.pi/agents` 或 `~/.pi/extensions` 目录。
- 当前机器的用户扩展目录包含 `herdr-agent-state.ts`（Herdr 管理的 Pi 集成，v8）、其他直接扩展入口，以及非加载型旧配置 `pi-recap.json`。
- 当前 `extensions/blocked-signal.ts` 在 Herdr 环境下只发出 `herdr:blocked` 事件；手工 Herdr 扩展监听该事件，并直接向 Herdr socket 发送 `pane.report_agent` / `pane.report_agent_session` 请求。
- `herdr integration status` 显示当前 Pi 集成为过期的 v8，安装的 Herdr 二进制内置 v9 模板；v9 相较 v8 的 Pi 模板主要补充 Windows 绝对会话路径识别。
- 本仓库的 `package.json` 以 `extensions/*.ts` 显式加载所有顶层 TypeScript 扩展；仓库内的 `herdr-state.ts` 可随本预设包加载，无需复制到用户扩展目录。
- 当前 Blocked Signal 同时为直接运行在 cmux 的会话提供补充通知；用户选择在本次改造中取消该支持。

## Product Decisions

- 创建 Trellis 任务并完成设计后实施。
- `--prune` 应全量清理未被清单声明的、可由 Pi 从用户扩展目录直接加载的手工扩展；用户接受该清理的完整范围。
- 仅把可加载扩展入口视为本次新清理域；非加载型 JSON 配置（包括 `pi-recap.json`）和其他未知文件不因该域被删除。
- 将 Herdr 专用行为重构为本预设内置的 `extensions/herdr-state.ts`，由该扩展直接连接 Herdr，而不是经 `herdr:blocked` 事件委托给手工 Herdr 扩展。
- 遗留 `herdr-agent-state.ts` 仅在用户显式执行 `--prune` 时删除；不为未清理的旧文件提供运行时检测、事件桥接、禁用或其他兼容逻辑。用户将通过 prune 后 reload / 重启完成迁移。

## Requirements

### R1 — 手工扩展同步域

1. 同步脚本新增一个清晰命名的用户扩展域，能够发现 Pi 在 `<agent-dir>/extensions/` 下会直接加载的文件和目录。
2. 该域必须受 `--sync` 和 `--prune` 的同一套选择/校验语义约束；裸 `--prune` 应包含它。
3. 默认 merge 模式不得删除或修改未声明的手工扩展；prune 模式只删除未声明的可加载手工扩展入口，不根据名称推断或删除其他未知文件。
4. 不得将任意 JSON 或其他非扩展文件误判为插件；尤其不得删除 `pi-recap.json`、认证、模型或其他用户状态。
5. dry-run 必须完整列出将保留、删除或进行迁移的手工扩展操作，且不修改机器文件。

### R2 — Herdr 直连扩展

1. 新增名为 `herdr-state.ts` 的内置扩展，只有在有效 Herdr 环境变量存在时才工作。
2. 它直接向 Herdr socket 上报 Pi 会话引用及 `working`、`blocked`、`idle` 状态，兼容当前 Herdr Pi 集成的协议和 v9 的跨平台绝对路径处理。
3. 它应追踪 Pi 标准提示和已适配 `rpiv-ask-user-question` 问卷的重叠等待生命周期，并以当前可用的简短标签上报 Blocked 状态。
4. 所有 socket、事件或输出解析错误必须 fail-open：不能阻塞 Pi 会话、工具调用或 UI 生命周期。
5. 改造后不得保留 cmux 通知路径，也不得依赖或发出 `herdr:blocked` 作为本预设内部的 Herdr 状态传递协议；不为旧 Herdr 手工扩展保留兼容分支。

### R3 — 迁移与文档

1. 迁移依赖用户先执行 `--prune` 删除旧 `herdr-agent-state.ts`，再 reload / 重启 Pi；新内置扩展不包含旧文件检测或兼容事件桥接。
2. README 和扩展文档必须准确说明新清理边界、Herdr 环境启用条件、以及 cmux 支持已移除。
3. 现有相关测试应改为覆盖新域的 merge/prune/dry-run 行为和 Herdr 直连状态生命周期；移除或替换 cmux 行为测试。

## Acceptance Criteria

- [x] `./install.sh --sync <new-domain> --prune <new-domain> --dry-run` 能识别用户扩展目录中的直接 `.ts` / `.js` 扩展以及直接入口子目录，不修改文件，并逐项输出计划。
- [x] 在 prune 模式下，未声明的手工可加载扩展会被删除；非加载型 `pi-recap.json` 保留不变；在 merge 模式下二者均保持不变。
- [x] 裸 `./install.sh --prune --dry-run` 将新域显示为 prune 模式。
- [x] 新的 `extensions/herdr-state.ts` 可在 Herdr 环境中直接报告 session、working、blocked、idle，而无需已加载的 `herdr-agent-state.ts` 或中间 `herdr:blocked` 事件。
- [ ] 用户先执行 prune 并 reload / 重启后的真实宿主迁移路径未运行：该步骤会修改个人用户扩展目录，保留给用户执行；隔离测试已验证清理和新包入口发现。
- [x] cmux 专用实现、文档和测试已移除，且仓库类型检查、完整测试套件通过。
- [x] 文档明确说明全量手工扩展 prune 的清理范围和用户负责恢复任何外部集成的边界。

## Out of Scope

- 自动安装、更新或配置任何外部直接扩展。
- 删除任意非扩展用户文件、认证状态、Pi 设置、模型和项目级资源。
- 修改 Herdr 本身、Herdr socket 服务端协议或其他 agent 的 Herdr 集成。
- 保持或新增 cmux 等非 Herdr 宿主集成。
- 通过 `--prune` 管理 project `.pi/extensions/` 或 settings 中显式指向的任意外部扩展路径；本次仅覆盖默认用户扩展目录。
