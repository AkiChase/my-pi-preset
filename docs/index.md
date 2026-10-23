# 使用文档

本目录包含预设同步说明及全部插件的用法、命令、配置和限制。安装与更新见 [README](../README.md)。详细说明只维护在对应页面，不在 README 重复。

## 预设

- [同步范围与受管理配置](preset.md)

## 本仓库自带

- [Session Name](extensions/session-name.md)
- [Recap](extensions/recap.md)
- [Task Composition：任务管理与共享面板](extensions/task-composition.md)
  - [命令进程](extensions/task-composition.md#命令进程)
  - [Monitor：持续监听命令或 WebSocket](extensions/monitor.md)
  - [子 Agent 与 workflow](extensions/task-composition.md#子-agent-与-workflow)
  - [后台任务提醒](extensions/task-composition.md#后台任务提醒)
- [Beautify](extensions/beautify.md)
- [At Path Completion](extensions/at-path-completion.md)
- [Status Bar](extensions/status-bar.md)
- [SSE Normalize](extensions/sse-normalize.md)
- [Herdr State：向 Herdr 上报 Pi 状态](extensions/herdr-state.md)
- [Trellis：项目任务与工作流](extensions/trellis.md)
- [Memory：项目记忆](extensions/memory.md)

Monitor 是 Task Composition 的功能单页；内部 Agent、进程、Task UI 不分别建立重复页面。

## 第三方插件

- [pi-cache-optimizer](packages/cache-optimizer.md)
- [pi-input-history](packages/input-history.md)
- [pi-web-access](packages/web-access.md)
- [rpiv-ask-user-question](packages/ask-user-question.md)

第三方来源由当前 [包清单](../pi-preset.json) 决定；清单使用 `latest`，不同机器的安装版本可能不同。各页面只介绍本预设相关用法，完整功能以安装版本及上游说明为准。
