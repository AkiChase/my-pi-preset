# 内置 Subagents Skill 加载技术研究

## 结论与实施阻塞

本轮仅做源码与文档检查；未运行测试、provider、安装或 reload，未改产品、任务状态或旧研究稿。新中文预览见 `skill-preview-zh.md`。以下 SDK 路径以 `SDK=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent` 为前缀；项目路径均相对源项目根目录。行号指当前安装 dist 或当前源码，不是远程 main。

**不能直接批准“注册 resources_discover 即同时满足禁用策略”的实现。** 实际 Pi 1.3.0 的追加通路绕过 `noSkills` 和 package/settings 的资源过滤：`SDK/dist/core/resource-loader.js:323-349` 的 `extendResources` 无开关判断；`:624-642` 只在 `noSkills && skillPaths.length === 0` 时清空，否则仍加载。只要 handler 返回非空路径，noSkills 就不阻止它。`:424-428` 的开关只影响 reload 初始发现集。追加资源也不回到 package-manager 的 enabled 过滤。不能把文档“禁用发现的 Skills”误当作追加资源保证。

**另一个阻塞是子会话注册位置。** `extensions/agent-tasks/src/index.ts:337-341` 在 child marker 下直接 return。在该行之后注册的新 handler 不会出现在真实 child ExtensionRunner 中。把 handler 简单提前又会把上述 noSkills 绕过带给 skills:false/string[] 子 Agent。仅在 handler 里调用 `inChildSessionContext()` 不能判断事件归属：marker 包围的是加载和 createAgentSession，`:1138-1153` 的 bindExtensions 在其作用域外。

最小建议：保留插件 resources_discover 和 module-relative 路径；将资源注册与 root manager 注册分开；**先明确可验证的 gate，失败闭合，不改 SDK。** 子 loader 可以使用公开 `skillsOverride` 在已有 `noSkills` 判断下过滤此次内置资源（建议仅过滤自己，避免顺手改变其他扩展的既有策略）；注册位置须在 child return 之前，且不创建 manager。这是一项候选设计，不是已通过测试的方案。主会话 `--no-skills` 不是 Settings 字段，公开 `ExtensionContext`/`pi.getSettings()` 不能可靠读取 loader 的 `noSkills`，也不能据“当前 Skill 列表为空”判断禁用与尚未发现。仅解析 `process.argv` 无法覆盖 SDK 构造的 noSkills，且不解决 package filter。因此当前没有证据支持一个只用现有公开 extension API、覆盖顶层 SDK/CLI 与过滤的完整 gate。需要主会话与用户决策：允许一个窄且 actual-host 验证的兼容 seam，或暂不实施资源追加方向。不要自行批准私有字段访问、新配置框架、SDK 修改或弱化 AC3。

## 1. 实际事件链路

- `SDK/dist/core/extensions/types.d.ts:551-562,1188`：事件为 `cwd` 和 `reason: startup | reload`；返回 `skillPaths?: string[]`，无 gate/disabled 信息。
- `SDK/dist/core/extensions/runner.js:1165-1199`：建立当前 runner context，按保留 extensions 的 handler 顺序调用，给每个返回路径附加所属 `extensionPath`；异常上报 extension error 后继续。没有 noSkills 检查。
- `SDK/dist/core/agent-session.js:2632-2653`：`bindExtensions` 应用绑定，先 emit session_start，再 reportUnhandledMcpServers，再 discover startup/reload。不是 factory 调用时发现，也不是仅 loader.reload 就发现。
- 同文件 `:2655-2688`：调用当前 runner，构造 temporary/top-level source metadata（这里 top-level 是资源来源分类，不是“只能主 Agent 收到”），调用 loader.extendResources 后重建 system prompt。
- 同文件 `:2944-3002`：reload 先旧 session_shutdown、invalidate、settings/loader.reload、重建 runtime；仅在 hasBindings 时发 reload session_start/discover。普通 SDK loader.reload 本身不发送事件。不能笼统承诺所有无绑定 SDK reload 都追加。
- `SDK/dist/core/sdk.js:80-86,339-361`：已有 resourceLoader 不再 reload；构造 AgentSession，不在 factory 自动 bindExtensions。文档 `docs/sdk.md` 的 MCP 示例也明确要求 bind。

## 2. 顶层与真实 child 的差异

顶层实际入口是 `extensions/task-composition.ts:15-40`，其中调用 agentTasks 并统一注册 management；package manifest `package.json:11-15` 只列 `extensions/*.ts`，不直接加载 nested index。

