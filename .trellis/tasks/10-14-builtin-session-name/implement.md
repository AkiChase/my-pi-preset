# 实施计划

2026-10-14 用户批准收敛方案实施，保留不自动commit/push/install/sync/reload/archive。阶段按序实现并检查，不自动建worktree或提交并行基础设施。

## 前置
- [x] 默认N=8、完整有效上下文且无预算门禁。
- [x] 全局持久化配置；失败可见，新增N次有效输入重试。
- [x] SDK public projection/input/settled/name/metadata合同核实，保守计数限制已交用户认可，见research/preimplementation-contracts.md。
- [x] 推荐120秒总截止时间；取消、晚结果及资源所有权明确。
- [x] 主直接实施、独立只读审查；已读preset六规范与两thinking guides。managed worktree因当前uncommitted scaffolding未满足prepare条件，不创建，不擅自提交它。

## 阶段与检查点（用户明确不自动提交）
### S1 请求与上下文（首轮检查通过，不提交）
独立共享helper采用registry.streamSimple/current model/current thinking/sessionId/systemPrompt；120秒deadline/abort，正文校验；projection保留压缩/分支摘要和user/assistant可见正文，排除thinking/tools/custom/shell，不设预算/截断。
检查：`node --test extensions/session-assist/__tests__/*.test.ts`，实际SDK投影、fake provider、长上下文、取消/超时与自然退出。完成后记录不提交检查点。

### S2 命名完整产品切片（实现、25项focused及独立复核通过，不提交）
独立entry、全局配置与public dialogs、session所有权、branch-aware最小metadata、保守输入候选及交付去重、settled合并、手动刷新、失败N轮退避、stale guard及shutdown清理。
检查：`node --test extensions/session-name/__tests__/*.test.ts extensions/session-assist/__tests__/*.test.ts`，并包含实际SDK lifecycle seam，native/name own事件异步、同名外部改名、branch/reload、工具循环、handled/transform输入歧义、queued、abort/error、重复手动请求。

### S3 迁移与整体检查（strict+697/697通过，不提交）
pi-preset.json仅移session-name到conflicts，Recap不动；README依矩阵同步（命令/配置/成本/旧包与native terminal title区别）、来源说明按实际参考保留license；host loader及fake sync/manifest回归。
检查：`node --test scripts/pi-manifest.test.mjs scripts/sync.test.mjs`、实际host加载回归、临时PI_CODING_AGENT_DIR及真实PI_SDK_DIR `pnpm check`；focused自然退出不可force-exit。

### S4 独立检查与交付
独立general-purpose只读审查（不绑定managed执行、不写产品，主负责定向修复），重点计数准确性边界、配置写入、title ownership、模型参数、完整context、取消与metadata-neutral freshness。主核实际diff并复跑受影响focused/full strict，评估spec更新。
`git diff --check`及new/untracked whitespace、本地Markdown links；不能把离线host/fake provider验证说成真实在线命名质量或用户UI接受。真实tmux/在线模型需另获明确授权，不作为默认扩展工作。

## 范围保护
产品限extensions/session-name.ts、嵌套session-name/session-assist、相应tests、manifest、README/来源说明/相关spec及本task材料。不改SDK、Recap、个人配置、.pi/.trellis runtime、其他task。不stage/commit/archive，不push/install/sync/reload。
