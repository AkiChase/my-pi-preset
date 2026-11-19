# 设计：首轮普通上下文一次，指定状态尾部更新

## 1. 解决的问题与方案边界

本任务不是改缓存算法，而是减少本 preset 主动改写模型输入的原因。日常数据变化不再重新生成 system，也不默认转换成不断追加的快照广播。缓存命中是外部结果，验收对象是输入结构、顺序、扫描次数和数据可用性。

用户已逐项确认第 9 节的 12 项行为，并明确批准开工。本文已按该表收敛：B 类保留既有启动内容，不因移出 system 而删除或精简，也不一律改成按需读取；A 类不自动注入，C 类变化时尾部追加。实施限于本文与 PRD/implement 的范围。保留项目授权、角色身份、工具能力、来源/目录约束；不借优化缓存缩减真实安全契约。

## 2. 模型输入分层

| 层 | 放什么 | 何时更新 | 所有者 |
| --- | --- | --- | --- |
| 固定 system 规则 | 最小 Trellis 协议、Memory 使用规则、角色/身份、只读/执行约束 | 真实规则或角色配置变化时 | 各规则所有者 |
| 工具与资源契约 | schema、工具使用说明、技能目录、AGENTS.md、用户自定义 system | 真实 loadout/资源变更时 | Pi 和现有注册路径，不在本任务重构 |
| 普通启动上下文 | Journal、项目任务列表、项目/执行根目录与 CLI 身份、完整 workflow section、Project Memory 索引、子 Agent 已配置的启动材料 | 首轮一次，后续不自动刷新 | Trellis、Memory、Agent runner |
| 普通事件消息 | 当前会话任务/状态/材料入口/task_error、当前阶段提示；保留现有完成/失败及用户指导消息 | 初次提供，相关内容变化后尾部追加并去重 | 现有状态与消息 owner |
| 工具读取结果 | 主会话 Git、开发者身份；其他内容后续需要最新版本或详情时的查询 | Agent 或用户明确读取时，补充而不替代 B 类首次自动提供 | 现有工具/CLI |
| UI | Git/任务数量、子任务数量、journal/文件状态等展示数据 | 继续实时刷新 | 现有 widget/panel owner |

system 的“固定”不等于不可修改：真实权限或规则变化仍应生效，可能造成一次 cache miss。无需把 journal 行数或记忆摘要刷新也当成 system 契约变化。

## 3. 启动消息的一次性语义

### 3.1 小型共享能力，不建同步服务

预计新增 `extensions/shared/model-context/startup.ts`，仅负责读取当前分支的初始化记录、判断某 owner 是否已提供启动上下文、检查版本/来源和异步操作的会话归属。它不扫描业务文件、不构造 system、不订阅变化、不管理动态状态。

- 使用公开 `ctx.sessionManager.getBranch()`，不使用只存在于进程的 `sent=true` 作为唯一依据。
- 每种 owner 使用独立 customType；消息 `details` 保存小型版本/owner/origin 元数据。消息本身是成功提供快照的记录，不另写一份数据副本。
- 成功以持久化分支中可确认的记录为准。仅生成/返回了消息，不立即当成已经保存；失败可在下一次合适边界重试。
- 对启动时禁用或没有需要提供的数据的情况，允许小型非模型 `custom_entry` 记录已处理，不为标记“一次”制造空的模型通知；不得提前标记尚未确认保存的快照。
- origin 与当前 session/项目绑定比较只用于去重；持久化元数据不是执行授权，仍走 native 来源校验。
- 消息在当前首轮模型调用前通过 `before_agent_start` 的普通 `message` 返回，`display:false`；不回插到历史第一条用户消息之前，不触发额外模型调用。

共享 helper 只有在 Memory/Trellis 确实共用上述语义时抽取。业务错误处理、状态去重及子 Agent prompt 构造仍归原 owner，不做通用 context registry。

### 3.2 生命周期表

