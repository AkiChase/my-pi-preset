# 保护动态上下文更新时的缓存前缀

## 为什么要做

用户观察到任务创建、Git 数量和记忆摘要变化后缓存归零。现有机制把启动数据、实时状态和固定规则混在 system 中，普通操作会重新生成 system；即使改为每次变化都追加消息，也会造成重复扫描和不必要的上下文噪声。

本任务采用用户逐项确认的行为：**Git 与开发者身份按需读取；Journal、项目任务列表、项目执行信息、workflow、Memory 索引和子 Agent 启动材料首轮以普通上下文提供一次；当前任务与阶段提示在变化时于会话尾部更新。** 不将所有内容改成按需读取，不以本任务缩减已确认的首轮内容。主 Agent 与子 Agent 一起处理；完整 12 项选择见 `design.md` 第 9 节。

## 做什么

### R1：Trellis 概况与 workflow 改为首轮普通上下文，必要状态尾部更新

- 主会话 Git 信息、开发者身份按需查询，不在首轮自动提供，也不自动推送变化。子 Agent 的环境/Git 启动材料按单独确认的首轮一次处理。
- Journal 路径/行数/上限提示、项目任务列表及状态/子任务数量、项目/执行根目录、CLI 身份与入口首轮提供一次普通快照；后续普通变化不刷新。
- 保留既有模式下 overview 的其余首轮内容和完整 `trellis-workflow` section 内容（原有 excerpt/filter/budget），改为普通启动消息；不将它们删除、缩成入口或推迟到 Agent 主动读取。
- system 保留固定执行/来源等契约；具体 workflow 在首轮已提供，既有阶段查询、项目自定义规则和派发角色实际读取义务不被放宽。
- 当前会话任务、状态/材料路径/task_error，以及当前阶段提示保留变化时的尾部追加；去重，普通 CLI 查询不强制重发相同内容，不重复整个 overview/workflow。

### R2：Project Memory 索引首轮一次，后续不自动更新

- system 仅含固定记忆使用/安全规则；首轮附近提供一次有界索引快照，明确它不是实时目录，不注入正文。
- 后续普通轮次不自动扫描元数据、不监听外部变化、不广播新增/修正/删除的索引。
- Agent 自身写入/删除由调用参数与工具结果表达，不额外发送完整索引。
- `memory_list/read` 读取实时存储；外部变化和错误在明确访问时体现。初始化失败只在初始化时报告，后续访问可明确重试，不以旧快照掩盖失败。
- 保持写入、删除、revision、禁用、并发和路径安全语义；关闭不会撤回已经进入历史的记忆。

### R3：普通更新保留前缀，会话生命周期不制造重复启动

- 数据只通过普通持久化消息追加，不用 `context` 重写消息或 `forceSystemPrompt`。
- “一次”按当前会话分支历史识别，不按扩展 factory 生命周期识别。恢复、reload、普通续跑和压缩不无条件补发启动快照；需要信息时读取。
- 持久化失败不当成初始化成功，取消/切换后不得晚到写入其他会话。
- 真实权限/工具契约变化、模型切换和压缩不是普通事实更新，不以缓存优先绕过它们。

### R4：子 Agent 的规则、启动材料和续跑分开

- 环境/Git 快照、per-agent `MEMORY.md` 前 200 行和显式预加载技能作为普通启动材料，不拼入 system；续跑不自动同步这些材料。
- 父规则继承使用结构化的规则来源，移除本 preset 拥有的数据型自动注入，不机械复制混合父 system；保留用户自定义角色规则与合法的工具/权限契约。
- `prompt_mode`、技能配置、记忆 scope、只读角色、worktree 来源校验和 `<active_agent>` 身份契约不退化。
- `inherit_context` 仍由明确配置决定，不借本任务扩大历史继承、工具权限或技能发现范围。

## 完成标准

| 标准 | 对应要求 | 可观察结果 |
| --- | --- | --- |
| AC1 | R1 | 查询 CLI、创建其他任务或改变 Git/子任务数量，不重建 system，不重复发送项目概况；UI/查询仍反映实时状态 |
| AC2 | R1 | 原有模式下的 overview（仅排除已选按需的 Git/开发者）和完整 workflow section 首轮进入普通上下文，之后不自动刷新；当前任务与阶段提示尾部变化通知去重，来源与项目规则合同保持 |
| AC3 | R2 | 首次索引为普通启动消息，正文不自动注入；后续写入/删除不会触发额外索引广播 |
| AC4 | R2 | 普通轮次不 scan；明确 list/read 得到最新内容或错误；安全、revision、禁用和并发语义不退化 |
| AC5 | R3 | 新会话、恢复、reload、分支、压缩、取消和保存失败行为符合 design 的生命周期表；无跨会话晚到写入或重复快照 |
| AC6 | R3 | 支持/不支持中途 system 的序列化路径均验证普通变化保留既有请求前缀，变化只出现在必要的新消息/工具结果 |
| AC7 | R1–R4 | 中文用户文档说明启动快照、按需读取和必要事件通知；不承诺所有 provider 永远命中缓存 |
| AC8 | R4 | 子 Agent 的环境数据、记忆内容及技能全文不进入自动 system；父规则继承、append/replace、只读、隔离、续跑均保持约定 |

