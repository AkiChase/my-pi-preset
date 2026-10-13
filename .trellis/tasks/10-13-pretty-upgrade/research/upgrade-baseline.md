# 初步升级证据

- npm view 验证 latest=0.7.0；当前 package.json ^0.6.31 与 lockfile/installed 0.6.31 不会跨 minor 自动升级。
- 通过 npm 配置镜像下载 0.7.0 tarball到 /tmp/pi-pretty-compare.d6nclz/package，仅作只读比较，未安装。
- 两版 src/tools/bash.ts 完全一致。早期宣传截图可见 version=0.1.4；当前 $ command / lines · duration 为已生效的默认 Pretty。
- 0.7.0 CHANGELOG 新增 opt-in toolStyle=claudecode：紧凑状态/摘要、连续调用分组、外部 edit/write renderer 委托，输入框风格也变化。
- 新入口根据 config.toolStyle 调用 installClaudeChatGrouping 和 installClaudeExternalToolRenderers；createPromptEditorClass 调用也变化。需核对本地 pretty-compat 的 RenderBridge 是否传递新风格参数，不能仅升级后假设完整生效。
- 用户指定同时升级并启用 claudecode，保留 one-dark-pro。本机 pi-pretty.json 已有 theme=one-dark-pro；不自动更新个人配置。
- 优先验证 extensions/bash-unified.ts、extensions/pretty-compat/editor.ts、对应 editor.test.ts、task-ui editor/loader 回归与 scripts/sync.test.mjs。
