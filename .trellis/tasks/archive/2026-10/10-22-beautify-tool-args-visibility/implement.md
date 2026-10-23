# 实施与验证计划

## 授权

用户已批准两阶段实施，并明确要求使用托管 worktree，验收后再合并。随后明确批准在 worktree 中运行本仓离线 `link-sdk`；不授权下载或安装依赖。每阶段检查通过后由主会话提交到任务分支，不合并、不 push、不归档。

执行根：`/Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-22-beautify-tool-args-visibility`；分支：`trellis/10-22-beautify-tool-args-visibility`；基点：`20c39e40a4b691c41484ff47e02d7b8a41a29a70`。任务材料仍由源主工作区提供，不复制到目标 checkout。

实施者选择：使用托管 `trellis-implement` 分阶段实施；每阶段结束后选择独立 `trellis-check` 审查。主会话核对实际 diff、测试证据与范围，再在目标分支本地提交。子 Agent 不提交、不递归派发。

## S1：副标题纳入非主字段

- 阅读 `tools/shared.ts`、`layout.ts`（`title`/`summary`/`toolHeading`）、`tools/{bash,read,find,grep}.ts` 与 `card-primitives.ts`。
- 在 `tools/shared.ts` 增加按工具名的 secondary 推导，供四工具 `describe` 复用；主字段去重（bash 的 background/timeout、read 的 offset 不重复）。
- 候选：bash（主字段为 description 时补 `command`）、read（`limit`）、grep（`glob`/`ignoreCase`/`literal`/`context`/`limit`）、find（`limit`）。
- 只纳入已到达且非 undefined 的键；空字符串按不存在处理；不虚构参数。
- 不改 `layout.ts` 的 `toolHeading`/`summary` 签名与降级逻辑。
- 新增测试：流式阶段（`isPartial: true`、`executionStarted: false`、`argsComplete: false`、无 result）逐键递增用例，断言已到达参数出现在 secondary、未到达参数不出现、无 `undefined` 字样。
- 验收：AC1、AC2、AC5、AC6、AC7、AC8、AC9。
- 检查点：`tools/shared.ts` + 四工具 describe + 对应测试耦合提交。

## S2：展开态完整参数表

- 将 `tool-card.ts` 的 `argumentsText`/`displayValue` 导出或提取到两族共享模块，供 `tools/shared.ts` 复用；不新造第二套格式化。
- `renderCall` 返回组件在 `ctx.expanded` 时于标题后追加全量参数表（`wrap` 换行，不走 `textPreview` 3 行预算）。
- 参数表只依赖 `ctx.args`，覆盖流式中/执行中/完成后；有 result 时顺序为「参数表 → 正文」，与 `tool-card.ts` `defaultDescription` 既有顺序一致。
- 保持跨帧组件复用（宿主 `lastComponent`/`state`），不破坏 `read` 的高亮 drawing 与 `bash` 的计时 cell。
- 新增测试：三种状态下 `setExpanded(true)` 均含完整 `key: value` 表；折叠态不含；`Ctrl+O` 提示仍可见；参数表不因 result 到达而消失。
- 验收：AC3、AC4、AC5、AC6、AC7、AC8、AC9。
- 检查点：`tools/shared.ts` + 共享参数格式化模块 + 对应测试耦合提交。

## 预检与命令

实施前读取 `.trellis/spec/development/index.md`、`.trellis/spec/testing/index.md`、`.trellis/spec/guides/index.md` 选定正文，并完整阅读 `extensions/beautify/__tests__/{tools,shell-collapse,tool-call-heading,tool-card,retrieval,terminal-layout}.test.ts` 与 `renderer-host.mjs`/`harness.mjs`，确认既有断言口径。使用现有 Node/TypeScript/SDK，`COREPACK_ENABLE_NETWORK=0`；不执行 install，不借 HOME 变化下载工具。先创建仓库外 owned 临时目录收集输出，最终核验后定向清理。

聚焦命令（beautify 呈现层，spec 既有入口）：

```sh
node --test extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts
```

SDK 隔离（spec 规定；缺 SDK 属环境阻塞，不得下载替代）：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

交付前类型检查与全量：

```sh
COREPACK_ENABLE_NETWORK=0 pnpm typecheck
COREPACK_ENABLE_NETWORK=0 pnpm check
```

聚焦运行不使用 `--test-force-exit`；`pnpm check` 的强制退出成功不能证明自然退出。真实终端视觉/provider 验证不做，记录 NOT_RUN。

