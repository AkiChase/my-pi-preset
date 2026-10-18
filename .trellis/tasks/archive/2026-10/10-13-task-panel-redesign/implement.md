# 实施计划

## 当前状态与门禁
- [x] 已核对当前源代码、共享滚动模块、Widget Display 及先行子任务最终验收；不将先行工具展示交付误认为 Panel helpers 已交付。
- [x] 用户确认列表/详情滚动条常驻；概览最多五个根任务，小终端缩减并提示隐藏数量。
- [x] 父任务收拢为唯一计划，children 已清空；原 Panel 子任务解除关联并迁至 merged/10-13-task-panel-overview 保留追溯，退出根级待办；已归档 presentation 只保留文档引用，不修改历史归档。
- [x] 最终方案呈交并获明确实施批准：用户认可三个阶段实施、检查及本地阶段提交；不自动安装/同步/reload/push/归档或运行真实终端/provider。
- [x] 执行前 Git 复核：产品文件干净，已有 Panel 规划/合并材料和两个独立规划任务保持；lockfile 镜像任务已归档至 HEAD 110d540。本机 Node v24.14.1，node_modules 存在；测试另行隔离并核实 SDK。
- [ ] 刷新 selected role JSONL：主会话直接实施不需要 implement manifest；跨模块高风险阶段选择独立 check，派发前完整准备其实际上下文。不把旧 research 观察当完整注入。
- [ ] 真实终端/provider 操作若未获批准，保留 NOT_RUN；不能用 fixture 替代物理滚轮与安装宿主验收。

## 执行安排
建议主会话直接实施，独立 check 审查跨模块投影、overlay/lifecycle 与 widget 集成。各阶段验证、检查实际 diff 后立即由主会话 scoped commit（实施批准包含阶段本地提交）；不累计到最终一次提交。Agent 不提交。后续若需要托管 worktree，按协议 preview/批准 prepare，不自动创建或临时隔离。

### 阶段 1：展示与真实树模型（AC4–5）
- kind-aware 可读标题、状态圆点、duration/tokens、安全宽度与连续 selected 背景。
- 核对 Agent/Workflow description 投影，补 workflow description，处理 shell 空白回退；不重做已存在的 bash name 传递。
- model 树线/后代数量、折叠选择 reconciliation、orphan/cycle/retention/final pin。
- 保留 TaskSource/公开身份与 token accounting，主核 diff 和跨模块独立审查后阶段提交。

定向自然退出：task-ui suite、受影响 agent source/process source 测试；直接查找现有文件补充精确路径，不能假设未创建测试名。

### 阶段 2：全屏列表/详情与原生滚动（AC1–3）
- owner 预加载共享 native layout，overlay 安装 onHandle 与 shutdown 重入 fence。
- 单一 list/detail interaction，Agents/Processes 上下分区；两处独立常驻 ScrollView、VStack、固定 header/footer、满终端背景。
- 复用 wheel bridge，正文/边界 containment；不强开 Regular mouse，不复制 Task viewer section/Ctrl+C。
- Enter/Esc、树、Home/End/jk、x/c/global detach，移除旧双栏/Tab/PageUp/PageDown/manual slice/updateLayout。
- 渲染无 detail I/O；元数据/唯一 bounded selected preview 缓存、定时刷新不拉回、返回/resize/变化位置收敛。
- 独立审查实际 owner/model/panel；定向自然退出与 TypeScript 后阶段提交。

```sh
node --test --test-concurrency=2 extensions/task-ui/__tests__/*.test.ts extensions/shared/scroll-panel/__tests__/*.test.ts
```

### 阶段 3：只读概览、hint 移除与集成（AC6–8）
- Widget Display 声明 Agent overview 槽位及 client；root metadata、最多五项、小屏预算/hidden count、expiry/空态/主题/reset/shutdown。
- 删除 Process hint renderer/专有字段/接线和 foreground_hint 槽位；保持 quick-completion/partial 及 source timer 行为。
- 底栏/Panel 真实 waiting 与全局配置入口，回退 /task-detach。
- 更新 docs/extensions/task-composition.md、Widget Display 文档/相关 spec 与真实 provenance，用户 docs 不加入 Agent 工具调用教学。
- 独立审查 lifecycle/执行不变性、最终 AC/当前 diff；验证后阶段提交。

