# 实施计划

## 授权与规划状态

用户授权创建任务与完善 planning，已确定固定 Ctrl+Shift+T、不可配置、完全隐藏与状态提示；本轮明确批准首次打开新实例、恢复隐藏旧实例及跨弹窗拉到最前这两项产品决定。用户已通过“可以”批准本方案实施、验证、独立审查及 scoped local commit；不授权依赖安装、push 或收尾。

- [x] 检查真实命令、组件、入口生命周期、文档与规范。
- [x] 确认首次打开与旧实例恢复的区别。
- [x] 确认前台弹窗存在时提升 viewer，并核对公开 SDK setHidden/focus/合成排序与输入分发。
- [x] 收敛 PRD/design，明确会话级监听与交互级 cleanup。
- [x] 用户确认最终实施计划。

## 执行路径与检查点

主会话实现一个可独立验收阶段：owner、按键、入口生命周期、测试与文档保持耦合，避免中间提交无法恢复的隐藏状态。由于涉及 task-browser 与扩展入口的生命周期接口，完成后安排 trellis-check 独立审查。

主会话已准备 check.jsonl 的实际规范引用（development/index.md、testing/index.md、development/widget-display.md 及相关 guides）；派发前核实引用与完整读取义务，角色默认只读源任务材料。独立审查已在共享源目录执行；输出置于本轮仓库外临时目录，禁止提交/安装/收尾。implement.jsonl 无实现派发保持为空，start 使用 allow-empty-context，不把空 manifest 的诊断描述成全量验证 PASS。

验证并独立审查通过后，主会话提交一个 scoped commit，不包含无关改动，不 push 或归档。

## 预计文件

- `extensions/trellis/lib/task-browser/command.ts`：command/raw listener 共用的 admission、open/present、toggle、临时反馈；必要时抽窄 owner helper。
- `extensions/trellis/lib/task-browser/component.ts`：必要的幂等外部关闭/dispose 与已有 hints；不重构渲染，不复制滚动状态。
- `extensions/trellis/index.ts`：支持项目会话监听安装与生命周期控制器接入，保留项目/runtime/source-authority 守卫。
- `extensions/trellis/__tests__/task-browser-toggle.test.mjs`（拟定）：fake-pi/handle 逻辑回归；必要时修改 project-activation fixture 的 onTerminalInput 能力与 session retirement 断言。
- `docs/extensions/trellis/tasks.md`：统一快捷入口、状态语义、前置行为、终端/模式限制；修正四页为 PRD / Design / Implement / Metadata。

## 顺序

1. 获批后刷新相关规范/指南和完整源/测试；再次检查 Git 与 task context，核实已准备的 review manifest，start 已获批任务。
2. 实现 factory activation 会话 owner、跨入口 admission 和上下文 generation；先确定清理责任，后安装 listener/custom。
3. 完成固定键 session raw listener：idle 打开、opening 去重、focused 隐藏、hidden 恢复、visible-not-focused 提升。关闭交互不注销会话入口；退休会话才注销。
4. 添加能力守卫、错误/迟到回调隔离、状态提示 ownership 与最小组件关闭接口。
5. 补逻辑测试和文档，运行针对回归及全量 checks，独立审查真实 diff、失败与 rerun；修复后重跑受影响检查。
6. 主会话最终 Git 审查并提交此阶段，记录 exact evidence 与未验证限制，不自动收尾。

## 回归矩阵

