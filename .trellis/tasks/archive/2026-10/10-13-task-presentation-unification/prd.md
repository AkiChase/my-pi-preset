# 主对话工具呈现统一

## 目标

改善主对话中已有的可展开工具块：可读描述不被命令或ID淹没，状态和统计不被长标题挤掉；bash执行中可见耗时，Workflow折叠与展开有明确分层。不新增另一套卡片、面板或独立滚动。

父任务组织关系仍为../10-13-task-panel-redesign，但本轮重新设计以本文为准，不自动继承父任务旧的完整UI范围，也不承诺先为Panel建设未使用的共享API。

## 当前依据

- Trellis由extensions/trellis.ts与extensions/trellis/内置实现拥有；task viewer在extensions/trellis/lib/task-browser/，本任务不依赖独立pi-trellis或邻仓任务。
- 已提交基线e48533d；1f60edb/361110b/445c0bc已完成配置快照及Agent/Monitor/管理工具显示。保留其身份准入、配置阶段、差异、未知值、完整正文和range/stats。
- extensions/beautify/layout.ts与tool-call-heading.ts已有安全文本、列宽和真实tool名称优先的组件，优先复用。
- bash参数description是required string，可为空；description→Job.name链路已存在，beautify/tools/shared.ts标题目前仍取command。
- 当前SDK工具渲染context.durationMs在partial阶段为空，最终才提供调用耗时。独立前台hint已有Job实时耗时，不能误称工具块已有实时计时。
- subagent_workflow在extensions/agent-tasks/src/index.ts的renderResult忽略expanded；workflow-card.ts先按input.width/default80布局再构造Text，实际宽度变化仍需接线。

以上为源码核对，不代表本任务测试PASS；实施前完整读取受影响入口、调用者和测试。

## 已确认要求

### R1 范围和外观

仅主对话的subagent_run、subagent_workflow、agent_manage、monitor、process_manage、bash工具块。保留现有卡片背景、主题、展开快捷键与宿主对话滚动；tool名称是优先保留的身份，描述是次级标题，不以描述替代tool名称。

### R2 紧凑优先与标题

宽屏标题和状态/耗时/统计尽量同行，配置摘要独立；窄屏先省次级字段，再截短描述，必要时状态统计放下一行。极窄时安全降级，不承诺所有字段都同时可见。

执行工具优先非空描述，缺失回退现有名称/类型或命令；管理工具始终保留action，返回后可用合法metadata中的任务描述，ID为次级信息。调用前后身份保持一致，不因标题处理改变原文、参数或返回。

### R3 信息与展开

调用尚未返回时显示已知调用信息及可证实的执行进度，不将请求配置称作实际配置，不把准备阶段伪装为运行。返回后显示真实状态、已有统计与配置摘要。展开保留完整可读描述、适用调用参数/命令、身份、现有配置/差异、range/stats和原正文；不强制所有工具具有全部栏目，不重复附完整委派prompt或复制认证信息。自由workflow args不得为展示新建额外持久副本。

只使用现有统计与执行语义：waiting独立于background，停止等待不等于停止执行；tokens口径/父子累计/lifetime不重新计算。不为所有卡片强加圆点或统一状态枚举。

### R4 bash工具处理实时耗时

用户接受从tool_execution_start开始展示本次工具处理耗时（包含准备/校验，并非纯execute或进程运行时长）。参数流生成期间不计时。安静长调用也刷新；完成、失败、取消或转后台返回后停止刷新，显示冻结的本次处理耗时。拒绝/截断调用若SDK发start/end，允许短暂计时但必须显示实际错误，不暗示进程已运行。保留输出/后台身份信息；后台持续执行时长由process_manage/面板承担。

实时与最终保持同一计时口径：start到end的工具处理时长；SDK durationMs为execute耗时，不能结束后直接替换为不同口径造成计时倒退，可作为已有独立call统计兼容处理。使用单调时钟，公开事件+显示invalidate，不在render创建timer、不轮询后端，不改execute/schema或模型结果。切换/关闭/重载清理，重复事件不重置。

### R5 Workflow分层

折叠仅整体描述、真实状态、完成数/总数和已有耗时。展开显示完整描述、现有阶段树、子任务已有统计与日志，不获取子Agent完整对话或报告。原有paused/skipped/blocked/cached语义保持。按实际render(width)布局，不先固定80列再让Text折行。

主对话内Workflow session-entry如共用组件可做必要兼容，缺少工具调用标题时保留自身身份；不能因此重做/agents查看器或历史结果存储。历史无实时task的数据使用现有安全回退，不凭空补树和统计。

### R6 全局解除等待命令重命名

用户批准将/bg重命名纳入本任务。当前task-ui/controls.ts由composition唯一注册，调用coordinator.detachAll，解除全部当前launch/retrieval等待且不停止执行，不是仅把进程转后台。新命令固定为/task-detach，不保留/bg别名；同步当前工具guidance/schema说明、panel/hint fallback、用户docs和相关注册/混合等待测试。仅改命令与准确提示，不重命名配置键shortcutBackground，不改键位/执行身份/取消与结果消费，也不借此重做Panel或删除hint。历史归档/vendor原文不批量替换。

## 验收标准

- AC1/R1,R2：六种工具块真实tool名称保留，宽窄/中文/ANSI/resize不超宽，已有主题/卡片/展开交互不退化。
- AC2/R2,R3：描述优先且空白回退；管理action不丢，完整命令/参数/身份在适用展开中可读，原请求/结果不变。
- AC3/R3：现有配置阶段/差异/false/off/未知、range/stats及全部原正文保留；foreign/malformed/partial-final安全回退与等待语义通过回归。
- AC4/R4：bash工具处理start至end同口径计时，安静调用也更新，参数流不计时；准备/拒绝不误称进程执行，终态/后台返回冻结，重复调用/取消/切换/shutdown无timer泄漏或跨调用更新。
- AC5/R5：折叠仅整体摘要，展开恢复现有树/统计/日志；真实宽度和resize适用于工具/必要session-entry，历史错误路径仍可读。
- AC6：相关实际宿主组件、计时生命周期及执行回归/类型/全量检查有证据；真实终端/provider未做明确NOT_RUN。
- AC7/R6：新命令注册唯一、提示与文档一致；多类型等待同时解除且执行继续，零等待反馈准确，旧别名按已确认策略处理。

## 排除范围

不改/agents的conversation-viewer/workflow-dialog、Task Panel、底部概览、共享滚动模块、widget接线；不删除/重排独立bg-hint（留后续Panel任务），因此过渡期可能同时看到hint与工具块计时。

不改参数schema或description必填契约、默认执行策略、计费、通知、结果消费、公开metadata协议；不为将来的Panel投影workflow TaskView描述或建设共享圆点框架。若计时必须改变公开返回契约，先报告并重新审阅。

## 授权与状态

用户已批准按本方案在托管worktree实施、验证和阶段本地提交。任务in_progress，session已绑定；不开Agent约束保留，主会话实现与自审（非独立审查）。不授权push/archive或个人reload。实施前需核对计时技术门槛及审查策略，不把自审称为独立审查。保护所有并行Trellis/.pi及其他任务材料，不安装/下载/个人reload/push/archive。