```sh
node --test --test-concurrency=2 extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts
node --test --test-concurrency=2 extensions/shared/widget-display/__tests__/*.test.ts extensions/__tests__/widget-*.test.ts scripts/pi-manifest.test.mjs
node --test --test-concurrency=2 extensions/agent-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts
pnpm check
git diff --check
```

## 验证环境与证据
命令仅是计划，当前未执行产品测试。依 .trellis/spec/testing/index.md 使用已有 SDK/依赖，整个测试调用隔离 PI_CODING_AGENT_DIR，必要 HOME；COREPACK_ENABLE_NETWORK=0，不访问个人配置、不安装或获取依赖。原始输出放 owned 仓库外临时目录，最终在本文记录命令、环境、exit code、失败原因/重跑与 NOT_RUN，不存 raw 到 research/evidence。

pnpm check 全量使用 force-exit，不能证明自然生命周期；受影响 focused suite 必须无 force-exit。执行前核实 SDK link helper 与当前脚本，不照旧命令假称通过。

实际宿主验收需经授权后覆盖 installed bundled Pi 的 regular/fullscreen、全屏背景、长列表/详情、resize/theme、Enter/Esc、编辑器焦点/文本、Fullscreen 滚轮正文与边界不穿透及关闭恢复。fixture 不能证明真实鼠标、终端视觉、在线 provider 或任意插件组合。若暂不授权，报告验收缺口，不称任务完全完成。

## 回归重点
- 每个 kind/title/status/waiting/executionMode、中文/ANSI/极窄宽度；workflow/agent 根统计不重复求和。
- 层级树/折叠隐藏选择、active descendant retention、根终态四秒/selected final preview、源移除/新 run。
- overlay setup 取消不关闭其他 interaction、done 一次、sink 同步重入、迟到 callback、timer 自然退出。
- 概览最多五根项/hidden count/小屏，中心不可用不 bypass，无 detail 读取/输入拦截。
- 多 foreground/background retrieval waits，全局 detach 不改变原 PID/执行/结果消费；selected stop 仍独立。
- hint 删除后超过两秒无旧 widget，Process 时钟继续更新，无 quick-completion/partial/通知/日志/Trellis 环境回归。
- shared scroll/widget 消费者、既有工具展示/handling clock、Beautify/editor/管理工具兼容。

## 阶段 1 实际检查记录
主会话直接实施，独立 trellis-check 审查并 scoped 修复。展示 helpers、kind-aware 标题、Workflow description 投影、Process 空白名称回退、树线/后代计数/折叠选择 reconciliation 已完成；未提前实施全屏/概览。

环境：Node v24.14.1、已安装 SDK 1.3.0/linked node_modules；PI_CODING_AGENT_DIR=/tmp/panel-redesign.Bqxo0J/agent、HOME=/tmp/panel-redesign.Bqxo0J/home、PI_SDK_DIR 指向已安装 release node_modules，COREPACK_ENABLE_NETWORK=0。原始日志在本轮 owned /tmp/panel-redesign.Bqxo0J。

- 首轮 `node --test --test-concurrency=2 extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/source-view.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts`：exit0，70/70，自然退出；直接 tsc：exit0。
- 独立审查修复长标题吞折叠 count、结构空格/深树分支、SGR reset 断背景、刷新 reparent/间接 cyclic 折叠隐藏 pin；增加四个回归。审查后同 focused 命令 exit0，74/74，自然退出；`./node_modules/.bin/tsc -p tsconfig.json` exit0。
- `pnpm check`：exit1，Corepack 在隔离 HOME 下尝试解析 pnpm，网络禁用阻断 npm registry 访问；检查尚未开始，无下载，不记为产品断言失败或 PASS。
- 直接已有入口重跑：`node node_modules/typescript/bin/tsc -p tsconfig.json && node --test --test-concurrency=8 --test-force-exit 'extensions/**/__tests__/*.test.ts' 'extensions/**/__tests__/*.test.mjs' 'scripts/*.test.mjs'`：exit0，1476/1476；等价覆盖 strict/full suite，但没有运行 link helper（已核实现有 SDK 链接）。全量 force-exit 不证明自然清理。
- `git diff --check` exit0。独立审查日志 focused/typecheck/final.diff 主会话已核验。

