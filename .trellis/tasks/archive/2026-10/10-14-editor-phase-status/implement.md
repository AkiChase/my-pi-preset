# 实施计划：输入框阶段状态与加载动画

## 当前边界

用户已明确批准在 Beautify 开始本任务实施、检查与 verified stage 本地提交。主会话直接实施，独立 trellis-check 审核；不安装、不个人同步/reload、不 push/归档，不将真实 TUI 纳入本轮授权。未使用 implement manifest；check manifest 在审核派发前补齐。启动前验证记录保留其当时边界，当前状态以本段为准。

## 执行方式

优先主会话直接实施。事件流、原生 loader/editor 与生命周期交接属于跨模块 UI 合同，交付前安排独立 trellis-check；实施与审核角色分别选择。未来若派发，先补真实 spec/研究 check.jsonl，再遵守 managed dispatch 协议，不使用临时 worktree/source fallback。暂无 worktree 创建或准备授权。

## 准备清单

- [x] 重读 PRD/design、当前 workflow 与 development/testing 规范；用户功能文档为 `docs/extensions/beautify.md`，开发与测试方法归 spec。
- [x] 检查 Git 与并行改动；本轮仅修改三份任务 Markdown，未动产品、SDK 链接或生命周期。
- [x] 核查当前 Pi 1.3.0 的公开类型、实际 agent-loop 和离线事件顺序。
- [x] 启动前技术可行性收敛：indicator 公开展示已验证；用户确认 Asking 可见规则和 Compacting 提示起点计时。完整 controller/所有权/清理仍为后续实施验收，不把可行性验证当产品通过。
- [x] 已明确批准实施并 start，unused implement manifest 有意为空，check manifest 已补齐并完成独立审核。validate 仍因空 implement manifest 退出 1，check 13 引用通过存在性检查并带代码引用警告；不称 full validation success。

## 单个耦合实现阶段

本功能的状态词、事件归并、spinner/颜色、清理和测试互相依赖，作为一个独立可验证阶段，不拆出用户不可用的中间产品提交。

1. 新增纯状态归并与单调时间模型；普通阶段、Asking 覆盖、独立压缩生命周期归并为五词，终态/epoch 可测试。
2. 接入 Beautify 的公开 working UI 控制器及经验证的压缩专用展示接线，保持原生 editor、spinner 与 Retry/Branch Summary；只一个低频时间更新 owner。
3. 实现主题可读配色与10/30秒有界增强，验证不定期重置 spinner，不更改边框语义。
4. 实现标准 UI prompt 与问卷 `rpiv:ask-user:blocked` 等待身份/生命周期，排除普通 custom 浏览面板；不得靠 prompt payload 猜测意图。
5. 补生产事件/实际 SDK loader/editor 的回归；包含并行、串行、嵌套、拒绝/截断、nested model、终态、取消切换、reload-before-shutdown、partial setup failure。
6. 更新 `docs/extensions/beautify.md` 的中文输入框说明；必要时更新 README 链接，不新增功能 spec 或扩大文档重组范围。
7. 自检、独立 check、主会话核实际 diff 和修复后证据；stage 仅 scoped files；通过后立即提交本阶段。不能混入现有未提交工作。

## 计划验证命令

以下是待实施执行的计划，当前没有运行这些产品检查。必须保持临时目录隔离及真实退出码。

