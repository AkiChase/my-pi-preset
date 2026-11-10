# 实施计划与验证

## 状态与阶段边界

用户已审阅最终四阶段方案并回复「行」，批准以下顺序。每阶段 implementation/check 分别委派，主会话验收实际 diff 和验证后提交检查点；不允许子角色提交或递归派发。

### 阶段 1：公开 SDK 导入与类型恢复

修改 PRD R1 对应 6 个 Type imports、Agent ExecResult fixtures、Beautify renderer contexts、Process notification context fixture与 process-tasks/index.ts forwarding helper。只修改 Type 来源/类型与明确夹具字段，schema/执行/渲染外观不变。

Scoped gates（无 shim）：

- `pnpm typecheck`。
- `node --test extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/agent-tasks/__tests__/worktree-lifecycle.test.ts extensions/agent-tasks/__tests__/detail-timing-sdk.test.ts extensions/runtime-tasks/__tests__/reminder-sdk.test.ts`。
- `node --test extensions/beautify/__tests__/registered-agent.test.ts extensions/beautify/__tests__/registered-monitor.test.ts extensions/beautify/__tests__/retrieval.test.ts extensions/beautify/__tests__/secondary-parameters.test.ts extensions/beautify/__tests__/title-tones.test.ts extensions/beautify/__tests__/tools.test.ts extensions/process-tasks/__tests__/notification-renderer.test.ts`。

重新 full test 定位解锁失败，但阶段 2/3 的既知 fixture failures 明确 deferred，不用它们冒充阶段 1 PASS。独立 review 确认导入和工具边界未变后提交。

### 阶段 2：host fixture 与 lifecycle 服务

补 at-path/Task UI editor/Beautify harness 的 dialog state，补 host-reset/shared overlay/Footer fixture registry，补 sdk-runtime 最小 modelRuntime service。优先修复缺失夹具，产品 owner 除非实证显示相同 SDK 兼容缺口不改。

Scoped gates（自然退出）：

- `node --test extensions/at-path-completion/__tests__/*.test.ts`。
- `node --test extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts`。
- `node --test extensions/shared/interaction/__tests__/*.test.ts extensions/shared/widget-display/__tests__/*.test.ts extensions/task-ui/__tests__/sdk-runtime.test.ts`。

断言真实 SDK reset/open/done/focus/setter/dispose，不替换成 fake 算法。controlled credential promise 证明卸载等待完成；重新审查 stale callbacks、editor identity、animation timers、Footer takeover 后提交。

### 阶段 3：持久化/转换 fixture 预期

Recap SDK EISDIR 用例验证原子回滚与先前确认内容恢复；Memory host scalar conversion 用例拒绝 required undefined。同类新解锁 `process-tasks/__tests__/bash-schema.test.ts:135` 的 description:undefined、`monitor-schema.test.ts:246` 的 timeout_ms:undefined 同步更新实际 host 预期。保留 non-atomic recap fake coverage 与严格 direct-call admission；无必要不改产品。

- `node --test extensions/memory/__tests__/*.test.ts extensions/session-assist/recap/__tests__/*.test.ts`。
- `pnpm typecheck`，相关 SDK schema/session regressions。

独立审查确认没有为 PASS 放宽真实约束后提交。

### 阶段 4：全量集成与契约收敛

- `node --test extensions/agent-tasks/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts`，无 shim/force-exit。
- 完整 `pnpm check`（full test 配置有 force-exit，不替代自然退出证据）。
- 最近请求/累计用量、manifest/loader、SDK component/scroll layout相关回归保留；检查实际文件是否存在再选择测试，不伪称真实 bundle/TUI已跑。
- 更新 relevant specs/已有用户文档/provenance（只在实际契约受影响时）；`git diff --check`、role manifests parse/existence、Git final scope审查。
- 集成修复不得超出原公开行为；实质范围变化先请求确认。需要新 scoped 修复时审查后单独提交；无代码变动不制造空提交。

