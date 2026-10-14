# Session Name：隔离 tmux 真实 CLI 验收

## 结论

**PASS（限定范围）：140×40、dark/fullscreen 的真实 installed Pi 1.2.0 CLI 最小命名矩阵通过。** 最终轮 [report.json](./evidence-final-safe/report.json) `status=PASS`、`error=null`、exit0，16条细分断言通过；下表合并为10项行为。没有确认的产品失败。此前三轮夹具 FAIL 全部保留，不描述成首轮全绿。

本轮仅写本目录测试脚本/证据/报告与临时隔离目录；没有改产品、spec、README、PRD/lifecycle、SDK、个人配置，没有 install/sync/reload/commit/push/managed dispatch。7个实际产品源码文件（entry、3个session-name模块、2个shared模块、status-bar）每轮前后 SHA256 均一致，完整 hash 在各 report 的 `product_hashes_before/after`。

## 隔离与复现

- 既有 Node v24.14.1、tmux 3.6a；唯一 `tmux -L name-name-tmux-<unique>` 服务，从不连接或关闭现有用户服务/pane。
- 临时 HOME/USERPROFILE/XDG_CONFIG_HOME/agent/cwd/sessions/logs/TMPDIR，`env -i` 不继承凭证；仅临时 `settings.json` 禁compaction并固定dark。没有复制个人 auth/settings/models。
- 直接执行 `/opt/homebrew/bin/node /Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`；显式加载当前源 `extensions/session-name.ts`、`extensions/status-bar.ts` 和 test-only probe。`--offline --no-approve --no-extensions --no-skills --no-prompt-templates --no-context-files --no-themes --no-mcp --use-theme dark --tui-mode fullscreen --tools read --model name-offline/scripted --thinking off`。
- **完整、实际 env-clean/CLI/tmux 命令**（含所有临时绝对路径、`-L/-f/-x/-y/-c`）保存在各轮 report 的 `command`、`tmux_command`，不把省略参数示例当实际命令。
- [probe.ts](./probe.ts) 注册 SDK native faux provider，仅通过system数据辨别主请求/命名请求，安排正常、失败、hold/late响应；没有自写HTTP、认证、网络，也没有替换产品状态/计数/命令。主输入真实经CLI agent循环；标题真实由产品写session。请求日志只存次数/身份/等级/fixture标题，不存正文payload或凭证。
- 真实 `tmux send-keys -l` 输入与 Enter/Escape/Down/Ctrl-U/F9；不是直接调用命令或改editor。斜杠参数补全菜单先Escape关闭再Enter提交。最终639条raw input事件，零paste包装；F9仅公开只读观察补充标题/metadata，**可见失败与配置断言必须来自真实capture**。
- `capture-pane -p` 与 `capture-pane -p -e` 成对保存文本/SGR，不是截图。`PI_TUI_WRITE_LOG` 保存原始写流；最终raw 134141 bytes、132/132完整sync帧。
- 条件循环使用monotonic deadline + 20ms select轮询，条件满足立即返回；没有固定sleep等待。最终轮5.24秒；四轮CLI累计42.50秒（不含读规范/夹具分析），没有展开其他宽度或agent矩阵。

运行顺序（按当时版本；后3轮保存执行时driver/probe副本）：

```sh
python3 .trellis/tasks/10-14-builtin-session-name/research/tmux-validation/driver.py minimal
python3 .trellis/tasks/10-14-builtin-session-name/research/tmux-validation/driver.py keyboard-fixed
python3 .trellis/tasks/10-14-builtin-session-name/research/tmux-validation/driver.py final
python3 .trellis/tasks/10-14-builtin-session-name/research/tmux-validation/driver.py final-safe
python3 .trellis/tasks/10-14-builtin-session-name/research/tmux-validation/audit.py
```

复现使用新attempt名称，已有证据不覆盖。脚本没有把catch后exit0当成功；最终exit取error、source hash和真实清理结果共同计算。

## 最终真实矩阵

证据目录 [evidence-final-safe](./evidence-final-safe/report.json)；每个标签有 `.txt` 和 `.ansi.txt`。

