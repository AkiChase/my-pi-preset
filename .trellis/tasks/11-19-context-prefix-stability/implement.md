# 实施计划与变更范围

## 当前状态

**已获实施批准，任务 in_progress。** 用户已确认 `design.md` 第 9 节全部 12 项分类并明确“可以，开工吧”：1/7 按需，4/5 尾部更新，其余首轮一次；保留 B 类现有内容，不缩成入口或改为全部按需。阶段 1 委派 `trellis-implement` 独立实现 Memory/启动生命周期，主会话核对验收；后续可主会话直接实施。最终拟使用 `trellis-check` 独立审查，不运行多 Agent workflow。

## 变更范围总览

| 模块 | 预计源文件 | 为什么要改 | 保留/排除 |
| --- | --- | --- | --- |
| 一次性启动语义 | 新增 `extensions/shared/model-context/startup.ts` | 当前分支历史去重、恢复/reload/压缩、保存确认与 origin 防护 | 不做通用同步/订阅服务，不改 SDK |
| Project Memory | `extensions/memory.ts`、`extensions/memory/prompt.ts`；按 origin 恢复需要修改 `memory/tools.ts`、`memory/command.ts` | 固定规则与首次索引分开，停止每轮 scan，实际访问时恢复/报错 | 存储格式、revision、锁/原子替换、list/read 和工具 schema 不变；`store.ts` 原则上只作负回归验证 |
| Trellis 上下文 | `extensions/trellis/index.ts`、新增 `extensions/trellis/lib/model-context.ts` | 将原 overview/workflow 的 B 类内容首轮移到普通消息，排除 A 类 Git/开发者；当前任务/阶段提示 C 类尾部更新，CLI 不重建 system | 首轮内容不额外删减；保留原模式/预算、native authority、worktree/session key、兼容 gate 与 UI |
| Trellis 包源指引 | `extensions/trellis/skills/trellis-start/SKILL.md`、`extensions/trellis/resources/templates/workflow.md`、对应 `skill-baseline.json`、`template-baseline.json`，仅确需时修改 | 准确说明首轮一次普通上下文及后续不自动刷新，保持实际修改资源 hashes 一致 | 不改成启动时不提供/只给路径；不改 source 原始 hashes 或项目生成副本，未改资源不改 hash |
| 子 Agent prompt/启动 | `extensions/agent-tasks/src/prompts.ts`、`src/agent-runner.ts`、`src/memory.ts`、新增 `src/system-inheritance.ts` | 原模式下父规则/启动材料分开继承，环境/Memory/技能 B 类首轮普通消息，resume 不补发 | 不静默删原有材料；角色/identity、append/replace、isolated、scope、只读、workflow output/StructuredOutput 等契约不变 |
| 子 Agent 类型/调用点 | `src/types.ts` 或 prompt 构造的直接调用点，仅在新内部返回结构确需时调整 | 内部类型与调用同步 | 不改公开 tool/frontmatter/config schema；`src/context.ts` 的历史继承范围不扩大 |
| 用户说明 | `docs/extensions/memory.md`、`docs/extensions/trellis.md`、`docs/extensions/task-composition.md` | 解释启动快照、按需读取、子 Agent 材料与通知边界 | 不写用户工具参数教学、历史迁移流水或内部测试教程 |
| 长期合同 | `.trellis/spec/development/index.md`、`.trellis/spec/testing/index.md`，确需时相关 SDK/资源文档 | 保存可执行的“数据不提升 system、启动一次、实际输入验证”合同 | 不把 task 临时过程、工具调用教学复制进 specs |
| 测试 | Memory、Trellis、Agent-tasks 现有测试；新增 shared/model-context 合同测试 | 字符串正确不等于请求前缀/生命周期正确 | 全部隔离、离线，不访问个人配置/记忆/会话，不以 forced exit 证明自然退出 |

