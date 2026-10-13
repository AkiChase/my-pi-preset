# Pi 输入框鼠标片段语义选择与复制：只读可行性研究

## 0. 范围、结论与证据口径

本研究只回答：**鼠标在输入框中拖选任意连续片段，复制该片段对应的编辑器原文，排除边框、提示符、渲染补齐空格，保留真实换行而不加入自动折行**。

不把“一键复制全部”“去掉边框后继续使用屏幕选择”作为替代方案。没有修改产品代码、配置、依赖或宿主，没有启动任务实施，没有操作真实系统剪贴板。唯一持久写入为本文件。任务仍为 planning。

### 结论

1. **当前 Pi 1.2.0 原生行为不满足要求。** 普通模式是终端原生选择；全屏模式是 Pi 的屏幕单元格选择。二者都没有输入框源文本选区语义。全屏复制明确按屏幕行拼接换行、对每行 `trimEnd()`，会丢失真实行尾空格并保留软折行。
2. **全屏模式的“扩展自有鼠标选区 + 原文片段复制”可实现，不必修改宿主才有鼠标事件或剪贴板能力。** `handleMouse`、`handled/capture/focus/render`、`getText/getLines/getCursor`、自定义渲染、`copyToClipboard` 都存在公开接缝。命令级实验已确认扩展组件可以消费完整拖选序列，拖出输入框后继续收到事件，且阻止屏幕级复制。
3. **但“在现有 Editor / input-history 活实例上，所有布局与长文本场景都精确可靠”的最小实现不是纯公开 API 拼装。** 精确视觉映射、paste-marker 原子分段、输入滚动与宿主裁剪存在内部状态；鼠标 capture 保存旧坐标变换；失焦不通知组件取消。受控实现可依赖 Pi 1.2.0 内部布局状态做成，但须版本检查、限定支持条件及测试，不能称为跨版本、任意终端完全可靠。
4. **普通模式在现有公开集成合同下不能实现相同的任意拖选语义。** Pi 不启用/派发鼠标，终端选择区及本地复制快捷键不会通知应用；应用没有区间信息，事后无法把屏幕字符串逆推回唯一原文。强行启用 SGR 鼠标、自建普通屏幕布局/scrollback 协议，或依赖终端专有接口属于额外宿主/终端级改造，不是本次可承诺的轻量扩展能力。
5. **“原文”应定义为当前编辑器逻辑文本，不是最初粘贴字节。** Editor 已把 CRLF/CR 转成 LF、Tab 转成四个空格，并清洗粘贴控制字符；这些原始字节已不可恢复。隐藏大粘贴内容也不能在未显示状态下用鼠标选到其中任意内部片段。

**决策建议：可以规划一个明确限定为全屏、版本受控的语义选区能力；不能在当前任务中承诺普通/全屏通用、所有大粘贴内容可任意选取。** 本结论是技术可行性，不是实施授权，也不是建议用被排除的替代方案降级交付。

### 路径简写

以下行号均来自本机实际安装文件，不来自 Claude Code 观感或对其实现的推测。

- `HOST` = `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works`
- `TUI` = `HOST/pi-tui/dist`
- `CA` = `HOST/pi-coding-agent/dist`
- `DOC` = `HOST/pi-coding-agent/docs`
- `ROOT` = `/Users/jyxc-dz-0101322/tools/my-pi-preset`
- `PRETTY` = `ROOT/node_modules/.pnpm/@heyhuynhgiabuu+pi-pretty@0.7.0/node_modules/@heyhuynhgiabuu/pi-pretty/src`
- `HISTORY` = `/Users/jyxc-dz-0101322/.pi/agent/npm/node_modules/pi-input-history`

已完整阅读 `DOC/tui.md`、`DOC/extensions.md`；另外完整阅读 `DOC/terminal-setup.md`、`DOC/tmux.md`、`DOC/keybindings.md`、`HOST/pi-tui/README.md` 及相关 editor/mouse 声明、公开 modal-editor 示例。安装版为 Pi / pi-tui 1.2.0，Pretty 0.7.0，input-history 1.1.3。

## 1. 当前选择与复制链路

### 1.1 Editor 不是文本选区控件