保留已知诊断：focused 有5次 `offStart is not a function`，来自 HEAD 已有 sdk-runtime.test.ts fake pi.on 未返回 unsubscribe 与 widget-display/client.dispose 的组合；本阶段不修该 fixture，不称无 cleanup 诊断。阶段3触及 widget/hint 时重新评估。真实终端/installed mounted overlay/provider NOT_RUN；当前 Panel 仍旧双栏，完整换行详情属于阶段2。无独立 lint 脚本。

阶段 1 checkpoint：2a8d466（feat: unify task panel presentation and tree selection），含耦合产品/测试及已批准 Panel 规划收拢材料，未纳入两个独立规划任务。当前分支 task/task-panel-redesign（由获批实施创建，本任务共享源执行、不创建 worktree）。

## 阶段 2 实际检查记录
委派 trellis-implement 实施，另一个 trellis-check 独立审查；main 核验实际 panel/owner 差异及最终日志。全屏 list/detail、上下分区、常驻 native ScrollView、wheel containment、键盘/滚轮独立位置、完整换行 metadata/有界详情和 onHandle/await fencing 完成。render 无 detail I/O，源刷新同步重入合并并校验 selected identity。

首次 focused exit1：旧 fixture 将 native layout 自带的 OSC hyperlink-close 误作外部控制；调整为区分 host reset，仍检查外部 OSC/control，重跑87/87 exit0。首次 tsc exit2：process monitor-session fixture 直接构造 Panel 缺 layout，子实施因路径范围停报；main 同步同一构造契约（无产品范围扩大）后复验。

独立审查发现并修复 source 同步重入递归/旧 detail 覆盖新选择、普通窄屏底栏截断 selected/global 操作提示；新增重入、30/40/60/80列、空 Agents 分区实际行定位与 footer wheel 测试。修正 onHandle 注释，不假称当前 SDK done 必然关闭 topmost；保留兼容 setup fence。

最终命令（同阶段1 Node/SDK/隔离配置）：
- `node node_modules/typescript/bin/tsc -p tsconfig.json` exit0。
- `node --test --test-concurrency=2 extensions/task-ui/__tests__/*.test.ts extensions/shared/scroll-panel/__tests__/*.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts extensions/process-tasks/__tests__/monitor-session.test.ts` exit0，135/135，自然退出；focused 无 offStart 诊断。
- 同阶段1直接 tsc+配置全量Node forced-exit suite exit0，1483/1483。未重新调用 Corepack 阻断的 pnpm check，未运行 link helper（已核实现有链接）。
- `git diff --check` exit0。原始实现/审查输出在 stage2-implement/stage2-check 外部目录。

sdk-runtime fake pi.on 已补实际 unsubscribe，原五次诊断消失；full 仍有2次同类诊断定位到 process waits.test.ts fake pi.on，未扩范围修。真实终端/installed bundled overlay/物理wheel/provider NOT_RUN，不以fixture冒充AC2/3全部验收。阶段2 checkpoint dd44fcc（feat: add fullscreen native-scrolling task panel）；阶段3尚未开始。

## 阶段 3 高度边界阻塞（未修改产品）
实施者按授权边界停报；main 已阅读 height-boundary-blocker.txt 及 widget-display owner/client 核验。当前 Component 只提供 render(width)，Widget Display 没有宿主实际分配高度；Fullscreen SDK dock 将 editor/widgets/footer 共同 shrink，widget/footer minSize=0。按 terminal.rows 主动缩减只能是保守行数预算，不能保证宿主后续裁剪仍保留 hidden count/不挤 footer。