## 记录要求

每阶段在 `implement.md` 追加：实际命令、环境（含 `PI_SDK_DIR`/`PI_CODING_AGENT_DIR` 临时目录）、退出码、结果、失败原因与重跑关系、未执行项与限制。保留首次失败事实，后续 PASS 不得抹除。原始输出留在仓库外 owned 临时目录，不写入 `research/`；仅主会话选定的最小长期材料进 `evidence/` 并说明用途。

## S1 完成与检查记录

- 提交：`9983df4 feat(beautify): show streaming secondary tool parameters`，只在任务 worktree 分支提交；主工作区产品代码未改、未合并。
- 修改：`tools/shared.ts` secondary 推导与四工具 describe 接入；新增 `secondary-parameters.test.ts` 六项回归，覆盖逐键到达、运行中可见、false/zero、去重、控制字符与宽度；既有 bash 标题预算断言由宽度 100 调到 120，并新增 command 可见断言。没有实施 S2。
- 环境：Node v24.14.1、pnpm 10.33.0、SDK 1.4.0，`PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.4.0/node_modules`；测试使用各执行者 owned 临时 `PI_CODING_AGENT_DIR`、`COREPACK_ENABLE_NETWORK=0`，通过既有 ancestor `node_modules/.bin` 提供 TypeScript PATH，无安装/下载。
- 主会话实际运行 target `node scripts/link-pi-sdk.mjs`：exit 0，链接 7 个已有 SDK 包；shiki/typescript 经 ancestor 已有依赖解析成功，target Git status 不变。
- 首次失败事实：typecheck 首次因 PATH 无 tsc exit 1；补已有 PATH 后发现新增测试三个类型错误（两处缺 details、一处隐式 any），修正后 typecheck exit 0。首次 focused 有一项新增 secondary 挤占标题预算的断言失败，修正预期宽度后通过；没有修改布局降级逻辑。
- 独立审查 `agent_trellis_check_1_f05ef541`：S1 scoped PASS，无修正；主会话读取实际 diff、新测试与 retained logs，核对 scope 后提交。
- 实施者与独立审查各运行 `pnpm typecheck`：exit 0 PASS；`git diff --check`：exit 0 PASS。
- 渲染器聚焦命令：`node --test extensions/beautify/__tests__/{card-primitives,monitor-card,nested-agent-card,notification-card,registered-agent,registered-monitor,registered-workflow,retrieval,secondary-parameters,shell-collapse,terminal-layout,tool-call-heading,tool-card,tool-clock,tools}.test.ts extensions/task-ui/__tests__/editor.test.ts`：exit 0，74/74 PASS，自然退出。
- 完整 beautify focused：`node --test extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts`：exit 1，102/113 PASS、11 FAIL。`pnpm check`：exit 1，1644/1658 PASS、14 FAIL。全部失败位于 SDK `interactive-mode.js:1899`，fixture 未提供 `extensionDialogs` 导致 `.length` TypeError。
- 基线复现：独立审查在仓库外通过 `git archive 20c39e40a4b691c41484ff47e02d7b8a41a29a70` 创建 owned baseline；相同 SDK/隔离环境运行原 focused：exit 1，96/107 PASS，同 11 FAIL；运行 `node --test extensions/at-path-completion/__tests__/host-reset.test.ts extensions/shared/widget-display/__tests__/sdk-footer.test.ts`：exit 1，1/4 PASS，同其余 3 FAIL。失败 fixture 与基点字节一致，确认 14 项均为既有基线问题。没有修改不属本任务的 reset harness；不能将完整测试记为 PASS。
- 原始材料暂保留 `/tmp/beautify-s1.ZHQ0sN/`、`/tmp/beautify-s1-review.nEILMf/` 供后续诊断；关键结论与失败重跑关系已在此自包含记录。
- NOT_RUN：真实终端/provider、完整 baseline 全量 suite（14 项通过 targeted baseline 全部复现）；无独立 lint 脚本。主工作区此时存在另一会话 reset fixture 修改，未搬入本 worktree。

## S2 完成与检查记录

