# 真实 tmux/Pi 终端验收（收敛版本）

## 结论

**FAIL，不能称背景验收全部通过。** 原四工具的成功结果已在真实 CLI 验证整块单行收缩与 Ctrl+O 往返；可选 `jobs list` 的真实后端也通过单行及展开往返。长标题存在新的背景断裂，40 列提示也有截断。仅记录，不修改产品代码。

机器汇总：[`tmux-validation.json`](tmux-validation.json)。原始过程 report 不等于全量验收，存在夹具超时/失败；不能因为 minimal.py exit 0 就跳过 report.error/cases 检查。

## 环境与隔离

- installed Pi **1.2.0**，tmux **3.6a**；现有 fd **10.4.2**，rg **15.2.0**，未安装。
- 直接 Node 调用既有 `.../releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`，没有使用 SDK 组件模拟。
- 每轮独立 `tmux -L beautify-<unique> -f <temporary>/tmux.conf new-session -d`；不连接用户 panes，不使用无 `-L` 的 kill-server。临时配置使用 extended-keys on / csi-u、fullscreen，尺寸 140×60、80×60、40×60；最小轮 140×50。
- `env -i` 只提供临时 HOME、PI_CODING_AGENT_DIR、sessions、cwd、logs 和必要 PATH/终端变量；不复制个人 auth/config。只读使用已安装的 CLI/fd，PATH 不是认证复制。
- CLI 禁 discovered extensions/skills/templates/themes/context/MCP、开启 offline/skip-version/telemetry off；显式加载本检出 `beautify.ts`、`task-composition.ts` 与 test-only provider。
- 默认 system theme 在没有颜色应答的终端会无背景；因此本轮显式选 **dark**，不能把 dark 的结果声称成 system/任意主题结果。
- SDK 原生 faux provider 只控制工具调用顺序。read/find/grep 实际读临时文件，bash 实际执行本地 OS 子进程，jobs 实际生产 backend。不是模型自主质量或线上 provider 验证。没有实际 child agent 启动，本轮该项 NOT_RUN。

完整启动命令分别保存在 [`tmux-evidence/report.json`](tmux-evidence/report.json) 和 [`tmux-minimal/report.json`](tmux-minimal/report.json)。复现脚本是 `tmux-harness/provider.ts`、`driver.py`、`minimal.py`；driver 保留已发现失败，不会更改生产以适应预期。

## 实际 PASS

| 项目 | 实际证据 |
|---|---|
| Read `sample.ts:3` 返回40行，单行40 lines/limited；Ctrl+O完整已返回正文＋行号/语法前景，再收回 | `tmux-evidence/read-{collapsed,expanded,recollapsed}.*txt` |
| Find 实际32个文件，单行32 files shown；展开含match-31.ts，再收回 | `find-*.txt` |
| Grep 实际48行匹配，单行48 matching lines shown；展开含MARK_48，再收回 | `grep-*.txt` |
| Bash 实际30行＋普通后台关键词，单行输出行数，没有误报后台ID；展开BASH_LINE_29再收回 | `bash-*.txt` |
| Bash 实际exit7与30行输出，error背景、单行关键错误，展开含ERROR_LINE_29 | `bash-error-*.txt`；未单独以屏幕条件验证该次recollapse，完整普通bash往返已做 |
| Read missing-file实际ENOENT结果，屏幕仅一行文字 | `read-error-collapsed.txt`；夹具因为主标题被缩略搜不到全名中断，人工核实；展开未跑 |
| pending/success/error三色存在且不同 | pending `48;2;52;56;58m`，success `48;2;37;65;49m`，error `48;2;91;40;42m` |
| Read实际140/80/40 resize保持一行，真实Ctrl+O显示/收回正文 | `read-width-*.txt`；提示完整性单列FAIL |
| 鼠标padding不展开，收缩正文展开，展开代码正文收回 | `mouse-{before,padding,body}.txt`；是实际SGR stdin，不是handleMouse组件调用 |
| optional jobs list实际空registry：`jobs list 0 jobs · ctrl+o expand`，展开`No background jobs`再收回 | `tmux-minimal/jobs-list-{collapsed,expanded,recollapsed}.*txt` |
| `/quit`正常退出；pending实际OS PID gone | 每轮report cleanup和最后ps检查 |

### 键盘／鼠标输入证据的边界

Ctrl+O通过 `tmux send-keys ... C-o`，Pi公开 `onTerminalInput` 记录到 CSI-u `\u001b[111;5u`，实际屏幕变化验证。没有直接调用编辑器/ToolExecutionComponent API。

