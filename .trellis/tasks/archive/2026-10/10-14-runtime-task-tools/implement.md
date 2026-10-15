## 最终状态（2026-10-15）

已通过本仓库范围最终验收，见 [final-acceptance.md](research/final-acceptance.md)。R1–R4/N1均修复并独立复查；source整合后strict119focused773full natural、真实CLI8functional＋8cellbackground PASS，产品未提交。以下清单及交接保留历史阶段记录；最终证据优先，不把旧NOT_RUN/中断信息冒称当前状态。按既有授权归档source任务，保留dirtytarget。

# 实施与验收计划

## 当前检查结论（2026-10-15）

阶段2及R1–R4、N1日志崩溃缺陷已完成修复：R1–R4独立复查确认resolved；N1独立strict＋20/20 focused及基线红测确认PASS。产品已按三方diff整合到source，保留通知专项已提交成果，未提交本任务产品。整合fresh strict／119focused／773full natural PASS；source真实tmux8/8场景＋8/8逐cell背景PASS，CLIexit0/无ownedPID残留。首次整合Beautify测试引用旧adapter的strict失败已迁新合同并重跑通过。当前仅等待最终source整合独立审查；完成前仍in_progress，不归档。

历史BLOCKED报告及首败证据保留，不当成当前未修缺陷；并行source通知owner成果已通过三方保留，其他任务指纹不变。

## 本次续接授权（2026-10-15）

用户明确授权在现有 `.worktree/10-14-runtime-task-tools` / `trellis/10-14-runtime-task-tools` 接续实现、独立检查、隔离 tmux 真实验证，并在验收通过后收尾任务，无需逐项再次授权。授权包含必要的任务材料 refresh/collect 与规范基线对齐；保持不自动产品 commit/push/install/sync/reload、外部 pi-trellis 不实施的既有边界。真实验证仅用唯一 tmux server、临时 HOME/agent/cwd 和本地 fixture，不接个人 panes 或在线 provider。验收失败则保持 in_progress，不归档冒充完成。

## 最新进度（会话交接）

- 内部阶段1已实施并独立检查，target research/stage-1-check-report.md记录10类修复、21/21定向、692/692全量自然退出及strict通过。
- 阶段2代理9ab8c3c4-b645-46c以provider请求容量错误终止。target已有公开接口/child/Bash/Beautify/测试改动，但没有最终实施报告、final checks或独立验收；下方未勾项目不能依据旧阶段测试直接标完成。
- 通知专task `10-14-subagent-completion-notification` 已存在，本session错误顺带增加的description fallback与scheduleNudge console.error两处hunk需对照该owner最新成果分离；不得整文件回退破坏工具迁移。
- 规范已对齐并 refresh；用户明确改用普通 Agent 续接现有工作区。实现代理 `9683a4dd-38a2-477` 负责阶段2产品与自动验证，主会话负责文档与后续验收，tmux-prep代理 `915ac268-64f0-404` 只准备 research 夹具，不运行最终验收。


## 0. 规划门

- [x] 已确认六工具集合、去冗余入口、统一四类管理及subagent等待。
- [x] 用户明确无需旧兼容，不保alias／旧名renderer／ID或历史迁移。
- [x] 已完整研究真实backend、身份／resume、权限、等待／停止、workflow缺口与child同名覆盖陷阱。
- [x] Beautify前置已归档，后续terminal背景修复与验证限制已记录。
- [x] design草案给出动作／参数、返回metadata、scope、通知与child capability接线。
- [x] 外部pi-trellis关联planning任务已创建；preset合同冻结后再推进外部任务，本轮未授权外部实施／插件更新。
- [x] 用户审阅现有完整PRD/design/implement并明确批准开始实施；记录于PRD。
- [x] 当前source checkout执行，主会话管理生命周期，委派implementation及独立check；不创建临时worktree、不触并行修改。
- [ ] task.py validate；用户批准后才task.py start。

## 1. 接口合同与基线

1. [ ] 实施前重核git status/diff与归档前置成果；保存owning基线，避免覆盖并行README/host-loading-smoke/pi-manifest/at-path/.pi。
2. [ ] 读完整owning specs、Pi README及相关extensions/tui/SDK类型文档与链接，核实际host行为；不改SDK。
3. [ ] 定义runtime-tasks纯数据合同、target解析、逐action/type校验、typed capabilities；冻结content文本＋versioned metadata。
4. [ ] 先加红测：新工具集、旧名不存在、精确run/stale/ambiguous、错误／unsupported、字段不适用拒绝、status/list不consume。

## 2. 后端管理能力

5. [ ] process抽出原jobs能力为有限service，保registry/lifecycle/log helper owner；统一status/output/wait/stop/search/stats与snake_case翻译。
6. [ ] bash后台吸收notify:false、旧安全timeout及rollback；移除bash_bg；所有成功启动结果公开task_id/run_id，bg/fg/detach同identity。
7. [ ] agent暴露当前owner范围的retrieval/status/output/wait/stop capability，保run terminal、consumeRun、usage和cancel notification reconsider；不重写整个index。
8. [ ] workflow创建当刻terminal handle、不可变final result/error、wait/consume/delivered；接共享retrieval wait，重查取消后held通知，explicit stop静默；reject paused replay。
9. [ ] composition单次注册task_manage，后端能力按activation关闭；不把runtime放进TaskView、不另造总registry。

