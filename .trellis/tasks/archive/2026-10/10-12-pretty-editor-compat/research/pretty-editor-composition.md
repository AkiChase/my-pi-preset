# Pretty 编辑器组合研究

## 已确认接口
- pi-pretty `src/types.ts:197–208` 的 `deps.customEditorClass` 接受返回 `CustomEditor` 的构造函数，不是实例或 factory。
- `src/index.ts:212–224` 保存旧 factory，但构造新 PromptEditor 时不用它；`490–497` shutdown 恢复旧 factory。
- `src/prompt-editor.ts` 完整阅读后确认：装饰包括额外 padding、`❯` 图标、圆角边框、内容侧边框、滚动时隐藏图标、内嵌 working status。实现依赖 `super.render` 与受保护的边框 hooks。
- SDK 替换编辑器不是状态迁移接口：复制文字、部分外观和默认应用回调，不复制历史/光标。

## 不采用的捷径
- 只把已有 editor 的 constructor 注入 Pretty：仍构造新实例，历史还是丢。
- 构造器直接返回旧实例：派生类方法不会自动安装在旧实例上，不能承诺保留 PromptEditor 外观。
- 只委托 handleInput：render、padding、callbacks、focus、补全和方法 receiver 仍可能分裂。
- 有旧 factory 就跳过装饰：能避免冲突，但不满足保留 Pretty 外观的要求。

## 推荐方向
在 preset 调用 Pretty 的边界提供局部 UI 适配，把编辑器安装改为“已有 factory 创建原实例，再对原实例装饰”，而不是保存 factory 后丢弃。装饰只覆盖必要渲染/padding hooks，不重建编辑器、不读取私有 history 字段。无旧 factory 时继续使用 Pretty 原编辑器。

需在隔离 worktree 做最小原型验证后确定具体实现：复用第三方装饰逻辑是否有安全入口；若无，应抽取仓库自有的小型实例装饰 helper，记录来源/许可证，不动态篡改原型链，也不修改整个依赖或其他插件实例。

## 风险与验证门槛
- 默认/自定义 editor 的 hooks 不一定一致，须 capability 检测并定义可诊断的降级。
- hook 和原 render 必须以原实例为 receiver；多行、光标定位、自动补全、窄屏、隐藏顶部行均须覆盖。
- 重复安装需幂等；shutdown/reload 应恢复自己的装饰，不能覆盖后来插件安装的 factory。
- Pretty working indicator 的嵌入不是仅 render 可解决，应独立验证。
- 双加载顺序回归需跑实际 Pretty 集成入口，不能只测试 helper；初始失败用例应能证明新实例丢历史。

## 研究局限
研究代理未完成实现原型，本阶段不声称方案已验证无损。保持 planning；原型只能在隔离 worktree、方案评审后开展，随后再收敛实现计划。
