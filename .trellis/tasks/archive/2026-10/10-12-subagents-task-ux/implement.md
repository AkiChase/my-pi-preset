# 实施计划

## 执行门槛

核心实现、验证与文档收尾已完成，产品提交`fe8d0f6`。用户随后明确批准finish/archive与日志提交；本任务正式完成并归档。阶段0–4的进行中/待审查/旧UI保留等说明均为当时历史快照，当前以阶段5、[final-acceptance.md](research/final-acceptance.md)与[commit-plan.md](commit-plan.md)为准；不因历史行重开实施或全量审查。

用户已在最终规划评审之后明确批准实施，并要求分阶段使用不同 agent，避免一个 agent 包办。任务已于本轮 `start` 为 `in_progress`。用户随后批准调整推进方式：保留已验证后端，不再为即将删除的旧UI独立修补/反复全量审查；把3B2剩余窄修与阶段4核心面板合成完整切片，删除旧UI后集中验收G3/G4。不同切片使用新agent，切片内先定向验证，完整结果再全量检查与独立审查。主会话核对实际diff；不得在实施agent内递归委派。

实施前重新读 [prd.md](prd.md)、[design.md](design.md)、[decisions.md](research/decisions.md)、当前 spec 和实际 git 状态。现有其他会话可能更新规范和 monitor 相关代码，不覆盖其工作。

## 组织方式

保留一个任务，分阶段验收：本次要求的是同一个任务交互结果，加载所有权、后端 detach 和共享 UI 强耦合，不为机械目录重命名单独创建子任务。每阶段通过测试门后再进入下一阶段，不并行写共享入口、后端核心或面板文件。

如 loader 验证发现必须维护一份新的 build/dist 或改动 SDK 行为，停止并重新评审设计，不能在这个阶段悄悄扩大范围。

最新基线：相邻 monitor-wake 已在本轮前完成并归档（`85c6189` 实现、`db22872` 归档），其新数据流/停止契约见 `.trellis/spec/preset/monitor-contract.md`，已补进两份 JSONL；不得 vendor/改名时回退到早期研究描述的旧 monitor 行为。

## 阶段 0：基线与运行验证

- [x] 保存当前 git diff/未跟踪文件清单；确认最新 monitor-wake 工作边界，避免机械改名覆盖其逻辑。
- [x] 建立无个人配置的检查环境；运行当前检查作为基线，失败先区分既有问题与本任务新增问题。
- [x] 实际核验 `0.20.0` 源 artifact、MIT notice、gitHead、integrity；复制完整运行所需源码前记录布局。
- [x] 验证源 TS 经 pi loader 和 workflow worker 入口的运行方式、`.js` 到 `.ts` 引用、node:test 可测试边界。真实root/child loader、inline worker返回/RPC/abort已运行。
- [x] 确认 SDK/TypeBox 由 host 提供，croner/nanoid 是实际运行依赖；离线测试 mock 模型、调度和 worktree 执行，不启动真实 agent。

**门 G0 已通过**：真实host加载和worker运行可用，无新build/dist；完整检查331 tests，定向无force-exit 5 tests通过。

## 阶段 1：Vendor 与结构整理

- [x] 将 `extensions/bg-tasks/` 移为 `extensions/process-tasks/`；保持进程执行逻辑和 pretty bash 组合，不夹带无关改写。
- [x] 将 subagents 运行源码置于 `extensions/agent-tasks/`，保留来源许可和代码所有权记录；不复制无用 dist 作为第二运行源。
- [x] 建立唯一顶层composition，维持single bash/pretty和root/child guard；同一task-ui控制层将在2A创建并注入，不以dummy实现占位。
- [x] 更新 imports、相关测试、package runtime/peer/dev 依赖和 manifest。preset packages 移除 upstream，conflicts 防重复。
- [x] 更新 `scripts/pi-manifest.test.mjs` 和 sync 离线测试，检查唯一工具注册、正确 entry/配置声明及 dry-run 计划，不执行真实 pi install。

**门 G1 已通过（foundation）**：最终strict/full检查331 tests通过，实际root/child注册、pretty参数/renderer、无模型worker测试通过。README/provenance增量同步；shared coordinator/API注入属下一阶段，旧UI/input暂不宣称已替换。

## 阶段 2：Task 读模型和等待协调

