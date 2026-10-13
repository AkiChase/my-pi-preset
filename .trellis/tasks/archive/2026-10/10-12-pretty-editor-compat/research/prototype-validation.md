# Pretty 实例装饰原型验证（仅原型，不是正式修复）

## 隔离与范围
- worktree：`/Users/jyxc-dz-0101322/tools/my-pi-preset-pretty-editor-compat`，基线 `07ec6bc`，分支 `feat/pretty-editor-compat`。
- 原型全部放在 `extensions/pretty-compat/__tests__/`；正式入口 `extensions/bash-unified.ts`、package.json、preset、README、pnpm-lock.yaml 与本分支 HEAD 相同。没有复制其他 worktree 的运行时代码，没有提交或执行任务生命周期命令。
- 前轮执行 `pnpm --config.auto-install-peers=false install` 和 `pnpm link-sdk`；安装导致的 lockfile 变化已恢复为本分支 HEAD。
- SDK 1.1.0 通过只读链接使用；Pretty 0.6.31 使用本 worktree 安装的实际 `src/index.ts`、`src/prompt-editor.ts`；input-history 1.1.3 只读加载已安装源码，可用 `INPUT_HISTORY_SOURCE` 指定其他安装位置。jiti 来自现有 SDK 安装，不另装 SDK peer。
- 配置和 session 均写临时 agent-dir，测试结束删除；导入前设置 `PI_CODING_AGENT_DIR`、`PRETTY_CONFIG_DIR`，FFF 使用其共享服务 seam 禁止 native 扫描。没有读写个人配置。

## 方法
harness 直接调用 SDK 的 `InteractiveMode.prototype.setCustomEditorComponent`、`createExtensionUIContext` 与原生 working-status 方法，使用真实 CustomEditor、TuiMainScreen、SessionManager、input-history 搜索组件。未复制 host setter，未只用假 editor 断言。

原型通过独立 RenderBridge + 实际 `createPromptEditorClass` 复用 Pretty 渲染：原 editor 保留 identity/prototype/history/输入方法，仅覆盖 render/padding/边框 hooks，原方法以原 receiver 调用。局部 Pretty 生命周期 proxy 经正常 host setter 注册 factory；shutdown 仅恢复自己仍拥有的 factory，后来包装保留，捕获 wrapper 停用后成为透传。本轮没有修改 `prototype.ts` 的适配逻辑。

## 前轮失败与本轮闭合
前轮定向 9 项中 6 通过、3 失败；本轮没有删除原始验收目标，而是修正 fixture、分离生命周期并增加独立对照。

### working 文案根因
Pretty 的 `src/config.ts` 对外接受 `workingIndicator.text`（字符串或数组）；`loadConfig` 只读取 `text`，`resolveWorkingIndicatorSettings` 才把它转成内部 `settings.texts`。前轮 fixture 误写 `texts`，因此真实 SDK 正确渲染了 Pretty 默认 `Working…`，不是 adapter 丢状态。

fixture 已改为 `text: ["PROTOTYPE-WORKING"]`。独立状态测试保留文案断言，并验证：实际 host 的 `workingIndicatorOptions.frames` 包含文案、workingMessage 为空、agent_start 嵌入边框、agent_end 移除 status、再次启动可显示、shutdown 清空 indicator options/message。两种加载顺序均通过。另以真实单帧 `StatusIndicator` 对照真实 Pretty，验证 12/20/30/80 列、多行滚动、停止后的渲染一致；单帧避免定时动画竞争，不替代真实生命周期用例。

### cold/new/reload 历史循环
历史测试与外观断言分离。两种加载顺序均完整验证三阶段：
- cold：空 editor Up/Up/Down/Down 取回跨 session 历史并返回空草稿；当前 history 与 Alt+R 正常。
- new：shutdown 后按 core 顺序重置 UI，建立新的真实 SessionManager，确认 branch 为空，再清除旧 extension handlers 并重新激活 Pretty/input-history closures。
- reload：保留 host/session，shutdown、清除旧 handlers、重新激活 closures 后检查空 editor 历史。

这比重复发送 session_start 更接近 runtime 重建，但仍不是启动真实 Pi 进程执行 `/new` 或 `/reload` 的端到端验证。

### 极窄 CJK 与光标限制
增加未经装饰 SDK CustomEditor、原版 Pretty PromptEditor、adapter 三方对照，覆盖宽度 `1,2,3,4,5,6,7,8,9,10,11,12,30,80`，user padding `0,1,3`，空文本、CJK 文本及 50 行滚动文本。

