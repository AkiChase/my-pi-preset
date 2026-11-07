# 实施与验证计划：Herdr Core 问卷等待补齐

> 用户在升级后协议核查完成时明确要求“那就按task做吧”。按当前 A 方案批准实施，包含未知快照安全回退、计划内独立 scratch 终端验证、独立审查与 scoped 本地提交。先完成 Phase 1 材料/context 复核，再 approved start；不扩展到个人 session、安装、push 或归档。

## 1. 执行与审查选择

- 实现：主会话直接实施，已掌握入口、attention 合同及测试边界。
- 审查：完成 scoped 实现后由 `trellis-check` 独立审查。这是 SDK receiver/生命周期兼容边界变更，不能只用自审代替独立审查。
- 当前 `implement.jsonl` 保持空，未派发实现；`check.jsonl` 为实际规范引用。批准后使用 `task.py start <task> --allow-empty-context` 仅用于未使用的 implement manifest，不跳过 check 上下文。
- 不创建 worktree，不安装依赖，不修改或重载个人 Pi，不操作用户的默认 core 服务。
- 已有六处不相关修改由其他工作所有，不纳入本任务。

## 2. 单一可验证实施阶段

本任务采用一个耦合阶段：core adapter、入口路由、回归、用户文档及规范必须一起保持一致，检查完成后提交该阶段。

1. 已随“按task做”批准 PRD 覆盖空窗安全回退；复核并收敛 PRD/design，使用未派发 implement 的 allow-empty approved start。
2. 主会话实施设计中明确的 core 分支；现有 socket watcher 不顺手重构。
3. 补确定性回归及实际 SDK 边界测试；验证 helper 未被 top-level manifest 当成独立扩展发现。
4. 更新 `docs/extensions/herdr-state.md` 与 `.trellis/spec/development/herdr-state.md`，只描述当前行为/用户限制，不把 Agent 调用教学或迁移历史写入用户 docs。
5. 在已安装 SDK、临时 agent-dir 下运行 focused 自然退出测试与 `pnpm check`。
6. 在当前 task 批准的独立 scratch 环境执行下节矩阵；未运行不记为 PASS，关键 owner/reload 证明不足时不完成验收。
7. 独立审查 scope：未知 baseline 回退、合并/恢复、原生 Blocked/clear、重载/terminal ownership、peer ID pairing、原通道不回归、能力禁用与清理。
8. 主会话核实实际 diff、检查结果、真实测试限制；修复 scoped 问题并重跑受影响测试。
9. 通过后创建一个 scoped 本地阶段提交；只 stage 本任务明确文件，不混入其他改动。用户未选择禁止提交，当前 task 实施批准包含该本地检查点。

不授权 push、历史改写、安装、个人同步、归档或 journal 生命周期动作。

## 3. 确定性回归矩阵

- 环境：无环境、完整旧 pane、完整 core、不完整 core、同时完整环境（旧 pane 优先）；只注册一个上报分支。
- 模式：TUI 激活，RPC/JSON/print 静默。
- snapshot：未知时问卷不写；收到第一真实状态后才覆盖；不猜初始 Idle，不访问私有缓存；原生更新后恢复最新 Done/Error/message。
- attention：具名 ID 重复 begin/end 幂等；交错 prompt label 按 ID；两题 overlap；匿名兼容计数与具名互不干扰；malformed payload；取消/error finally 解除。
- priority：native permission/auth/question Blocked 原样保留；解除原生 Blocked 且问卷仍活跃则恢复问卷覆盖；clear 不复活。
- receiver：this binding、不可装饰 descriptor、安全拒绝、partial setup rollback、同步 reentry、shutdown 胜出异步捕获、later wrapper owner、双重 cleanup、旧 activation late event。
- native integration：实际 ProgramStatusReporter 的 dedup、普通成功、最终错误、取消、压缩及登录；test-only introspection 不进入产品代码。
- terminal integration：实际 ProcessTerminal 能力禁用/延迟协商/restart 缓存重播；装饰期间缓存是合并值、解除后缓存是 native 值。用已授权的 isolated 环境与 typed seams，不依赖个人配置或凭据。
- 旧通道：原 `extensions/__tests__/herdr-state.test.ts` 全部不回归，保留 socket request/session/seq/coalescing/fail-open/shutdown 行为。