为避免单个agent覆盖两套执行引擎，本阶段分成顺序2A/2B，契约见 [stage2-contract.md](research/stage2-contract.md)：2A新agent负责task-ui核心/wait leases与process接入，2B另一新agent负责AgentManager/new/resume/startup/retrieval/pools与agent source。2B采用2A实际API，不重新发明第二个coordinator；每段结束均先实际检查再继续。

- [x] 定义 source/task/run 身份、父子归属、状态、执行模式、等待状态、统计、可用操作和不可变快照。
- [x] 两后端提供独立 adapters：进程日志/停止；agent 对话/workflow 状态/停止。UI 不持有后端 mutable records、controllers 或 session 全生命周期。
- [x] 统一所有 foreground wait 注册与释放，覆盖 bash、前台 Agent、新建/排队/worktree-startup/resume、jobs attach 和 get_subagent_result。
- [x] AgentManager queue/start/run parent signal 必须可解除；detach 不停止原实例且不能被旧父信号随后误杀。
- [x] 完成和 detach 同时发生时，只选择一次结果归属；后台通知/inline 消费/等待取消不能丢失或重复。
- [x] Foreground tool 返回后台 ID 时继续后端 activity/transcript 跟踪；不得执行旧 finally 的“完成”清理。
- [x] 明确 pool admission 与运行计数转换：已经运行的 agent 不因后台池满被重启/杀死；排队转后台按后台队列 admission 处理，计数 release 必须幂等。
- [x] 删除普通消息输入触发 detach/abort/resubmit 路径；保留 native Pi 处理和定向 agent 消息功能（2A进程移除，agent现有mention路由未改）。

### 阶段 2A 实施与验证（已完成限定范围，G2整体未通过）

- [x] 新建 `task-ui/types.ts`、`coordinator.ts`：namespaced source/task/run、immutable views、finite capabilities、subscriptions、launch/retrieval leases；完成／detach／interrupt／dispose只胜出一次，signal和计数清理幂等。
- [x] composition 创建唯一 coordinator 注入 process；agent factory 增加 typed optional options，仅预留2B接入。生产不创建第二实例；直接 process fixture 可创建 scoped local coordinator。
- [x] process source 提供冻结 foreground/background/pending/terminal views、有界detail和silent stop；mode与waitCount独立，revision覆盖状态与wait变化。
- [x] bash 首次await前登记launch，早期手动detach不等2s；旧父signal同步解除，真cancel停止。保留timeout与pretty输出；foreground终态留存metadata/log，统一exit owner释放hooks，promotion不重复count。
- [x] jobs attach登记retrieval，已abort立即结束；两个wait独立抑制；wait:false不说running已finished／不消费。completion-d detach竞态取消后补考虑terminalnotification；monitor只保留已构造boundedpayload，不改source/wake/buffer，不stop刷尾。
- [x] 删除普通inputhandoff／abort/resubmit；不注册process input拦截，保留helper仅continue；rootOnlyEvents childguard断言未修改。
- [x] task-ui.json独占两条公共chords；composition只注册一次 `/bg`／`/tasks`，删除process重复入口与`/bg-list`；diagnostic保留。过渡processpanel含fg行/mode/wait并在内部处理sharedbgchord，不称最终UI。downOpener保留false/inactive。
- [x] README／processprovenance／适用spec同步；[stage2a-handoff.md](research/stage2a-handoff.md)列出2B实际import与API，implement/check JSONL纳入。

实际检查（真实Pi 1.1.0 SDK目录、临时PI_CODING_AGENT_DIR，无个人配置／模型／安装／reload）：

- `pnpm check` 最终 strict + **339/339** tests通过；日志 `/tmp/stage2a-check-final2.log`。此包命令自身使用force-exit，不能作为自然退出证据。
- `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts` 不带force-exit，**317/317**通过，正常退出；日志 `/tmp/stage2a-noforce-final2.log`。其中vendor当前6项含真实同／不同cwd及overlaprootloading与worker；childguard修复属其他agent，未重写测试断言。
- 新core+waits定向不带force-exit **23/23**通过；包含setuprollback、callbackfailure、realprocess与可控exit竞态。
- `git diff --check`、`task.py validate`通过（两份JSONL各18条）。