SDK 1.1.0 `wordWrapLine` 在布局只有 1 列且出现 2 列 CJK 单字时递归重包同一字，触发 RangeError；原版 Pretty 和 adapter 的错误完全一致。Pretty 额外预留 prompt padding，所以比裸 SDK 更容易命中此限制：

| user padding | 本矩阵中 Pretty/adapter 的 CJK 失败宽度 |
| --- | --- |
| 0 | 1、2、3、5、7、9 |
| 1 | 1、2、3、5、7、9 |
| 3 | 1、2、3、5、7、9、11 |

限制按 SDK 布局公式显式界定：effective padding 为实际 padding 与 `floor((width - 1) / 2)` 的较小值；layout width 必须至少 2 才能容纳本 fixture 的 CJK 字。Pretty 实际 padding 为 user padding + 3（user padding 为 0 时再加 1）。因此不使用简单“所有宽度小于 N 都跳过”的方式。

126 个 render 参数组合中：
- 19 个 CJK 组合：分别显式断言原版 Pretty 与 adapter 都抛相同 RangeError，同时验证裸 SDK 自己的可用/失败界限。
- 3 个 width=1 的聚焦多行组合：裸 SDK、Pretty、adapter 都溢出到 2 列；显式断言该既有限制并保留 Pretty/adapter 输出对比。
- 104 个支持组合：Pretty/adapter 逐行相同，显示宽度不越界；80 列滚动时出现 more 标记且隐藏 prompt。

没有 skip；不把这些既有缺陷描述为已修复，正式集成仍需决定是否另行处理 SDK/Pretty 极窄限制。

## 最终命令与结果
均从隔离 worktree 执行：
1. `node --test extensions/pretty-compat/__tests__/prototype.test.ts`：退出 0，**12 通过、0 失败、0 skipped**；最终输出在 `extensions/pretty-compat/__tests__/last-results.txt`。
2. `PROTOTYPE_REQUIRE_ORIGINAL_HISTORY=1 node --test --test-name-pattern='original Pretty history-first' extensions/pretty-compat/__tests__/prototype.test.ts`：预期退出 1；期望 `previous session latest`、实际空字符串，保留原始历史丢失的失败回归。输出在 `extensions/pretty-compat/__tests__/original-red-results.txt`。
3. 使用只读 `PI_SDK_DIR` 与 `mktemp -d` agent-dir 执行 `pnpm typecheck`，随后删除临时目录：退出 0。
4. `node --test scripts/pi-manifest.test.mjs`：退出 0，4 通过，证明 nested 原型没有成为扩展入口。
5. `git diff --exit-code HEAD -- extensions/bash-unified.ts package.json pi-preset.json pnpm-lock.yaml README.md`：退出 0，正式边界未改。
6. `git diff --check`：退出 0；另直接检查新原型与本文无行末空白。

未运行 pnpm check/全量测试：本轮只获批限时原型，不提议 commit。

## 已有证据与剩余评审点
- 支持 embedded status/border hooks 的旧 CustomEditor factory：双顺序历史、真实状态生命周期、identity/subclass、直接装饰前后草稿/光标、多行输入、Tab 补全、应用/扩展快捷键、submit/change、重复装饰/释放、后来 render/factory 所有权均有通过证据。
- 默认不支持 embedded status 或缺少 border hooks 的第三方 editor 仍明确抛设计评审错误；没有无声降级或修改 readonly embedWorkingStatus。任意 editor 兼容性未证明。
- host setter 自己会 setText 重置创建时光标；直接装饰不改变光标，不代表跨 editor factory 的光标迁移已解决。
- native working controller 后来插件所有权、长期包装层/资源增长、自定义不委托 super 的 render、异步复杂补全以及真实 Pi CLI 的完整 new/reload 未覆盖。
- 19 个极窄 CJK 错误及 3 个 width-one 光标溢出是保留的上游限制，不是本轮修复；需主会话评审是否接受行为一致，或另开范围修复。
- 结论：本轮三个失败已闭合，中心实例装饰方案在已测 SDK/Pretty 契约下可行；仍未授权正式集成或发布。
- implement.md 要求 task.py start 的步骤与子代理生命周期禁令冲突，未执行；后续设计收敛、正式入口、README、独立审查、规范更新与 commit 均留给主会话决策。
