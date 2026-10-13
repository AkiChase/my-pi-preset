# beautify 验证边界

## 环境与命令

2026-10-13 实测 Node 24.14.1、Pi SDK 1.2.0。使用已安装 SDK 的 node_modules，设置临时 `PI_CODING_AGENT_DIR`；不读个人配置、不执行真实 install/sync/reload、不调用模型或网络。

```sh
agent_dir="$(mktemp -d)"
PI_SDK_DIR=/path/to/installed/pi/node_modules PI_CODING_AGENT_DIR="$agent_dir" pnpm check
PI_SDK_DIR=/path/to/installed/pi/node_modules PI_CODING_AGENT_DIR="$agent_dir" \
  node --test extensions/beautify/__tests__/*.test.ts \
  extensions/task-ui/__tests__/editor.test.ts \
  extensions/agent-tasks/__tests__/loading.test.ts scripts/pi-manifest.test.mjs scripts/sync.test.mjs
rm -rf "$agent_dir"
```

`pnpm check` 自带全量 force-exit，不能替代上述定向自然退出；完整后端自然退出另跑 task-ui/process-tasks/agent-tasks 三模块测试。

## 实际执行路径

- renderer-host 使用 actual loader/ExtensionRunner.resolveToolRenderers/ToolExecutionComponent，而非复制 resolver；检查只注册 renderer、其他工具 next、四类 expanded/collapsed 和 outputPad/宽度矩阵。
- 实际 Read definition.execute 使用公开 ReadOperations seam，检查参数／execute／guidelines／content／details／structuredContent 保留、只读一次；实际 host imageComponents 检查图片由宿主绘制一次。
- codeToANSI 使用真实 Shiki one-dark-pro；cache/异步竞态的高成本等待用局部 typed Colorize seam，仍运行真实 Highlighter 与 ReadDrawing。覆盖未知／超限／失败一次诊断、LRU 项数／字符预算、内容／宽度／折叠／关闭竞态和宿主 invalidate 的 ANSI 持续显示。
- editor harness 调用 actual InteractiveMode setter/reset、CustomEditor/TuiMainScreen；history 为独立 fixture，验证两个历史顺序、两个 Down 顺序及禁用 Down、cold/new/reload、搜索接受／取消、同实例 cursor/undo/history draft/paste/autocomplete/IME marker 与 callbacks/actions。
- unsupported descriptor、partial host mount/focus 失败检查实际容器／focus／可继续输入；后来的 padding/factory/opaque wrapper 保留；独立 `--expose-gc` 子进程确认 appearance/factory 不保留旧 ctx/TUI，原 Down GC 回归继续执行。
- 独立审查补回旧 editor 安全矩阵中的 later getter/setter/physical-padding 所有权、padding 写后抛错、handoff 中途 descriptor 失败、重复 captured factory 的单一活跃装饰、Alt+R older/newer/branch priority、later border wrapper/nondelegating render。新增非有限 padding 与物理 padding 接管不吃原文缩进的回归。
- notice 精确匹配 SDK 1.2.0 的数字/size/续读或组合 search 限制格式，保留文件尾空行；未知或嵌入代码中的同形文本不剥离。工具折叠标题把物理换行显式显示为 `\\n`，展开仍提供原文分行。

## 不声称覆盖

未运行真实 CLI/PTY、实际 input-history 包、fullscreen 或任意第三方 editor。未知 nondelegating render 保留其原内容，不保证能加提示符。SDK 1.2.0 在一列正文中放双宽中文会递归溢出，极窄聚焦光标可能超宽；测试有原生对照，本任务不修宿主。没有鼠标／选区／剪贴板功能或原文复制保证。
