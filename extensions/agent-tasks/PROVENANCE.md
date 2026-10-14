# 来源与本地维护记录

## 精确基线

| 项目 | 值 |
| --- | --- |
| 上游 | [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) |
| npm 包与版本 | `@tintinweb/pi-subagents@0.20.0` |
| gitHead | `13106ab6f608b3acc54185da5299ee7fbaabb6b9` |
| 源 artifact | <https://registry.npmjs.org/@tintinweb/pi-subagents/-/pi-subagents-0.20.0.tgz> |
| integrity | `sha512-9N4Qfy+c5a/cO1mMxpojIuiWPwkSGJPVFc7W/NJ51baAgtt934ZCmpnpDH0W/UK29Pe9FCbXdMxCTXRgfhtE+A==` |
| SHA-1 | `072e5ba283a315196def0af8e38504ced4140da6` |
| 许可 | MIT，完整原文见 [LICENSE.upstream](LICENSE.upstream) |

实施时 registry 镜像 artifact 与上述 integrity 一致；前一阶段逐文件对照了已安装的同版本包，183 个已安装文件与 artifact 一致。本阶段复核缓存 artifact 的 SHA-512、56 个源码文件和下述类型审计，不重新安装 upstream，不依赖已安装包作为运行源。

## 复制布局与加载所有权

- `package/src/**` → `extensions/agent-tasks/src/**`，完整保留 56 个 `.ts` 运行源码及其相对目录，包括 `ui/`、`workflow/`、内联 worker source、默认 agent 定义和辅助模块。
- `package/LICENSE` → `extensions/agent-tasks/LICENSE.upstream`，内容不修改。
- 不复制 `dist/`、上游 package/build 配置、媒体、示例和上游测试框架；本仓库只有一份 TS 运行源。本地离线回归放在 `__tests__/`，不引入 Vitest 或构建步骤。
- 唯一所有者是顶层 [task-composition.ts](../task-composition.ts)：组合 process-tasks、agent-tasks；beautify 独立提供展示。`package.json` 的 `extensions/*.ts` 声明排除 nested vendor 入口；`pi-preset.json` 将 standalone upstream 放入 conflicts 而非 packages，避免重复注册。
- 这是仓库维护的本地 fork，不建立 upstream 同步、旧配置迁移或独立发布义务。

## 基础阶段的本地偏离

1. 原源码 40 个文件中的 171 处本地模块 specifier 从 `.js` 改为 `.ts`，对应本仓库 no-build 的真实源文件。只处理模块引用；workflow 的内联 CommonJS worker、VM 的 `workflow.js` 文件名及用户脚本引用不机械改写。
2. `src/settings.ts` 的全局／项目设置文件改为 `agent-tasks.json`，不读取 `subagents.json`，不自动改写用户文件。其他运行、管理与旧 UI 设置暂保留。
3. `src/index.ts` 与顶层 composition 继续显式导出 `runInChildSessionContext` 供真实 host-loader 回归桥接，但 guard 不再要求调用方与加载方共享同一 jiti graph。Pi 1.1.0 的 `loadExtensionsCached` 在资源 cwd 改变时清空 factory cache，随后以 `moduleCache: false` 创建新 graph；worktree 中的 `loader.reload()` 因而无法读取原 graph 的模块局部 AsyncLocalStorage。`src/child-context.ts` 现在通过 `Symbol.for("my-pi-preset:agent-tasks:child-session-context:v1")` 取得有类型、经 `instanceof AsyncLocalStorage` 检查的进程共享异步标记。它只携带 child scope，不承载 task-ui coordinator、manager 或执行状态；不使用全局布尔值／环境开关，子关闭也不得 disable/delete 该 ALS。根上下文与嵌套异步作用域保持隔离。
4. 运行依赖 `croner`、`nanoid` 声明在根 package；SDK 与 TypeBox 为 host peers，TypeBox 同时是本地开发依赖。`.npmrc` 禁用自动安装 peers，不把第二份 SDK 塞入 lockfile。
5. `__tests__/source-loader.mjs` 只为原生 Node 测试在内存中变换 vendor `src/` 的不可擦除 TS（参数属性）。生产仍由 Pi jiti 加载，不生成 dist、不修改 SDK；测试须先注册 hook，再动态导入被测源模块。

