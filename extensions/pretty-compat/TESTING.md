# Pretty 编辑器兼容回归

## 实现与来源
- `editor.ts` 是本仓库编写的实例装饰和生命周期 helper，入口只有 [bash-unified.ts](../bash-unified.ts)。未复制 Pi、Pretty 或 input-history 的源码。
- Pretty 的 `createPromptEditorClass` 由原运行时依赖导入；RenderBridge 调用原 editor 的 render/padding/边框 hooks，复用实际 Pretty 渲染，而非维护一份渲染算法。
- 调查契约版本：Pi SDK 1.1.0、`@heyhuynhgiabuu/pi-pretty` 0.6.31、[pi-input-history](https://www.npmjs.com/package/pi-input-history) 1.1.3。本次升级在 SDK 1.2.0 / Pretty 0.7.0 上重跑离线回归；依赖范围仍由 [package.json](../../package.json) 管理，不钉死运行时版本。
- [history-fixture.mjs](__tests__/history-fixture.mjs) 是独立编写的契约 fixture，不是 vendor。它实现同 cwd 的 SessionManager 发现、最近 session 优先、去重至 100 条、factory 链、公开 addToHistory 的旧到新注入，以及独立搜索 cache/当前 branch 合并。
- fixture 搜索只覆盖 query、旧/新选择、取消、branch 优先和回填；不是上游完整 fuzzy highlight/预览/配置实现，也不意味着测试过上游全部 Alt+R UI。

## 执行
先准备本 checkout 的依赖和实际宿主 SDK 链接，无需安装 input-history。harness 使用宿主已有的 jiti 加载真实 Pretty 和正式 wrapper，所有 session、Pretty 配置均在临时目录，结束删除；FFF 服务 seam 禁止 native 扫描，不需要网络或真实终端。

```sh
node --test extensions/pretty-compat/__tests__/editor.test.ts
PROTOTYPE_REQUIRE_ORIGINAL_HISTORY=1 node --test --test-name-pattern='original Pretty history-first' extensions/pretty-compat/__tests__/editor.test.ts
```

第一条须自然退出且全部通过。第二条是保留的红测：原 Pretty 在 history-first 下 Up 得到空字符串，验收要求是 `previous session latest`，因此预期退出 1。正常测试同时断言旧实现失败行为和修复后双顺序历史。

## 已覆盖与边界
- 实际 SDK `setCustomEditorComponent` 与 `resetExtensionUI`；cold/new/reload 双顺序、每顺序 25 次 reset-before-shutdown、状态 start/stop、container/factory 接线。
- 0.7.0 正式 wrapper 的 default / claudecode 配置对照：history-first 保留历史，圆角框 / 普通横线与左对齐提示符正确；真实 ToolExecutionComponent 的 Bash 摘要、连续分组、外部 Edit 摘要及展开原 diff。回退桥接的 boxed 参数后 claudecode 回归必须失败。不把离线组件绘制当作真实 CLI 或完整 diff 高亮验证。
- identity/subclass/receiver、草稿/光标直接装饰、多行、Tab 补全、submit/change、应用/扩展快捷键；正常 Pretty 逐行外观与 embedded status 对照。
- readonly/accessor/nonextensible/missing hooks/nonembedded 安全降级；构造、方法写入和 host 接线部分成功后异常的回滚；旧 factory 失效时默认输入框恢复。
- 后来 render/border/getter/setter/factory 接管、直接 underlying padding 变化、冻结已安装方法、停用 wrapper 透传。每个 slot 仅持有一个 live lease，退休 factory 清掉 builder；不改其他插件的 opaque wrapper。
- SDK/Pretty 在部分极窄 CJK 布局递归溢出、width=1 聚焦光标越界，均保留上游失败对照，未跳过或宣称已修复。
- 离线 suite 不启动 pi 进程，宿主 app 回调是 fixture；另一次隔离 PTY 验证使用真实 Pi 1.1.0、Pretty 0.6.31、input-history 1.1.3 和正式 wrapper，在 regular TUI 下跑通双加载顺序 × cold/new/reload 的 6 个组合，验证 ↑/↑/↓/↓、实际 debug 编辑框、Alt+R fuzzy query/接受/取消、session ID 及实际 runner reload。该人工集成验证不作为离线 suite 的依赖，不读取个人配置或提交模型提示。
- 未覆盖 fullscreen、复杂异步补全、任意未来 SDK/Pretty 或恶意 UI setter 始终失败；无法在公开 API 上恢复持续失效的 host。
- Pretty 自身 working controller 的全局 UI setter 后来接管，仍属于上游生命周期行为；此 helper 仅拥有 editor hooks/factory，不全局包装其他插件的 UI。