子路径为 `agent-runner.ts:711-727` 解析 isolated/extensions/skills，`:764-766` 设置 noSkills（false 或 string[] 都为 true），`:826-838` 构造 DefaultResourceLoader，`:844` 在 withChildManagement + child marker 下 reload；`:1079-1115` 创建 session（marker 包围 create）；`:1138-1153` bindExtensions；`:1159-1167` 才应用 live tool scope。其 runner 是 child cwd/sessionManager/modelRegistry，不是父 runner 的资源广播。每个 child 必须自己保留 handler 并 bind 才能收到发现事件。

`child-context.ts:7-41` 使用 namespaced Symbol.for + AsyncLocalStorage 跨 jiti graph；只记录 boolean，不能表示 skills policy。`SDK/dist/core/extensions/loader.js:110-134,459-490` cache 随 cwd 改变失效，moduleCache:false 导入新 graph。不能把一次父 factory 的状态当作所有孩子状态。

子 extension include/exclude 在 `agent-runner.ts:809-842` 的 extensionsOverride 应用；被排除的 factory 可能已经跑过，但 handler 不进入保留的 runner。`ext:` 是 tool scope，不是 resource scope，见 `:790-800,249-282`；工具 narrowing 不阻止保留 extension 的事件。isolated 强制 extensions:false、skills:false，且不注入 nested tools（`:711-727,928-966`）。没有扩展来源时，插件 Skill 不应复制或额外注入。

当前 `skill-loader.ts:34-107` 是 Agent frontmatter string[] 的**正文预载器**，只查项目/用户/legacy 根，按目录名而非 frontmatter name 找，拒绝 symlink；找不到返回提示字符串。它不是 Pi 原生索引，也不认识插件发现路径。不能将本任务 Skill 加到此处、把 string[] 改为全量发现或强制预载。string[] 路径保持现有预载语义，本任务额外内置 Skill 应被禁止。`prompts.ts:100-136` 的 append 模式把父 system prompt 整段原样放进 child custom prompt，`:93-97` 则另加预载正文。因此即使 child loader gate 禁止新内置 Skill，父 prompt 已有的 Skill 索引/短规则仍可能以旧文本继承；此行为不等于 child 资源发现，也不应让读取规则追随被禁用的父索引。若 AC3 要求 skills:false 子 prompt 连父索引都不存在，当前 append owner 是额外阻塞，需要明确是否允许最小过滤父继承的本 Skill 索引（不改其他 parent context）。本轮未改这一行为，也未自动扩大批准范围。`prompts.ts` 的预载正文 owner 与资源发现不可混同。

## 3. 路径、正文与冲突

`agent-session.js:2674-2688` 的 metadata.baseDir 来自 extension dirname；但 `resource-loader.js:613-623,786-801` 对 entry.path 使用 loader.cwd 解析，**不是 metadata.baseDir**。必须返回绝对 native path，如在 src helper 中 `fileURLToPath(new URL('../skills/subagents/SKILL.md', import.meta.url))`（若 helper 位于 src，../skills 是正确相对位置），不要返回依赖 cwd 的相对路径。`SDK/dist/utils/paths.js:69-94` 支持 trim、~、file URL、绝对化；mergePaths canonicalize(realpath) 后去重但保留 resolved path。

`SDK/dist/core/skills.js:137-177,216-263`：loader 为读取 frontmatter 会读整个文件，但 Skill 对象只保留 name/description/filePath/baseDir/disableModelInvocation，**不会把正文交给模型**。directory 有 SKILL.md 就停止下钻，所以 references 不会成为独立 Skill。直接文件路径与目录扫描不同：目录受 ignore 规则，直接 md 路径不通过目录 ignore 检查；应在 gate 后返回明确 SKILL.md。

`:278-310` 的 prompt 索引仅 name/description/location；`SDK/dist/core/system-prompt.js:102-109` 必须有 selected read/bash 才生成 Skills section：declared reader 直接命名，hidden reader 仍可间接访问时只写通用加载提示，无 reader 完全省略。索引不是已读证据；read 被拒、不可读、Skill 缺失时不得读旁路 hardcoded 路径或宣称已经加载。

