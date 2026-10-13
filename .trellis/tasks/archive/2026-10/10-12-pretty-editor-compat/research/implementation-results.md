# Pretty 编辑器兼容正式实施结果

## 隔离与范围
- 所有命令以 `cd /Users/jyxc-dz-0101322/tools/my-pi-preset-pretty-editor-compat` 开始，所有写入都在该 worktree（依赖测试使用临时配置/session 目录并清理）。分支 `feat/pretty-editor-compat`，基线 `07ec6bc`。
- 未操作原 `feat/unified-task-panel` worktree；未复制其 processTasks/agentTasks 或其他未提交运行时代码。`extensions/bg-tasks/`、package.json、pi-preset.json、pnpm-lock.yaml 与本分支 HEAD 相同。
- 不改全局 settings、不改 node_modules 依赖源码、不执行 task.py start/finish/archive、不提交。
- 依赖和 SDK 链接由前轮原型已准备，本轮复用 worktree 安装的 Pretty 0.6.31 与真实宿主 SDK 1.1.0；没有新依赖/npm lock。jiti 由实际 SDK 安装提供。

## 修改文件
- `extensions/pretty-compat/editor.ts`：正式 nested helper；装饰前检查 embedded status、border hooks、可写 data methods、extensibility 与 padding；异常降级警告，保持原 editor identity/prototype/history/输入方法。
- 同 helper：复用真实 Pretty 的 RenderBridge；记录原方法 descriptor，构造/部分写入失败回滚 padding/hooks；清理只恢复仍拥有的方法与 underlying padding，后来 getter/setter/render/border 接管保留，已冻结 wrapper 停用透传。
- 同 helper：局部 Pretty 生命周期代理；先经实际 host setter 安装，成功后才提交 slot，失败通过正常 setter 恢复旧 factory/container/focus，旧 factory 失效时默认输入框恢复。每 slot 一个 live lease；退休 factory 清空 builder，显式退休 factory WeakMap 展平，不改其他插件的 opaque wrappers。
- `extensions/bash-unified.ts`：只给原 Pretty 调用增加兼容边界；bgTasks execution/parameters/唯一 bash ownership 与 promptSnippet 逻辑不变。
- `extensions/pretty-compat/__tests__/editor.test.ts`：替代 prototype.test.ts，38 项生产 helper 回归，含真实 bash-unified import；原始 Pretty 红/正常对照保留。
- `extensions/pretty-compat/__tests__/harness.mjs`：实际 SDK setter/reset/status、实际 Pretty，通过 SDK jiti 加载；临时 agent-dir、FFF seam、隔离事件/app callbacks。
- `extensions/pretty-compat/__tests__/history-fixture.mjs`：独立编写的忠实核心契约 fixture，彻底移除默认本机 input-history source 路径；不是 vendor，不复制依赖源码。
- `extensions/pretty-compat/TESTING.md`：来源、离线执行与非 E2E 限制。README 同步兼容行为、安全降级、极窄边界与定向无 force-exit 命令。
- `implement.md`：更新已完成项和过时步骤解释。本研究目录保存本轮 focused/check/原始 red 输出；前轮原型输出从扩展测试目录移至本研究目录并加 prototype 前缀，避免把旧结果当成生产结果。

## SDK 与 Pretty 实证
只读检查实际 SDK `dist/modes/interactive/interactive-mode.js` 的 setter（2242 起）与 reset（1898 起）、`handleReloadCommand`（5357 起），以及 `dist/core/agent-session.js` 的 reload（2936 起）。setter 顺序是写 factory → 保存文字 → 清 container → 工厂构造 → callbacks/text/padding/autocomplete/app handlers → addChild/status/focus。因此不能仅恢复 slot，必须重新走正常 setter 才能恢复 UI。

真实 `/reload` 是 resetExtensionUI → reload UI → session.reload → old-runner shutdown → 新 runtime/session_start；runtime invalidation 也先 reset UI。测试调用实际 resetExtensionUI，然后 old handlers shutdown，清掉旧 handlers 再激活新 closures，双顺序每种 25 轮。不是只重复 session_start。

实际 Pretty `src/index.ts` 的 installPromptEditor 保存旧 factory 但不调用它，shutdown 再恢复旧 factory；`src/prompt-editor.ts` constructor 立即调整 padding，证明必须先 preflight，且 constructor 异常也须恢复。没有 previous factory 时依旧使用原 PromptEditor，不声称能把这个类的外观在废弃实例上撤销；撤销仅适用于本 helper 的 lease。

## 验证命令与结果
以下命令均在授权 worktree 执行；输出相对路径均在本研究目录。

```sh
node --test extensions/pretty-compat/__tests__/editor.test.ts > .trellis/tasks/10-12-pretty-editor-compat/research/focused-results.txt 2>&1
```

