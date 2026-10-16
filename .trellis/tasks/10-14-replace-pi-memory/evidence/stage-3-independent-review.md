# 阶段3独立审查

2026-10-15，trellis-check；Review base `d0fada7`，共享 source/main。范围：memory 入口、command/panel/preview、新测试及既有 storage/tools/prompt/actual loader 回归。已读取注入的完整 approved artifacts/specs/preflight/implementation evidence、check.jsonl 全部8条及实际源码/测试。`git diff d0fada7 HEAD` 只有并行 Task Panel 规划，不是 memory 阶段3代码；已识别并排除，未修改。index为空；阶段3为 unstaged/untracked 候选，不把空 committed memory diff 当无工作。

## 发现与自修

1. `command.ts:53–75`：SDK `showExtensionCustom` 在 factory 返回后的 microtask 才安装 overlay，但 done 即使安装前也执行 `ui.hideOverlay()`。原实现 setup/shutdown 提前 done 会关闭另一个 overlay，且 SDK closed 分支不 dispose 尚未赋值的 component。改为记录 closeRequested，通过公开 `onHandle` 安装通知后才结束 owned done；不调用 handle.hide、不修改SDK。新增直接调用 **installed InteractiveMode owner**、真实未启动 `TuiMainScreen` 的测试，取消发生在 factory 返回到安装 microtask 之间：其他 overlay/focus 保留、component 恰好dispose一次、主编辑器setText零次。只在测试 Reflect 访问 SDK owner 方法，不将内部接口引入产品。
2. `panel.ts:84–95`：过滤退出后 Input.focused 直到下次render才清，空 query 时甚至不再进入该render分支。即时传递 filterMode/focus；Enter/Esc/Ctrl+C退出后无cursor marker。
3. `panel.ts:146`：SDK Input 在仅余1列且cursor位于宽Unicode grapheme前可能返回超宽行；原过滤行未经最终fit。保留Input原生编辑与marker，对render结果终端列截断。新增过滤模式width1–120、height1–30及resize断言。
4. `panel.ts:137`：disabled/no revision/unavailable详情仍提示可编辑/删除。现在仅 enabled 且完整revision显示 e/d，其他显示read-only；按键安全门保留。
5. `preview.ts:33–42`：尾部UTF8裁剪只按序列长度，错误地吞掉不完整但已经非法的overlong/surrogate/>U+10FFFF前缀。只裁有效UTF8前缀；E0/ED/F0/F4错误第二字节安全拒绝。补有效/非法边界矩阵；内部invalid bytes既有回归保留，store.read及工具预算未变。
6. `preview.ts:58–60`：整个project目录缺失的ENOENT原归普通权限错误。新增固定英文missing诊断，与corrupt/capacity/permission不同，不回显raw OS message/path；相应command断言加强。

仅修改上述三个产品文件和 `panel.test.ts` / `command.test.ts`。已有阶段3入口/loader/prompt/tools fixture改动保留；其余并行文件未编辑。新测试fixture增加onHandle通知，贴近真实公开合同；不以同步fixture替代installed owner微任务回归。

## 核验合同

- command owns effects；panel snapshot/render/handleInput 无文件IO、await、global listener、editor replacement。一个operation admission；每await与write/forget/config效果/reopen前校验token/origin/cwd。旧completion finally不能清新operation，session_start/shutdown关闭旧custom。custom done后才editor/input/select/confirm。刷新显式，无watcher/background model。
- list local filter/selection/viewport，详情返回保持；实际theme/Markdown/hidden ScrollView有界正文布局与clamp；已核SDK ScrollView render返回全content、updateLayout/scroll状态合同。这是批准的memory设计，不套用并行Task Panel的新native-layout/鼠标需求。
- oversize最多读取TOPIC_BYTES+1，完整read先拒绝size，安全openRead复用private path/regular/nlink/ancestor验证；preview无revision/read-only，secret/metadata/UTF8失败不显示正文，未读范围不宣称检查；不改变store.read/工具语义。
- disabled可读但所有mutation仍store-gated；cancel不写、精确revision冲突、partial publication有明确后果；PublishedError重新读disk确认enabled并warning。nonTUI status/list/on/off/help不custom；actual AgentSession.prompt命令dispatch回归provider0/messages0。阶段1/2 actualSDK多轮/resume/custom-triggered/loader全保留通过。
- 完整读取SDK公开ExtensionUIContext及实际custom/select/input/confirm/editor owners。`ui.input`第二参数实际是placeholder，不是prefill；当前用于提示旧description，需要用户输入新description，未声称原生input已经填值。`ui.editor`是公开多行dialog而不是主editor替换。

