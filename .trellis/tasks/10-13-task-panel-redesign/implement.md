# 实施计划

## 当前状态与门禁
- [x] 已核对当前源代码、共享滚动模块、Widget Display 及先行子任务最终验收；不将先行工具展示交付误认为 Panel helpers 已交付。
- [x] 用户确认列表/详情滚动条常驻；概览最多五个根任务，小终端缩减并提示隐藏数量。
- [x] 父任务收拢为唯一计划，children 已清空；原 Panel 子任务解除关联并迁至 merged/10-13-task-panel-overview 保留追溯，退出根级待办；已归档 presentation 只保留文档引用，不修改历史归档。
- [x] 最终方案呈交并获明确实施批准：用户认可三个阶段实施、检查及本地阶段提交；不自动安装/同步/reload/push/归档或运行真实终端/provider。
- [x] 执行前 Git 复核：产品文件干净，已有 Panel 规划/合并材料和两个独立规划任务保持；lockfile 镜像任务已归档至 HEAD 110d540。本机 Node v24.14.1，node_modules 存在；测试另行隔离并核实 SDK。
- [ ] 刷新 selected role JSONL：主会话直接实施不需要 implement manifest；跨模块高风险阶段选择独立 check，派发前完整准备其实际上下文。不把旧 research 观察当完整注入。
- [ ] 真实终端/provider 操作若未获批准，保留 NOT_RUN；不能用 fixture 替代物理滚轮与安装宿主验收。

## 执行安排
建议主会话直接实施，独立 check 审查跨模块投影、overlay/lifecycle 与 widget 集成。各阶段验证、检查实际 diff 后立即由主会话 scoped commit（实施批准包含阶段本地提交）；不累计到最终一次提交。Agent 不提交。后续若需要托管 worktree，按协议 preview/批准 prepare，不自动创建或临时隔离。

### 阶段 1：展示与真实树模型（AC4–5）
- kind-aware 可读标题、状态圆点、duration/tokens、安全宽度与连续 selected 背景。
- 核对 Agent/Workflow description 投影，补 workflow description，处理 shell 空白回退；不重做已存在的 bash name 传递。
- model 树线/后代数量、折叠选择 reconciliation、orphan/cycle/retention/final pin。
- 保留 TaskSource/公开身份与 token accounting，主核 diff 和跨模块独立审查后阶段提交。

定向自然退出：task-ui suite、受影响 agent source/process source 测试；直接查找现有文件补充精确路径，不能假设未创建测试名。

### 阶段 2：全屏列表/详情与原生滚动（AC1–3）
- owner 预加载共享 native layout，overlay 安装 onHandle 与 shutdown 重入 fence。
- 单一 list/detail interaction，Agents/Processes 上下分区；两处独立常驻 ScrollView、VStack、固定 header/footer、满终端背景。
- 复用 wheel bridge，正文/边界 containment；不强开 Regular mouse，不复制 Task viewer section/Ctrl+C。
- Enter/Esc、树、Home/End/jk、x/c/global detach，移除旧双栏/Tab/PageUp/PageDown/manual slice/updateLayout。
- 渲染无 detail I/O；元数据/唯一 bounded selected preview 缓存、定时刷新不拉回、返回/resize/变化位置收敛。
- 独立审查实际 owner/model/panel；定向自然退出与 TypeScript 后阶段提交。

```sh
node --test --test-concurrency=2 extensions/task-ui/__tests__/*.test.ts extensions/shared/scroll-panel/__tests__/*.test.ts
```

### 阶段 3：只读概览、hint 移除与集成（AC6–8）
- Widget Display 声明 Agent overview 槽位及 client；root metadata、最多五项、小屏预算/hidden count、expiry/空态/主题/reset/shutdown。
- 删除 Process hint renderer/专有字段/接线和 foreground_hint 槽位；保持 quick-completion/partial 及 source timer 行为。
- 底栏/Panel 真实 waiting 与全局配置入口，回退 /task-detach。
- 更新 docs/extensions/task-composition.md、Widget Display 文档/相关 spec 与真实 provenance，用户 docs 不加入 Agent 工具调用教学。
- 独立审查 lifecycle/执行不变性、最终 AC/当前 diff；验证后阶段提交。

```sh
node --test --test-concurrency=2 extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts
node --test --test-concurrency=2 extensions/shared/widget-display/__tests__/*.test.ts extensions/__tests__/widget-*.test.ts scripts/pi-manifest.test.mjs
node --test --test-concurrency=2 extensions/agent-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts
pnpm check
git diff --check
```

