# 编辑器入口实施前必须验证的 host 行为

主会话读取当前安装 Pi 1.1.0 的实际 interactive-mode.js:2242–2303 后发现：setCustomEditorComponent保存旧编辑器文本，重新调用factory创建新组件，复制onSubmit/onChange、padding、autocomplete provider和CustomEditor app handlers，然后切换focus。它不会显式复制旧组件的undoStack/history/historyDraft/killRing或其他private state。

因此设计中“使用公开factory装饰且保留undo/history”的目标不能只通过type声明证明。后续stage4须验证：

- 初始化时尽量早于用户输入/已有undo state建立装饰；若同会话重复session_start触发，不能反复创建editor损坏历史。
- 已有custom factory得到实际对象后在原组件上装饰handleInput，preserve identity/callbacks；不要为了wrap再次造一个失去internal state的Editor。
- teardown只有在当前factory仍属于自己时恢复predecessor；恢复过程是否丢custom state需实际测试和如实报告。
- 当前实际Pi1.1.0 Editor有公开 `focused` 与 `isShowingAutocomplete()`；后者在editor.d.ts:257和editor.js:2035提供，不必读取privateautocompleteState。先前“无公开getter”研究已过时。Down装饰直接使用公开判断并委托原handleInput，空文本但正在强制补全也不能打开面板。
- 默认CustomEditor的app actionHandlers、onEscape/onCtrlD/onPasteImage/onExtensionShortcut由host duck typing接线，子类handleInput必须super fallback。不能在测试只mockgetText而不验证真实app routing。
- 目前设计不允许whole-session global raw terminal-input fallback。如果公开factory无法做到必要editor行为保持，应给出最小受影响范围和证据后重新评审，不静默违反验收。

这些是host限制与当前API核验，不是已确认无法实现。核心panel已交付自动验证，下一Down切片使用actualfocused/isShowingAutocomplete和已有factory原对象装饰，仍需验证安装/解除factory导致的SDKeditor重建影响。主会话未修改host或editor。