阶段3本次未写产品、未运行测试；无自动修改中心owner/SDK或增加内部兼容接口。用户已认可公开 widget 路径：按终端总高度保守缩减，预留 hidden count，接受极端拥挤时宿主进一步裁剪及 hidden count/footer 不保证始终可见。不增加实际分配高度的内部兼容入口；阶段3按此继续。原始只读证据 /tmp/panel-redesign.Bqxo0J/stage3-implement/height-boundary-blocker.txt 保留。阶段1/2已提交不受影响。

## 阶段 3 实际检查记录
用户认可高度限制后继续委派实施，另派独立 trellis-check；前轮只读 blocker 保留，无产品部分写入。恢复旧agent调用返回 Agent not found，随后通过 trellis_dispatch 新角色重新读取材料执行，无绕过绑定。

已实现 root-only belowEditor 概览：中心 agent_overview 槽/client、最多五任务行+hidden count、终端总高度保守预算、四秒终态保留、needed-only clock/expiry、reset/shutdown/source/setter 重入 fencing。删除 Process hint.ts/专有slot、字段和show/clear/reset接线；保留2秒partial窗口、共享source ticker、原PID/detach/results/notify/环境行为。底栏/Panel显示真实wait数量与全局入口。中文docs与provenance同步；main更新英文 widget-display spec，明确公开宽度接口及用户接受的极端裁剪限制。

实现首次focused exit1（446/448）：overview fixture误拒host SGR reset、editor fixture缺sessionManager；修正后448/448。新增reset测试首次fixture触发顺序错误，修正后暴露真实旧footer空态未清除；owner加statusKnown后6/6。实现tsc exit2是readonly theme/fixture类型，修复后strict0，450 task/process、41 widget、392 agent/runtime/beautify自然退出，1477 full forced通过。

独立审查修复发布失败清掉所有timer导致swept终态metadata无限保留：失败只停视觉clock，保留有限expiry。补实际中心sink失败、同activation同identity reset、footer sink失败独立性、resume根自身lifetime tokens/current duration；用临时内存loader恢复缺陷的probe exit1确认负例能捕获原错误，最终真实代码通过。审查首次tsc exit2为新增负例readonly数组声明，修正后重验。

最终验证（同阶段1/2Node24.14.1、SDK1.3.0、已有link、隔离HOME/agent、networkoff）：
- `node node_modules/typescript/bin/tsc -p tsconfig.json` exit0。
- `node --test --test-concurrency=2 extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts` exit0，452/452，自然退出。
- `node --test --test-concurrency=2 extensions/shared/widget-display/__tests__/*.test.ts extensions/__tests__/widget-*.test.ts scripts/pi-manifest.test.mjs` exit0，41/41，自然退出。
- `node --test --test-concurrency=2 extensions/agent-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts` exit0，392/392，自然退出。
- 配置全量 `node --test --test-concurrency=8 --test-force-exit 'extensions/**/__tests__/*.test.ts' 'extensions/**/__tests__/*.test.mjs' 'scripts/*.test.mjs'` exit0，1479/1479；forced不证明自然清理。数量较阶段2下降因删除hint专有suite，并新增overview负例，不删执行合同覆盖。
- `git diff --check`/相关docs本地链接/manifest引用存在性通过。没有独立lint脚本；pnpm check未重试既有Corepack阻断，link helper未运行（已有SDKlink已核实）。最终日志无offStart诊断，故障注入日志不等于产品失败。

main已核验overview/owner/tests、实际process执行路径diff、docs/spec与最终日志；原始证据仍在 /tmp/panel-redesign.Bqxo0J/stage3-implement 和 stage3-check，含首次失败/defect-probe，不入repo。真实installed bundled terminal/物理wheel/视觉IME/provider NOT_RUN。阶段3 checkpoint 10c361f（feat: add read-only agent overview and unify wait hints）。

## 真实安装宿主验收记录
用户明确批准隔离真实Pi终端验收，不含在线provider/个人配置。独立trellis-check在owned /tmp/panel-redesign.Bqxo0J/terminal-validation 使用 installed bundled Pi1.3.0、Node24.14.1、tmux3.6a执行；main完整读取report/主矩阵/补充矩阵及实际pane/ANSI/启动脚本/清理证据，未发现确认产品defect，未改产品。

