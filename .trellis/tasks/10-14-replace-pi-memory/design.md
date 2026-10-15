# Pi 持久记忆插件设计

> 2026-10-14修订并获准按计划实施，阶段1已落地待独立审查。2026-10-15再次批准继续并按阶段本地提交。遵循PRD R1–R5；不恢复上一版后台/会话记忆架构。

## 1. 模块边界
唯一入口 `extensions/memory.ts`；`extensions/memory/` 下放identity/config、store、policy/prompt、tools、panel与测试。无Agent/SubagentWorkflow、独立模型调用、压缩hook、Task UI耦合或主编辑器替换。使用公开Pi1.2 SDK和TUI组件，不复制未经许可Claude内部源码。

## 2. 存储与项目身份
`<agentDir>/memory/projects/<project-id>/`，agentDir遵循宿主公开getAgentDir/PI_CODING_AGENT_DIR。项目ID为Git common-dir真实路径的稳定hash加可读仓库名；非Git按real cwd。Git探测有有限timeout，失败分非Git/错误，不将权限错误默认为新项目；不每轮启动git。
主题格式：固定安全文件名 `<name>.md`，frontmatter name/description/type/created/updated，正文自由Markdown。四类type严格enum；name只接受短ASCII slug，filename为身份，frontmatter不另建可冲突id。反馈/项目记忆提示Why/How to apply，日期不猜。
MEMORY.md派生自安全主题元数据，格式每条一行title/link/description；不是唯一事实来源。手改正文刷新后可见，直接手改索引不会新增事实。无日志/源会话副本/恢复正文备份。

## 3. 本地存储正确性
- 创建必须声明不存在；更新/删除必须带最近读取的expectedRevision（完整原文件SHA256）。同名创建、revision不符返回冲突，不自动last-wins。
- 同项目短跨进程锁覆盖检查+正文修改+索引更新；有限等待，锁含owner token/PID。无法证明死owner不抢锁，不自动删未知锁。
- 正文单文件原子替换、再更新派生索引。索引失败返回“正文已保存，索引需修复”，不假装全失败重写正文；下一次安全刷新可重建。无需事务日志。
- 外部编辑不遵守锁的OS竞态无法完全消除，明确是检测与缩小窗口，不声称跨工具完整事务。
- 名称/元数据/control字符检查，文件0600目录0700，不跟随symlink主题/锁/临时文件；不覆盖未知格式文件。

## 4. 预算
- 启动索引最多200条及25,000 UTF-8字节，完整行裁剪，末尾溢出提示纳入预算。稳定name排序，保证相同库产生相同字节。
- description最多160个Unicode码点，name最多80 ASCII字符；索引条目会因字节预算少于200条，明确显示总数/展示数。
- 单主题完整文件最多16KiB（包含frontmatter）；工具写超限拒绝。外部超大文件不读全量：bounded preview+异常提示，不生成看似完整revision，不允许面板覆盖保存，用户自行修复。
- memory_list默认20、最大50条/8KiB模型输出，offset/limit/query；总计数与nextOffset，空页/裁剪可见。
- 单项目最多处理2,000个顶层目录项，安全元数据读取总预算2MiB。扫描使用有界目录迭代，每主题只读取文件开头最多1KiB的frontmatter（含分隔符），达到完整结束分隔符立即停止，不为索引读取正文；固定生成格式须保证上述name/description/type/时间字段可在1KiB内完整表示。读取预算按实际读取字节计，正文read/详情另受16KiB单文件限制。外部frontmatter超限/损坏明确报告，不把截断元数据当有效条目，不允许以部分扫描重建索引或写入。
- 目录项或元数据总预算超额返回明确容量错误，拒绝部分索引重建/写操作，保留已有文件，status显示需手工清理。容量保护是操作上限，不自动淘汰；须README公开，无静默采样。2MiB不是主题正文总容量上限，不得用全文件扫描意外将库限制为约128个16KiB条目。
- 实际渲染只排版当前页面有限列表/16KiB正文，缓存按width/content revision，不render时I/O。