基础阶段仍保留上游 AgentWidget、FleetView 与非 UI 能力；阶段 2B 的共享等待及读模型偏离见下。完整会话 epoch、旧 UI 移除和统一面板仍属后续阶段。

## 类型边界审计

以 TypeScript AST 的 `AnyKeyword` 统计，原 artifact 的 56 个源码文件有 **55 处显式 `any`**；当前 vendor 同为 **55 处**，本地新增 **0 处**。原 artifact 与当前 vendor 的 `@ts-ignore`／`@ts-nocheck` 均为 **0**。测试、加载桥接和 composition 没有为通过 strict 新增 `any` 或忽略检查；继承的 `any` 保留在上游边界，本阶段不借机械 vendor 做无关重构。根 `tsconfig.json` 的 strict、noEmit 和检查范围保持。

## 已执行的基础验证

主会话修正两处旧名测试正则和sync plan-row匹配后，实际隔离 `pnpm check`通过：331 tests、0 fail；不带 force-exit的agent基础/加载/worker定向测试5/5通过并自然退出。验证仅覆盖上述基础门，新的detach、会话隔离和共享UI仍待后续实现。

## child guard 定向修复验证

本次先保留模块局部 ALS，加入不同临时 cwd 的实际 host 加载断言：`loading.test.ts` **0/1 通过**，在 `different cwd (worktree): no child agent tools` 失败，实际多出 `Agent`、`SubagentWorkflow`、`get_subagent_result`、`steer_subagent`。原同 cwd 用例先通过，说明此前不能据此声称 worktree guard 有效。更换 graph-stable 标记后，下表由实际 `loadExtensionsCached` 路径验证；无需 git、模型或真实 session。

| 路径 | 结果 |
| --- | --- |
| 根加载 | 完整根工具集、单一 process Bash 与独立 beautify resolver、根 manager handlers |
| guard 内同 cwd 子加载 | 无 Agent／SubagentWorkflow／结果与 steering 工具、无根 manager command/handlers；子关闭保留原根 registry |
| guard 内不同临时 cwd 子加载（模拟 worktree） | 同上；新 graph 仍读取原异步 child scope |
| cwd 改变后重复父加载两次 | 每个 factory 只注册一次工具／命令／快捷键；仍为根工具图，不覆盖原根 registry |
| child await 暂停期间独立根加载 | 独立根仍有完整工具与 handlers；随后嵌套 child await／加载仍不注册根 agent |
| 原根关闭，再次根加载／关闭 | 原根释放 registry；共享标记仍可用，后续根能重新取得并释放 registry |
| 独立 ALS 与嵌套 await／异常 | 保留无关根 context，根并发 continuation 不继承 child 标记，正常／异常退出均还原作用域 |

这些断言只验证加载身份和未启动 session 的所有权清理。没有运行真实会话替换、运行中 agent／队列／worktree 清理；不能替代阶段 3 的 session epoch 与执行生命周期验收。

本次最终定向 `node --test`：**6 tests、6 pass、0 fail**，不加 force-exit，自然退出；隔离 `pnpm check`：strict typecheck 通过，**335 tests、335 pass、0 fail**（包括并行 stage2A 当前工作树）。完整项目脚本仍包含已有的 `--test-force-exit`，自然退出的证据来自定向测试，不混为一谈。精确命令、前后结果和边界见任务研究 `research/child-guard-fix.md`。

## 离线运行门

- [loading.test.ts](__tests__/loading.test.ts)：临时 cwd／agent-dir，实际 SDK host jiti cached 加载；覆盖上述同／不同 cwd、重复父加载、重叠异步根／子及无 session_start 的关闭矩阵，另有无关 ALS、嵌套与拒绝作用域测试；不改进程 cwd 或环境 cwd 开关。
- [workflow.test.ts](__tests__/workflow.test.ts)：真实 `runWorkflow` 和内联 worker；无 agent 脚本结果、progress handshake、stub host RPC、abort 后线程关闭；不联网、不调用模型或 git，不使用 `--test-force-exit` 掩盖泄漏。
- [foundation.test.ts](__tests__/foundation.test.ts)：配置新名／旧名忽略、真实自定义 agent discovery 和相对源码导入。
- manifest 与 sync 回归：nested entry 不被发现、upstream 只在 conflicts、临时 fake pi dry-run 的替换计划不执行安装或写配置。

## 阶段 2B：agent 等待、通知与只读 source

