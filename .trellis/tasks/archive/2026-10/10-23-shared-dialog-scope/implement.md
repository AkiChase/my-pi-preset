# 实施与验证计划

## 当前授权

用户已审阅最终计划并明确要求“开始吧”，授权按三个阶段实施、检查及本地提交。已使用 `--allow-empty-context` start；任务记录分支为 main，CLI 提示将来 archive 不能以同名 base_branch 为目标，当前不执行归档或擅自调整分支。三个阶段已实施、独立审查并验证提交；不授权 push、历史重写、安装、个人配置操作或归档。仓库外 owned run 目录为 `/tmp/pi-dialog-nOVJuE`。

## 执行与审查选择

主会话直接实施，避免重复传递已经掌握的消费者上下文。共享生命周期跨模块契约与同步重入风险需要独立 `trellis-check` 审查：各阶段检查后再提交；主会话核对实际 diff、修复与测试，不以摘要代替证明。`check.jsonl` 已准备规范引用，implement.jsonl 故意为空；批准后如仍直接实施，start 使用 `--allow-empty-context`，validate 的空 manifest 诊断不得称为完整验证通过。

角色派发前读取 subagents skill 与包协议；未绑定任务共享源目录执行，派发时声明文件范围并禁止主会话同期编辑同一范围。子角色不提交、不改任务材料、不安装；输出使用主会话创建的仓库外临时目录，返回简短问题、命令、退出码与需核对的临时路径。无需 worktree 或 workflow orchestration。

## 阶段 1：共享机制

- [x] 新增 dialog owner/scope、纯结果类型；overlay 保留 re-export。
- [x] 覆盖完整控制流、取消/替换、迟到拒绝、同步重入、hook 准入与退休 scope。
- [x] 通过真实安装 SDK 对话方法验证 signal 和结果语义，不复制生产方法。
- [x] 自检和独立审查，修复后重跑受影响检查。
- [x] 阶段提交：`feat(interaction): add owned dialog scopes`。

自然退出检查：

```sh
node --test extensions/shared/interaction/__tests__/*.test.ts
node --test extensions/memory/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts
pnpm typecheck
git diff --check
```

## 阶段 2：Recap 迁移

- [x] configuration owner 替代 dialog controller/identity，保留手动命令 version 和领域 epoch。
- [x] 取消/失效收口到 run 边界；当前执行的调度/错误提示使用受保护的收尾入口。
- [x] 保留模型/认证验证、patch 存储与保存内部准入。
- [x] 扩展 harness 捕获 signal；新增旧流程迟到/未结算宿主、新流程重叠、错误提示和调度回归。
- [x] 自检和独立审查；核对实际移除重复代码而不是重新包装。
- [x] 阶段提交：`refactor(recap): use shared dialog scopes`。

```sh
node --test extensions/shared/interaction/__tests__/*.test.ts extensions/session-assist/recap/__tests__/*.test.ts extensions/session-assist/shared/__tests__/*.test.ts
pnpm typecheck
git diff --check
```

## 阶段 3：Session Name 迁移与最终集成

- [x] 配置使用独立 owner，明确会话撤销事件，不与自动命名请求控制混用。
- [x] 本地 saveConfig 支持单字段 patch、新鲜读取和 admitted 检查；更新内存使用实际保存结果。
- [x] 扩展测试 seam，覆盖迟到选择/输入、同会话恢复、替换、shutdown、未知选择、malformed 和外部未选字段变化。
- [x] 确认命名请求、标题变化、新输入不意外关闭配置；禁用 automatic 保留原命名取消与配额语义。
- [x] 独立审查及最终相关自然退出检查、pnpm check。
- [x] 评估必要规范更新，保留用户文档现有功能边界，不写内部迁移史。
- [x] 阶段提交：`refactor(session-name): use shared dialog scopes`，耦合测试及必要规范同阶段提交。

```sh
node --test extensions/shared/interaction/__tests__/*.test.ts extensions/session-assist/recap/__tests__/*.test.ts extensions/session-assist/session-name/__tests__/*.test.ts extensions/session-assist/shared/__tests__/*.test.ts
pnpm check
git diff --check
```

## 已核实执行记录

### 阶段 1

已提交 `d799d5a`。共享机制与 installed SDK 测试最终自然退出 26/26、exit 0；既有 Memory/Task UI 自然退出 188/188、exit 0；pnpm typecheck exit 0。独立审查修复 consumer isCurrent 同步 cancel/run 后准入未重新核对 slot 的局部缺陷，并以测试专用恢复旧实现的负对照验证回归 exit 1（预期失败）；修复后主会话重跑共享测试 exit 0。初始共享测试 20/20 通过不覆盖后新增的该重入场景，不替代最终结果。输出位于 owned run 目录 stage1-* 与 review-stage1/，无产品验证失败被抹除。

### 阶段 2