| 场景 | 预期 |
| --- | --- |
| idle 在编辑器或其它弹窗焦点下按固定键 | 新实例一次打开；不依赖编辑器快捷键分发 |
| opening 重复按键/重复命令 | 只有一次 admission/mount；不排队隐藏 |
| focused→hidden→visible | setHidden 序列与提示正确，同一交互 identity，无额外 custom mount |
| hidden 且问卷等持焦点 | 恢复并置前，不调用其它 overlay 的 done/取消接口 |
| visible 且其它 overlay 覆盖 | 调用本 viewer focus()；不是误隐藏/忽略 |
| 重新执行命令 | 恢复/聚焦旧实例，不切换成隐藏、不重复挂载 |
| 完全关闭后再次按键 | 新实例，旧状态不持久化；session listener 仍有效 |
| 普通字符/Esc/Ctrl+C | 原始监听不消费，原组件/编辑器语义保持 |
| Kitty initial/repeat/release | 初始按下一次动作，repeat/release 不再次开关 |
| legacy Ctrl+T / ESC | 不作为 Ctrl+Shift+T fallback |
| viewer 关闭/打开失败 | 撤销交互状态与资源，后续可重新打开；不删除会话入口 |
| layout await/factory/onHandle 迟到 | 已退休交互不挂载/发布/聚焦 |
| 旧 finally 晚于新交互 | 不清除新 admission/handle/提示 |
| 同 root 更换 manager 或 ID | 旧会话入口与交互退休；新 ctx 独立接受 |
| shutdown/reload 与可取消切换 | 最终退休清理幂等；before-switch 未完成不误关闭 |
| 必要能力缺失 | 不进入不可恢复隐藏，命令仍能退出，能力限制明确 |
| notify/setStatus/unsubscribe 抛错 | 其它 cleanup 继续，owner 不卡在 opening |
| 错误项目/runtime/来源或非 TUI | 原拒绝与支持项目能力注册边界保持 |

测试只增加 Trellis `.mjs` fake-pi/handle 逻辑，不新增真实 Pi host 挂载、overlay rendering、TUI 或菜单测试。fake handle 证明调用、资源归属与实例复用，不证明真实终端视觉/物理键盘/任意第三方组合；公开 SDK 源码证据证明前置接口可行，不能替代运行验收。

## 检查命令与结果

在本轮自建仓库外临时 agent 目录与已有 SDK 隔离下，不访问个人配置/凭据/会话，不下载依赖：

1. `node --test extensions/trellis/__tests__/task-browser-toggle.test.mjs`（如最终命名变化，更新记录；不 force-exit）。
2. `node --test extensions/trellis/__tests__/*.test.mjs extensions/shared/scroll-panel/__tests__/*.test.ts`。
3. `pnpm check`。
4. `git diff --check`、文档链接与按键/标签/限制核对。
5. 独立审查后修复并重新执行受影响 checks。

记录具体命令、环境、exit codes、PASS/FAIL/NOT_RUN、首个失败原因与 rerun 关系，不用最终 PASS 抹掉失败事实。输出在自建系统临时目录，不写 research/；主会话确认完成且无进程使用后，只清理本轮拥有的临时目录。

## 当前记录

- 用户批准后运行 `task.py start .trellis/tasks/11-04-task-viewer-toggle --allow-empty-context`，planning → in_progress，退出 0。CLI 提示当前 main 与 base_branch 相同，未来 PR/归档需另行处理；本轮不改变并行会话分支，不归档。
- 已实现 owner.ts 会话级监听与单交互 admission、命令共用打开路径、组件 dispose 与 hints、index.ts start/shutdown 接入；文档与逻辑测试已补充。
- 独立审查上下文 check.jsonl 已准备；本轮共享源目录，审查期间主会话不同时编辑被审查产品文件。

### 执行证据

环境：Node v24.14.1、pnpm 10.33.0，使用已安装 Pi 1.4.0 SDK；`PI_CODING_AGENT_DIR` 指向本轮自建仓库外临时 agent 目录。`pnpm typecheck/check` 的 `PI_SDK_DIR` 从现有 SDK symlink 实际位置计算，未下载依赖或同步个人配置。执行输出保存在本轮独占系统临时目录，最终核实后按 ownership 清理；以下记录不依赖临时文件才能理解结果。

