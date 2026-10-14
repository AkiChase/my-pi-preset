## 开发

开发用 pnpm（版本钉在 `package.json` 的 `packageManager` 里）：

```sh
pnpm install            # 装开发依赖
pnpm check              # 类型检查 + 全部测试，提交前跑这个
pnpm typecheck          # 只跑 tsc --noEmit
pnpm test               # 只跑 node --test
./install.sh --dev      # 本仓库切到当前检出；之前需 pnpm install
./install.sh --dev --dry-run  # 看本地测试模式的切换和同步计划
./install.sh --dry-run  # 看看这台机器缺什么
```

测试用 `node --test`，没有第三方框架。会话命名可定向运行 `node --test extensions/session-name/__tests__/*.test.ts extensions/session-assist/__tests__/*.test.ts`，使用临时 agent 目录且不带 force-exit；覆盖实际 SDK 投影、保守计数、手动保护、失败退避和取消，不把离线 fake provider 当作在线标题质量验收。全部测试都不联网、不碰 `~/.pi`：`scripts/sync.test.mjs` 会使用假的 `pi`，并把 `PI_CODING_AGENT_DIR` 指到临时目录，所以配置读写都发生在那里。它还用带空格路径的临时 git 检出验证 `install.sh --dev`：远程/本地双向切换、不同 git 写法和 ref、重复执行、两份同时注册、移除失败中止、dry-run、域选择、非法检出及管道安装拒绝；第三方包和 prune 保持原来的行为。`scripts/pi-manifest.test.mjs` 只读本仓库清单，校验所有顶层扩展被声明、nested 后端未作为入口、standalone upstream 只在 conflicts，以及运行依赖与 host SDK 边界。

轮次接口回归位于 `tool-waits.test.ts`、`backend-waits.test.ts` 与 `runner-cancellation.test.ts`，执行实际工具／manager／runner／临时 ScheduleStore／RPC，覆盖旧参数忽略、用户及 frontmatter 限额、无限制、resume 显示与通知一致、可信程序入口上限保留，以及异步 bind 期间默认值变化不改变本次上限。

`extensions/agent-tasks/__tests__/loading.test.ts` 在临时 cwd／agent-dir 中通过真实 Pi host loader 验证单一注册、同 cwd／不同 cwd 的根／子会话 guard、重叠根加载和 shutdown；`workflow.test.ts` 使用真实 worker 跑无模型脚本及 stub RPC，验证 abort 后自然退出。vendor 源中的 TypeScript 参数属性需要本地测试的 [`source-loader.mjs`](extensions/agent-tasks/__tests__/source-loader.mjs) 在内存中变换；hook 只覆盖 agent-tasks/src，测试先注册再动态 import，生产仍由 Pi jiti 加载，不生成 dist。可单独运行 `node --test extensions/agent-tasks/__tests__/*.test.ts`，不用 force-exit 掩盖线程或 timer 泄漏。

共享租约和进程接入另跑 `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts`，同样不带 force-exit，覆盖早期 detach、父信号解除、多次结果等待、完成竞态与前台日志保留；检查仍须使用下述真实 SDK 路径和临时 agent-dir。[`mixed-waits.test.ts`](extensions/task-ui/__tests__/mixed-waits.test.ts) 同时运行真实 shell 与假模型 agent，通过实际面板验证打开／关闭不改变四个启动与结果等待，面板转后台键一次解除两后端等待，PID、agent 会话与日志不被替换。

[`panel.test.ts`](extensions/task-ui/__tests__/panel.test.ts) 使用真实 TaskPanel/coordinator 和有界 source fixture，覆盖即时详情、模式与等待、默认展开／用户收起、整个父组四秒窗口、sweep 后选中快照、queued／starting／paused 停止、路径复制、宽字符与外部控制符、共享 UI owner 重入清理和单 overlay。可定向运行 `node --test extensions/task-ui/__tests__/panel.test.ts extensions/agent-tasks/__tests__/tool-waits.test.ts`；后者还执行真实 registered Agent＋临时自定义 frontmatter＋typed clone transport，验证私有后台强制、普通调用前台 pin、明确拒绝反馈和部分 admission 异常不重复执行。旧进程底栏的测试改为 source 发布／接线故障，不恢复已删除的 footer 来满足旧断言。