- 提交：`ef9360e feat(beautify): expand tool arguments before completion`，在任务 worktree 分支；working tree 干净，未合并、未 push。
- 修改：导出既有 `argumentsText`，shared `renderCall` 展开态于标题后追加完整宽度换行参数表，不依赖 result；bash 移除重复的 `Command:` 呈现前缀，结果正文原样保留；新增五项 actual SDK 参数表回归（逐键流式、运行、partial/final/error、重新折叠/展开、参数→正文顺序、多行/JSON、控制字符/窄宽终端）；移除 S1 临时“无展开参数表”断言。其它工具族不变。
- 首次失败：新增 JSON 格式测试未计入 host padding，高亮 stub 返回值类型不正确；修正测试后重新运行，未削弱产品行为断言。
- 环境同 S1，owned 临时 agentDir、既有 SDK/ancestor TypeScript PATH、`COREPACK_ENABLE_NETWORK=0`；没有安装/下载或复制主工作区并行修改。
- 实施者 `agent_trellis_implement_2_e7bb777e` 与独立审查 `agent_trellis_check_3_bb3ef965` 各运行：`node --test extensions/beautify/__tests__/{card-primitives,expanded-parameters,monitor-card,nested-agent-card,notification-card,registered-agent,registered-monitor,registered-workflow,retrieval,secondary-parameters,shell-collapse,terminal-layout,tool-call-heading,tool-card,tool-clock,tools}.test.ts extensions/task-ui/__tests__/editor.test.ts`：exit 0，79/79 PASS，自然退出；`pnpm typecheck`：exit 0 PASS；`git diff --check`：exit 0 PASS。
- 完整 focused：exit 1，107/118 PASS、11 FAIL；`pnpm check`：exit 1，1649/1663 PASS、14 FAIL，均为 S1 已通过 baseline 复现的同一 reset fixture `extensionDialogs.length` 问题。本阶段核对失败 fixture 与 `20c39e4` 字节一致、阅读基线证据，没有再次执行 baseline 全量或 targeted 测试，也没有修复范围外 harness。完整检查不得记 PASS。
- 独立审查额外通过实际 SDK loader/resolver 注册四工具探针：`node /tmp/beautify-s2-review.oZn5Ty/registered.mjs` exit 0，覆盖 streaming/running/partial/final/error/re-expand 及宽度，确认并非只测直接 factory。
- 主会话阅读实际 diff、新增测试与 review logs，确认 source→target 边界、无循环导入/执行副作用，S2 scoped review PASS 后提交。
- 临时原始输出保留 `/tmp/beautify-s2.noywXq/`、`/tmp/beautify-s2-review.oZn5Ty/`，与 S1 原始材料一并保留用于尚未解决的基线失败诊断，不进行系统临时目录广泛清理。
- NOT_RUN：真实终端视觉/provider；无独立 lint 脚本。两阶段产品实施完成，任务保持 in_progress 等待用户验收；worktree/分支保留，不合并、不归档、不 reload。


## S3 授权与修正计划

用户已看过离线 tmux 演示并未接受 S2 展示风格；随后要求三阶段共享呈现，明确“行，你继续吧”授权修正。实现只在既有 worktree；新增验证过的修正提交，不重写前两提交，不合并/push/安装/reload/归档。

S3：实现统一工具专属调用描述与公共组合；生成中/执行中/完成后复用，标题展开保留关键参数，展开详情替代原始参数表，bash Command: 作为调用详情只呈现一次。完整沿用结果/计时/高亮。主协调，托管 implement 实施，独立 check 审查，主核 diff 与证据后提交。测试覆盖逐字段增长、三态一致、collapsed/expanded 语义、宽度/controls/false/zero 与其它族；执行此前 focused/typecheck/broader 命令，保持 14 项 baseline 失败诚实记录。

此前真实 terminal 演示使用 owned tmux server beautify-args-demo 与 /tmp/beautify-tmux-demo.MyMyMI/，实际 SDK loader/resolver/ToolExecutionComponent + TuiAltScreen，fixture 参数和结果不执行命令；已检查生成中展开与执行中折叠。用户要求关闭后正常 q 退出，closed 标记确认，PID 72463 不再存在，独立 server 自动结束；kill-server 返回 no server running，并非清理失败。此演示是用户否定风格的验收依据，不计新的视觉 PASS。在线 provider/实际整机 CLI/物理鼠标仍 NOT_RUN。

## S3 实施与独立检查完成

