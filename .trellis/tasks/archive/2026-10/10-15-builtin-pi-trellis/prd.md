# 将 pi-trellis 内置并统一共享内部模块

## 目标
不再将 my-pi-preset 与 pi-trellis 作为两个独立维护仓库。将 pi-trellis 的产品代码、运行时资源、技能及测试纳入本仓库，以同一包加载；共享内部原生布局与滚轮模块供 Trellis Viewer、Memory 和后续 Task Panel 使用，Pi内部接口更新时集中维护。

## 已确认方向与当前事实
- 用户明确要求单独创建迁移任务，包含共享内部模块步骤。本轮批准任务创建与规划，不批准未审阅迁移方案的产品实施、个人安装/同步/reload或删除邻仓。
- 当前preset packages仍声明`git:github.com/AkiChase/pi-trellis`，本包manifest只发现extensions/*.ts。pi-trellis有独立extensions/trellis.ts、lib/、resources/、runtime/、agents/、skills/、tests/与licenses/，必须核全相对路径/发布资源而非只搬入口。
- pi-trellis许可为MIT与AGPL-3.0-only，迁移保留原许可、来源和vendor/provenance，不将其误标为全部本仓原创。
- 邻仓同时存在工作树材料恢复、指令统一/初始化诊断、Viewer滚动等在进行/规划工作和大量未提交变更。不能将当前dirty目录整份复制当作已验收基线。
- 原生ScrollView不能直接经overlay获得有界布局/自动滚轮路由。已接受隔离内部renderLayoutFrame/getScrollViewBox风险，最终仍保留overlay，以公开handleMouse消费标准化wheelDelta；不改SDK、不替换主layoutRoot、不复制renderer。
- Memory S1 f635dcc/S2 d0fada7保留；旧阶段3可编辑候选未提交/未验收。刚启动的共享adapter/只读面板实现Agent5d1e6816-d75a-4f3已确认安全停止，未修改任何文件、未启动验证进程；现有候选和并行修改原样保留。

## 范围
### R1 产品与资源归属
迁入pi-trellis入口/实现、runtime及初始化模板、角色/技能、必要用户文档与测试；本仓库成为唯一维护源，不长期留第二套独立产品副本。插件实现统一放`extensions/trellis/`，按本仓manifest约定保留薄入口`extensions/trellis.ts`，不让嵌套入口重复加载。lib/runtime/resources/agents/skills/tests按职责安置于插件内部；共享滚动基础模块独立于trellis目录，供其他插件复用。独立插件动态技能发现改为R7初始化部署到项目；物理目录移动仍须核资源/入口/项目执行地址，不新增通用路径框架。

开发用.trellis/.pi及旧workspace/tasks不整仓复制；活动规划的承接关系显式记录。邻仓docs/spec不是产品资源整体搬入：用户已要求按本仓风格筛选、改写并抽取有意义的内容。

### R2 包装与发现
本包只加载一个Trellis入口，确保相对路径与resource hash在迁移后正确；现有宿主SDK peers继续使用，不捆绑另一个SDK。preset移除独立pi-trellis源并声明冲突，merge模式同样防重复。

安装统一使用本仓`install.sh`→`scripts/sync.mjs`及本包资源发现，不迁入邻仓`scripts/install.sh`、独立包安装命令或第二套安装器。`/trellis-init`及其项目runtime/templates发布仍保留：包安装与项目初始化是两件事，不因删除独立安装器而删除必要初始化能力。邻仓patch/deploy辅助脚本逐项判定运行时调用与当前用途，不把scripts目录整份搬入，不靠删文件代替调用审查。

安装来源/旧包卸载属于后续精确授权操作，不自动修改当前个人设置。仅处理本仓清单中已声明的独立pi-trellis Git包；用户明确其他仓库不存在额外旧来源，不设计本地路径/项目级/-e等旧加载检测、兼容或清理，亦不作为规划阻塞项。

### R3 共享内部模块
将原生layout适配、宿主能力校验、frame/正文几何与公开wheel桥接集中成独立共享模块；Trellis Viewer与Memory复用，Task Panel规划指向同一owner。各插件业务选择/过滤/读取/生命周期仍独立，不新建通用业务面板框架。实际宿主包解析、同实例识别、frame/scrollbar/scroll行为验证；不兼容明确拒绝打开，无手动分页/自制条降级。升级维护合同写开发spec，功能说明写docs。

### R4 集成与兼容
保留现有初始化/任务/派发/工作树安全边界，公开Agent/RPC契约不改；资源移动不能改变项目任务指针/现有托管绑定或复活旧activation。精确更新loader、docs、命令、skills内部引用，规避其他任务未提交hunks。Memory面板和Task Panel业务重设计留在原任务，不借迁移扩入全部业务实现。

### R5 验证与检查点
迁移、共享模块/首消费者、资源/文档整合按可验证stage规划，代码/测试/相关资源hash同一检查点。独立审查内部兼容与跨插件边界；实际SDK加载、mounted-overlay Regular/Fullscreen有界frame/鼠标消费/焦点恢复、原模块与全preset回归。真实PTY/物理滚轮另获精确授权，不以模拟当真实视觉验收。

### R6 文档与规范提炼
> 2026-10-15用户纠正（覆盖下方关于“全面详细、主题页不设上限、讲清所有边界”的旧要求）：用户文档要短，只讲怎么用——主要是init怎么用和任务生命周期；其他细节可以一句带过，不写长篇大论，不写内部机制/安全边界说明。当前结构：`docs/extensions/trellis.md`入口 + `trellis/initialization.md` + `trellis/tasks.md`。

- 用户文档进入本仓中文`docs/extensions/`，按插件功能/使用方法/命令/配置/可见限制组织；README只留概览和链接，不保留独立仓库安装教程或另起一套文档导航。
- Trellis用户文档必须面向不了解Trellis的初次使用者，全面解释本仓定制后的实际工作流程，不能只列命令/配置或假定读者了解上游。精简重复不等于删去学习所需细节；允许一个主入口加按主题组织的若干详细子页，不以“少量页面”为硬限制。
- 内容至少覆盖：Trellis解决什么问题及与原版的主要差异；安装与项目初始化的区别；spec/task/PRD/design/implement/角色/工作记录分别是什么；从只读探索到规划、批准实施、分阶段检查/提交、继续与收尾的完整示例；当前任务/会话绑定和父子任务的含义；共享目录与托管worktree选择；派发/停止/未知状态的用户处理；资源更新/定制保留/常见失败与恢复入口。
- 将“自动引导不等于自动授权”“浏览不切换任务”“结束等待不等于停止执行”“任务完成不等于归档”等实际用户可见边界讲清楚，配合典型对话/命令步骤与预期结果；不把开发者内部schema、源码算法或测试教程塞入用户文档。
- 邻仓initialization、viewer、display、dispatch、worktree说明按迁入后实际源码核对后重新组织，而非六份文档机械复制；突出本仓实际工具/技能/命令与工作流，不沿用已过时上游或邻仓操作。
- 有价值的开发/测试/安全约束提炼到本仓英文`.trellis/spec/development/index.md`、testing/index.md及必要既有专题；通用规范去重，只补source/deployment归属、上下文/绑定安全、资源发布/provenance、内部layout升级与实际host回归等可执行合同。
- 不搬邻仓整套spec树、项目journal/task历史、一次性证据或重复维护指南。许可/来源manifest及vendor原文保持必要原文，不为中文文档风格改写法律文本。
- 必须部署给其他项目的workflow/spec模板属于插件产品资源，不等同邻仓自用spec；仍保留初始化功能所需模板，逐项审核内容及引用，不误删或将本仓特有规则自动发布给任意项目。

### R7 初始化完整部署项目技能
用户明确要求`/trellis-init`将完整Trellis资源部署到对应项目，不采用当前从插件目录动态暴露skills的行为。插件内部`extensions/trellis/skills/`是部署源；目标为`.pi/skills/trellis-*/`，包含SKILL.md及引用的references/scripts/assets完整闭包，不仅复制入口文档。runtime/scripts、角色、workflow/规范模板与skills在一次确认初始化计划中列明并发布，普通启动不自动补写资源。

技能通过Pi原生项目技能发现加载，遵守project trust/用户禁用/no-skills和名称冲突规则，移除旧包动态resources_discover技能注入/虚拟package-filter绕接方案；显式初始化完成后须说明当前会话是否需reload才能重新发现，不自动reload。不再以坏runtime自动隐藏磁盘已部署项目技能为保证：原生项目技能发现与Trellis运行时执行门禁分别说明，坏runtime仍拒绝执行。

资源检查/更新纳入技能及其配套文件：初次部署不得静默覆盖同名用户资源；安全更新只替换已确认未修改的托管文件，定制冲突需明确提示/单独确认处理。不清理无关项目技能，不复制用户级技能。已有初始化项目升级需显式计划补齐技能，新库存不能直接触发未知资源清单拒绝，也不能放宽所有未知文件的信任边界。

## 验收标准

测试方针（2026-10-16 用户决定）：不迁入UI/TUI测试和低效或无意义的测试（如真实SDK宿主、mounted overlay、菜单流程、渲染测试）；测试重点是纯函数和逻辑。本仓既有测试也有同样问题，不在本任务范围内清理。下方A3/A4等验收中的“实际mounted overlay/宿主”要求按此改为逻辑层验证。
- A1：本仓维护一份Trellis产品，加载入口唯一；相对资源/模板/角色/技能均正确，旧独立包冲突可诊断/移除。
- A2：初始化/上下文/任务/派发/工作树功能回归通过，无个人配置/数据/任务指针或未知绑定的隐式修改。
- A3：共享内部接入仅一处、同宿主包实例与能力错误门禁有效，Viewer/Memory消费者不复制renderer或视口算法；Task Panel规划使用同一基础模块。
- A4：实际mounted overlay原生有界frame、常驻滚动条、固定区域wheel消费/正文滚动、边界不穿透、关闭恢复通过；业务状态不被共享模块耦合。
- A5：发现/冲突/文档/许可/资源hash及相关测试同步，未提交/并行工作完整保留；独立审查和准确的NOT_RUN边界记录。
- A6：可执行迁移与回滚清单清晰，无整仓reset/未知文件删除/邻仓自动删除/安装reload。
- A8/R7：确认init后项目`.pi/skills/`具备完整Trellis技能及相对引用闭包，原生Pi项目技能发现可用且不重复从插件加载；同名/定制技能不静默覆盖，安全更新与旧项目补齐有明确计划，trust/禁用/reload要求准确，无普通启动自动部署。
- A7/R6：新用户读入口页+初始化+任务生命周期三页即可上手init和完成一次任务流程；文档简短、面向使用，命令和预期行为经最终源码核对。

## 范围外
不修改Pi本体、不复制SDK renderer、不删除邻仓/.git或个人数据、不迁移整个旧任务历史/开发基础设施、不自动安装/sync/reload/push/archive，不改任务执行/计费合同，不顺便完成所有Memory/Task Panel业务重设计。

## 已核实的迁移工程门
研究见research/migration-risk-analysis.md；这是只读结论，不是迁移验收。
- 明确四种根：preset包根、Trellis资源根、顶层薄入口、用户项目执行根。持久adapter检测、模型读取协议、Python source/deployment路径分别接线，不能统一替换packageRoot。
- 技能加载按新R7改为init完整部署到项目.pi/skills，原生发现；不再保留旧动态候选集接线。须验证部署闭包、同名冲突/定制更新、trust/no-skills与当前会话重新发现方式。
- 物理资源根迁入extensions/trellis，逻辑资源相对名runtime/...、agents/...、resources/templates/...可保持不变。项目manifest保留必要归属/hash/版本与定制保护，但严格source字段与库存版本策略需结合新增skills重新设计；显式旧项目升级/补齐计划，不手改部署manifest或全面放宽未知资源校验。
- 迁移后运行与测试不得依赖邻仓或其Git对象，用户将删除邻仓。按实际安全/兼容价值筛选重写重要测试，不为复刻旧provenance测试强制迁入历史Git原件/全仓历史；保留必要许可/署名/来源说明，不以当前输出冒充历史原件或伪称未执行校验通过。
- 邻仓MJS及Python测试必须显式接入本仓globs/cwd/隔离/natural-exit；改TS需真正strict校验，不能静默漏跑或用full force-exit证明清理。
- 共享仅为小的布局工具代码：实际宿主内部layout接入/能力校验/frame几何与wheel辅助，无全局控制器/业务面板框架；各插件业务状态/生命周期独立。实际jiti/module identity、快速输入/resize与wheel消费保留重要回归。
- Trellis继续只用composition公开RPC，角色通过确认初始化发布到项目，不因builtin而startup自动部署/重注册第二套工具。
- runtime消费者需要的worktree协议文档、skill内部references和必要原文不能随用户docs提炼误删。用户教程按最终pin后的实际流程核验，尤其创建planning绑定与start、生命周期自动commit配置、source-only worktree和新版Check。

## 迁入基线与规划待办
- 用户已确认：等待邻仓当前成果各自审查并提交后，再按明确commit迁入；证据留存策略也列为迁入前置，完成其角色/技能/模板及hash调整后一起迁入。不接管未提交dirty成果，不停止/替代邻仓其他任务；迁入前重新核工作区和所选commit实际范围。
- 完整迁移清单、目标目录/资源定位与测试接线由源码只读调查后形成design.md/implement.md，当前不宣称规划已经收敛或实施就绪。

## 授权与状态
2026-10-16 用户全权授权：“接下来我们可以开始进行 trellis 的迁移了，我就不一个一个授权了，全交由你来一步一步完成吧。”覆盖S1–S4实施、独立审查、阶段本地提交及验收后收尾。仍不push、不改历史、不安装依赖、不改个人配置/sync/reload、不删邻仓；本仓自身`.trellis/`部署副本不在本任务内重新init/update。

迁移基线：邻仓 `d0e07c94c8f586fdf6e6c98a3127133293faeb90`（在 `24e3cef` 之上修复旧manifest项目初始化菜单只剩Check/Help/Cancel，并统一菜单文案；2026-10-16用户要求重新同步）。工作区干净；init-check-diagnostics、evidence-retention-policy、active-task-binding均已归档）。该基线已删除 `trellis-continue`（恢复逻辑并入 `trellis-start`），新增 `task.py active`；技能为9个。

2026-10-15用户批准提前编写迁入后文档（D0限定实施），无需等init check最终完成；只写用户文档并检查，不授权产品迁移/部署/安装/reload。D0可先执行，S1–S3仍待最终方案批准和pin；用户docs草稿清晰标记未上线迁入目标与待最终源码核对部分。

任务已于2026-10-15通过task.py start进入in_progress，仅执行D0用户文档阶段；本会话pointer为pi-9c05b522eba8，main无托管worktree绑定。S1–S3产品迁移仍未授权；状态变化不扩大范围。用户此前Memory阶段提交授权不自动转为新迁移产品实施授权。Task Panel仍planning，Memory等待共享模块归属/迁移顺序收敛。
