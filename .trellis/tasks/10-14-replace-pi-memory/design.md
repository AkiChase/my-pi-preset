# Pi 持久记忆插件设计

> 阶段1 `f635dcc`、阶段2 `d0fada7` 已验收提交。2026-10-15用户要求仅修订规划：memory面板改为只读全屏浏览，参考10-13-task-panel-redesign原生滚动设计；替代尚未提交的可编辑阶段3候选。四工具及存储/prompt合同不变；用户已认可修订交互及常驻滚动条并批准继续实施，按既有阶段检查/本地提交流程执行。

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

## 7. /memory交互：只读全屏列表→独立详情
仅面板只读，memory_write/forget工具继续负责创建/更新/删除。参考10-13-task-panel-redesign的容器/导航/滚动设计，不复用其业务model、共享Task UI或后台timer，不以其交付为硬依赖。

### 容器与原生滚动
- 一次`ctx.ui.custom` interaction内部list/detail切换，不嵌套overlay、不切换Pi宿主模式。`overlay: true`，`overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 }`。
- 使用公开原生Stack/Scroll布局和ScrollView；标题/状态及底栏固定，正文占余下空间。实际终端行列全部填充，空态与小屏不透出底层对话；小屏先压缩次要元数据，保留Esc关闭路径。
- 原生组件选型不变，但Pi1.2.0 overlay不会自动求值原生布局，单纯返回VStack/ScrollView不可用。以`../pi-trellis/.trellis/tasks/10-15-task-viewer-mouse-scroll/`最终方案为技术基准：在隔离native-layout适配器中解析实际宿主pi-tui包并接入内部`dist/layout.js`的`renderLayoutFrame/getScrollViewBox`，校验与公开组件同一包实例及实际有界frame/scrollbar/scroll行为。不写死安装路径、不复制renderer。
- 适配器求值原生组件树并返回frame.lines，原生renderer负责裁剪、滚动条与viewport；面板不render后slice、不手工updateLayout、不保存重复手动offset、不自绘滚动条、不手动分页/PageUp/PageDown。用户已接受内部API升级风险；加载或能力校验失败明确拒绝打开，不静默降级，不修改SDK、不替换宿主layoutRoot。具体共享接入路径为`extensions/shared/scroll-panel/native-layout.ts`（宿主解析/内部layout/frame校验）与`wheel.ts`（公开标准化wheel桥接）；Memory先实践验证，Task Panel后续复用。仅共享布局能力/几何与wheel，不共享业务状态、读取、选择策略或生命周期。
- 列表和详情各有独立原生滚动状态。返回列表、刷新、过滤、条目删除/变化与resize保留或合理clamp。只有键盘选择变化时ensure-visible；render、刷新和普通内容更新不拉回旧选择。
- Fullscreen在overlay根公开`handleMouse`消费已标准化的wheel事件，不解析协议/二次加速。利用native frame的正文rect/clip判定，正文内转交active ScrollView.scrollBy(event.wheelDelta)；标题、底栏及正文上下边界wheel也消费，阻止落入主currentLayout。`overscroll: "contain"`保留，但不能把它当自动接线。Regular使用同一有界frame输出，不强开mouse，保留键盘与滚动条。滚动条常驻（用户已确认，无隐藏timer、位置清楚）；不新增行点击/滚动条点击或拖动处理器。

### 列表页
固定顶部`Memory · <project>`、Enabled/Disabled状态及总数/匹配数；行按TYPE、NAME、DESCRIPTION显示，窄宽度先保护name/type，摘要截断，详情完整显示。
空库`No memories yet`、过滤无匹配`No matching memories`、加载/容量/损坏/权限/丢文件分别明确；失败不当空库。
- ↑↓：移动选择并ensure-visible；Home/End：选择首/末项并ensure-visible。
- Enter：读取所选主题的安全有界详情后切页；不触发模型、不把正文送入对话。
- `/`：本面板内聚焦原生Input，实时匹配name/description，不开宿主input dialog。输入期间字符键归Input；Enter确认，Esc仅结束过滤输入并保留query，随后Esc才关闭列表。focus/CURSOR_MARKER即时同步。
- `c`：非过滤输入状态清除过滤；保留仍存在的selectedName，否则选最近可用项并收敛视口。过滤输入状态`c`只是文本。
- `r`：只重读磁盘元数据/所选详情，不调用store.refresh、不写MEMORY.md；刷新不触发模型。界面可用notice说明变化。
- Esc：关闭列表。保留宿主select cancel匹配；不复制Task Panel的树键、任务操作、概览或detach。

### 详情页
顶部显示name/type/description/updated/path，次要元数据可换行或小屏压缩，中间宿主Markdown正文，底栏固定只读controls。
- ↑↓：原生正文逐行滚动；Home/End：到正文首/末；Fullscreen鼠标滚轮连续滚动。
- Esc或←：返回列表，恢复query/selectedName/原生列表滚动状态。
- `r`：只重新读取当前主题与列表元数据；主题消失回列表并提示，损坏展示错误，不伪装旧正文仍有效。
- 不显示/处理编辑、删除、开关或菜单键，不调用ui.editor/input/select/confirm。正文保留原文，显示副本先清外部控制字符再style。
- 外部超大主题仅安全有界预览，明确truncated/read-only/no complete revision；不读全文件、不生成完整revision。损坏/检测到secret只显示安全诊断；未读范围不宣称已检查。