## 3. 子会话与名称切换

10. [ ] 实现有限scoped child capability handoff；保原boolean marker/RPC桥；同一个child facade合并local process与owned nested，不依靠customTool覆盖。
11. [ ] nested检索使用本child共享retrieval，scope/current parent run核验；禁用nested/noExtensions/denylist不复活禁止能力。
12. [ ] Agent/Workflow/message改新名；删旧result/jobs注册，移除nested旧result注入；同步runner exclusions/readmit/inScope/live tool checks、default agents/prompts、schedule触发引用与workflow工具描述。
13. [ ] 原publicRPC ping/spawn cwd/stop/consume保持协议，测试raw agent ID可进入新task_manage，不改RPC为工具调用。

## 4. Beautify与文档

14. [ ] 合并旧检索adapters为task-manage合同adapter；移除旧名resolver／历史专门处理；新metadata守卫与参数identity/action匹配。
15. [ ] 七action／四type摘要覆盖；保主信息与可靠状态／用量／range，wait partial/final与释放、cancelled不报stop。
16. [ ] 保optional原renderer槽隔离／dynamic／unknown／throwing delegate，以及default/self外壳、一次padding、mouse、窄宽、clipPlain背景连续；expanded仅返回内容无I/O/consume。
17. [ ] Bash返回信封变化同步后台摘要识别，原Read/Find/Grep无回归；不新增启动subagent/workflow/message/monitor美化。
18. [ ] README相关小节、Beautify TESTING、provenance新增偏离与现行spec同步；归档历史原文不机械替换。
19. [ ] 全仓active提示／内部引用旧名审计，允许明确历史／上游说明；外部生成材料不手改。

## 5. 验证矩阵

### 定向硬门

- [ ] root／child actual host loader：same/different cwd、重叠ALS、重复factory、rootshutdown、childshutdown不删root、nestedoff也可管理local bash/monitor。
- [ ] scope：root top-level控制边界、owned nested／workflow树保留、child不读root/sibling、旧run拒绝、rawRPC ID唯一解析。
- [ ] output/search/stats：byte分页／省略／UTF-8、regex/context/count/limit、无output／日志失败、agentverbose/partial状态、workflowreturn与log区别、统计不伪造累计。
- [ ] wait：四类multiple/already-aborted、/bg/Esc/complete同tick、completion consume时序、cancel后通知重查；subagent最终答案完整、wait与resume竞态结果稳定。
- [ ] stop：实际processTERM→KILL、WS/fd/timer、monitorexplicit无尾批、agentqueue/startup/ownedchildren/pool、workflowworker/hostgate/late callback，明确协作式provider限制。
- [ ] workflow terminal：setup failure/pausedstop/multiplewait、完整scriptresult、consume抑制重复nudge、failedreplay原算法、menus pause/resume/skip/retry无损。
- [ ] notifications：process/agent/workflowheld/result/group、monitoroverflowmanifest与取消retrieval重查、shutdown先freeze、actualdrain与旧effect封口。
- [ ] Beautify actual registered tool＋actual host：新管理七动作／类型、pending/final/error、metadata guard、details={}／foreign降级、背景逐cell、一次padding、partial/final回调计数、正文mouse、未知委托无额外读取消费。

### 自动验证命令

所有会读配置的测试使用临时PI_CODING_AGENT_DIR，只读已有SDK路径，不安装、不访问个人配置。定向自然退出，不加force-exit。

```sh
node --test extensions/runtime-tasks/__tests__/*.test.ts
node --test extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts
node --test extensions/beautify/__tests__/*.test.ts
node --test scripts/pi-manifest.test.mjs scripts/sync.test.mjs
pnpm check
node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"
```

按实际最终新增目录／fixture更新命令；不放宽原硬断言适应改名。新bug test先在未修复路径红测，fixture误差单列。全量strict/full/natural分开报告，不以force-exit掩资源泄漏。

### 终端与外部验证

- [ ] 真实CLI/PTy不包含在现有实施授权；用户单独允许后复用归档minimal tmux方法：新task_manage短list／subagentwait／processoutput与wait释放，140/80/40列、Ctrl+O、连续背景。临时HOME/agent/cwd/unique tmux，不触个人panes、认证或网络。
- [ ] 外部pi-trellis如纳入关联任务：ordinary subagent_run材料／worktree门禁、unsupported runtime、provider probe新task_manage／message与rawID；不可通过旧alias假绿。
- [ ] 所有NOT_RUN和第三方协作式取消边界明确记录，不用旧任务终端报告代称新工具验收。

## 6. 独立检查与交付

20. [ ] 独立check读取PRD/design、真实diff和研究，重点child scope、workflowconsume、resume竞态与Beautify；主会话核实际修复和最终测试。
21. [ ] PRD AC逐项对照证据；更新owning spec、检查Markdown链接、task validate、git diff --check（含新增文件）。
22. [ ] 给最终变更／破坏性改名／未验证项报告。不自动commit/push/archive/install/sync/reload。

## 回退点

合同未冻结不切名称；backend/child未过硬门不把新注册当完成；Beautify未通过不丢前置成果。回退只反转本任务owninghunks，不reset仓库、不覆盖并行修改、不删日志／workflowjournal、未知worktree或用户文件。单个公开接口不能以半迁移／双注册作为最终交付。