| 场景 | 启动数据 | 后续读取/事件 |
| --- | --- | --- |
| 新的空会话 | 首轮提供该 owner 在既有模式/配置下的 B 类内容一次 | A 类按需，C 类变化时尾部更新 |
| 同会话下一轮、自身写记忆、Git/任务数量变化 | 不扫描/不补发快照 | 参数及工具结果已表达操作；数量仅更新 UI |
| 文件恢复、reload、普通子 Agent resume | 当前分支存在记录则不补发 | 工具访问实时数据 |
| fork/树切换 | 在目标分支查记录；继承了快照的分支不重复，分叉在初始化之前的分支可初始化一次 | 不使用另一分支的进程缓存决定 |
| 压缩 | 完整分支中的历史记录仍用于识别初始化，不因快照退出有效窗口而广播全量数据 | 依赖保留的固定按需读取规则；确需材料时 list/read |
| Memory 启动时关闭，之后显式开启 | 记录启动已处理，不自动补发整份索引 | 命令反馈开启；需要目录时明确 list/read |
| 初始扫描/配置失败 | 一次有界诊断，不缓存成成功索引 | 明确访问时尝试当前来源并报告实际结果 |
| 保存失败、取消、切换/关闭 | 不确认未持久化快照，关闭旧 origin 的追加资格 | 不晚到写入新会话；保留可诊断失败 |
| 旧版会话缺少新版初始化记录 | 若历史已有该 owner 的旧式注入，视为已有启动信息，不自动重复广播；从本次起使用新版固定规则 | 不编辑旧会话文件；缺失详情按需读 |
| 真实 system/loadout 变化 | 允许正常契约更新；不属于普通事实变化的前缀保证 | 不冻结错误权限 |

旧会话启用新版后，旧动态 system section 的移除/规则替换可能造成一次 prompt 变化。这里不承诺跨版本零失效，也不通过覆写历史文件伪造稳定前缀。新格式稳定后，普通事实变化才适用前缀断言。

## 4. Project Memory

### 4.1 固定规则与索引拆分

`extensions/memory/prompt.ts` 分离固定规则、启动索引快照和初始化诊断构造；去掉“index below 始终最新”语义，明确首轮索引是发现入口、使用前按需读取。

`extensions/memory.ts`：

1. `session_start` 保留项目身份、store 初始化和 epoch 防护，不扫描全部记忆元数据。
2. `before_agent_start` 注入固定规则；仅当当前分支尚未处理 Memory 启动时，检查开关并生成一次索引/诊断消息。
3. 一次处理后，普通模型轮次不调用 `store.scan/buildIndex`，也不以读开关为理由移除或重建固定规则。
4. 实际工具或命令执行继续读取当前开关与存储；初始身份/store 初始化失败后，在明确访问边界允许受相同路径与 epoch 校验约束的重试，不做背景轮询。
5. 不添加 write/forget 后“索引变化推送”钩子；它们已经有调用参数和结果。

### 4.2 存储与命令保留什么

`store.ts` 的派生 `MEMORY.md` 仍随 write/forget 维护，这是磁盘存储契约，不是模型通知。`list/read` 的实时扫描、revision、原子替换、锁和容量限制保持。

`command.ts` 的面板刷新仍只更新 UI。`/memory on/off/list` 保持现有配置与操作含义，不新增自动更新开关或刷新命令；用户要求最新信息时利用现有 list/read。关闭不删除固定工具声明、不撤回旧上下文，写入/删除仍在真实操作边界被拒绝。

必要改动集中在 `memory.ts`、`memory/prompt.ts` 及 origin 获取/诊断所涉及的 `memory/tools.ts`、`memory/command.ts`；不预设修改安全存储算法。

## 5. Trellis

### 5.1 保留首次内容，只改变承载位置和刷新时机

预计新增 `extensions/trellis/lib/model-context.ts` 承载固定契约与启动消息构造；`index.ts` 仍拥有来源校验、active task 与 UI 状态。

- 首轮把现有 `session-overview` 内容改为普通启动上下文，仅去掉已确认 A 类的主会话 Git 与开发者身份；保留 Journal、任务列表及状态/子任务数量、source/execution roots、context ID、CLI 和协议入口等 B 类内容。
- 首轮把现有 `trellis-workflow` section 内容一并移到普通启动上下文，不只提供路径、不推迟到第一次 Trellis 操作。保留既有 full/compact/headless 条件、平台过滤、excerpt 与字符预算；“完整 section”不等于扩大到源文件全部平台和阶段 blocks。
- 每种模式的首轮内容可合并为一个有记录的 Trellis 启动消息，标签便于区分，但普通消息中的标签不把其变成 system。
- 后续任务数量、Journal 行数、CLI 查询或 workflow 文件变化不自动重建/重发启动消息；明确查询仍可取得最新内容。
- system 仅保留固定执行、来源和角色约束，以及遵守首轮 workflow/项目规则的协议。workflow 已于首轮提供，既有阶段工具查询、材料实际读取和派发角色完整读取义务保持，不新增“所有内容先主动读才可知”的流程。
- 启动信息不授予权限；实际 native authority、任务状态和工作目录仍在运行时校验。

### 5.2 当前任务和阶段提示在尾部更新