启动使用每次唯一 `tmux -L panel-validation-<driver-pid>`；CLI `env -i` 显式PATH、临时HOME/PI_CODING_AGENT_DIR/cwd/session、PI_OFFLINE=1、PI_TELEMETRY=0、TERM=xterm-256color，`pi --offline --no-extensions -e <checkout>/extensions/widget-display.ts -e <owned>/fixture.ts --no-mcp --no-skills --no-context-files --no-prompt-templates --no-themes --no-tools --use-theme dark|light --tui-mode regular|fullscreen --session-dir <owned>`。fixture导入真实当前TaskCoordinator/Lifecycle/UI owner/controls/editor，只提供synthetic metadata，不运行full composition/backend或模型。已核实installed terminal支持PI_TUI_WRITE_LOG。

最终主driver exit0，六组 regular/fullscreen×140 dark/80 light/40 dark；补充driver exit0，两组fullscreen140 dark/40 light。真实宿主加载、全屏隐藏底层编辑器文本、常驻native scrollbar、真实多级树折叠、Enter/detail/End/Esc返回、完整CJK/ANSI清理命令与阶段、80×24→40×15→12×3→恢复动态resize、根概览五项/hidden、空态、重复开关、关闭后原文本及追加FOCUS输入均PASS（文本/ANSI证据，不是像素截图）。Fullscreen SGR输入验证正文wheel、刷新不拉回、选中identity不变、header/footer边界消费PASS，明确为 simulated terminal mouse input，不是physical human mouse。

首次主driver exit1是fixture注册宿主保留Ctrl+O/Ctrl+B；改为真实产品Shift+Down及Ctrl+Shift+B。第二次窄屏等待完整grandchild title错误，按实际安全截断后的树分支判断；第三次六组成功。补充前三次失败分别是详情正确保留End位置（reopen需Home）、Home确保选中root而非heading、40列耗时变化不应比较整行；修fixture稳定identity断言，第四次通过。初始异常run未完成normal-quit证据，不记PASS；最终六+两run均/quit exit0、有source disposal/session shutdown标记。main核验最终PID全部消失、独立server全部no-server，无owned后台执行残留。原始失败/重跑材料外部保留，不复制repo。

NOT_RUN：physical human mouse、像素/人工视觉/物理IME、任意插件组合、online provider、full composition真实bash>2s/混合wait/detach/reset/reload（已有自动化定向覆盖，不称此次terminal覆盖）。本次无新增产品，因此复用最终严格/自动化检查，不机械重跑。

## 最终验收缺口
三个产品阶段及独立审查、静态/自动化验证、上述真实installed终端脚本验收已完成。用户明确接受physical human mouse及人工视觉未运行等披露限制，批准合回main和归档收尾；不冒充完全物理验收，不含同步/reload/push。main以ff-only从faf4841快进至8dffd29，产品与测试inputs不变，复用有效最终验证，无冲突不机械重跑。

main已核验本轮raw/矩阵/失败重跑/启动及PID/server清理证据，最终ps确认无进程使用owned目录后，定向删除 /tmp/panel-redesign.Bqxo0J 成功；仅本轮原始日志/fixture/临时配置，未动历史材料。所有关键命令/环境/结果/失败原因和验证限制已在本文自包含保留，不依赖已删除临时链接。两个独立planning任务未纳入提交、未修改；task/task-panel-redesign分支保留，无worktree创建或删除。

## 尚未运行与材料维护
本轮只维护现有规划与用户批准的合并关联，无产品测试、真实宿主测试、派发、start、commit 或 archive。旧 research 保留原文作为历史观察，不迁移/清理；现有角色 manifest 需执行前刷新，不能宣称 context validation 已通过。原 overview 材料在 merged/ 下，原 planning 值是合并前历史状态；meta 明确 merged_into/disposition，根级待办已退出，不伪造 completed。