- `TUI/components/editor.js:487-504`：补全区域先委托 `SelectList.handleMouse`。
- `:505-510`：明确将 press/drag/release 放行给 renderer，只处理主键 click。
- `:513-545`：click 使用 `buildVisualLineMap(lastWidth)`、`scrollOffset`、原文 grapheme 与终端列宽来定位光标；最后修改光标、退出历史浏览。
- `:592-595`：`tui.input.copy` 不执行选区复制。`CA/modes/interactive/components/custom-editor.js:60-116` 还会优先处理应用/扩展快捷键；因此文档列有 `tui.input.copy` 并不证明 Editor 已有语义选区。
- `TUI/components/editor.d.ts:34-70,96-129`：state、lastWidth、可见行数、scrollOffset、pastes、segment、layoutText 等是 private；公开有 render/handleMouse、getText/getExpandedText/getLines/getCursor，protected 有 border hooks。没有公开 `getSelection`、`setSelection`、`hitTestText`、`getVisualRows`、`setScrollOffset`、`setCursor`。

### 1.2 全屏默认选择复制的是屏幕，不是输入数据

- `TUI/tui-alt-screen.js:15-18,183-196`：进入 alt screen 时关闭终端自动折行，开启 SGR 鼠标及 button/all motion、focus reporting；multiplexer 下选 button-motion。
- `:475-523`：全屏内建 input listener 解析 wheel/SGR mouse，并 consume。
- `:1088-1168`：未被组件消费的主键 press/drag/release 建立屏幕选区；release 默认自动复制；无移动才合成 click。
- `:924-964`：屏幕点来源是 `previousScreen`；ScrollView 内是 scrollContentLines；输入 dock 不属于 transcript ScrollView。
- `:1198-1218`：每个选中的屏幕行通过 `sliceByColumn`、`stripTerminalSequences`、`trimEnd()` 取内容，再 `join("\n")`。没有 logicalLine、hard/soft break 标记，也没有“此空格属于编辑器数据还是补齐”标记。
- `:1172-1196`：默认区间会向完整 grapheme cell 范围扩展，但这是屏幕文本分段，不是源文本索引映射。
- `CA/modes/interactive/tui-renderer.js:10-30`：宿主注入 copySelection，实际调用公开 `copyToClipboard`。

所以**不能只 patch 一个字符串清洗步骤**：屏幕字符串中“真实换行 vs 软折行”“源空格 vs 补齐空格”已经丢失可区分信息。跨行再删除全部换行会误删真实换行；每行 trim 会误删真实空格；按字符过滤 `│`/`❯` 会误删用户自己输入的同形字符。

### 1.3 普通模式

- `DOC/tui.md` 的 Handle mouse input、`HOST/pi-tui/README.md:272-320`：普通模式由终端拥有鼠标/scrollback，规范化鼠标派发只在全屏。
- `TUI/tui-main-screen.js:239-265`：完整输出将 render 行用 CRLF 分隔；`:417` 后差量输出又定位、清行。Editor 已自行 word-wrap，所以软折行已成为单独的物理输出行。
- `TUI/tui.js:687-768`：普通输入链只经 raw listeners 和 focused `handleInput`，不会 hit-test 并调用组件 handleMouse。

终端本地 Cmd+C / copy menu 以及 native drag selection 不给扩展发送选区坐标。即使应用能读剪贴板，读到的屏幕片段也不保证原文唯一：重复文字、真正的换行、不同位置的空格可以产生同一屏幕片段。不能通过搜索这个片段稳定求得原区间。

**低层接口允许发送鼠标协议，不等于普通模式提供可靠的语义选择合同**：`terminal.write` 确实允许发送控制序列、raw listener 确实可 consume；但普通 renderer 没有 mouse layout 派发，且用户滚终端历史后应用不知道其 native scrollback 偏移，流式输出会移动 input dock。还需管理终端鼠标开关、suspend/reload/退出、其他组件滚轮/链接/原生选择。不存在跨所有终端的“只接管输入框矩形、矩形外完全原生”标准协议。本研究不推荐也不实现这种扩展级全局接管。

## 2. 全屏扩展可接管哪些事件

### 2.1 公开接口确实足够接管完整手势

