# 执行配置回显设计

## 范围与所有权

Agent执行owner生成展示快照，公开返回层投影，renderer仅格式化；启动及agent_manage status/output/wait保持相同字段语义。Monitor owner补启动配置记录，process_manage复用；process已有range/stats恢复显示。bash不改，workflow/nested只保证共用消费者兼容，不重做全屏面板。

## Agent快照

新增与数字stats并列的白名单execution配置字段，具体类型命名在实施时与runtime契约对齐，不直接透传AgentInvocation内部对象。候选投影：

- kind：agent；phase：resolved或session-effective。
- model：可用的provider/model标识；thinking：包括off的真实等级。
- mode：foreground/background；inherit_context、isolated：已知boolean；isolation：off/worktree。
- differences：仅请求实际不同的字段、requested/actual和可证实的reason；不收集全量请求、不回显未生效的resume新建参数。

缺失字段代表未知/不可恢复；不补false或假model，字段不适用则省略。输出纯标量、有限枚举和有限条差异，严格拒绝未知字段/嵌套对象，避免泄露prompt、settings、认证、Agent路径。model别名解析为完整ID不直接算配置覆盖；只有不同实际选择才记录差异。

启动前记录resolver阶段；session建立后更新实际model/thinking与阶段。若在建立前失败，保留resolved，不能装作session-effective。后台首次结果固定当次快照，后续查询可返回更晚确认阶段；一致性指同一投影语义而非不允许阶段变化。resume使用本轮execution ID及沿用session设置，只重新投影适用的执行模式等本轮信息，历史run不混用。

归因由resolver/session owner产生；已知Agent配置覆盖、SDK实际调整或有证据的回退分别描述，未知仅列差异、不编原因。不得修改选择策略或建设全量provenance系统。

## 结果链路与历史回退

启动details、Agent management metadata、TaskView/facade和runtime tools准入统一投影。先核对各自版本与兼容策略：仅新增可选字段且旧结果保持有效；不同协议的process/agent字段不得互串。新字段不塞入numeric-only stats，不通过正文JSON反解析。

旧结果无快照时保留当前正文/状态展示，可用既有合法modelName/tags做兼容显示，但不将tags缺失转换为false，也不伪造阶段或原因。foreign/malformed details沿用安全降级，不渲染未验证对象。snapshot深层数组/子对象复制并冻结，避免历史结果引用record更新后变化。

模型正文增加一条关键配置摘要及必要差异，完整参数表留给UI；未确认时明确待session确认。partial/final与失败路径都有一致投影；不存在record时不制造配置。list保持简洁，不要求全量每行参数表。

## 展示

用户已认可沿用现有beautify风格：tool名称是独立且优先保留的身份字段，标题继续采用tool名称 + 描述，不以任务描述替换tool名称，不新增自定义▶/▼标题体系。保留已有卡片背景、颜色、展开交互及快捷键，只补配置摘要和展开内容。此前无tool名称的示意作废。

折叠：状态 + model/thinking/mode，启动未确认加待确认标识；次要ID沿用现有布局。展开：配置表、差异、已有正文。false/off明确，unknown用未知而非null清单；模型长ID/原因在窄终端按宽度换行。

同一纯格式化函数供启动与管理renderer使用。不得从manager读取、触发结果消费、发通知或停止任务。Agent独立renderer和beautify管理接入保持正常/错误/停止/等待释放分支，避免展开只有正文却丢metadata。

## Monitor

已确认当前启动正文有timeout/no deadline、source与日志路径；wake_absent_ms未回显，details只有runtimeLaunch；source TaskView只有pid/exitCode/durationMs。timeout/wake阈值当前在monitor-session闭包。

新增monitor白名单快照：kind=monitor、mode=background、timeout_ms和wake_absent_ms（显式null分别代表无截止/关闭，不等同未知）、batch_interval_ms。此处null为展示数据语义，不更改工具控制null解析。启动时在job上保存并复制到启动结果与管理结果；不复制command、URL、protocols或凭证。

当前源码核对：monitorNotifications在ordinaryDue/enqueue/批次提交后读取reg.config.monitorFlushMs；BackgroundRegistry.config来自activation构造，生产代码未发现修改该字段。因此S3记录“启动时通知批次配置”，与timeout/wake阈值区分，不宣称精确每条间隔（timely事件可提前）。保留调度器读取逻辑，不为了显示冻结或重构配置。

必须先核对monitorNotifications间隔读取位置：若activation级常量，记录实际采用值；若live可变，明确其为启动时批次配置，并禁止声称后续始终有效，或按真实调度采用点更新查询快照。不为显示重构调度器。Rule删除实时数值插值，改为使用配置值并从结果查看。Monitor无session确认阶段与覆盖差异。

Monitor启动当前无专有beautify分支，实施时通过现有官方renderer注册机制增加最小显示，不能仅返回details后宣称UI已补。不接管bash。事件通知样式不扩展，除非共用契约兼容必需。

## Process管理

消费验证过的range与numeric stats。展开显示实际start/end/size、omitted_before/after与适用统计；折叠保留状态/数量，不塞全部字段。不得把limit当字节实读，不推导默认预算。未知metadata回退与等待/stop保留语义。

## 验证与回滚

见implement.md。关键风险：后台session确认竞态、resume旧identity、foreign metadata白名单、历史对象被改写、错误/partial遗漏、配置泄露与结果二次消费。每阶段独立审查与测试后提交；出现行为回归只撤回本阶段相关新增投影/renderer，不改执行策略或覆盖并行修改。

目前为规划；字段名称/接入点为拟定契约，不代表已实现或已运行测试。
