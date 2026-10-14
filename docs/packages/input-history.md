# pi-input-history：输入历史

在不同 Pi 会话之间找回之前发送的提示词，通过模糊搜索填回编辑器，修改后再次使用。

历史来自 Pi 保存的会话记录。当前实现按工作目录读取历史会话，启动时最多载入 100 条去重提示词；搜索时合并当前会话分支的输入。它不是跨所有项目的全局历史库，也不负责同步到其他设备。

## 本预设设置

预设将搜索键设为 **Alt+R**，不同于上游默认 **Ctrl+R**。清单只声明 `pi-input-history.json` 的 `searchShortcut: "alt+r"`，其他字段保留上游默认值或本机配置。

## 使用方法

在编辑器用 ↑/↓ 浏览历史；按 Alt+R 打开搜索浮层，输入关键词筛选。支持按字符顺序的模糊匹配，也可用空格分隔多个关键词。

| 浮层内按键 | 操作 |
| --- | --- |
| Alt+R / ↑ | 更旧的匹配记录 |
| Ctrl+S / ↓ | 更新的匹配记录 |
| Ctrl+K / Ctrl+J | 向上／向下滚动长记录预览 |
| Enter | 填回编辑器，不直接发送 |
| Esc / Ctrl+G | 取消搜索 |

长记录会换行预览，超出终端高度时可滚动。

## 配置入口

文件在 agent 目录的 `pi-input-history.json`，通常是 `~/.pi/agent/pi-input-history.json`，跟随 `PI_CODING_AGENT_DIR`。默认值结合预设覆盖后是：

```json
{
  "searchShortcut": "alt+r",
  "newerShortcut": "ctrl+s",
  "scrollUpShortcut": "ctrl+k",
  "scrollDownShortcut": "ctrl+j"
}
```

修改后 `/reload`。缺失字段使用上游默认值；配置无法读取或不是有效 JSON 时，回退到全部默认值，包括 Ctrl+R。

## 注意事项

Ctrl+R 可能与 Pi 的会话重命名键冲突，预设改用 Alt+R 避开。自定义键仍可能与其他扩展或终端快捷键重叠。历史依赖本地会话记录，不要将提示词历史当作密码或密钥存储。

## 上游

- [项目与完整说明](https://github.com/ouzhenkun/pi-input-history)
- [npm 包](https://www.npmjs.com/package/pi-input-history)
