# 终端缺陷定向修复报告

## 结论与修改边界

本轮修复 F1；F2 的原屏幕失败已复现，但完整 raw write 对照证明是夹具 resize 等待误判，不是 summary 在 38 列内宽输出残缺 hint。修正测试 barrier 后，真实 CLI 40 列 hint 完整省略。生产修改只有 `extensions/beautify/layout.ts` 的纯文本截断边界，未注入任何背景色，未修改 SDK、执行后端、全局展开设置或宽度策略。新增 `terminal-layout.test.ts` 和本 task research 材料。

AC 保持 main 当前状态，本报告不代替独立 check。未 stage/commit/push/install/sync/reload/archive，未触碰并行 README、host-loading-smoke、at-path、.pi 或 main testing spec 插入。

## 已核 actual pipeline

只读核 Pi 1.2.0 installed `pi-tui/dist/utils.js` 的 `truncateToWidth`、`finalizeTruncatedResult`、`visibleWidth`；`components/box.js`、`components/text.js`；`pi-coding-agent/dist/modes/interactive/components/tool-execution.js` 和 theme `fg/bg`；`tui-alt-screen.js`、`layout.js`、`ProcessTerminal` resize/write。没有改 SDK。

- `truncateToWidth` 对纯 ASCII 截断也调用 `finalizeTruncatedResult`，后者在无 marker 时仍追加 `ESC[0m`。
- `middlePath` 用这个函数截取 head 后再拼省略号/tail/suffix；`summary` 还用它裁 metadata。`theme.fg` 只追加前景 reset `39m`，不修复内部 full reset；host Box 只在整行最外层打开背景并在行尾关闭。因此 head 内部 `0m` 使省略号、尾部、metadata 及右侧空格丢背景；metadata 内部 reset 同样使剩余 padding 丢背景。tmux 转录将 full reset 分解为 `39m49m`，与原 F1 一致。
- actual ToolExecutionComponent 为 default shell 设置唯一 Box/outputPad；140 列时 renderer 得到 138 内宽，40 列时得到 38。Text 的自有 wrapping 不参与我们的 default renderer call/result；expanded/fallback legitimate ANSI 仍走原 `clip`，本轮没有通用清除 SDK/Shiki 样式。
- 新 `clipPlain` 仅对已清理的标题 head 和 stats 做 `clean(clip(..., ""))`。SDK 显示列截断算法保留，仅消除纯文本中由 SDK 额外引入的 terminal controls，然后再由现有 `fg` 与宿主 Box 各自拥有前景/背景。

## F2 复现与根因复核

1. 未改生产时，`tmux-harness/f2-repro.py` 是原 driver 的有界 Read-only 截取，保原 CLI flags、fullscreen、dark、140×60→80×60→40×60→140×60，以及 Ctrl+O 往返。
2. `terminal-fix-f2-repro/report.json`：`error=null`，hint40 **FAIL**，屏幕确实为 `sample.ts:3  40 lines · limited · ctrl`；其他原 driver 单行判断虽 PASS，但不能据此说 hint 合格。
3. 该轮 `terminal.raw` 的同步 frame：最后 shrink 发出的工具行仍有 **80** 列 padding、完整 `ctrl+o expand`；没有发出 40 列重绘。80 列 border 也被 tmux 裁成 40 个 `─`，所以旧 `len(border)==width` barrier 立即通过。随后 Ctrl+O 同样可能在 CLI 的旧 dimensions 下完成；tmux 屏幕裁短不证明 host 已收到 SIGWINCH。
4. `f2-observed.py` 只加 public `registerToolRenderer` 委托观察，不改输出；其 `widths.jsonl` 记录 Read call 内宽 **38**，返回 `sample.ts:3  40 lines · limited`。对应 raw stream 存在真正 40 列完整 frame，屏幕 PASS。观察文件写入改变时间，所以不以这一轮掩盖原 FAIL。
5. 最终 runner **不加载 observer**，resize 后等待 terminal.raw 中新写出的、以 `?2026l` 结束的 frame 内恰好新宽度的完整 border（负向前后断言，不能从 80 个中匹配末尾 40 个）。只在这个证据成立后开始 Ctrl+O 和 capture。未修改产品预算、硬减列数或读取 stdout.columns。

F2 不需要新的“先红后修产品”断言：actual fullscreen host 的 140→80→40→140 hint test 在未修 F1 时已经 PASS，正是原 hint 布局正确的对照。F1 则有真正产品红测。

## 红／绿自动回归

`terminal-regression-red.log`：未修 `layout.ts`，**1 pass / 3 fail**。terminal-effective SGR interpreter 逐打印 cell 跟踪背景，分别发现长 Bash 省略处、长路径 Read ENOENT 省略处、只裁 stats 的右侧 padding 背景变 default。不是仅检查有无 `48m`。Read fixture 初稿 ENOENT 太短，没有发生缩略；该 fixture 错误单独发现后改为临时路径长度再重跑，最终红日志三处都是有效背景断言失败。