`skills.js:279-282` 的 disable-model-invocation:true 仅排除自动选择索引，不是彻底禁用；`agent-session.js:1698-1721` 用户显式 /skill:name 仍查 loader 列表，实时读正文、strip frontmatter、写入 user skill block，引用基准是 skill.baseDir，读取失败上报后保持原文本。enableSkillCommands 控制交互发现，不代表手打命令拒绝。短工具读取要求必须写“当前可用、未禁用且有允许的 reader”；不能通过此规则绕过 disabled-model-invocation。

`skills.js:326-354` 同一 realpath 静默去重，同名 first wins + collision diagnostic；旧路径先于追加路径，用户已有同名会赢。不要强制覆盖或把自己的正文注入另一个同名入口。已检查当前项目和 `~/.agents/skills` 的 subagents 目录模式，没有匹配；`~/.pi/agent/skills` 不存在。未扫描所有 frontmatter 异名、个人配置 package 与全局资源，不能宣称全局无冲突。推荐 namespace `pi-subagents`（标题仍可 Subagents）降低通用名碰撞；本轮预览沿已定目录/name `subagents`，如采用 namespace 须连同目录与规则让用户确认，不自动改。

## 4. 过滤与发布边界

`SDK/dist/core/package-manager.js:1848-1899`：存在 pi manifest 时只有声明资源进入普通发现；`:1903-1917` package skills:[] 将该类型关闭；`:1980-2066` settings exclusions 在 auto/local/package initial resolve 计算 enabled。`resource-loader.js:379-390` 过滤 enabled；**extendResources 不调用这些过滤函数**。追加 sourceInfo 仅标签，不是 permission。须单独验证 exact -path、!glob、package skills:[] 与 project override，不能以 metadata 有 baseDir 为证明。

`package.json` 无 files 限制，当前 git 源携带 tracked 插件树；private:true，未做 npm pack/发布验证，不能承诺 npm tarball。`scripts/pi-manifest.test.mjs:24-46,112-130` 防 nested extension 二次注册和 root resource convention 漏声明；它不测试插件内部 Skill 包含、发现或禁用。新增内部 Skill 不需要 pi.skills，现有“manifest 没有 skills”断言可保留，增加 internal resource existence/entry test，不能把 Trellis project Skill 改为追加资源。

`extensions/trellis/lib/paths.ts:1-9`、`extensions/process-tasks/commands.ts:21-22` 已使用 fileURLToPath(import.meta.url)；实际 SDK loader `loader.js:459-490` 的 jiti 模块定位与已有 seam 支持该路线，不能据 Node import 或这些源文字断言实际 bundle 已验证。`agent-tasks/__tests__/loading.test.ts:55-86` + `host-loading-smoke.mjs` 是实际 cached SDK loader、same/different cwd/overlap 的既有入口，但当前没有 builtin Skill 测试，也未走 discover/bind 的资源断言。source-loader.mjs 的 in-memory TS transform 不是 host compatibility 验证。本轮未运行任何测试或 bundled CLI。

## 5. 最小验证门槛（待授权实施）

1. 使用现有 SDK、隔离 cwd/agent/config、无模型 prompt 的真实 loader + AgentSession bind；assert factory 注册、startup/reload reason、绝对路径/移动安装目录、reference 存在和 basename。只 fake model boundary，不接 provider。
2. 子 runAgent dependencies seam 保留真实 loader/bind，仅替代 prompt/provider；true、false、string[]、isolated、extension absent/include/exclude、tool narrowing/deny、no reader/hidden reader。证明被禁用内置 Skill 不在 child 索引/正文，不改变预载器。
3. 顶层 noSkills SDK、CLI 对应开关和资源 exact/glob/package filter 场景；gate 不确定时不返回路径。必须先获得可实现 gate 的决策。
4. actual SDK assembler 验证短工具 Rule、peer/hidden、索引不含 Skill/reference 正文；direct no-read 时普通工具仍有全部安全底线，workflow 没有 API 就不编写/猜测新脚本。
5. 碰撞 first-wins、disableModelInvocation、missing/unreadable、reload 移除旧资源、package 内文件检查；再跑 approved focused/lifecycle/typecheck/check。本轮这些均 NOT_RUN。

## 6. 完整内容迁移映射

以下映射以 `tool-guidance.ts:20-54` 与 `workflow/tool-description.ts:3-251` 原段为单位，最终正文见新预览（不重复粘贴长教程）。

