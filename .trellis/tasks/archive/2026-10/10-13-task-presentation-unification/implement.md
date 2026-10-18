# 实施计划

## 状态与准备

用户明确授权按已审阅方案在托管worktree实施、验证与本地阶段提交；不开Agent约束仍保留，主会话执行。新命令/task-detach不保留/bg。源目录beautify/index.ts与editor存在并行阶段状态改动，不复制到worktree、不覆盖；未来合并如冲突先报告。独立审查如高风险需要且约束仍禁止，停在门禁，不冒充独立审查。

实施前：完整读取受影响owner/调用者/测试及spec；核对Git并行归属、真实SDK版本。计时采用用户认可的tool_execution_start至end处理口径，包含准备/校验，单调时钟且终态冻结，不替换成execute duration导致口径变化。确定纯显示自查与计时跨模块风险的审查安排，必要独立审查不可用时不越门禁。

## 阶段一：标题与摘要布局

- 最小扩展现有布局/标题组件；tool身份和管理action优先，可读description与空白回退，窄屏保护状态统计。
- 适配subagent_run、agent_manage/process_manage、monitor、bash；仅改变显示，不注册第二执行owner。
- bash展开显示完整command，其他工具保留已有配置/差异/range/stats/全部正文。
- 实际宿主窄宽/Unicode/theme/partial-final/错误/foreign fallback回归。
- 核对AC1–3后提交该阶段。

## 阶段二：Workflow折叠与实际宽度

- folded整体摘要，expanded完整描述/树/统计/日志。
- 实际render(width)求值，保护状态/计数/时间；主对话工具与必要session-entry兼容，保留无task历史fallback。
- 不改两种独立查看器、source描述投影或progress/replay执行策略。
- 实际工具/entry宽窄/resize、cached/paused/error/长树与日志测试。
- 核对AC5与前阶段集成后提交。

## 阶段三：bash实时计时、命令重命名与集成

- /bg改/task-detach且不保留别名；同步唯一controls注册、工具说明、panel/hint fallback、用户docs与混合等待测试。配置键/快捷键不改，历史provenance不批量替换。
- 公共start/end事件记录工具处理时长，以toolCallId关联显示；含准备/校验，参数流不计时，最终同口径冻结。
- 安静执行也刷新，准备阶段不计时，后台返回/错误/取消冻结，关闭清理。
- 不从render建timer、不轮询日志/后端，不更改模型结果；bg-hint仍归原owner。
- 精确时钟fixture与真实注册bash执行验证自然退出、timer/订阅清理；不以mock单独宣称真实生命周期。
- 最终AC1–6审查、类型与全量回归，提交验证后的阶段。

## 验证计划

现有Node/TypeScript/SDK；COREPACK_ENABLE_NETWORK=0、仓库外owned临时PI_CODING_AGENT_DIR，必要HOME隔离，不调用包管理器触发下载。原始日志外部保存，核验后定向清理，失败原因及重跑记录在本文。

先find核对实际测试路径，选择精确文件；拟相关suite：

```sh
node --test --test-concurrency=2 \
  'extensions/beautify/__tests__/*.test.ts' \
  'extensions/agent-tasks/__tests__/*.test.ts' \
  'extensions/process-tasks/__tests__/*.test.ts' \
  'extensions/runtime-tasks/__tests__/*.test.ts'
node node_modules/typescript/bin/tsc -p tsconfig.json
node --test --test-concurrency=8 --test-force-exit \
  'extensions/**/__tests__/*.test.ts' \
  'extensions/**/__tests__/*.test.mjs' 'scripts/*.test.mjs'
git diff --check
```

计时/lifecycle重点自然退出，全量force-exit仅证明断言。实际组件测试不证明真实终端视觉；线上provider、真实终端、个人reload默认NOT_RUN，不隐式扩大权限。没有独立lint脚本，不声称lint PASS。

## 当前审查结果