## 5. 保存与prompt
当前主模型根据稳定规则主动保存，无独立提取器。显式记住立即保存；更新先读revision；忘记单独工具。规则排除代码/Git/AGENTS已记录信息、流水、任务状态与secret；语义排除是模型指导，不宣称规则完全自动证明。
每次before_agent_start通过公开`systemPromptOptions.sections`的唯一`project_memory`段合成规则与当前索引。基于本次options保留其他sections，仅覆盖自己的段；disabled时删除自己的段，不修改整个systemPrompt或私有结构。不能once-only、重复拼接旧段或持有跨run可变options。Pi1.2公开类型已核：sections为Record<string,string>，appendSystemPrompt为string而非数组；本功能不使用append拼接。
空库仍有规则；读/解析错误注入有限诊断，不把旧缓存假装最新。实际SDK请求验证多轮、resume及enabled→disabled的段更新/移除与其他sections保留；关闭不宣称擦除已进入历史的记忆。
按需read正文；list的本地query只匹配name/description，不额外LLM/向量索引。正文返回updated，说明记忆是观察而非实时状态，涉及文件/行为/行动前验证。
无surfaced游标：每个run的索引相同，正文由模型请求；不引入tree/compaction状态体系。

## 6. 工具
memory_read(name)返回元数据、正文、revision；memory_write(name,type,description,body,expectedRevision)创建/条件更新（创建expectedRevision=null）；memory_list(query?,offset?,limit?)有界摘要；memory_forget(name,expectedRevision)明确删除。缺失/空白body写工具拒绝而非删除，类型/字段全量提供，created由store保存。
工具失败正确isError/throw，不只是普通成功文本；部分保存单独明确结果。工具渲染使用公共renderer契约，有限展开，不改其他工具。

## 7. /memory交互：列表→独立详情
通过一次ctx.ui.custom控制单个全宽区域，同组件内部切页，不为详情嵌套overlay。使用宿主theme、Markdown/getMarkdownTheme、SelectList/ScrollView/Input等公开组件。产品英文，原正文不翻译；无emoji、细背景选择，不靠圆点表示选中。

### 列表页
顶部 `Memory · <project>`，右侧Enabled/Disabled；次行总条目数/字节。行包括TYPE、NAME、DESCRIPTION，窄宽度先保护name、type，减少/隐藏description；长标题截断详情完整显示。
空库 `No memories yet` + 保存说明，过滤无匹配 `No matching memories`，加载/容量/损坏/不可读分别显示有限错误，不以空库掩盖失败。
键位：↑↓选择；PageUp/PageDown跨页；Home/End到首末；Enter进入详情；`/`聚焦过滤Input；`r`刷新；`m`菜单；Esc关闭。
过滤即时匹配name/description、不调模型；过滤输入时字符键属于Input，Enter确认、Esc退出输入并保留条件；已确认过滤可在菜单Clear filter。选中项仍存在保留name，否则选最近可用行。

### 详情页
显示name、type、description、updated、实际文件路径及完整受预算限制正文。顶部元数据与底部键位固定，中间宿主Markdown滚动。
↑↓/PageUp/PageDown/Home/End滚动；←或Esc回列表；`e`编辑；`d`删除确认；`r`刷新。返回保留列表query/selected/viewport，重新验证存在性。
编辑采用Pi公开ctx.ui.editor（多行正文）与input/select修改description/type，不自行接管外部终端或主编辑器。此前“调用外部编辑器”设想没有公开安全挂起API支持，因此不作为MVP。操作先结束当前custom并返回typed action，再调用宿主dialog，之后重新打开面板恢复view state；不叠加custom overlay、不在render/handleInput里await。取消不写；提交通过相同revision/schema/预算/secret检查。name不可重命名，避免额外迁移UI。
删除确认包含name与不可撤销提示，取消不改；确认后再次revision检查，冲突提示刷新，成功回列表选择相邻项。无空body隐式删除、无原文恢复备份。
若外部编辑/删除：`r`显式重新读取（无watcher/poll timer）。详情消失→回列表并有限提示，损坏文件展示错误不允许编辑保存，不伪装旧正文仍有效。