## 4. 本地命令计划

依赖已安装：Node v24.14.1、pnpm 10.33.0、Pi/pi-tui 1.4.0；repo SDK symlink 指向现有安装。缺依赖直接报告，不执行 install。

每次完整调用都使用 owned repository-external run directory，创建临时 agent-dir，设置既有 SDK root，防止测试读取个人配置：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
# 上一步成功、路径存在后才继续；RUN_DIR 来自本阶段新建 mktemp 目录。
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$RUN_DIR/agent" node --test \
  extensions/__tests__/herdr-state.test.ts \
  extensions/herdr-state/__tests__/core-state.test.ts \
  extensions/herdr-state/__tests__/core-sdk.test.ts \
  scripts/pi-manifest.test.mjs
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$RUN_DIR/agent" pnpm check
git diff --check
python3 .trellis/scripts/task.py validate .trellis/tasks/11-07-herdr-core-state
```

上述新测试路径是预定文件，不声称已经存在或运行通过。task validate 会对未使用的空 implement manifest 提示诊断，不记为全部验证通过。记录 Markdown 链接、JSONL parse/existence、语言及 top-level discovery 结果。

## 5. 隔离真实终端计划（随 task 批准）

本轮“按task做”的批准包括下面的隔离验证动作；只操作本次自建测试实例，不操作个人实例：

- 唯一 `HC_SESSION`、scratch HOME/XDG config/state/runtime/data、独立 `PI_CODING_AGENT_DIR` 与 cwd，用 `env -i` 清除个人 `HC_SOCKET`/`HC_TERMINAL_SOCKET`/`HC_SCOPE`/`HERDR_*` 及 provider credential。
- 只启动本次测试 core session；不连接、停止、重启默认 session。确认 scratch socket 路径后所有管理命令使用同一隔离环境及响应返回的 terminal ID。
- 现有 hc 帮助确认可用：`hc server start --json`；`hc run --bg --no-parent --no-notify --name <unique> --cwd <scratch> -- <explicit executable> <args...>`。真正执行前再次确认该版本 env 隔离与 socket 路由，不用不存在的 `--session` flag。
- Pi 明确加载 checkout entry 与临时 offline provider/问卷 fixture，不发现个人扩展：`pi --offline -ne -ns -np -nc --no-mcp --no-session --no-themes --tui-mode <regular|fullscreen> -e <entry> -e <fixture>`。不得从 online provider 或个人 credentials 补测试。
- 第一层实际 CLI/core 使用临时问卷 peer fixture 驱动状态，证明 native receiver owner/reload/cached OSC 效果；第二层若加载当前已安装 rpiv 包，使用临时配置且明确标记真实第三方兼容证据。fixture peer 测试不能冒充 rpiv UI 端到端验收。
- 矩阵：新模型 run 的问卷 Blocked/标签/关闭→Working→Done；失败→Error；标准 native dialog/auth 优先；普通 custom 不 blocked；空闲 reload 后下一轮问卷；unknown baseline 的安全漏报；session replacement；能力协商及 `PI_PROGRAM_STATUS=0`；正常退出。
- 使用 `hc wait` 或 monitor 等待状态/输出，不固定 sleep；控制输入只到响应返回的本次测试 ID，不操作个人 t5。正常退出、实际 PID 清理及 scratch core 关闭都要验证。
- 如需 tmux 观察，使用唯一 `tmux -L <test-id>` 服务，不用个人 tmux；文档 `.trellis/spec/testing/tmux.md` 的旧 research/evidence 存储用语服从当前 workflow：raw 输出在本次 owned 外部临时目录。

完成验证后保存自包含结果（版本、命令、环境、退出码、失败与重跑关系、未运行项）；仅有长期价值的最少材料才另选入 evidence。回收仅本次 owned 临时路径，未解决诊断保留并说明。

## 6. 用户单独授权的 Herdr TUI 升级 — PASS

用户要求先升级 TUI，升级后再讨论插件后续方案；这不是插件实施或真实会话操作授权。当前 session 在 core，不在 TUI pane，不执行 TUI pane/session 控制。

环境：macOS arm64、直接安装路径 `/Users/jyxc-dz-0101322/.local/bin/herdr`，配置的 update channel 为默认 stable。先备份原 0.9.1 binary 至 owned 外部临时目录，核对旧 SHA-256 为 `5fc7a7e7adfaca56fa80aa89dcb025693357268dab8285b9ce2d08a2313c89de`。

只读检查固定 v0.9.1 updater 源码，确认非交互输入不会批准停止不兼容 server；官方 `https://herdr.dev/latest.json` 当前指定 v0.9.5 的 `macos-aarch64` asset 与 checksum。

