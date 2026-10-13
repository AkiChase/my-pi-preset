# beautify 验证边界

## 环境与命令

2026-10-14 实测 Node 24.14.1、Pi SDK 1.2.0。使用已安装 SDK 的 node_modules，设置临时 `PI_CODING_AGENT_DIR`；不读个人配置、不执行真实 install/sync/reload、不调用模型或网络。

```sh
agent_dir="$(mktemp -d)"
PI_SDK_DIR=/path/to/installed/pi/node_modules PI_CODING_AGENT_DIR="$agent_dir" pnpm check
PI_SDK_DIR=/path/to/installed/pi/node_modules PI_CODING_AGENT_DIR="$agent_dir" \
  node --test extensions/beautify/__tests__/*.test.ts \
  extensions/task-ui/__tests__/editor.test.ts \
  extensions/agent-tasks/__tests__/loading.test.ts scripts/pi-manifest.test.mjs scripts/sync.test.mjs
rm -rf "$agent_dir"
```

`pnpm check` 自带全量 force-exit，不能替代上述定向自然退出；本轮另运行完整 `node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"`，覆盖三模块并验证自然退出。

## 实际执行路径

- renderer-host 使用 actual loader/ExtensionRunner.resolveToolRenderers/ToolExecutionComponent，而非复制 resolver；检查只注册 renderer、其他工具 next、六类 expanded/collapsed 和 outputPad/宽度矩阵；原四类 pending/success/error SGR、行尾填充、单行有效文字、同轮 call→result→render 与实际 MouseRegion 点击另由 shell-collapse 覆盖。
- retrieval.test 验证可选 absence/dynamic/history/同名异形、details 非空、头部与正文 spoof、字段省略、无 original 的10行通用预览与展开；original state/lastComponent 隔离、default/self shell、已知→未知同轮切换与鼠标／当前 alt+o 提示。只有原 self renderer 兼容分支使用 public Box，常规适配直接宿主 default Box。独立 check 新增 default/self 的实际鼠标命中矩阵：padding 不改变展开，正文头尾可点；检查 pending/success/error 的上下空白及行尾背景一致。partial→final 用原 callback 计数证明 renderCall 不按缓存 partial 触发错误委托，已知→未知→已知仍保原 state/两槽 lastComponent。
- 独立 check 覆盖空／多行 description、unsafe terminal 合计、throwing original 与无 original 的有界参数预览／原文分行展开，以及 actual SDK runToolCall 的 details={} 错误信封；错误走安全委托，不放宽 text-only/details undefined guard。
- 实际注册 jobs（processActivation + registerJobsTool）生成六 action 信封，包括自有进程 attach partial→detach→kill，断言解除等待仍 running；真实注册 get_result（actual agent factory + typed offline runner）生成 running/completed/verbose/not found/released/cancelled，断言无额外结果改写。夹具在临时 config/log/cwd；测试显式 execute 才消费，renderer 不访问后端。
- 实际 Read definition.execute 使用公开 ReadOperations seam，检查参数／execute／guidelines／content／details／structuredContent 保留、只读一次；实际 host imageComponents 检查图片由宿主绘制一次。
- codeToANSI 使用真实 Shiki one-dark-pro；cache/异步竞态的高成本等待用局部 typed Colorize seam，仍运行真实 Highlighter 与 ReadDrawing。覆盖未知／超限／失败一次诊断、LRU 项数／字符预算、内容／宽度／折叠／关闭竞态和宿主 invalidate 的 ANSI 持续显示。
- editor harness 调用 actual InteractiveMode setter/reset、CustomEditor/TuiMainScreen；history 为独立 fixture，验证两个历史顺序、两个 Down 顺序及禁用 Down、cold/new/reload、搜索接受／取消、同实例 cursor/undo/history draft/paste/autocomplete/IME marker 与 callbacks/actions。
- unsupported descriptor、partial host mount/focus 失败检查实际容器／focus／可继续输入；后来的 padding/factory/opaque wrapper 保留；独立 `--expose-gc` 子进程确认 appearance/factory 不保留旧 ctx/TUI，原 Down GC 回归继续执行。
- 独立审查补回旧 editor 安全矩阵中的 later getter/setter/physical-padding 所有权、padding 写后抛错、handoff 中途 descriptor 失败、重复 captured factory 的单一活跃装饰、Alt+R older/newer/branch priority、later border wrapper/nondelegating render。新增非有限 padding 与物理 padding 接管不吃原文缩进的回归。
- notice 精确匹配 SDK 1.2.0 的数字/size/续读或组合 search 限制格式，保留文件尾空行；未知或嵌入代码中的同形文本不剥离。工具折叠标题把物理换行显式显示为 `\\n`，展开仍提供原文分行。

## 定向终端修复复验

用户授权后的 tmux targeted 证据见本 task [terminal-fix-report](../../.trellis/tasks/10-13-beautify-tool-shell-collapse/research/terminal-fix-report.md)。`terminal-layout.test.ts` 新增逐打印cell的 terminal-effective SGR背景回归：纯文本标题head/metadata被SDK截断后不得reset宿主背景，长Bash/Read ENOENT与右侧padding先3项行为红后绿。新增actual TuiAltScreen最新emitted frame检查140→80→40→140 hint完整或整项省略、展开/收回；不只调用summary或查有无48m。

真实tmux本轮仅Read、长Bash、Read error三种调用，dark/fullscreen；40列等待CLI实际发出完整新宽度frame，再发送真实Ctrl+O。旧driver仅等tmux裁短border造成残缺hint，raw写流证明CLI尚未重绘，不改产品预算迁就夹具。长标题和metadata纯文本截断后移除SDK自动reset，再交现有fg及host Box各自着色；不改通用highlight clip或SDK。完整命令、红绿/9项targeted PASS/cleanup和其他NOT_RUN见报告。

## 不声称覆盖

除上述有界dark/fullscreen真实CLI复验外，未运行真实 input-history 包、light/system/regular模式或任意第三方 editor。未知 nondelegating render 保留其原内容，不保证能加提示符。SDK 1.2.0 在一列正文中放双宽中文会递归溢出，极窄聚焦光标可能超宽；测试有原生对照，本任务不修宿主。宿主工具点击已自动测试；先前真实fullscreen SGR stdin证据另列task research，未声称物理鼠标/attached-client链路；没有额外选区／剪贴板功能或原文复制保证。

## 本轮红／绿证据

先加入 shell-collapse 的9个实际宿主行为测试，在原实现运行 `node --test extensions/beautify/__tests__/shell-collapse.test.ts`：0 pass / 9 fail（缺背景4、双行／多行4、错误／关键词铺全文1），之后才改生产实现。实现阶段定向136/136、完整601/601；独立 check 修复后最终定向自然退出141/141、`pnpm check` strict typecheck +606/606、完整 natural exit 606/606（5项新增回归），均按 testing-guidelines 用临时 agent 目录隔离。独立 check 第一轮 strict 发现新增 fixture 漏 ToolCall.type，已修复并全命令重跑；不能把 fixture 错误作为产品红证据。hard loader 仅将旧 Bash self 外壳期望改为 default，根／子 guard 与 shutdown 断言保留。

Pi 1.2 Box 对极窄 width 固定 `contentWidth=max(1,width-2*outputPad)`，原生可超出物理 width；测试按真实最小 Box 宽界限记录，正常宽度断言精确 width，不将本任务说成修宿主极窄 Box。