## 不做什么

- 不修改 Pi 安装目录、provider、缓存 TTL/预热、计费显示或第三方包。
- 不全盘缩减工具说明、技能目录、AGENTS.md 或真实工具声明，不将必要授权规则降级为可忽略的数据。
- 不把 B 类首轮内容删除、精简成入口或全部改为按需读取；现有 workflow 模式、截断预算与子 Agent 预加载配置不借机扩大或缩减。
- 不建立通用状态同步/订阅服务，不新增自动更新模式或用户配置开关。
- 不重写历史会话文件、清理历史任务或用户记忆，不手工更新项目生成资源来绕过校验。
- 不承诺老会话切换到新规则时没有一次性 prompt/loadout 变化；不以删除历史冒充前缀优化。

## 证据与能力边界

- `extensions/trellis/index.ts:1142–1153,1280–1289`：缓存 overview/workflow，但 CLI 结果清除 section cache，包括只读查询。
- `extensions/memory.ts:49–60`、`extensions/memory/store.ts:36–44`：每轮重新扫描并替换元数据索引；正文或更新时间单独变化不影响索引文本。`extensions/memory/__tests__/prompt.test.ts:99–116` 当前测试要求同一会话替换 system 索引。
- `extensions/agent-tasks/src/prompts.ts:62–68,91–96,101–127`、`src/agent-runner.ts:710–741`、`src/memory.ts:104–180`：子 Agent 拼入环境、父 system、技能全文及另一套 per-agent Memory。
- `extensions/runtime-tasks/reminder-owner.ts:45–58` 已有固定规则与追加动态消息分离的实现，可复用边界，不改其提醒语义。
- 当前会话真实逻辑 system 共 11 块、54,230 字符，另有 20 个工具声明；overview 1,534、Project Memory 2,113（索引及结尾约 831）、workflow 14,413。创建本任务后已出现 `Git: main` → `Git: main, 1 uncommitted` 及加入任务列表的 overview patch。字符数不是 token 数，不含平台指令。
- 其余 rules/skills/project_context 等主要是规则、目录或能力契约，不等于每轮动态事实。全部 11 个 preset 入口未发现其他主会话滚动事实 system owner；第三方包 hook 不在完整性声明内。
- 安装 Pi 1.5.2 的只读序列化复现：section patch 在不支持中途 system 的路径被合并回头部，追加普通消息则头部不变。未取得用户原始五次事件的线上载荷、兼容配置和缓存证据，不能把缓存完全归零都判为本任务原因。

## 第 5 阶段扩展：项目级 pnpm 12.21.0

用户在前四阶段交付后选择“扩展当前任务”，随后明确“你直接去做吧”，批准此前展示的项目级升级方案：固定 pnpm 12.21.0、兼容配置与锁文件整理、SDK 仍由 Pi 提供、check 只执行检查；不改全局默认版本或 Pi 安装目录。这是新增阶段的实施授权，不追认前一次未授权自动安装。

### R5 与验收

- `package.json` 明确固定 `pnpm@12.21.0`；保持现有 runtime/dev dependencies 的版本范围和 SDK peer 声明，不升级其他依赖。
- 迁移 pnpm 已不读取的 `.npmrc` 非认证设置至 root-only `pnpm-workspace.yaml`，明确 `autoInstallPeers: false` 和 `verifyDepsBeforeRun: false`；不把单仓库改成多 package，也不允许 pnpm 接管 Trellis 技能目录。
- 由实际 pnpm 12 生成/验证锁文件，清除自动安装引入的 SDK peer/transitive 锁项；SDK peer 继续由已安装 Pi 的公开 SDK 链接提供，不下载或修改 Pi SDK。
- 使用已缓存 pnpm 二进制、隔离 HOME/store 和离线模式整理依赖安装状态；不运行未批准依赖 build scripts。离线缓存不足时报告，不自动扩大为其他依赖升级或联网安装。
- 实际 pnpm 配置读取验证版本/设置；在缺少 node_modules 的隔离 fixture 中 `pnpm run` 仍只运行指定脚本、不下载/安装或新建 lock/node_modules；项目 `pnpm check` 前后 lock/hash 与依赖状态不变，类型/全套测试通过。
- 前四阶段范围、A/B/C 选择和已有验证结论不变；不 push、改全局 pnpm/Corepack、部署/reload、归档或清理其他 session。

## 授权与材料状态

前四阶段用户已逐项确认 12 项上下文的 A/B/C 行为，要求一起处理子 Agent，并已明确“可以，开工吧”，批准其 design/implement 中已收敛的实施范围，允许验证和主会话分阶段本地提交，不包括安装、个人部署/reload、push 或归档。第 5 阶段的项目 pnpm 配置、离线安装整理和 lockfile 授权见 R5；仍不允许更改全局版本、Pi 安装或其他依赖范围。

当前任务为 `in_progress`。阶段 1 因独立的 Memory/启动生命周期工作适合委派，已策划 `implement.jsonl`；主会话核对实际结果和阶段验收后提交。后续阶段可主会话直接实施，最终独立审查使用 `check.jsonl`。执行器调整不改变已批准的产品行为和范围。