```sh
# 解析现有链接并验证存在，不下载或切换 SDK。
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");const sdk=fs.realpathSync("node_modules/@earendil-works/pi-coding-agent");console.log(p.dirname(p.dirname(sdk)));')" || exit
[ -d "$sdk_dir/@earendil-works/pi-coding-agent" ] || exit 1
# 仅实施检查需要链接时运行；link-pi-sdk 会修改 symlink，不是只读检查。
PI_SDK_DIR="$sdk_dir" node scripts/link-pi-sdk.mjs || exit

# focused 自然退出（测试文件将在本阶段新增）
agent_dir="$(mktemp -d)"
PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/beautify/__tests__/phase-status.test.ts extensions/beautify/__tests__/editor.test.ts extensions/beautify/__tests__/terminal-layout.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/__tests__/blocked-signal.test.ts
result=$?
rm -rf "$agent_dir"
(exit "$result")

# 受影响的整个 Beautify suite，自然退出
agent_dir="$(mktemp -d)"
PI_CODING_AGENT_DIR="$agent_dir" node --test 'extensions/beautify/__tests__/*.test.ts'
result=$?
rm -rf "$agent_dir"
(exit "$result")

# 严格类型检查与完整配置 suite
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

长命令用 background job，不 sleep 等待；focused/broader 自然退出不使用 test-force-exit。pnpm check 的完整 suite 自带强制退出，不能把它单独作为资源释放证明。实施时 SDK 路径重查，node test glob 支持重查。与 session/Trellis 环境相关的 fixtures 根据 harness 合同进一步隔离，不能依赖真实个人配置。

### 测试矩阵

- Loading -> Brewing（thinking/text/toolcall），toolcall_end 保持 Brewing；无内容/空消息/错误/abort。
- 并行工具一个结束不提前回模型；串行工具间不闪 Loading；嵌套事件不重复；truncate 的合成 start/end 不误报真实执行。
- 末工具结束 -> prepare -> 新 turn Loading -> 首内容 Brewing；慢 finishTurn/prepareNextTurn/context 准备不能无限保留旧阶段，最终回答清理。
- 真实用户问题/确认覆盖 Asking；Task Panel/custom setup 不覆盖；嵌套及取消提示恢复最新阶段。
- 后台 Agent 与工具内部 provider 请求不污染主状态。
- timer 10/30 秒边界，单调时钟，重复 token/tool update 不重置，idle/shutdown 无 timer/listener 泄漏。
- 实际 Loader 连续帧变化、phase/tick 不重置；Asking 静态、恢复时必要模式切换；颜色有界且暗/亮主题可读。
- narrow/resize、hidden-line 标签、IME marker、editor 实例/history/undo/focus 保护；later wrapper 与 rollback。
- 手动/自动压缩 -> Compacting 与独立耗时；重复进度不重置，压缩内部模型请求不触发 Loading/Brewing；真实 prompt 覆盖结束后恢复仍在进行的压缩。
- 压缩成功/失败/取消 -> 以真实后续事件恢复或清除；自动压缩后下一模型阶段才 Loading，空闲手动压缩结束无残留；普通 agent_end 不能提前清除进行中的压缩。
- retry/branch summary 专用提示、压缩 cancel hint 不被覆盖；另测压缩内部 summarization retry 的 indicator 替换、恢复及跨 retry 耗时不重置；压缩展示公开能力不足时保留原生提示并标技术阻塞；reload UI reset 早于 shutdown、真正/取消 session switch。

### 真实 TUI 验证

待明确授权后使用已有 CLI、独立 tmux server 与临时 HOME/agent/config/cwd/session、scripted local provider/可控工具，观察五种状态、颜色、阶段时间和 resize；增加手动/自动压缩及成功/失败/取消恢复验证，保留原生取消提示；不用个人会话，不安装/reload 个人插件。命令依照实施时 spec 的 tmux 指南。此项与普通实施授权不混淆：未跑就标 NOT_RUN，不能以模拟组件验收替代。

## 启动前验证记录（Pi 1.3.0）

### 环境与执行边界

用户授权：更新规划和隔离技术验证，不包含产品实施、start、commit、安装或真实交互式 TUI。Node v24.14.1，pnpm 10.33.0；SDK 使用既有 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.3.0/node_modules`，未运行 link-sdk 或获取依赖。

本轮 owned run directory 为 `/tmp/editor-phase-preflight.7i2OZD`。临时脚本、原始日志与事件 trace 均位于该目录，不进入 research/ 或 evidence/。以下结果是实际安装 SDK 组件/离线 embedding 合同验证，不是功能交付、真实终端视觉或在线 provider 验收。