失败历史如实保留：一次未提供PI_SDK_DIR导致link-sdk失败；并行childguard修复期间Promise.withResolvers暂不符合ES2023，待其修复后strict通过；旧foreground仅background计数断言更新为统一executionmetrics；新增UIsetupfailurefixture起初未实际触发diff-before-write，导致longrunning等待，已只终止该测试PID，修正强制首写后targeted及full自然退出通过。无buildtree或SDK修改。

后续2B继续agentqueue/startup/resume/pool/source/notification；阶段3全后端epoch及生命周期，阶段4最终UI和editor。本段不勾选G2整体，不宣称全AC2／AC9已验收；真实用户TUI未执行。

### 阶段 2B 实施与验证（限定 backend，已通过主会话与独立复核）

- [x] AgentManager stable per-run terminal/controller/parent link，从 queued/startup 到失败均可等待；new/resume revision，拒绝同时重入，resume 同 session。
- [x] 注入的同一 coordinator 接入 Agent/new/resume launch 与 result retrieval；无第二 production UI/coordinator，无自动定时 detach。
- [x] running 前台原 run 转移当前后台 pool lease，允许 transient 超限；queued 前台原 admission 改后台并释放 legacy gate；owned child 不占顶层 pools。
- [x] completion/inline consume、active wait suppression、delivered 分开；held individual/group nudge 重查 current run，不因 retrieval cancel 永久吞通知或重复交付。
- [x] frozen all-agent/workflow source、真实 parentRun/owner、token/tool/model/phase/progress、有界 transcript/memory preview、same-run scoped stop；active owner children 与未消费结果 sweep 保留。
- [x] typed fake runner/startup 运行真实 manager/factory/source 与 workflow host/worker，无模型/git/network；保留 child-context 与所有 hard loader assertions。
- [x] README/provenance/适用 spec 与中文 [stage2b-handoff.md](research/stage2b-handoff.md) 同步，列出 phase3/4 未完成点。

阶段 2 总复选项与 G2 是否关闭由主会话 review 决定；这里不将完整 session epoch/最终 UI 算成完成。最终isolated `pnpm check` strict +369/369；agent noforce27/27、三模块noforce347/347自然退出；diffcheck/taskvalidate通过。失败历史和确切API见handoff。

**门 G2 已通过（限定读模型/等待/结果归属）**：主会话最终strict/full393/393、agent50/50、三模块371/371，无forceexit定向正常退出（`/tmp/pi-bg/bweo7yd11.log`）。mixed-waits实际shell+typedfakeagent同coordinator四个launch/retrieval lease一次detach，原PID/session/log/output连续。独立review先发现4项修复，再发现2项resume边缘问题；定向修复后review `e946b60a-f6da-4c2` 最后16/16正常退出确认全关闭，无新增blocking/should-fix。具体证据见 [stage2b-fix.md](research/stage2b-fix.md)、[stage2b-fix-review.md](research/stage2b-fix-review.md)、[implementation-progress.md](research/implementation-progress.md)。G2不代表epoch/UI或全产品AC完成。

## 阶段 3：会话所有权

按 [stage3-contract.md](research/stage3-contract.md) 分顺序3A/3B，继续不同实现agent：3A shared activation关闭协议与process资源终止，3B agent/worker/clone/scheduler旧activation所有权接入。3A交付真实接口后主会话确认再派3B，不同时写composition/backend核心。真实Pi1.1.0host在shutdown后建立新factory/coordinator；before_switch可取消，不能永久关仍活跃的旧activation。不支持旧disposedfactory自动复活，也不通过globalmutablepointer跨epoch复用执行状态。

- [x] 引入 activation/session 关闭标志，任务源、wait、通知、workflow worker 和延迟启动按原activation隔离；不复活disposedfactory。
- [x] 旧会话先冻结入口/输出和通知，再取消 queue/run/worker/mention-clone，注销adapter/订阅；有界await actualcleanup，晚到owner保留。
- [x] 新会话使用空的新执行状态，不恢复旧live任务；保留磁盘日志/会话/worktree，前台bashfinally不unlink。actualSDK换代与PTYnew/quit通过。
- [x] scheduler持久定义与当前binding执行分开，旧timer/latefinalize不串新activation；正常disable不停止已开始任务，shutdown取消旧执行。
- [x] x/显式停止只影响选定所有权范围，workflow按既有失败/依赖路径处理，不隐藏retry被停止的本次child；actualsource/host/worker及PTY验证。