预计为十余个产品源/资源文件，加对应测试、文档与少量规范；不是只修改 `sectionCache.delete` 的小修。新增路径为计划名，实际落地与验收见各阶段记录；具体局部文件分拆可在同一行为/owner 边界内调整，若扩大公共配置或执行权限则重新审阅。

## 阶段 1：共享启动一次语义 + Project Memory

### 实施

- [x] 建立小型 current-branch startup 记录识别/确认 helper；成功快照用自身 custom message 作为记录，skip 用非模型小记录；保存失败不提前确认。
- [x] 固定 Memory system 规则不带索引/诊断/实时开关状态，启动索引为一次普通消息。
- [x] 停止普通 `before_agent_start` 元数据扫描；write/forget 无自动索引通知。
- [x] 真实 list/read、命令与 mutation 保留实时性；初始 store 失败在明确操作时可受原安全边界重试。
- [x] 完成新会话、恢复/reload、fork/tree、压缩、启停、空库、错误和 stale epoch/persistence 负例。
- [x] 同阶段更新 `docs/extensions/memory.md` 和受影响固定规则测试。

### 验证命令

隔离环境按文末“执行环境”设置，已有 SDK 不再安装：

```sh
node --test extensions/shared/model-context/__tests__/*.test.ts extensions/memory/__tests__/*.test.ts
pnpm typecheck
```

新增测试文件计划：`shared/model-context/__tests__/startup.test.ts`、`startup-sdk.test.ts`。修改现有 `memory/__tests__/prompt.test.ts`、`loading.test.ts`、`tools.test.ts`，其他安全/存储/命令测试作为负回归。新增测试以实际 SDK requests 断言位置、持久化与 scan 次数；不弱化现有错误或安全断言。

**提交检查点：** 自查 + 相关测试/typecheck 通过后提交本阶段耦合代码、测试和 Memory 文档；不得将仅 helper 未接入的半成品当作阶段完成。

## 阶段 2：Trellis 首轮内容移出 system，当前状态尾部更新

### 实施

- [x] 保留原模式下 overview 的 B 类首轮内容（Journal、任务列表、项目/执行/CLI 信息等），只排除 A 类主会话 Git 和开发者身份；作为普通启动消息提供一次。
- [x] 原 `trellis-workflow` section 保留内容与 full/compact/headless 过滤/预算，首轮普通消息提供，不改为只有路径或主动读取才提供。
- [x] 当前任务身份/状态/材料/task_error 与阶段 breadcrumb 按 C 类尾部更新，保留提示内容；真实内容变化才发送，恢复/reload 从分支历史恢复去重。
- [x] CLI 结果只刷新 task/UI 缓存，不重建/补发 B 类启动消息，也不强制重复 C 类状态；校验错误仍阻断。
- [x] 包源指引如需改变承载位置表述，仅改相关文字并更新 adapted hashes；不为了精简首轮内容修改流程，未改 bytes 不改 hash。
- [x] 同阶段更新 `docs/extensions/trellis.md` 和相关测试。

### 验证命令

```sh
node --test extensions/trellis/__tests__/*.test.mjs
python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'
pnpm typecheck
```

重点改造 `initialization.test.mjs`、`agent-context-integration.test.mjs`，新增 `model-context.test.mjs`（fake-pi）；对比旧 renderer 的首轮内容，断言仅移除用户选 A 的字段，B 类完整内容保留，C 类阶段提示未被改成仅按需。回归 `manifest-provenance.test.mjs`、`resource-hash-only.test.mjs` 等现有资源测试。Trellis 不新增真实 Pi mounted host/TUI 测试；最终跨 provider 输入验证由 shared 层负责。

**提交检查点：** 逻辑、来源隔离、权限阻断、资源/hash 一致性通过后，代码、包源资源、hash、测试和文档一起提交。个人 Update resources/reload 不在这个检查点自动执行。

## 阶段 3：子 Agent 规则继承与启动材料分离

### 实施