[`activation.test.ts`](extensions/process-tasks/__tests__/activation.test.ts) 执行真实 bash／monitor／jobs／source，覆盖前台／后台／pending／attach、有界 TERM→KILL、忽略 TERM 的孙进程、WS 迟到事件、停止 hook 抛错和日志保留。其 [`process-harness.ts`](extensions/process-tasks/__tests__/process-harness.ts) 只提供 scoped typed 测试边界，不进入生产。共享 [`lifecycle.test.ts`](extensions/task-ui/__tests__/lifecycle.test.ts) 检验所有参与者先冻结、后释放等待、drain 有界且异常不挡其他清理；[`sdk-runtime.test.ts`](extensions/task-ui/__tests__/sdk-runtime.test.ts) 用真实 SDK `AgentSessionRuntime` 的 new／resume／fork／import／quit，以及 `AgentSession.reload` 方法驱动旧 shutdown→新 factory，昂贵 session/services 用最小 typed seam，不复制 host 生命周期、不启动模型或真实 Pi。可单跑 `node --test extensions/task-ui/__tests__/{lifecycle,sdk-runtime}.test.ts extensions/process-tasks/__tests__/activation.test.ts`，仍须隔离 agent-dir，且不用 force-exit。monitor 启动重入回归另可运行 `node --test extensions/process-tasks/__tests__/{activation,monitor-session,monitor-setup-result,lifecycle,monitor}.test.ts`：仅替换 WS transport，实际工具／源／session 覆盖发布、source factory、UI 接线中的同步 shutdown、已 abort 接线、停止 hook 抛错、统计保留及关闭后日志不再增长；`monitor-setup-result.test.ts` 保留 F=0 的末次静默提醒同步 shutdown 取消启动与正常即时 deadline 收尾，并覆盖默认短窗口后 shutdown。新增 [`monitor-notifications.test.ts`](extensions/process-tasks/__tests__/monitor-notifications.test.ts) 验证实际共享调度、及时抢先、发送重入、总预览预算、终态抑制和 epoch 清理；session 多源与 factory command/WS 合并／renderer 回归也运行实际接入。可单跑 `node --test extensions/process-tasks/__tests__/{monitor-notifications,monitor-session,monitor-buffer,monitor,config,index,activation,waits,monitor-setup-result}.test.ts`，隔离 agent-dir 且不用 force-exit。

Agent backend 实际清理可定向运行 `node --test extensions/agent-tasks/__tests__/{runner-cancellation,worktree-lifecycle}.test.ts`（临时 agent-dir、无 force-exit）。前者执行真实 manager／runner 的 typed env／loader／create seam，后者以 fake `pi.exec` 和临时文件执行真实 worktree 路径，不调用真实 git；覆盖 terminal 先结束但 drain 仍等待、new／resume、partial session、非协作晚结束、同步关闭重入、抛错清理 hook 和保留 artifact；另以 child shutdown hook 所有的真实 interval 验证已完成／workflow 保留子会话、运行中子会话与单独 dispose 的资源释放，超时后不启动迟到 host hook。

开发回归补充：`node --test extensions/agent-tasks/__tests__/{auxiliary-lifecycle,tool-waits,workflow}.test.ts extensions/task-ui/__tests__/sdk-runtime.test.ts`（同样使用临时 `PI_CODING_AGENT_DIR`、实际 SDK、无 force-exit）。实际 clone 只替换 loader/create 输入，执行 reload/create/prompt/abort/local dispose；scheduler 用 typed timer seam 和真实临时 ScheduleStore，检查旧 interval/once/cron 与 startup/finalize 不串新 binding。SDK runtime 与 reload 同时绑定真实 process/agent 及同一 coordinator/protocol；busy/paused worker、迟到 host gate、CLI workflow、保留 child extension interval、旧 RPC/tool/input 均走实际路径，无模型／网络／真实 git／安装／SDK 写入。非协作第三方 provider／create／shutdown hook 按上述协作式取消边界处理，测试不能声称已强制终止其内部执行；核心共享 UI 和 Down 已通过实际 SDK 编辑器离线测试及隔离真实 Pi PTY 核心冒烟。

