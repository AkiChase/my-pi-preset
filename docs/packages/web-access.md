# pi-web-access：联网搜索与内容读取

让模型搜索网页、读取链接，并继续检索已保存的结果。也支持 GitHub、PDF、YouTube 和本地视频等来源；部分能力需要额外服务或工具。

直接告诉模型“搜索最新说明”“读取这个链接”即可，无需手动调用工具。

## 本预设设置

预设没有指定搜索服务、API Key、代理或网页审阅工作流。实际可用能力取决于插件配置、可用登录身份和网络条件。

## 常用工具

| 工具 | 用途 |
| --- | --- |
| `web_enable` | 按需启用联网工具，本身不搜索或抓取 |
| `web_search` | 单次或批量搜索，返回来源链接和结果 |
| `fetch_content` | 读取一个或多个链接，默认返回可读内容 |
| `get_search_content` | 用 `responseId` 读取完整结果、分页或查找片段 |
| `source_check` | 收集指定说法的来源及原文片段，供人工核对 |

以下是模型的工具调用参数示意，不是输入框命令：

```javascript
web_search({ queries: ["产品官方安装说明", "产品配置限制"], numResults: 5 })
fetch_content({ url: "https://example.com/guide" })
get_search_content({ responseId: "返回的 ID", urlIndex: 0, findText: "安装" })
```

研究问题可用 2–4 个不同角度的查询；通常省略 `provider`，使用已配置的默认服务。`domainFilter` 可限定域名，前缀 `-` 表示排除；时间过滤支持 `day/week/month/year`。

读取模式有 `readable`、`raw`、`answer`；`answer` 必须带问题 `prompt`，会调用模型。`source_check` 不自动判定真假，网页与模型摘要仍需核对。

## 常用命令

- `/websearch`：打开搜索审阅界面，可附带逗号分隔查询。
- `/search`：浏览当前会话保存的搜索结果。
- `/curator on`、`/curator off`：启用／关闭审阅，写入配置。
- Ctrl+Shift+W：显示／隐藏联网请求活动。

默认 `workflow: "none"`，不额外生成摘要或打开审阅窗口；`summary-review` 打开审阅并生成摘要草稿，`auto-summary` 生成摘要但不打开窗口。

## 配置入口

默认文件为 `~/.pi/agent/web-search.json`，字段均可选。例如显式使用 Brave：

```json
{
  "provider": "brave",
  "braveApiKey": "$BRAVE_API_KEY",
  "workflow": "none",
  "toolActivation": "auto"
}
```

示例需要自行提供环境变量，不是预设默认配置。`PI_CODING_AGENT_DIR` 优先指定目录；设置 `XDG_CONFIG_HOME` 时采用其 Pi 配置目录规则。建议只维护一份配置。

`toolActivation` 支持 `auto`、`dynamic`、`eager`，默认根据模型能力决定是否先提供 `web_enable`。修改工具、命令、键位或启用策略后重启 Pi，并新建会话以使用更新后的工具选择。

用 `proxy` 配置插件请求代理；只设置 `HTTP(S)_PROXY` 不等于配置了插件代理传输。

## 注意事项

搜索、摘要和内容回答可能消耗额度；查询、页面或视频可能发送到相应服务。浏览器 Cookie 读取默认关闭，远程托管抓取需显式开启 `fetchRouting.allowRemoteHostedProviders`。

结果可能截断，需用 `get_search_content` 继续读；缓存会过期，不是永久归档。GitHub 读取可能本地克隆仓库；视频抽帧需要 ffmpeg，YouTube 抽帧还需要 yt-dlp。登录页、反爬页面和受限视频不保证能读，联网工具不代替浏览器操作。

## 上游

- [项目与完整说明](https://github.com/nicobailon/pi-web-access)
- [npm 包](https://www.npmjs.com/package/pi-web-access)