### 主会话检查命令与结果

共同环境：`PI_CODING_AGENT_DIR=/tmp/editor-phase-preflight.7i2OZD/agent`；问卷与现有回归另设 `HOME=/tmp/editor-phase-preflight.7i2OZD/home` 和 `XDG_CONFIG_HOME=/tmp/editor-phase-preflight.7i2OZD/config`。宿主 harness 在 SDK 导入前建立自己的临时 agent directory；问卷配置读取也隔离到临时 HOME/XDG。命令均无 `--test-force-exit`。

| 命令 | 退出码与结论 |
| --- | --- |
| `node --test /tmp/editor-phase-preflight.7i2OZD/indicator.test.mjs` | 首轮 1：4 例中 3 PASS，循环 fixture 未重置 seconds，17s 断言收到上一轮 18s；修 fixture 后 0/4 PASS；补原生 static mode 后最终 0/5 PASS |
| `node --test /tmp/editor-phase-preflight.7i2OZD/questionnaire.test.mjs` | 首轮 1：临时 jiti 缺宿主 TypeBox alias，未进入用例；补已有宿主 alias 后 1，出现首次并发懒加载 incomplete module、挂载 deadline 与缺 fixture terminal listener；补 listener 后仍 1；先完成真实 peer graph 串行 preload 后最终 0/3 PASS |
| `./node_modules/.bin/tsc --strict --noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext /tmp/editor-phase-preflight.7i2OZD/public-probe.ts` | 0，CustomEditor 参数推导的 indicator kind/border render 与 theme/mixColors 均可经公开导出类型检查；临时目录使用指向现有 node_modules 的 symlink，未改仓库链接 |
| `node --test extensions/beautify/__tests__/editor.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/__tests__/blocked-signal.test.ts` | 0，65 tests PASS，自然退出 |
| `git diff --check` | 0；目标任务原先为 untracked，另需检查三份 Markdown 内容及尾随空白，不能仅凭该命令覆盖未跟踪文件 |

问卷未 preload 的并发失败只证实临时 source-mode jiti 中可出现模块未完成，不据此断言真实 CLI 缺陷。最终问卷用例采用已安装 2.13.9 的实际 execute，不拷贝事件算法；custom UI 挂载/取消使用实际 SDK 方法，昂贵边界由临时 harness 提供。非交互路径未发终端 BEL。

### 委派离线事件检查与主会话复核

执行目录 `/tmp/editor-phase-preflight.7i2OZD/session`；完整命令环境为 `HOME=/tmp/editor-phase-preflight.7i2OZD/session/home PI_CODING_AGENT_DIR=/tmp/editor-phase-preflight.7i2OZD/session/agent PI_OFFLINE=1 node /tmp/editor-phase-preflight.7i2OZD/session/<script>`。main 已完整读取四份驱动与最终日志，核验真实断言、fixture 和公开/测试专用 API 边界。驱动在导入 SDK 前阻断 fetch/net/http/https，最终网络拦截次数为 0。

| script / 日志 | 退出码、失败关系 |
| --- | --- |
| `turn-contracts.mjs` / `turn-run-1.log` → `turn-run-2.log` | 1 → 0，最终 5 组 PASS；首轮 `tools: []` 是空 allowlist，未真正执行注册工具。改为公开 `noTools: true` 并强化 execute/isError 断言后重跑；首次局部 PASS 不作为工具执行证据 |
| `compaction-contracts.mjs` / `compact-run-1.log` → `compact-run-2.log` → `compact-run-3.log` | 1 → 1 → 0，最终 20 组 PASS；首轮漏 split-prefix 第三请求且限制取消文案；第二轮误将 aborted request preparation 当 provider 调用。按真实 trace/source 修正 fixture 预期后通过 |
| `supplemental-contracts.mjs` / `supplement-run-1.log` | 0，6 组 PASS：空内容、主 retry、abort、慢结束、串行批内空 Map、晚注册 before_compact |

