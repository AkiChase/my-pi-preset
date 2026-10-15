# 来源与维护范围

旧功能来自 [pi-session-name](https://github.com/ttttmr/pi-session-name)，本机排查版本为 npm 0.1.7。旧插件仅使用第一条输入、固定关闭思考，并写终端忙闲标题；本实现按本任务需求重新编写，未复制其实现代码或提示词。

本仓库独立维护：完整有效文字上下文、当前模型与思考等级、N 轮自动评估、手动刷新、全局配置、会话标题保护及请求取消。共享请求与上下文 helper 位于 `../shared/`，仅为 Session Name 和后续 Recap 复用公开 SDK 能力；本任务不实施 Recap。

实际 SDK 基线为 Pi 1.2.0 的公共 extension/model/session API。不修改或发布 SDK 副本，不导入安装路径，不自行 HTTP/认证，不复制旧包 provider header patch。

标题由 Pi 原生 `setSessionName` 保存，终端标题交宿主管理，不保留旧包的特殊忙闲符号。冲突声明负责移除 standalone `npm:pi-session-name`；现有历史标题保守保护，不清空个人状态。