- `src/agent-manager.ts` 为新建/resume 立即建立 `{sourceId: "agent", taskId, runId}` terminal handle，覆盖 queue/worktree startup/failure；resume 复用 session，但使用新 revision/controller。取消父链接只有一个跟踪所有者，detach 同步注销，pool lease 转移后按当前 pool 幂等释放，owned children 不占顶层池。
- `src/waits.ts` 使用 composition 注入的真实 TaskCoordinator，launch/retrieval 区分；只有 completion 胜出消费结果，取消或解除 retrieval 不停止 agent。manager 另保留 legacy `spawnAndWait/resume/awaitStartup`，nested/workflow/RPC 不转由 UI 执行。
- `src/index.ts` 接入前台 Agent/new/resume 与结果等待；inline finally 只结束 spinner/renderer，后台 activity/transcript 仍由 backend 保持。后台 Agent 直接返回 ID，worktree 启动失败通过 retained terminal 和后台通知交付。可选旧 widget/status sink 错误与强制取消清理解耦。
- 消费、active wait 抑制和已通知 latch 分开。延迟 individual/group nudge 在发送时检查当前 revision、消费、waitCount 和 delivery；`src/group-join.ts` 保存 terminal attempt 快照，resume 注销旧 group membership，所有 terminal group members（含 consumed/waited）仍参与关闭组，避免把 siblings 拖到 timeout。
- `src/source.ts` 复制冻结 all-manager 与 workflow 根读模型，保留实际 parent attempt/owned hierarchy、queued/no-session 行、token/tool/model/真实 phase/progress。conversation 按 transcript byte slice 读取（每次最多 16K），无文件时给明确省略说明的 bounded memory preview，不消费结果；workflow 与 nested stop 仅影响所选 owner 范围。active owner children/未消费结果不被旧十分钟 sweep 提前回收。
- `src/workflow/task.ts` 只增加 backend metadata observer，覆盖 `/agents` pause/resume 和 progress/settle；没有改变 pipeline、retry、schema、gate 或 worker 算法。实际 source + manager + workflow host/worker 测试证明 stopped child attempt 返回 skipped，未自动 retry。
- 提供 `freezeAdmission/stopRun/abortAll/dispose` 与立即可解开的 terminal hooks 给阶段 3；尚不声称 session epoch、scheduler/mention clone/late worktree 完整隔离已完成。

本段新增两个 native node:test 文件执行真实 manager 与 factory，仅注入 fake runner/worktree delays，不联网、不跑模型/git。source-loader、child-context 与 hard root/child loader assertions 保持原样；实际基础加载/worker 回归继续通过。精确最终命令与计数见 task `research/stage2b-handoff.md`。没有新增 SDK `any`／ignore／build tree；窄 DI 是 typed `AgentManagerDependencies`，shared stats 只加 readonly 字段。


## 阶段 2B 复核修复：实际 runner 与通知路径

- `src/agent-runner.ts` 增加局部 typed `AgentRunnerDependencies`（环境探测、resource loader、session 创建），默认仍用真实 host；在各 awaited startup 边界及首次 prompt 前检查 backend signal。已取消不再创建迟到 prompt；partial session 的有界 shutdown/dispose 与 manager 共用 WeakSet 去重，正常 prompt 错误仍保留显式 resume 能力。structured retry 的取消守卫保留。
- `src/agent-manager.ts` 的 starting 只在 session ready 后结束；终态释放 queued startGate；记录每 run turnCount/maxTurns，resume 重新计数，保留软 steering／hard limit，不删除用户或程序化回合限制。resume transcript 接线失败不再被忽略后继续 prompt。
- `src/index.ts` 对后台新建 transcript 初始化执行 stop + disarm notice + 原异常重抛，先于 batch/activity membership；resume preflight 先完成再更换旧结果所有权，stream setup 失败释放 controller/pool。前台新建／resume 都赋当前 toolCallId，无 ID 明确清旧值。延迟 individual/group details 从终态 record 取统计，不为显示保留 activity runtime。
- `__tests__/runner-cancellation.test.ts` 执行实际 runAgent/resumeAgent，延迟 env/reload/create/bind，覆盖已取消、prompt 边界、partial cleanup、detach 正常运行、callback/subscription 失败与 structured retry；`tool-waits.test.ts` 执行已注册工具和真实 manager，使用 ENOTDIR 文件系统故障、stream subscribe 故障及不同 call ID／run stats，不仅依赖 fake runner 的立即信号接线。四项局部反向验证均检出恢复的缺陷。