- `TUI/tui.d.ts:6-55` 定义 local/screen 坐标、bounds、button/modifiers；`handled` 阻止 fallback，`capture` 将后续 drag/release 路由到组件。
- `TUI/tui.js:13-46`：dispatch 将消费结果转换为实际 target；记录 originX/Y、width/height；retarget 用 screen 坐标减 target origin。
- `TUI/tui-alt-screen.js:634-672,697-758`：先派发 overlay / layout，handled press 清屏幕选区并记住 target；capture 或 pressTarget 路径优先于屏幕选择，release 后清手势。即使后续事件跑到控件矩形外，也继续派发该 target，local y 可以为负或大于 height。

最小状态机：在有效输入正文主键 press 建立原文 anchor，返回 `{ capture: true, focus: true }`；drag 更新原文 focus 并要求 render；release 复制当前语义片段（非空且确实拖动），返回 handled 并更新高亮。无拖动 click 保持原 Editor 光标行为。补全列表、非主键、边框起点等未拥有事件委托原 handler，不能让提示文本成为源选区。

**capture 是应用层事件路由，不是 OS pointer capture。** 指针离开终端窗口/丢失 release 时不保证继续报告；SGR 的单元格坐标不能选择半个 grapheme，这种“任意片段”应以完整 grapheme 边界定义。

### 2.2 raw input listener 不可用于抢在全屏 renderer 前截获鼠标

- `TUI/tui-alt-screen.js:105`：构造时内建 listener 先加入。
- `TUI/tui.js:581-589,694-708`：Set 按加入顺序调用，consume 立即返回。
- `CA/modes/interactive/interactive-mode.js:2017-2028,2059`：`ctx.ui.onTerminalInput` 只是后加 `ui.addInputListener`，模式切换时重新绑定。

因此全屏下后注册 raw listener 看不到已 consume 的 SGR mouse、focus-in/out；公开消费点应是 `handleMouse`。重新排序 listener、替换内建 handler、patch `getActiveSelectionText` 等都属于内部 hook，不应混称公开 raw-input 可做。

### 2.3 capture 有两个实测限制

1. **布局变化后 target 坐标是 press 时快照。** `retargetMouseEvent` 不重新 hit-test 当前 layout。任务概览行数/输入高度/窗口 resize 改变 dock origin，drag 的 local y 可落到错误源行。
2. **FOCUS_OUT 没有组件 cancel 事件。** `tui-alt-screen.js:475-498` 清 host gesture，但不派发给 captured component；后加 raw listener 也收不到。组件自身 active 状态可能残留。

受控版本应在 render 的 width、正文内容、可见区、可推断分配高度/布局版本变化时取消拖选而不是提交旧区间，保存逻辑偏移而非仅保存 screen 坐标；next press 总是重置，shutdown/reload/overlay/focus 转移取消；missing-release watchdog 只能取消，不能猜测用户已选完并自动复制。若要求动态 dock 移动及失焦精确续选，最好由宿主提供 current-coordinate capture 与 cancel 事件。

## 3. 从可见点映射到原文

### 3.1 宿主已经有基本所需信息，但大多不公开

- `Editor.render` (`editor.js:393-423`) 算 padding 与 layoutWidth，保存 lastWidth，用 layoutText 后按光标及前一次 scrollOffset 选 visible rows；最大正文高度是 `max(5, floor(terminal.rows * 0.3))`。
- `:428-481`：上 border、正文、下 border、补全列表；正文添加左/右 padding、光标后的假空格和右侧补齐。这些不是逻辑数据。
- `:814-894`：每个 state.lines 是真实逻辑行；长行调用 wordWrapLine；chunk 内光标列是 UTF-16 offset。
- `:1530-1555`：buildVisualLineMap 返回 `{ logicalLine, startCol, length }`，其中 startCol/length 是字符串索引，不是终端列数。
- `:77-173`：wordWrapLine 保存 chunk startIndex/endIndex，按空白/CJK边界折行，不丢空白；超长词退回 grapheme 分割。
- `:276-277` / `:12-67`：segment 会将有效 paste marker 合并为原子区段。

语义模型应使用 `[startOffset, endOffset)`：

```
源文本 T = editor.getText()
每个 logicalLine 的全局 base = 前面各行 UTF-16 长度 + 真实 LF 的数量
visual row = { logicalLine, startCol, length, textStartX }
point -> visual row -> grapheme 起止 UTF-16 index -> T 中的全局边界
normalize(anchor, focus) -> T.slice(start, end)
```

