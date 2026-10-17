# 实施与验证计划

## 状态

用户已批准开始实施；S1/S2已完成并分别验证提交，用户已验收并授权收尾（归档、清除本会话绑定、journal及范围内本地提交）。主直接实施与自审，不启动Agent；本任务不改公开字段/有效语义/权限。unused implement/check manifests故意为空，start使用--allow-empty-context，不称完整manifest验证通过。

## S1：单一通用缺省说明

- 完整读取官方prompt接口及现有通用入口；选择单一责任最小入口，不绑Trellis项目激活，不逐tool引用。
- 一个before_agent_start位置向官方promptGuidelines添加简短固定文本，自身精确去重，保留其他规则；不替换完整prompt或重注册工具。
- actual SDK验证单次/重复事件/peer规则/custom/forced；不绕过子Agent扩展隔离。
- 必要spec与入口声明/最小用户说明耦合维护，不改web-access文档。
- 自审与相关检查通过后立即精确提交S1。

## S2：自有工具缺省说明与诊断

- 完整读Agent tool-contract/guidance/index相关执行、nested、workflow准入及实际调用方；bash schema/admission、monitor、management工具与tests。
- Agent非法resume先报根因/修正；合法恢复混入新建字段明确mode，主/嵌套一致。
- 七组工具按mode/action省略说明与明确占位诊断；workflow/monitor仅修改拒绝提示/顺序，不改合法执行行为。message无可选字段，不硬加重复通用段落。
- 验证raw与host null区别、false/0/合法nullableJSON保持，实际注册零副作用回归与SDK指导一致。
- 自审、自然退出聚焦与pnpm check通过后立即精确提交S2。

## 验证入口

实际现有文件已定位：

```sh
node --test extensions/agent-tasks/__tests__/tool-contract.test.ts extensions/agent-tasks/__tests__/input-errors.test.ts extensions/agent-tasks/__tests__/foundation.test.ts
node --test extensions/process-tasks/__tests__/bash-schema.test.ts extensions/process-tasks/__tests__/bash-prompt.test.ts extensions/process-tasks/__tests__/monitor-schema.test.ts extensions/process-tasks/__tests__/monitor-setup-result.test.ts extensions/runtime-tasks/__tests__/contracts.test.ts extensions/runtime-tasks/__tests__/prompt.test.ts
node --test scripts/pi-manifest.test.mjs
pnpm check
git diff --check
```

S1新增测试使用extensions/__tests__/tool-guidance.test.ts，并纳入标准discovery；实际事件接入与SDK assembler均验证，不只测自行拼接文本。根据最终改变输入复用或重跑集成，不把计划命令称已运行。

产品验证前创建仓库外自有mktemp run目录，设置PI_CODING_AGENT_DIR并复用现有SDK；日志/临时drivers存其中。保留失败事实及修复/重跑关系，记录精确命令、环境、exit、计数与未运行项。无线上provider、网络、真实终端视觉、安装/reload/push授权。独立review未计划，不宣称自审独立。

## 本轮只读证据

- node --test extensions/agent-tasks/__tests__/tool-contract.test.ts：exit0，4/4 PASS。直接最小请求完整spawn+resume:""复现先报description；省略resume合法；schedule:""报非空。
- actual validateToolArguments探针：optional非nullable resume/flag/index:null删除，resume:""、false、0保留，optional显式nullable payload:null保留；exit0。
- 查找SDK最初使用旧api路径失败（rg/ls exit1），改为dist/api定位成功；未进行安装/产品修改。
- 以上均为只读/纯验证，不代表本任务新增实现或全套验收。

## 执行记录

- 自有目录 /tmp/tool-optional-contracts-Xidsc5；所有产品验证设置PI_CODING_AGENT_DIR=/tmp/tool-optional-contracts-Xidsc5/agent。
- S1 node --test extensions/__tests__/tool-guidance.test.ts scripts/pi-manifest.test.mjs：exit0，14/14 PASS；pnpm typecheck exit0；pnpm check exit0，1427/1427 PASS，git diff --check PASS。实际assembler覆盖位置、重复事件、隐藏peer、custom/forced；无线上provider/个人reload验证。
- S1主自审通过，精确6文件提交f69497c。其他并行改动未stage。未新增全局参数清洗/工具注册，单一固定文本通过官方事件接口。
- 一次尝试background_after_seconds与run_in_background:true组合在bash准入层被拒绝，无命令执行；随后合法前台命令完成，未将拒绝称执行失败。

- S2首次自然退出聚焦75/75 PASS、exit0；首次pnpm typecheck FAIL exit2，新增实际host测试构造缺少ToolCall.type（3处），补type:"toolCall"后修正。最终pnpm check类型与1432/1432 PASS、exit0；最终同9文件自然退出聚焦75/75 PASS、exit0；git diff --check PASS。
- S2主自审检查实际diff，准入集合/合法行为不变，仅resume与workflow错误优先级、提示/字段指导修改，monitor与management只改拒绝提示。bash已有明确省略阈值说明，无需重复改；message无可选参数不硬加；memory/Trellis仅合法例外核查。提交fa33cb6。
- 最终R1–R5/AC1–AC4已按默认SDK与离线注册测试核对：说明在rules内且docs前一次；raw空/null resume错误先于description冲突，零lookup/spawn/resume；host null去除与JSON null/false/0/空串保留有回归。未运行线上provider/真实终端/个人reload，无独立Agent复核，不称模型永不填错。
- start记录main与base_branch相同警告；本任务在源目录直接实施，无worktree或PR；当前不归档、不journal。角色manifest仍故意为空，不称完整task validate通过。
- 原始输出保留于自有/tmp/tool-optional-contracts-Xidsc5直至最终检查与清理；最终结果自包含记录，不需复制日志进仓库。

## 最终验收与收尾

用户明确允许收尾。产品提交f69497c、fa33cb6，规划/证据提交4e36472；最新全套类型与1432/1432 PASS、自然退出聚焦75/75 PASS，失败与修正事实保留于前文。最终相关产品无未提交修改，保留6个最小任务材料，不留原始日志或重复报告。

已核查本轮自有日志及诊断，无未解决失败；lsof +D /tmp/tool-optional-contracts-Xidsc5 无打开文件（exit1为空匹配），仅清理该目录，不清理其他临时或用户生成.DS_Store。直接main实施、无PR，归档显式使用--skip-branch-validation；不伪造分支。其他并行任务/部署资源改动保留，不包含安装/reload/push或历史重写。

## 最终检查与提交

每阶段检查实际diff及并行staged/unstaged/untracked；耦合代码、tests、文档与resource hash同阶段提交。当前另有归档任务等并行staged材料，禁止顺带提交。最终对PRD逐项验收，再提交必要集成/规划材料；归档journal需要另行收尾授权。
