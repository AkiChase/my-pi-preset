# 修正终端宿主的交互与压缩状态

## 目标与授权

让终端宿主准确区分正在执行、等待用户回答和只读浏览；上下文压缩期间不得误报空闲。用户已批准创建任务与规划，随后接受 custom 显式 attention 策略并批准开始修复。S1 preset 分类实施获批；S2 技术归属仍在核对，不授权安装、替换个人集成或推送。分阶段边界见 implement.md。

## 已核实的事实

- `extensions/blocked-signal.ts:188-199` 将所有 `ui_prompt_start` 无条件映射到 sink.block，包括 custom；Herdr 和直接 cmux 的通知都受影响。
- `../pi-trellis/lib/task-browser/command.ts:21-23` 的 Viewer 使用 await ctx.ui.custom 的只读 overlay；不应取消 await 或改动其正常键盘/关闭生命周期。
- Pi 1.2.0 的 `dist/core/extensions/runner.js:360-405` 只在最外层 custom 发出 start/end，kind=custom 且无 title；事件不提供调用者或用途。相互重叠/嵌套的交互不能按独立弹窗成对假设。
- `rpiv:ask-user:prompt` 可识别现有问卷，不能把是否存在有效 header 当作问卷身份，不能让过期事件污染后续浏览面板。
- `~/.pi/agent/extensions/herdr-agent-state.ts:175-258` 只按 agent_start/agent_settled 更新执行状态，并接收 herdr:blocked；没有 compaction/busy 公共事件入口。
- 同文件头明确由 Herdr 管理，更新会覆盖，要求旁挂插件而非直接修改；实际标识为 HERDR_INTEGRATION_VERSION=8，旧 README 的版本 9 不能作为当前证据。
- Pi 1.2.0 `dist/core/agent-session.js:2199-2325` 的手动 compact 先 abort agent，再独立压缩；成功的 session_compact 在清除 manual compact 状态之前发出，不能在成功回调中立即以 ctx.isIdle() 判定最终状态，也不能假定随后总有 agent_settled。
- Pi 扩展公开 session_before_compact/session_compact/session_compact_failed，覆盖 manual/threshold/overflow 与 willRetry；Pi 自身 isIdle 包括 compaction。
- Herdr agent prompt 通过终端粘贴和 Enter 提交输入。浏览面板即使不再报 blocked，仍拥有键盘焦点，不能视为可以安全提交聊天 prompt。

## 需求

- R1：只读浏览不得声称等待回答或触发提问通知；真正问答、确认仍有 blocked 与配对释放。
- R2：保留标准 select/confirm/input/editor 的通知能力；custom 需要明确用途策略，不能依赖标题猜测或无条件全忽略。
- R3：压缩期间显示 working，成功/失败/取消后恢复实际执行状态；自动压缩与重试不得过早报 idle。
- R4：状态桥接不得暂停模型、改写 Viewer 的 await 行为或自动回答用户交互；不得将取消 blocked 等同于允许向焦点面板发送 prompt。
- R5：处理 session_shutdown/reload、事件配对、重复通知以及宿主不可用的降级；保留现有 Herdr/cmux 环境门禁。

## 候选方案与尚待决定的边界

1. 浏览分类：已核实问卷提供稳定的 `rpiv:ask-user:blocked` true/finally false 事件（见 research/custom-attention.md）。建议标准 select/confirm/input/editor 保持现状，custom 不自动视为 attention，问卷由该明确事件接入；聚合两个来源避免重复 block/通知，不再以 prompt 标签证明等待状态。无需修改 Viewer/Pi SDK。代价是未知 custom 问答必须显式接入；此默认策略待用户确认。
2. 压缩状态：正确归属是 Herdr 的 Pi 集成，复用其单一状态发布器，将 compaction 纳入 busy 并处理成功发出时仍 busy 的时序。当前仓库不拥有该集成源码，不能直接编辑已安装生成文件。
3. preset 单独向 Herdr socket 上报 working/idle 会与现有 source=herdr:pi 的 seq/发布缓存竞争；不作为默认方案。若需完全本地自包含，应明确替换为唯一状态发布器，并审批个人集成禁用/安装步骤。
4. Herdr 输入保护与 attention 色彩应分离；现有 blocked 同时承担自动化门禁，完整修复可能需要宿主增加 UI-busy/readiness 信号。这是跨项目工作，不能作为 preset 内小修默许。

待确认技术边界：Herdr 修复的源码归属/部署范围。未知 custom 采用显式 attention 接入而不再默认 blocked 已由用户确认。

## 验收标准（目标，具体范围待确认）

- [ ] AC1：打开 Viewer 或 Task Panel 不出现等待回答标签，也不产生提问 toast；关闭后恢复状态且输入框内容/焦点正常。
- [ ] AC2：ask_user_question、标准确认和输入仍正确标 blocked，关闭/取消/shutdown 后无残留。
- [ ] AC3：manual/threshold/overflow 压缩期间非 idle；成功、失败、取消、自动重试分别恢复正确状态，无永久 working。
- [ ] AC4：重复/重叠 UI、问卷事件失效、reload 和宿主缺失有回归覆盖；模型和后台任务不会因浏览状态标记被暂停。
- [ ] AC5：明确记录 Herdr 在浏览面板期间 prompt 的安全门禁行为，不把颜色修复宣称为自动化就绪性修复。

## 排除与验证计划

当前排除：直接修改 ~/.pi 已安装文件、依赖安装/升级、推送、替换 Herdr 管理资源。产品实施先限于 implement.md S1，S2 待可靠技术归属。

确认方案后安排主会话实施与独立协议/跨模块审查；集中测试 blocked-signal 状态机、压缩事件时序及输入保护，并以真实 Pi/宿主验证作为集成证据。模拟 socket 或 UI 不能替代真实宿主颜色/门禁验收。复杂跨项目方案须补 design.md/implement.md 与分阶段验证/提交检查点，再获得实施批准。
