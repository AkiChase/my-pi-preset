# Trellis：初始化

> 草稿：Trellis 尚未作为本预设的内置插件上线，本页描述迁入后的用法。

安装预设只是让 Pi 加载了 Trellis；要在某个项目里使用，还需要初始化一次。初始化需要 Python 3.10 或更高版本。

## 初始化项目

在项目根目录启动 Pi，输入：

```text
/trellis-init
```

命令不带参数，会打开一个菜单：

1. 确认 `Project` 显示的路径是你要初始化的项目。
2. 选择 `Initialize project`。
3. 选择或输入你的名字，它用来区分不同人的工作记录。
4. 查看将要写入的内容，确认。

取消或只看菜单不会写任何文件。完成后按提示 `/reload` 或开新会话，Trellis 的技能才会被加载。

初始化会在项目里写入：

| 位置 | 内容 |
| --- | --- |
| `.trellis/workflow.md` | 工作流程规则，可以按项目需要修改 |
| `.trellis/spec/` | 项目开发规范的入口，之后再按项目实际情况补充 |
| `.trellis/tasks/` | 任务目录 |
| `.trellis/workspace/` | 每个人的工作记录 |
| `.trellis/scripts/` | Trellis 使用的脚本 |
| `.pi/agents/` | 实现、检查、研究三个角色 |
| `.pi/skills/` | Trellis 的技能 |

初始化不会自动分析代码、生成完整规范，也不会开始任何任务。

## 团队成员 clone 项目后

项目已经初始化过时，其他人 clone 下来后执行 `/trellis-init`，选择 `Set up developer identity`，设置自己的名字即可。已有的规范和任务不会改动。

## 更新项目资源

更新预设后，Trellis 的脚本、角色和技能可能有新版本。执行 `/trellis-init` 选择 `Update project resources`，确认后更新。

你改过的 workflow、spec 等文档会保留。被修改过的脚本、角色或技能不会被直接覆盖，会提示冲突，需要你决定如何处理。

菜单里还有两个会覆盖文件的操作，使用前请确认：

- `Apply template`：用默认版本替换 workflow 或 spec，替换前会备份到 `.trellis/.runtime/template-backups/`。
- `Adopt existing project`：接管一个已有 `.trellis/` 但不是用本插件初始化的项目，会直接替换旧脚本和角色，**不备份**。

## 检查问题

Trellis 不可用或行为异常时，执行 `/trellis-init` 选择 `Check`。它只读取不修改，会列出有问题的位置和处理建议。

## 注意

- 从项目根目录启动 Pi。从子目录启动时，Pi 可能找不到项目的技能。
- 项目需要被 Pi 信任，项目技能才会加载。
- 初始化中断后不要删除 `.trellis/` 重来，再次执行 `/trellis-init`，按菜单提示重试即可。
