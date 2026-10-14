# 修正终端宿主的交互状态

## 目标与授权

终端宿主区分等待用户回答和只读浏览。用户接受 custom 显式 attention 策略并批准修复；实现提交 d86b38b。随后用户取消压缩修复，并接受现有交互分类交付、授权更新任务与收尾。安装、同步、个人 reload、推送均不在授权范围。

## 背景与证据

- 修复前 `extensions/blocked-signal.ts:188-199` 将所有 prompt 无条件 block，误报 custom 浏览面板。
- `../pi-trellis/lib/task-browser/command.ts:21-23` 使用 await ctx.ui.custom overlay；保留其输入/关闭生命周期。
- Pi 1.2.0 `dist/core/extensions/runner.js:360-405` 的 prompt 事件仅描述最外层交互，custom 无用途信息。
- 问卷公开的 `rpiv:ask-user:blocked` true/finally false 声明等待生命周期；`rpiv:ask-user:prompt` 仅提供标签，不能证明已经挂载问卷。见 research/custom-attention.md。
- Herdr prompt 通过终端粘贴/Enter 提交；浏览期间仍占用键盘，不等于聊天输入就绪。官方协议核对见 research/herdr-integration.md。
- 压缩问题归属于 Herdr 管理的 Pi 集成，用户已取消该修复。原诊断与归属证据留在 research/herdr-integration.md、research/s2-boundary.md，后者是取消前的历史边界记录，不代表待实施阶段。

## 需求与验收

- R1 / AC1：custom 浏览不自动触发 blocked 或提问通知；不修改 Viewer、焦点、await 或执行路径。已完成适配层行为验证；真实终端颜色与焦点未运行，用户接受此验证限度。
- R2 / AC2：标准 select/confirm/input/editor 保留等待提示；问卷使用明确 blocked 事件；未知 custom 问答需显式适配。已完成回归。
- R3 / AC3（取消）：压缩状态不修复，现有 Herdr 行为保留，不增加 busy publisher。
- R4 / AC5：不暂停模型/后台任务，不自动回答，不声称取消浏览 blocked 已解决 Herdr prompt 输入安全。已在 README 明确说明。
- R5 / AC4：聚合重叠等待，释放幂等，shutdown 后隔离迟到事件；宿主异常不阻挡其他 sink，cmux 通知回调不串段，保留环境门禁。已完成回归；真实个人 reload 未运行。

## 实施与验证结果

修改仅 extensions/blocked-signal.ts、extensions/__tests__/blocked-signal.test.ts、README owning hunk 与本任务材料。主直接实现、主自检，不作为独立 review。

- 定向 22/22 PASS，自然退出 0。
- 严格类型检查 PASS，全量 705/705 PASS，job ba18qdr8y exit 0（全量使用配置 force-exit）。
- scoped diff/whitespace PASS；提交 d86b38b。
- 具体命令与限制见 research/s1-verification.md；最终无相关产品代码追加修改，检查结果有效复用。

未运行：真实 Herdr/cmux 颜色、已安装问卷/Viewer 的端到端、真实终端 prompt 门禁。未安装/sync/reload/push。保留所有并行 spec/docs/task/README 修改。

现有开发规范足够，本次不额外新增 spec。任务按用户接受的缩减范围收尾，不将取消的压缩需求标成修复通过。
