# 实施与验证计划

## 当前状态与授权

- 用户已批准最终方案实施，task start 使用 `--allow-empty-context`，状态为 in_progress。不开 Agent，独立审查按已批准安排由用户/人工完成。
- 已完成 S1 并提交 `301672d`；已完成 S2 实施与主会话检查。用户明确豁免本任务独立审查，不启动 Agent，阶段按自审和测试提交。真实部署验收仍待用户确认。
- 主会话直接实施，不启动 Agent，不创建 worktree；implement/check JSONL 保持有意空白，未来批准 direct start 时使用 `--allow-empty-context`。不把空 manifest validate 诊断描述为通过。
- 检查结果见本文件末尾 S1 执行记录；此前列出的命令为计划，不等于全部已运行。
- 不安装、reload、push、重写历史或自动归档，不创建其他工具任务。产品实施获批后按 workflow 分阶段精确本地提交。
- Git 存在并行未提交改动，尤其 `.trellis/spec/` 和 Trellis 管理文件必须逐 hunk 检查。提交时不执行 `git add .`，不包含用户其他工作。

## S1：Agent run/workflow/message 契约

- [ ] 实施前完整读取相关执行代码、caller、现有 fixture/test 及 docs，确认 PRD/design 文件锚点；搜索 excerpts 不是完整读取证明。
- [ ] 在现有 tool-contract owner 增加返回规范化参数的 parser；先入口字段合法性、再浅层 null 删除、再模式/条件校验。
- [ ] 主/嵌套所有已暴露字段 required，不使用 Type.Optional，业务可选控制字段直接 Union[null,T]；thinking/isolation 共享 schema 同步；始终非 nullable 的 prompt/message/agent_id 不放宽。schema/raw 逐字段缺失均拒绝。
- [ ] 全部外层模型调用示例与测试 fixture 改为提供注册配置下完整字段，未使用控制字段 set to null；内部 RPC/manager/脚本 API fixture 不整体改造。
- [ ] 主/嵌套 execute 使用 parser 输出，内部 resolver、manager/RPC、scheduler 类型保持非 nullable。
- [ ] workflow 仅清理来源/replay 控制参数，args 顶层及内部 null 原样保留；不改内部 workflow/agent JS API 或 StructuredOutput caller schema。
- [ ] 同步 run/workflow usage、schema descriptions、错误指导、Task Composition Agent 文档及适用 spec 契约。
- [ ] 按用户要求删除 `extensions/tool-guidance.ts`、`extensions/__tests__/tool-guidance.test.ts`、`docs/extensions/tool-guidance.md`；移除 README、docs/index 及当前 spec 的引用。保留历史归档材料，不把旧全局规则复制到其他工具。不改其他工具 schema/执行。
- [ ] 更新既有 raw null 拒绝/host 删除测试为分层测试：host 保留 nullable null，工具 parser 删除控制 null；保留空字符串失败事实与零副作用断言。
- [ ] 检查 mention-clone 工具复用和真实加载回归；不另造执行 owner。
- [ ] 主会话 diff 自审 + 测试；公共契约独立审查由用户/人工承担，不启动 reviewer Agent。
- [ ] 人工独立审查与该阶段检查完成后精确本地提交，记录实际 hash、命令及结果再进入 S2。

### S1 检查命令

在下述公共隔离环境下运行，均无 forced exit：

```sh
node --test extensions/agent-tasks/__tests__/tool-contract.test.ts extensions/agent-tasks/__tests__/input-errors.test.ts extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/agent-tasks/__tests__/workflow-failure-host.test.ts extensions/runtime-tasks/__tests__/prompt.test.ts
node --test extensions/agent-tasks/__tests__/*.test.ts
pnpm typecheck
```

新增测试文件需显式补到第一条 focused 命令中。覆盖 schema-null、冻结输入、unknown/disabled-null、错误模式计数、合法 nullable 执行、args 原值与配置优先级。`loading.test.ts` 使用真实 host 加载 seam 但不证明线上模型行为；执行前核对当前覆盖，未覆盖的新增边界补测试。

