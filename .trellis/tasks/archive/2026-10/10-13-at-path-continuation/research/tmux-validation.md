# @ 路径连续补全：真实 tmux 验收

## 结论

**PASS：本功能最小矩阵在真实 installed Pi CLI 的 dark/fullscreen 140、80、40列独立 session 全部通过。** 没有确认的产品失败；两次早期夹具 FAIL 已保留并分别复核，不把它们隐藏成一次全绿。

汇总：[tmux-validation.json](./tmux-validation.json)。独立清理复查：[tmux-cleanup-audit.json](./tmux-cleanup-audit.json)。此结论仅指下表真实输入/候选/提交行为，不是 IME、实际 input-history 或所有第三方组合兼容性背书。

本轮只新增当前任务 `research/tmux-harness/` 和验证证据/报告。没有产品代码修改、spec/PRD勾选改动、install/download/sync/reload、stage/commit/push/archive。产品唯一入口和5个模块逐轮前后 SHA256 全部相同，原有 git dirty 范围保留。后续综合和收尾交主会话。

## 环境、启动与隔离

- Pi **1.2.0**，Node **v24.14.1**，tmux **3.6a**，fd **10.4.2**，全部使用既有安装，只读；没有在线模型或下载。
- 每轮单独 `tmux -L at-at-tmux-<unique> -f <temporary>/tmux.conf new-session -d`，临时 HOME/USERPROFILE/XDG_CONFIG_HOME/PI_CODING_AGENT_DIR/cwd/sessions/raw/events，`env -i`；没有读取、复制个人 auth/settings，没有连接用户现有pane。
- 直接 `/opt/homebrew/bin/node /Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`。CLI显式 `--extension` 当前检出 `extensions/at-path-completion.ts` 和本任务 `probe.ts`；禁扩展/skills/templates/context/themes/MCP自动发现，`--offline --use-theme dark --tui-mode fullscreen --model at-offline/scripted --thinking off`。
- PATH只为了使用既有 Node/tmux/fd/系统工具，不读取目录里的个人配置。git全局配置禁用；fixture只有空 `.git/` 与 `.gitignore`，没有实际运行git。
- `probe.ts` 只通过公开 raw input、`getEditorText`、input/submit/before-agent-start和F9观察键记录。faux provider只对正常提交给本地 `OFFLINE_SUBMIT_OK`；**补全全部来自真实原生fd provider，没有替换候选、排序或apply，没有调用private请求或直接操作editor**。
- 每个字符分别 `send-keys -l`，等真实 after-input记录再输入下一字符，未用整段paste替代手输。Tab/Enter/Escape是真实send-keys；264个raw input事件/最终轮，bracketed paste marker=0。F9只在候选画面已完成后观察，不在目录pending阶段插入键来取消工作。
- 每轮启动的完整 env/CLI 命令及含 `-L/-f/-x/-y/-c` 的完整tmux命令保存在对应 `report.json.command`/`.tmux_command`，汇总JSON亦包含；不是省略参数的示例命令。

复现脚本：[driver.py](./tmux-harness/driver.py)、[probe.ts](./tmux-harness/probe.ts)、[summarize.py](./tmux-harness/summarize.py)、[audit.py](./tmux-harness/audit.py)。运行顺序：

```sh
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/driver.py --attempt first --width 140
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/driver.py --attempt minimal-fixed --width 140
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/driver.py --attempt matrix --width 140 --full
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/driver.py --attempt matrix-visible --width 140 --full
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/driver.py --attempt final --width 80 --full
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/driver.py --attempt final --width 40 --full
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/summarize.py
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/audit.py
```

已存在输出目录不会覆盖；重跑要用新attempt。早期两次命令是当时的夹具版本，后续脚本已修夹具；从第二轮起每轮输出另保执行时 driver/probe副本。

## 真实矩阵与屏幕

证据根目录：

- **E140**：[evidence-matrix-visible-140/report.json](./tmux-harness/evidence-matrix-visible-140/report.json)，9.05秒、error=null、exit0。
- **E80**：[evidence-final-80/report.json](./tmux-harness/evidence-final-80/report.json)，9.12秒、error=null、exit0。
- **E40**：[evidence-final-40/report.json](./tmux-harness/evidence-final-40/report.json)，8.98秒、error=null、exit0。

每个标签都有 `.txt` 和 `.ansi.txt` 文本捕获；后者保SGR。所有行PASS均检查屏幕和公开文本/submit，不以单独provider调用冒充实际输入。

