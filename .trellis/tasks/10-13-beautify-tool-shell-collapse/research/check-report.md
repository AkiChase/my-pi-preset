# 独立检查报告：六工具外壳与单行收缩

## 范围与方法

2026-10-14，trellis-check 在用户批准的当前 source checkout、isolation off 完成审查及窄修。读取 check.jsonl、注入的完整 PRD/design/implement/retrieval-contracts、implementation-report，以及 repository/documentation/extension/testing 和两份 thinking guide。审查实际 tracked diff、staged diff（为空）与本任务 untracked 文件，不以实现报告代替源代码。未提供 Review base，因此本报告不覆盖已提交历史。

检查展示源码 `extensions/beautify/{index,layout,types}.ts`、`tools/{shared,read,bash,find,grep,optional,get-subagent-result,jobs,retrieval-contracts}.ts`；完整读 `tools.test.ts` 和新增 `shell-collapse.test.ts`、`retrieval.test.ts`、`registered-agent.test.ts`，核 `renderer-host.mjs`、host-loading-smoke 的唯一 Bash shell 期望变更，以及 README/TESTING/spec。对照实际 SDK 1.2.0 `ToolExecutionComponent`、Box、MouseRegion/dispatchMouseEvent、render-utils、agent-loop，实际 process jobs/format 与 agent get_result/usage wrapper/activity 格式化函数。

`.pi` 四项和无关 task（包括审查中新增的 runtime-task-tools）保持原样；没有修改 backend/schema/execute/result/usage、个人配置、SDK 或资源注册。没有 stage/commit/push/install/sync/reload/PTY，没有管理 task lifecycle 或 PRD AC。

## 发现与修复

### 1. 同轮 partial→final 的缓存结果错误委托

`extensions/beautify/tools/optional.ts:93-98`：实际 host 先 renderCall 再 renderResult；旧逻辑在 renderCall 用新 ctx.isPartial=false 解析旧 raw partial，从 following 切到未知，额外调用 original renderCall。即使随后 final 单行恢复，original 生命周期已被错误触发。

新增实际 host 回归在修复前 **10 pass / 1 fail**（calls=1，期望0）。现在已有 result 时延后组合到本轮 renderResult，以新 payload 和本轮 context 一起判定，call component 同步引用最终 shell。切换/展开/原两槽缓存测试继续通过。

### 2. original self 已知外壳的 padding 鼠标区域过大

`extensions/beautify/tools/optional.ts:102-109`：公开 Box 只把正文分发子组件，但 host 在整个 self call component 外包一层 MouseRegion，其 fallback 点击会把左右及上下 padding 也当展开区。原有鼠标测试只点正文，未覆盖边界。

新增 actual-host default/self 对照矩阵，检查 pending/success/error SGR、4行结构（leading spacer + Box上下 padding +1正文）、一次 outputPad、整行80列背景，点击左右 padding、上下空白、正文首／末列。已知 self 的 padding 以 handled:true/render:false 抑制外层 fallback，正文仍交宿主切换。测试验证展开状态而非只看 handled（SDK dispatch 会把 handled:false 归成 undefined，不足以阻止外层 fallback）。未知 self 保留 original 自有交互与外壳。

第一轮该复合测试还有 fixture 忘记在上一点击后收缩的问题，已明确修正，**不把那次5行与4行差异算产品红证据**；修正后的实际边界点击仍暴露并验证了 self padding 错误。

### 3. 空／多行 agent description 缺少已知态摘要

`extensions/beautify/tools/get-subagent-result.ts:17-24`：实际 formatter 原样插入 description，原 guard 仅 `[^\n]+` 的单行非空字段，空 description 或普通多行直接降级，无法满足请求ID fallback／description标题。

现在允许没有空白分隔歧义的多行 description，空／纯空白用请求 `Agent <id>`；仍只读固定头部，不扫描正文/verbose。含空白分隔的 description 与正文在该非结构化格式中无法无歧义分开，保留首个固定分隔，不猜其后的文本为 metadata。Tool uses 另加 safe integer 检查，未知 optional 字段继续省略。

### 4. jobs terminal 合计可能溢出 safe integer

`extensions/beautify/tools/jobs.ts:48-50`：各 count 独立安全不代表 completed+failed+killed 的和安全。新增边界输入 `MAX_SAFE_INTEGER + 1 + 1` 回归，合计也必须 `Number.isSafeInteger`，否则 delegate，不输出舍入后的伪数量。

### 5. 无 original／original callback 抛错时参数与结果降级不完整

`extensions/beautify/tools/optional.ts:14-27,55-80`：旧 fallback 收缩总是铺完整 JSON，展开字符串参数仍显示转义 `\\n` 而不是实际分行；original callback 抛错由宿主 catch 后可能与已捕获的旧组合混合，当前返回文本不可靠。

现在收缩采用100字符 key=value 参数预览，展开字符串按原文分行，结果依然10行预览／完整展开。call/result 的 **显示组件** 与 **original成功返回的lastComponent** 分开保存；callback 失败一次无敏感信息诊断，显示当前参数／当前已返回结果的通用回退，不丢正文、不把 fallback 塞给 original lastComponent。null/数组/primitive/字段null 参数安全降级。

