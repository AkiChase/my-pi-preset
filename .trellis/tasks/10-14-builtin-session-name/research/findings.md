# 命名与请求兼容排查

## 安装源码与事实
- `~/.pi/agent/npm/node_modules/pi-session-name/src/index.ts:68–117`（0.1.7）：第一次input，固定off，3次失败静默停止，无手动命令/自动后续刷新/epoch取消。
- `extensions/status-bar.ts:471–478` 已追加name但整行右截断；当前缺name并非只因窄屏。
- 主会话JSONL 10/13–10/14没有session_info.name，10/12曾有中文自动标题；配置仍启用包。

## 实际请求实验（开发者明确要求只读调查后进行）
2026-10-14 installed Pi1.2公共ModelRuntime，当前mp-responses/gpt-6.1-sol-coding，短用户材料；未修改session或个人配置。
1. reasoning=off、maxTokens=2048：stopReason=error，HTTP400，服务端不支持none，支持low/medium/high/xhigh/max。
2. reasoning=low、同样预算、原命名systemPrompt：stopReason=stop，正文“排查 session name 不显示及生成插件问题”。
3. 省略reasoning选项：onPayload观察仍有 `{reasoning:{effort:"none"}}`，同400。
4. 用公开onPayload只删除reasoning：stopReason=stop，生成短中文标题。
实验最初日志/tmp/pi-bg/bgxdfn5wb.log、bj30acgz0.log、bzhj4nxpr.log为临时诊断，不作为持久task测试或自动化测试；此记录保留方法与结果，不含认证。

## SDK证据
installed `@earendil-works/pi-ai/dist/api/openai-responses.js:177–190,266–283`：streamSimple clamp后off→undefined，payload builder默认none；本机Pi1.1与1.2该逻辑相同，无证据称1.2才引入。
`dist/models.js:679–712`：getSupportedThinkingLevels/clampThinkingLevel依据model.thinkingLevelMap，unsupported可向上/向下选可用等级，非reasoning仅off；不是400后learning/fallback。当前模型metadata未把off/minimal标unsupported。
`pi-coding-agent/dist/core/extensions/types.d.ts:1299–1305`：public pi.getThinkingLevel当前会话等级，setThinkingLevel clamp。
public registry.streamSimple负责认证/provider处理，systemPrompt被normalization转换成transcript系统信息。

其他adapter也可能补关闭thinking：Anthropic streamSimple未指定reasoning→thinkingEnabled:false；Google/Vertex→thinking.enabled:false；Responses/Azure/Codex→none（受metadata影响）；Chat依compat不同；Bedrock未指定一般不添加reasoning配置。不能将“不传选项”等同“不发送字段”。

## 最终用户选择（覆盖早期提案）
采用current ctx.model + pi.getThinkingLevel() + registry.streamSimple，不固定off/low、不默认删除payload、不用provider原生complete模拟跨API。手动/自动共享。不要人为过小maxTokens；prompt引导简单决策，但不能保证thinking token量。

## 上下文与成本决策
否决只读首次prompt、增量/额外命名摘要；采用当前分支有效上下文，保留Pi既有compaction summary，排除工具/thinking/通知。2026-10-14 用户明确同意撤销完整整理后的输入预算门禁：不按长度跳过、不截断、不增加手动超限确认；N默认改为8，可调整或关闭自动更新。先前4K/16K门禁建议均不生效。长会话输入成本无法保证固定，通过调用频率控制，不以隐式截断换取低成本。

## Recap空闲与调用说明补充
现有Recap的5分钟是agent_settled后一次性timer；提交input/agent_start取消，到期只核active/stale/ctx.isIdle，不感知raw typing/焦点/真实离开。到期不满足条件不重新安排，自动失败静默，新input隐藏widget，均可能解释用户未看到内容；明确400错误也影响自动生成，但未做现场复现不得称唯一原因。后续Recap应讨论状态可见性，不自动套入命名任务。

公共streamSimple(...).result()表示通过Pi认证/统一思考选项生成并等待完整结果，不展示流、不追加主对话、不启动工具loop。registry.complete使用API专属选项，不能与统一reasoning选项混用。

## 相关规范
.preset index、repository/extension/sync/testing/documentation均需显式context。SDKdocs extensions/sdk/sessions/compaction/models说明公开接口；实际安装API不能只依旧插件fallback代码。
