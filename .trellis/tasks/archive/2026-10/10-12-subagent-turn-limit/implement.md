# 实施计划

1. 读 implement.jsonl 与 PRD，复核 index/nested-tools → invocation-config → manager/runner，及 schedule 持久化、resume 活动显示。
2. 先新增实际工具/解析离线回归并验证旧实现失败，再移除两处 schema 与模型参数解析；不改变可信程序入口。尽量复用现有 fixture。
3. 更新旧测试中依赖模型设置上限的部分，改为用户配置或内部上限；保留原轮次/通知/生命周期断言。
4. 同步 README、PROVENANCE；复核 schema 之外工具描述不得指导模型传参。agent 文件教程仍保留 `max_turns`。
5. 以真实 SDK 只读路径和临时 PI_CODING_AGENT_DIR 运行相关测试（无 force-exit），再运行完整 pnpm check 与 git diff --check。记录红绿证据及实际结果。
6. 主会话派发独立 trellis-check，不允许子代理递归派发或自行 commit/merge/start/finish/archive。
7. 主会话更新规范，在提交前列出仅本任务文件的提交计划；得到一次确认后提交，再合回 main，原目录其他改动不动。

任务为局部接口变更，不另建 design.md。已批准方案：schema 删除 + 忽略旧模型参数，用户/内部限制保留。若发现必须改变用户配置或恢复语义，先报告，不擅自扩展。