复制时不从渲染文本拼接、不 trim、不删字符。相同 logicalLine 的跨 visual rows 自然不插 LF；不同逻辑行的跨越自然保留原有 LF（包括空行/末尾真实 LF）。真实空格属于源 span 就保留，右侧 fill/prompt/border 不含源 span。

正反向拖选要一致地按包含端点 cell 的完整 grapheme 范围计算起止；不要把目前用于 click 的“非最后 chunk 在 chunk end 回退到最后 grapheme”规则直接当选择边界，否则软折行处会漏字符。仅选空格或换行也可以是有效非空字符串，不应以 `.trim()` 判断非空。

### 3.2 Unicode 与列宽

- `TUI/utils.js:212-267`：visibleWidth 忽略 ANSI/OSC/APC，用 graphemeWidth 算列宽。
- `:286-311`：getGraphemeCellRange 可找完整 grapheme cells；它不是 package root 导出。
- `TUI/index.d.ts:35`：root 公开的是 visibleWidth/sliceByColumn/stripTerminalSequences 等，不包括 wordWrapLine/getGraphemeCellRange/getGraphemeSegmenter。

可用 `Intl.Segmenter(..., { granularity: "grapheme" })` + 公开 visibleWidth，自建 `cellStart/cellEnd -> sourceStart/sourceEnd` map。中文宽字符、全角字符两列；组合音标 é 一列但两个 UTF-16 单元；ZWJ/旗帜等不能按 code unit 切。ANSI 只参与展示，选区 slice 必须来自逻辑源而非 stripTerminalSequences 后的显示串。

宽度模型与实际终端字体/Unicode 版本仍可能不一致，这属于终端条件，不可承诺所有终端准确。独立零宽 grapheme、极窄可用列宽、含控制序列文本应有明确不支持/安全取消路径。

发现宿主边界问题：`wordWrapLine` 在单 grapheme 比可用 width 宽时递归自身 (`editor.js:132-146`)，真正两列字符在一列内容宽下无限递归。命令实验 `Editor.setText("中"); render(2)` 得到 `RangeError: Maximum call stack size exceeded`。本研究未修复；新选区不可把极窄屏认为已验证支持。

### 3.3 滚动与越界选择

- 现有输入框的 scrollOffset 是 Editor 内部滚动，不是 ScrollView。`CA/modes/interactive/chat-viewport.js:3-27`：只有 document/transcript 是 ScrollView，输入在固定 dock。
- 全屏 renderer 的选区边缘自动滚动 (`tui-alt-screen.js:1034-1087`) 只对 anchor.scrollView 生效；它不会滚动输入框原始文本。
- 在现有 Editor 上直接改私有 scrollOffset 又调用 render，会被“保持光标可见”逻辑改回 (`editor.js:411-420`)。不能只设置 offset 就声称自动滚动已完成。

可见正文范围内拖选，以及鼠标越过左右 padding 的端点 clamp，可通过上述 map 处理。跨隐藏正文需要一个独立 selection viewport：要么自有 render/view offset 显示原文区间（同时保持后续 editing 的光标/导航一致），要么使用受控内部方法移动 cursor/冻结 follow-cursor scroll。后者可能影响 history draft 与光标，不应选择时伪装成用户键盘操作。**跨所有未显示输入的连续拖选是追加设计，不属于“capture 已有”即自动获得的能力。**

### 3.4 宿主还有第二层裁剪

- `TUI/layout.js:48-68`：leaf component 先 render 全部行，再按实际 allocatedHeight 裁剪；若 cursorLine 超出高度，使用额外 lineOffset 使光标可见。
- `:224-231`：屏幕读取 `box.lines[lineOffset + row - box.rect.y]`。
- `TUI/tui-alt-screen.js:634-652`：派发坐标只有 rect transform，不把 lineOffset 告诉 component；Container 又会按其渲染时原始子高度继续派发 (`tui.js:116-139`)。

窄高度窗口、状态/概览挤占 dock 时，`y=0` 可能实际画的是第三行正文，不是 Editor 上 border。只读取 Editor scrollOffset 或 `event.height` 不够普遍修复；capture 的 event.height 还可能是原子组件完整渲染高度而非实际 clip 高度。此问题也影响现有 Editor click，不是新的语义选择才产生。