## 首失败与最终验证

Node24.14.1，pnpm10.33.0，installed SDK1.2.0，未下载/安装。每轮自建 disposable `PI_CODING_AGENT_DIR`，结束清理仅自己的目录；日志未改写。

- `stage-3-independent-ui-first.log`：FAIL，19/20，测试错误将TUI类型当运行时constructor；修fixture使用公开TuiMainScreen。
- `stage-3-independent-ui-second.log`：PASS，自然exit0，20/20。
- `stage-3-independent-focused-first.log`：PASS，自然exit0，58/58。
- `stage-3-independent-check-first.log`：FAIL exit2，新增other Component fixture漏invalidate，strict未进入fullsuite；补真实Component必需方法。
- `stage-3-independent-focused-final.log`：**PASS，自然exit0，58/58**，最终版本。
- `stage-3-independent-check-final.log`：**PASS exit0，strict typecheck + full831/831**，含manifest/sync；package full使用force-exit，不作为自然退出证明。
- `git diff --check` exit0；22个memory源码/测试（含untracked）逐行无trailing whitespace；check/implement JSONL解析及所有file存在PASS。
- 驱动41462/45835及匹配自有临时agentDir/test command的进程在完成后 `ps` 无残留，final后台任务已真实退出，不是仅promise/terminal metadata。
- 独立lint命令不存在：Lint NOT_RUN。

最终精确执行（driver45835，SDK=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules；temp agentDir tmp.HBeAqrtFCj已清理）：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))))')" || exit 1
agent_dir="$(mktemp -d)" || exit 1
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/memory/__tests__/*.test.ts > .trellis/tasks/10-14-replace-pi-memory/evidence/stage-3-independent-focused-final.log 2>&1
focused=$?
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check > .trellis/tasks/10-14-replace-pi-memory/evidence/stage-3-independent-check-final.log 2>&1
check=$?
rm -rf "$agent_dir"
echo FOCUSED_EXIT=$focused CHECK_EXIT=$check
test "$focused" -eq 0 && test "$check" -eq 0
```

## 未解决/不能扩大承诺的边界

- SDK `ui.editor(title,prefill)` **没有AbortSignal或public close**。shutdown时插件可关闭admission并防晚写/重开，却不能通过公开API强行结束已经等待的editor promise；用户取消/提交后旧SDK callback自行恢复宿主editor。input/select/confirm公开有signal，但本阶段目前未用。因此“晚完成不能写入/重新打开memory”已有测试；**“shutdown立即结束所有宿主dialog/旧SDK callback不能改变新焦点”没有成立证据，也不能称全部资源/焦点AC6已验收**。不偷调SDK hide方法、不控制主editor、不为绕过限制改已批准交互设计。建议主会话明确接受这个公开宿主边界，或另行决定可取消dialog接线/交互策略，再新增actual-host验证；现有fixture并不能证明宿主dialog取消。
- public custom done安装后仍由SDK隐藏topmost overlay，任意第三方在其上叠overlay的组合未证明。memory自己不嵌套，未为未知第三方组合添加private/全局接管。
- 真实PTY regular/fullscreen视觉、物理IME、installedCLI、在线模型质量、个人配置应用/旧记忆删除均NOT_RUN；实际SDK dispatch/component/owner测试不是这些验收的替代。
- 既有research目录实施/check日志历史错分类保持原样，未移动删除/改链接；本次报告与新retained日志全部evidence。
- 无commit/start/archive/push/install/sync/reload/真实PTY/个人data/递归dispatch；Stage4文档/preset/migration未实施。阶段3代码候选经自修后离线验证通过，但以上SDK dialog边界须主会话明确处理，不能把整个PRD或AC9标完成。