鼠标通过 `tmux send-keys -l` 把完整 SGR press/release（如 `\x1b[<0;5;9M...m`）送入 CLI stdin，实际 host fullscreen鼠标命中并改变屏幕。不是物理鼠标，也不是attached terminal client→tmux forwarding全链路测试。Pi fullscreen先消费鼠标，公开input observer看不到这些event；这不是鼠标失败。首次误等observer造成夹具超时，原证据保留。

`capture-pane -p` 是**文本屏幕捕获**，`-e` 保留 SGR样式；不是图片截图。`host-debug.log` 是 `/debug` 的渲染行/会话诊断，**不是屏幕截图**。

## 实际 FAIL（产品修复停止，等待main处理）

### F1 长标题在省略号处失去后半行背景

文件：[`tmux-evidence/bash-collapsed.ansi.txt`](tmux-evidence/bash-collapsed.ansi.txt)

工具背景先打开：

```text
ESC[48;2;37;65;49m
ESC[38;2;167;152;215m$ python3 -c "print('\\n'.jESC[39mESC[49m…ange(30)));print('Job ID background job /tmp/pi-bg/example.log')" ... 32 output lines ...
```

`ESC[49m` 在省略号前复位背景，后面的标题、元数据和空白没有重新打开 success background。**有外壳背景不等于整行背景连续**。Read error 主标题缩略 `mis…-file.ts` 同样出现 `39m49m`，后半行错误背景丢失，见 `read-error-collapsed.ansi.txt`。已只读定位可能相关路径为 `middlePath` 使用 `clip/truncateToWidth`，但本轮没有修复或宣称根因修完。

### F2 40列展开提示被截断

文件：[`tmux-evidence/read-width-40-collapsed.txt`](tmux-evidence/read-width-40-collapsed.txt)

```text
 sample.ts:3  40 lines · limited · ctrl
```

仍是一行，但要求hint空间不足整项省略，本行却显示半个hint。实际140→80→40 resize后通过终端border宽度和Ctrl+O往返保证不是仅截旧screen。不能把“没有第二行”同时判成“窄屏metadata/hint全部正确”。

## NOT_RUN

- get_subagent_result normal/verbose/running/wait release实际child：未启动child。
- jobs output/search/stats/attach partial/final/release/kill：只做list，未跑完整矩阵。
- Find/Grep错误展开、全部六工具全部宽度、image attachments、任意第三方组合、真实input-history、regular模式、light/system主题。
- 没有额外poller/agent/ui私有registry读取；有公开session observation仅供测试。

用户指出慢后明确收敛到原四工具＋一个可选工具，不再延长复杂agent/attach夹具。本轮NOT_RUN不能由先前unit/host组件测试替代真实终端通过。

## 夹具失败和过程保留

- attempt1：tmux capture ANSI跨行背景保留，parser错把标题行当无背景；环境PATH最初找不到fd。改测试parser/只读指向现有fd，不动产品。
- attempt2：错误等待公开输入观察器记录鼠标，fullscreen已经在其前消费；实际键盘已通过。
- attempt3：鼠标收回点击标题的即时布局/位置不稳定；添加真实输入barrier并改为展开代码正文点击后通过。原超时不冒称通过。
- attempt4：遇到长Bash标题ANSI reset，记录产品缺陷，未修复。
- attempt5：parser把行首49m之后assistant CASE_DONE错误并入工具background；修测试parser，原证据保留。
- 主 `tmux-evidence/report.json` 最后停止于Read error缩略后夹具找不到完整文件名；这不撤销已有单行/背景缺陷证据。
- `tmux-minimal/report.json` 无error，四项PASS，只支持最小jobs/pending，不支持完整六工具矩阵。

## 清理与修改边界

所有test CLI均通过自身 `/quit` 自然退出。temporary HOME/config/session工作目录已删除；自己的tmux server已关闭。pending PID20554最终gone。最后 `ps -axo pid,ppid,command` 未发现验证fixture存活进程（过滤当前检查进程），不以临时shell session文本冒充OS清理。

仅新增本task research harness/evidence/report，无生产代码、个人安装、sync、reload、stage、commit或push。生产diff前后仅发现并行 `at-path-completion` 任务修改 README/host-loading-smoke.mjs，明确未回滚。Beautify/task-composition/.pi/spec生产diff与基线不变。未修改验收勾选或spec，由main决定如何记录本次失败及后续修复。

证据总体约1.45MB，保留完整有界raw streams、局部screens、transcripts和reports；无凭证复制。
