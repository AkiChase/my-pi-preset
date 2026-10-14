# 实施计划

用户接受 custom 默认不标 blocked、明确 attention 才接入，并批准开始修复。

## S1：preset 交互分类（已批准）

边界：只改 extensions/blocked-signal.ts、extensions/__tests__/blocked-signal.test.ts、README 对应用户摘要与本任务证据。不修改 Viewer、SDK、第三方问卷/Herdr 管理资源，不安装/同步/reload。

主会话直接实现；本阶段局部状态聚合采用主自检，后续宿主协议/跨模块改动需要独立审查。标准 prompt 和问卷 active 独立记账；一个聚合 attention 段只发一对 block/release；custom 生命周期不承担问卷释放。新 activation shutdown 后拒绝迟到事件。cmux 延迟通知回调绑定各自段，不污染下一问卷。

验收：浏览无 sink 调用；标准交互/问卷保留；重叠问卷按公开 true/false 成对计数但聚合通知不重复；RPC 标准交互不双计数；custom end 不清除问卷；shutdown、异常 sink、通知迟到均安全。

验证：临时 PI_CODING_AGENT_DIR + 已安装 SDK；node --test extensions/__tests__/blocked-signal.test.ts 自然退出；pnpm check；实际 diff 自检。验证后主会话立即创建 scoped local commit，保留 README 并行 hunk。

## S2：压缩宿主状态（用户取消）

用户明确无需修复压缩状态。本阶段取消，不修改 Herdr 源码或个人集成，不安装升级、不增加第二 publisher。research/herdr-integration.md 和 research/s2-boundary.md 留作历史调研证据，不属于剩余工作。

## 最终验证与收尾

S1 verified commit d86b38b；相关产品代码没有后续改变，复用 focused22/22 自然退出与 strict/full705/705。用户接受现有交付和未运行真实宿主的限制，授权更新任务、归档和 journal。本任务从未 PR-backed，main/base_branch 自指，archive 使用显式 --skip-branch-validation。保留并行所有更改；不 push/install/sync/reload。
