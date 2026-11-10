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

阶段2首跑已修复 registry/services，但揭示共享 `preserveHandoff` 仅识别 getText 的重复写入，不识别 SDK1.5.1 getExpandedText，3 个现有 collapsed-paste 回归失败。主会话核对实际 owner 和差异，明确授权在本阶段 R2 原有状态保持范围内最小适配 `extensions/editor-handoff/index.ts` 临时 guard，并验证不同文本仍传递、descriptor lease 正常恢复。不是新 UX 或架构范围。

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

原始日志/probes `/tmp/pi-sdk-compat.ZDRQNy/stage1/` 保留；真实 TUI/IME/bundle/在线 provider NOT_RUN。主会话已核对实际 diff/日志，review 无剩余阶段1 blocker，检查点已提交：`667327d`。

### 阶段 2 完成记录

首次实施 `agent_trellis_implement_5_03748998` 修复六处 fixture state/service，实际 SDK 方法保留。首跑自然退出：at-path 61/60/1 fail，Beautify+Task UI 123/121/2 fail，shared/runtime 64/64 PASS，typecheck PASS。三失败都是 SDK expanded-text redundant setText 破坏 collapsed paste，主会话核对 `preserveHandoff` 后授权在原 R2 状态保持范围内修正临时 guard。

续作 `agent_trellis_implement_6_ab8c4c0d`：temporary guard 比较 displayed/getExpandedText，仍转发不同文本；新增四个实际 editor/descriptor/SDK失败 rollback 测试。新增 guard 用例 RED：2 pass/2 fail，修复后 GREEN：4/4，原失败未删除或弱化。

独立审查 `agent_trellis_check_7_a37e6fb2` 无 blocker、无 review edits；实际 stage2八个产品/测试文件变更，主会话核对完整 diff 和最终日志。

无 shim，自然退出 gate（续作和 reviewer均同样通过）：at-path 61/61、Beautify+Task UI editor 127/127、shared interaction/widget/runtime 64/64，全部 exit0；`pnpm typecheck` exit0；`git diff --check` PASS。

主会话 stage2 `pnpm test` exit1，1805 tests / 1801 pass / 4 fail。仅剩 stage3 Memory scalar、bash schema、monitor required-nullable、Recap EISDIR；无模块加载级联失败。四个 guard 新测试使全量计数从1801增至1805。

SDK source与controlled fixture确认：只 quit runtime.dispose 在 abort→shutdown→session.dispose 后等待 settleCredentialWrites；session replacement 不等待，精确顺序保留。设计材料已澄清此差异。

日志保留 `/tmp/pi-sdk-compat.ZDRQNy/stage2/logs/*-first.log`、`continuation/logs/{guard-red,guard-green,at-path,editor,lifecycle,typecheck}.log`、`review/`、`main-full-test.log`。未使用 shim/force-exit 证明 focused cleanup；真实 TUI/IME/在线 provider NOT_RUN。stage2检查点已提交：`f4494fc`。

### 阶段 3 完成记录

实施 `agent_trellis_implement_8_65b27baf`、独立审查 `agent_trellis_check_9_17e75f03`。只修改四个测试文件：Memory list-arguments、Bash schema、Monitor schema、Recap sdk-runtime；未改产品/schema。

首跑自然退出：Memory/Recap131 tests /129 pass /2 fail，Process schema29/27/2，均exit1。修复 required missing/undefined 的真实host拒绝预期，保留其余合法scalar转换、输入不变和zero origin/job effects。实际注册schema probe确认效果与产品约束未变。

真实SDK Recap EISDIR用例改为强断言 atomic rollback：entries/index/tree/branch/header/leaf/disk不变，失败不emit entry_appended；恢复自有 fixture路径后重新打开磁盘和导航，确认prior recap恢复、后续successful refresh真正持久化。研究原称有独立 non-atomic coverage，完整搜索发现实际没有，新增一个fake-host真实 append后抛错用例，验证未确认历史保留但不得显示/自动复用，后续刷新保留全部append-only历史；产品保守处理未改。

最终自然退出（实施与review均通过）：Memory/Recap132/132、Bash/Monitor schema29/29，exit0；typecheck exit0；reviewer scalar probe exit0。`pnpm test` exit0，1806/1806、81 suites、skip/cancel=0（既有full force-exit不替代自然退出证据）。`git diff --check` PASS。