1. `node --test extensions/trellis/__tests__/task-browser-toggle.test.mjs` 首跑退出 1：24 项中 23 PASS、1 FAIL。测试桩 deliverFactory 异步拒绝未按真实 SDK 转为 custom promise 拒绝，导致 component failed 未处理；不是产品挂载路径失败。仅修复 fake custom 的 catch → settled.reject。
2. 同一命令重跑退出 0：24/24 PASS，natural exit。覆盖首次打开、跨弹窗提升、同实例恢复、关闭重开、ordinary/Esc/Ctrl+C/legacy 不消费、repeat/release、opening 去重、迟到回调、manager/ID 退休、失败清理及缺失能力。
3. `pnpm typecheck` 退出 0；SDK linker linked 0 new of 7，无依赖获取。
4. 完整 Trellis/scroll-panel natural-exit suite 退出 0：410/410 PASS，87.56s。此轮覆盖最初实现与项目入口接入；审查后的 owner 修复由最终专项与全量重跑覆盖。
5. `pnpm check` 首轮全量未成功完成：reader 文件执行后剩余进程约 10 小时 CPU 为 0、日志不再推进，用户指出长时间等待后主会话立即停止该进程组。测试日志最终 1770 项、1769 PASS、1 CANCELLED，reader 文件报告 `Promise resolution is still pending but the event loop has already resolved`；管理工具终态 stopped/killed。不能记为 PASS。实际阻塞根因尚未复现，不将它归因于产品改动或测试环境；原 reader 文件和 reader 产品代码均未修改。`ps` 核实旧 PID 41882/41899/43694/59859 均已退出。
6. 独立 trellis-check 审查完整产品/测试/文档与所选规范，机械修复 command 拒绝路径的 notify/sendMessage sink 隔离，并补测试；其专项 25/25 PASS、strict tsc 退出 0、diff whitespace 退出 0。发现两个额外问题，用仓库外 fake-pi 探针分别退出 1：命令 root 校验提前返回残留隐藏交互；setHidden(true) 同步重入恢复后外层继续发布错误提示。
7. 主会话修复：所有 command/raw 入口 root/admission 校验统一到 owner.open 并绑定调用来源；present 增加 generation 与最终 hidden 核对，旧 presentation 不清除新提示。新增 root 缺失/失败、hide 中恢复、restore 中再次 hide 回归；`node --test --test-timeout=30000 extensions/trellis/__tests__/task-browser-toggle.test.mjs` 退出 0，28/28 PASS、natural exit（0.62s）。不是另一次独立审查，主会话承担修复闭环核实。
8. 原始 reviewer 两个失败探针用 `node --test --test-timeout=15000 --test-name-pattern=REVIEW <本轮临时目录>/review/command-root-probe.test.mjs` 重跑，退出 0，2/2 PASS（外层 process-group deadline 30s，实际0.6s）。没有弱化原断言。
9. 原停滞文件单独 `node --test --test-timeout=30000 extensions/trellis/__tests__/task-browser-reader.test.mjs` 重跑，外层 process-group deadline 60s；退出 0，37/37 PASS、natural exit，Node summary 0.30s。原停滞未复现。
10. 最终 `pnpm check` 在外层 process-group deadline 180s 下重跑（Node/package discovery 不变，新增 TMPDIR 指向本轮独占 tmp/）：strict no-emit typecheck PASS，全量 1773/1773 PASS、0 FAIL/0 CANCELLED；退出 0，外层79.2s、Node test summary74.99s。SDK linker linked0，无依赖下载。supervisor timeout 时只 TERM→KILL 本轮创建的进程组，本次未触发 deadline。
11. 最终 `git diff --check` 退出 0；check.jsonl 五个真实规范引用均存在；新增文件/任务文档无尾随空白并有末尾换行，文档 task-viewer anchor/固定键/四页标签核对通过。implement manifest 有意为空，不称全量 task validate PASS。

### 规范评估、留存与提交

会话/交互双层 ownership、source/ctx fencing、raw input 和 cosmetic failure 规则已有规范覆盖，本次没有修改 SDK 或建立新的共享接口约定，不新增重复 spec。固定按键与可见限制已进入用户文档。

本轮独占临时目录：`/var/folders/fx/bn7t1rq16xn7_66t233x_s1h0000gn/T/pi-task-viewer-toggle.ooZ33d/`。此前全量停滞的具体根因未复现，因此保留首轮全量日志、最终重跑日志与有限 supervisor/复现材料用于后续诊断，不声称临时目录清理完成。无本轮活跃 shell/Agent 仍使用该目录；未把原始日志或探针提交到仓库 research/evidence。