执行命令：`herdr update </dev/null`，没有 `--handoff`，stdout/stderr 写入 owned 外部临时目录。退出 0，完整 log 记录 `checking stable channel`、`downloaded 0.9.5`、`installed 0.9.5`、`run herdr again`；没有运行 server stop/restart 或批准停止旧会话。

更新后 `herdr --version` 为 `herdr 0.9.5`；installed binary SHA-256 为 `fb77c2232a05a8035421382c894392f4174e4e38a18e48af3dd0290157c3a7e2`，与官方 stable manifest 一致，校验退出 0。`hc --version` 仍为 `hc 0.1.18`。

updater 仅提示 Kimi integration 可能需更新；未执行 integration install、配置同步或其他 agent 改动。产品代码未修改，task 保持 planning。升级完成时，新 TUI 的实际 OSC 7501 接收能力、运行中 server 版本及插件兼容验收均 NOT_RUN，不由 CLI 版本或 checksum 推断；后续授权隔离协议核查见第 8 节，个人运行中 server 和 Pi 问卷端到端仍未测试。

版本、checksum 及完整 log 已核实并记录自包含结果后，仅清理 owned `herdr-tui-upgrade.lNMKKs` 外部临时目录（源代码、manifest、log 和临时旧 binary 备份），cleanup 退出 0，路径不再存在。没有活跃进程使用该目录；安装目标仍为 0.9.5。`git diff --check` 退出 0。


## 7. 规划期已执行验证

### Native baseline probe — PASS（fixture）

命令：

```sh
env PI_CODING_AGENT_DIR=<owned-run>/agent node <owned-run>/native-baseline-probe.mjs
```

