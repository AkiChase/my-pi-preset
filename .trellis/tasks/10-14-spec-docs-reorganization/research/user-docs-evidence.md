# 用户文档源码核对

## 范围与基线

本 Agent 只修改五份 `docs/extensions/*.md` 和本证据。未修改 README、docs/index、spec、任务输入、产品、配置、runtime 或角色；没有派发、提交或生命周期操作。

执行检出的 HEAD 为 `125778b8b0229d7e48a9324bed08c882acf6775b`。这与派发中的旧 Review base `3bedbcc3ebd83d23d9a98270c8e043da22bb17bb` 不同；按明确指定的当前 committed source 核对，不以旧草稿或任务规划推断产品行为。

既有 Beautify 草稿有 renderer／编辑器所有权、兼容实现细节和专项测试教程，已改成用户用途、展示、按键与限制。当前工具标题使用真实小写注册名（`toolHeading`），不能保留旧 TitleCase 描述。Task Panel 当前还是居中 90% 宽、70% 高的双栏浮层；没有实现计划中的全屏列表／详情切换。

候选五份都存在实质用户功能，全部提供，没有省略链接目标。用户文档不链接内部实现或测试文件，源码映射集中在此。

## 阅读材料

- 已加载完整 PRD/design/implement，并读取本地 implement.jsonl（唯一文件条目是 design.md）。采用已批准的新读者边界，不复制旧 spec 的 docs/testing 建议。
- 阅读完整 README（677 行）、package.json、pi-preset.json、旧 Beautify 草稿及三个独立入口。
- 完整阅读 `beautify/`、`at-path-completion/`、`task-ui/`、`process-tasks/`、`session-name/`、`session-assist/`、`editor-handoff/` 下所有非测试 TypeScript；读取 bundle `/tmp/spec-docs-sources.txt` 的 1–7215 行，按输出实际边界续读，未以截断输出当成全文。
- Agent 的相关注册、启动与结果等待、通知、Settings 与菜单：`agent-tasks/src/index.ts` 1–700、1150–2699、2750–3199、4100–4125；完整读取 settings.ts、invocation-config.ts、source.ts；核 agent-manager.ts 的默认并发常量及 agent-runner.ts 的默认／有效轮次、宽限值。未声称通读 Agent 的全部执行引擎或所有 viewer／workflow 辅助文件，文档不介绍未核对的深层 API。
- 为确认继承原生行为，额外只读已安装 Pi 1.2.0 的 `pi-tui/dist/autocomplete.js` 293–361（附件目录不加空格、文件加空格），`components/editor.js` 600–657（非 slash 候选 Enter 接受后返回，不 submit）。这些是读取安装目录的源码，不是启动 Pi 或读取个人配置。

## 声明映射