严格实现必须识别并拒绝未经映射的 crop，或依赖当前 layout/clip/lineOffset 内部信息，或要求宿主公开“最后实际绘制正文几何”。不能静默复制另一个区间。

### 3.5 大粘贴 marker 与原始字节边界

- `editor.js:953-954`：CRLF/CR -> LF、Tab -> 四空格。
- `:1069-1074`：粘贴时清理不可打印字符。
- `:1084-1100`：大于 10 行或 1000 字符的粘贴存入私有 pastes，屏幕只显示 `[paste #N ...]`。
- `:897-913`：getText 返回含 marker 的逻辑文本，getExpandedText 展开；没有公开“展开指定源片段”或 display/expanded offset map。

当前可选择可见普通文本的任意片段。对 collapsed marker：可以把整个 marker 视为一个原子选区并复制其对应整个 paste（内部 map，或受控标准 marker解析）；**不能把鼠标点在 marker 的第几个字母解释成隐藏 paste 的对应第几个字符**。用户若要求隐藏 paste 内任意片段，必须先实际展示/展开这些内容，才能建立对应几何。

`getExpandedText().slice(displayStart, displayEnd)` 是错的，marker 前后长度会改变。只在复制后展开完整有效 marker 也需要验证 registry，不能误把用户自行输入的 `[paste #...]` 当占位符。最小版本可明确遇到有效 marker 即不建立任意内部选区；若接受原子 marker 则单独约定语义，不默默升级为“任意隐藏片段支持”。

## 4. Pretty、input-history 和 Task UI 的保留边界

### Pretty

`PRETTY/prompt-editor.ts:8-10,42-64,83-119`：reservedPadding 包含 prompt slot；getPaddingX 返回 userPadding 而非真实 reservedPadding；第一可见内容行且未滚动才画 `❯`；boxed 时替换两侧空格为 `│`。因此仅调用公开 getPaddingX 再扣 x 不一定等于实际文本起点。prompt 是否存在、哪行显示、side bars、padding 钳制必须由外观层给显式几何，而不是猜图形字符。

`ROOT/extensions/pretty-compat/editor.ts:36-97`：当前装饰保留真实实例，RenderBridge 使用原 receiver 的 render，shadow render/getPaddingX/setPaddingX/border hooks；不接管 handleMouse。后续自有输入框若只按 Pretty 的用户 padding 推 map 会错；移除 Pretty 后也应由同一输入外观 owner 输出 `{textStartX, bodyRows, ...}`。

本研究没有移除 Pretty，也没有以移除边框代替语义选择。

### input-history

`HISTORY/index.ts:93-110`：获取 previous factory 并委托，给返回的真实 editor addToHistory；历史不只是可见 getText。`:123-133`：reverse search 是 overlay，接受后 setEditorText；`:384-390` 传递 Focusable。选区不能通过每次 setText 或新建另一个 Editor 替换旧实例来“复制”状态。

推荐复用同一实例的可撤销 render/mouse/input decorator；把选区作为额外短生命周期状态，所有未拥有按键继续原 handleInput。选区在历史切换、文本改变、overlay 打开、接受 reverse-search 结果时取消。不要修改 HISTORY 包或绕开其 factory。

### Task UI

- `ROOT/extensions/bash-unified.ts:62-87`：Pretty lifecycle 注册后，再注册 Down opener。
- `ROOT/extensions/task-ui/editor.ts:41-58`：空输入且实际 focus 是该活实例、无 overlay、无补全时 Down 打开 Task Panel，否则原 handleInput。
- `:86-107,142-185`：handoff 暂时保护 setText/autocomplete/callback/actionHandlers，保留活实例及 editing/history 状态。
- `ROOT/extensions/task-ui/owner.ts:64-78`：Task Panel 用 overlay。

新选区不更换 prototype、不复制私有历史、不吞空输入 Down、不截获补全操作、不全局消费 Ctrl+C。带选区的复制 shortcut 可以局部消费；无选区时必须保留 app.clear/interrupt/extension shortcut 和 Task UI；panel/reverse-search focus 期间输入选区不能偷事件。为减少 Ctrl+C 与 app.clear 冲突，release 自动复制是最小触发路径；是否额外绑定复制键应另行确认。