## 环境和文件安全

已有 SDK1.5.1，Node24.14.1，`PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.5.1/node_modules`；每个 executor/阶段使用 `/tmp/pi-sdk-compat.ZDRQNy/` 下独立 config/logs。新 raw 输出不写入 repository。依赖缺失是 blocker，不授权下载或安装。

保留 PRD 指明六处无关 Trellis 改动。任务材料由主会话维护，产品文件并发所有权严格分开。源研究直接返回发现，无 source research/ 报告。

## 已完成的规划验证

主会话复现（无 shim）：`PI_SDK_DIR=<installed SDK> PI_CODING_AGENT_DIR=/tmp/pi-sdk-compat.ZDRQNy/baseline-agent-config pnpm check` exit2、`pnpm test` exit1；25 TS 诊断与 1338/1242/96 计数和失败名称均与上次完全相同。

- 新原始日志：`/tmp/pi-sdk-compat.ZDRQNy/baseline-check.log`、`baseline-test.log`。
- 只读旧证据：`/tmp/pi-tokens-row.EaBi0M/main-final-check.log`、`main-final-full-test.log`、`review/shim-focused-rerun.log`。旧日志不移动/清理。
- 研究 executor：`agent_trellis_research_2_c1be5da2`，只读，返回根因/SDK证据/分阶段建议。主会话核对主要证据并整合为 PRD/design，本文件不把该 summary 当成执行 PASS。
- 未进行产品/测试编辑、安装/下载/reload/真实终端或在线 provider 验证；当前 NOT_RUN 限制保持。

## 实施检查点

执行并记录每阶段实际命令、失败/重跑、独立审查结果与 commit hash。不提前将基线 FAIL 写为通过。

### 阶段 1 完成记录

实施 `agent_trellis_implement_3_6b8f0355`，独立审查 `agent_trellis_check_4_2692722a`；16 个产品/测试文件变更。六个 Type imports 转到已有 typebox；ExecResult fixtures 明确 truncated:false；renderer fixtures 注入 SDK hints；Process helper 保留完整 MessageRenderOptions。

初次 `pnpm typecheck` exit2，新解锁 3 个 StringEnum/TypeBox Static inference 的 TS2345，位置 runtime-tasks/tools.ts:211、task-composition.ts:36–37。最小 typing 修复将已有严格 parse 前的 input 类型改为 unknown，运行时 parser/公开 schema 未变。复跑类型检查 exit0，review 又验证 parse precedes effects。

无 shim、SDK1.5.1、独立 config，实际结果：

- `pnpm typecheck`：PASS exit0。
- 阶段1 Agent/Runtime focused：PASS exit0，64/64，自然退出。
- 阶段1 renderer focused：PASS exit0，44/44，自然退出。
- reviewer `node --test extensions/runtime-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/loading.test.ts scripts/pi-manifest.test.mjs`：PASS exit0，85/85。
- reviewer 仓库外 probe：6 个 HEAD/current schema JSON 完全相同；未经 source transformation 的 production task-composition 经实际 host loader 加载/cleanup，PASS。
- `pnpm test`：FAIL exit1，1801 tests / 1741 pass / 60 fail，解锁 +463 tests；stage2 host fixtures 与 stage3 scalar/recap 仍 deferred。两个新增 required-undefined fixture 列入同类 R3。
- `git diff --check`：PASS；无独立 lint 脚本。

reviewer 核对了旧 parser 对 kind array 的 loose normalization；实际 SDK schema 拒绝，tool execute invalid_arguments 且 capability effects=0，原有未变，无新增 admission bug。未作范围外 parser 修复。

原始日志/probes `/tmp/pi-sdk-compat.ZDRQNy/stage1/` 保留；真实 TUI/IME/bundle/在线 provider NOT_RUN。主会话已核对实际 diff/日志，review 无剩余阶段1 blocker，准备阶段检查点提交。
