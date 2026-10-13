# 实施授权

用户在完整六工具最终规划摘要之后明确回复“可以，开始吧”，批准实施。main确认worktree.py缺席后，用户通过执行位置问卷明确选择“当前工作区实施”。可使用普通trellis-implement/check、isolation=off在当前检出工作；不得临时worktree或自动安装CLI。

范围：Read/Bash/Find/Grep + get_subagent_result/jobs；遵循最新prd/design/implement。保留所有并行无关修改（.pi四项及其他任务）；不修改后端/新增metadata、不install/sync/reload/commit/push/archive。实现后main验证实际diff与独立check。

task.py start已执行，status=in_progress，记录main；本轮不创建PR或归档，main/base相同警告在收尾授权后处理。
