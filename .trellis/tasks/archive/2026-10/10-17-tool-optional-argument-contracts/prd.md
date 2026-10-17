# 统一工具可选参数与错误指导

## 目标

减少用空字符串或 null 补齐可选字段造成的无效工具调用；明确缺省语义，并让参数错误直接说明修正方式。

## 授权与范围

用户已审阅单一通用说明与具体诊断修复范围，并明确允许开始实施。主直接实现/自审，每阶段验证后本地提交；不包含安装、reload、push、历史重写或归档。

实施范围：统一模型侧通用说明；本仓库自有 bash、monitor、process_manage、agent_manage、subagent_run、subagent_message、subagent_workflow 的相关字段指导与诊断；自有 memory/Trellis 工具仅核查合法例外与通用指导不冲突，不重做其接口。

排除：不修改外部联网工具、SDK/provider、安装目录或个人配置，不添加外部工具包装、不专门修改联网文档，不静默清洗空串/null，不扩大 nullable，不改权限/默认值/调度/网络/缓存策略，不安装、push、重写历史或自动归档。

## 已确认问题与边界

- Agent 按 resume 字段存在性选择模式；assertFields 先于 resume 非空检查，完整新建参数附 resume:"" 时先报 description 不允许，掩盖根因（extensions/agent-tasks/src/tool-contract.ts:9–16、54–56）。指导未明确新建省略 resume（src/tool-guidance.ts:19–23）；测试只覆盖拒绝而未覆盖完整错误 payload 的修正提示（__tests__/tool-contract.test.ts）。
- 当前 SDK 的 validateToolArguments 在转换前 normalizeOptionalNulls：删除不接受 null 的可选字段，保留声明合法的 null。直接 raw admission 不经此流程，仍严格拒绝 null；不将两者混为一谈。实际探针：resume/flag/index:null 均删除，resume:""、flag:false、index:0 保留，nullable payload:null 保留。
- SDK strict schema 转换会将可选字段转为 required+nullable，但须声明 constrainedSampling；目前自有 Agent/进程/管理工具未声明该配置。只读依据：安装 SDK api/constrained-sampling.js、api/openai-completions.js、api/anthropic-messages.js。不能据此声称本次模型被迫补齐字段，也不宣称覆盖所有第三方 provider。
- 官方 systemPromptOptions.promptGuidelines 支持通用规则；真实 assembler 去重并与 toolGuidelines 合并。采用这个接口，不替换完整 system prompt，不新建 assembler。
- 合法例外包括 memory_write.expectedRevision:null 创建记忆（extensions/memory/tools.ts:45–46）、外部 proxy:"" 强制直连、false、索引0、workflow 的 JSON args。按字段契约判断，不统一清洗。
- 四个联网工具来自 pi-preset.json 的外部 pi-web-access 包，本任务只读参考例外，不作为交付或验收目标。

## 需求

R1. 仅在一个官方通用 promptGuidelines 位置添加简短缺省原则，不要求各工具引用共享条目，不注册或修改外部工具。原则是未用可选字段通常省略，只有字段明确支持或实际 schema 要求时才使用空值；不改变任何工具执行契约。

R2. 各工具的错误提示提供具体修正方向；不新增全局重试规则或自动重试/拦截行为。

R3. Agent 先校验已提供的 resume，再检查模式字段；空/非法 resume 给出新建省略、恢复使用真实ID的修正提示。合法 resume 混入新建字段明确模式原因与允许字段。主/嵌套共享契约保持。

R4. 相关自有工具模式/互斥字段的说明明确“省略不适用字段”，修正已证实会掩盖空占位根因的诊断；不借此全面重构校验。字段语义与例子不改变有效值。

R5. 测试覆盖真实 SDK prompt、host 转换与 direct admission 的差异、非法输入零副作用、主/嵌套一致及合法例外。SDK 私有路径只允许测试 introspection，产品不依赖。

## 验收

- AC1（R1/R2）：默认 SDK prompt 中通用缺省原则仅一次出现，重复事件不累计；不要求各工具引用，不增加第三方专属指导，保留其他规则。自定义/强制 prompt 不被强行覆盖，限制如实记录。
- AC2（R3）：完整新建参数+空/空白/null resume 的 raw 请求明确指向 resume 及修正方式，isError 且零 spawn/resume/schedule；合法新建/恢复保持。
- AC3（R4）：bash/monitor/两套管理/三Agent工具的缺省、模式与例子一致；false/0/合法空串/null/JSON值不被清洗，无有效行为变化。
- AC4（R5）：actual host optional-null 转换探针与注册工具验证、聚焦自然退出检查、类型与相关全套检查有准确结果；不把离线测试称线上模型质量保证。

## 规划结论

用户最终明确选择：在一个位置添加一段通用缺省说明，不逐工具引用。通过官方 systemPromptOptions.promptGuidelines 的单一入口实现，不替换完整prompt；这属于一般调用原则，并不授权修改第三方工具契约。自有工具仅修复具体模式/诊断缺口。主直接实现与自审；不改公开字段/权限/合法语义，若发现必须改变有效行为或 SDK，重新讨论。

具体设计与分阶段验证见 design.md、implement.md。最终方案已获实施批准；角色 manifests 故意为空，不称 task validate 全面成功。