实际 SDK：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent`，1.4.0。直接实例化实际 `ProgramStatusReporter`，只注入 public `setProgramStatus` sink fixture，无实际 TUI/core 或模型请求。

退出码 0，父级完整查看 log，断言：

1. native 先 report Idle，后安装观察器；再次 report/reset 由于去重没有回调，公开 snapshot 仍未知。
2. 后续 agent_start 发真实 Working + session name。
3. fresh observer 在不变状态下同样需要下一次真实变化；新 run 可得到 Working。
4. native 最终错误能通过 receiver 给出 Error + 错误首行，无需复制原生判断。

该 probe 只证明 dedup/receiver calls，不证明装饰产品、真实启动/重载、问卷 UI 或 OSC 解析。

### 只读 CLI 合同发现 — PASS

`hc --help`、`hc --skill`、`hc run --help`、`hc server start --help`、`pi --help` 均退出 0。确认 `HC_SESSION`/scratch XDG 的测试要求、run flags、Pi 显式 extension/offline flags；没有启动新 core 或 terminal。

### 其他

- `git diff --check` 在规划期及最终材料检查点均退出 0。
- `task.py validate .trellis/tasks/11-07-herdr-core-state`：退出 1，仅因未使用的 `implement.jsonl` 为 0 entries；`check.jsonl` 的 6 条引用验证通过。复跑仍为同一诊断，不将其记为 full PASS。
- 额外 Python 材料检查：退出 0，验证 planning 状态、当前 A 标题、6 条 check 引用实际存在、3 份 Markdown 非空与新文件行尾空白。
- 类型检查、产品测试、Pi 真实 TUI/core 问卷端到端、独立产品审查：NOT_RUN（产品未实现；后续授权的 TUI 协议层测试单独见第 8 节）。
- 父级已核实完整 probe/CLI 输出并整合上述自包含事实，随后仅删除 owned `herdr-core-planning.wtVxSa` 外部临时目录；cleanup 退出 0 并验证路径不再存在。没有真实 TUI/core 进程使用该目录，不删除任何历史或其他 session 的临时资料。

## 8. 升级后 TUI 0.9.5 协议核查 — PASS（协议不支持的确认）

用户在升级完成后要求核查后续方案，主会话明确说明仅使用隔离测试会话，不操作已有会话。产品仍未实施，task 仍 planning。

### 源码

固定 `v0.9.5` release 的 `src/pane/osc.rs:488–528` 中 AgentOscStateTracker 的 match 只处理 `0|2`（title）、`9`（progress），其他命令忽略。`src/pane/terminal.rs:1390–1399` 使用该 tracker。二进制无 `7501` 字符串作为辅助线索，不将其单独当成充分证据。

探索 `src/api/types.rs` URL 返回 404，未下载到文件；这是源码定位失误，无产品或协议测试结论。随后依据实际 server 的响应确认正确方法和字段。

### 实际 server/PTY probe

命令：`python3 <owned-short-run>/probe.py`。仅 scratch HOME/config/XDG、非 login `/bin/sh`、`[update] version_check=false, manifest_check=false`、清空个人 HC/HERDR socket/context 与 credentials。使用本机 0.9.5 的 `herdr --session <unique-osc-probe> server`，socket 为 scratch XDG config 下 `herdr/sessions/<name>/herdr.sock`。没有操作个人 TUI/core 服务。

驱动通过该 owned socket 的 `pane.list` 获取真实 ID，将临时 Python child 放进该 pane。child 在真实 PTY 发 `ESC]7501;?ST` 与 DA 查询，再发送 `ESC]7501;state=blocked:app=osc7501-probe:kind=question:msg=<base64>ST`。等待查询回复 2 秒、观察 agent 创建窗口 2 秒，均为 bounded select/readiness，不靠 shell 固定 sleep。socket 正向对照在同 pane 发 `pane.report_agent` 的 Blocked。

失败与复跑关系：

1. attempt 1 退出 1：驱动误用 core 的 `server.status` 方法；TUI 返回 invalid_request，未进入 OSC 验证。owned server.stop 接受，server 退出 0。
2. attempt 2 退出 1：已看到无 7501 回复、无 OSC agent、socket Blocked；但断言误用 `state/status` 字段，实际是 `agent_status`，因此错误。owned server.stop 接受，server 退出 0，child PID 不再存在。
3. attempt 3 使用全新唯一 session、清除 owned child marker、改为 `ping`/`agent_status`，退出 0。前两次 raw report/log 保留至主会话检查失败原因和最终复跑，不抹去上述失败事实。

最终可观察结果：

| 检查 | 结果 |
| --- | --- |
| owned server ping | version 0.9.5、protocol 22 |
| 普通 DA 查询 | 回复 hex `1b5b3f36323b323263`，说明真实终端回复路径正常 |
| OSC 7501 支持查询 | 没有 `7501;` 回复 |
| 显式自定义 OSC Blocked | `agent.list` 为空，pane agent_status 为 unknown |
| 同 pane socket Blocked 正向对照 | `agent.list` 中 agent_status 为 blocked |
| 正常清理 | child 收到退出输入，owned server.stop 接受，server exit 0；child PID 不存在 |

这是当前 TUI 正式版实际协议层证据：升级至 0.9.5 并未增加可用的通用 OSC 7501 状态接收，socket watcher 保留方案有依据。不是 Pi 原生 reporter、问卷 UI、用户已有 session 或未来版本的端到端验证。

主会话已完整查看各次 report 与必要 log、核对所有 owned server/child PID 不再存在；随后仅删除两个 owned 外部目录 `herdr-osc.FjRdEP` 与 `herdr-tui-status-check.B2vXcv`。cleanup 退出 0，目录不存在；`git diff --check` 退出 0。保留自包含结果与失败原因，不保留 bulk raw 输出或临时 drivers。

## 9. 已批准实施阶段与最终验证

用户“那就按task做吧”批准当前 A 方案与安全回退。主会话复核 PRD/design/implement、规范和执行协议后，`task.py start ... --allow-empty-context` 将 planning 改为 in_progress；未派发实现，implement manifest 故意为空。start 提示 main 与 base_branch 相同，未因此创建分支、改写历史或执行归档。本轮只有一个耦合产品阶段，检查后 scoped 本地提交；任务等待用户验收与单独生命周期授权。

### 实现边界

- `extensions/herdr-state.ts` 只增加互斥 core 路由；既有 socket watcher/reporter 的函数体与计数语义未改，完整旧 pane 环境优先。
- `extensions/herdr-state/core.ts` 复用公开 descriptor lease，只观察公开 setter。传入原有 `askUserLabel` 避免循环 import/无关 helper 重构；不复制 lifecycle/压缩/登录状态机，不改环境开关，不代理 stdout，不访问 SDK 私有快照。
- session-owned 即时 custom capture 不挂载 UI；具名 ID 幂等配对、匿名独立计数、最早活跃标签、native Blocked 优先、latest snapshot 恢复、clear 失效、partial/late setup 与退役清理均有回归。
- 嵌套 helper 不成为顶层扩展；用户文档与英文合同同步。没有依赖、SDK、第三方包、个人配置或安装目标变更。

### 自动化检查与独立审查

整次调用设置已有 `PI_SDK_DIR` 与 owned scratch `PI_CODING_AGENT_DIR`。SDK fixture/静态类型使用现有 1.4.0 安装；未下载任何依赖。

命令：

```sh
PI_SDK_DIR=<existing-node-modules> PI_CODING_AGENT_DIR=<owned-run>/agent node --test \
  extensions/__tests__/herdr-state.test.ts \
  extensions/herdr-state/__tests__/core-state.test.ts \
  extensions/herdr-state/__tests__/core-sdk.test.ts scripts/pi-manifest.test.mjs
