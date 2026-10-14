# 独立 @ 路径连续补全插件

## 目标
在 preset 中提供独立扩展，让用户在 `@` 文件路径中进入目录后立即看到候选，无需额外按一次 Tab。插件不依赖 Pretty、Beautify 或 fff，不改变现有搜索语义。

## 背景与证据
- 用户已认可统一交互规则：手动输入 `/` 或接受目录补全后，光标落在 `@` 目录路径末尾 `/`，自动请求下一轮候选；接受文件则结束补全。
- Pi 1.2.0 原生 provider 已支持相对路径、绝对路径、`~/`、`../`。主动调用 `getSuggestions` 时，当前项目 `@local/` 有候选，但这不能证明实际输入时自动弹框。
- 原生 Editor 在候选关闭时不以路径 `/` 重新触发请求；已有候选时会更新。因此行为取决于先前候选框状态。
- 原生接受候选后关闭列表；强制 Tab 单候选直接补全分支也没有继续请求目录内容。
- 原生 `@` 使用 fd 递归搜索并限制候选，忽略规则与排序保留，不在本任务重新设计。

## 需求
### R1：输入目录分隔符后自动提示
在 `@` 文件路径上下文中手动输入 `/` 后，自动请求当前路径候选，不依赖原候选框是否打开。覆盖相对目录、`./`、`../`、`~/`、绝对路径和带空格的引号路径。

### R2：接受目录后继续提示
通过 Tab 或 Enter 接受目录候选后，自动展示该目录的新候选。覆盖候选列表接受和单候选 Tab 直接补全。

### R3：只展示，不递归自动接受
新一轮候选只能自动展示；即使只有一个子项，也不得自动接受或逐层钻入目录。用于接受目录的 Enter 不得同时提交消息。接受文件后保留原生关闭候选和尾随空格行为。

### R4：独立性与兼容性
提供独立顶层扩展入口，逻辑、测试放嵌套目录；不耦合 Beautify。保留活编辑器及 history、cursor、undo、paste、IME、快捷键、agent mentions、原有 provider 链和提交语义。普通文本 `/`、slash commands、agent mentions 不触发额外文件浏览。用户 Escape 关闭提示后，不能因同一路径仍以 `/` 结尾而反复自动打开；后续实际进入目录的操作才可触发。

### R5：安全生命周期
不修改安装 SDK 或个人配置；不读写私有编辑状态，不替换编辑器来复制草稿。不支持安全接入的编辑器须保持原功能并诊断降级。异步候选不得在文本变化、Escape、会话切换、reload 或 shutdown 后覆盖新状态；清理不得覆盖后来插件的接线。

## 验收标准
- [x] AC1：候选已关闭时，输入 `@local/` 最后一个 `/` 即出现原生候选，无需 Tab。
- [x] AC2：`@./`、`@../`、`@~/`、绝对路径与引号路径具有相同行为；已有候选时不重复请求。
- [x] AC3：Tab / Enter 接受目录后自动出现下一轮候选，文本停在已接受的目录；单候选下一层也不自动继续补全。
- [x] AC4：原生单候选 Tab 直接补全目录路径同样满足 AC3。
- [x] AC5：接受文件、正常 Enter 提交、普通正文和 slash commands 保持原行为；目录接受 Enter 不误提交。
- [x] AC6：Escape 关闭后不自动反弹；快速打字、删除、切换光标及异步请求不展示过期结果。
- [x] AC7：Beautify、Down opener、history 与 agent mention provider 组合保留状态和原 receiver；不同接线顺序、后装 wrapper、安全降级及清理有自动回归。
- [x] AC8：类型检查、独立扩展与原有相关回归、完整离线测试通过；未真实终端验证时明确声明，不以 provider 调用或 fixture 冒充实际终端验收。

### 最终验收证据与限制
主会话复跑60/60定向自然退出与strict/full671/671，独立check相关47/47、manifest6/6及四类修复见 [check-report.md](./research/check-report.md)。随后真实installed CLI隔离tmux的dark/fullscreen固定140/80/40列核心矩阵通过，见 [tmux-validation.md](./research/tmux-validation.md) 和 [main-verification.md](./research/main-verification.md)；输入/目录Tab/Enter/forceTab续提示、唯一子项只展示、文件尾space、Escape与普通提交已实际验证。六轮CLI/PID/server/config清理通过。两次夹具FAIL及原因保留，未确认产品缺陷。

history/agent组合仍为离线fixture；物理IME、实际input-history原包、regular/其他主题、动态resize及任意不delegate的第三方editor/provider未验，不作全链路保证。用户已授权验收通过后commit及任务归档；未个人安装/同步或push。

## 范围外
- 不恢复 Pretty、fff、文件索引或 find/grep 执行增强。
- 不改变候选排序、ignore 规则、递归范围或条数限制。
- 不将明确目录改为严格单层目录浏览。
- 不新增对 home/root 的后台扫描。
- 不自动安装、同步、reload 个人插件，不提交或推送。

## 已确认取舍
用户已认可使用一个窄范围 Pi 内部补全请求接口，接受 Pi 升级后的兼容风险，并要求补齐规划；此消息不视为对最新完整计划的实施批准。

以 Pi1.2.0 为验证基线，不修改安装 SDK。隔离内部能力适配、预检方法与安全装饰条件；不兼容时保持原生 Tab 并输出英文诊断，不使用模拟 Tab、临时字符或哨兵候选兜底。复用原生候选列表；目录本身无候选时保持原生关闭列表，不新增空目录面板。详见 [design.md](./design.md)、[implement.md](./implement.md)、[feasibility.md](./research/feasibility.md)。