| 行为 | 结果 | 核心证据/断言 |
|---|---|---|
| 1. 初始实际用户输入→自动标题 | PASS | `initial-auto`；主request1、命名request1，footer `Initial Offline Goal`，进度count/evaluated1 |
| 2. `/session-name` 手动可见成功 | PASS | `manual-success`，真实通知 `Session name: Manual Offline Refresh`，实际title entry |
| 3. config默认及取消 | PASS | `config-defaults`实际select `automatic on, N=8`；Escape后disk仍不存在 |
| 4. config全局关闭、N变更、重新启用 | PASS | `config-disabled`、`config-interval-dialog`、`config-interval-saved`、`config-enabled`；实际键选择/input，保存通知可见，disk逐次false/8→false/2→true/2 |
| 5. 自动关闭不请求 | PASS | `auto-disabled`；已交付用户input确实settled/count+1，命名次数不增，旧标题保留 |
| 6. N=2第一轮不提前、第二轮恰一次 | PASS | `n-first-no-early`、`n-second-evaluated`；手动baseline后首输入无请求，第二输入title `N Round Updated` |
| 7. native `/name`保护，手动成功恢复自动 | PASS | `native-name`、`native-protected-two-inputs`、`ownership-resumed`；保护时两输入无命名，显式成功后两输入再次自动评估 |
| 8. 自动失败可见/保留旧名，N个新输入后重试 | PASS | `visible-failure`实际完整英文error，footer仍 `Ownership Resumed`；`failure-first-no-retry`无早请求，`failure-retry-success`第二新输入成功，不在同settled边界忙重试 |
| 9. 新输入与native `/new`取消迟到响应 | PASS | `late-input-canceled`、`session-replacement-canceled`；请求8/10 signal aborted，随后实际late return标aborted=true，两旧标题从未写入；新sessionId、空标题footer。新输入可以在下一个settled边界重新评估，新的request9合法提交 `Fresh After Cancellation`，不误把它当旧响应 |
| 10. 跨会话全局配置及自然quit/清理 | PASS | `global-config-new-session`；同一temp agent disk true/2，新会话初轮实际生成新标题；最终自身 `/quit`自然exit0，PIDgone/server stopped/rootremoved，audit独立复查 |

可见失败节选：

```text
Error: Automatic session naming failed; previous title kept. Will retry after 2 more user inputs.
…/cwd  • Ownership Resumed
```

最终日志关键因果：request8 abort→late return(aborted=true)，request9为新输入后新调用；request10 abort→旧session_shutdown→新session_start→request10 late return(aborted=true)，未出现旧标题写入。**这验证了协作native faux signal与真实CLI生命周期，不承诺非协作在线provider必然终止底层promise。**

## 保留的三轮夹具失败

1. [minimal/report.json](./evidence-minimal/report.json)：FAIL/exit1，3断言PASS，`error=Timeout: actual select menu`。`failure.txt`停在 `/session-name config` 编辑框，首Enter接受参数补全而未提交；清理Escape/Ctrl-U合包也未正常quit，最终仅TERM自身PID961清理。只修测试为按key after-input等待、Escape关闭补全后提交。该轮不声称自然quit成功。
2. [keyboard-fixed/report.json](./evidence-keyboard-fixed/report.json)：FAIL/exit1，13断言PASS，`error=stale not visible`。events证明旧request8已经abort且late return aborted=true，但fixture在新输入settled产生的request9仍安排同一hold标题，该**新合法请求**提交了 `Stale Must Never Commit`。只修fixture：新输入前先设置新请求的不同正常响应，旧hold请求仍使用其捕获标题；不改产品或stale预期。该轮自然quit0。
3. [final/report.json](./evidence-final/report.json)：FAIL/exit1，14断言PASS，`error=Timeout: key processed Enter`。`failure.txt`完整堆栈为probe的setImmediate读取旧 `ctx.ui`，native `/new`已session_shutdown导致SDK拒绝stale ctx并退出1。只移除probe延迟ctx读取，保留无需ctx的after-input事件；F9观察仍使用当前ctx。该轮程序已异常exit1，不声称自然quit0。后续final-safe完整通过。

所有fixture失败保留error/traceback、原始流、输入日志和失败capture；不能据这些错误修产品。早期minimal没有保存执行时driver/probe副本，其实际命令/日志仍保留，当前脚本不能复现其原始bug。

## 清理与边界

[audit.py](./audit.py) 实际重新检查四个PID **961、5210、9754、19043**，`ps`均exit1且无stdout；四个唯一 `tmux -L … list-sessions`明确 `no server running`；四个temp root不存在。汇总 [cleanup-audit.json](./cleanup-audit.json) `status=PASS`。最终轮真实quit0；早期两个非自然退出如上单独记录，不被audit清理成功掩盖。

全证据约1.1MB，每个raw/events <1MB；只保存有界文本、metadata和响应标签，不复制临时auth/settings/models/session原文。凭证模式扫描无命中；不以扫描证明任意未来日志都安全。

**NOT_RUN**：在线命名质量/成本、120秒总deadline、物理键盘/IME/attached-client转发、其他主题/regular/窄列/resize、branch导航/compaction上下文、同名评估进度、工具循环计数、排队steering/follow-up、第三方扩展组合与并发手动刷新。默认N=8在真实配置UI验证，频率动态行为为N=2加速测试；不声称跑了8轮默认阈值。仅新会话首次自动命名证明配置被沿用，没有再跑新会话N=2第二次阈值。

主会话可据限定结论补验收说明并决定后续；子代理未改PRD验收勾选或生命周期。
