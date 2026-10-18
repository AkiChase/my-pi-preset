# 静态参数语义与内置 Subagents Skill

## 目标

保留 required-nullable 参数契约，准确、简短地说明默认语义；将 Subagent 委派指南和 workflow 长教程移到插件持有的内置 Skill，通过 Pi 原生资源发现和按需阅读减少常驻上下文。

## 已确认的方向

用户已确认同时修改各 tool 的 promptGuidelines 与 schema description，并要求中文完整预览。进一步确认：Skill 文件放在插件内，通过 resources_discover 提供给 Pi，不要求复制到用户或项目 Skill 目录，也不依赖 package manifest 的独立 Skill 声明。

## 背景

- `extensions/shared/tool-arguments.ts` 验证完整字段后删除声明的控制 null；false/0 与 workflow args 数据保持原样。
- `extensions/agent-tasks/src/invocation-config.ts` 中顶层调用的 Agent 文件配置优先；workflow/host.ts 的显式 model/effort 优先。thinking 未指定时继续由子 session 设置/default 决定，不直接复制父会话当前 thinking。
- `extensions/agent-tasks/src/workflow/tool-description.ts` 把脚本 API、编排教程和示例全部放在常驻 promptGuidelines，篇幅过大。
- 当前安装 Pi 1.3.0 的 `ResourcesDiscoverEvent` 支持 startup/reload；`ResourcesDiscoverResult.skillPaths` 可由插件返回。实际 Skill 路径由插件安装位置解析，Pi 提供发现后的名称、描述及路径，正文按需读取。
- 先前研究文档 proposed-wording.md 和 after-preview-zh.md 是 Skill 拆分前的措辞提案，只作为既有语义参考，不是新方案的完整实施文案。

## 要求

### R1：保持参数语义与执行行为

保留 required-nullable、字段集合、模式适用性、配置优先级和执行校验。固定默认就近短说明，动态值静态描述配置语义，不注入当前配置。修正 thinking、resume 执行模式、workflow 优先级与 inherit_context 文本继承的误导说明。workflow JS optional API 不迁移 nullable，args:null 保持字面数据。

### R2：插件内置 Skill 与资源发现

新增插件持有的 subagents Skill 和 references，注册 resources_discover 返回基于插件资源位置解析的路径。无需写用户/项目 Skill 目录，不修改 Trellis Skill 部署方式，不新增系统提示拼接器或自动全文注入。Skill 随现有插件资源发布；验证安装位置变化、startup/reload及名称冲突。用户明确认可这份插件使用手册不跟普通 Skill 的 noSkills/skills:false/package skills 过滤联动，采用宿主扩展追加资源的现有语义，不增加过滤兼容层。仍尊重扩展是否加载与isolated的扩展禁用，不主动绕过扩展筛选或工具权限。

### R3：分层披露

各 tool 常驻 schema 与短 Rule 保留授权、合法调用、模式/ID、后台启动/等待/停止/通知等必需契约；详细委派指南、workflow JS API 和编排示例移到 Skill。SKILL.md 保持短入口，按普通委派与 workflow 分流读取 references。编写/修改 workflow 前读 API，复杂编排再读 patterns；不得将长教程整体搬到 Skill 入口而失去第二层按需披露。

加载 Skill 不代表获得多 Agent 编排授权，不能通过自动选择 Skill 将普通请求转化为用户已授权 workflow。无 Skill 时工具仍保留安全调用所需的基础契约；读取要求不是运行时校验的替代。

### R4：文案审阅与单一事实来源

在实施前提供新结构的中文审阅稿：各工具精简后的完整 Rule/参数描述、SKILL.md 完整入口、references 目录及完整拟迁移内容。研究文档由用户授权的研究 Agent 写入；主会话仅维护 planning。实际 Agent 资源使用英文；中文仅用于任务审阅。迁移保持已有 API/限制/示例，无重复维护的长规则源，也不借迁移修复 replay/cache/model fallback 等其他行为。

### R5：验证与边界

真实注册与 Pi Skill 加载链路证明发现、索引、引用解析与按需正文；实际 SDK assembler 证明常驻规则不再含长教程且 peer/hidden/门控保留。准入/生命周期/配置优先级回归不变。检查部署资源、语言和测试隔离；不将字符变化冒充 token/cache 命中效果。结果回显与 renderer 由兄弟任务处理。

## 验收标准

- AC1（R1）：参数 schema 类型、parser、配置解析与执行行为不变；字段说明准确，示例符合准入。
- AC2（R2）：插件内 Skill 在 startup/reload 正常发现，路径随安装位置正确解析；不依赖用户/项目目录部署或独立 manifest Skill 声明。
- AC3（R2/R3）：内置使用手册采用扩展追加语义，不要求跟普通Skill禁用联动；扩展未加载/isolated不主动注入，工具权限不因手册改变。Skill缺失/不可读时不假装已加载，加载Skill不授予workflow授权。
- AC4（R3）：完整常驻 Rule 保留必要调用/授权契约，长 API/教程不进入常驻工具规则或 Skill 入口；references 按需读取。
- AC5（R4）：新的中文文案预览经用户 review 后才能批准实施；迁移覆盖现有内容，无遗漏、语义变化或重复长源。
- AC6（R5）：真实注册、SDK assembler、资源加载/引用、nullable、workflow 与生命周期回归和 typecheck/check 完成；跨模块独立审查及实际 diff 核对完成。未做在线/视觉/cache 测量时明确 NOT_RUN。

## 不在范围内

执行配置回显、UI 渲染、默认策略统一、provider/cache 实现、全量 Skill 管理框架、新查询工具、workflow replay/persistence/model fallback 修复、bash/memory nullable 迁移、用户 docs 或长期 spec 的 Agent 参数教学、个人安装/reload/push/归档、无关并行修改。

## 规划与授权

用户已明确接受任务结果并授权收尾。S1/S2实现、独立审查与验证完成，提交88878a6/2f32141；archive使用非PR任务的--skip-branch-validation，因为工作直接在main完成且branch/base_branch相同，不伪造PR分支。后续普通pnpm版本声明删除为用户另行批准的直接小改，提交508e439，不并入本任务产品范围。

兄弟任务：`.trellis/tasks/10-18-tool-execution-config-visibility/`；建议先完成本任务再做配置回显，避免重叠修改。组织关联不自动调度。
