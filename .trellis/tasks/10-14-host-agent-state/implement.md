# 实施计划

用户接受 custom 默认不标 blocked、明确 attention 才接入，并批准开始修复。

## S1：preset 交互分类（已批准）

边界：只改 extensions/blocked-signal.ts、extensions/__tests__/blocked-signal.test.ts、README 对应用户摘要与本任务证据。不修改 Viewer、SDK、第三方问卷/Herdr 管理资源，不安装/同步/reload。

主会话直接实现；本阶段局部状态聚合采用主自检，后续宿主协议/跨模块改动需要独立审查。标准 prompt 和问卷 active 独立记账；一个聚合 attention 段只发一对 block/release；custom 生命周期不承担问卷释放。新 activation shutdown 后拒绝迟到事件。cmux 延迟通知回调绑定各自段，不污染下一问卷。

验收：浏览无 sink 调用；标准交互/问卷保留；重叠问卷按公开 true/false 成对计数但聚合通知不重复；RPC 标准交互不双计数；custom end 不清除问卷；shutdown、异常 sink、通知迟到均安全。

验证：临时 PI_CODING_AGENT_DIR + 已安装 SDK；node --test extensions/__tests__/blocked-signal.test.ts 自然退出；pnpm check；实际 diff 自检。验证后主会话立即创建 scoped local commit，保留 README 并行 hunk。

## S2：压缩宿主状态（技术归属仍在确认）

只读调研 Herdr bundled v9/public API；不通过第二 socket publisher 抢占状态，不直接编辑 ~/.pi managed 文件。确定可靠落地方式后补设计并核对批准边界；若需替换管理集成/跨仓库源码/安装，先报告并请求对应授权，不把实施 S1 当作 S2 完成。

## 最终验证

按最终范围复核 PRD。真实 Herdr 颜色/prompt 门禁、真实压缩流程若未运行须标 NOT_RUN；浏览输入保护不宣称已修复。不 push/archive/journal。