### 阶段 3A 实施与验证（限定 protocol + process，G3 未关闭）

- [x] composition-owned `TaskLifecycle` 实际 participant API：所有参与者同步 freeze/disarm → close hooks → cancelWaits → silent stop → 最多 2 秒 actual drain → source/coordinator dispose，重复 shutdown 稳定幂等，异常逐项隔离。
- [x] process closed admission、pending/fg/bg/monitor/attach/timer 释放；独立 actual execution ownership，TERM→250ms KILL及真实 exit 清升级 timer，pid0安全、TERM-killed leader 不留忽略TERM后代，日志保留。
- [x] actual SDK runtime new/resume/fork/import/quit/reload 方法 offline seam；before-switch canceled/invalidcwd 无 shutdown 时旧 activation仍可执行，真正shutdown后旧工具拒绝、新factory可运行。
- [x] README/provenance/extension/testing/monitor spec及中文 [stage3a-result.md](research/stage3a-result.md) 更新，列出真实API、失败历史、3B待办。agent只增加typed lifecycle option，尚未消费、旧shutdown未迁participant。

3A切片已经主会话与独立复核确认：strict/full416/416、三模块394/394无forceexit正常退出（`/tmp/pi-bg/bwqlhmmhc.log`），lastreview1033038b actual2/2确认末次通知shutdown返回cancelled与正常即时deadline保持；资源泄漏/alreadyabort/计数修复此前独立确认。详细新重入证据见 [stage3a-reentrancy-fix.md](research/stage3a-reentrancy-fix.md) 与 [stage3a-final-result-guard.md](research/stage3a-final-result-guard.md)。3B接入agent/clone/workflow/scheduler和关闭整体freeze-before-stop排序前，不勾阶段3总项／G3；真实TUI未运行。

### 阶段 3B 顺序拆分（已完成，以下保留实施历史）

- 3B1已限定验收：manager/runner/worktree实际追踪、drainExecution、stopForShutdown（含completedretainedchild）、sealHostEffects与稳定boundeddispose，主会话437/71/415通过、最后review actual7/7确认原blocking关闭；见 [stage3b1-result.md](research/stage3b1-result.md)。用户现已接受非协作第三方进程内代码的协作式取消边界，仍不保证强杀或停止其内部写入。
- 3B2迁入participant、clone/scheduler/workflow/通知失效已有主会话strict/full459/459、agent93/93、三模块437/437无forceexit自然退出。独立审查a03ec4e7确认两个blocking（旧UI重入资源复活、clone真实后台强制）与拒绝反馈问题，见 [stage3b2-review.md](research/stage3b2-review.md)。后续修复agent89f7cf5b被用户停止，留下部分index/mention/旧UI和tool-waits测试修改，未完成/未验证；下一切片接管实际文件，不重开旧UI精修。

**取消边界已由用户批准方案 1**：不重设计普通 agent 的独立进程隔离。自有进程、monitor、worker、队列和timer必须停止；非协作第三方provider/create/shutdown hook只发取消、有界等待、旧接口/通知封口、保留迟到清理owner/文件，不保证其内部执行/写入被强杀。具体见 [cancellation-boundary.md](research/cancellation-boundary.md)。

**门 G3 已通过（按用户批准的协作式取消边界）**：3A/3B后端已分段验，核心UI删除旧资源复活路径；集中review59d94a60未发现执行安全/ownresourceblocking，唯一freshpanelgroup窗口shouldfix已修复并独立actual3/3确认关闭。最终strict/full469/469、三模块447/447无forceexit自然退出（b0fav00ex）；旧epoch消息隔离与文件保留成立，第三方非协作限制如实保留。G3不代表Down或真实TUI通过。

## 阶段 4：共享任务 UI

### 用户批准的核心切片（已完成，以下保留当时顺序）