隔离完整 strict + `pnpm check` **389/389**，agent 无 force-exit **47/47**；精确日志、失败历史及限制见任务 `research/stage2b-fix.md`。phase3 epoch／真实会话切换和 phase4 最终 UI 仍未实施，本段不改变产品范围。


阶段 2B 后续复核：runner 的 closedSessions 提供窄只读 `isChildSessionClosed`，manager 在实际 runner rejection catch 清除已关闭部分 session 的匹配引用及 sessionFile；真正 prompt 失败仍保留 live session。resumeAgent 返回可选 aborted/steered（旧 trusted fake/programmatic runner 缺省仍兼容），manager 以 stopped > aborted > error > steered > completed 处理终态，workflow host 沿原判定拒绝 aborted 成功。新增实际 runner/manager/host 回归与测试先红后绿记录见任务 `research/stage2b-fix.md`。未改 workflow 算法／阶段 3／共享 UI。


## 阶段 3B1：真实执行清理所有权（未接 production participant）

- `src/agent-manager.ts` 私有追踪 startup、新建／resume runner、output/worktree cleanup 和 session stop/close 的实际 promise；`drainExecution()` 不拿 terminal 当执行结束。`waitForAll()` 包含 stopped cleanup；freeze 禁 admission 和外部回调，stop 关闭输出、解除当前 pool 一次，dispose 返回稳定最多 2 秒 promise，超时仍保留旧私有 owner、不复活公开 map。
- `src/agent-runner.ts` 在 create 返回、bind 之前提供 cleanup-only `onSessionOwned`，partial session 的 abort/close 有共享幂等 owner；取消阻止迟到 prompt/turn/steering，subscription 清理异常逐项隔离，正常 prompt failure、parent detach 和所有 turn limits 保留。shutdown stop/drain 阶段与单独 dispose 的有效 budget 内运行 child hooks；protocol final dispose 前或 budget 到期必须 seal，之后晚创建只 local dispose，不能以旧 host 生命周期继续执行。
- `src/worktree.ts` 的可选 `WorktreeOptions.signal` 传入真实 `pi.exec` 并检查 await 边界，`onCreated` 保留 partial add 路径。关闭时不执行新的 git，失败／取消保留未知更改和已生成分支；正常保存后只 non-force remove。移除 dispose 的 detached prune，避免 host invalidation 后再调用旧 pi。此为安全保留偏离，不承诺所有磁盘 worktree 已移除。
- `__tests__/runner-cancellation.test.ts` 增量及 `worktree-lifecycle.test.ts` 执行真实路径，无模型／网络／真实 git／SDK 修改。完整生产 participant、index 通知 epoch、clone、scheduler、workflow worker 接入留给 3B2，G3 仍开放。


### 3B1 复核阻塞修复：completed child 的 extension-owned 资源

review `842266a9` 确认旧 `abortAll → drain → dispose` 漏已完成／active owner retained child 的 shutdown hook，SDK core dispose 不会补发该事件。manager 新增幂等 `stopForShutdown()`：先 freeze/cancel，再在 host-valid stop 阶段登记所有 settled/retained child 的关闭 promise；active prompt/bind 仍先取消并等实际 runner cleanup。`sealHostEffects()` 给 protocol final dispose 明确同步封口；单独 `dispose()` 调 stopForShutdown，在自己最多2s budget 内允许 hooks，完成／超时后 seal。runner 在 actual emit 边界重查 callback permit，不只传早期 bool。新增 actual manager/runner + interval resource 回归；G2取消周期／pool／resume语义不改。


## 阶段 3B2：production participant 与辅助执行取消