另以临时 HOME／agent-dir／cwd／sessions 直接加载当前检出的真实 Pi CLI，运行 140×40 PTY 核心冒烟：无任务／非空 Down、前台-only 开面板、查看／Esc 不解除等待、转后台保持 PID、x 停实际进程、子 agent 排队／即时详情、workflow 默认展开／子详情／整组停止、monitor 输出、`/new` 清理和正常 `/quit`。子 agent 使用 SDK 原生 faux 离线脚本响应，实际创建会话并执行本地 bash；workflow 使用真实 worker。没有在线模型请求，也没有改个人配置或安装。此烟测不覆盖模型自主质量、任意第三方插件／终端尺寸或全部 provider／worktree 场景。

路径连续补全可定向运行 `node --test extensions/at-path-completion/__tests__/*.test.ts`，不带 force-exit，并使用下述临时 agent-dir 与既有 SDK。回归包含原生对照、目录 Tab／Enter／唯一候选、异步取消、实际 host setter 与多顺序组合、安全降级和 GC；native fd 在临时目录验证 ignored scoped、相对／绝对／引号、递归与 20 项上限，`~/` 在临时 HOME 子进程验证，不扫描个人 home。fd 不可用时不安装替代工具，相关集成限制须单独报告。

beautify 回归使用实际 SDK loader/resolver/ToolExecutionComponent、setter/reset、CustomEditor 与 TUI，history 使用独立离线 fixture，不读取本机 `pi-input-history`。范围见 [`extensions/beautify/TESTING.md`](extensions/beautify/TESTING.md)。运行 `node --test extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts`（不加 `--test-force-exit`）检查自然退出。全量 `pnpm check` 前请把 `PI_CODING_AGENT_DIR` 指到 `mktemp -d` 的临时目录，同时用 `PI_SDK_DIR` 指向实际 SDK 的 `node_modules`，结束后删除临时目录；部分既有测试调用默认配置 loader，不能仅依赖测试自身隔离。

扩展 import 的 `@earendil-works/*`（pi 自己的 SDK）是 peer 依赖，运行时由 pi 提供，所以不装。类型检查和测试前会先跑 [`scripts/link-pi-sdk.mjs`](scripts/link-pi-sdk.mjs)，它在本机 pi 安装里找到这套 SDK 并软链进 `node_modules/`——类型因此永远对着真正加载这些代码的那个 pi 版本。`pnpm install` 之后链接可能被清掉，跑 `pnpm link-sdk` 重建即可；pi 装在别处时用 `PI_SDK_DIR` 或 `PI_BIN` 指过去。

本仓库的 [`.npmrc`](.npmrc) 设置 `auto-install-peers=false`，避免本地 pnpm 额外装一套 host SDK；TypeBox 在开发依赖中供原生测试／类型检查解析，运行时同样由 pi 提供。`croner`、`nanoid` 是 agent 后端的普通运行依赖。

另外注意：别人机器上的运行时依赖由 pi 安装，用的是 pi 自己配置的包管理器（默认 npm），它不读 `pnpm-lock.yaml`。所以 `dependencies` 保持宽松范围；`devDependencies` 不会被装到那些机器上。

改动扩展、清单、同步行为或检查命令时，同步更新 README 的相关摘要及 `docs/` 的详细说明；不要求 README 重复所有细节。插件专项说明见[文档索引](docs/index.md)，真实终端流程见[tmux 指南](docs/testing/tmux.md)。
