# 技术设计：内置工具展示与输入框外观

## 1. 状态与范围

用户认可 PRD 与 Pretty 替换方向，2026-10-13 明确不做鼠标片段原文复制。本文为待审阅设计，不构成实施授权。

本任务保持单一迁移任务：四类 renderer、输入框替代与依赖移除共同完成后才能证明不再需要 Pretty，不拆成长期并存的子任务。输入框外观已确认采用 §5 规则样式；仍须最终摘要后的明确实施批准才能 start。

## 2. 所有权和目录

用户进一步认可 beautify 应独立加载；本任务保留 extensions/bash-unified.ts 的共享后端协调职责，仅删除 Pretty 适配。入口重命名由后续独立任务 `.trellis/tasks/10-13-rename-task-composition` 承担。用户确认美化模块名为 beautify，统一承载工具与输入框外观：

```text
extensions/bash-unified.ts          # 仅后端与共享任务 UI 协调
extensions/beautify.ts              # 独立美化扩展入口
extensions/beautify/
  index.ts                         # 美化能力入口，注册 renderer 与 editor owner
  types.ts / layout.ts             # 原始结果视图、可见列宽/安全输出
  highlight.ts                     # Shiki、语言映射、有限缓存
  tools/
    read.ts / bash.ts / find.ts / grep.ts
  editor/
    appearance.ts / owner.ts       # 自有外观与活实例装饰所有权
  __tests__/                       # 工具、编辑器与实际宿主回归
  TESTING.md
  PROVENANCE.md / LICENSE.upstream  # 复用 Pretty MIT 代码时保留来源
```

bash-unified.ts 与 beautify.ts 均为顶层入口，各发现一次；beautify/ 作为嵌套库，不递归 discovery。

执行路径：processTasks(pi, injected lifecycle/coordinator) 直接注册 Bash，agentTasks 保持现状；beautify.ts 注册工具展示与输入框外观，registerToolRenderers(pi) 只注册 renderer，不 registerTool、不包装 execute、不 hook tool_result、不改变模型文本或 structuredContent。

两个独立扩展不依靠文件名排序保证正确性。输入框 appearance 与 Down opener 均须可在已有活实例上安全装饰，互不覆盖 render/handleInput 或重置状态；history-first/beautify-first、Down-before/after-appearance 都有实际 host 回归。输入框装饰不能依赖 downOpener=true；Down opener 关闭时外观仍有效。

## 3. 渲染公共合同

- resolver 仅拥有 read/bash/find/grep；其余工具 next() 原样委托，包括 write/edit/ls/codemode。
- 使用 renderShell=self，组件 render(width) 以实际可用列宽减 outputPad 布局；不从 stdout 全局宽度决定布局。
- 每 call/result slot 有独立组件，必要缓存存在 ctx.state namespaced 键或组件中；不改 result.details。
- 不调用 setToolsExpanded，遵守宿主当前 expanded。提示使用宿主当前 keybinding 的 keyHint，而非固定 Ctrl+O；保留鼠标展开宿主能力。
- 标题/统计的背景与语义色取当前 Pi theme；不新建 background 配置，不硬编码 Pretty 的暗色背景。外部控制字符先清理，只有自有 SDK/Shiki 样式保留。
- 折叠文件摘要优先保文件名、offset 与统计，长路径保头尾并省略中段；宽度不足把 metadata 移到第二行；极窄宽度依次省略展开提示/次要信息，不断开 :offset，不超过 width。
- 展开路径完整可见，可以在独立标题区按可见列分行；正文代码保持源行边界，过长行用 › 截断，不用 Text 自发折行造成行号混乱。
- 空内容、异常、部分输出、恢复的旧结果、未知 details 均可读。未知内容格式保守显示原文本，不假造计数或状态。
- 输入量遵守原始工具上限；renderer 自身有有界高亮与缓存，不额外读文件或完整 job log。图像块只由宿主 generic image pass 渲染。

## 4. 四类工具

### Read

从 ctx.args.path/offset 与结果 text 建立展示视图；offset 未传从 1 起，明确传 65 从 65 起（不复用 Pretty off-by-one）。原生续读/截断说明精确分离为 notice，不高亮为代码或计入文件行号；说明仍完整可见。未知格式保留 plain fallback。空文件、首次字节超限及图片 note 分支单独处理。

折叠：路径摘要 + 实际返回文件行数 + 展开提示。展开：完整路径、可见列行号、│、Shiki 色彩，notice 独立显示；没有旧图强制上下分隔横线。

高亮模块直接依赖 shiki / @shikijs/cli ^4.0.2，默认 one-dark-pro（保持用户已有代码色），本轮不新增个人配置/环境变量协议；主题跟随 Pi 的标题背景，Shiki 源码色与 Pi 全局主题独立。语言支持保持原 Pretty 映射，未知不根据内容猜语言。超过 80k 字符跳过；有界 LRU 最多 128 项，内容总字符另设 2Mi 字符上限，逐步淘汰；shutdown 清理。缓存包含语言、主题、文本，不持 ctx。

异步先 plain render 后替换；每次内容、宽度、展开、主题/activation 变化增加 revision；回调确认 revision 与 activation 仍有效才 invalidate。不保存迟到 ctx，不在 shutdown 后刷新。异常一次诊断不含路径/源代码，plain 仍可读；未知语言/超限不是错误。