- [x] `buildAgentPrompt`/runner 形成规则 system 与普通启动材料两个内部输出；同步必要类型与直接调用点。
- [x] 结构化分开父规则与原 append 模式启动材料：已知 B 类移到普通消息而不静默删除；保留 opaque 规则与第三方契约，不用 regex 全文清洗或 Pi 私有 assembler。
- [x] 环境/Git、per-agent `MEMORY.md`、显式技能预加载改到首次任务输入；固定 Memory 能力/角色/identity/worktree/output 契约留在规则层。
- [x] 新 child 初次提供材料，普通 resume 不重读/广播；不扩大 `inherit_context` 或工具权限。
- [x] 覆盖 append/replace、isolated、noSkills、memory scope/只读、缺文件/非法名称、父 context 有无、nested/workflow child 与 StructuredOutput 的负回归。
- [x] 同阶段更新 `docs/extensions/task-composition.md` 的子 Agent 行为说明。

### 验证命令

```sh
node --test extensions/agent-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/reminder-sdk.test.ts
pnpm typecheck
```

新增 `agent-tasks/__tests__/prompt-context.test.ts`、`system-inheritance-sdk.test.ts`，修改实际 runner/loading fixture；回归 `runner-cancellation.test.ts`、`loading.test.ts`、`workflow.test.ts`、`worktree-lifecycle.test.ts`、`tool-waits.test.ts`。现有 test-only source-loader 可按新增模块需要适配，但不能用它掩盖真实 SDK/loader 缺失。

**提交检查点：** 规则继承、启动/续跑、角色与权限负例及相关文档通过后提交，不把 public tool/config 变化混入本阶段。

## 阶段 4：跨模块输入合同与交付检查

### 实施/审查

- [x] 新增 shared 层 `prefix-sdk.test.ts`：捕获实际离线 SDK requests，并经两种 system 能力的 provider 序列化路径比较头部/历史前缀。
- [x] 对照 12 项选择集成验证：A 类无首轮自动注入；B 类首轮完整提供且后续无广播；C 类任务/阶段内容变化尾部追加并去重；子 Agent 原材料未丢失且不进 system。
- [x] 旧格式会话接入区分一次性规则转换与后续普通更新，不编辑 fixture 以外的真实历史。
- [x] 复查固定规则是否保留完整授权入口，检查 docs/spec 与实际能力一致。
- [x] 使用预先策划的 `trellis-check` 独立审查；任务须已 in_progress 且上下文有效。子角色不提交、安装或归档。
- [x] 故障修复回到 owning stage 验证；真实失败与修复后 rerun 均记录，不只保留最后 PASS。

### 最终验证命令

```sh
node --test extensions/shared/model-context/__tests__/*.test.ts
node --test extensions/memory/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/reminder-sdk.test.ts
node --test extensions/trellis/__tests__/*.test.mjs scripts/pi-manifest.test.mjs
pnpm check
git diff --check
```

跨模块测试不宣称真实线上 cache hit；离线 fixture 验证输入与时序，host/provider 的缓存 TTL、模型切换、压缩及第三方 hook 仍是边界。全套 `pnpm check` 使用 forced exit；上述 focused commands 不带 forced exit，用于自然退出/生命周期证据。

**提交检查点：** 独立审查与最终集成验证完成后提交剩余合同测试、必要 specs 和耦合修复；不把前三阶段累积成唯一最后提交。默认实施授权包含主会话分阶段本地提交，若用户另行要求不提交则记录并遵守。无 push、个人部署、archive/journal 授权。

## 执行环境与原始材料

- 每次验证前创建本次拥有的仓库外临时运行目录；使用已安装 SDK，`PI_CODING_AGENT_DIR` 指向临时子目录。工具/安装缺失为 blocker，不自动 `pnpm install`。
- 示例隔离入口，真正执行前检查 setup 成功：

