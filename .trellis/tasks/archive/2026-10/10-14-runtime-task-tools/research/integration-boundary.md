# 最终集成边界

本任务旧 worktree 基于 `3bedbcc`，不能整目录或整分支覆盖当前 main。main 已有用户文档重组、Beautify 背景／标题修复、会话命名及其他任务成果，均要保留。

## 产品

- 仅运行接口任务的 `extensions/{runtime-tasks,process-tasks,agent-tasks,beautify,task-ui}` 与 `extensions/task-composition.ts` 相关实际 diff；包含必要新模块／测试与删除旧注册／adapter。
- Beautify 与 main 后续同文件修改须按语义合并：`clipPlain` 保纯文本 reset 边界，标题真实名称不得被 Runtime Tasks 标签替代，optional host shell一次padding、pending/final保持。不丢 main 已验证测试。
- main其他插件如blocked-signal/session-name/session-assist不纳入本任务，不用旧 worktree回退。
- 旧 `.trellis/spec/preset/` target dirty 是历史规范基线，不作为接口产品成果覆盖 current specs；current规范使用 `.trellis/spec/development/testing/guides`。
- no 自动产品commit限制仍保留；因此不得隐式merge/cherry-pick产生产品提交。collect只收材料，不收代码；最终验收与归档不能虚构已合入或已提交。

## 文档

- 在 current source docs基础上只改 task-composition、monitor、beautify三页；rootREADME本来简短，无需恢复旧功能教程。
- root新 `docs/packages/trellis.md` 需明确新subagent_run与旧Agent detector的组合限制，关联外部任务未实施/未更新时不得写完全可用。修改仅文档，不改外部产品。
- root其他docs与nav保持source最新，target临时复制的 docs/index.md仅作当前导航baseline，不作独立接口变化。
- 测试方法留spec/任务research，不写用户doc。

## 任务生命周期

source唯一archive主体；target task副本不归档、不删dirty worktree。collect明确逐文件预览/确认，不扫所有目录或task.json。验收PASS后根据已授权finish处理source任务与own session journal；有未通过hardgate则不归档。记录真实终端测试实际输入／返回／rawframe与PIDexit，不以metadata终态冒充执行已退出。