### Bash

标题 $ command 与 timeout；折叠输出行数、宿主 durationMs（含 0）、展开提示，缺耗时不猜。展开正文保留当前输出，错误颜色由 ctx.isError 判断。仅清理视图中的宿主 exit 状态尾句时须仍可见其错误含义，不能过滤用户同形数据；本轮优先保留原始文本，不新增 exit N 摘要。

后台返回 handle 不是完成：原样保留 ID、log path 与后台文案，不加完成图标，不称耗时为后台进程耗时。不修改 Bash 参数、超时、detach、jobs/monitor 或提示 guidelines。

### Find

识别路径记录与 limits notice，按目录分组、目录 accent/bold、文件缩进。计数仅已展示文件；限量时说明不是全项目总量。不排序改变返回记录的相对顺序，不画图标/树线，不引入 FFF。无结果专门显示。

### Grep

识别 path:line: match / path-line- context 行，按相邻文件分组；match 与 context 的行号保留。高亮 respects literal 与 ignoreCase，匹配 regex 无效、零宽匹配或不支持语法时安全降级，绝不影响执行结果。匹配高亮以 Pi warning/强调色+bold，不硬编码 RGB；计数为识别到的 match 记录数，不含 context/notice。路径歧义无法可靠解析时显示原文本。超长行按列截断，说明完整可读。

## 5. 输入框外观（用户已确认）

采用简洁规则样式，不做圆角及左右竖边框：

```text
────────────────────────────────────────────
❯ 第一行输入文本……
  同一段的自动折行内容……
  下一行输入文本……
────────────────────────────────────────────
```

- ❯ 只出现在未向上滚动时第一条可见正文；颜色跟随当前 thinking level。
- 上下规则保留宿主 working status、隐藏行数提示，不添加 Working/Thinking 动画。
- 不重复续行提示符，不改用户消息正文；保留宿主 padding/光标 marker/IME/自动补全/滚动策略。
- 这是外观方案，不保证原生终端复制清洁，也不接管 mouse、selection 或 clipboard。

appearance 只装饰原活实例 render/padding/边框 hooks；不得新建实例代替已有 history editor，不读取/复制私有 history/paste/undo，不变更 prototype。不能安全装饰的未知 editor 保留原样并诊断。

owner 通过实际 live editor 预检与同实例受保护 handoff 安装，复用/局部抽取 task-ui/editor.ts 的 preserveHandoff；不能把 Pretty 的 lifecycle Proxy 留下并改名。可共享 descriptor 与 handoff 小工具，但不重构 coordinator、panel 或无关输入逻辑。factory 后续正常委托前任，装饰只作用在实际返回实例。

所有 method/padding/factory 恢复验证 lease ownership；reset-before-shutdown 不重装旧 factory；后来的 wrapper 保留无资源 inactive forwarder。session_start/new/reload/模式变化按现有宿主生命周期管理，关闭清 editor/ctx/TUI 引用。

## 6. 迁移

1. 开发与测试独立 beautify.ts 及 renderer/appearance，再切换 bash-unified 删除 Pretty；验证两种接线顺序，避免中途删除唯一可用输入框保护。
2. 删除 @heyhuynhgiabuu/pi-pretty runtime dependency、传递 FFF 依赖及 pnpm lock 不再需要的条目；新增直接 Shiki 依赖，Pi SDK 保持 peer。
3. 删除 Pretty 专属 import、截获 Bash 注入器、promptSnippet 补丁、adaptPrettyLifecycle，迁移有效 editor 回归后删除 pretty-compat 整目录。
4. pi-preset.json 去掉整个 pi-pretty.json files 声明，个人旧文件不读取、不删除、不 prune，不 tombstone。
5. conflicts 保留 standalone Pretty，明确其与自有 renderer/appearance 禁止共存，非代加载依赖；其他 conflicts 和 packages 不变。
6. 更新 manifest/sync/actual-loader/editor fixtures 与 README，消除真实 Pretty/FFF import。仅保留来源/迁移历史的文档引用，不要求历史 task 全仓清词。
7. 没有自动 install/sync/reload。依赖安装、真实隔离 PTY 验证按后续实施授权与用户态边界执行；不用个人配置作为测试输入。

## 7. 验证与回滚

自动检查分三层：纯视图宽度/解析/高亮 → 真实 host renderer/component 展开和重绘 → 实际 composition + host editor setter + offline history fixture + Task UI。保留 root/child loader、共享执行和 shutdown 回归。

独立 check review 全量本任务 diff；随后 pnpm check 和定向无 force-exit 测试。真实 TUI/真实 input-history 包的隔离 CLI/PTy 另记证据，不以 fixture 宣称已完成鼠标或所有终端验收。

回滚单位是本任务所改源码+package/lock/manifest的成套版本，不单独恢复 Pretty 而让双 renderer 并存；不触及个人 config、不 reset 无关修改、不自动 commit/push。

## 8. 审阅门

工具范围、鼠标复制排除与 §5 输入框外观均已确认。三份规划材料与上下文齐备；只有最终摘要之后用户明确“开始实施”才运行 task.py start。外观选择不是产品实施批准。
