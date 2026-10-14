# 原五文档独立审查与修正

普通只读review465c6f7d-f550-4a9完成（236toolcalls，未写文件）。范围仅既有五docs和七spec/任务迁移映射，不覆盖后来九份文档、新README或全量插件语义；原report“新增8份”是旧范围数量，不作为实际覆盖数字。

## 主实际核对并修正
1. monitorMaxLinesPerEvent：monitor-notifications enqueue/flush为每source创建MonitorBuffer；不是整batch总行数。修monitor及composition配置表。
2. session-name配置：readObject拒坏JSON/null/array，saveConfig对fresh合法对象直接合并新有效config，不parse旧field；故合法对象非法字段可menu修复。修文档区分不可解析/非对象与非法字段。
3. @handle model：index1090–1114与mention-clone使用当前model/上下文临时内存会话后台发起，不产生主可见回合；增加明确额外模型请求/费用含义，保direct/off区别。

Review已核范围未确认beautify/path需要修正，spec生命周期/sync/editor/testing有效约束未确认重大遗漏；不等于全部执行引擎或真实兼容验收。

## 修后检查
审计23docs/60links/69context全coverage PASS；git diff --check PASS；packages development/testing。全量独立准确性reviewce2978b2仍进行中，不能预测结论。未producttest/install/terminal/commit/push/archive。
