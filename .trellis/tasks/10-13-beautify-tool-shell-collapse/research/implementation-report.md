# 实施报告：六工具外壳与单行收缩

## 范围与执行边界

2026-10-14，在用户明确批准的当前 source checkout（isolation off）实施。只修改 Beautify 展示、相关测试及必要 README/spec/task 文档；未安装 worktree CLI、未创建临时 worktree、未 stage/commit/push、未真实 install/sync/reload/PTY。原四个 `.pi` dirty 文件、其他任务目录及新增并行任务保持原样。子代理不管理 start/check/archive lifecycle，独立 check 留主会话。

读取 implement.jsonl 全部四项、PRD/design/implement，以及 owning repository/documentation/extension/testing、reuse/cross-layer guides、完整 Pi SDK 1.2.0 docs/extensions.md 与 docs/tui.md。另核 actual ToolExecutionComponent/Box、jobs 六 action、process Bash、get_result 完整定义及其 formatting/status note。

## 实际宿主证据与机制调整

- ToolExecutionComponent.updateDisplay 在 renderer 调用前选 renderShell，先 call 再 result；两者共享 state，但 lastComponent 分槽。result 可在同轮更新 call 捕获的 composition cell，下一次 render 无须另 invalidate。
- default Box 提供 pending/success/error 背景、整行填充、上下留白、outputPad 与 MouseRegion。render(width) 收到的是内宽，原 renderer 再减／补 padding 是错误。四类现在 default，collapsed result 空行、call 唯一摘要；expanded call 完整标题、result 正文，Read 不重复路径。
- renderShell 是静态值、没有 context。正常 get_result/jobs next 没有 self 时也用真正 default host Box；仅 next 明确 self 的兼容分支保持静态 self，通过公开 Box（已知态）/Container（未知委托）切换，避免双框。原 state 和 call/result lastComponent 独立保存，未知结果同轮切换完整 original 组合。未引用 host 私有 fallback 或插件 registry。
- Pi Box 最小 contentWidth=max(1,width-2*outputPad)，物理宽度低于双侧 padding+1 时原生仍可超宽。现有极窄测试记录这个界限，不为本任务修改 SDK 或声称修宿主极窄行为。

## 行为

1. shared/layout 实现单行预算，标题中段缩略、offset 原子、可靠主状态优先、次要字段逐项省略，hint 取当前 keybinding。错误/未知/空输出不再铺全文，expanded 保正文。
2. Read 保行号、notice 与源末尾空行、高亮 revision/WeakRef/LRU/关闭防护、宿主单次附件。Bash 仅完整固定后台信封取 ID，普通 Job ID/background/log path 关键词不判后台；durationMs 只显示有限非负调用耗时。
3. get_result 严格参数、text-only/details undefined、完整固定头部；只解析 header，不从正文/verbose 猜统计。running/queued/error/stopped/aborted/steered、not found、wait released/cancelled 保持区别，未知可选字段省略，未知整体合同 delegate。
4. jobs 六 action 按各自合同；list 因名称/命令分隔歧义只报告可靠记录数，不猜状态计数；output 报 actual bytes 与 omitted；search 报可靠 hits/groups；stats 报 running/terminal；attach partial 为 following/waiting，final 覆盖，不自行累积日志；released 不表示 killed，kill 只 stop reported，不推断 OS exit。
5. 非适配工具直接 next；不注册任何新工具，不改 execute/schema/content/details/structuredContent，不额外读取或消费。没有 original 的未知格式用 public Text 与10行 preview/hint，expanded 已返回全文；兼容例外允许多行。

## 红测（先测试后修改生产）

命令使用已安装 SDK 路径及 mktemp agent 目录，不带 force-exit：

```sh
node --test extensions/beautify/__tests__/shell-collapse.test.ts
```