结果：**38/38 通过，0 skip，自然退出**，没有 `--test-force-exit`。验证双顺序 cold/new/reload、同 cwd 历史、current history、search query/选择/取消/branch、原 instance/subclass/草稿/光标、Tab、多行、submit/change、app/extension handlers、真实 Pretty/working render；readonly/accessor/missing hook/nonembedded/nonextensible、constructor/write/host partial failure、later 方法/padding/factory、单 live lease 与 reset-before-shutdown。

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check > .trellis/tasks/10-12-pretty-editor-compat/research/check-results.txt 2>&1
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

结果：tsc 无诊断；全量 **363/363 通过，77 suites，0 skip**。PI_SDK_DIR 实际为 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules`。项目 pnpm test 本身含 force-exit，故不能用此全量结果单独声称无泄漏；上述定向自然退出才是本任务证据。

```sh
PROTOTYPE_REQUIRE_ORIGINAL_HISTORY=1 node --test --test-name-pattern='original Pretty history-first' extensions/pretty-compat/__tests__/editor.test.ts > .trellis/tasks/10-12-pretty-editor-compat/research/original-red-results.txt 2>&1
```

结果：**预期退出 1**；actual `''`，expected `'previous session latest'`，保留真实 Pretty 原始丢历史红测。正常运行同时验证原 Pretty history-first 为空、pretty-first 成功，以及生产 helper 两顺序成功。

```sh
git diff --check
git diff --exit-code HEAD -- package.json pnpm-lock.yaml pi-preset.json extensions/bg-tasks
```

结果：均退出 0。manifest 顶层/nested discovery 测试包含在全量通过结果内。

Markdown/新文件空白检查：执行 `python3 .trellis/tasks/10-12-pretty-editor-compat/research/check-markdown.py > .trellis/tasks/10-12-pretty-editor-compat/research/markdown-results.txt`，扫描 README、pretty-compat 与 task 的全部 Markdown（含新文件），解析相对路径并检查 anchor，检查代码/文档行末空白；不联网。结果记录于 `markdown-results.txt`。

## 本轮中间失败与修正
- 直接 node import runtime Pretty `.ts` 遭 Node 的 node_modules type-strip 禁令：helper 改 type-only import，由正常 runtime wrapper 或 harness jiti 提供实际 createPromptEditorClass，没有改依赖源码。
- 初版测试 TS 隐式参数类型错误：补显式 SDK Factory/Base 类型后全量通过，不使用 any/ts-ignore。
- pretty-first 无旧 factory 的废弃原生 PromptEditor 仍有 `❯`：测试纠正为只要求撤销自己 lease，仍断言 default editor/container/factory/status 已正确恢复；没有修改验收的活跃 editor 外观。
- production wrapper harness 缺 setExtensionStatus：补宿主无副作用 seam，随后正式 wrapper 回归通过。
- 冻结 wrapper 的 Reflect.deleteProperty 返回 false 不抛异常：helper 显式识别失败、保留 inactive passthrough 并诊断。

## 计划解释与剩余边界
- 实施计划中“仅原型、不改正式入口”和 task.py start 是此前阶段遗留；本轮用户已明确批准正式集成，按批准的新阶段实施。子代理生命周期禁令优先，start/finish/archive 留主会话。
- 本轮优先安全正式集成与有意义回归，未启动真实 Pi CLI 执行 `/new`、`/reload` 的全部 runner/resource-loader/chat UI 流程。实际 SDK 方法 + 精确 reset/shutdown 顺序是集成模拟，不是 CLI E2E。
- Alt+R 使用独立 fixture 的 query/selection/cache 合同；没有使用真实 pi-input-history 搜索组件，未证明它全部 fuzzy highlight/配置/预览 UI。前轮真实包原型证据仍在 prototype-validation.md。
- host setter 持续故障无法用公开 UI API保证恢复；旧 factory 也失效时退回默认输入框，无法保留失效插件历史。正常可用 editor 和 readonly/missing hooks 降级路径保持编辑/history，不破坏 UI。
- Pretty/SDK 极窄 CJK 递归溢出、单列光标越界保持原版对照失败，未修复；复杂异步补全、未来 SDK/Pretty 契约与所有第三方 renderer 未验证。
- 不全局劫持 working UI API；后来插件接管 Pretty working-controller setter 的行为仍由上游决定，不在 editor helper 所有权内。
- 独立 trellis-check、规范更新、commit、任务收尾由主会话决定。本分支 README 与 bash-unified 后续和 unified-task-panel 合并时仅移植本任务局部兼容调用，保留目标分支自身的 tool ownership，不搬旧 bgTasks 全文件。