## S2：Agent 管理和 Trellis 派发契约

- [ ] `agent_manage` 所有暴露字段 required，业务可选控制字段直接 Union[null,T]，action 保持非 nullable，执行和 raw validation 共享规范化 parser，缺字段拒绝。
- [ ] Process 分支保持原 schema、raw null 拒绝和实际 host 行为，新增负向回归证明无变化。
- [ ] Beautify management consumer 使用 Agent parser 输出，校验/标题/identity 匹配一致；仅 Agent 分支变化。
- [ ] `trellis_dispatch` plain schema 的 action/agent/task/prompt nullable 化并全部 required；纯 validator 先拒绝 unknown（包括 symbols/hidden keys 的现有约束）及缺字段，再复制处理 null。
- [ ] action:null 默认 dispatch；task:null 使用当前任务；stop 中 agent/prompt:null 无冲突；dispatch 的 agent/prompt:null 报缺失。保留既有 action/task 空字符串语义和 prompt 精确文本。
- [ ] 准入拒绝继续在 cwd/query/filesystem/activeTask/RPC 之前发生；占用、source authority、worktree/stop 生命周期逻辑不改。
- [ ] 同步 Agent 管理/Trellis 使用说明、当前用户文档及适用 spec；不修改生成的项目 `.pi/agents`、scripts/skills/runtime manifest。
- [ ] 主会话 diff 自审 + focused/广域检查 + 用户/人工独立审查。
- [ ] 精确本地提交该阶段并记录实际 hash、命令及结果。

### S2 检查命令

```sh
node --test extensions/runtime-tasks/__tests__/contracts.test.ts extensions/runtime-tasks/__tests__/agent.test.ts extensions/runtime-tasks/__tests__/workflow.test.ts extensions/runtime-tasks/__tests__/process.test.ts extensions/runtime-tasks/__tests__/prompt.test.ts extensions/beautify/__tests__/registered-agent.test.ts extensions/trellis/__tests__/dispatch-params.test.mjs extensions/trellis/__tests__/dispatch.test.mjs
node --test extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts extensions/trellis/__tests__/*.test.mjs
pnpm typecheck
```

注意现有 assertions 文本可能需更新，但只更新本次改变的契约，不能删除 stale/ownership/unknown/zero-effect 测试来让测试通过。

## 公共环境与证据

执行开始前用 `mktemp -d` 创建本次拥有的仓库外 run directory，包含隔离 agent config 和 raw stdout/stderr。先确认已安装 SDK 与 node_modules 链接可用；缺失则阻塞，不下载。

```sh
# 每个命令使用同一组隔离环境，run_dir 为本次已创建目录。
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
# 前一步失败或目录不存在就停止；创建 run_dir/agent 后再运行。
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$run_dir/agent" <check command>
```

日志写入 `$run_dir`，保留各命令真实 exit code，不因 tee 吞掉失败。失败诊断和修复后的 rerun 关系在本文件补充，PASS 不覆盖首次失败。检查结束且无活动进程使用后，仅清理本次 owned directory；未解决诊断保留必要日志并报告路径。

## S3：最终整合与用户部署验收

- [ ] 全部最终相关代码上执行 `pnpm check`，记录 typecheck 和全套结果；它的 forced-exit suite 不代替 S1/S2 natural-exit 检查。
- [ ] `git diff --check`，检查新增文件空白与语言，验证改动文档相对链接/anchors、task JSONL 状态；保留其他人的 hunks。
- [ ] 逐工具核对 PRD 验收矩阵，记录 StructuredOutput/内部 JS API 的数据契约不改审计结论。
- [ ] 最终本地精确提交仅含验过的 integration 修正；不重做或 squash S1/S2。
- [ ] 提供用户部署后验证清单，但主会话不安装/reload，不主动发真实 Agent/Workflow 调用。
- [ ] 用户确认实测有效；未确认时任务保持待验收，不归档、不创建后续其他工具任务。

### 用户部署验证清单（本地测试不能替代）

