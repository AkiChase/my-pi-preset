# 任务浏览器快捷打开、隐藏与恢复

## 目标

用固定快捷键快速查看 Trellis 任务，暂时收起浏览器以继续操作对话，再恢复原阅读位置。实现体验类似问卷隐藏，但浏览器另外支持快捷键首次打开。

## 已确认的产品决定

- 固定 `Ctrl+Shift+T`，不可配置，不增加配置文件或 fallback 键。
- 用户明确要求未打开/已关闭时直接打开新实例；隐藏后恢复旧实例，保留隐藏前阅读状态。
- 用户明确要求隐藏后即使有问卷、`/btw` 等其它弹窗，也将浏览器拉到最前。公开 SDK 接口支持，无需降级成等待弹窗结束。
- 完全隐藏并释放焦点；状态栏显示英文恢复提示。
- 用户已在最终方案后通过“可以”批准实施、验证、独立审查及本地 scoped commit；不授权依赖安装、push 或收尾。

## 功能与行为

| 当前状态 | Ctrl+Shift+T | /trellis-task-viewer |
| --- | --- | --- |
| 未打开/已完全关闭 | 打开新实例，按现有默认列表初始化 | 同左 |
| 正在初始化 | 复用本次打开，不重复挂载 | 同左 |
| 已显示且有焦点 | 完全隐藏，发布恢复提示 | 聚焦当前实例，不隐藏 |
| 已显示但被其它弹窗盖住 | 将当前实例拉到最前并获取焦点 | 同左 |
| 已隐藏 | 恢复原实例、拉到最前、撤销提示 | 同左 |

恢复保留选中任务、浏览范围、详情章节、各页滚动位置和文档缓存，不自动刷新。彻底关闭后再打开不恢复上次位置；会话替换/reload 不持久化浏览状态。

`Esc` 保留详情→列表、归档月→归档月份→活动列表→关闭的现有语义；`Ctrl+C` 保留关闭行为。隐藏态的 Esc/Ctrl+C 交由当前编辑器或前台对话框处理，不能从全局监听中关闭/取消后台 viewer。

把浏览器提到最前不会主动关闭、取消、提交或重建下面的问卷/overlay；再次隐藏或关闭时，焦点恢复交由 SDK 的可见 overlay 排序/原焦点机制处理，不手工接管其它插件。用户显式按快捷键的提到最前操作属于有意获取焦点；其它普通键不受影响。

## 技术证据与边界

- `extensions/trellis/lib/task-browser/command.ts:24–28` 当前在命令内调用全屏 overlay custom，无 owner、重复打开协调和隐藏监听。
- `extensions/trellis/lib/task-browser/component.ts` 的 TaskBrowser 持有阅读状态，保留同一实例即可避免重新导航。
- `extensions/trellis/index.ts` 的 registerProjectCapabilities 在支持项目内注册命令；保留其项目与 source-authority 守卫，不扩大到未激活项目。
- 已安装 SDK 的 `pi-tui/dist/tui.js:429–457`：setHidden(false) 更新 focusOrder 并 setFocus，focus() 对可见 overlay 做同样的提升；`:983–996` 按 focusOrder 合成，数值更大的在前。恢复被隐藏浏览器能提升视觉层级和键盘焦点。
- `pi-tui/dist/tui.js:712–739` 原始输入监听先于焦点组件分发；普通 registerShortcut 位于 `pi-coding-agent/dist/modes/interactive/interactive-mode.js:1754–1770` 的编辑器 handler，单靠它不能处理其它弹窗持有焦点时的首次打开/恢复。
- `pi-coding-agent/dist/modes/interactive/interactive-mode.js:2288–2354`：overlay custom 完成会移除自己的 handle，而不是栈顶任意 overlay；正常 overlay 完成不恢复 saved editor 文本。关闭通过 done，不直接调用 handle.hide()。
- 已安装问卷插件的 registerCollapseKeyListener/mountQuestionnaire 是参考，非本仓库维护文件；不照抄其仅作用于 focused/hidden 的范围，因为本需求还要提升被遮住的可见实例与首次打开。

## 生命周期与实现范围

一个扩展 activation 的有效 TUI 会话拥有一个浏览器 owner，最多一个正在初始化/打开的交互与一个固定按键监听。会话监听在有效支持项目的 session_start 中安装，可在没有 viewer 时处理首次打开；关闭 viewer 后保留会话监听以允许重新打开，session/activation 退休才注销。

