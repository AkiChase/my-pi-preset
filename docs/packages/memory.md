# pi-memory：跨会话记忆

`pi-memory` 用 Markdown 保存长期偏好、工作记录和待办，让新会话也能找回之前的信息。基础读写无需额外依赖。

## 日常用法

直接告诉助手要保存或查找什么，例如“记住这个项目使用 pnpm”“把今天进展写入日志”“查一下之前为什么选择 PostgreSQL”或“忘掉失效的偏好”。长期决定放长期记忆，阶段进展放日记，未完成事项放待办。可用 `#decision`、`#preference` 和 `[[主题名]]` 帮助搜索。

## 工具

这些是助手调用的工具，不是斜杠命令。

| 工具 | 用途 |
| --- | --- |
| `memory_write` | 写长期记忆或按日期组织的日志 |
| `memory_read` | 读取长期记忆、待办、日志或列出日期 |
| `scratchpad` | 添加、完成、撤销完成、清理或查看待办 |
| `memory_search` | 用 `keyword`、`semantic`、`deep` 搜索 |
| `memory_status` | 查看存储、搜索依赖和索引状态 |
| `memory_forget` | 按文本匹配删除条目，返回恢复 ID |
| `memory_restore` | 用恢复 ID 找回已删除条目 |

删除会匹配包含指定文本的条目，宜使用具体描述。恢复记录仍保留删除内容，“忘掉”不等于彻底擦除。

## 存储与配置

默认 `~/.pi/agent/memory/`：`MEMORY.md` 保存长期记忆，`SCRATCHPAD.md` 保存待办，`daily/` 保存日记，`recovery/` 保存恢复记录。预设无本包专属覆盖，配置通过启动 Pi 时的环境变量提供。

| 环境变量 | 默认值与用途 |
| --- | --- |
| `PI_MEMORY_DIR` | 默认上述目录；建议用绝对路径指定独立目录 |
| `PI_MEMORY_QMD_UPDATE` | `background`；`manual` 或 `off` 关闭自动索引更新与嵌入 |
| `PI_MEMORY_QMD_SEARCH_TIMEOUT_MS` | 显式搜索超时，默认 `60000` 毫秒 |
| `PI_MEMORY_EXIT_SUMMARY` | 默认启用；`0` 关闭退出模型总结 |
| `PI_MEMORY_EXIT_SUMMARY_MODEL` | 默认会话模型；可指定 `provider/model-id` |
| `PI_MEMORY_EXIT_SUMMARY_TIMEOUT_MS` | 退出总结等待上限，默认 `10000` 毫秒 |
| `PI_MEMORY_SUMMARIZE_TRANSITIONS` | 默认关闭；`1` 在切换、重载等操作时也总结 |

记忆会自动加入助手上下文，但不保证包含全部内容或每次更新。核对最新内容时让助手调用读取或搜索工具。

## 可选搜索与隐私

搜索需另装 [qmd](https://github.com/tobi/qmd)，例如 `npm install -g @tobilu/qmd`，本预设不负责安装。没有 qmd 时，读写、待办和删除恢复仍可使用。安装后自动准备 `pi-memory` 集合；语义和深度搜索需嵌入，首次可能下载模型。

默认目录跨项目共享，不按仓库隔离，有隔离需求时使用 `PI_MEMORY_DIR`。文件是本地明文，注入内容会进入当前模型请求，不应保存密钥或敏感个人信息。退出还可能额外请求模型总结，可用 `PI_MEMORY_EXIT_SUMMARY=0` 关闭。

搜索异常先看 `memory_status`；索引未更新或嵌入未就绪时结果可能不完整。

## 上游

- [项目与完整说明](https://github.com/jayzeng/pi-memory)
- [npm 包](https://www.npmjs.com/package/pi-memory)