- 提交 `2937db4 fix(beautify): share semantic tool call presentation across phases`，仅任务 worktree 分支；目标工作区干净，未合并。
- 统一 args-only `describeCall()` 生成四工具 title/suffix/options/details，共用 `renderCall` 组合，三阶段只添加状态/耗时/结果；移除原始参数清单接入及四工具重复 describe wrapper。展开标题保留语义关键选项，bash Command: 作为调用详情仅一次，read 使用 Lines/From line，grep/find 使用语义搜索选项，generic argumentsText 恢复 private、其它族不改。
- 独立审查 `agent_trellis_check_5_9d8a802f` 找到兼容性缺陷：初实现丢掉 `Metadata.title`/`suffix` override。恢复 nullish override（包括显式空值）并新增 folded/expanded 回归，最终 scoped PASS；主读取实际修正 diff 与 logs 后提交。
- Node 24.14.1、pnpm 10.33.0、既有 SDK 1.4.0、ancestor `.bin` PATH，`COREPACK_ENABLE_NETWORK=0`，owned 临时 PI_CODING_AGENT_DIR；不安装/下载、不搬入主区并行修改。
- 实施初聚焦 41/41 PASS，进一步 whitespace/own-key 调整后 80/80 PASS。独立修正后最终命令 `node --test extensions/beautify/__tests__/{card-primitives,expanded-parameters,monitor-card,nested-agent-card,notification-card,registered-agent,registered-monitor,registered-workflow,retrieval,secondary-parameters,shell-collapse,terminal-layout,tool-call-heading,tool-card,tool-clock,tools}.test.ts extensions/task-ui/__tests__/editor.test.ts`：exit 0，81/81 PASS，自然退出，含实际 loader/resolver 注册四工具三态回归。
- 最终 `pnpm typecheck`：exit 0；`git diff --check`：exit 0。全 focused：exit 1，109/120 PASS、11 FAIL；`pnpm check`：exit 1，1651/1665 PASS、14 FAIL。仍为已由 S1 baseline 复现的 SDK reset fixture `extensionDialogs.length` 问题，失败 fixture 与 20c39e4 字节一致，S3 未重跑 baseline；完整检查不得记 PASS。
- 保留原始输出 `/tmp/beautify-s3.rQbh4W/`、`/tmp/beautify-s3-review.5TIV1W/` 供 unresolved baseline 诊断；首次 S3 scoped test 无产品失败，审查兼容性问题已修正并全套重跑。
- NOT_RUN：新版本真实终端视觉/provider 验收、独立 lint（无脚本）。用户验收仍待进行；不重新启动 tmux，不改个人会话，不归档。

## S4：标题颜色与原完成态一致性修正（用户已批准）

用户认可共享内容方向，但指出颜色与完成态文案不一致，提供原对照：`bash  Review nested delegation change and temporary cleanup  background after -1s  17 output lines · execution 0.0s · ctrl+o expand`，并明确“那你改正一下吧”。本阶段在原 worktree 追加修正、独立检查及本地提交，不合并。

保留 tool/name/description/mode 的 accent，次要参数、stats/timing/hint 使用 muted；expanded 不能通过把 secondary 拼到 label 导致整体染 accent。保持原 stats→execution→hint 文案与顺序，不改计时语义、不为本任务新增结果状态分支或三套呈现。新参数仍按已有预算显示，不应替换/改名既有统计。以原对照为真实注册 renderer 的回归基准，折叠/展开都测试 ANSI 颜色及可见文案，宽度控制与其它族保持。

离线演示 fixture 需补工具生命周期事件，确保 elapsed 与 final execution 展示真实 observer 行为；使用同一句 description、17行 output 和 durationMs=0 创建完成态对照，保留逐字段生成与 Ctrl+O 交互。主题显式使用 dark，终端声明 truecolor；不读取个人配置/认证，不伪称线上 provider 或用户终端完全等价。原始材料仓库外 owned tmp；修正产品与测试使用同一阶段提交，演示脚本不进仓库。当前不自动开启 tmux，等用户再次查看。

## S4 完成与检查证据

