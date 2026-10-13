# 独立复核结果

审查代理通过独立 CLI trellis-check 执行全范围审查，但其 profile 为只读，未修改生产代码。报告记录在此，避免只留对话。

## 已确认问题

1. manager 在 admission 解析上限为 7，runner 却仍接收原 options.maxTurns（undefined）并在异步 bind 后重读为 9。真实 manager+runner 探针复现 record/invocation=7、实际软限额=9。必须冻结每 run 有效值，并显式区分无限制与未指定，覆盖异步 bind 期间配置变化。
2. 旧 schedule JSON 没有来源标记，历史模型写入预算与用户/内部写入预算无法区分。新模型 schedule 已不再写预算；旧计划仍生效。不能无差别删除用户预算，也不能用 README 自行缩小 PRD。需要用户确认兼容例外或选择非破坏性迁移。

## 复核验证

- 507/507 自然退出（agent/task-ui/process/Pretty）。
- strict typecheck + pnpm check 529/529。
- 独立探针 1/1 确认缺陷存在，不计修复通过。
- git diff --check 通过。

## 下一步

未达到完成条件。主会话先确认历史 schedule 兼容决策，再派发实现代理修复 per-run 上限冻结并补真实 runner 回归，之后重新独立审查。尚未提交、合并或安装。
