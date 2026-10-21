# pi-btw：临时旁支问题

`@narumitw/pi-btw` 用于在当前 Pi 会话中临时提出不应打断主线的旁支问题。

## 安装

本预设已在 `pi-preset.json` 声明该包。运行本仓库的同步命令后，现有同步器会将它安装到用户级 Pi 环境：

```sh
./install.sh --sync packages
```

也可以运行默认的 `./install.sh`。本仓库只维护所需包清单；不会通过项目 `.pi/settings.json` 自动加载该包，也不会在拉取代码时立即安装它。

同步完成后重启 Pi，或按同步输出执行 `/reload`。

## 使用

在 Pi TUI 中输入：

```text
/btw <问题>
```

例如：`/btw 这个 API 的命名通常怎么取？`。它适合临时澄清小问题；回到主线工作时继续在普通输入框发送消息。

## 配置与限制

预设不覆盖 pi-btw 的模型、快捷键或其他插件配置。实际可用能力和配置项取决于安装版本；在非交互模式下不可用时，请改用普通会话提问。

## 上游

- [npm 包](https://www.npmjs.com/package/@narumitw/pi-btw)
