# 删除模型控制的子代理轮次限制

## 目标

主 agent 经常主动填写 `max_turns`，导致正常推进的子代理被迫收尾或中断。删除模型委派接口的这个参数，让普通委派沿用用户配置，而不是由模型猜测轮次预算。

## 需求与验收

- 主 Agent 和嵌套 Agent 的 schema 不再暴露 `max_turns`。
- 旧模型参数即使仍包含 `max_turns`，也不能影响新建、恢复、嵌套或模型创建的定时委派；不能通过 schedule 持久化绕过。
- 保留用户全局 `defaultMaxTurns`、agent Markdown 的 `max_turns`，以及可信内部 scheduler/RPC 的上限能力。
- UI、通知与实际执行的有效上限一致。默认配置无限制。
- 新增离线行为测试；相关自然退出测试与完整 `pnpm check` 通过。
- README 和 vendor provenance 同步说明该接口偏离。

用户确认当前没有历史定时任务数据；不做历史迁移或来源标记，只处理新调用边界。已有程序接口文件格式保持不变。

## 范围外

不删除 runner 的计数、软收尾与硬中止机制，不改用户默认配置，不修改其他任务、个人安装或远端分支。

## 执行约束与批准

用户已审阅此前删除参数方案，并于本轮批准开始实施及使用新 worktree；合并目标纠正为 `main`。vendor/Pretty 基线已经提交，隔离分支 `feat/subagent-turn-limit` 从 `main@2803ccc` 创建，目录 `/Users/jyxc-dz-0101322/tools/my-pi-preset-subagent-turn-limit`。原目录已有其他改动须完整保留。任务基础设施仅复制本任务和执行脚本，不复制其他任务状态。
