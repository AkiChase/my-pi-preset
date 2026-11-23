# Trellis 派发与子 Agent 模型选择

## 目标
每次派发可明确选择模型，角色文件的 model 作为默认选择而不是锁定值；Trellis、顶层与嵌套 subagent_run 采用一致的模型优先级。

## 背景与证据
- `extensions/trellis/lib/subagent-rpc.ts:16-35,112-124` 的参数类型、校验与 schema 目前只接受 action、agent、task、prompt；同文件两条 spawn 路径只传 cwd 与 isolation。
- `extensions/shared/tool-arguments.ts:5-19,77-119` 统一采用必填字符串控制字段：default 表示默认，适用分支的 null 与 default 等价；不适用分支只能写 null。
- `extensions/agent-tasks/src/invocation-config.ts:190-191` 当前采用角色 model 优先，顶层与嵌套工具均复用此 resolver。
- `extensions/agent-tasks/src/cross-extension-rpc.ts:118-181` 已支持模型字符串解析、有效性与 scope 校验；`agent-runner.ts:913-916` 和 workflow 已采用显式参数优先。
- `.trellis/tasks/archive/2026-10/10-16-agent-tool-contracts/prd.md:45-49` 曾记录配置优先决策。本次用户重新选择 model 的调用参数优先，其他设置不变。

## 需求与决策
### R1：Trellis model 参数
model 为闭合 schema 中的必填字符串控制字段。dispatch 接受 default、null 或非空模型字符串；default/null 不传模型覆盖值。stop 的 model 必须为 null，default 或真实模型均拒绝。直接调用拒绝缺失、undefined、JSON null、空白、非字符串与 NUL 输入；实际宿主将 JSON null 转成字符串 null 的行为按现有公共契约处理。

### R2：模型优先级
共享目录和托管 worktree 派发、顶层和嵌套 subagent_run 均采用：显式调用 model > 角色 model > 父会话模型。default/null 沿用配置或父会话；具体模型使用已有解析器，保留 provider/modelId 与简称支持。显式模型不存在或 scope 不允许时明确报错，不因角色有合法默认模型而静默回退。

### R3：准确披露与非模型行为保持
显式模型生效后，不再错误提示被角色 model 覆盖。实际模型快照、scope 的 callerSupplied 来源与结果说明一致。thinking、前后台、工具/上下文/隔离等配置优先级及覆盖披露保留。resume 仍不接受模型切换；角色能力、allowlist、目录占用与失败后的 unknown 策略均不变。

### R4：指导与回归
同步模型字段描述、官方工具指导、subagents Skill 的委派说明、相关规范与用户可见说明。工具参数教学只进入 Agent 指导，不复制到用户 docs 或长期 spec。用户 docs 只说明临时模型选择优先于角色默认、其他设置仍按现有政策。

## 排除
不增加 thinking 等 Trellis 参数；不统一其他配置的优先级；不更改 workflow/RPC 已有模型优先级或失败租约策略；不新增配置锁或权限绕过；不安装、不请求线上模型、不更新个人安装/配置、不 reload、不手改部署资源、不 push、不归档。

## 验收标准
- AC1（R1）：实际注册 schema 与直接 admission 覆盖 model 必填、default/null、真实字符串、非法输入和 stop 排斥；非法形状在查询/RPC/写入前拒绝。
- AC2（R1/R2）：共享目录与托管 worktree 的 spawn 都传递显式 model 字符串；default/null 不传 model；原 cwd/isolation 与权威头部不变。
- AC3（R2/R3）：顶层与嵌套、前台与后台测试证明显式模型覆盖角色默认；default 使用角色模型、无角色模型使用父模型；未知/越 scope 的显式模型拒绝，不静默使用角色默认。
- AC4（R3）：结果/记录不再误报 model 被配置覆盖；thinking 与其他配置覆盖、resume 限制、allowlist 与模型 scope 回归保持。
- AC5（R4）：指导与行为一致，定向自然退出测试、strict typecheck、配置的完整 suite 与 diff 检查通过；记录 FAIL/NOT_RUN 和测试层级限制，不将 fake RPC 称真实 provider 验证。

## 授权与状态
用户已批准创建任务、将 subagent_run 的 model 优先级调整纳入范围，并在最终方案审阅后明确说“开工吧”。授权覆盖上述单阶段实施、自审、离线验证及验证后的本地提交。任务已通过 `start --allow-empty-context` 进入 in_progress，两个未使用角色 JSONL 保持空置；没有派发子 Agent，不把空 manifest 称为完整 validate 成功。