### 已确定的设计结论

1. **展示接线可行，但未交付。** 公开 `CustomEditor.setWorkingStatusIndicator` 可接收宿主对象并装饰其公开 border render；实际 spinner 十帧/80ms 不因 phase/tick 重置。原生 setIndicator 可在 Asking 的必要模式切换停止/恢复动画；原生 dispose 停止 timer。dark/light 的主题样式及窄宽降级通过，未验证肉眼可读性或最终增强曲线。测试内部 constructor imports 仅为组件 introspection，产品使用公开参数类型，不深导入 StatusIndicator。
2. **问卷意图可行，Asking 可见体验阻塞。** peer 2.13.9 发出的 blocked 带 toolCallId；重叠等待、取消和挂载异常均有独立 release，优先按身份幂等匹配。实际默认 inline 问卷及标准 selector 均临时移除原 editor，因此原输入框边框的 Asking 不可见。需要用户接受“仅输入框仍可见时展示；问题占位时由原生问题 UI 表达”，或批准新的展示位置；尚未改 PRD 验收降级。
3. **精确压缩时间阻塞。** ExtensionAPI 无 compaction_start/end/summarization retry，Embedding 的 AgentSession.subscribe 不可凭空用于普通扩展。before_compact 晚于 start，success 早于 end，failed 晚于 end；晚注册 handler 约滞后 222.7ms，成功回调可延长结束 180ms。手动 too-small 无 before；二次 overflow 有无 start 的 end。receiver 可计“提示交付后耗时”，但不等于 PRD 要求的操作真正开始。需用户确认口径或另批精确接口方案，不访问私有 session。
4. **交接不能假定短暂。** 实际最后工具 end 到 turn_end handler 完成约 152.6ms，prepareNextTurn 到下一 turn 延迟 221.8ms，串行批内空 Map 可持续 222.7ms；最终消息到 settled 可延迟 405.4ms。设计改为 assistant 最终消息登记预期批次，最后一项完成进入无普通阶段展示的 prepare；批内空 Map 不结束 Tooling。turn_start 后准备仍属于 Loading，不声称 HTTP 已发送。
5. **主事件隔离仍成立。** 完整 stream 后才处理工具；并行/全局及工具声明串行、nested parentToolCallId、拒绝/异常/截断均核验。nested instrumentation 可有 provider events，但无主 turn/message_update。空 thinking/text 也会发 start/delta/end，必须检查非空生成证据，不能仅按事件名进入 Brewing。
6. **retry 不抢占。** 压缩/分支 retry 会换原生 indicator；组件验证保留 Retry/Branch Summary 文案与 cancel hint。生命周期不因 retry 替换重置；undefined 可能是交接，不能自动认定终态。自动 compaction_end 回调时 isCompacting 仍 true，手动则已清理，不凭 busy 猜生命周期。

### 未运行与启动结论

NOT_RUN：产品 phase reducer/controller（尚无实现）、完整 Beautify suite、pnpm check、真实 CLI/TUI/provider、在线模型、最终配色可读性、物理 IME、实际 input-history 插件、完整 reload/session replacement/late-wrapper/partial-install 新接线回归。已有 editor 回归不能替代新接线验收。首次并发 peer 懒加载故障没有真实 CLI 复现，不扩 scope 修外部插件。

### 验证后用户决策

用户选择保留原生问题 UI：仅原输入框可见时展示 Asking，被标准 dialog/inline 问卷替换时不新增状态行或改问题布局。用户选择 Compacting 从本次原生提示首次交付计时，不声称精确操作起点；retry 后重建不重置。PRD R1/R3、AC3/AC7 与 design 已同步。前述“阻塞”保留为验证过程事实，现已通过明确口径解决，不代表 SDK 新增能力。

当前规划与启动前可行性已收敛，可以在明确产品实施授权后执行 start。尚未授权产品实施、提交或真实 TUI，任务保持 planning。完整 controller 生命周期与上述 NOT_RUN 项仍须后续验证。