### 菜单
列表 `m`使用宿主select：Refresh、Clear filter（有条件时）、Enable/Disable memory、Close。开关为个人memory.json的enabled，影响本插件所有项目；顶部状态准确。切换后重新打开原列表，写设置失败不假装切换。
disabled不新注入，write/forget/面板保存删除拒绝；read/list/浏览仍可。过去已进入上下文的内容不能撤销，off提示这一限制。

### 非TUI
`/memory`默认文字status，支持`/memory list [query]`、`/memory on|off`、`/memory help`，无custom UI。模型四工具所有模式可用，禁用规则一致。

### 焦点与关闭
custom实例归一次interaction，done关闭；不直接hideSDK custom overlay，不安装全局raw listener。编辑/确认间捕获纯view state与项目身份，await后校验activation，shutdown/new/reload后不重开旧面板。Esc各阶段有限层级一致；Ctrl+C按面板取消返回路径处理，不调用process.exit。窗口resize重算viewport并clamp scroll，字符宽度用SDK工具，外部ANSI/控制字符在style之前清理。

## 8. 配置和生命周期
个人 `<agentDir>/memory.json` 首期仅enabled(default true)，固定预算常量，不由仓库项目设置控制目录或身份。无任意目录配置、watcher/timer/background model、费用账本。
session_start按公开事件ctx解析项目，工具/面板捕获origin身份；shutdown同步使activation关闭、结束自己UI、释放引用，不模型总结/索引flush/重新打开。初始化git timeout和dialog await完成后都检查closed。不能影响共享Task UI或主编辑器。

## 9. 安全边界
路径限定私有project目录，真实祖先与文件不跟随symlink，reject null/UNC/遍历；临时/锁/index同样验证，不只检查字符串前缀。常见token/PEM私钥扫描返回rule label不secret；提示禁止凭证，启发式不保证识别全部敏感值。普通read/edit/bash仍有宿主原权限，不声称此插件是全进程沙箱。

## 10. preset与本机清理
pi-preset.json移除pi-memory并加入旧包conflict，确保merge模式也移除。复用Pi1.2资源加载器已有同名工具冲突诊断，以actual loader回归验证；不另建registry、读取私有registry或按load顺序抢占同名工具。宿主冲突提示配合README提供移除旧包/重启的操作说明。pi-claude-memory若外部已启用也应由宿主诊断，不默认删除无关包。README维护overview/第三方/自带/配置/迁移说明，不放个人记忆正文。
先离线通过与独立check，再单独列出本机应用：移除个人npm:pi-memory，加载本仓库新入口需明确路径和作用域；不顺便全量sync/update其他包。
旧包data清理只选memory根下已确认旧MEMORY.md/SCRATCHPAD.md/daily/recovery，拒绝unknown/symlink，不递归删除memory根/projects；qmd现未安装，不假定有索引。执行前重新核实并记录非内容清单。当前旧activation仍可在退出生成记忆，磁盘包配置变化不会卸载当前factory。真实旧数据删除安排在确认不再加载旧扩展的独立维护进程/下一次会话；不试图跨插件移除handler、不偷改npm源码、不reload当前会话。若当前会话尚无法关闭旧activation，先交付代码与卸载配置，删除明确保留为待完成阶段，待重启后核实再执行，不宣称已全部清理。
不动~/.claude/Pi会话/Trellis，不迁移旧记忆、不自动push/reload；主会话按已获授权提交验证通过的阶段。
代码、离线验证、独立审查与经批准的隔离终端验收构成代码交付阶段；本机配置应用和不加载旧插件的新会话中的最终数据清理构成迁移阶段。前者可单独接受，后者尚未完成时AC9保持未完成，任务不得以整个替换已完成而归档。