特别注意 live editor 的 host setter：`interactive-mode.js:2242-2309` 会重设 callbacks、setText、padding、autocomplete、actionHandlers，即使 factory 返回原实例，也可能毁 history draft/pastes/completion。应在已有 composition 层统一安装，不随手反复 setEditorComponent。

模式切换的 stable TUI Proxy (`tui-renderer.js:36-63`) 支持重新绑定 renderer；`interactive-mode.js:604-648` 保留组件树、重建 renderer。组件原文选区应在模式/尺寸变化时主动取消，不能保留旧 capture 继续用。

## 5. 能力分类

| 实现形状 | 公开接口/依赖 | 判断 |
|---|---|---|
| 全屏自有 press/drag/release、越出控件后继续接收、阻止屏幕 fallback | Component.handleMouse + TuiMouseEventResult | 公开可做，命令级实测 |
| 绘制选区高亮、按逻辑文本 slice、复制选中片段 | render + getText/getLines/getCursor + Intl.Segmenter/visibleWidth + copyToClipboard | 基础机制公开可做 |
| 保留现有 Editor 可见普通文本的完整精确映射 | border hook 可观察 hiddenCount；但需重建与宿主一致的 wrap/segmentation；wordWrapLine 有独立模块声明导出但不在 root | 可做受控子集；复制算法或深导入仍依赖宿主实现行为，非稳定 source-map 合同 |
| 直接复用现有 visual map/真实 padding/scroll/marker registry | Editor private 字段/方法反射 | 1.2.0 可做，明确内部依赖与升级风险 |
| marker 原子展开、跨所有隐藏输入自动滚动 | 私有 pastes/segment/scroll/view 控制，或额外自有 viewport/render | 需追加设计与验证，不能即刻承诺 |
| crop 后任意文字精确点击/选择、dock 变化中连续续选、focus-out 正确取消 | 当前布局内部 clip/lineOffset、capture snapshot/无 cancel | 当前公开接口不完整；可内部适配或限定/取消；宿主公开新合同更稳 |
| 自建全套 EditorComponent 及完整逻辑/布局/鼠标 | setEditorComponent + public Component 合同 | 理论公开可做，但需重建 editing/history/undo/autocomplete/app handlers；不再是保留现有 editor 的最小能力，不建议因此扩大任务 |
| 普通模式 native drag -> 语义选区 -> copy | 没有 native selection range 事件/API | 现有公开合同不可做；终端/宿主级另行改造不是本任务轻量实现 |
| 只处理 copied screen text 去掉装饰/全部换行 | 已丢源映射信息 | 不可靠且不满足要求，不采用 |
| 完全复原最初 CRLF/Tab/控制字符字节、鼠标选隐藏 paste 的任意内部段 | 已标准化/未显示 | 无额外原始存储及显示不可做 |

## 6. 最小实现形状（规划参考，未实施）

建议的最小受控版本不是 patch TuiAltScreen，而是输入框 composition owner 上的 **SemanticSelection decorator**：

1. 保留原编辑器/receiver/factory/历史及 Task UI，单独保存 selection anchor/focus、文本版本、最后已验证几何及 lease。
2. render 调用原 render，使用受版本保护的 Editor layout provider 生成与实际显示一致的每行 source span；外观 owner 显式提供 prompt/padding/body row 位置；补齐及装饰 cells 不映射 source。
3. 输入状态为空、补全行、未知 editor shape、有效 marker 内部、未经确认 crop、尺寸/映射异常时不启动选区；不要静默走屏幕清洗并称语义复制成功。可诊断“不支持当前区域”。
4. 主键正文 press capture；drag 保存逻辑 grapheme 边界，高亮按 source spans 投影；越界 clamp，不选 Task UI/提示符/边框。先限定已显示正文；跨隐藏内容滚动属于单独选区 viewport 设计。
5. release 从当前未变更的逻辑文本 slice 复制；仅在实际有拖动且区间非空时自动复制；纯 click 委托原 click，保证 editing cursor 不被选区副作用改变。
6. 绘制用 ANSI-aware slicing，保留 CURSOR_MARKER/fake-cursor 配对和原主题，width 不超限；原文不读渲染行，高亮不要改变源索引。
7. 任何编辑、history navigation、mode/resize/crop/dock 几何失效、overlay/focus 转移、reload/shutdown 均取消；async copy 序列编号防止旧复制覆盖更新的选择，错误可见、不误报成功。
8. 安装/清理只恢复仍属本 lease 的方法；不要将 editor 私有对象或原文写入日志/持久化。版本变动失败关闭能力而不破坏输入。