```sh
run_dir="$(mktemp -d)"
mkdir -p "$run_dir/agent"
sdk_dir="$(node -e 'const fs=require("node:fs");const p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
export PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$run_dir/agent"
```

- stdout/stderr、临时驱动和失败材料留在 owned run_dir；主会话核对失败与 rerun 后才能只清理本次目录。不会把完整日志复制到任务 `research/` 或 `evidence/`。
- 最终执行记录在本文填写命令、环境、exit code、结论、失败原因/重跑关系和未运行限制；无需每个角色写单独报告。

## 开始前门禁

- [x] 用户审阅 PRD/design/implement 的文件级计划并授权实施。
- [x] 再核对 Git/当前任务与完整 owning source/callers/tests，不覆盖并行改动。
- [x] 阶段 1 委派实现的 `implement.jsonl` 已策划真实 specs；最终独立 review 的 `check.jsonl` 已策划，派发前再校验。
- [x] 已在有意空 manifest 的直接实施规划基础上执行批准后的 `task.py start <task> --allow-empty-context`，随后为阶段 1 委派补齐 implement manifest。启动时提示记录 branch=base_branch=main；当前不做分支/归档操作，不将提示当作产品验证结果。
- [x] 实施前已完整读取相关 extensions/SDK 文档及直接关联示例。

## 验证记录

### 阶段 1：已验证并提交 `80e9910`

实现者：`trellis-implement`；主会话独立读取全部阶段改动、共享 helper/测试、实际 SDK Memory 测试和命令/工具调用点后复核。仅改 Memory、共享 startup helper/测试、Memory 用户文档，未改存储算法或工具 schema。

- Agent 隔离 focused-1：exit 1，77/80；旧 recovery 断言、诊断 regex、分支 reset fixture 错误。修复 fixture 后 focused-2：exit 0，82/82。
- 扩展 reload fixture focused-3：exit 1，85/86；实际 SDK reload 缺少 onError binding，未触发 session_start。补齐真实绑定并检查无吞掉的错误后 focused-4：exit 0，86/86、自然退出。
- Agent typecheck-1/2：exit 2，分别为 fixture partial-context cast 与 ToolCall JsonObject 参数类型；修复后 typecheck-3/4：exit 0。
- 主会话同一已安装 SDK、临时 agent dir，执行 `node --test extensions/shared/model-context/__tests__/*.test.ts extensions/memory/__tests__/*.test.ts`：通过 86/86、自然退出；随后 `pnpm typecheck` 通过，未新增 SDK 链接/下载。
- 实际请求断言覆盖固定 system、一次普通索引、无后续 scan、显式 list/read 实时、恢复/reload/fork/压缩、初始诊断与实际访问修复、原子 EISDIR rollback。未建立非原子 returned-message 保存失败跨 reload 的支持保证；已测试安装 SDK 原子 rollback 及同 activation 失败 skip marker 的保守处理。
- raw logs：本次 owned `/tmp/context-prefix-stability.d4JPI5/stage1.BhAIVl`、`stage1-main.log`、`stage1-main-typecheck.log`，主会话已核对最终日志；保留待集成复查。
- Trellis 改动前基线：隔离 `agent-context-integration`、`project-activation`、`unsupported-runtime` 三组，exit 0、37/37；仅为阶段 2 改动前基线，不作改动后验收。

### 阶段 2：已自查验证并提交 `e1be11e`

主会话直接实现。复查 `renderOverview` diff 仅删除 Git/开发者块，原 Journal、任务列表/状态/children、根目录/context/CLI/protocol 等渲染不变；workflow renderer/filter/14,000 字符预算不变。启动/当前状态合并为一次 returned message，后续读取当前完整分支的最后 state，未确认草稿重试。CLI 清除 context/task/UI 缓存但不清除持久化启动/状态记录；native authority、角色、worktree 门禁均保留。包源只改 `trellis-start` 的承载位置说明及它的 adapted hash，未改 source hashes、workflow 模板或生成副本。