## 验证环境与证据
命令仅是计划，当前未执行产品测试。依 .trellis/spec/testing/index.md 使用已有 SDK/依赖，整个测试调用隔离 PI_CODING_AGENT_DIR，必要 HOME；COREPACK_ENABLE_NETWORK=0，不访问个人配置、不安装或获取依赖。原始输出放 owned 仓库外临时目录，最终在本文记录命令、环境、exit code、失败原因/重跑与 NOT_RUN，不存 raw 到 research/evidence。

pnpm check 全量使用 force-exit，不能证明自然生命周期；受影响 focused suite 必须无 force-exit。执行前核实 SDK link helper 与当前脚本，不照旧命令假称通过。

实际宿主验收需经授权后覆盖 installed bundled Pi 的 regular/fullscreen、全屏背景、长列表/详情、resize/theme、Enter/Esc、编辑器焦点/文本、Fullscreen 滚轮正文与边界不穿透及关闭恢复。fixture 不能证明真实鼠标、终端视觉、在线 provider 或任意插件组合。若暂不授权，报告验收缺口，不称任务完全完成。

## 回归重点
- 每个 kind/title/status/waiting/executionMode、中文/ANSI/极窄宽度；workflow/agent 根统计不重复求和。
- 层级树/折叠隐藏选择、active descendant retention、根终态四秒/selected final preview、源移除/新 run。
- overlay setup 取消不关闭其他 interaction、done 一次、sink 同步重入、迟到 callback、timer 自然退出。
- 概览最多五根项/hidden count/小屏，中心不可用不 bypass，无 detail 读取/输入拦截。
- 多 foreground/background retrieval waits，全局 detach 不改变原 PID/执行/结果消费；selected stop 仍独立。
- hint 删除后超过两秒无旧 widget，Process 时钟继续更新，无 quick-completion/partial/通知/日志/Trellis 环境回归。
- shared scroll/widget 消费者、既有工具展示/handling clock、Beautify/editor/管理工具兼容。

## 阶段 1 实际检查记录
主会话直接实施，独立 trellis-check 审查并 scoped 修复。展示 helpers、kind-aware 标题、Workflow description 投影、Process 空白名称回退、树线/后代计数/折叠选择 reconciliation 已完成；未提前实施全屏/概览。

环境：Node v24.14.1、已安装 SDK 1.3.0/linked node_modules；PI_CODING_AGENT_DIR=/tmp/panel-redesign.Bqxo0J/agent、HOME=/tmp/panel-redesign.Bqxo0J/home、PI_SDK_DIR 指向已安装 release node_modules，COREPACK_ENABLE_NETWORK=0。原始日志在本轮 owned /tmp/panel-redesign.Bqxo0J。

- 首轮 `node --test --test-concurrency=2 extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/source-view.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts`：exit0，70/70，自然退出；直接 tsc：exit0。
- 独立审查修复长标题吞折叠 count、结构空格/深树分支、SGR reset 断背景、刷新 reparent/间接 cyclic 折叠隐藏 pin；增加四个回归。审查后同 focused 命令 exit0，74/74，自然退出；`./node_modules/.bin/tsc -p tsconfig.json` exit0。
- `pnpm check`：exit1，Corepack 在隔离 HOME 下尝试解析 pnpm，网络禁用阻断 npm registry 访问；检查尚未开始，无下载，不记为产品断言失败或 PASS。
- 直接已有入口重跑：`node node_modules/typescript/bin/tsc -p tsconfig.json && node --test --test-concurrency=8 --test-force-exit 'extensions/**/__tests__/*.test.ts' 'extensions/**/__tests__/*.test.mjs' 'scripts/*.test.mjs'`：exit0，1476/1476；等价覆盖 strict/full suite，但没有运行 link helper（已核实现有 SDK 链接）。全量 force-exit 不证明自然清理。
- `git diff --check` exit0。独立审查日志 focused/typecheck/final.diff 主会话已核验。

保留已知诊断：focused 有5次 `offStart is not a function`，来自 HEAD 已有 sdk-runtime.test.ts fake pi.on 未返回 unsubscribe 与 widget-display/client.dispose 的组合；本阶段不修该 fixture，不称无 cleanup 诊断。阶段3触及 widget/hint 时重新评估。真实终端/installed mounted overlay/provider NOT_RUN；当前 Panel 仍旧双栏，完整换行详情属于阶段2。无独立 lint 脚本。

阶段 1 checkpoint：待记录提交 hash。当前分支 task/task-panel-redesign（由获批实施创建，本任务共享源执行、不创建 worktree）。

## 尚未运行与材料维护
本轮只维护现有规划与用户批准的合并关联，无产品测试、真实宿主测试、派发、start、commit 或 archive。旧 research 保留原文作为历史观察，不迁移/清理；现有角色 manifest 需执行前刷新，不能宣称 context validation 已通过。原 overview 材料在 merged/ 下，原 planning 值是合并前历史状态；meta 明确 merged_into/disposition，根级待办已退出，不伪造 completed。