PI_SDK_DIR=<existing-node-modules> PI_CODING_AGENT_DIR=<owned-run>/agent pnpm check
git diff --check
python3 .trellis/scripts/task.py validate .trellis/tasks/11-07-herdr-core-state
```

- focused attempt 1：40 tests、39 PASS/1 FAIL、exit 1。失败是 fixture 未结清重启前的 keyboard DA debt，误以为一次 DA 就结束新一次协商；按实际 SDK 计数补齐旧 DA，不修改 SDK 或削弱“不支持时不发 OSC”的断言。
- 首次 typecheck：exit 2，空数组 deepEqual 的断言窄化导致测试中的 calls 被推为 never；改为 length 断言，没有生产类型错误。
- focused attempt 2：41 tests、exit 0、自然退出。full check attempt 1：1794 tests 全 PASS、exit 0，但这是独立审查修复前结果，不充当最终版本证据。
- 独立 `trellis-check` 只读审查实际代码、全部 14 条 check 引用和 SDK，发现 P2：上报 rejection 与同步 shutdown 交错，旧 wrapper 可能迟到写 Working，peer refresh 甚至可能传 undefined。独立 public receiver probe exit 1，主会话完整核实两条调用轨迹。
- 主会话修复两个 catch：回退前重查 closed、当前 descriptor ownership 与 native snapshot identity。新增两种 publication 路径 × shutdown/native-update/later-owner 六个交叉 case。
- 同一独立审查者复查原 P2：probe exit 0，两条路径最终均 Error；focused **42 tests 全 PASS、exit 0、自然退出**；`pnpm exec tsc -p tsconfig.json` exit 0。未发现新增阻塞项；主会话已查看实际 probe/focused/typecheck 输出，不仅采信摘要。
- 最终 full check attempt 2：**1795 tests 全 PASS、exit 0**，包含严格 typecheck；相关生产代码此后未改。文档与规范补充不改变测试输入。
- `git diff --check` 与额外新文件行尾、local link、JSONL parse/existence 检查 exit 0。任务材料两次 staged diff check exit 2，因为实施记录尾部有多余空行；只移除 EOF 空行再复跑，不改变产品。最终 task validate exit 1 仍仅因为未用 implement manifest 为 0；check 的 14 条引用都存在，另有 7 条代码引用的提示性 warning，不记为 full validation PASS。

### 实际 Pi/core 隔离验证

执行：`python3 <owned-run>/real-core.py`，脚本和所有 raw JSONL/ANSI/stderr 只在 owned 外部目录。驱动使用 `hc server start --json`、`hc connect --session <unique>`，并在任何 terminal mutation 前比对 scratch core.json 与 start/server.status 的随机 core ID 和 PID。实际 endpoint 为 scratch `XDG_RUNTIME_DIR/herdr-core/<unique>.sock`，不是先前猜测的 default.sock。

actual managed launcher 返回 **Pi 1.5.0**，不同于已有 1.4.0 SDK fixture；本轮没有执行 Pi update 或修改版本选择。另只读核对现有 1.5.0 的 public Terminal 声明和原生 reporter，合同保持一致。实际终端证据明确标为 1.5.0，不能误记为 1.4.0 CLI 端到端。

环境与启动合同：

- macOS、hc 0.1.18、Pi 1.5.0、当前已安装 `@juicesharp/rpiv-ask-user-question` 2.15.0。
- 独立 HC_SESSION、scratch HOME/XDG/agent/cwd、notes=false；每个 Pi exec 再用 env -i 清除个人 provider credentials，保留本次 core 实际注入的 terminal ID/socket/scope。没有假造 ID、连接个人 t5 或默认 core。
- 原有 Pi CLI 显式 `--offline -ne -ns -np -nc --no-mcp --no-session --no-themes --no-builtin-tools --tools ask_user_question,probe_custom_tool --provider status-fixture --model fixture --thinking off --tui-mode <regular|fullscreen> -e <checkout-entry> -e <offline-fixture> -e <installed-rpiv-entry>`。固定 100×36，默认内置 theme；没有安装/下载 fd（offline 启动警告不影响本任务）。
- 模型由本地 scripted stream fixture 产生，不访问 online provider。标准确认与 generic/unknown custom 用本次实际 terminal keys；rpiv 问卷通过其公开 answer channel 回答或取消，明确属于真实第三方工具执行/peer 合同兼容证据，不冒充其键盘/物理输入全覆盖。
- 等待使用 events.subscribe、kqueue 的文件/过程事件与 select deadline；收到事件后查询 terminal.get，不固定 sleep 或轮询个人会话。provider 的本地 file gate 保持 Working，避免误把瞬时状态当稳定恢复证据。

失败、修正与复跑：

1. actual attempt 1 exit 1：驱动错误筛选名为 default.sock 的 endpoint，未启动 Pi。只关闭该 unique core；socket 定位失败是 fixture 问题。
2. actual attempt 2 exit 1：前五个真实观察（启动、未知 baseline、问卷 Blocked/Working/Done）成功，但在 render callback 后立刻读 core 的旧 frame，错误判定 generic text 缺失。主会话检查 raw ANSI 确认实际 producer 已写 GENERIC_CUSTOM_FIXTURE；不是产品不渲染。错误清理只 kill/remove 本次返回的 terminal。core.stop 返回时短暂仍有 core PID，不将当次清理算 PASS；复跑前 ps 已确认消失。
3. actual attempt 3 exit 0：全新 session/marker 目录，按 producer ANSI 写入与事件验证 generic；加入 process exit 观察后再 ps 核实。21 个观察通过，regular enabled 与 fullscreen disabled 均正常退出，无 remaining PID。
4. 最终 actual attempt 4 exit 0：扩展同一矩阵至 **regular enabled、fullscreen enabled、fullscreen disabled**，**37 个观察全部通过**，没有 error/forced cleanup/remaining PID；每个 Pi 都 reason=exited、exit_code=0，unique core 正常 stop。

最终可观察矩阵：

| 需求/边界 | 最终证据 |
| --- | --- |
| R1 新模型问卷与标签 | regular/fullscreen 均 Blocked、kind=question、msg=Auth method；实际 rpiv finally 解除后 Working，再 Done |
| R2 原生状态归属 | native confirm 为 permission/Native confirm；generic mounted/written custom 仍 Working；native Error 为 Offline fixture error 首行；自动化另验证 auth、压缩及问卷期间 latest Done/Error |
| R3 owner/配对与清理 | 自动化交错/重复/匿名与 rejection-reentry 通过；真实回答/取消、reload、新 session、normal exit 通过 |
| R4 原生协商与禁用 | actual terminal 迟到能力/restart cache fixtures 通过；fullscreen PI_PROGRAM_STATUS=0 全程 status=null、reported=false |
| R5 unknown/activation | 初始化的 explicit peer 不伪造 Blocked，保持 Idle；真实 idle reload 后 QUESTION_B（取消）及新 session QUESTION_C 均正确重新启用 |
| R6 原 socket/入口 | 原 9 条测试未改弱；互斥路由、新 manifest discovery 通过，socket 函数体未改 |
| R7 实际宿主证据 | actual installed SDK owner/cache 自然退出 + 现有 Pi 1.5.0/core 0.1.18 隔离真实工具链；不是只用 fake handler |

未运行：online provider、个人 Pi/TUI/core、物理 IME/鼠标、任意主题/动态 resize/未来 SDK、所有已打开问卷跨 reload 立即恢复；真实第三方问卷的完整键盘路径未验收。Pi 1.4.0 CLI 端到端未另运行（1.4.0 为实际 SDK fixture 层）；不将这些项目记 PASS。初始未知等待的安全漏报是已批准限制，不是借私有缓存补齐。

主会话已完整核实最终 report、必要原始错误与复跑输出、各 Pi stderr（为空）、所有 attempts 的 core/holder/Pi PID 均不存在，独立 review 已终结。随后仅删除 owned `herdr-state-dev.3gcvWD` 外部目录，cleanup exit 0，路径不再存在；原始 stdout/stderr、ANSI、RPC/marker、临时 driver 和 review probe 未写入仓库。任务保留 PRD/design/本实施记录、必要角色 manifest 与 task.json 共六份材料，无 raw evidence/research 附件。

### 提交检查点与状态

产品阶段提交：`55d16275aab501290dafd8f783fdf104524b3bf3`（`feat(herdr-state): supplement core questionnaire status`）。主会话核对实际提交仅包含 adapter/入口、四份回归源码以及耦合用户文档/规范，共 8 个文件；没有加入六份并行未提交改动。随后单独本地提交已筛选的六份任务材料，记录真实检查点和验证事实；这是授权实施记录，不是 archive/journal。

实施阶段结束时 task 保持 in_progress、active，等待用户验收与单独 finish-work 生命周期授权，未 push/改写历史/操作个人安装或会话。后续明确授权见下节。

## 10. 用户批准的收尾与推送

用户随后要求“收尾吧，然后push到远程”，验收当前 A 阶段并授权本次 archive、清除 task binding、journal 记录及非 force 推送。已重新核实检查点与 scoped diff，产品代码自最终 1795-test PASS、42-test 自然退出和 37 个实际终端观察后未变；不重复执行无输入变化的产品检查，也不将 task-validate 的空 implement 诊断记成 full PASS。

任务实际在 main 完成，未创建 PR。保留真实 branch/base_branch，不伪造分支或改写历史；使用 CLI 明确提供的 `archive --skip-branch-validation` 非 PR 任务选项。归档只包含本任务的六份已筛选材料，无 children、raw 输出或历史任务清理。journal 只写当前 developer workspace；按现有默认 session_auto_commit 自动提交，不混入六处并行未提交改动。

远程为 `origin`（GitHub AkiChase/my-pi-preset），目标 `main`；先 fetch 核实远端与本地历史，再普通 push，不 force、rebase 或 push 其他分支。push 后由 Git 远端引用核实结果；最终返回实际成功/失败状态。