- 原三个 context 回归组，阶段 2 第一次 focused：exit 0，37/37。
- 第一次完整 `.test.mjs`：exit 1，409/463；主会话在测试尚运行时修改 skill bytes，直到 adapted hash 更新前形成暂时不一致，造成大量 package hash mismatch（含关联断言失败），不能作有效完整验收。另有三个新增 fixture 失败：空任务列表被断言为非空、将原预算误写为 12K（实际 14K）、fake `on` 缺少卸载函数。保留失败日志并修复这三项 fixture，不放宽原产品预算/安全断言。
- 资源静止且 hash 耦合后 focused-2：exit 0，10/10。
- 同样静止条件下完整 `node --test extensions/trellis/__tests__/*.test.mjs`：exit 0，473/473、自然退出，无 skipped。包括新 startup/persistence/branch/compaction/phase/error/cancellation 测试及现有源权威、worktree、资源/UI 回归；仍未挂载真实 Trellis host/TUI。
- Python 首次 discovery 错选父目录：exit 5，0 tests，**不是 PASS**。按计划实际 `__tests__/python` 目录重跑 `python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'`：exit 0，42 tests OK；argparse 的非法 refresh/collect stderr 为预期负例。
- 最终 `pnpm typecheck`：通过；`git diff --check` 通过。隔离 agent dir 和 raw logs 均在 `/tmp/context-prefix-stability.d4JPI5`（`stage2-*`），未安装/下载或个人 reload。

### 阶段 3：已实现、自查验证并提交 `7d26d56`

由独立 `trellis-implement` 实现，主会话完整复核最终 runner、prompt、Memory、继承 helper、SDK 驱动/断言和相关 fixture 改动。内部接口拆分为 `{ systemPrompt, startupContext }` 与 Memory `{ rules, startupContext? }`，配置/schema、`context.ts` 的历史选择、readonly/worktree/output 执行门禁未改。

- 原 append 已继承的父 Agent env/MEMORY/显式技能及 Trellis B 材料仍普通继承，带 parent/non-authority framing。Trellis 父 marker 不转交为 child 已初始化，以免跳过不同 child 执行根、CLI key/角色入口；仅有明确同源 Project Memory 索引保留窄 owner 去重。不同来源仍有自己的启动机会。
- 普通 tool ctx 无 command-only `getSystemPromptOptions()`；它只给 base 输入。实现使用公开 branch/system replay，并真实验证与生效 prompt 一致。有可识别数据却不一致时明确拒绝启动；未知 opaque 内容保留，不猜测/清洗。旧 Agent extras 若嵌在未结构化 opaque customPrompt 内，不承诺猜测分离；这不是偷偷丢掉材料。
- Agent focused-1：exit 1，312/313；replacement fixture 复用已关闭 session，改用独立 replacement session并等待实际执行结束后断言。focused-2/3：exit 0，319/319、自然退出。
- Agent typecheck-1、3、4：exit 0；typecheck-2：exit 2，fixture compaction 参数/类型错误，修复后通过。SDK-1–4 fixture 发现/active tools、section 双重包装、isolated preload 断言错误已在临时日志保留；SDK-5/6 与最终 affected SDK/prompt 6/6 通过。
- 主会话自查发现 inert inherited parts 只依赖 append 完成，缺少每条当前分支确认；补上 key/content/version 确认和去重，新增未保存惯性材料不能被后续 local marker 掩盖的零执行负例。
- 主会话独立同计划 full Agent/reminder 命令：exit 0，320/320、自然退出，无 skipped；最终 `pnpm typecheck`：exit 0，`git diff --check` 通过。HOME、agent dir、raw 输出均隔离于 `/tmp/context-prefix-stability.d4JPI5/stage3-main.ViW0Hc`。
- unshimmed Pi loader + SDK：主会话复核实际驱动、report 和 24 请求/6 child 请求断言；首轮原 Git/environment、MEMORY200、显式技能全文和错误提示均持久普通提供，live/disk 历史前缀相同，命令 base 与 effective 结构区别得到验证，forced source 拒绝且无 child 请求，取消释放 session，EISDIR 原子 rollback。尚非 dual-provider 序列化验收。
- Agent raw：`/tmp/context-prefix-stability.d4JPI5/stage3.xmKaby`；主会话 raw SDK：`stage3-main.ViW0Hc/agent-inheritance-sdk-6s0ZZ6/{requests,report}.json`。失败与最终重跑均保留待集成复核，未安装/部署或修改 SDK。