- `src/index.ts` 消费已有 `TaskLifecycle`；同步冻结通知／RPC／ctx，再 manager.freezeAdmission；stop 取消 scheduler binding、clone controller、workflow signal，并调用已验收的 stopForShutdown（包括 completed/retained child hooks）。drain 等实际 manager 与 owned clone/worker/host gate promise；同步 dispose 先 sealHostEffects 再 void manager.dispose，最后释放本 activation 的 source/subscription/global slot。直接 factory fixture 无注入时创建局部 protocol、单 handler；composition 不增加第二协议。
- `src/mention-clone.ts` 增加 typed signal/admission 和 loader/create seam，保留实际 create/prompt/forced-background Agent；只尝试一次，失败不冒充成功，也不因已尝试的 handler 失败重复 fallback。迟到 create 只 local dispose，无 extension shutdown hook；已开始 prompt 通过 session.abort 取消并保留整个清理 promise。
- `src/schedule.ts` 每次 start 捕获独立 pi/ctx/manager/store binding，interval/once/cron/startup/finalize 全部重查；stop("shutdown") 取消该 binding 的 child signal，普通 disable 保留已启动执行语义，持久定义不删除。resolveModel 仍同步。cron 格式验证立即 stop 自己创建的验证 timer。
- `src/workflow/{host,runtime}.ts` 只加取消边界：gate 传 signal、await 前后检查，index-owned promise 不把 worker terminate 冒充 host call drain；late host result 在 schema/gate/journal/action 前检查 settled/aborted，保留 pipeline/parallel/replay/schema/intent retry 算法。停止组成员仍参与 group terminal 结算，但不生成完成通知。
- 离线实际路径新增 clone/timer/store/RPC/gate/worker/factory/双后端 SDK runtime 与 reload 回归；hard loader 保持 root/child/ALS/工具身份断言，仅将 shutdown 数量更新为 root/child 都是 composition + pretty 两个 handler（agent 不再单独注册）。
- 不修改已验收 manager/runner/worktree、process/monitor执行语义、shared waits；当时未修改 model max_turns（后续接口偏离见下节）；无真实模型/git/网络/install/reload/SDK 修改。交付时未满足原严格all-stop；后续用户批准协作式取消边界，非协作provider或已开始第三方hook可能超预算继续写，不承诺强杀，自有资源仍须停止。G3按修订PRD与集中审查验收。

## 核心共享面板切片与旧概览删除

用户批准不再精修将废弃的旧UI，将删除与共享面板组成完整切片：

- 删除 `src/ui/agent-widget.ts`、`src/ui/fleet-list.ts`、入口中两套实例和 terminal 导航；删除 `fleetView`、`widgetMode`、仅服务旧概览的 `showModel` 设置及菜单。无兼容壳、旧开关或个人配置迁移。
- 原模块仍为通知、工具结果和高级 viewer 提供的格式/activity契约迁到 `src/activity.ts`，保留统计、回合限制、自定义agent、调度/workflow、viewer和 `/agents` 管理能力。
- composition 只创建一个 `task-ui/owner.ts`，panel 按 immutable source 和 identity-routed finite detail/stop 工作，不访问 manager/session/controller。workflow/普通agent实际父子树、默认展开、活跃组child保留、wholegroup四秒窗口与一个最终选中有界快照由共享model控制。
- clone 参数对象由 factory 私有 WeakSet 标记，在真实 invocation 模式决策处强制后台；普通 Agent 调用的frontmatter优先级不变。无ID正常拒绝及可能已admission的异常会反馈原会话，但不重复 fallback。
- 无显式 offset 的 transcript detail 读有界尾部；显式 offset 仍可分页。不消费结果。后台返回前／source发布后的active守卫保留，不因旧UI删除放松执行清理。
- 主会话actual strict/full **466/466**、三模块无forceexit **444/444**自然退出，日志 `/tmp/pi-bg/b0dk3e0hq.log`。实际 clone/frontmatter/refusal 与 sharedpanel混合后端回归通过。独立集中审查进行中；Down/editor未实施、真实TUI未验证、不标完整验收。

- 核心切片独立审查确认唯一整组窗口缺口：已消费且完成超十分钟的child在workflow结束4秒内被sweep，新面板缺行。`source.ts` ownerretention现覆盖group.endTime后共享4秒窗口；实际spawnAndWait→groupcompletion→sweep→freshpanel的0/3999/4000ms回归先1pass2fail，窄修后通过。窗口外不延长保留、不改manager执行算法。

## Down 编辑器入口切片

共享task-ui/editor.ts在实际Pretty注册后参与session_start，Down在严格空编辑器/实际焦点/无补全overlay/press非repeat/有可查看task时打开面板，foreground-only也可。配置downOpener默认true，false不装，显式Shift+Down保留。只装饰liveinstancehandleInput、同步handoff屏蔽SDK冗余publicsetter，finally恢复，不复制privatehistory/undo；shutdown清资源cell/screen/target、only-owneddescriptor恢复，capturedfactory/input退役透传，不重建editor。后续不delegate的独立editor不保证继承入口。

