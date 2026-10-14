# 全插件覆盖与README去重阶段

用户明确提出docs应该覆盖所有preset插件、README只每插件一句话+链接并批准实施。已更新PRD/design/implement及development文档约束，保no-commit/install/push/archive。

## 实际范围与执行
当前pi-preset.json有6个第三方包，本地7顶层入口；Monitor归composition另页，既有5文档，补3本地+6第三方共9份。全部来源取实际manifest，非旧README表。

普通Agent仅只读研究并返回完整markdown草稿，不改文件或执行绑定，主会话负责整合：
- dd07b525-371f-48f：status-bar/sse-normalize/blocked-signal；当前源码。
- 9f022d18-5c59-4cc：cache/history/web；既有安装包代码，不读个人配置。
- 16602301-a6f3-470：memory/question/recap；既有安装包代码，不读记忆/凭证。

旧独立review465c6f7d仍进行中，已steer尽快结束原5docs/spec检查，不扫将废弃README，不假称覆盖未生成9份。无需额外workflow，用户未授权多agent workflow orchestration。

README已完整重写从628行减至116行，插件区纯一句话+链接；详细配置表/旧内部安全手册/历史验证不重复。保简介/安装/本地检出/常用同步和清单维护语义。docs/index覆盖全插件导航，不按内部后端拆重复文档。

## 中间检查
- git diff --check PASS；audit Python AST/task JSON PASS。
- audit中间FAIL：14docs58links69contexts，27issue全是9个待写文档在README/index/coverage各一次，尚未整合，不称链接通过。
- audit新增当前顶层入口及manifest第三方覆盖检查，新入口/来源未映射会失败，避免以后漏插件。

全部草稿返回并写入后统一核当前源码/版本/config/commands，复跑全links/coverage并完成独立review；不以旧README或latest标签当版本证据。