原始材料暂时保留供后续新接线复现和首次并发加载限制核验；本轮未清理，不声称清理成功。main 仅保留文字结论于本文件，无复制 raw trace。

## 实施进度与检查记录

- 用户明确授权后已 start，planning → in_progress；直接实施的 implement.jsonl 有意为空，start 使用 `--allow-empty-context`。check.jsonl 已补实际引用并派发独立 trellis-check。CLI 警告当前 main 与 base_branch 相同，不适合 PR/archive；本轮不做 PR/archive，不擅自修改分支。
- 产品第一版新增纯状态归并、公开 editor indicator 装饰及 session-owned 低频时间 tick，接入 Beautify 原 owner，更新 owning 用户文档。未修改 SDK/工具执行/TaskCoordinator/问卷布局。
- 检查环境 Pi 1.3.0、Node v24.14.1，`PI_CODING_AGENT_DIR=/tmp/editor-phase-implementation.vcyok6/agent`，link-sdk 0 new，不获取依赖；原始日志位于 owned `/tmp/editor-phase-implementation.vcyok6`。
- `pnpm typecheck` 首次退出 2：current 可空的严格类型错误；修后第二次退出 2：新增测试 harness 动态 SDK 方法未标类型。focused 首次退出 1：Node strip-only 不支持 constructor parameter property。改显式字段与类型化 fixture 后 focused 6 tests/退出 0、typecheck/退出 0。
- `node --test 'extensions/beautify/__tests__/*.test.ts' extensions/task-ui/__tests__/editor.test.ts extensions/__tests__/blocked-signal.test.ts` 首次 112/113、退出 1：既有 Task UI fake pi 缺公开 events bus。补 fixture，不改变产品要求。
- `PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.3.0/node_modules PI_CODING_AGENT_DIR=/tmp/editor-phase-implementation.vcyok6/agent pnpm check` 首次 1455/1458、退出 1：上述 fake bus、at-path fake bus、host-loader smoke 的旧“无 tool_execution_start”假设。补两份 fixture 的 bus，smoke 改为恰好一个本地 Beautify phase observer 及新增 teardown owner，保留无 legacy overview 的语义。
- `node --test 'extensions/beautify/__tests__/*.test.ts' extensions/task-ui/__tests__/editor.test.ts extensions/__tests__/blocked-signal.test.ts extensions/at-path-completion/__tests__/owner.test.ts extensions/agent-tasks/__tests__/loading.test.ts` 更新 fixture 后退出 0，自然退出；最终代码仍需独立审核后的重跑。
- 独立 trellis-check 完整读取材料/13 引用及实际代码，修正 wrapper 资源保留、locked restore 隔离、失败装饰 rollback、Asking reset/同对象 redelivery、轮次计时及压缩成功 clear/redelivery。main 完整读取最终 phase-state/status/tests 并核验实际修改与日志。
- 独立最终 focused `node --test extensions/beautify/__tests__/phase-status.test.ts` 9/9 退出 0，自然退出；broader 覆盖 Beautify、at-path、Task UI、blocked signal、实际 host loading 合同，177/177 退出 0，自然退出。final tsc 首次因新 redelivery fixture 缺本地方法类型退出 2，补声明后 `tsc -p tsconfig.json` 退出 0；没有之后产品改动。
- main 最终同上述环境执行 `pnpm check`，退出 0，1462/1462 tests、79 suites PASS；完整 suite 使用强制退出，资源自然退出证据来自 focused/broader，而非此命令。日志 `/tmp/editor-phase-implementation.vcyok6/check-final.log`。独立 lint 未配置。
- `git diff --check` 退出 0；检查 task Markdown/JSONL 格式与本地 docs 链接。评估 spec：公开参数/方法与 lifecycle/forwarder 合同已由现有 development/testing 规范覆盖，本轮不为功能新增 spec。
- 按 PRD 的已确认口径，自动化覆盖 AC1–AC7 的主事件/展示/计时/清理边界及 AC9 文档；AC8 实际 SDK editor/focus/undo 回归通过，但真实 TUI、物理 IME、实际 input-history plugin、在线 provider 和肉眼配色仍 NOT_RUN。没有把组件测试称为真实终端验收。代码阶段可验证并提交，最终视觉接受不自动完成/归档 task。
- 原始临时目录保留，原因是后续真实 TUI 与首次并发 peer 加载限制尚未验证；不清理或复制 raw 到仓库。