更稳的宿主支持形状（不是本次要求修改宿主）：Editor 公开已绘制 visualRows/cellSourceRanges/visible offsets、marker 展开选区服务；mouse target 使用当前 frame transform，并提供 `cancel` / clipped visible row offset。这样 decorator 可不接触 state/scroll/pastes/currentLayout。没有这些 API 也可限定实现，但不能宣称同等稳健。

## 7. 剪贴板与终端条件

- `CA/index.d.ts:38`、`CA/index.js:46` 公开 export copyToClipboard；无需私有 `TuiAltScreen.copyTextToClipboard`。
- `CA/utils/clipboard.js:8,15-24,87-171`：优先 native/platform route；macOS native/pbcopy，Windows native/clip，Linux wl-copy/xclip/xsel/Termux；WSL 有 Windows interop；远程/headless 条件发 OSC52。OSC52 base64 限制 100,000 字符，超过会报错（可能已有本地复制成功）。
- `TUI/tui-alt-screen.js:1226-1242`：裸 TUI 未注入 copySelection 会无验证写 OSC52 并报告 Copied；Pi 宿主注入 helper，扩展应复用公开 helper 而不是照抄裸成功提示。

本地系统 clipboard command/native success 比裸 OSC52 更可靠；SSH 可能只是写远端剪贴板，helper 为 remote 再发 OSC52。终端策略、tmux passthrough、IDE/web terminal、Apple Terminal、用户禁用 clipboard access 都可能拒绝 OSC52，应用无法据发出控制序列确认客户端已复制。不能把 OS helper 的远程 OSC52返回解释为已验证本地客户端内容。

终端原生 copy menu / Cmd+C 不保证给应用发送按键，也不一定理解应用自画高亮；因此全屏 release 自动复制对应选区是明确、可控的 clipboard 路径。用户强制终端 native selection（终端特定 modifier）时绕过应用，仍是屏幕文本，不属于本能力的保证范围。

本次未改任何终端、tmux 或 Pi 配置，未运行 copyToClipboard/pbcopy，也未读写真实用户剪贴板。

## 8. 命令级小实验（只在内存中）

全部用 `node --input-type=module -e '...'`，绝对路径 import 安装版 JS；fake Terminal 只在对象内保存输入 callback、丢弃 ANSI write；copySelection callback 仅把文字存数组。未 start 真实 Pi、未创建代码文件、未安装依赖。

### A. 真实 Editor 视觉映射与 Unicode

输入 `alpha beta 中文 é tail  \n\nnext line`，render width=14 / padding=2：

- lastWidth=10；logical line 0 的 visual spans 为 `(0,6)`、`(6,8)`、`(14,9)`；空行有长度零 span。
- 任意端点范围 offsets `[6,19)` slice 得 `beta 中文 é ta`，没有两条软折行产生的 LF。
- wordWrapLine(`hello world  `,7) 得 `hello ` + `world  `；重连与源完全相等，真实空格没有被 wrap 丢弃。
- 中文：UTF-16 2 / columns 4；é：2 / 1；ZWJ emoji：5 / 2；旗帜：4 / 2；全角Ａ：1 / 2。
- 5 widths × 6 kinds（英文、中文/全角、组合/ZWJ、空行、超长词、真实空格/换行）共 30 map round-trips 均等于对应逻辑行。此实验检查映射分段，不是全部鼠标/终端测试。
- 另用 `left long line  \n\nright tail\n` 在 width=9 下取任意 source offsets `[5,23)`，得到 `long line  \n\nright`：两处真实 LF 和真实行尾空格保留，软折行不加入 LF；源末尾 LF 也仍存在。
- `setText("a\r\nb\t")` 得 `a\nb    `，验证原始字节边界。
- 11 行 bracketed paste 只显示 marker，getExpandedText 才有全部 11 行，验证隐藏文本不能直接按 display offset slice。

### B. 真实全屏 routing 和屏幕复制

fake Terminal + TuiAltScreen + 真实 Editor/Stack：