本轮发现并修正规划矛盾：删除查看器适配/Panel共享框架与圆点映射，加入bash精确计时门槛及Workflow展开验收，保留tool身份/管理action与最新配置显示。六工具范围、紧凑优先、无内部滚动由用户认可。

尚未运行产品测试、修改产品或准备dispatch。两个role manifest仍有意为空，task validate空manifest诊断不能写成PASS。用户批准实施后若没有派发，用start --allow-empty-context；不借此绕过审查风险门槛。

## 实际进度

Trellis已部署资源经files/skills哈希与mode核对后独立提交51acb4d（模板定制不重置），managed worktree快进后ready。旧prepare缺runtime与后续空manifest失败均已解决，源manifest补4个spec引用，不派Agent。已有node_modules用本地symlink复用，不下载；该symlink未提交。

S1检查点a28889b（task/tool-presentation）：7文件纯显示适配，描述优先、管理action、窄屏统计独立行、bash展开完整command。主会话自审（非独立审查），真实SDK组件聚焦74/74自然退出，TypeScript exit0、diff-check通过。首轮2项旧断言失败（title action、窄屏单行限制），更新为已批准行为后第二轮遗留另一title断言失败；第三轮74/74。日志/tmp/tool-presentation.MyGpNs保留。无renderer执行/metadata准入改变。S2/S3待实施；src beautify/editor并行改动保持。

S2检查点3b146e9：实际width Workflow组件折叠整体摘要/展开树日志，3文件；agent/beautify321/321自然退出，TS exit0，主会话自审。S3检查点c47e69b：activation显示clock（start/end处理口径、单调时间、安静invalidate、冻结/关闭防复活），/task-detach唯一注册与当前说明/文档/测试同步，20文件。最终5组822/822自然退出，TS exit0，全量1457/1457 force-exit exit0，diff-check通过。Node24.14.1/SDK1.3.0，HOME/agent隔离且COREPACK_ENABLE_NETWORK=0；无下载。

最终验证前三轮因旧host-loading-smoke严格handler断言未计display clock失败（root start、child start、shutdown计数分别暴露），准确更新root/child均只有显示clock新增且不添加Agent manager后第四轮通过；不称前三轮PASS。原始日志/tmp/tool-presentation.MyGpNs保留待最终集成验收。已知旧fixture cleanup诊断仍存在，不能宣称全部清理diagnostics干净。

本任务按不开Agent约束主会话自审，不称独立审查。显示clock不更改执行/权限/公开结果契约；命令rename公开兼容变化为用户明确决定，无bg别名，混合等待行为测试保留。真实终端视觉/线上provider/个人reload NOT_RUN；最终forced全量不证明自然生命周期。

## 最终合并与收尾

用户批准合回main并收尾。合并8a9a3bc保留输入框phase-status和tool-clock两套接线，index自动合并；host-loading-smoke事件/cleanup计数冲突按实际两套owner修复。合并后五组831/831自然退出，TS exit0，全量1466/1466 force-exit exit0，diff-check通过。命令同前述隔离执行，日志merge-focused/merge-ts/merge-full，非线上provider/真实视觉证据。

worktree第一次remove因本轮node_modules symlink未tracked而拒绝；核对仅此附件后定向unlink（未删除依赖目录），再次preview仅ignored binding.json，confirm成功移除并解绑。task/tool-presentation分支保留，三个阶段及merge已在main保存，不改历史、不push。

任务材料只保留PRD/design/implement及真实spec manifest、task record，无raw logs入库；核验后本轮日志及prepare临时JSON定向清理成功。归档首次因remove解绑后branch回main/base-main而拒绝，主会话按真实已合并task/tool-presentation修复metadata后归档；CLI自动提交仍因旧未tracked source路径失败，核对exact archive scope后补交。源任务的父任务旧依赖/全屏Panel要求留待父任务重新设计，不自动实施。接受本任务仅表示主对话工具块完成，不等于Panel共享接口原承诺完成。自审不是独立审查；真实终端视觉/provider/reload未执行。
