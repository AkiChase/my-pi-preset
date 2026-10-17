# 可选参数指导设计

## 单一通用说明

用户最终明确：只在一个位置放一段通用缺省说明，不要求每个自有工具引用，不增加各tool重复正文。

使用官方before_agent_start的systemPromptOptions.promptGuidelines，在一个小型入口中维护固定文本，重复处理仅对自身精确文本去重，保留其他规则。不替换完整system prompt、不修改SDK、不重注册第三方工具。复用已有通用入口还是新建最小入口，在实施前完整读相关入口后按单一责任选择；不得绑到Trellis项目激活状态。

英文草案：

Omit unused optional tool parameters rather than filling them with empty strings or null. Use empty or null values only when the field explicitly supports them or the actual schema requires a nullable value. Preserve intentional valid values such as false and 0.

这是通用调用原则，不是外部工具接口改造。不加入全局重试规则，不扩展到空集合等额外政策。字段模式/默认值仍由原tool负责。

默认SDK assembler生成顺序为tools → rules → docs。说明放在官方promptGuidelines，位于现有rules块内的工具usage条目之后（SDK随后附带两条内置简短规则），紧邻工具规则，不作为额外末尾section。验收检查在<rules>内、<docs>前、全文只出现一次；不修改SDK或重排完整prompt。custom/force prompt可能跳过默认rules，不强行覆盖。禁用扩展的子会话不绕过隔离；自有Agent关键resume字段说明仍直接修正。

## 自有诊断修改

Agent：先验证已提供resume类型/非空，再检查模式字段；非法resume明确新建省略、恢复真实agent_id，合法resume混入新建参数明确原因和修正方式。主/嵌套共用准入，不清洗空/null、不改合法执行。

其余范围内工具仅核查具体模式/空占位拒绝提示；不逐工具添加通用段落，不重构校验。workflow来源、monitor XOR、management动作字段、bash后台策略保持；message无额外可选指导。

## 验证与边界

实际SDK prompt：单次出现、重复事件不累积、其他规则保留、不引用第三方专属内容、custom/forced不覆盖。实际host非nullable optional null删除与raw拒绝区别、nullableJSON/false/0保持。错误payload有可修正原因且零spawn/resume/schedule/source/backend副作用。

生产不导入SDK私有路径，测试可introspection。不运行线上provider/网络/个人reload；不声称指导能彻底杜绝模型填错。无外部工具文档交付；如需新顶层入口，按现有manifest与用户文档约定仅提供最小功能说明。
