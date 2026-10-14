# 授权与精简确认

用户批准在主 worktree 实施（2026-10-15）。失败提示仅 UI warning 或无 UI 时简短安全日志，不新增持久诊断 entry/schema/查询入口。用户明确本会话不使用 trellis_dispatch，独立检查使用普通 Agent。

用户另批准完成后可考虑 tmux 真实测试，确认验收后自行收尾，不逐项再问。测试只使用独立 tmux server、临时 HOME/agent-dir/cwd/session 和已有 SDK/CLI，离线 scripted provider 或 no-model 流，不读取个人认证、不安装/同步/reload/push。

阶段按 implement.md 分别验证、独立检查、scoped commit。任务 start 已记录 main/base main，收尾需明确本任务不是 PR 分支；不能伪造分支或改写历史。其他任务 dirty 保留。

check.jsonl 已准备三个真实引用；implement.jsonl 未委派，保持空，task validate 因此报告 1 项空 manifest 错误，不声称完整验证通过。