| 文档内容 | 源码文件／符号及核对点 |
| --- | --- |
| Beautify 覆盖六工具、其他工具／问卷保留原展示 | `extensions/beautify/index.ts` default factory 的 resolver；`beautify.ts` re-export |
| 真名标题、窄屏优先名称、展开提示 | `beautify/layout.ts::toolHeading/summary`；`tools/shared.ts::renderers/title`，`keyHint("app.tools.expand")` |
| Read 行数、offset、limited、图片、长行、高亮降级 | `tools/read.ts::ReadDrawing/readRenderers`、`shared.ts::numbered`、`layout.ts::readNotice`、`highlight.ts::Highlighter.highlight`（one-dark-pro，80k 上限） |
| Bash call 耗时不等于后台耗时，启动信封不代表完成 | `tools/bash.ts::bashRenderers`（锚定完整 background 文本；`ctx.durationMs`） |
| Find/Grep 顺序分组、匹配行／context 区分、保守高亮 | `tools/find.ts::findRenderers`、`grep.ts::parseMatch/highlightMatch/grepRenderers` |
| 可选结果未知格式不强制一行；等待不停止；字节范围／stop reported | `tools/optional.ts::optionalRenderers`、`get-subagent-result.ts::agentContract`、`jobs.ts::jobsContract`、`retrieval-contracts.ts::envelope/validArgs` |
| 输入框首行提示符、保留原编辑行为、无专属配置 | `editor/appearance.ts::decorateAppearance/forwarders`、`editor/owner.ts::registerAppearance`、`editor-handoff/index.ts::preserveHandoff`；factory 没有读专属配置或命令注册 |
| 不读 Pretty 配置／禁止 standalone 共存／历史 Alt+R | `pi-preset.json::conflicts/files`；当前 Beautify 导入链，无 pi-pretty 配置读取 |
| @ 手动 slash／目录接受续提示、单项只展示、Escape 不反弹、排除粘贴 | `at-path-completion/editor.ts::inputWrapper/decorate`、`provider.ts::wrapProvider/ready`；请求为 false，非显式 Tab；`token.ts::atPrefix/atDirectory` |
| 原生目录／文件尾空格、Enter 不提交、排序／搜索未替换 | Pi 1.2.0 `autocomplete.js::CombinedAutocompleteProvider.applyCompletion` 与 Editor autocomplete 分支；本仓 `provider.ts::wrapProvider` 委托 getSuggestions/applyCompletion；独立入口无命令／配置注册 |
| @ 不兼容时保留原生 Tab、焦点／内容变动失效 | `at-path-completion/index.ts::cell.fail/close`、`compat.ts::pathEditor/requestCapability`、`editor.ts::invalidate`、`provider.ts::ready` |
| 组合加载与共享入口、无 bg-list | `task-composition.ts::taskComposition`；`task-ui/controls.ts::registerTaskControls` 只注册 bg/tasks |
| 任务分类计数、父子不重复、空时隐藏、终态展示 | `task-ui/model.ts::taskSummary/TaskPanelModel.refresh`、`owner.ts::update`；FINISHED_LINGER_MS=4000 |
| 当前双栏浮层、即选即看、全部面板按键与预览限制 | `task-ui/owner.ts::openPanel`（center/90%/70%）；`panel.ts::TaskPanel.handleInput/render/refresh`；`coordinator.ts::detail`；source.ts 的有界尾部与 workflow stop |
| 空输入框 Down 条件、显式命令回退 | `task-ui/editor.ts::inputForwarder/registerDownOpener`；`owner.ts::canOpen/openPanel` |
| 解除 launch 等待转后台、retrieval 只解除等待 | `task-ui/coordinator.ts::registerWait/detachAll`，`process-tasks/tools/bash.ts::runForeground`，`jobs.ts::attachAction`；Agent `index.ts` foreground/resume 及 get-result、`waits.ts::registerAgentWait` |
| Bash/background 参数与超时不是统一 kill | `process-tasks/tools/bash-params.ts::bashParamSchema`、`bash.ts::registerBashTool/runForeground/spawnBackground`、`bash-bg.ts::registerBashBgTool`（nonInteractive 不触发超时动作；普通命令后台后继续） |
| sleep 等待限制、jobs 六动作、output 字节翻页、search 20 行／长行、通知消费 | `process-tasks/lifecycle.ts::detectBlockedSleep/SLEEP_WAIT_GUIDANCE`；`tools/jobs.ts::registerJobsTool/outputAction/attachAction/searchAction`；`log-search.ts::searchLogs`；`notify.ts::markOutcomeSurfaced/sendTaskNotification` |
| 会话关闭停止但日志保留、记录十分钟／一分钟回收 | `task-composition.ts` shutdown；`task-ui/lifecycle.ts::TaskLifecycle.shutdown`；`process-tasks/lifecycle.ts::createProcessLifecycleParticipant`；`registry.ts::sweepTerminal/startRegistrySweep`；`types.ts::TERMINAL_RETENTION_MS/REGISTRY_SWEEP_MS` |
| 进程配置路径／优先级／完整默认表、旧键不读取 | `process-tasks/config.ts::DEFAULTS/getConfigDir/envNameFor/loadConfig`、`commands.ts::registerCommands/formatConfigReport`；有效 env 优先，不把无效 env 描述为覆盖有效文件值 |
| 进程并发含前台和 Monitor | `registry.ts::atConcurrencyLimit` 计 running；三个启动工具均 `assertJobSlot`；没有仅统计 isBackgrounded |
| Agent 默认后台、参数、类型优先、resume／steer／get-result | `agent-tasks/src/index.ts::agentTool/formatRetrievedAgent` 及 GET_RESULT/STEER 注册；`invocation-config.ts::resolveAgentInvocationConfig`；未搬运全部脚本 API |
| Agent config 全局／项目、Settings 写项目、类型文件项目优先、旧名不读 | `settings.ts::globalPath/projectPath/loadSettings/saveSettings`；`index.ts::showAgentsMenu`；`custom-agents.ts::loadCustomAgents/loadFromDir` |
| Agent 默认并发／深度／轮次和模型旧参数不控制上限 | `agent-manager.ts::DEFAULT_MAX_CONCURRENT/DEFAULT_MAX_CONCURRENT_FOREGROUND`；`agent-runner.ts::normalizeMaxTurns/resolveEffectiveMaxTurns`；`nested-tools.ts` 深度默认；`index.ts` effectiveMaxTurns 不取 params.max_turns；`settings.ts` |
| Monitor source XOR、description、正数时间、二进制限制 | `process-tasks/tools/monitor.ts::registerMonitorTool`；`monitor-ws.ts::isWsSupported/openWsSource` |
| 共享节奏、短窗口、普通间隔重计、无被动空消息、安全唤醒 | `monitor-notifications.ts::MonitorNotifications.enqueue/ordinaryDue/flush`，`types.ts::DELIVER_STEER`；`monitor-buffer.ts::MonitorBuffer` |
| 静默每段一次／恢复、总截止、终态合并／显式 stop 不尾批 | `monitor-session.ts::startMonitorSession/decide/emit/finish/silentAbort`，`lifecycle.ts::terminateJobSilently` |
| stdout/stderr 合流、完整行、主 shell exit 结束观察 | `monitor-source.ts::spawnCommandSource/MonitorLineDecoder.feed/finish`（bash -c，双 pipe，exit 非 close）；`monitor-ws.ts` message 到达 |
| 预览省略／批次清单／保存失败／无自动重试、文件保留 | `monitor-buffer.ts::previewText`；`monitor-batch.ts::writeMonitorManifest`；`monitor-notifications.ts::flush`；没有自动重试 timer、清理 manifest 操作；`registry.ts::sweepTerminal` 只 metadata |
| Session Name 命令／菜单／有效输入计数／手动保护／退避 | `session-name/index.ts::registerSessionName/collectDelivered/checkOwnership/evaluate` 及 input、agent_settled、session-name 注册 |
| Session Name 全局默认／范围／坏文件不覆盖／取消不写／无项目与专属 env | `session-name/config.ts::DEFAULTS/parseConfig/loadConfig/saveConfig`；`index.ts` menu；`pi-preset.json::files` 没有 session-name.json |
| 命名模型与 thinking 跟随、120秒、文字投影、无额外总结／图片、迟到防护 | `session-assist/request.ts::generateText/REQUEST_TIMEOUT_MS`、`context.ts::prepareConversation/branchIdentity`、`session-name/index.ts::evaluate` valid closure；`title.ts::TITLE_PROMPT/readTitle` |

## 实际检查

1. `git diff --check -- docs/extensions`：退出 0。注意产物是 untracked，单独 diff --check 不覆盖它们，因此另跑 Python 检查每份实际文本。
2. 内联 Python 用户文档审计：五文件、五个本地相对链接／锚点、四个 JSON 示例，错误 0；检查目标存在、锚点匹配、末尾单换行、逐行尾空白、中文正文、禁止的内部／测试词项。没有通过放宽缺失 target 规则隐藏断链。
3. 人工逐节与上表核对。修正 README 中 `maxConcurrentJobs` 仅后台的旧描述，当前源码也计算前台；明确 Bash timeout 是转后台时间，不误写成普遍 kill deadline。没有把计划中的面板 redesign 写成现有功能。

未运行 typecheck、lint、产品自动测试、真实 Pi／tmux／terminal、在线模型、安装、sync 或 reload。此次仅文档和源码核对，不提供新的运行兼容性或标题质量验收。共享索引／README／spec 链接及活动 JSONL 的全仓审计由主会话整合后执行；本 Agent 只报告自己五份产物范围内的链接检查。
