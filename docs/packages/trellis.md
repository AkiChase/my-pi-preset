# pi-trellis：任务与规范工作流

`pi-trellis` 基于 [Trellis](https://www.npmjs.com/package/@mindfoldhq/trellis) 的任务、规范与工作记录体系，为 Pi 提供项目初始化、任务上下文注入、常驻任务显示和角色派发。安装一次，在需要的项目里单独初始化；项目数据保存在该项目的 `.trellis/` 下。

本包的默认配置面向 Pi 与本预设的组合，部分交互依赖预设中的配套插件，不以跨 Harness 复用为目标。

## 初始化

安装不等于初始化，启动不会自动部署项目资源。

| 命令 | 用途 |
| --- | --- |
| `/trellis-init` | 新建或接管项目运行时、角色、工作流与规范入口 |
| `/trellis-init --check` | 检查当前项目的运行时与资源状态 |
| `/trellis-init --help` | 显示可用参数 |

初始化按提示设置本地开发者身份，不自动选择当前任务、不安装依赖、不提交 Git。接管旧项目可能替换旧运行时和角色定义，确认前先看计划。

## 日常使用

在已初始化的项目中直接描述需求即可，工作流会引导先了解项目和范围，再实施与检查；只读探索不需要创建任务。

| 入口 | 用途 |
| --- | --- |
| `/skill:trellis-start` | 开始开发会话，了解项目、工作区与任务状态 |
| `/skill:trellis-continue` | 继续当前任务，加载对应阶段材料 |
| `/skill:trellis-finish-work` | 工作被接受后，按授权归档任务并记录进度 |
| `/trellis-task-viewer` | 只读浏览任务列表、层级与 PRD、设计、实施文档 |

默认在编辑器上方显示一行任务信息，例如 `▸ trellis(3) · 10-14-example · in_progress · prd ✓ design · impl ·`；没有当前会话任务时仍显示项目未完成任务数。显示与浏览器只负责查看，不会开始或切换任务。

需要子代理时，由主会话使用 `trellis_dispatch` 派发 `trellis-implement`、`trellis-check`、`trellis-research` 三个角色。默认在共享源目录执行；绑定托管 worktree 的任务必须在准备好的目录执行。派发不自动推进阶段、提交或合并代码。

## 环境与配置

- Pi ≥ 1.2.0；初始化与运行时脚本需要本机 Python ≥ 3.10，普通启动不需要。
- 派发角色需要可用的子代理扩展及匹配其工具接口的 pi-trellis 版本。当前 Task Composition 提供 `subagent_run` 和 `task_manage`；若 pi-trellis 仍检测 `Agent`，其角色派发与普通子代理的材料／worktree 门禁不能视为可用，需先完成关联适配并验证。不要靠安装清单中的冲突包 `@tintinweb/pi-subagents` 或注册旧名称绕过这一限制。
- Windows 未验证，建议在 macOS 或 Linux 使用。

| 环境变量 | 用途 |
| --- | --- |
| `TRELLIS_PI_STATUS` | `widget`（默认，编辑器上方）、`status`（页脚）或 `off` |
| `TRELLIS_PYTHON` | 指定 Python 解释器，默认 `python3` |
| `TRELLIS_PI_CONTEXT` | `full` 或 `compact`，覆盖上下文注入默认选择 |

项目工作流、规范与运行配置在 `.trellis/`，角色定义在 `.pi/agents/`，可按项目定制。不要忽略 `.trellis/.pi-trellis.json`，也不要用上游 `trellis update` 替换本包管理的运行时。

## 同步与卸载

清单以 `git:github.com/AkiChase/pi-trellis` 声明，版本为 `latest`，由 Pi 从 GitHub 安装并跟随更新；网络不可达时安装会失败，与清单内容无关。卸载用 `pi remove git:github.com/AkiChase/pi-trellis`（项目级加 `-l`），项目运行时、配置与任务历史不会被删除。

## 上游

- [项目与完整说明](https://github.com/AkiChase/pi-trellis)
- [使用文档索引](https://github.com/AkiChase/pi-trellis/blob/main/docs/index.md)
