# 内置 Trellis 技术设计（规划草案）

## 状态与原则
仅规划；尚未获得最终方案实施批准。以已确认PRD R1–R7为准，等待邻仓初始化诊断完成审查提交后固定迁入commit；证据留存策略已完成产品8fce55f，迁入时仍核最终pin包含该成果。研究旧动态skills方案已被R7覆盖；新研究project-skill-deployment.md已通读并整合部署闭包/schema3/碰撞/reload等合同，这不是实现或测试验收。

## 1. 目标目录与文件归属
```text
extensions/
  trellis.ts                       # 唯一公开薄入口
  trellis/
    index.ts                       # 插件工厂
    lib/                           # 上下文、初始化、派发、Viewer等实现
    runtime/                       # 将部署到项目的Python源
    resources/                     # 模板、发布清单、来源说明
    agents/                        # 三个项目角色部署源
    skills/                        # 完整项目技能部署源
    licenses/                      # 必须保留的许可原文
    __tests__/                     # 精选MJS/TS测试及helpers
      python/                      # 精选Python安全回归
  shared/scroll-panel/
    native-layout.ts               # 内部layout唯一接入与能力校验
    wheel.ts                       # 标准化wheel消费辅助
    __tests__/
docs/extensions/
  trellis.md                       # 用户主入口
  trellis/                         # 工作流/初始化/协作/维护主题页
```
不保留第二份可安装package.json或安装器；不搬邻仓.git、开发.trellis/.pi、task/journal历史、node_modules、临时证据。不要求原仓库继续存在；必要产品/技能相对引用必须在新目录或已部署项目闭合。测试支撑脚本按有效行为重写为fixture，不搬历史patch/deploy功能来维持旧测试。

## 2. 简单但明确的路径接线
一个小的路径owner集中给出presetRoot、resourceRoot与entryPath；用户项目根继续由当前事件/原source authority协议解析，不新增通用路径框架。
- presetRoot用于Pi包身份及持久配置识别；entryPath为extensions/trellis.ts。
- resourceRoot为extensions/trellis，用于读取runtime/templates/agents/skills和baseline。
- Python初始化/bootstrap与native query按当前owner读取插件runtime；日常项目CLI仍用项目.trellis/scripts，不能用插件runtime替换所有项目脚本。
- 模型运行时所需worktree执行协议是产品材料，迁入后放技能references中并更新overview/skill路径；用户docs只负责讲操作，不能把运行时必须读取的协议随着文档精简删掉。
- 保持现有source/target/cwd/会话与taskstore边界，不用目录迁移顺便合并安全语义不同的validators。

