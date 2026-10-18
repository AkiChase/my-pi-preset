# 改造 Monitor 来源 nullable 契约

## 目标

将 Monitor 模型入口改为完整 required-nullable 契约，避免 provider 将 optional 字段补成必填时引发来源冲突或默认值误解；保持现有观察、通知和资源生命周期行为。

## 已确认事实

- 入口与模型指引均由 `extensions/process-tasks/tools/monitor.ts` 的 `registerMonitorTool` 拥有。顶层固定字段为 command、ws、description、timeout_ms、wake_absent_ms，当前除 description 外均为 optional。
- ws 是封闭固定对象，url 必填，protocols 当前 optional；内部 `WsSpec` 位于 `extensions/process-tasks/monitor-ws.ts:7`，transport 把 protocols 直接传给 WebSocket 构造器（同文件:20）。
- command/ws XOR 使用是否提供而非真值判断。空 command 与有效 ws 同时存在仍必须冲突；只有空 command 时报告空来源。
- 时间字段接受有限正数，包含正小数；null 归一化后保持无 deadline/无 silence wake。
- 共享 `extensions/shared/tool-arguments.ts` 的 parseControlArguments 先拒绝缺失、undefined 和未知键，再浅层删除显式白名单控制 null，不递归清洗。
- `monitor-schema.test.ts` 覆盖真实 host validator、封闭对象及直接入口拒绝；`monitor.test.ts`、`monitor-setup-result.test.ts` 覆盖真实注册入口、WS/命令来源、计时、启动失败和同步 shutdown。实现前继续完整读取最终受影响调用点。

## 范围与约束

- 顶层五字段全部 required，description 仍为非 null 非空字符串；command/ws/timeout_ms/wake_absent_ms 为 nullable controls。
- 先检查完整 wire shape，再按声明字段归一化；在来源启动、任务注册和其他执行副作用前完成参数验证。
- command 与 ws 必须恰好一个非 null；不能清洗空字符串、false、0 或空数组；不得递归清洗 ws 配置。
- 保留内部 optional 接口、WebSocket transport 行为、消息边界、批次 cadence、silence/deadline、wait/stop、通知消费和 session cleanup。
- 指引仅更新 schema、description、promptSnippet/promptGuidelines 与测试、任务材料；不写用户 docs/ 或长期 .trellis/spec/ 的调用教学。
- 不实施 process_manage、Bash/Memory 后续改造；不安装、reload、push、改历史或归档。
- 用户已明确批准按已审阅计划开始实施；批准覆盖范围内检查与 scoped local commit，不覆盖 docs/spec 清理或生命周期操作。

## 关键决策

用户已选择 ws.protocols 一并改为 required `string[] | null`。只在 ws 固定对象边界显式验证并将 protocols:null 归一化为未指定，保留空数组、字符串和协议顺序，内部 WsSpec 不变。该处理是声明字段的局部控制语义，不是递归 null 清洗。没有剩余阻塞决策。

## 初步验收标准

- AC1：顶层 schema 无 optional，required 包含五字段；description 非 null，其他字段 nullable；unknown 字段（即使 null）拒绝。
- AC2：直接调用缺失/undefined/未知字段拒绝；输入不被修改。仅显式声明控制字段 null 归一化。
- AC3：完整 command/WS envelope 可启动；双 null 拒绝、双来源拒绝；空字符串仍按既有字段级语义校验。
- AC4：时间 null 保留默认行为，有限正小数保留；direct parser 拒绝0/负值/NaN/Infinity且零任务/来源副作用。真实host边界需记录SDK转换事实，不宣称能够拒绝SDK已转成null的原始0（详见实施记录）。
- AC5：ws.url/协议数组及封闭对象的 host/direct 校验按最终决策覆盖，保持内部 transport 语义。
- AC6：真实 SDK prompt 含完整例子且没有要求省略控制字段的矛盾；相关注册调用 fixtures 迁移但不弱化生命周期断言。
- AC7：聚焦和自然退出集成、全量 pnpm check、diff 检查与独立审查通过；真实 provider/物理终端未运行则标 NOT_RUN。

## 材料状态

PRD 已完成需求收敛，最终计划已获用户实施批准。实现委派 trellis-implement，以减少注册调用 fixture 迁移的主会话上下文负担；独立 trellis-check 审查，main 验证并提交。两个 role manifest 均已准备。
