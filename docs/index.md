# 插件使用文档

本目录覆盖当前预设的全部插件，说明功能、用法、命令、快捷键、配置和使用限制。安装、更新及清单同步见 [README](../README.md)。详细说明只维护在对应页面，不在 README 重复。

## 本仓库自带

- [Session Name](extensions/session-name.md)
- [Task Composition：任务管理与共享面板](extensions/task-composition.md)
- [Monitor](extensions/monitor.md)
- [Beautify](extensions/beautify.md)
- [At Path Completion](extensions/at-path-completion.md)
- [Status Bar](extensions/status-bar.md)
- [SSE Normalize](extensions/sse-normalize.md)
- [Blocked Signal](extensions/blocked-signal.md)

Monitor 是 Task Composition 的功能单页；内部 Agent、进程、Task UI 不分别建立重复页面。

## 第三方插件

- [pi-cache-optimizer](packages/cache-optimizer.md)
- [pi-input-history](packages/input-history.md)
- [pi-web-access](packages/web-access.md)
- [pi-memory](packages/memory.md)
- [rpiv-ask-user-question](packages/ask-user-question.md)
- [pi-recap](packages/recap.md)
- [pi-trellis](packages/trellis.md)

第三方来源由当前 [包清单](../pi-preset.json) 决定；清单使用 `latest`，不同机器的安装版本可能不同。各页面只介绍本预设相关用法，完整功能以安装版本及上游说明为准。
