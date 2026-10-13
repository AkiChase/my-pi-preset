# Down 切片前的实际 SDK / 相邻任务核验

## 前置状态

核心panel已写入并集中检查；独立review唯一freshpanelgroup窗口缺口窄修，actualred1pass2fail→严格green→最终full469/469、三模块447/447自然退出（b0fav00ex）。原review窄resume确认尚在执行。未开始Down代码。

## Pi1.1.0公开能力（本次实际重读）

先前研究把autocomplete/focus描述为只能private访问，当前安装SDK实际已有publicAPI：

- `pi-tui/dist/components/editor.d.ts:36`：focused。
- 同文件:257 与editor.js:2035：`isShowingAutocomplete(): boolean`，直接检测state非null，不读private字段。
- `pi-tui/dist/tui.d.ts:294`附近：`getFocusedComponent(): Component | null`、`hasOverlay(): boolean`公开方法；不能继续引用旧FleetprivatefocusedComponent/failopen方案。
- Extension UI公开getEditorComponent返回factory，不是liveeditor；setEditorComponent调用实际InteractiveMode.setCustomEditorComponent，保存text、清container、factory、host接线/appearance/provider/actionhandlers、setFocus(newEditor)。**仅text/callback复制，undo/history/cursor不会自动复制。**
- CustomEditor.handleInput先extensionshortcut，再appactions；Down未命中时super Editor优先autocomplete，否则cursor/history。装饰要delegate原receiver；不覆盖原text/history/undo方法，不用新Editor吞原instance。

## 独立验收与下一切片

review59d94a60核心范围45/45自然退出，唯一freshpanelgroup窗口finding窄修后独立3/3确认关闭；parent最终469/447自然门通过，G3按批准cooperativecancel边界接受、核心UI通过，G4待Down。新agent72cf8668开始仅Down/editorowner/config/composition最后注册hook+实际SDKhost/editor测试，不重写已验panel/后端；相邻Pretty仍只读。

## 需实现者决策并验证的窄安装方式

factory接收真实TUI，原Editor.focused/getText/isShowingAutocomplete public可判；优先在live返回对象上只装饰handleInput，preserveidentity。首次session_start安装或旧factory重新被host调用时，setter重建自身是否丢preexistinghistory必须actual验证，不能只说已copytext。可探索factory内公开TUI.getFocusedComponent取得仍live旧editor并在首次安装return同object（setter在切换focus前调用），但必须判真实editor接口且不偷用overlay，不误跳过插件合法factory行为；不凭该想法直接算设计结论。

关闭时只解除本身方法，之后插件包裹时保留inactive透传，dropctx/UIcaptured引用；factory恢复若会重建丢状态，需明确实现安全恢复/flatten退休factory，不以全局rawlistener回退。

## 相邻Prettycompat真实状态

独立worktree `/Users/jyxc-dz-0101322/tools/my-pi-preset-pretty-editor-compat` HEAD仍07ec6bc，gitstatus有未提交 `extensions/pretty-compat/editor.ts` 和正式composition修改，taskin_progress；不能把prototype研究当已merge正式交付。

actualeditor.ts提供createDecorator(原instance视觉render/padding/border)与adaptPrettyLifecycle(pi,createPrompt)；不改handleInput。但它的session_start拦截Pretty setter，取得previousfactory并通过slot包裹；如果Down先后加载要实际testedtwoorders。当前主composition尚未引用它，不能在Down切片复制相邻修改/整文件覆盖。只读可做测试组合，通过已存worktreehelper可指定fixture路径，不将其未提交代码作为生产运行依赖。

## 范围

下阶段只task-ui/editor/owner/config及composition最小生命周期hook与真实SDK/editor离线tests，默认Downenable、显式Shift+Down保留。空严格文本+visibleTasks+editorfocus+press且noautocomplete/overlay；其他输入原样delegate，paneldown正常。原UI不复活、oldtaskclosed不admit、noctxretention。No新全局raw terminal listener，无真实模型/install/reload/userconfig/SDKwrite/commit。

用户已批准实施和新顺序，执行无需重复问建任务，但公开API无法保state的实际证据若遇到要报告，不静默弱化AC8。真实TUI仍需用户额外授权加载。
