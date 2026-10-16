# 阶段3实施与自检

2026-10-15，trellis-implement，共享 source/main。仅实施 memory 入口、内部面板/命令/本地预览及相关测试；未修改共享 Task UI、主编辑器、SDK、配置清单、用户文档或个人数据。主会话负责阶段接受、独立 checker、进度与提交。

## 实施

- `extensions/memory/panel.ts`：snapshot-only 全宽 list/detail，局部选择/翻页/过滤/Home/End/滚动；返回保存 query/name/index/viewport。实际 SDK Input 焦点/CURSOR_MARKER、Markdown、有 hidden scrollbar 的 ScrollView，无 timer/global listener，render/handleInput 无 I/O/await，只排当前列表页；正文布局由宿主 Markdown 缓存，最大16KiB。
- `command.ts`：唯一 operation admission，typed custom done→宿主 editor→description input→type select，delete confirm 不可恢复；任何 cancel 不写、同一 store revision/schema/budget/secret/disabled 检查。每次 await 后和效果/重开前核 origin+operation+cwd；shutdown/reentrant session_start 关闭 owned done，旧 completion 不得释放新面板或写入。所有宿主 dialog 在 custom promise 完成后调用，不嵌套。
- 菜单 Refresh/Clear filter/EnableDisable/Close；刷新安全重建派生索引，外部删除返回列表、损坏不提供 valid revision。缺失/metadata/secret/permission/capacity/root symlink 错误不当空库，原 OS exception 不回显。PublishedError 后重新 readEnabled，显示真实 disk state 与 durability warning，不宣称设置未发布。
- 非 TUI status/list [query]/on/off/help 不开 custom，不发模型，不把正文或 command 加进模型对话。
- `preview.ts`：仅本地详情，当 store.read 的 size 拒绝时复用 validName/openRead/private regular checks，最多读16KiB+1；仅裁掉不完整 UTF-8尾序列，内部非法编码拒绝。有效 metadata/secret检查，显式 truncated/read-only/no complete revision。不修改工具 read 或 mutation 合同、不伪造 revision；仅有界预览检查秘密，不宣称检查了未读全文件。
- 入口拥有关闭 callback；现有 tools/prompt typed fixtures 补真实新增 registerCommand，actual jiti loader 断言 `/memory` registration。

## SDK 签名纠正

preflight 的 `getMarkdownTheme(theme)` 与实际公开签名不符：installed Pi1.2公开 helper无参数。采用 helper defaults、由 factory 注入 theme覆盖所有Markdown style函数及有限code block styling，不访问私有theme loader/registry。hidden ScrollView 不创建 transient scrollbar timer。未使用实际 CLI/PTY或外部编辑器。

## 验证

已有 SDK：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules`；Node24.14.1，pnpm10.33.0。每轮独立 disposable PI_CODING_AGENT_DIR，SDK无需下载安装；最终命令：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))))')" || exit 1
agent_dir="$(mktemp -d)" || exit 1
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/memory/__tests__/*.test.ts > stage-3-focused-retained.log 2>&1
focused=$?
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check > stage-3-check-retained.log 2>&1
check=$?
rm -rf "$agent_dir"
echo FOCUSED_EXIT=$focused CHECK_EXIT=$check
test "$focused" -eq 0 && test "$check" -eq 0
```

所有原始日志保留在本 evidence/，未改写第一次失败。

| 记录 | 实际结果 |
| --- | --- |
| memory-stage3-type-first.log | FAIL exit2，误传 getMarkdownTheme(theme)；修公开调用 |
| memory-stage3-type-second.log | PASS exit0，仅当时实现 |
| stage-3-focused-first.log | FAIL exit1，26/30；Node strip-only不支持parameter property |
| stage-3-check-first.log | FAIL exit2，fixture误用未公开export getThemeByName及TS callback narrowing |
| stage-3-focused-second.log | FAIL exit1；Theme fixture遗漏fallback tokens，等待编辑fixture因早失败未到达pause，保留失败后定点TERM自有test child PID85820，不称自然退出PASS |
| stage-3-check-second.log | FAIL exit1；同一旧Theme fixture导致own command child等待，定点TERM PID91121保留失败；另runtime-tasks retained-child一次settle assertion失败，未修改邻任务；driver最终退出并清自己temp，PID85805/90680/90858/91121已不存在 |
| stage-3-ui-diagnosis.log | FAIL exit1，确认public Theme missing muted fallback，修fixture完整fallback+bounded wait；未降低产品断言 |
| stage-3-ui-third.log | PASS natural exit0，12/12 |
| stage-3-focused-third.log / stage-3-check-third.log | PASS focused自然exit0，52/52；strict/full825/825 exit0 |
| stage-3-focused-final.log / stage-3-check-final.log | PASS natural53/53 + strict/full826/826 exit0 |
| stage-3-focused-retained.log / stage-3-check-retained.log | **最终PASS，focused54/54自然exit0；strict+full827/827 exit0** |

最终实际SDK `AgentSession.prompt('/memory')` + bindExtensions public uiContext seam：custom/done/editor/input/select顺序，读取磁盘已保存正文；providerCalls=0、session.messages.length=0；RPC `/memory list pref`/off/status同样0模型、0messages、不custom。并非仅handler字符串断言。UI边界使用真实SDK组件/Theme，dialogs与terminal为typed public expensive-boundary fixture，不声称实现真实Terminal renderer/host dialog外观。

实际组件测试覆盖宽度1–120、缩放、Chinese/combining/controls、dark/light injected Theme、Input焦点marker、2000 bounded metadata list、filter字符键归属与no-match、selection返回、empty/loading/error/disabled、oversized preview/no revision/secret/invalidUTF8/symlink。command tests覆盖编辑每阶段取消、conflict、delete取消/成功/相邻、外部删除/损坏刷新、menu/off与editing期间off、partial save、disk published warning、nonTUI、shutdown在custom/editor/input/select/confirm、cwd变化、reentrant session_start、旧editor完成不能清新interaction、root symlink/capacity/metadata/permission安全诊断。既有37 focused/real SDK prompt tests最终全部保留通过。

`git diff --check` exit0；22个memory源码/测试文件（含untracked）逐行whitespace检查exit0。full suite包含manifest/sync，最终通过。独立Lint脚本不存在，Lint NOT_RUN；独立review、真实PTY regular/fullscreen视觉与物理IME、installedCLI、个人安装/卸载/sync/reload/迁移删除均NOT_RUN。没有commit/push/start/archive或子代理递归派发。Stage3实现完成候选，不代表整个PRD/AC9完成。

## 证据目录边界

dispatch请求写research/stage-3-implementation.md，但当前implement角色规则要求新实施报告/retained verification在evidence。本报告按较高优先级角色规则放evidence，不新写research；历史research错分类记录原样保留，不移动/删除/改引用，供主会话处理。
