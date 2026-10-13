# 独立审查结果

## 范围与环境

- 任务：`10-13-builtin-tool-renderers`；审查 cwd 为 `/Users/jyxc-dz-0101322/tools/my-pi-preset`，main。
- 已使用注入的完整 check 规范、PRD/design/implement/runtime-migration，另读 `check.jsonl` 与 `implementation-results.md`。完整阅读新增 renderer/editor/handoff 源码、测试和实际 SDK 1.2.0 的 resolver/component/editor setter/read/find/grep 格式，并用 `git show HEAD:...` 对照已删除的 743 行旧 editor 测试。
- 审查全部本任务 staged/unstaged/untracked 变更；index 为空。未供应 Review base，因此不评价已提交历史。`.pi` 四项、其他 task 目录未修改；审查期间主会话另更新四个 spec，未覆盖其修改。
- SDK：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules`，实际 Node 24.14.1；所有验证使用临时 `PI_CODING_AGENT_DIR`，结束删除。没有安装第二 SDK、联网模型、真实个人 Pi install/sync/reload、提交/暂存/归档，未改入口名。

## 发现与直接修复

1. **Read notice 分离吞掉真实尾部空行** — `extensions/beautify/layout.ts:49`。原代码在移除宿主两条 separator 换行后又移除源正文的两个换行，使 `a\n\n` 显示为一行。新增实际 `splitView` 红测，修为仅切除 notice 自身，保留正文空行和行数。红日志 `/tmp/beautify-review-notice-red.log`，exit 1；最终绿。
2. **notice 识别过宽** — `layout.ts:55-60`、`tools/find.ts:8`。旧 Read regex 允许无 separator 的代码末尾 lookalike，size/bash 任意文案也当宿主说明；旧 Search regex 吞掉 unknown suffix 并可能伪造统计。改为 SDK 1.2.0 的数字/size/continuation/bash/组合 search 格式，Read 普通说明必须有两个分隔换行，first-line byte overflow 必须独占正文。未知后缀与嵌入代码原样保留，真实 line/byte/limit notice 仍识别。Find 未识别 notice 或 partial blank record 改走原文 fallback，避免把空行和说明冒充 files shown；补回归。
3. **折叠标题包含物理换行** — `layout.ts:34-37`。多行 Bash command、grep pattern、path 可能让单 Component row 带换行，列宽计算不再是物理行。新增红测 exit 1（`/tmp/beautify-review-multiline-red.log`）；折叠显式显示 `\n`，展开继续完整换行，1/2/8/20/40/80/120 列测试绿。
4. **appearance 的非有限 padding 破坏宿主契约** — `editor/appearance.ts:26`。NaN 经装饰后 getter 返回 NaN，和原 SDK 的 finite→0 不同，可能破坏 gutter 计算。新增红测 exit 1（`/tmp/beautify-review-padding-red.log`）；匹配原 SDK 的 finite 检查，NaN/±Infinity 均安全归零。
5. **后来插件接管物理 padding 后仍吃输入缩进** — `editor/appearance.ts:10-15`。后来插件直接调用 native setter 降至 0，旧 wrapper 仍把正文前两个空格当 gutter 替成 ❯。render 先检查物理 padding 仍为 owned value，否则原样委托；回归检查 native rendering 完全一致。
6. **语言映射扩大超出设计** — `highlight.ts:4-10`。实施新增 r/ex/exs/erl/hs/scala/tex/ini/conf/diff 等和通用 basename alias，设计明确保持 Pretty 映射。对照 `local/pi-pretty/src/config.ts:380-433` 后撤回新增项，仅保留原扩展表与 Dockerfile/Makefile/GNUmakefile 特例；测试明确未知/未批准语言 plain fallback。同步 PROVENANCE，未引入新语言配置。
7. **旧核心回归迁移不完整** — 原 743 行测试不能只以少量合并 happy-case 替代。本次补回 later padding getter/setter/physical 所有权、padding mutate-then-throw、handoff descriptor 中途失败前不调用 host setter、20 次 captured factory 仅一个 live visual lease、Alt+R query/older/newer/cancel/branch priority、later border wrapper 与 nondelegating render 的 receiver/content。新增外部 OSC/CSI/C0、Unicode/组合字符与实际列宽测试。Pretty 自身 default/Claude/RenderBridge 算法、构造 Pretty adapter 等已移除功能不再保留无意义断言。

## 审查确认

- beautify 只注册一个公开 resolver，命中 read/bash/find/grep；其他 next，不注册工具或 tool_result，不包装 execute。
- 实际 host loader/resolver/ToolExecutionComponent、Read operations seam 验证参数/execute/guidelines/结果保留，Read 不额外读文件；host imageComponents 为 1。
- Bash 后台 ID/log 原文通过保守 fallback 始终可见，没有“进程完成”标记；普通 duration 为本次调用毫秒。
- Grep 匹配与 context 分隔、literal/ignoreCase、无效/零宽/危险 regex plain fallback、歧义路径保留，未改变搜索执行。
- Read 的内容/宽度/展开/关闭 revision 与成功 ANSI invalidation 回归通过；高亮回调 WeakRef，不捕获旧 ctx；Highlighter shutdown 清缓存、active=false 阻断迟到刷新。
- 同实例 handoff、history/Down 各顺序与禁用 Down、undo/draft/paste/autocomplete/IME/actions、部分 host setter/focus rollback、reset-before-shutdown 均通过。owner close 先清 cell.value 再释放 leases；独立 GC 证明 captured opaque render/factory 不保 ctx/TUI，原 Down 四资源 GC 继续通过。Resources 活跃时持 ctx，退休 cell 清空后引用链断开；未发现未释放引用。
- Pretty/FFF 生产 import 与 runtime dependency 已移除；conflicts 保留、legacy pi-pretty.json 在 merge/prune 下连 malformed 内容都不读写。manifest/sync/hard root-child ALS 和全后端 lifecycle 回归保留。

## 最终验证（修复与全部新增回归之后）

环境均为上述实际 SDK，独立临时 agent-dir：

```sh
agent_dir="$(mktemp -d)"
export PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules
export PI_CODING_AGENT_DIR="$agent_dir"
# 每条验证后记录 exit status 并删除 agent_dir
```

| 实际命令 | 最终结果 |
| --- | --- |
| `node --test extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/agent-tasks/__tests__/loading.test.ts scripts/pi-manifest.test.mjs scripts/sync.test.mjs` | **64/64，0 skip，exit 0，自然退出**；约 20 秒，`/tmp/beautify-review-focused.log` |
| `pnpm check` | **strict tsc 通过；583/583，0 skip，exit 0**；约 20 秒，`/tmp/beautify-review-check.log`。package test 自带 force-exit |
| `node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"` | **583/583，0 skip，exit 0，自然退出**；约 24 秒，`/tmp/beautify-review-natural.log` |
| `git diff --check` | 通过 |
| `python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-13-builtin-tool-renderers` | implement/check 各 9 entries 有效 |
| README / beautify TESTING / PROVENANCE 的本地文件 Markdown 链接 | Python regex/Path.exists 检查通过 |

本项目无独立 lint 命令，不声称跑过 lint。主会话/实施者的旧反向 ANSI/path/handoff 证据只作为参考，本轮直接复现的红→绿为 notice 空行、多行标题、非有限 padding。

## 剩余限度

- 没有真实 CLI/PTY、实际 pi-input-history 包、fullscreen 或任意第三方 editor 端到端验收；使用 actual host seam 与独立历史 fixture，不把前一版本 PTY 当本次验证。
- SDK 自身一列双宽中文 RangeError 和极窄聚焦 cursor 超宽有原生对照，不改 host；不会宣称所有输入框极窄问题已修。
- 正文恰好包含完全相同的宿主 notice 且分隔位置也相同，仍是原始无结构化内容的固有歧义；未知格式保守保留。Grep ambiguous path 可能放弃统计/高亮，仍显示原文本。
- highlighter 提供有限 JS regex 子集，不影响 rg 本身；80k/缓存限制保持。
- 未增加 mouse/selection/clipboard，不保证原生复制恢复软换行。未找到需阻止本任务交付的剩余范围内问题。
