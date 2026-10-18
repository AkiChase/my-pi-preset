# 主对话工具呈现设计

## 设计基线

本文替代旧跨查看器/Panel共享框架设计，仅服务PRD六种主对话工具块。Trellis内置实现不是本任务产品修改对象。现有beautify布局、tool-call-heading、execution-config格式化与严格metadata adapter继续各自拥有语义。

## 标题与预算

扩展已有匹配语义的纯布局能力，输入tool名称、业务描述、action、状态统计和次级字段。tool名称始终优先，管理action作为必要字段；长描述缩短，不截断原文。宽屏同行，窄屏必要统计独立行，配置摘要沿现有组件换行。

不预设extensions/shared/task-presentation四模块，不提取未使用API，不把业务状态强制转换成单一圆点。不同卡片保留自身结构。完整描述/命令在展开可读；没有新的敏感数据收集或结果持久化。

## 消费者

- subagent_run：只调整标题/旧状态统计的预算；保持361110b的配置与纯renderer、完整正文、安全身份/邻接字段验证。
- agent_manage/process_manage：合法metadata标题前保留action，ID作为次级；现有配置/range/stat表和original fallback不变。
- monitor：复用现有官方renderer adapter，description优先，started不伪装持续运行查询，不新增活跃状态轮询。
- bash：description非空时标题优先，否则命令；展开须明确显示完整command而不是只剩描述。现有background身份与输出摘要保留。
- subagent_workflow：expanded控制整体摘要与阶段树/日志；共用布局输入真实width，状态/计数/时间来自已有owner。session-entry保留无call标题的身份，不能错误套用“上方已有工具名”。不扩大为独立查看器改造。

## bash工具处理计时

用户接受tool_execution_start到tool_execution_end的处理耗时，包含准备/校验，不宣称纯execute或进程运行时长。公开事件足以提供此口径；参数流尚未发start不计时。activation级显示owner按toolCallId记录单调时间并关联renderer invalidate；最多一个刷新timer，安静调用也刷新，end冻结，重复start不重置，切换/关闭清理。renderer不建timer、不查manager，不改execute返回。

拒绝/截断也可能有start/end，允许短暂计时但状态保持错误。最终SDK durationMs是execute耗时，不能替换start/end处理耗时混淆口径或造成倒退。后台返回后冻结处理时长，background不伪装completed；历史无显示记录沿已有结果耗时回退，不伪造start。

独立bg-hint暂留，删除属于Panel任务；不接管其timer/widget。

## 全局命令

/bg改为/task-detach，不保留别名。唯一注册仍由task-ui controls拥有，coordinator.detachAll行为保持；同步tool说明、panel/hint fallback及用户docs/测试，不更改shortcutBackground键或快捷键，不批量改历史provenance。

## Workflow实际宽度与展开

renderWorkflowCard不再将默认80列布局固化为Text；组件render(width)按最新输入和theme求值，header保护统计且最终每行有界。collapsed只整体摘要；expanded树/日志遵循现有进度归并、cached标记、状态规则和统计口径。不为了展示改变progress/replay调度。

刷新使用已有owner计时/通知接线，渲染不查live manager或发起请求。若现有renderer直接读取workflowTasks，改动限显示输入快照与现有刷新，不新建后台轮询。保持无task/错误/历史结果fallback。

## 兼容与验证

外部文本先安全化再theme styling，host样式reset不被无差别剥离；保留背景/鼠标展开hit region。严格metadata拒绝与请求身份匹配不能因主标题缩短而放宽。展开原正文无截断回退。

真实SDK ToolExecutionComponent覆盖六工具宽窄/partial-final/错误/legacy/主题与鼠标，bash计时另测事件序列/安静执行/清理，Workflow工具+必要entry验证实际resize，不仅测纯layout。

不开Agent仍为用户约束。本任务可先作为纯显示适配由主会话审查；若计时引入高风险跨模块契约需独立审查而现约束禁止，报告并取得审查安排决定，不能把自审冒充独立审查。