以上普通复合新增回归初始 **7 pass / 3 fail**（空description、鼠标fixture/随后真实命中问题、无界JSON预览）；最终 retrieval **12/12**。报告区分 fixture 与实际产品证据，不声称每条独立子断言都有单独红日志。

## 已核实而未改动的合同

- 原四类 default host Box，组件仅使用传入内宽；call/result cell 在 renderResult 同轮更新后 render，collapsed只有call一行。Read 空body路径显示0 lines／展开(empty file)，文件尾空行/notice/offset、Shiki revision/WeakRef/关闭防护保留；actual SDK imageComponents 仍单次由host绘制。
- Bash仅匹配完整固定background信封；普通正文含Job ID/background/log path不进入后台分支；展开保原文。
- jobs list 名称/命令含括号或状态同形文本不解析status counts，只报告验证后的record行数量。含换行的陌生／漂移记录降级；非结构化同名同形文本不能证明工具身份或杜绝伪造，未作强保证。
- output只有可靠byte范围与no output标记；search只读action对应header，body命中/名字歧义不拿来推状态，preview limited per job来自backend固定20条上限，不声称额外读到遗漏内容；stats固定labels与安全count；attach partial只following/waiting，final覆盖partial，stopped following与kill/OS exit明确分开。
- agent Duration对照activity.formatDuration是1位小数秒＋可选(running)，tokens/cost/context/compactions可省略。status note严格对照，正文/verbose不贡献统计，released/cancelled不意味停止执行。
- **真实错误shape**：SDK agent-loop.createErrorToolResult 为text＋`details: {}`，而非undefined。新增测试用实际公开runToolCall执行实际registered jobs的缺失ID错误，证明guard应降级、文本和error背景保留。没有为了单行把{}放进已知信封。agent withUsageReporting只顶层追加usage，不变content/details；host传renderer的结果为content/details，因此无需为usage扩大guard。

## 最终验证

所有命令使用已有只读 SDK 1.2.0、Node 24.14.1、mktemp `PI_CODING_AGENT_DIR` 并 finally删除该配置目录。没有下载／另装SDK，没有真实模型／网络／个人配置写入。

```sh
sdk_dir="$(node -e 'const fs=require("fs"),p=require("path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))))')"
agent_dir="$(mktemp -d)"
export PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir"
# 下列命令结束后 rm -rf "$agent_dir"
```

- `node --test extensions/beautify/__tests__/*.test.ts extensions/process-tasks/__tests__/{index,waits}.test.ts extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/agent-tasks/__tests__/loading.test.ts` → **141/141，exit0，自然退出**。
- `pnpm check` → **strict TypeScript通过；606/606，exit0**。项目package test本身带force-exit，未更改脚本。
- `node --test 'extensions/**/__tests__/*.test.ts' 'scripts/*.test.mjs'` → **606/606，exit0，无force-exit，自然退出**，覆盖process/agent/task-ui/beautify全部资源回归与脚本。
- `python3 .trellis/scripts/task.py validate .trellis/tasks/10-13-beautify-tool-shell-collapse` → implement/check各4项全部通过。
- `git diff --check` → 通过；本任务新文件另检查行尾空白与本轮文档相对链接。
- 项目没有独立lint命令：**未运行独立lint**，不标为Passed。

第一轮focused 141/141后，strict typecheck发现新增actual runToolCall fixture缺少必需 `type: "toolCall"`，exit2；已补类型判别，随后重跑**以上三条最终命令全部成功**，不是用Node类型擦除的绿色代替strict。

最终日志：`/tmp/beautify-independent-focused.log`、`/tmp/beautify-independent-check.log`、`/tmp/beautify-independent-natural.log`；任务后台汇总 `/tmp/pi-bg/bbxt87k2q.log`（exit0）。红／过程日志 `/tmp/beautify-check-red.log`、`/tmp/beautify-check-round-red.log`、`/tmp/beautify-check-green.log`。临时日志不属于交付文件。

## 本 check 修改路径

- `extensions/beautify/tools/optional.ts`
- `extensions/beautify/tools/get-subagent-result.ts`
- `extensions/beautify/tools/jobs.ts`
- `extensions/beautify/__tests__/retrieval.test.ts`（5项新增test）
- `README.md`
- `extensions/beautify/TESTING.md`
- `.trellis/spec/preset/extension-guidelines.md`
- `.trellis/spec/preset/testing-guidelines.md`
- `.trellis/tasks/10-13-beautify-tool-shell-collapse/research/check-report.md`

## 未做／限制

没有剩余已确认且可安全窄修的本任务问题。未运行真实CLI/PTY/fullscreen鼠标／actual input-history原包／在线模型；实际host组件与离线fixture不等于这些端到端验收。native Box `contentWidth=max(1,width-2*padding)` 在物理width低于双侧padding＋1时仍可越界；测试保留真实最小Box宽度界限，正常宽度严格不超宽。原生一列双宽中文/聚焦光标限制未修SDK。

第三方original renderer可自行限制展开内容，未知分支不承诺替其恢复未提供全文；非结构化text guard不是身份认证，summary仅返回快照，不推测live状态／control能力。主会话负责最终实际diff验收、PRD AC和lifecycle，本check没有代做。