### 阶段 4：最终输入合同、独立审查和直接 Node 验证完成

新增 shared `prefix-sdk.test.ts`，实际 Memory factory 与 fake-pi Trellis 的原始 returned drafts 经真实 SDK 持久 append；没有挂载 native Trellis host/TUI。OpenAI Responses/Anthropic 的公开 `onPayload` 截获真实序列化 payload，受控错误阻止发送，另加 rejecting `fetch` 且计数为零。四个 API/capability 组合分别验证普通 B 首轮原内容、C 状态尾部变化/去重、explicit list 实时、无普通 Memory scan、旧 SDK/序列化消息前缀保持；复用 unshimmed child SDK fixture，比较 fresh/live/disk 的两种 API/两种 capability 序列化前缀。

- prefix-first：exit 1，1/5；错误 spy 指向不存在的 `scanMetadata`，实际 owner 是同步 `scan()`。没有下调扫描断言，改用真实方法后 prefix-second：exit 0，5/5、自然退出。
- typecheck-first：exit 2，fixture init plan 可为 undefined；改为显式断言非空后 typecheck-second：exit 0。
- 保留首轮正文/预算且数据不提升 system；缓存关闭时比较精确历史 payload 前缀，另验缓存开启时 leading rules/declarations。这样不把 vendor 移动的 cache_control anchors 当成 preset 历史改写，也不宣称线上命中率。
- 复用 child fixture 时补上全部 owned sessions 的 shutdown（包含已替换/completed 的实例），不仅关闭最后一个；当前 prefix 子 fixture 通过，但 owning Agent/reminder 全组仍待最终重跑。
- 更新 development/testing/SDK 边界长期合同；task/source instruction、tool schema/权限或依赖未扩大。
- raw：`/tmp/context-prefix-stability.d4JPI5/stage4.nD5f9i/prefix-{first,second}.log`、`typecheck-{first,second}.log`、`prefix-sdk-*/capture.json` 及复用 child `{requests,report}.json`。此前只读 probe 的不完整 SystemMessage fixture 失败与修复记录保留在 owned 主目录，不当成产品 PASS。

### 最终独立审查与修复