保留 `renderState` 中的当前任务身份、status、材料入口、来源/binding/task_error 以及当前阶段 breadcrumb 的 model-facing 内容，不把用户选 C 的阶段提示改为仅按需读取。

去重基线包含实际当前任务与提示内容；若任务、状态、材料/来源、诊断或阶段提示真的变化，则在下一合适边界尾部追加。数量变化、CLI 缓存失效不能强制重发相同内容。恢复/reload 从当前分支最后一个已确认记录恢复基线；metadata 不授予执行权限。

首轮提供 B 类启动消息及 C 类当前状态，后续只更新 C 类。若同一个 `before_agent_start` 只能返回一条消息，用同一普通消息组合首轮材料/状态，details 记录各自已提供的类型；后续状态消息不夹带 B 类快照，也不先标记未确认保存的材料。`agent_end` 和 CLI 的 UI/task 缓存刷新继续保留，模型通知与 UI 刷新分开。

角色启动 authority 解析、managed worktree 绑定、session key、失效来源阻断和 session shutdown 清理保留。协议中的 sourceRoot、executionRoot、requirementsFingerprint 不从模型数据推断。

### 5.3 包源资源一致性

包源指引只改承载位置和一次性语义，不改为“首次不提供 overview/workflow、先自行查询”。`extensions/trellis/skills/trellis-start/SKILL.md`、`resources/templates/workflow.md` 和协议中，若指引对 system 承载或入口存在性有直接假设，只调整相关文字；仍准确描述首轮现有内容与后续需要最新信息时的查询。

资源文本确需修改时，相应 `resources/skill-baseline.json`、`resources/template-baseline.json` 只更新受改资源的 adapted hashes，保留 vendor/source originals。未改文本不制造 hash 改动；若协议 bytes 改变，按实际持有它的清单一起更新。不得手改当前项目 `.pi/skills`、`.trellis/workflow.md`、manifest；个人 Update resources/reload 不属于默认验证授权。

## 6. 子 Agent

### 6.1 prompt 构造输出两部分

`prompts.ts` 的构造边界拆分为规则 system 与普通启动材料，runner 将材料附到首次 task/user 输入附近，不通过 opaque system suffix 注入：

- system：角色 body、append/replace 规则、`<active_agent>`、子 Agent 固定 bridge、workflow 返回契约、worktree 执行限制、Memory 固定只读/写入规则。
- 启动材料：Git/env 快照、Memory 目录/scope 与前 200 行索引内容、显式 `skills:string[]` 预加载内容及结果。
- 配置指定预加载技能仍然可见，不扩大 native discovery；保持 isolated 禁用、missing/unsafe-name 行为与已有读写限制。本文不新增技能配置或统一重做所有预算。
- 子 Agent 配置仍允许提供自定义 system；不擅自分析、翻译或降级用户自己写的角色指令。

`memory.ts` 拆分 per-agent 固定操作规则和内容读取；scope、目录安全、read-only 不创建目录、write-capable 才允许创建的语义保留。首次读取只负责准备本次 child 的启动材料，resume 不再次读取/广播。

### 6.2 父规则继承

预计新增 `src/system-inheritance.ts`，从当前分支结构化 system/启动记录及本 preset 的内容所有者构造父规则与原模式需要继承的启动材料两个视图：

- 使用公开 `getBranch()` 与 `pi-ai` 的 `getCurrentSystemMessage/getCurrentSystemPrompt`，不导入 Pi 内部 assembler、不 regex 删除整个 prompt 标签。
- 本 preset 拥有的旧 overview/workflow 不再作为父 system 规则继承；原 append 模式已继承的 B 类材料改到 child 普通启动上下文，不静默删掉或只留路径。Project Memory 的旧混合 section 分离固定规则与原有索引材料，不能把旧索引重新提升为 system。
- 保留 preamble、项目规则、工具规则和目录、自定义 opaque system/addendum，以及其他不属于本任务 owner 的 sections。未知第三方内容不猜测语义，不承诺清除其中所有动态数据。
- 保持 append 模式共享规则前缀优先、replace 模式不继承父身份；本任务优先保证正确规则边界，不承诺不同 child 与父请求能跨工具 schema 共享相同 provider cache。
- `inherit_context` 的对话历史仍按既有明确配置进入普通任务消息，不扩大历史或工具结果继承。原 append 模式的启动材料继承与 `inherit_context` 分开处理；与 child 本地启动 owner 按来源/类型协调避免双份。执行根目录、身份与来源信息以 child 验证过的来源为准，不以父快照覆盖 child 权限；原本不提供某材料的 replace/isolated/compact 分支不借此扩大注入。

