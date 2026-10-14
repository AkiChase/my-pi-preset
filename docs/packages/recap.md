# pi-recap：会话回顾

`@tifan/pi-recap` 在编辑器上方显示一句回顾，帮助重新进入会话。内容优先说明原本要做什么，再补当前进展、关键决定或下一步；不是长期记忆或完整工作报告。

## 命令

| 命令 | 用途 |
| --- | --- |
| `/recap` | 重新生成并显示回顾 |
| `/recap status` | 查看所选模型、实际使用模型、新鲜度和可见状态 |
| `/recap config` | 从可用且已认证的文本模型中选择回顾模型 |
| `/recap help` | 显示帮助 |

status 中的 active model 指回顾使用的模型，不一定是主会话模型。本包没有单独的助手工具。回顾适合快速找回方向，重要结论仍需核对原始对话或文件。

## 自动显示

- 助手结束一轮后持续空闲 5 分钟，尝试生成一次自动回顾。
- 恢复会话时复用仍有效的回顾；缺失或过时则尝试重新生成。
- 发送非 `/recap` 消息后隐藏回顾。

不是定期刷新，也不持续读取终端历史。使用当前分支上下文，遵循压缩后的内容；回顾作为会话附加数据保存，不加入主会话的模型上下文。

## 模型与配置

预设未指定 Recap 模型。包默认使用 `openai-codex/gpt-5.6-luna`，不会自动改用当前模型；是否可用取决于本机的模型注册和认证。

推荐通过 `/recap config` 选择已有认证的模型。选定后只使用该模型；`Use default` 恢复包默认模型。

文件默认 `~/.pi/agent/extensions/pi-recap.json`，跟随 `PI_CODING_AGENT_DIR`，手动配置格式：

```json
{ "model": "provider/model-id" }
```

模型必须可用并已认证。手改后重启 Pi，使配置重新载入。该文件在子目录中，不由预设 `files` 域管理。当前没有公开的自动回顾间隔配置。

## 请求成本、隐私与限制

手动生成、空闲自动回顾及恢复时重新生成都会额外请求模型，可能产生费用；当前会话内容会发送给所选服务，不是完全离线。复用仍有效的保存结果无需重新生成。没有会话内容或交互界面时不生成。

模型不可用时先看 `/recap status`，再用 `/recap config` 调整。手动失败显示错误，通常包含返回原因；自动失败可能不显示详情。一句回顾可能遗漏或判断有误，不代替验收，也不自动完成任务。

## 上游

- [项目与完整说明](https://github.com/tifandotme/pi-extensions/tree/master/packages/pi-recap)
- [更新记录](https://github.com/tifandotme/pi-extensions/blob/master/packages/pi-recap/CHANGELOG.md)
- [npm 包](https://www.npmjs.com/package/@tifan/pi-recap)