- 首轮 `trellis-check` 只读审查确认 P2：Trellis startup 的 `tagged()` 按首个字面 closing tag 截取，合法正文中的 tag 示例会丢后续 B 内容或误取 overview 内的 workflow 示例。只读复现 exit 0；不是测试通过就忽略的问题。
- 主会话采用审查建议的小修：校验已持久化 `details.state` 精确尾部 C suffix，剥离该 suffix，完整 B composite 作为一份 inert parent material 继承；不解析标签、不复制 state/authority、不改变 producer/schema 或删 B 正文。缺失/空/不匹配 state 或空 B 显式拒绝。新增 literal tags（B 与 C）、missing/mismatching metadata 和 nested 惯性继承回归。
- 同时将 prefix 测试从“只对比首个请求”加强为相邻完整 SDK/序列化请求前缀，覆盖后来的 C 与 tool result 历史；live/disk child 的 wire 前缀也相邻比较。
- 首轮独立直接 Node 验证：focused 16/16、Memory/Agent/reminder 401/401、Trellis/manifest 484/484，均 exit 0、自然退出；typed tsc 与 diff-check exit 0。Raw `/tmp/context-prefix-stability.d4JPI5/check-readonly.V6B6Ts`。
- 修复后主会话 `node --test extensions/shared/model-context/__tests__/*.test.ts extensions/memory/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/reminder-sdk.test.ts`：exit 0，412/412、自然退出；直接 `node node_modules/typescript/bin/tsc -p tsconfig.json`：exit 0。
- 修复后直接运行 package test 的同一 Node 全套命令（`--test-concurrency=8 --test-force-exit` 与原三个 discovery globs，不通过 pnpm/Corepack）：exit 0，1912/1912，无 skipped。全套 forced exit 不是自然关闭证据；上述 focused 是自然退出证据。Raw `stage4.nD5f9i/{owners-final-first,all-node-final,tsc-final-first}.log`。
- 独立角色复审三个改动文件及 producer/确认边界：P2 和 evidence gap 均 resolved，无剩余 scoped defect；直接 Node focused 12/12、3 exact preservation/inert/nested + 4 invalid-record refusal probe、tsc/diff-check 均 exit 0。Raw `/tmp/context-prefix-stability.d4JPI5/check-repair.nqrUZ0`。
- active role manifests `task.py validate` 通过（implement 6、check 5真实引用）；spec discovery development/testing 正常。最终仍不宣称线上 cache hits、native Trellis host/TUI、物理终端或任意 opaque 第三方数据清除。

### 验证入口意外副作用（未解决，不纳入实现提交）

`pnpm check` 的测试本身 exit 0、1911/1911，但该数字在上述修复前，不作为最终 scoped acceptance。其执行入口在脚本之前发生了未授权自动安装：临时 HOME 没有原 Corepack 的版本状态，Corepack 下载 pnpm 12.21.0，运行前 verifyDeps/autoInstallPeers 自动安装依赖，改写 `pnpm-lock.yaml`（autoInstallPeers false → true，新增 SDK/transitives）和仓库 node_modules。安装阶段还报 `ERR_PNPM_IGNORED_BUILDS`，然后继续运行 check；所以总 exit 0 不表示安装/环境安全成功。

主会话已向用户解释该副作用来自隔离 HOME 的调用方式而非 check 脚本新增安装；停止后续所有 pnpm/npm 调用，改用直接 Node/tsc 复验。观察到原安装 SDK 目录/包仍为 11-11 时间，8 SDK peer 链接指向该原安装；没有完整旧 node_modules 快照，不擅称目录已恢复。锁文件/依赖目录未提交、未还原、未删除或重装；用户尚未选择恢复方式。Root raw `stage4.nD5f9i/check-first.log` 保留完整安装失败/下载事实，不能把测试 PASS 擦去副作用。

本次 owned `/tmp/context-prefix-stability.d4JPI5` 暂不清理：依赖恢复决策尚未解决，需保留原始日志、临时 HOME/Corepack 缓存及复现材料；所有本次检查/子角色已终止后也不把未决诊断材料删掉。未 push、改历史、个人 reload、archive/journal 或清除任务绑定；task 保持 in_progress 待验收/后续明确处理。

### 规划阶段历史材料检查（不代表当前执行状态）

规划材料检查已完成：三份 Markdown 无占位项/尾随空白，task.json 为有效 planning，check.jsonl 的 5 个引用均存在且无重复，`git diff --check` 无报告（新文件另行检查了空白）。`task.py validate` 报告 1 个已知诊断：direct implementation 的 implement.jsonl 有意为空；check.jsonl 通过。该结果不是完整 context validation PASS，不为通过校验填入无用引用。

逐项收敛后再次核对，12 项表与用户选择完全一致，旧“缩减首次内容/全部按需”的冲突表述已清除。第一次文档检查误将本文说明中的“无 TBD”当作占位项，属于检查脚本的子串匹配误报；改为占位行匹配后重跑通过，产品测试仍未运行。