### 命令与只读边界
`/memory` TUI打开浏览器，非TUI输出status；`/memory list [query]`有界摘要，`/memory help`说明用法。独立`/memory on|off`修改个人enabled配置，面板里不提供开关。仅这两个显式命令可以写配置，PublishedError后重新readEnabled并提示真实disk state/durability；不能把异常当“设置未改变”。
关闭后不新注入、write/forget拒绝，read/list及浏览不受影响。已有上下文不宣称撤销。主题/index修复仍可由工具存储owner或人工处理，但面板刷新不承担磁盘修复。

### 所有权、关闭与证据
command负责读取与操作身份，panel只持有bounded snapshots/原生组件；render/handleInput不I/O/await，无watcher、poll timer、模型或全局raw listener。
读取在component渲染之外完成；迟到结果需核activation/cwd/interaction，不得更新新会话。custom按公开onHandle确认安装后再done，防安装前取消误关其他overlay；done/dispose幂等，不调用SDK owned handle.hide，不改主编辑器。
因不再打开宿主dialog，多行editor不可取消的限制不进入新交互。真实SDK owner验证setup/shutdown/返回/焦点文本；真实PTY分别验Regular键盘/滚动条、Fullscreen滚轮/边界/关闭恢复，模拟不可替代。任意第三方叠overlay组合不作无限保证。

### 技术边界同步（2026-10-15）
用户明确接受隔离内部layout接口风险并批准同步三个任务规划。此前“纯公开overlay原生布局接入”的能力阻塞已通过方案变更解决，不代表新面板已实施或通过验收。邻仓最终保留overlay；普通custom与替换主layoutRoot均不采用。新增native-layout仅集中内部布局接入，其他UI/关闭/鼠标使用公开契约，SDK升级需实际mounted-overlay回归。共享内部模块交付改由新任务`../10-15-builtin-pi-trellis`负责：用户要求将pi-trellis内置本仓，不再分两个维护仓库；迁移规划先收敛，Memory暂缓独立adapter实施，后续作为消费者实践验证。沿用阶段独立审查/主复验/本地提交。Task Panel本轮只更新规划、不启动；不修改个人状态。

## 8. 配置和生命周期
个人 `<agentDir>/memory.json` 首期仅enabled(default true)，固定预算常量，不由仓库项目设置控制目录或身份。无任意目录配置、watcher/timer/background model、费用账本。
session_start按公开事件ctx解析项目，工具/面板捕获origin身份；shutdown同步使activation关闭、结束自己UI、释放引用，不模型总结/索引flush/重新打开。初始化git timeout及异步读取完成后都检查closed；面板不打开宿主dialog。不能影响共享Task UI或主编辑器。

## 9. 安全边界
路径限定私有project目录，真实祖先与文件不跟随symlink，reject null/UNC/遍历；临时/锁/index同样验证，不只检查字符串前缀。常见token/PEM私钥扫描返回rule label不secret；提示禁止凭证，启发式不保证识别全部敏感值。普通read/edit/bash仍有宿主原权限，不声称此插件是全进程沙箱。

## 10. preset与本机清理
pi-preset.json移除pi-memory并加入旧包conflict，确保merge模式也移除。复用Pi1.2资源加载器已有同名工具冲突诊断，以actual loader回归验证；不另建registry、读取私有registry或按load顺序抢占同名工具。宿主冲突提示配合README提供移除旧包/重启的操作说明。pi-claude-memory若外部已启用也应由宿主诊断，不默认删除无关包。README维护overview/第三方/自带/配置/迁移说明，不放个人记忆正文。
先离线通过与独立check，再单独列出本机应用：移除个人npm:pi-memory，加载本仓库新入口需明确路径和作用域；不顺便全量sync/update其他包。
旧包data清理只选memory根下已确认旧MEMORY.md/SCRATCHPAD.md/daily/recovery，拒绝unknown/symlink，不递归删除memory根/projects；qmd现未安装，不假定有索引。执行前重新核实并记录非内容清单。当前旧activation仍可在退出生成记忆，磁盘包配置变化不会卸载当前factory。真实旧数据删除安排在确认不再加载旧扩展的独立维护进程/下一次会话；不试图跨插件移除handler、不偷改npm源码、不reload当前会话。若当前会话尚无法关闭旧activation，先交付代码与卸载配置，删除明确保留为待完成阶段，待重启后核实再执行，不宣称已全部清理。
不动~/.claude/Pi会话/Trellis，不迁移旧记忆、不自动push/reload；主会话按已获授权提交验证通过的阶段。
代码、离线验证、独立审查与经批准的隔离终端验收构成代码交付阶段；本机配置应用和不加载旧插件的新会话中的最终数据清理构成迁移阶段。前者可单独接受，后者尚未完成时AC9保持未完成，任务不得以整个替换已完成而归档。