- 先完成旧AgentWidget/FleetView与进程旧panel/footer的删除/替换，接入共享panel/footer，收尾clone后台强制、拒绝反馈及必要admission-after-effect检查。
- 本切片交付列表/即时详情/停止/父子分组/保留/显式入口和底栏；Down编辑器装饰随后独立补齐，不因Down细节阻断可用面板。
- 保留用户停止agent的未验改动中有用的窄修与测试，修正错误fixture；旧UI专属测试随真正删除替换，不削弱shutdown资源/消息/结果归属断言。
- 定向测试随实现执行，完整切片完成后主会话全量strict和无forceexit检查、一次集中独立审查。未授权真实安装/reload/个人配置/提交。

### 核心切片实施与主会话验证（已通过集中独立审查）

新实现agent a2b0cf28完成核心代码，但turnlimit时仍3target失败/文档未同步；主会话接管窄修，没有再给旧UI派大实现。实际删除旧概览/导航/settings并迁非UIactivity；sharedpanel/model/owner接入composition/sourcefinitefacade；clone私有bg与拒绝反馈已有actualtool回归。

主会话strict/full466/466、三模块444/444无forceexit自然退出，日志 `/tmp/pi-bg/b0dk3e0hq.log`。第一轮失败的旧setStatusfooter注入fixture迁到actualregistrywirepublication、hardloader明确旧widgetevent不存在，资源/通知/日志/计数断言保留。mixedwaits新增真实面板查看不detach/面板chord同时解除两后端。README/provenance/spec已同步，研究见 [core-panel-result.md](research/core-panel-result.md)。集中review59d94a60唯一group窗口finding已窄修独立3/3确认，下列事项按actual证据验收。

核心复选项代表限定范围实际验证，不表示任意plugin/model场景：

- [x] 将旧进程双栏 panel 提取为 task-ui：one overlay、左列表右详情、即时选择、Tab、滚动、selected snapshot、clipboard、终端安全渲染和 bounded content。
- [x] agent 普通常规详情直接用source的有界transcript/内存文本预览，不嵌入旧vieweroverlay/chrome/键位；未完整移植旧Markdown渲染，不冒称保留全部富文本。高级viewer/管理保留 `/agents`；核心面板无需多层窗口，actualPTY看到CHILD_READY与本地tool输出。
- [x] workflow/普通 agent 子任务按所有权构建树，默认展开，可 in-panel Left/Right 收起；按 stable identity 存 selection/expansion，不以 row index 错选别的任务。
- [x] 活跃 workflow 内终态 child rows 保留；whole group terminal 四秒后隐藏，选中快照仍可读。UI 展示过滤不能提前消费或回收 backend result；sourceownerretention也覆盖groupend后4秒，freshpanel在sweep后仍完整。
- [x] 分类 footer 只显示真实统计，不把 workflow 和 child 重复计算成独立任务；明确活跃/排队及执行/等待模式。
- [x] 移除 AgentWidget、FleetView、旧 raw listeners/设置菜单和相关旧代码，不提供兼容 UI 开关。
### Down 切片（已验收，以下保留交付/修复历史）

新实现72cf8668只改editor/owner/config/composition末尾hook与actualhost测试。parent修GCfixture的外部包装定义位置，保留4/4真实WeakRef回收要求；target26/26、首轮strict/full481/481、三模块459/459无forceexit自然退出（bvqn4rb6d）。review30c29cc7随后复现失败安装未挂载编辑器；parent将publicprobe/preflight提前到destructivesetter之前，补mountedrender/focus/factory/继续编辑和已有overlay回归。独立14/14与actualSDK三情形确认blocking关闭，最终483/461通过。README/provenance/spec同步，见 [down-result.md](research/down-result.md)。

- [x] 安全 Down opener：采用 getEditorComponent/setEditorComponent 的 editor-local 装饰（首次保留原 live editor 实例），只有空且 focused 编辑器、有 viewable rows、press event、无 autocomplete/overlay 时打开；其他输入委托原 editor，不装全局 terminal-input fallback。actualSDK setter/handoff/TUI分发验证factoryidentity/appcallbacks/草稿/undo/history/粘贴/autocomplete/submission，失败preflight保mountedrender/focus/state/原factory。清理退役自己装饰，不通过恢复factory重建丢state；opaqueGC4/4释放。
- [x] session 初始化注册一次、销毁注销一次；新增入口不能和面板导航抢键。面板持焦点时配置的转后台键交给同一 coordinator，不依赖主编辑器 registerShortcut。actualfocused/getFocusedComponent/noautocomplete/nooverlay均保守判断，无globalrawfallback。

