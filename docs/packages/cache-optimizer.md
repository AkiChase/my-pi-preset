# pi-cache-optimizer：缓存优化

改善模型服务端的提示缓存利用，并在底栏显示统计。插件会精简部分提示内容、补充适用的缓存参数，并提示代理渠道的兼容配置问题。

缓存由模型服务或代理提供；安装插件不代表每次请求都会命中，也不保证降低费用。代理未返回缓存用量时，统计可能不完整。

## 本预设设置

预设没有覆盖该插件的功能配置或底栏模式，实际行为仍受已有配置和环境变量影响。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `/cache-optimizer` | 打开菜单；没有交互界面时显示帮助 |
| `/cache-optimizer doctor` | 查看当前模型、兼容配置和缓存诊断 |
| `/cache-optimizer compat` | 查看当前模型的配置建议 |
| `/cache-optimizer stats` | 查看当前会话统计 |
| `/cache-optimizer stats all` | 查看当天所有本地会话的统计 |
| `/cache-optimizer enable` | 在当前 Pi 进程启用优化并重置本地统计 |
| `/cache-optimizer disable` | 在当前 Pi 进程停用优化并重置本地统计，停用后仍继续收集统计 |
| `/cache-optimizer reset` | 重置当前模型的本地统计，不清除服务端缓存 |

不确定是否需要调整时先运行 `doctor`，不要直接修改模型配置。`enable`、`disable` 是临时开关，重新加载或重启后恢复启动时的行为。

## 配置入口

持久设置在 agent 目录的 `pi-cache-optimizer-config.json`，通常是 `~/.pi/agent/pi-cache-optimizer-config.json`，跟随 `PI_CODING_AGENT_DIR`。建议通过命令修改：

- `/cache-optimizer config footer-mode session`：当前会话统计，默认模式。
- `/cache-optimizer config footer-mode total`：当天所有本地会话统计。
- `/cache-optimizer config footer-mode process`：当前插件实例当天统计。
- `/cache-optimizer config prompt-rewrite off`：关闭提示内容改写。
- `/cache-optimizer config openai-cache-key off`：关闭缓存键补充。
- `/cache-optimizer config zero-price-warming off`：关闭零价格模型的预热决策覆盖。

持久命令配置优先于对应环境变量。`config reset` 只清除功能覆盖，不清除底栏模式和模型级缓存键设置。统计可由 [统一状态栏](../extensions/status-bar.md) 显示。

## 修复与注意事项

普通请求钩子不会修改 `models.json`，但确认后的 `fix` 和 `rollback` 可能会。`/cache-optimizer fix` 显示目标文件、改动和风险，要求交互确认并创建备份；非交互模式不会写入。改动可能影响同一渠道的其他会话。

`fix prompt-cache` 可写入模型缓存时长；`fix prompt-cache-key` 将禁用规则写入插件配置，后者只适用于 OpenAI-compatible Completions，可能降低缓存命中率。修复或回滚后按提示 `/reload` 或重启；后续配置变化可能使自动回滚被拒绝。

缓存预热由 Pi 本身执行，可能产生请求和费用；模型价格填零不等于服务免费。

## 上游

- [项目与完整说明](https://github.com/jiangge/pi-cache-optimizer)
- [中文说明](https://github.com/jiangge/pi-cache-optimizer/blob/main/README.zh-CN.md)
- [npm 包](https://www.npmjs.com/package/pi-cache-optimizer)
