# 阶段 2/3 定向测试准备

阶段 1 提交后扩展同一实际 factory fixture，不新增通知执行器或 outbox。

## 阶段 2

- host sendMessage 可注入同步抛错或同步 resume，appendEntry spy 仅断言未新增诊断 entry（已有 subagents:record 保留）。
- 构造错误使用 live record 的 result getter 注入，而非测试复制 formatter。
- 有 UI 简短 warning；无 UI 简短安全日志（不输出任意异常对象/内容）。warning/log 抛错不会阻断兄弟完成或 cleanup。
- failed send 不 consume/不 delivered；结果工具仍返回原结果，无自动重试。
- sendMessage 同步调用实际 Agent resume：旧 run 发完后不能标新 run delivered，新 run 完成正常通知。
- shutdown during send/提示不写新 activation；现有等待/消费回归保持。

## 阶段 3

- 非合作 runner abort 后 promise 保持 pending，source stop立即公开 stopped；自然完成兄弟200ms hold之后通知，不等待30s。
- stopped在100ms batch形成之前/之后分别覆盖；late runner completion无重复通知；两者都stopped无通知。
- 真正running成员仍partial；mock timer仅调整30s窗口或使用node mock timers，不修改生产timeout。
- group post-send持原run快照保护，包含同步resume重入。

测试只注入昂贵runner/host边界，实际manager/factory/group/waits执行；不调用在线模型或安装。