**门 G4 核心已通过（含隔离真实PTY冒烟）**：核心45/45与窗口3/3独立确认；Down独立14/14与actualSDK三情形确认安装失败不卸载、existingoverlay不hide、正常probe不mounted，原blocking关闭。最终strict/full483/483、三模块461/461noforce自然退出（bsowz6kd3），diff/context/文档路径通过。用户授权临时独立CLI/PTy，三轮分段19项PASS覆盖shell/agent/worker/monitor/new/quit，最后CLI自然exit/临时PIDcleanup，无网络/个人配置/安装变更；见 [tui-smoke-result.md](research/tui-smoke-result.md)。任意不delegate后续factory、完整input-history原包多顺序/在线模型质量限制如实记录。不自动finish/archive/commit。

## 阶段 5：规范名、文档与整体验收

- [x] 配置统一为 process-tasks.json / agent-tasks.json / task-ui.json，公共键位归共享层；PROCESS_TASKS_*、全局/项目agent设置与旧名忽略已有actualfoundation/config/controls测试。
- [x] `/tasks`面板、`/bg`detach、`/agents`管理、process规范诊断名实际注册；无`/bg-list`等别名，manifest/commands/loader检查通过。
- [x] 旧名引用已分为历史provenance、上游conflicts身份、测试拒绝旧名/临时路径标签，不保留旧配置reader/旧UI导航。当前runtime不注册旧接口。
- [x] README总表与自带模块说明同步，补task-ui/公共入口；provenance与spec记录实际source/waits/lifecycle/Down和安全回退，无开发workflow资源进preset。
- [x] 非UI能力保留与有限回归已归并：discovery/frontmatter、resume/nested/pools、timerstorebinding、actualworker/gate/control、worktree取消/artifact、mentions/stats；未穷举schema/replay/memory/真实Git/provider矩阵，精度见 [final-acceptance.md](research/final-acceptance.md)。
- [x] 完整strict/full483/483、三模块461/461noforce自然退出、各独立review/窄修已关闭，文档相对路径/diff/context通过；本轮只核对保存证据、不重复测试。提交范围与相邻工作分离见 [commit-plan.md](commit-plan.md)，不自动暂存或提交。
- [x] 真实 Pi TUI 在用户授权的临时HOME/配置/独立CLI中核心用例验证：前台shell/agent可见、Down条件、detach原PID/session、Esc/x、workflow展开/ownedchild/stop、monitor、actualnew/quitcleanup；使用fauxoffline脚本不在线模型、不改个人安装。两处fixture预期错保留历史，19实际检查PASS，最终CLI自然退出。

## 验证命令

```sh
pnpm typecheck
pnpm test
pnpm check
node --test scripts/pi-manifest.test.mjs scripts/sync.test.mjs
git diff --check
python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-subagents-task-ux
```

完整 `pnpm check` 按 testing-guidelines.md 配置 SDK 真实路径与临时 `PI_CODING_AGENT_DIR`，避免读写个人配置。新增测试置于各模块 `__tests__/*.test.ts`；需要 resolver/loader helper 时必须是局部、离线且文档化，不在测试中运行真实安装。

## 回退与风险停点

- 未完成加载/worker运行门前，不发布 vendor 替换；测试使用 stub，不能安装 upstream 和 vendor 两份并存。
- 变更 loader、SDK API、workflow 算法、monitor 通知需求等扩大范围时，停止并重新规划。
- 核心改名采用版本控制回退，不需要旧名兼容执行代码；保留用户文件不删，不用 rm 私人配置实现迁移。
- 不在同一次 session 清理中把持久化 scheduling 配置、日志或 agent 记忆当作执行 runtime 删除。

## 完成状态

用户已批准实施，核心实现、自动验证、独立复核与隔离真实PTY冒烟完成，阶段5证据已归并；产品于`fe8d0f6`提交，用户随后批准任务finish/archive和日志提交。本任务正式完成并归档到`.trellis/tasks/archive/2026-10/10-12-subagents-task-ux/`，不重开功能或未知插件/模型矩阵。完整验证范围和排除项见 [final-acceptance.md](research/final-acceptance.md)，实际提交范围见 [commit-plan.md](commit-plan.md)。main合并、push、日常加载未执行，需单独安排。