| 原内容范围 | 最终唯一 owner | 保留/修正 |
| --- | --- | --- |
| run 委派触发、独立工作/直接小任务、不重复调查；自包含 prompt/实际证据 | 短 run 底线 + delegation「任务与证据」详细解释 | 底线不依赖 Skill |
| run 每字段/null、New/Resume 表、可用类型 | 短 run + 当前 schema | 动态类型保留当次工具，不写死 Skill |
| run resume/settings、配置优先级、modeRule | 短 run + schema；delegation「模式与配置」解释 | 顶层重解析 mode；nested inline；thinking 子设置；parent text |
| run launch IDs/notification/wait、isolation、schedule、New/Resume 示例 | 短 run；delegation「协调/嵌套」 | scheduling/isolation gate 同步示例；nested 无顶层自动完成通知保证 |
| message 全部 5 项含示例 | 短 message | 不迁出必需契约；delegation 只解释选择时机 |
| agent_manage 全部 action/ID/stale/wait/ownership/consume/examples | 短 manage（基本保持） | verbose additional conversation；delegation 解释协调，不另维护完整表 |
| process_manage 所有规则/schema/examples | 完整 process 工具 | 不迁入任何 reference；limit configured budget、search false/0 |
| workflow 开头执行/后台/UI、opt-in 三路径与未授权替代 | 短 workflow | Skill 阅读不构成用户主动调用授权 |
| workflow 用途、hybrid、Understand/Design/Review/Research/Migrate、跨轮串联 | patterns「选择与规模」 | 保留 |
| workflow 全字段/source/args/meta/inline/save/iterate | 短 workflow 底线 + workflow-api「来源与 meta」 | API 详细保存/迭代 owner；原 schema 不改 |
| workflow meta 示例/纯字面量/阶段匹配/model | workflow-api「来源与 meta」 | 完整保留示例 |
| agent() 全签名/opts/schema/null/label/phase/model/effort/isolation/gate/resume/agentType | workflow-api「完整 hooks」 | model 显式优先；effort 子设置；类型改当次 schema |
| pipeline/parallel/log/phase/args/budget/workflow、未知 opts、structured output/JS 禁区 | workflow-api「完整 hooks/运行边界」 | 全部保留 API/限制；无 nullable JS 迁移 |
| pipeline 默认、barrier 正反理由/smell test | patterns「pipeline 与屏障」 | 全部保留 |
| concurrency 16/CPU-2、1000/4096 | workflow-api「运行边界」 | 原公式与排队，不 silent cap |
| canonical pipeline、dedup barrier、count、gate retry、seen dry、skeptics code | patterns「完整示例」 | 原标识符/代码/注释英文；教学占位不伪装完整可运行 |
| 8 种 quality 模式、规模/完整性/新模式/确定性控制流 | patterns「质量与完整性」 | 全保留，不将 ordinary task 升格授权 |
| Resume 全段：execution id/scriptPath/args、prefix/cache/failure/same-session/finished/journal/time | workflow-api「重放」；短 workflow 保留 session/finished 底线 | 保留现有语义，不修 replay/cache 行为 |

预览不沿用旧完整长 promptGuidelines；SKILL.md 只有入口与分流，三页 references 提供完整拟迁移正文。教学示例原来的 BUGS_SCHEMA、DIMENSIONS、key 等占位保留，不能当 runnable fixture；产品实施时应测试真实完整脚本，而不是把占位文字测试通过。## 7. 已知准确性差异与未扩大范围

当前 nested 共用 `runToolGuidance` 写“后台完成自动通知”，但 `agent-runner.ts:145-151`/`invocation-config.ts:141-151` 的设计及 `index.ts:686-691` 实际回调只向 top-level 通知。新预览将 nested 改为必须在 parent 结束前 owned manage 收取、不能依赖顶层自动通知；这是纠正已有不准确指引，不改变 notification 行为，主会话需明确纳入文案 review。

`workflow/runtime.ts:29-38,721-725` 还存在内部 nested invocation cap=256，原长规则只公布 1000 agents/4096 items。本轮未将未批准的新 API 限额扩展进预览，记录此已知完整性边界；不是保留旧规则内容的遗漏。`:671-675` 对带 agent resume 的 journal 整体不复用，与原“相同 script/args 100%”文字存在限定冲突。按本轮约束未机会性改 replay/cache 行为或已审措辞；应由主会话记录当前保留文字的已知限制，不把预览当所有脚本 replay 的运行保证。

测试、bundle seam、禁用 gate 与完整 type/schema 运行断言均 NOT_RUN；读取现有测试源不是 PASS。