截至实现阶段提交，产品验收项已有逻辑/源码与回归证据，但真实 CLI/TUI、物理按键与第三方实际组合尚未验证。阶段实现已提交为 `c17dca8`（`feat(trellis): toggle task viewer with Ctrl+Shift+T`），后补 hash 记录为 `77b300b`，均未改写历史。追加真实终端验证见下节；仍等待用户使用验收，不自动归档/记录 journal/同步安装/reload。

## 用户授权的 tmux 真实 CLI 模拟验证

用户明确要求“你开 tmux 去模拟验证一下”，授权本轮隔离真实终端验证及本轮拥有的测试环境清理。本轮仅新增验证记录与最小证据，不改产品源码，不新增永久真实 host/TUI 自动化测试。

### 环境、命令与边界

使用已有 tmux 3.6a 和 Pi CLI 1.4.0，固定 dark 主题；所有控制命令都带独占 `tmux -L <test-id>`。创建仓库外临时 HOME、PI_CODING_AGENT_DIR、TMPDIR、项目和日志目录，使用 `env -i`，不连接个人 tmux panes、不继承认证/包注册、不安装依赖、不调用线上模型。

有效 CLI 参数：

```sh
pi --offline --no-approve -ne -ns -np -nc --no-mcp --no-session --no-tools --no-themes --use-theme dark --tui-mode <fullscreen|regular> \
  -e /Users/jyxc-dz-0101322/tools/my-pi-preset/extensions/trellis.ts \
  -e <owned-run>/fixture.ts
```

此外显式设置 `PI_OFFLINE=1`、`PI_TELEMETRY=0`、`PI_TUI_WRITE_LOG=<owned-run>/<mode>-writes.log` 和仅用于离线 fixture 的事件路径。临时项目通过源码初始化引擎 `apply(plan(root, 'TmuxFixture'))` 创建，并验证 runtime；填充 2 个测试任务，每页 100 行含 CJK/组合字符/emoji 的文档。没有项目包下载；缺少 fd、subagent_run 与模型的启动警告符合 no-model/offline 隔离方式，不影响浏览器命令。

tmux 设置 `extended-keys on`、`extended-keys-format csi-u`、`remain-on-exit on`。通过 `tmux send-keys -l` 注入 `\x1b[116;6u` 模拟 Ctrl+Shift+T，并注入 Kitty repeat/release 序列；普通 Enter/Right/Down/Escape/Ctrl+C 由 send-keys 驱动。使用有 deadline 的屏幕/事件条件等待而不是固定等待，整个矩阵设 120 秒上限；capture-pane 普通文字与 SGR 捕获、原始 ANSI 均先保存在独占仓库外目录。

用于遮挡的 fixture 是真实 `ctx.ui.custom` overlay 与真实 Input，通过 `/fixture-overlay` 或测试 F6 入口打开。它不是实际 rpiv-ask-user-question 或 pi-btw，不能把结果描述为任意第三方兼容验证。

### 首次失败与重跑

首次驱动退出 1，0 个浏览器场景完成：启动被临时项目的 trust confirmation 阻塞，条件等待 10 秒后超时；文字 capture 明确显示 Trust project folder，stderr 为空。此时浏览器测试尚未开始，不是产品断言失败。只修正临时驱动，加 `--no-approve` 忽略项目发现资源（仍显式加载本次源码）；初始化 runtime 没有修改。首次独占 server 已停止，主会话另用 ps 确认 PID 20490 已退出；初始报告的 pid_gone=false 是 kill-server 之前的采样，不是残留进程结论。

修正后首次矩阵退出 0，13 个 capture 场景 PASS。随后补充错误参数拒绝与显式命令恢复场景，最终完整矩阵再次退出 0，15/15 PASS：