主会话完成迁移；初始相关自然退出与类型检查 exit 0。新增非协作 select/input、替换期间 timer 与当前错误回归后自然退出 103/103、exit 0。已提交 `126a0d0`。独立审查用菜单回归直接复现 error notify 同步打开新配置后旧 onSettled 恢复计时器的缺陷（exit 1），修复为先 schedule、最后 notify，通知后不继续旧流程工作；新增保存通知重入、返回/取消同 tick、通知 shutdown 回归。最终主会话自然退出重跑 107/107、exit 0，审查 typecheck/diff-check exit 0。命令与输出位于 stage2-* 和 review-stage2/。

### 阶段 3 与最终集成

已提交 `cf02ed7`。

首次相关自然退出运行 exit 1：新增 config.test.ts 遗漏闭合括号，137/138（一个测试文件解析失败）；主会话修复后 rerun 139/139、exit 0，typecheck exit 0。独立审查随后用负例复现 merged-only 校验允许 patch 修复损坏的已存字段（exit 1），修复为先验证 fresh 配置再合并，新增 manager/session fence、同步替换/通知重入、同 tick 派生取消及请求/配置独立回归。主会话核对最终 diff 并重跑相关自然退出 144/144、exit 0。

最终 `PI_CODING_AGENT_DIR=/tmp/pi-dialog-nOVJuE/agent PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.4.0/node_modules pnpm check` exit 0：严格类型通过，全套 1724/1724。最终 git diff --check exit 0，规范发现 development/testing 正常。输出在 stage3-initial.log、stage3-rerun.log、review-stage3/、final-natural.log、final-check.log；这些临时路径不是唯一结果记录。

新增英文 `development/dialog-scopes.md` 与索引链接，记录已验证共享契约、重入风险和取消/保存边界；无用户文档或 SDK 变更。真实终端/IME、第三方组合与在线 provider 质量 NOT_RUN。未执行安装/push/历史重写/归档。

### 用户授权的 tmux 真实 CLI 验收

用户随后明确要求开 tmux 验收。使用已有 tmux 3.6a、Pi 1.4.0，唯一 server `pi-dialog-TQ0laU`，owned run `/tmp/pi-dialog-tmux-TQ0laU`；env -i、临时 HOME/agent/cwd、offline/no-session、关闭自动扩展/技能/提示/上下文/MCP/主题发现，显式加载仓库 recap.ts/session-name.ts。fullscreen、dark，120×36 动态改为 80×30，无模型或网络请求。

PASS：Session Name interval=3 写入、第二步 Esc 不写入；Recap idleMinutes=2 写入、非法数值提示且不覆盖、菜单 Esc；取消后另一命令可打开（编辑器焦点恢复）；80 列菜单/输入可操作；/new 实际显示 New session started，随后重新进入配置保留全局 N=3。正常 Ctrl+D 退出，launch exit-code=0，stderr 空；初始 pane shell PID 65973 已不存在，唯一 tmux server 随最后 pane 退出，不再运行。

驱动失败与修复：初次/第二次 command 后等待超时，capture 显示命令仍留编辑器；补充观测命令与第二次 Enter 后实际打开，不认作产品失败。第三次 Esc 后未等待输入对话移除，后续文字落入旧 input；补充基于对话 footer 消失的条件等待后 PASS。/new 等待文字写错为 Started a new session，实屏为 New session started，修正后 PASS。原始失败、pane text、driver 与报告仅留 owned run；没有改产品代码或弱化字段保存断言。

本次为真实 CLI 的键盘/配置验收，不是图像截图。未验证 pending 对话时外部会话切换、同 owner 并发替换、regular/light/40 列、物理 IME/鼠标、第三方组合或在线模型质量；这些不得从 /new 成功推断。自动化生命周期回归仍是相应边界的证据。

## 用户验收与收尾

用户在真实 tmux 验收后明确要求“收尾吧”，确认接受当前实现并授权归档、清除绑定、日志记录及其配置的本地提交。任务直接在 main 实施、未创建 PR，因此归档使用官方 `--skip-branch-validation` 处理 branch/base_branch 同名，不虚构独立分支或重写历史。任务仅保留 PRD、设计、实施证据、角色 manifest 和 task.json；无需长期原始日志或额外 evidence 报告。

主会话已核实测试结果、失败修复关系和 tmux 正常退出，确认无使用这两次 owned run 路径的活动进程；收尾清理 `/tmp/pi-dialog-nOVJuE` 与 `/tmp/pi-dialog-tmux-TQ0laU`。长期结果均已在本文件自包含记录，不依赖被清理的临时链接。

## 环境、记录与边界

所有测试仅使用已有安装 SDK；执行前创建仓库外 owned run 目录，PI_CODING_AGENT_DIR 指向其中隔离目录，PI_SDK_DIR 从现有链接解析并检查成功，不读取个人配置。原始日志、驱动和重复中间输出只存 owned run 目录。最终记录命令、退出码、失败及修复重跑关系、测试数量和未运行项于本文件；诊断未完成时保留所需材料。没有实际执行就不记 PASS。

配置全套 pnpm test 使用 force-exit，不能证明自然清理；阶段 node --test 不加 force-exit。真实 SDK 方法验证不等于真实终端外观/IME/第三方插件组合，也不证明在线命名质量。

每阶段结束检查 staged/unstaged/untracked，精确选择本任务文件，保留任何并行工作。审批之前不 start、不提交规划材料或产品变化。