1. 抓包确认 Agent 工具所有已暴露字段都 required，未指定控制字段为 Union[null,T]；非 nullable、枚举及 feature gating 正确。记录 model/provider/SDK/扩展版本，不保留凭证。
2. 新建 Agent：未使用 resume/schedule 等字段必须为 null，不得省略，正确执行一次新建，不误恢复。
3. 恢复 Agent：其他新建字段 null 不冲突，返回新 execution_id；有效非 null 跨模式字段仍被拒绝。
4. `agent_manage` list/status/output/wait/stop 各动作按 scope 使用正确句柄；不适用 null 不报模式冲突，目标 null 仍失败。
5. 经用户另行明确授权的真实 workflow 调用验证来源 null、args:null 数据与 replay。真实 orchestration 权限不因本任务实施获得。
6. 在用户允许的测试任务上确认 trellis_dispatch 的 nullable stop/dispatch；不拿生产中的不明占用试停，不绕过 approved task/worktree 协议。
7. 无线上许可的项目标记 NOT_RUN，不把 fake-pi/local provider fixture 写成线上 PASS。若仍出现 `""` 或 enum 默认占位，保留最小脱敏 wire 证据，回到本任务诊断，不自动扩大归一化或修改其他工具。

## 实施审批项

最终规划已获用户批准，已执行 `task.py start ... --allow-empty-context`。公共/跨模块契约独立审查按不开 Agent 的约束采用用户/人工 diff review，主会话自审与用户线上验证分开报告。未满足审查的阶段留待审，不提前标记已验收或提交为完成阶段。

## S1 主会话复核补充

用户再次明确要求由主会话自行 check，不启动 Agent，并要求完成后提交。已遵守不开 Agent，按 trellis-check 清单复核注册 schema→parser→模式→配置/manager 路径、mention clone 原 input 私有标记、args 数据例外、主/嵌套入口、相关测试与删除引用；未发现新的执行错误，仅去掉主工具 model description 的重复 null 默认说明。该文案调整需最终聚焦检查覆盖。

用户已明确批准本任务豁免独立审查（回复“豁免”），不开 Agent，主会话自行复核和测试后提交。该例外不修改项目 workflow，也不将自审标成独立审查。S1 已提交，S2 在完成检查后精确提交。

用户后续纠正 docs/spec 边界：本任务撤掉用户文档中的模型调用规则和 spec 中新增的 nullable 实现规则。用户 docs 只保留功能/操作/限制；工具 schema/usage 负责模型规则；task 保存一次性设计和验证。spec 仅删除失效旧语句与扩展引用，保留其他内容。

## S1 执行记录

环境：项目已安装的 Pi 1.3.0 SDK（link-pi-sdk 未新增链接），Node test，隔离 `PI_CODING_AGENT_DIR=/tmp/agent-nullable-H1nOO9/agent`。raw 日志归本次 owned `/tmp/agent-nullable-H1nOO9`，待独立审查/后续诊断完成前保留，不依赖临时日志作为永久证据。

实际改动：主/嵌套所有字段 required，业务控制字段直接 nullable union；新 parser 先闭合/完整输入校验再复制删除控制 null；args 保留数据。mention clone 私有背景标记继续读取原 input（不能读 parser 副本）。删除全局 Tool Guidance 和文档/导航/spec 引用。跨模块仅更新依赖旧 run 输入的测试 fixture；尚未改 agent_manage/trellis_dispatch 产品代码。

失败与 rerun：

