# 内置 Subagents Skill 与静态工具契约设计

## 架构

采用三个层次，不动态展开实际配置：

1. tool schema description + 短 promptGuidelines：始终可见的调用与授权契约。
2. 插件内 SKILL.md：Pi 发现后常驻名称/描述/路径，正文仅按需读取；作为分流入口。
3. Skill references：按需求阅读委派指南、workflow API、编排模式与示例。

拟资源结构：

```text
extensions/agent-tasks/skills/subagents/
├── SKILL.md
└── references/
    ├── delegation.md
    ├── workflow-api.md
    └── patterns.md
```

所有产品 Skill/reference 正文使用英文；中文任务预览用于用户确认。文件不是用户 docs，也不是项目长期 spec。现有 .pi/skills 与 Trellis 资源部署保持原样。

## 资源所有权与定位

Agent 插件注册 resources_discover，由安装时真实模块位置解析内置 Skill 的绝对路径，返回 skillPaths。不得硬编码本机 /Users 路径、依赖 cwd、复制 Skill 到用户/项目目录，或使用临时文件生成正文。路径构造优先沿现有资源定位模式，以实际 host loader 验证 import.meta.url 等行为。

事件当前 SDK 类型支持 startup/reload。Skill 路径应交给 Pi 的原生资源加载器，不在 before_agent_start/context 里自行拼接全文。无需向 package.json 的 pi.skills 加独立声明；但仍需验证现有 package 发布/资源枚举包含这些插件内部文件，资源过滤与冲突行为按宿主契约处理。

**已确认策略：** 用户认可内置Skill属于Subagent插件使用手册，不跟普通noSkills/skills:false/string[]/package skills过滤联动。资源注册放在child提前return之前，但只注册发现handler，不创建子manager；扩展未被child loader保留时自然不参与事件，isolated无扩展时不主动注入。无需skillsOverride兼容gate、私有loader字段或过滤父system prompt中的本Skill索引；继续使用公开resources_discover和原生加载语义。提供Skill不改变工具scope/权限，不自动启用nested工具或授权workflow。注册后具体startup/reload与child bind行为仍需测试。

## 内容分层边界

### 常驻工具

- subagent_run：适用的委派边界、完整字段/new/resume、配置优先级、ID、前后台与owned nested限制；长任务描述方法和操作指南转 Skill/reference。顶层与 nested 模式保持差异。
- subagent_workflow：用户显式 opt-in（读取 Skill 不是授权）、写脚本前读取 Skill/API、顶层来源/replay/args、后台执行与管理、纯字面量 meta 基本约束、最小调用例。长 JS hook 参数、pipeline 教程、多种编排模式与重复大例迁出。
- subagent_message / agent_manage：安全消息和结果管理的短契约可保持常驻，不机械删减本就简短的规则；详细协调说明移入 delegation 后不维护重复长源。
- process_manage：不加入 Subagents Skill，继续原独立短规则与静态 limit/verbose相关措辞修正。verbose 属 agent_manage，不混入 Process。
- 字段描述沿用已审阅的配置/null语义：thinking 使用子 session settings/default、inherit_context 为父对话文本加入 prompt、resume 本次模式重解析、配置字段不插入当前后台值。

### SKILL.md 入口

frontmatter 描述普通委派与用户已明确授权的 workflow 使用场景；入口正文说明该 Skill 不授予执行权限，并按两种使用情境指向相对 references。

普通委派读取 delegation；编写/修改 workflow 必须读取 workflow-api，需要复杂设计才读取 patterns。不要默认读完所有 reference；无独立reference之外的全量Skill预载；插件内手册采用用户确认的扩展追加语义，不要求跟普通Skill关闭联动。读取仍须有可用读取工具和实际可读资源；不从缺失或同名错误资源推定已加载。

### References

- delegation.md：自包含 prompt、选择执行模式、new/resume/message/manage 协调、嵌套子 Agent 生命周期；动态可用类型不固化成文件列表，应从当次已暴露工具/schema获取。
- workflow-api.md：脚本源/meta、完整 hooks/options、结构化输出、gate、resume/replay、脚本限制、失败/null含义与验证要求；迁移既有准确 API，按此次措辞修正 model/effort解释。
- patterns.md：pipeline优先与barrier选择、研究/评审/迁移等编排案例、gate重试、对抗验证、循环收敛、规模与完整性提醒；保留准确示例，不借迁移修复其他行为。

可在技术确认后调整三页内章节，但改变工具覆盖或披露层次需记录并交用户确认。模板动态 typeList 从API教程迁出，类型信息保持在当次 tool schema/短规则，避免写死安装时或研究时列表。

## 单一事实来源与审阅

原 workflow/tool-description.ts 改为短规则 owner；迁出的正文仅存在 Skill/reference，不通过另一模板加载后继续塞入 promptGuidelines。规则/API迁移清单覆盖每段原长文，说明保留常驻/迁移目标/必要语义修正。现有 proposed-wording.md、after-preview-zh.md 为拆分前研究，保留历史但明确不作为新完整批准稿。

新研究预览research/skill-preview-zh.md已获得用户大致认可；其中要求内置手册跟普通Skill禁用联动的表述已被后续用户决定替代，实施时改为扩展存在/可读/权限边界。research/builtin-skill-loading.md保留检查时的历史发现，不重写研究证据；其noSkills与父索引阻塞已解除。主会话以本设计与PRD的最新决定为准。

## 预期文件

- agent-tasks/src/tool-guidance.ts、index.ts、nested-tools.ts、invocation-config.ts：短规则、字段说明、移除仅服务说明的backgroundByDefault输入；index/实际插件入口注册资源发现。
- agent-tasks/src/workflow/tool-description.ts：缩为常驻workflow契约；workflow/host.ts、agent-runner.ts仅修正相关误导性注释，不改执行路径。
- agent-tasks/skills/subagents/**：新增固定Skill入口与reference。
- runtime-tasks/tools.ts：process limit/示例、agent verbose简短描述与Rule，parser/renderer不变。
- agent-tasks测试：input-errors、加载相关fixture、拟新增 builtin-skills.test.ts；runtime-tasks prompt.test.ts；必要的manifest资源测试同步内部资源事实而非新增pi.skills。

## 审查与风险

这是新增资源发现与公开指引的跨模块契约，不再仅凭说明自审；主会话可直接实施，需独立trellis-check复核加载/路径、扩展与工具权限、内容覆盖与执行不变。按源role JSONL制度准备实际spec引用，不把产品路径写进只允许spec/research的manifest。

主要风险：子loader没注册或未bind、路径在真实host中不同、Skill名称冲突、内容迁移遗漏、Agent未按需读取。普通Skill关闭仍出现本手册为已接受行为，不再建兼容gate或清理继承父索引。加载/路径/冲突需测试，读取要求不作为硬保证；仍保留安全校验、工具scope与常驻授权底线。启动索引包含路径，不能据此宣称跨安装缓存命中相同。

回退以每个已验证阶段的代码/资源/测试耦合检查点为单位；删除注入和资源时保持必要Rule完整，不留下引用不存在Skill的状态。不改历史、SDK或用户资源。