- 默认主键拖选跨 word-wrap，复制得到 `alpha beta\n  gamma`：软 LF 与左 padding 被带入。
- 内建 listener 后加 raw listener，SGR mouse 计数为 **0**。
- 对 live Editor 在内存 shadow handleMouse：press 返回 capture，拖到远离 editor 的 screenY=18，仍收到 local y=16 的 drag/release；默认屏幕复制次数为 **0**。
- press 后把上方 heading 行数从 2 改 4 并重新 render，后续事件仍按旧 origin 计算 local y，证实 capture transform 快照。
- 普通 TuiMainScreen 人工注入 SGR press：component handleMouse 次数 **0**，不会自动派发。这不等于真实终端会发送鼠标；实际普通终端原生选择更不会向 Pi 发送区间。

### C. 内部 map 的完整拖选概念验证

用同一真实 TuiAltScreen 派发流程，组件内存 handler 通过 Editor 私有 visual map / lastWidth / scrollOffset + Intl.Segmenter 把点转 source offsets：

- 输入 `prefix 中文 é middle suffix  \n\nsecond tail`，拖选部分首行到第三 visual row，得到 offsets `[7,27)`，复制 `中文 é middle suffix `。
- 包含中文与组合音标，跨两处软折行，没有软 LF，保留实际选中的源尾空格；renderer 屏幕复制被抑制。
- **这是依赖内部 map 的概念验证，不是产品实现或完整选区状态机**；未实现反向策略、高亮、自动滚动、crop、生命周期等。
- press 后发送 FOCUS_OUT：hostCapture=false，而组件 active=true，证实缺少取消通知。

### D. 小终端 crop / 极窄字符

- 五行正文的 Editor 被 Stack 分配三行显示：屏幕前三行为 `three`、`four`、`five`，但 local mouse press 为 y=0。原 render 仍含 border + one/two/three/four/five + border。证实第二层 lineOffset 未在事件中体现。
- 一列内容宽显示中文导致宿主 RangeError，如 §3.2。没有修复宿主。

## 9. 后续验证方案与未验证项

若后续获准实施，先做“错误范围绝不复制”的定向测试，再真实交互验证：

1. 片段 oracle：单行中部、跨 1/N 软折行、跨真实 LF/空行/尾 LF、前后/中部连续空格、纯空格/换行、重复文本、同形 `│`/`❯` 源字符；正反向拖动结果严格等于指定 source slice。
2. Unicode：中文两列的任一 cell、全角、组合、ZWJ/旗帜、零宽边界；不分裂 grapheme；ANSI、高亮/fake cursor 不影响索引。
3. 边界/几何：padding/prompt/边框/补全不含源；正文左右/上下越界；resize、footer/Task概览高度变化、dock crop、scrollOffset 变化都安全取消或正确重映射；missing release /失焦/切模式不残留。
4. 保留：undo/kill-ring/history draft、input-history 有/无记录、reverse-search cancel/accept、同实例 handoff、空输入 Down、Task Panel overlay、autocomplete click/wheel、提交/clear/interrupt/粘贴图片、reload/shutdown；非自有事件原样委托。
5. 长输入：可见部分/隐藏部分、每种 marker 边界；自动滚动设计通过后单独测试，不能以 transcript ScrollView 测试替代。
6. 剪贴板：mock copyToClipboard 成功/失败/超限/异步竞态；再经用户同意测试 macOS native/pbcopy + 实际粘贴字符比对（特别是源尾空格/LF），远程 OSC52 和 tmux 路由单列。
7. 真实终端：至少本机实际使用终端的 fullscreen；再视需求 iTerm2/Ghostty/Kitty/WezTerm/VS Code、tmux/SSH；Shift/native selection bypass 应明确属于非语义选择路径。普通模式必须确认保持原有输入与终端鼠标行为，不暗中接管。

**尚未真实交互验证：** 实际鼠标坐标/gesture报告、拖出终端与 release 丢失、中文终端列宽/IME、选区高亮、input dock 动态移动、滚轮/拖选自动滚动、实际 clipboard及 remote OSC52、input-history 与 Task UI 的完整运行回归。命令级实验支持“全屏扩展可拥有手势并按源区间复制”，不能替代这些验收，也不能据此称当前产品已支持。