`terminal-regression-green.log`：最小 `clipPlain` 修复后 **4/4 PASS**。背景检查覆盖每行140 cells（含左侧／右侧 padding、metadata），fullscreen 检查实际 TuiAltScreen→layout→host ToolExecutionComponent→Box→final width clamp 最新 emitted frame；40 列不含 `ctrl`，80/140 列完整 `ctrl+o expand`，expanded含MARK_42，收回最新 frame 不含MARK_42。单元 seam 不声称是真实键盘；真实键盘另见 tmux。

## targeted tmux green

命令：

```sh
python3 .trellis/tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/research/tmux-harness/terminal-fix.py green
```

复用既有 `minimal.py`/`driver.py` 的 installed CLI、offline provider 和临时 fixture，只有 Read、长 Bash、Read error 三种调用，不启动子代理／模型／网络。unique `tmux -L`，`env -i`，临时 HOME/agent/cwd/sessions/log，显式 `--tui-mode fullscreen --use-theme dark`，无自动发现、认证复制或现有 panes。现有 PATH 指向已安装工具，不执行安装。

最终 `terminal-fix-green/report.json`：**9 cases PASS，error=null，exit0，2.09秒**。

- Read resize 80/40/140：完整 hint／整项省略／完整 hint；每宽真实 `tmux send-keys C-o` 展开含MARK_42再收回，有 raw frame 宽度 barrier。
- Bash140 collapsed/recollapsed：title 有 `…`，每一打印 cell 和行尾 erased cells 都保持 success RGB(37,65,49)，`bad_columns=[]`，整块仅1个有效文字行；Ctrl+O 展开BASH_LINE_29再收回。
- Read ENOENT140 collapsed/recollapsed：`mis…-file.ts` + error metadata，同样全140列 error RGB(91,40,42)，`bad_columns=[]`，整块仅1个有效文字行；Ctrl+O 展开 ENOENT 正文，再收回。
- 原始文本＋SGR screen：`terminal-fix-green/{bash,read-error}-140-{collapsed,expanded,recollapsed}.{txt,ansi.txt}`，`read-{80,40,140}-{collapsed,expanded}.{txt,ansi.txt}`；完整原始 CLI writes 为 `terminal.raw`，事件、session transcript 与实际 command/cleanup 同目录。
- tmux `capture-pane -p -e` 是文本屏幕／SGR，不是图片。parser 跨行跟踪 SGR，补齐 capture省略的尾部空格时使用行末真实active bg，非仅搜索48m。
- `/quit` 自然退出，CLI PID81113经ps确认gone；自己的server stopped；临时配置已删除。最后 ps 过滤未发现本fixture存活进程。

保留初次 `terminal-fix-red` probe 的夹具 timeout（错误复用旧 `New session started` 文本导致下一 CASE 过早发送）；该 report.error 不是产品 PASS。最终 runner 用新的 session-start event boundary。初次脚本缩进错误未启动CLI，已修fixture。本报告不以任何exit0掩盖report.error。

## 自动最终验证

实际 installed SDK只读路径由当前 node_modules realpath获取，每次gate批次临时 `PI_CODING_AGENT_DIR`，结束删除；不访问个人配置。最终三命令在同一临时目录依次运行，均成功。

- 定向 `node --test extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/agent-tasks/__tests__/loading.test.ts scripts/pi-manifest.test.mjs scripts/sync.test.mjs`：**92/92 PASS**，自然退出，`terminal-focused.log`。
- `pnpm check`：strict typecheck PASS、全量 **671/671 PASS**，`terminal-strict-full.log`。
- 完整无force-exit `node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"`：**671/671 PASS**，自然退出，`terminal-full-natural.log`。
- `git diff --check` PASS；无独立 lint 命令。

总数包含当前并行 checkout 的测试，不能与先前606直接相减当本task新增数。本task新增4项。初次gate full660/660；最后断言收敛后重跑为671/671（并行at-path新增测试），以最终日志为准。

## 限制

只定向 dark/fullscreen 的实际 terminal 背景及 hint/键盘。没有重复长六工具矩阵、真实get_result child、其他jobs action、pending专项、light/system、regular、image、物理鼠标/attached-client链路、真实input-history或任意插件组合。先前材料的 NOT_RUN 保留，不将自动host等价fixture或targeted green声称成这些实际终端范围通过。错误summary本来允许裁错误文案，完整已返回内容在展开；本修复不改变这个协议。最终用户AC决定、独立审查、提交/归档均由main处理。