- 首次 `pnpm typecheck` exit 2：union 输入用于 workflowCallName 的 nullable 类型不匹配，以及泛型 TSchema 不能直接访问 description；修正渲染 null→undefined 与 Reflect description 读取。
- 第二次 typecheck exit 2：测试完整参数 helper 的 Record unknown 与 ToolCall JSON 类型不匹配、动态删字段的类型；修正测试 SDK 边界断言和显式 Record。
- 首次 contract focused exit 1，25 tests 中 4 FAIL：旧 fixture 未提供 nested 完整字段、未显式打开 isolation 导致测试先触发禁用字段校验；修正完整 wire fixture 和测试配置，不改权限业务。
- S1 聚焦自然退出 exit 0，86/86 PASS；Agent 广域首次 exit 1，238 tests 中 1 FAIL，backend-waits 的旧 nested fixture 缺完整字段；补全后 exit 0，238/238 PASS。
- 全套首次 `pnpm check` exit 1，1427 tests 中 11 FAIL：跨模块 registered-agent、retained-child、sdk-runtime 的旧 run fixture 未提供完整字段；另新增 host null 必填测试发现宿主把 non-nullable string 的 null 转为 string（不是 schema 原生接受 null），因此改为记录实际 host coercion 并保持工具非空准入。raw 必填 null 仍拒绝，不修改 SDK。
- 全套第二次 exit 2：新增测试局部 required 重复声明，修正测试声明。
- 全套第三次 `pnpm check` exit 0：typecheck PASS，1427/1427 tests PASS（configured forced exit）。
- 最终自然退出 `node --test extensions/agent-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/retained-child.test.ts extensions/beautify/__tests__/registered-agent.test.ts extensions/task-ui/__tests__/sdk-runtime.test.ts extensions/runtime-tasks/__tests__/prompt.test.ts` exit 0，252/252 PASS。
- 最后 workflow schema description 补充 null 用法后，`pnpm typecheck` 与 `node --test extensions/agent-tasks/__tests__/input-errors.test.ts extensions/agent-tasks/__tests__/nullable-schema.test.ts extensions/agent-tasks/__tests__/tool-contract.test.ts` exit 0；最终 `git diff --check` PASS。

限制：上述均离线 actual-host/fixture 验证，不是真实 provider 演示；独立人工审查尚未完成，stage commit 尚未创建。S2 与用户部署验收 NOT_RUN。CLI start 提示 main 与 base_branch 相同，后续归档会拒绝，未擅自切分支。其他并行改动保持原状。


## S2 执行与最终提交记录

- S1 checkpoint：`301672d fix: require explicit nullable Agent tool controls`。S2 checkpoint：`b7e20f2 fix: align Agent management and dispatch nullable controls`。
- S2 修改 agent_manage 所有暴露字段 required，执行/parser/Beautify 共享控制 null 语义；Process 分支保持原 schema/执行。trellis_dispatch plain schema 全字段 required+nullable，解析先完整/unknown 检查后删除控制 null；权限、工作目录、租约、停止语义未改。
- 初次 focused：22 tests 中 2 FAIL，旧 explicit undefined stop fixture 应先报缺字段，不是原模式冲突；仅更新对应错误预期。
- 初次全套 `pnpm check` exit 1：1429 tests 中 1 FAIL，host-loading-smoke 的管理模型调用缺 execution_id/kind/verbose；修正完整 wire fixture。
- 第二次 `pnpm check` exit 0：类型检查与 1429/1429 全套 PASS。
- `node --test extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts extensions/trellis/__tests__/dispatch-params.test.mjs extensions/trellis/__tests__/dispatch.test.mjs extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/agent-tasks/__tests__/workflow-failure-host.test.ts extensions/agent-tasks/__tests__/loading.test.ts` exit 0，201/201 PASS，无 forced exit。
- 自审去除 trellis validator 已被共享 parser 覆盖的重复 unknown 循环；随后 `node --test extensions/runtime-tasks/__tests__/nullable-controls.test.ts extensions/trellis/__tests__/dispatch-params.test.mjs extensions/trellis/__tests__/dispatch.test.mjs` exit 0。
- 用户纠正 docs/spec 边界后，只保留用户功能说明；撤销本任务新增 spec 规则，仅删除失效原语句与扩展引用。最终 staged `git diff --check` PASS。
- 未开 Agent；独立审查按用户显式豁免，结果是主会话自审而非独立审查。未安装/reload/push/归档，未创建其他工具任务；真实 provider/用户部署验收 NOT_RUN，任务保持 in_progress 等待确认。
- raw 日志在本次 owned `/tmp/agent-nullable-H1nOO9` 保留，便于部署失败时对照；尚未清理，不声称已清理。main/base_branch 同名归档限制仍未变更。