| 项目 | 140 | 80 | 40 | 同名屏幕标签/断言 |
|---|---|---|---|---|
| ignored `local/` fixture手输到 `/`，不按Tab即候选 | PASS | PASS | PASS | `tab-before`为真实`@local/`菜单；`ignored-local-before/after`为关闭菜单后手输`@local/manual/`，显示SLASH_LEAF且文本不自动接受 |
| `@./dot/` | PASS | PASS | PASS | `dot-relative-before/after`，DOT_LEAF |
| `@../` | PASS | PASS | PASS | `parent-relative-before/after`，真实可见cwd/候选；保20cap和5个可见行原生行为 |
| `@~/scoped/` | PASS | PASS | PASS | `home-relative-before/after`，HOME_LEAF只在临时HOME |
| `@<绝对临时路径>/` | PASS | PASS | PASS | `absolute-before/after`，SLASH_LEAF；40列文本真实折3行仍能补全 |
| `@"space dir/`引号空格路径 | PASS | PASS | PASS | `quoted-before/after`，QUOTED_LEAF；手输未闭引号场景 |
| 菜单Tab接受目录后，单一子目录只展示 | PASS | PASS | PASS | `tab-before/after`，文本`@local/aa/`，菜单仅onlydir/，没有继续钻入，submit=0 |
| 菜单Enter接受目录后续提示，Enter不提交 | PASS | PASS | PASS | `enter-after`，同上；真实submit事件=0 |
| forceTab唯一目录接受后，只展示下一层 | PASS | PASS | PASS | `forceTab-before-close`只有aa/；Escape后`forceTab-before`菜单闭；真实Tab后`forceTab-after`文本`@local/aa/`、唯一onlydir/，不自动接受 |
| 文件接受关闭菜单并保native尾space | PASS | PASS | PASS | `file-after`，公开文本精确`@local/manual/SLASH_LEAF.txt `，菜单→SLASH_LEAF消失，未submit |
| Escape关闭后不反弹 | PASS | PASS | PASS | `escape-after`；先等真实关闭，再320ms条件观测，没有后续目录操作就不重开；forceTab后亦复验 |
| 普通Enter正常提交 | PASS | PASS | PASS | `normal-submit`，唯一submit为`ordinary offline message`，source=interactive；provider-request=1，返回OFFLINE_SUBMIT_OK |
| CLI宽度/退出/清理 | PASS | PASS | PASS | 初始raw完整对应宽border、真实自然exit0、PIDgone/server stopped/configremoved |

forceTab保持原生语义：`@local/aa`查询没有 `/` 的basename片段为aa，fd只匹配aa目录本身，不匹配onlydir子目录；真实菜单只有aa/。不需要过滤递归结果或制造候选。`local/aa/onlydir/`为空，所以接受aa后下一层恰好一个目录，这个目录仍未被自动接受。

真实80列Enter结果（节选）：

```text
────────────────────────────────────────────────────────────────────────────────
@local/aa/
────────────────────────────────────────────────────────────────────────────────
→ onlydir/                        local/aa/onlydir
```

真实40列引号结果（节选）：

```text
────────────────────────────────────────
@"space dir/
────────────────────────────────────────
→ QUOTED_LEAF.txt
```

文件后的尾space由公开getEditorText精确断言；capture文本末尾空白不可据肉眼判断。三个完整最终轮的事件均只有一次正常提交，没有目录Enter或文件接受造成提交。

## 宽度及原始流证明

每个宽度是**从启动时固定尺寸的独立session**，没有resize，不采用capture里被裁剪border长度判断收到resize。初始画面实际CLI raw stream包含140/80/40列完整border，pane_width和启动参数一致。原始流带synchronized output帧，完成标记数量逐轮相等：

| 宽度 | raw bytes | 完整宽border首offset | sync start/end | events |
|---|---:|---:|---:|---:|
| 140 | 101345 | 1141 | 278/278 | 561 |
| 80 | 68382 | 1081 | 275/275 | 561 |
| 40 | 46946 | 1041 | 282/282 | 561 |

保留每轮 `terminal.raw` 和 `events.jsonl`，没有图片截图或`/debug`截图声称。主题dark，80列SGR候选为`38;2;167;152;215m`；不推广到system/light背景或物理终端色彩应答。

## 两次夹具FAIL（原证据不删除）

1. [evidence-first-140/report.json](./tmux-harness/evidence-first-140/report.json)：**FAIL/exit1**，error=`Escape no rebound: candidate reappeared`。Tab菜单捕获正常；Escape后约4ms就读旧画面并抛错，event已收到Escape但render尚未完成。只修测试为“先等首次关闭画面，再320ms观测”，[minimal-fixed-140](./tmux-harness/evidence-minimal-fixed-140/report.json)最小矩阵PASS/exit0；后续三个完整轮同样通过。没有修改产品或Escape预期。
2. [evidence-matrix-140/report.json](./tmux-harness/evidence-matrix-140/report.json)：**FAIL/exit1**，error=`Timeout: parent-relative native candidates after slash`。`failure.txt`清楚显示`@../`真实菜单cwd/home/jiti/logs/agent以及`(1/20)`；夹具错误等待前5行以外PARENT_LEAF文件。改用实际可见第一项cwd/证明开菜单，未改排序、cap或产品实现；后续三个完整轮PASS。

早期失败均有error、traceback、失败捕获、非0退出码及清理记录。最小轮余项NOT_RUN不当作完整通过；汇总仅选三个真正完整执行的最终轮。此处没有确认产品红证据，主会话无需据夹具FAIL改产品。

## 清理、边界与NOT_RUN

六次实际启动的CLI都通过自己的真实`/quit`自然exit0，然后停止自己唯一`-L`服务，删除临时配置/工作目录。独立 `audit.py` 最后用OS ps和`tmux -L <each> -f /dev/null list-sessions`复查：PID **30287、49656、68146、84234、86101、86100** 均ps exit1且无stdout；六个服务均明确`no server running`；六个临时root均不存在。没有child/agent矩阵，故不以未启动child声称child清理。

所有持久证据约0.80MB，每个raw/events均远低于2MB硬界限；没有auth/settings/models/keybindings配置文件复制，日志内容都是本轮fixture输入/状态。用户现有pane、个人配置和安装未修改。

**NOT_RUN**：物理IME/attached-client键转发、实际input-history原包、任意第三方组合、闭引号前光标特殊位置、regular模式、light/system主题、动态resize、在线模型/agent矩阵、paste及快速async生命周期压力。这些部分不能用本轮真实tmux或既有离线fixture替代。40列原生footer的长cwd/统计截断属于当前SDK现有UI，此任务未改变也未对footer完整性验收。

主会话请按此限定结论更新任务验收说明并决定后续综合/提交；子代理本轮未stage/commit/archive。
