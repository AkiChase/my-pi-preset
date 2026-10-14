# rpiv-ask-user-question：结构化问答

`@juicesharp/rpiv-ask-user-question` 让助手在需要你决定时展示问卷，而不是自行猜测，默认无需配置。

## 日常用法

可以明确要求“给 API 客户端加缓存，方案和失效策略先用问卷确认”。助手调用 `ask_user_question` 后显示问题、选项及说明。每次包含 1–4 个问题，每题 2–4 个选项，支持单选或多选；单选可带代码、配置或布局预览。

每题都有 `Type something.`，可输入自定义答案，多选也能同时提交已选项和自定义文本。

## 操作

| 默认按键 | 用途 |
| --- | --- |
| `↑` / `↓` | 移动选项 |
| `Enter` | 确认单选；多选时切换当前选项 |
| `Space` | 切换多选项；文本输入中输入空格 |
| `Tab` / `Shift+Tab` | 多问题间切换标签页 |
| `Shift+Enter` | 自定义答案或备注换行 |
| `Ctrl+G` | 用 Pi 配置的外部编辑器编辑答案 |
| `Ctrl+U` | 清空答案草稿 |
| `n` | 添加本题备注；Submit 页添加全局备注 |
| `Ctrl+]` | 收起／展开问卷，保留答案 |
| `Esc` | 取消问卷；备注编辑器内关闭备注编辑 |

多选题用 `Next` 确认，多问题问卷在 Submit 页检查并提交。备注不自动将问题标记为已回答。问卷打开时仍可用 PageUp/PageDown 阅读对话，鼠标效果取决于终端；实际操作遵循 Pi 相关键位设置。

## 工具与配置

提供 `ask_user_question` 工具，没有启动问卷的斜杠命令。是否调用由助手根据任务判断。

预设没有覆盖本包配置，但已禁用 Pi 内置 `tui.editor.jumpForward`，避免与默认 Ctrl+] 折叠键冲突。可选配置是 `~/.config/rpiv-ask-user-question/config.json`，例如：

```json
{ "collapseKey": "alt+o" }
```

`collapseKey: "off"` 禁用收起键。`guidance.description`、`guidance.promptSnippet`、`guidance.promptGuidelines` 替换给模型的工具说明及建议，下一次 Pi 启动生效。

有效 `XDG_CONFIG_HOME` 可改变配置目录。本包只读配置，不自动创建；坏 JSON 会警告并回退默认。

## 限制与隐私

需要交互终端或支持相关原生对话框的 RPC/ACP 客户端。非交互模式不向模型开放工具；RPC/ACP 不提供终端备注。预览只支持单选，区域不足 100 列时改为上下排列。

本包不额外请求模型，但答案和备注会返回助手进入会话上下文。无额外 API Key 要求；界面汉化依赖可选 `@juicesharp/rpiv-i18n`，预设未声明它。界面加载失败可先用普通文字回答，再按提示修复安装并重启。

## 上游

- [项目与完整说明](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)
- [键盘操作](https://github.com/juicesharp/rpiv-mono/blob/main/packages/rpiv-ask-user-question/docs/keyboard.md)
- [配置说明](https://github.com/juicesharp/rpiv-mono/blob/main/packages/rpiv-ask-user-question/docs/configuration.md)