| 模式/尺寸 | 验证结果 |
| --- | --- |
| fullscreen 100×30 | 快捷首次打开、进入 Design 并滚动、隐藏态编辑草稿、repeat/release 不展开、快捷恢复原 viewport、错误命令参数保持隐藏、命令恢复原 viewport、隐藏 viewer 前置到 fixture overlay 之上、overlay 草稿恢复：PASS |
| fullscreen 动态 100×30 → 80×24 | raw writes 确认新 frame 完成后恢复，仍在已滚动的 Design 页面而非 BETA-DESIGN-LINE-001 首页：PASS |
| fullscreen 80×24 | Ctrl+C 完全关闭后快捷键打开默认列表；F6 覆盖可见 viewer 后快捷键前置而非误隐藏；再次隐藏恢复 covered-draft：PASS |
| regular 80×24 | 快捷打开、隐藏后编辑 regular-draft、恢复；Esc 关闭后原 editor 草稿仍在：PASS |
| 退出与资源 | 两个 CLI 均正常退出 0，shutdown 事件存在，PID 与独占 server 均退出：PASS |

逐字节比对 `scrolled-design`、`restore-identical-viewport`、`command-restores-identical-viewport` 三份文字 capture 完全相同，首行文档 BETA-DESIGN-LINE-005、footer `11–36/201` 均一致。fixture 事件仅在主动 Escape 后出现 overlay-done，值分别为 overlay-draft 与 covered-draft；viewer 前置操作没有取消或提交 fixture。

### 留存、清理和未覆盖项

最终独占 server `tv-nmxPnY-24697` 已停止；CLI PID 24704（fullscreen）与 24917（regular）均经 ps 再次核实不存在，pane_dead=1、exit=0、shutdown event=true。保留一份最小、无凭据的恢复后文字终端画面，目的为支持阅读位置保留的使用验收：`evidence/tmux-restored-design.txt`，SHA256 `0c191eec8194c2a78c883905ee0b9bf3e17f8a93c3429b360824956937e2836c`。这是文字 capture，不是图像截图；不重复提交相同 before/after 或完整 ANSI 流。

在主会话核实结果、故障与重跑、PID 和 server 退出、最小证据已留存后，删除仅本轮拥有的 `/private/var/folders/fx/bn7t1rq16xn7_66t233x_s1h0000gn/T/pi-task-viewer-tmux.nmxPnY/`，包括临时 HOME/agent/project/tmp、驱动、原始截图与日志，确认路径已不存在。此前全量测试停滞的 ooZ33d 诊断目录未触碰，不把两轮清理混为一谈。

物理键盘 Ctrl+Shift+T、真实鼠标/IME、实际问卷/pi-btw 包、light 主题、40 列、进程内 /new 或 /reload 仍 NOT_RUN；不使用模拟 CSI-u 和 fixture 的成功替代这些证据。源码/测试未变化，复用已有效的 1773/1773 pnpm check；本轮只对任务记录、证据与引用/whitespace 执行最终检查。

## 验收与收尾授权

用户在收到实现、回归和 15 项真实 CLI tmux 模拟结果后明确要求“好的，收尾吧”，接受本次完成范围并授权归档、清除绑定、记录 journal 及对应本地提交。产品提交 `c17dca8` 后仅有任务记录/证据更新（`77b300b`、`ed3bc6f`），产品和测试输入没有变化，以上验证仍有效；工作树与 staged scope 干净。

本任务从创建到实施一直在 main 上直接完成，没有独立 feature branch、PR 或 push；branch/base_branch 同为 main、pr_url=null。因此采用原生 `task.py archive <task> --skip-branch-validation` 的明确非 PR 归档路径，不修改或虚构分支 metadata。归档只涉及当前任务的源/目标路径，无 children、managed worktree 或目标冲突。按项目默认开启的 session_auto_commit 执行归档与 journal，不包括无关源码或其他任务。

所有新材料已复核：只保留 PRD、设计、实现与验证记录、角色 JSONL、task metadata 和一份必要的文字终端证据，不新增 raw logs/research 报告。成功 tmux 验证的独占临时目录已清理；首轮全量测试停滞未复现的诊断目录仍按上述原因保留，不声称已清理。未覆盖的物理键盘/第三方真实组合等限制保持不变，收尾不授权个人安装同步、reload、push 或历史改写。
