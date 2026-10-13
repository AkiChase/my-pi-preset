# 相邻任务与文件边界更新

阶段2B期间发现另外两项用户工作；不推断它们已完成或主动合并。

- `.trellis/tasks/10-12-pretty-editor-compat/`：独立branch/worktree修复Pretty与input-history顺序、session/reload中的editor历史保存。其PRD要求不复制unifiedtask未提交工作。当前task list为in_progress，文件PRD尚有旧planning状态。阶段4的editor-local Down必须在实现前核对该任务实际交付API/基线，不覆盖其装饰/历史修复，不另装wholeeditor破坏undo/history。
- `.trellis/tasks/10-12-subagent-turn-limit/`：planning，移除model max_turns但保留用户配置/programmatic限制；明确要求本vendor任务先完成稳定baseline，再独立worktree实施。本任务不自行移除turnlimit schema，不把新task需求混入stage2B/3。

这里仅记录当前实际PRD/task状态，代码不变。后续agent必须读共享composition最新版本，保留其他任务的owner边界。主会话不会替用户批准这些任务或创建它们的分支。