actualSDKhost/editor/Pretty/TUI分发回归与GC4/4资源回收通过（parenttarget26/26、noforce自然退出），无需模型/安装/SDK写。GCfixture外部包装独立module-scope，不让fixture共享环境保资源。独立review复现unsupporteddescriptor在host已clearcontainer后抛错造成输入框未挂载；窄修用同步完成、不挂载publicUIprobe捕获TUI并在setter前预检/装饰，失败保留原mount/factory/focus/继续编辑，已有overlay不hide。actualcontainer/render/focus/cursor/descriptor与accessor/nonconfig/overlay回归已补。完整strict/full483/483、三模块461/461自然退出；独立Down复核14/14与三情形确认失败安装安全、GC回收，原blocking关闭。后续用户授权的真实installedCLI/140x40PTY隔离冒烟分段19项核心交互PASS，最终CLI自然退出/临时PID清理，不调用在线模型或改个人配置/安装；其fixture和中断历史见task tui-smoke-result。原各阶段“Down未实施”为历史状态。

## 模型委派轮次接口偏离

- 删除根与嵌套 `Agent` schema 的 `max_turns`；共享 invocation resolver 不再消费旧模型轮次参数。新建、resume、嵌套与模型定时委派沿用用户配置，不让模型猜测预算。
- 模型创建的 schedule 不写入轮次预算，触发时解析用户当前限额；可信 scheduler／RPC 的 `max_turns`／`maxTurns`、用户 `defaultMaxTurns` 和 agent frontmatter `max_turns`（含 `0` 无限）保留。可信 scheduler 的持久化格式保持不变。
- manager 在 admission 只解析一次有效上限，写入 record／invocation，并将有限值或明确的 `0`（无限制）传给实际 new／resume runner，异步 bind／排队期间配置变化不改变本次预算；根 resume 按存储的 agent 类型而非模型填写的 `subagent_type` 计算，source 的轮次统计直接读取 record 的有效上限（包括没有 invocation 的可信调用），保持活动、详情与通知一致。runner 的计数、软 steering 与 grace 后 hard abort 不改。
- 离线行为证据位于 `__tests__/tool-waits.test.ts`、`__tests__/backend-waits.test.ts`、`__tests__/runner-cancellation.test.ts`；执行实际注册工具、manager、runner 延迟 bind／resume、临时持久化 store 和可信 RPC，不调用模型／网络／真实 git，不修改个人配置。

前文各基础/3A/3B段为对应阶段的历史记录，旧UI保留/participant未接入的描述不是当前状态；以后续条目为准。

## 完成通知入口契约

- 程序化 spawn 的缺省/null/空白 description 回退到已解析的 agent 类型名；非空字符串保留，非法类型在 manager admission 前拒绝。RPC 与全局 registry 保留原模型/cwd/内部 capability 限制，不要求外部调用方补描述。
- RPC 对派发必需的 type/prompt/options 做最小结构校验；有效 requestId 在等待启动前捕获，成功/失败回复不会因调用方修改请求对象而换地址。无有效地址的请求不派发、不生成 undefined reply channel。协议版本仍为 v2。
- runner 不新增描述参数；record 与 worktree cleanup 使用同一规范化描述。实际 factory/RPC/manager 和离线真实宿主回归记录在本任务材料。
- 完成通知构造或同步提交失败时仅简短 UI warning（无 UI 时安全日志），不新增持久诊断、不自动重试；提示错误不能影响结果检索或 cleanup。individual/group发送后按捕获run身份标记SDK已提交，不宣称持久化ACK。
- stopped组成员按公开终态结算，即使非合作runner仍在drain也不拖延兄弟通知；自身不发完成通知，真正running成员保留partial timeout。

## 2026-10-13：beautify 替换 Pretty

移除 Pretty runtime 与输入框专属代理，保留本后端、root/child ALS guard 与统一生命周期。Down 与 beautify 共享局部 editor-handoff 小工具，两个 session_start 顺序均在实际活实例上安装，Down 禁用仍有外观。原 Pretty editor/host fixture 迁移为真实 SDK + beautify + 离线历史 fixture；hard loader 将 shutdown 断言更新为 composition、appearance、highlighter 三项，原始工具／manager 归属不变。