### 真实 tmux TUI 验证

用户随后明确要求 tmux 验证。使用既有 tmux 3.6a、Pi 1.3.0，未连接个人 server：owned tmux server `tmux -L phase-status-25372`，会话 `phase`，regular mode，初始 100×30、动态调整至 40×30 再恢复 100×30。完整 fixture 位于 `/tmp/editor-phase-implementation.vcyok6/tmux`：独立 HOME、PI_CODING_AGENT_DIR、cwd、session 和 ANSI log；用 `env -i` 明确 PATH/TERM/PI_OFFLINE，禁用 discovery/MCP/skills/themes/context files，仅显式加载 checkout 的 `extensions/beautify.ts` 和本地 scripted provider `/tmp/editor-phase-implementation.vcyok6/phase-provider.ts`。provider 是离线 fixture，不代表在线模型质量。

- 初次启动退出 0，实际屏幕确认 loaded extensions 为 `beautify.ts, phase-provider.ts`、编辑器 `❯` 和原生边框。首次 fixture 错误 `streams2.streamSimple is not a function`：临时 provider 将 streamSimple 设为 null；仅修 owned provider 为同一 stream 函数后重启独立 server，未改产品。
- 发送真实键盘输入 `show phase status`：capture-pane 条件循环捕获 `Loading`、`Brewing`，最终 `fixture reasoning`/`fixture response` 及空闲编辑器；driver 断言三者均出现，退出 0。capture text 为 `tmux/phase-final.txt`，ANSI 为 `logs/tui.ansi`（47,460 bytes）。
- 第二轮发送 `resize status` 后动态 resize 40×30：capture 确认窄屏 `── ⠋ Loading · 0s`、输入框和截短 cwd/footer；恢复 100×30 并等待最终 fixture response，退出 0。capture 为 `tmux/narrow-phase.txt`、`resized-final.txt`。这证明一次真实 resize 后的新窄宽 frame，不是固定宽度或组件模拟。
- 通过发送 C-d 正常退出；验证 owned Pi/tmux session 消失后仅执行该 unique `-L` server 的 `kill-server`，server 不再 list，退出 0。未触碰个人 server/process。

真实验证 PASS：Loading、Brewing、实际原生 spinner/边框、窄宽和动态 resize、正常关闭/cleanup。NOT_RUN：Tooling（fixture 未发 tool call）、Asking/实际问卷、Compacting 手动/自动成功/失败/取消、Retry/Branch Summary、dark/light theme 对比、fullscreen、物理 IME/鼠标、真实 input-history 和在线 provider。tmux 启动有 host warning `extended-keys is off`，本次普通 Enter/C-d 成功，不将 modified Enter 覆盖纳入结论。

## 提交与交付

已验证代码阶段 checkpoint：`b9fc1a0` — `feat(beautify): show main-session phases in editor status`。提交仅含本任务三份规划/task 元数据/role manifests、Beautify 产品与测试、三份集成 fixture 和 owning 文档，共 15 文件；无 raw 日志。提交后 scoped 产品文件干净，其他任务的并行修改保留。任务仍 in_progress，未进行真实 TUI、最终用户接受或归档。

阶段 checkpoint 记录 hash、exact commands、退出码、独立 review 与修复结果。最终对 PRD AC 逐项核证据，保留未验证/环境限制，不把公开接口阻塞标成通过。不自动 push/install/sync/reload/archive；验收与生命周期收尾另走用户授权。