## 3. /trellis-init完整部署
### 资源类别
| 部署源 | 项目目标 | 更新含义 |
| --- | --- | --- |
| runtime/** | .trellis/scripts/** | 执行资源，改动冲突严格拒绝安全替换 |
| agents/trellis-*.md | .pi/agents/** | 角色指令，保留现有定制冲突门 |
| skills/trellis-*/** | .pi/skills/trellis-*/** | 完整技能及配套引用，定制冲突不静默覆盖 |
| resources/templates/** | 已有workflow/spec/config等目标 | 用户模板沿现有preserve/明确Apply边界 |

init计划列出完整有限库存，复用现有检查、锁、原子逐文件发布/manifest最后写与失败保留；这不是全资源事务。skills闭包按发布清单列举，不跟随任意symlink/仓库越界引用。SKILL.md中引用包docs/license/runtime或技能外目录的路径必须改为部署后可达路径，必要references随技能一起部署；不复制任意外部文件作为“闭包”。

部署完成后技能由Pi原生项目发现；删除旧resources_discover技能注入及虚拟package-filter逻辑，避免包技能与项目技能两份同名。根包不静态声明Trellis技能全局加载。遵守project trust、no-skills与宿主collision规则；已有用户级同名skill可能优先/报警，应诊断而非替换用户级配置。

init/adopt/update当前自动ctx.reload需在command owner移除；部署完成仅提示用户主动reload/新会话，不自动操作。Pi1.2项目.pi/skills自动发现基于execution cwd，不沿祖先等同.agents/skills；从项目子目录启动或旧worktree base可能找不到源项目新技能。须提供准确根目录启动/已提交项目资源说明与actual loader回归，不通过动态fallback/自动同步偷偷补齐。项目技能过滤使用宿主项目资源规则，旧package-entry的skills:[]不能继续控制已复制技能，不能宣传过滤配置无差别兼容。坏runtime仍拒绝执行，但已部署project skills可被宿主发现，不假称自动隐藏。

### 初次安装与定制
目标缺失可写入；任一skill root存在未托管文件时默认保留整个root并阻断此次技能部署计划，不将旧内容与默认内容拼成混合skill。使用者先重命名/移出或另行确认替换；明确替换必须备份，不能继承旧adoption无备份覆盖全部files的循环。已托管技能安全更新只换last-published未改文件、修复已记录missing，定制冲突明确报告。无manifest项目沿明确接管计划，未知skills不静默覆盖。普通启动不检查后自动补部署。

## 4. Manifest与旧项目补齐
保留“哪些文件由插件部署、当时hash/mode/版本、是否用户定制”的必要能力；物理resourceRoot变化不改变逻辑runtime/...、agents/...、skills/...名称。

新增skills库存需要一个明确旧项目升级分支，不能继续让旧exact-inventory gate把所有合法旧项目拒绝，也不能accept任意unknown字段/路径：
1. 固定迁入版本的已知旧schema/release与库存，校验其原语义/路径/hash类型；不把源路径当任意读写授权。
2. 检查磁盘已托管文件与原manifest一致性，定制/缺失/不可信项分别报告。
3. 明确计划仅添加新技能及迁入版本认可的资源变化；同名技能冲突不自动认领。
4. 用户确认后锁下复核并发布，更新manifest最后写；不动任务指针、bindings、workspace与无关技能。
5. 未知旧版本保持诊断/拒绝，不能自动“迁移所有版本”。

schema3新增独立`skills`记录，保存固定目标、logical source、last-published hash/mode及库存版本；runtime/agent files与templates原逻辑相对名保留。技能定制/更新不耦合Python runtimeReleaseId，也不把技能磁盘必须等于包版本作为运行时启用条件。新增库存形状按精确schema2→schema3迁移验证；不引入通用迁移框架。邻仓最终diagnostics/provenance reader的schema/kind白名单同步修改，binary assets仅做字节/大小/hash/mode验证，Python/角色/技能文本仍保持UTF-8等文本验证。

支持文件先发布、新目录SKILL.md最后发布以减少半完成发现；manifest仍最后写。逐文件发布不是整个目录原子事务，文档与测试不得声称其他会话绝不看到中间状态。

## 5. 共享布局工具
只抽邻仓已验收native layout能力和wheel辅助，不抽业务面板：
- actual pi-tui入口解析，加载相邻内部layout函数；验证公开ScrollView/VStack同实例，renderLayoutFrame/getScrollViewBox及真实frame、viewport、scrollbar、scroll行为。
- 小的NativeFrame/正文几何接口，返回原生有界lines，标题/正文/底栏树由消费者构造；不复制renderer、不自绘条/手动分页/重复offset。
- wheel辅助只接收公开标准化事件，按native rect/clip转交activeScrollView.scrollBy；所有overlay wheel包括固定区域/边界均消费，防主对话穿透，不解析协议/二次加速/新增clickdrag。
- 不compatible明确拒绝打开，错误文案由消费者包装；不接管宿主layoutRoot，不修改SDK，不引入process-global session/controller。

Trellis Viewer在本迁移内作为首消费者，复用既有交互。Memory在原任务完成只读面板业务；迁移内用最小第二消费者fixture验证共享可复用，不将完整Memory UI重做偷放进本任务。Task Panel只同步引用与依赖，仍独立规划/实施/验收。

## 6. 精选测试与来源
保留/重写初始化定制保护、更新/接管/技能完整部署、task/context/dispatch/worktree关键拒绝与副作用保护、实际SDK发现/唯一入口/host加载、共享layout/鼠标/焦点与清理回归。旧仓结构、独立安装器、历史patch工具、邻仓Git历史专属测试不原样迁入。

重要MJS测试留MJS并显式纳入pnpm test发现，避免为迁移机械全改TS；产品TS纳入strict。Python精选suite由测试runner显式调用准确插件测试路径；fixture从插件产品初始化owner创建，不复制本仓部署文件冒充新runtime。

许可、署名、必要baseline历史字段保留，迁入commit与修改说明可复核；不把当前输出当原始source，不再依赖git show邻仓历史。涉及版权原文保留，不声称所有文件原创MIT。不要求迁入历史82KB原件只为复刻旧测试。

## 7. 文档体系
用户文档简短、只讲用法（用户2026-10-15纠正）：
- trellis.md：是什么、快速开始、常用入口、任务显示。
- trellis/initialization.md：init菜单、写入内容、clone身份、更新/覆盖类操作、Check。
- trellis/tasks.md：任务生命周期、浏览器按键、角色与派发、子任务各一两段。
细节一句带过，不写内部机制和安全边界长文；命令/行为按迁后源码核对。英文spec提炼安全/测试/内部adapter升级合同，docs不放开发测试教程。部署给用户项目的模板与本仓自用spec分别维护。

## 8. 风险与授权
只处理本仓preset清单已声明的独立pi-trellis Git包，将其改为conflicts，复用现有sync。用户明确不考虑其他旧加载来源；不新增npm/local/项目级/-e检测、兼容、配置清理或迁移分支。邻仓由用户删除，任务只保证产品/测试运行不依赖它，不执行删除操作。

不启动新任务实施、安装/sync/reload、push/archive或真实PTY；旧Memory已提交阶段不动，未提交候选保留，后续按各任务scope更新。最终基线pin与已知schema2技能补齐接线待完成，额外旧来源兼容不在范围；规划不是实施PASS。