- 提交 `d626ae2 fix(beautify): preserve tool heading tones and metadata order`，只在任务分支。shared 同一调用描述保持 compact 布局在展开可容纳时复用；超宽展开恢复完整标题/信息，metadata 单独 muted，不把 secondary 拼成 accent。保持 stats→timing→secondary→hint 顺序与原文案。实际 registered regression 使用用户原 description/17行/duration0，覆盖 ANSI tones/生命周期计时/四工具/宽度/控件安全。
- 独立审查 `agent_trellis_check_7_fbe19615` 修正一项 empty args 预算缺陷：原 fits 计算少2列，边界会选择 compact 丢 hint；metadataGap 无 title 时4否则2，新增四工具边界回归。审查新增测试首次漏 durationMs 导致 typecheck 失败，补齐后重跑。实施阶段 strengthened partial duration assertion 初次失败，修正为 partial 不输出 final duration 的真实契约后重跑；首次失败原始记录保留。
- 最终 focused：`node --test extensions/beautify/__tests__/{card-primitives,expanded-parameters,monitor-card,nested-agent-card,notification-card,registered-agent,registered-monitor,registered-workflow,retrieval,secondary-parameters,shell-collapse,terminal-layout,title-tones,tool-call-heading,tool-card,tool-clock,tools}.test.ts extensions/task-ui/__tests__/editor.test.ts`：exit0 83/83 PASS自然退出。`pnpm typecheck`、`git diff --check` exit0。SDK1.4.0、已有ancestor .bin PATH、owned PI_CODING_AGENT_DIR、COREPACK_ENABLE_NETWORK=0，无下载/安装。
- 全focused exit1 111/122 PASS同11 reset失败。实施 pnpmcheck exit1 1652/1666同14 reset失败；独立最终pnpmcheck exit1 1652/1667同14加group-send同步resume断言失败（tool-waits.test.ts:862）。独立 `node --test --test-name-pattern='group send synchronous resume marks only' extensions/agent-tasks/__tests__/tool-waits.test.ts` exit0 1/1；该测试/失败fixture与原基点字节一致。新增失败保留为未完全诊断的全量并发失败，不将full suite记PASS。
- 主核最终diff/独立日志后提交。raw logs `/tmp/beautify-s4.Fkxll7/`、`/tmp/beautify-s4-review.S8Qn4W/` 保留供未解决全量失败诊断。临时修正版演示 `/tmp/beautify-s4-demo.FKU5WJ/demo.mjs` 补真实observer start/end事件、C原文17行0ms对照、dark truecolor与隔离环境；node --check exit0，两agent已完整读脚本但未启动tmux。
- NOT_RUN 新版本真实terminal/provider验收、独立lint（无脚本）；用户验收/合并仍待，不自动启动tmux或个人reload，不归档。

## S5：无结果时点击展开与演示鼠标接入（用户已授权）

用户确认主页面可点击，但当前 pi 宿主 createResultRegion 在 result 不存在时拒绝点击；原 demo 外层遗漏 handleMouse 转发。用户明确“行，你对应的处理一下”授权本任务在现有 worktree 修复对应四工具族交互与演示，不修改安装 pi/个人会话、不合并。

实现优先使用 renderer Component.handleMouse、state 与 invalidate 公共契约：无结果期间单卡片本地展开状态，三态共用调用布局；不修改只读 host context，不注入假 result、不访问 private ToolExecutionComponent 成员、不全局切换所有卡片。必须明确本地状态如何响应 host Ctrl+O、partial/final 到达、args 更新、重复点击与宿主已有结果点击，避免状态翻两次或到达结果后跳回。只有正文有效区域左点击切换，背景 padding/右键/链接/选择拖拽按既有宿主行为，样式/width/result/timing不改。若公共 API 无法可靠完成则报告具体限制，不偷偷 patch 安装 SDK 或扩大到第三方卡片。

演示转发 mouse 到真实 tool component，并在坐标换算时扣去实际已渲染前置标题高度，不截断实际卡片点击范围；使用 unique tmux socket 开 mouse 捕获验证时只操作 owned server，物理鼠标端到端与模拟事件证据区分。生成/运行无结果点击、result后点击、Ctrl+O互操作、outside/padding/rightclick、args更新、partial/final切换、四工具注册实际SDK与窄宽终端需回归。保留独立检查+本地阶段提交顺序；不自动启动新演示，修正后告知用户。

## S5 决定

用户确认不要求生成中/执行中无 result 时鼠标展开，维持 pi 原行为：有 final 或 partial result 时宿主点击展开；无 result 时使用 `Ctrl+O`。删除本轮未提交的 `extensions/beautify/__tests__/mouse-contract.test.ts`，不修改产品 renderer、安装 SDK 或 demo。S5 的公共 API 限制调查与 `/tmp/beautify-s5.aIUffj/` 原始日志仅保留为诊断事实；不计为功能实现或验收。