review无blocker、无fix。主会话检查完整diff和日志；原始失败/重跑执行时位于 `/tmp/pi-sdk-compat.ZDRQNy/stage3/logs/`、`review/logs/` 与 scalar-probe临时文件，真实SDK和fake证据层区分保存在记录中。阶段3检查点已提交：`a61ed07`。

### 阶段 4 集成结果与契约收敛

主会话最终环境：Node24.14.1，已安装 SDK1.5.1，`PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.5.1/node_modules`，执行时 `PI_CODING_AGENT_DIR=/tmp/pi-sdk-compat.ZDRQNy/integration/main-config`。没有兼容 shim、安装/下载、SDK文件修改、个人 reload/sync、push/history rewrite。

| 最终实际命令 | 结果 |
| --- | --- |
| `pnpm check` | PASS exit0，strict typecheck成功；1806 tests /1806 pass /0 fail /0 skipped /0 cancelled，81 suites |
| `node --test --test-concurrency=8 extensions/agent-tasks/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts` | PASS exit0，891/891，68 suites，自然退出，无 force-exit |
| `node --test extensions/shared/scroll-panel/__tests__/*.test.ts extensions/agent-tasks/__tests__/loading.test.ts scripts/pi-manifest.test.mjs` | PASS exit0，22/22，4 suites，自然退出 |
| `git diff --check`、`task.py validate 11-10-pi-sdk-1-5-1-compat` | PASS exit0；implement/check manifests均5条有效引用 |
| Spec link/size/discovery | PASS；development index 30658 bytes、sdk-compatibility3321、testing index17311，均在单文件注入预算内；开发层/测试层发现未变 |
| 物理终端/IME、第三方input-history组合、实际CLI bundle/TUI、在线provider | NOT_RUN，未授权；不以组件/source-layout回归冒充这些验证 |

阶段2 at-path61、Beautify+editor127、shared/runtime64及阶段3Memory/Recap132、Process schema29自然退出结果覆盖最终相同代码；独立review无fix，因此这些有效结果直接复用。Full package既有force-exit不能证明自然cleanup，最终891项自然退出证据单独给出。最近请求/累计用量回归包含在Task UI与Agent suites中，未回退618353a功能。

代码分别经阶段独立review，主会话核对实际diff；阶段4只补充SDK契约/验证规范与材料，不改变程序输入，最终测试结果仍覆盖最终代码。SDK contract最初直接放入development index导致33427 bytes注入警告，已拆为 `sdk-compatibility.md` 并在index/manifests引用，复验无截断警告。

未新增用户功能，现有用户文档描述保持成立；不将SDK迁移史或测试教程塞入用户docs。未变动受provenance资源约束的vendor/runtime资源，因此不伪造hash更新。SDK契约记录公开import/render、输入unknown parse-before-effects、temporary displayed/expanded handoff、真实hostfixture、quit credentialsettlement和atomic/non-atomic persistence区别。

## 最终材料、清理与交付状态

本任务临时原始材料在结果与失败/重跑关系整合后由主会话核对完毕。所有本任务子角色和shell命令终态已取得；管理工具无运行中本任务执行，`lsof +D /tmp/pi-sdk-compat.ZDRQNy` 无open files（exit1）。按已有授权仅删除本任务owned目录，确认路径不存在。前文临时日志路径是执行时位置，已删除，不是永久记录依赖。旧 `/tmp/pi-tokens-row.EaBi0M/` 仍存在且保持只读原样。

实施阶段检查点：`667327d`（公开API/类型）、`f4494fc`（hostfixtures与paste状态保持）、`a61ed07`（校验/持久化回归），最终spec/验证整合检查点 `b1967c5`。六个无关Trellis改动保留。

## 验收与收尾授权

用户在获知无shim完整检查1806/1806、自然退出891/891与22/22，以及物理终端/IME/CLI bundle/在线provider未运行的限制后回复「收尾吧」，接受本任务范围内交付，授权归档、清除当前绑定和记录journal。

本任务直接在main完成四阶段本地提交，无独立feature branch或PR；归档使用非PR任务的 `--skip-branch-validation`，不伪造分支或合并信息。不push、不改写历史、不安装、同步或reload。保留执行失败与修复关系以及全部NOT_RUN限制。