若安装 SDK 不能通过公开契约取得所需结构化来源，作为阻断报告，不退回字符串清洗或修改 SDK；已确认本地 SDK 导出了上述 replay utilities，但仍需完整实际 fixture 验证其时序。

## 7. 前缀断言与错误验证

- 在普通同一会话更新的范围内，下一次模型输入保留旧消息序列；新增工具调用/结果与必要事件位于尾部，旧 system/declarations 不因数量或记忆变化重建。
- 对新固定规则后的同一 loadout，在支持和不支持中途 system 的路径都比较实际序列化后的头部与旧消息前缀，而不仅检查 helper 字符串。
- 扫描次数单独断言：Memory 启动一次；后续无明确读取就零次 scan，外部写文件不能触发消息。
- 取消、真实保存失败、reload、分支及压缩驱动实际 SDK 离线会话。Trellis 逻辑用 fake-pi `.mjs` fixture；跨 provider 的通用输入合同测试放 shared/model-context，而不违反 Trellis 禁止真实 mounted host/TUI 测试的规范。
- role/source 错误必须仍阻断，不为保持旧 system 而删除 diagnostics；实际读取错误不能返回陈旧快照当成成功。

## 8. 已知取舍与交付边界

1. 外部记忆更新不保证立即被知晓，这是已认可的默认行为；按需读取保证访问时新鲜。
2. 不自动补发压缩丢掉的全文，固定规则提供重新发现入口。对模型是否主动读取的质量不作离线 fixture 之外的保证。
3. 旧会话采用新版规则可能一次性失效；历史不重写，普通更新的稳定性从新版规则形成后测量。
4. 首轮已提供的完整 workflow section 与阶段尾部提示保持可用；只改变承载/刷新方式，不以减少首次内容或删批准/检查/提交边界换缓存收益。
5. 预计跨 Memory、Trellis、Agent runner、共享一次性语义、测试、文档和少量资源指引；不是两行 cache delete 的局部修补。实际新增 helper 名称可在相同 owner/合同内调整；范围扩大、公共配置变化或 SDK 私有 seam 需要重新审阅。
6. 只更新 package 源资源与 hashes，不自动安装、部署、刷新个人 Pi 或修改本机历史会话。

## 9. 已确认的 12 项行为

A = 按需读取；B = 首轮普通上下文一次，后续不自动更新；C = 首次提供，变化时在会话尾部追加并去重。

| 编号 | 项目 | 用户选择 | 具体行为 |
| --- | --- | --- | --- |
| 1 | 主会话 Git：分支、是否干净、未提交项数量 | A | 不在 system/首轮自动提供，不自动推送；需要时查询，UI 不受影响 |
| 2 | Journal：文件路径、行数、是否接近上限 | B | 首轮保留完整快照，后续不自动刷新 |
| 3 | 项目任务列表：任务名称、状态、子任务数量 | B | 首轮保留列表快照；新增任务/状态/数量变化不自动刷新列表 |
| 4 | 当前会话任务：身份、状态、材料路径、task_error | C | 变化时尾部追加当前状态，普通查询不重复同一状态 |
| 5 | 当前阶段提示：workflow breadcrumb | C | 随实际阶段/提示内容变化尾部追加，不改为仅按需读取 |
| 6 | 项目执行信息：source/execution roots、context ID、CLI/协议入口 | B | 首轮保留现有入口信息，权限仍由运行时校验 |
| 7 | 开发者身份 | A | 不在首轮/system 自动提供，不自动通知；需要时查询 |
| 8 | Trellis workflow section | B | 首轮普通消息提供原模式下完整 section 内容，保留原过滤/预算；后续文件变化不自动刷新 |
| 9 | Project Memory 元数据索引 | B | 首轮提供有界索引快照，不含正文；后续写入/删除/外部变化不自动广播 |
| 10 | 子 Agent 环境：cwd、platform、Git 分支等 | B | child 自己首轮提供完整现有环境材料，resume 不重发；与主会话 Git 的 A 选择分开 |
| 11 | 子 Agent 配置启用的 per-agent MEMORY.md 内容 | B | child 首轮提供原有前 200 行内容，保持 scope/读写限制，resume 不重读/广播 |
| 12 | 子 Agent 显式预加载技能全文 | B | child 首轮按原配置提供全文，不改为只有路径或主动读；resume 不重新加载 |

以上选择及本文实施范围已由用户批准。其余固定角色、工具 schema、权限、执行目录和身份契约不按此表移走；范围扩大需重新审阅。

