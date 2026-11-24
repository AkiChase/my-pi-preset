# 模型选择设计

## 边界与所有权
缺口是 Trellis 缺少 model 参数，以及模型工具 resolver 将角色默认当成覆盖值。只在实际 owner 增加字段与调整模型选择，不从 UI 或 prompt 拦截执行，不重写模型解析器与 scope 策略。

## 数据流
1. Trellis 的 validateDispatchParams 使用共享 parseControls，将 model 标记为 defaultable；dispatch 真实值验证非空字符串且无 NUL，stop 使用 rejectInapplicable 要求 null。
2. 注册 schema 增加必填字符串 model，不用 schema default 或 optional/null union；缺失是可纠正错误，不偷偷补值。
3. 共享目录和托管 worktree RPC 的 options 仅在显式模型存在时加入 model，cwd/isolation 原样。RPC 继续负责模型解析与 scope 校验，runner 继续负责角色默认与父模型回退。
4. subagent_run 的 resolveAgentInvocationConfig 改为 params.model ?? agentConfig.model；modelFromParams 根据 params.model 是否存在决定，即使角色也配置了 model，显式请求仍按 callerSupplied 严格校验。其他字段不改。
5. model 不再加入被角色覆盖的请求集合；同步相关注释和模型指导。真实执行模型与 session 请求快照沿用现有 owner，检查顶层/嵌套结果无错误覆盖说明。

## 预期修改文件
- `extensions/trellis/lib/subagent-rpc.ts`：类型、admission、字段指导、两条 RPC 转发。
- `extensions/trellis/__tests__/dispatch-params.test.mjs`、`dispatch.test.mjs`：参数矩阵、两种目录及默认不转发回归；所有现有严格调用补 model。
- `extensions/agent-tasks/src/invocation-config.ts`：仅模型优先级与模型请求来源。
- `extensions/agent-tasks/src/index.ts`、`nested-tools.ts`、`tool-guidance.ts`：模型字段与全局配置指导准确区分 model 和其他字段；清理仅因旧优先级存在的误导说明/逻辑（如实际证明冗余且局部安全）。
- `extensions/agent-tasks/__tests__/input-errors.test.ts` 及必要的现有契约测试：根/嵌套前后台、默认、显式错误与 scope。
- `extensions/agent-tasks/skills/subagents/references/delegation.md`：同步委派语义。
- `docs/extensions/task-composition.md` 与 `.trellis/spec/development/index.md`：替换过宽的全字段配置优先表述，保持用户说明与开发约束分工。
- 其他 Trellis 测试中的真实 dispatch 调用若受新增必填字段影响，仅补当前参数，不扩大行为。

## 兼容性与风险
- 新必填 model 要求现有模型调用/直接测试调用显式填写 default 或 stop 的 null；拒绝缺失遵循本仓严格字符串控制契约，无旧参数静默映射。
- 角色固定 model 不再阻挡显式请求，用户选择该新行为；权限模型不是角色默认，scope/allowlist 不放宽。
- scope 判定必须同步 modelFromParams，否则有角色默认时显式请求可能错误地走宽松路径。
- provider 解析拒绝继续沿 Trellis 既有失败租约处理，不把此次参数功能扩成失败恢复机制。
- 本地 package 源码与 deployed .pi/.trellis 资源分离；本次不 Update resources、不修改部署清单绕过检查。若发现 package-owned 资源变更需要 provenance 更新，实施前读取该规则，源码与 adapted hashes 同阶段提交；不得重写历史基线。

## 验证与回退
沿用现有 fake-pi Trellis logic fixtures 和 Agent 离线执行 seam，分别验证 wire 合同、选择结果与拒绝，不运行线上模型。主会话核对实际 diff、自审与测试结果。单阶段原子提交所有耦合源码/测试/指导；失败先保留诊断，不使用安装、个人配置或资源部署来修复环境。