owner 绑定 sessionManager 对象、session ID、项目根和 generation。校验 admission，初始化 await 前后核对身份，重复调用共享打开；旧 handle/factory/finally 不得复活或清除新状态。必要时提供最小组件关闭/dispose 接口，不重构渲染。

临时状态使用与 `trellis` 不同的专用 setStatus key；它是单次交互反馈，不增加常驻 Footer，不直接 setFooter/setWidget。关闭、失败、恢复和退休撤销仍属于本交互的提示。通知/发布/注销单独失败不能阻止其它 cleanup。

生命周期依据已完成的 session_start 替换与 session_shutdown/reload 退休；可取消的 before-switch 不提前清理。缺失必要原始输入或 handle 能力时不进入无法恢复的隐藏状态，保留现有命令退出路径并报告能力限制。

## 验收标准

- AC1：未打开或已关闭时，固定键打开新浏览器；正在打开时重入只挂载一次。
- AC2：聚焦浏览器时按键隐藏；再次按键恢复同一实例和阅读状态，无额外 custom mount。
- AC3：其它 overlay 获得焦点时也可首次打开、恢复或提升被遮住的浏览器；不调用其它 overlay 的 done/取消接口。
- AC4：隐藏期间普通键、Esc、Ctrl+C 留给当前焦点；Kitty release/repeat 不引起重复打开/切换；legacy Ctrl+T 与 Esc 不能作为 fallback。
- AC5：专用隐藏提示只在隐藏期间存在；恢复、关闭、失败、退休后撤销，旧 finally 不清除新交互提示。
- AC6：命令与快捷键共用 owner，重复执行命令恢复/聚焦同一实例；完全关闭后的新打开不保留旧阅读状态。
- AC7：初始化失败可重新打开；初始化期间退休、迟到 factory/handle、同 root 的 manager/ID 替换、reload/shutdown 不复活旧交互。正常关闭只释放交互，会话退休才移除首次打开监听。
- AC8：支持项目/来源验证与非 TUI 拒绝维持原行为；不修改任务、绑定、后台等待或执行状态。
- AC9：用户文档说明固定键、状态语义、终端与模式限制；页面标签按代码实际 PRD / Design / Implement / Metadata 校正。

## 兼容与范围之外

- 不支持扩展键盘编码的终端可能识别不了 Ctrl+Shift+T；传统 Ctrl+[ 与 Esc 同字节，已弃选，不自动替换其它键。
- 使用该固定键是有意获取 viewer 焦点；第三方或个人自定义原始监听也消费同键时，可能由注册顺序决定谁先收到。默认 SDK 未分配该组合；不承诺任意插件组合无冲突，不修改个人 keybindings。
- 隐藏仍保留活跃 overlay entry，已安装 Pi 的 switchTuiMode 会因此拒绝 regular/fullscreen 模式切换。本任务不改 SDK 或通过关闭重开伪装解决。
- 临时提示在窄屏/第三方 Footer 接管时可能截断或不可见，不能据此宣称恢复失效；不保证任意非 overlay 对话框的焦点恢复方式。
- 不加配置、自动刷新、状态持久化、其它面板快捷键、SDK 修改、依赖安装、个人预设同步、自动 reload、push、归档或历史任务修复。

## 执行与审查

详见 design.md 与 implement.md。拟由主会话实现一个可独立验收阶段，trellis-check 独立审查跨模块生命周期接口；check.jsonl 已准备真实规范引用，派发前再次核实，未派发 implement manifest 保持空。

在仓库外自建临时 agent 目录、已安装 SDK、无依赖下载的隔离环境运行 focused natural-exit `.mjs` 测试、Trellis/scroll-panel 回归、pnpm check 和 git diff --check。测试只用 fake-pi/handle 逻辑，不新增真实 host 挂载、TUI 渲染或菜单流程测试；记录 exact commands/exit codes/失败与 NOT_RUN。真实终端外观、物理键盘及第三方实际组合尚未验证，不能将源码可行性称为已完成验收。

任务已 start 为 in_progress；当前实现与检查进度统一记录在 implement.md。此前的公开源码调查仅证明方案可行，最终验收仍依据实现回归与独立审查。
