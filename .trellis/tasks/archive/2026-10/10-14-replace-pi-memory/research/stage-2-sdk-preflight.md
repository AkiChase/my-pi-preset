# 阶段2实施前SDK接线核对

本会话只读核对已安装Pi1.2.0。阶段1独立审查运行中，尚未改阶段2产品代码。

## 实际公开合同
- `BeforeAgentStartEvent.systemPromptOptions` 为mutable `NormalizedBuildSystemPromptOptions`；`sections` 是 `Record<string,string>`。
- `ExtensionRunner.emitBeforeAgentStart` 每次先 `normalizeBuildSystemPromptOptions`，逐handler共享本次options，最终返回。直接写/删本次 `sections.project_memory`，不返回整个systemPrompt、不开额外model请求。
- `AgentSession._preparePromptAndToolLoadout` 以结构化sections diff更新transcript；验证不能只找handler字符串，需provider收到的重放后的完整prompt。
- `ProviderConfig.streamSimple` 收到 `TranscriptContext`，通过pi-ai公开 `getCurrentSystemPrompt`/`getCurrentSystemMessage` 从system messages重放当前prompt与section；不是旧 `context.systemPrompt`。
- 现有 `extensions/session-name/__tests__/sdk-runtime.test.ts` 使用真正 `ModelRuntime.create`（refreshOnCreate=false/allowModelNetwork=false）、本地 `registerProvider`、`createAssistantMessageEventStream`、`DefaultResourceLoader` + inline extensionFactories、`createAgentSession`/bindExtensions/真实session.prompt。

## 精确变更范围（阶段1提交后执行）
- `extensions/memory/prompt.ts`：固定英文保存/排除规则，fresh scan→buildIndex，仅metadata；错误仅有限code/安全诊断，无旧cache；正文不注入。
- `extensions/memory.ts`：注册before_agent_start，捕获当前activation/cwd/state并检查epoch；每run重新读取个人enabled，disabled先删除本次自己的section，其他section原样保留；空库仍规则。startup错误保留可诊断状态，shutdown不flush、不timer、不模型调用。
- `extensions/memory/__tests__/prompt.test.ts`：真正SDK独立两run、修改索引后的下一run、空库、resume的新factory、enabled→disabled移除、其他extension section保留、错误诊断/预算/不含正文、调用数严格等于prompt数；shutdown/late callback fence。现有tools.test.ts handler集合更新为真实新增事件。

## 明确不做
不改其他插件/SDK、无旧memory正文迁移、无prompt append拼接/once-only、无session summary/后台Agent、不重做stage1存储。阶段3面板和stage4资源冲突仍各自独立阶段。

## 后续UI公开接线备忘
已读完整docs/extensions.md、docs/tui.md及hello/qna/overlay-qa-tests示例。`ctx.mode==='tui'` 作为custom门；`ctx.hasUI`不足以区分RPC。custom返回typed action后再调用editor/input/select/confirm，不套custom；shutdown主动done关闭并阻止await后重开。Input wrapper传focus/cursor；Markdown使用host theme；ScrollView公开scrollTo/scrollBy/updateLayout，选择hidden scrollbar避免临时timer。精确面板接线实施前仍复读公开类型与实际owner，不照搬例子里不适用的raw overlay hide或全局变量。
