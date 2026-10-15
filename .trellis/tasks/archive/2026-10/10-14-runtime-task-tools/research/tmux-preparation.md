# tmux 夹具准备报告

## 状态

**PREPARED / NOT_RUN**。仅新增本 task 的 `research/tmux-runtime/` 夹具文件，没有启动 tmux、CLI 或最终验收，没有改动 product/tests/docs，没有提交、安装、sync、reload 或递归委派。已有任务的明确授权覆盖准备，不创建或激活新任务。

## 文件与执行命令

- [tmux-runtime/provider.ts](tmux-runtime/provider.ts)：原生 SDK faux provider，只决定真实 agent loop 的工具调用；生产注册、执行和 Beautify renderer 不替换。不访问私有 registry。
- [tmux-runtime/worker.py](tmux-runtime/worker.py)：真实本地 OS 命令源，condition gate、90 秒安全截止、PID 和退出原因记录。
- [tmux-runtime/driver.py](tmux-runtime/driver.py)：默认只显示准备命令。主会话确认实施 settled 后才显式执行：

```sh
python3 /Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools/.trellis/tasks/10-14-runtime-task-tools/research/tmux-runtime/driver.py \
  --run --implementation-settled --label main-first
```

输出为 `tmux-runtime/evidence-main-first/`，目录已存在则拒绝覆盖，保留初次失败。`--workflow` 可增加零 agent 的简单 script return；默认不运行 workflow。**尚未运行以上命令。**

## 收敛后的五组核心 gate

1. 真实 `task_manage list`：dark/fullscreen，140→80→40→140，实际 `C-o` 展开与收回；resize 必须在新 raw write 中找到以 `ESC[?2026l` 结束且 border 精确新宽的完整 frame，不能依赖 tmux 裁剪旧 screen。公开 UI observe 仅记录 expansion/idle，不调用 renderer。
2. 真实 `task_manage status` 不存在目标 error；`C-o` 查看已返回正文再收回。
3. 真后台 bash：公开启动身份→list→128 bytes output page→wait partial→实际 `/bg`→status/PID 仍 running→第二次 wait 返回 gate final；包含 search/stats 小检查。
4. 本地真实 child：`subagent_run` 使用临时自定义 agent（仅 builtin bash、extensions/skills false、isolation off）；explicit faux model 和 parent/default inherited faux model，两者都等待 `task_manage wait` 完整返回 24 行 `FINAL ANSWER`（逐全文包含检查），pending/current output 和 `C-o` 往返。父 runner 源码已有 parent modelRuntime 传递，不需第二 provider/server。
5. monitor：真实 flush stream→wait pending 不以首事件完成→实际 Esc 取消 retrieval→status 仍 running→stop 后 OS PID gone；另外 finite monitor gate→wait completed。不会依赖 agent completion notification 来判断完成。

## 隔离、等待与证据

使用现有 CLI 1.2 路径和 `/opt/homebrew/bin/tmux`，所有 tmux 调用统一限定唯一 `-L runtime-tmux-<unique>` 与临时配置；subprocess 环境也使用白名单。CLI 通过 `/usr/bin/env -i` 启动，临时 HOME/agent/cwd/sessions/logs/TMPDIR，无个人 auth、contexts、MCP、packages 或自动 resource discovery。仅 `-e` 加载本 fixture 与 **target** `extensions/beautify.ts` / `extensions/task-composition.ts`。无联网 provider，无 install。

condition polling 使用 monotonic deadlines + adaptive select 等待，150 秒全局截止；没有 `sleep N`。fixture provider child gate 使用 fs.watch＋abort＋deadline，在完成路径关 watcher/timer。公开 tool-result/update 和 `agent_settled` 判定执行，不依赖完成通知，不读取后端 registry。正常 output/wait 让 backend 自己消费结果，fixture 不写消费状态。

每步保留 text screen、SGR screen 和最近 64 KiB raw ANSI；总 raw 超 8 MiB 主动 FAIL，最终 raw tail 1 MiB/event tail 2 MiB 标明 original/stored/omitted bytes。所有 error/isError、case FAIL、driver_exit、source exit/signal 都记录；退出不是隐式 PASS。finally 先 `/quit`，记录 pane exit status、CLI PID gone；需要时仅信号 verified owned PID 且完整命令匹配（PID reuse guard），停唯一 server。有残留不删除临时目录。

## 已执行的准备检查

- Python `ast.parse` 检查两脚本：PASS。
- 已安装 TypeScript `transpileModule(... reportDiagnostics)` 检查 provider：PASS。
- **不是完整 typecheck、actual host load 或 tmux 结果**；没有加载 extension factory 来冒称验证。

已完整读取指定任务 PRD/design/implement、source testing/tmux 与其两历史报告，以及完整 provider.ts/minimal.py/terminal-fix.py；完整 installed Pi README、extensions/tui/sdk/custom-provider 和适用 linked CLI/config/settings/model/theme/environment/keybindings/security/tmux/message/session/package/MCP 文档。其余远端资料未联网。

## 未验证与可行性边界

- 产品正在并行修改，注册 schema/公开 envelope 要以主会话最终 source 为准。准备时核实 `task_manage action=list/status/output/wait/stop/search/stats`，target 用 `task_id/run_id`，`offset/limit` 为 bytes；launch identity 位于 `details.runtimeLaunch`；monitor 用 command/description/timeout_ms；subagent 用 prompt/description/subagent_type/model/run_in_background。fixture 没有额外假造 API。
- **child/monitor 是可执行候选，不是已通过**。若最终 SDK Esc 结果没有 runtimeTask 或子会话 modelRuntime 不可用，应保留 FAIL/NOT_RUN 并报告实际 envelope；不得改产品或放宽断言来让 fixture 绿。
- workflow 默认 NOT_RUN；零 agent script return 参数已据当前 schema 准备，只有 `--workflow` 时调用，不扩编排。workflow stop、复杂 nested child、subagent_message、WS、模型自主质量、其他 theme/mode、真实 mouse/IME 都 NOT_RUN。
- 当前 driver 保留 SGR/raw 供主会话查整行背景，**没有自动逐 cell 背景断言**；不能仅因出现 48m 就声称140/80/40连续背景通过。如首轮发现缺陷，先做 source/raw 定位再加必要的小专项，不扩成大 harness。
- 观察事件和 screen 捕获不是图片 screenshot，也不是实际 attached-client 物理输入全链路。仅真实 tmux send-keys 送入 CLI。

主会话先跑默认五组，读 `report.error`、cases、cleanup 和真实 raw/screen 后决定是否扩展。通知可靠性是独立 owner，本夹具不把该专项当验收阻塞或借机修它。