原实现：9 tests，0 pass / 9 fail，exit 1。实际宿主失败：Read/Bash/Find/Grep pending background 均缺失（4）；call/result collapsed 有效文字行数为2/3而非1（4）；长错误及普通 background words 输出17行而非1（1）。随后才改生产文件。原始临时日志 `/tmp/beautify-shell-red.log`；本报告保留可复核摘要，日志不是维护文件。

其他过程失败如实区分：fixture generic ToolDefinition 类型、TaskView identity/taskId 与 Find 测试预期文案修正不是产品红证据；原 hard loader 仍断言 self，按新的实际 contract 仅将其 Bash 断言改 default，不放宽任何 root/child/shutdown guard。

## 绿色验证

每次使用 SDK 1.2.0 实际 node_modules（只读解析已有安装）和临时 `PI_CODING_AGENT_DIR`，结束删除临时配置。Node 24.14.1。

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))))')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" <command>
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

- 定向自然退出：`node --test extensions/beautify/__tests__/*.test.ts extensions/process-tasks/__tests__/{index,waits}.test.ts extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/agent-tasks/__tests__/loading.test.ts` → 136/136、exit0。覆盖实际宿主 shell/mouse、两 backend retrieval/consumption、所有 editor/GC/history/Down 与 hard loader guards。
- 后续 optional 机制精简后单测 `node --test extensions/beautify/__tests__/retrieval.test.ts` → 7/7、exit0；strict typecheck 同时通过。
- 最终隔离 `pnpm check` → strict typecheck passed、全量 601/601、exit0（package script 本身带 force-exit；未改变项目脚本）。
- 最终隔离 `node --test 'extensions/**/__tests__/*.test.ts' 'scripts/*.test.mjs'` → 601/601、exit0，未加 force-exit，真实自然退出；包括 task-ui/process/agent 三模块资源门禁和脚本测试。
- `python3 .trellis/scripts/task.py validate .trellis/tasks/10-13-beautify-tool-shell-collapse` → implement/check context 全部通过。
- `git diff --check` → 通过；新增文件另检查行尾 whitespace。

完整临时日志 `/tmp/beautify-full-check.log`、`/tmp/beautify-full-natural.log`；定向 `/tmp/beautify-focused-green2.log`。日志不是提交范围。

## 改动路径

- `extensions/beautify/index.ts`：固定两名惰性 optional resolver。
- `extensions/beautify/layout.ts`、`tools/shared.ts`、`tools/{read,bash,find,grep}.ts`：default host shell、同轮单行组合、独立展开正文。
- 新 `extensions/beautify/tools/{retrieval-contracts,get-subagent-result,jobs,optional}.ts`：保守合同、optional delegate 和公开 fallback。
- `extensions/beautify/__tests__/tools.test.ts`：测试 observable call+result，native 极窄 Box 界限；新 `shell-collapse.test.ts`、`retrieval.test.ts`、`registered-agent.test.ts`：红/绿实际宿主及真实已注册 backend 信封。
- `extensions/agent-tasks/__tests__/host-loading-smoke.mjs`：仅一行 Bash renderShell 期望 self→default。
- `README.md`、`extensions/beautify/TESTING.md`、`.trellis/spec/preset/{extension-guidelines,testing-guidelines}.md`：必要行为/验证/兼容边界更新。
- 本任务 `design.md`、`implement.md`、`research/implementation-report.md`：宿主机制、执行 checklist 与本报告；PRD AC 留主会话独立验收。

## 限制与后续审查

未运行真实 CLI/PTY、fullscreen 终端鼠标、实际 input-history 原包或在线模型；actual host/离线 fixture 不能替代这些端到端证明。未知 original renderer 可能自行限制 expanded 内容，不承诺替第三方恢复全文。text parser 不是身份认证，同名同形合同歧义不可消除；显示仅返回 snapshot，不推断未来 resume 的实时状态。独立 check 未由实现子代理执行，主会话须检查真实 diff（包括 untracked 文件）后派发审查并更新 AC。
