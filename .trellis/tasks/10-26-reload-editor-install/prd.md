# 修复 reload 后编辑器扩展安装失效

## 目标与范围

修复 `/reload` 后 ↓ 无法打开任务面板的问题，同时修复使用相同安装方式的 Beautify 编辑器外观和 @ 路径补全。保持现有编辑器 handoff、功能行为和真正不支持时的降级逻辑。

用户已同意创建 task，并明确批准上述聚焦范围的实施。只补针对性回归，不追求完整测试矩阵。

## 已确认事实

- Pi 1.4.0 的 `dist/modes/interactive/interactive-mode.js:5337,5346-5349,5369,5395`：先重置扩展 UI，再把 reloadBox 挂到编辑器槽位并拿走焦点；`session.reload()` 返回后才恢复编辑器挂载和焦点。
- `dist/core/agent-session.js:3028` 在上述空窗期等待所有扩展的 `session_start(reason: "reload")`。
- `extensions/task-ui/editor.ts:89,104-105,117-119` 提前置位 installed，因焦点不是 live editor 抛错并 close，导致当前 activation 永久失效。
- `extensions/beautify/editor/owner.ts:44,58-62` 和 `extensions/at-path-completion/index.ts:24,46` 存在相同问题。
- `extensions/beautify/__tests__/editor.test.ts` 的现有 reload 矩阵执行了 reset/shutdown/start，但没有模拟 reloadBox 占据焦点。

## 修复要求

1. 临时焦点缺失不得当作编辑器能力不支持，不能因此永久退休。
2. 等待宿主恢复编辑器必须脱离 `session_start` 的 await 链，否则宿主无法完成 reload 并交还焦点。
3. 三处共用一个窄的延迟安装辅助逻辑，优先放在已有 `extensions/editor-handoff/` 内，不新增通用 UI 框架。
4. 等待任务由当前 activation 持有；关闭后取消等待，不得晚安装或复活旧 activation。重试不重复安装，不抢焦点、不关闭其他 overlay。
5. 真正缺少公共能力、描述符操作失败和 setter 失败保持现有诊断、释放与回滚路径；不复制文本重建编辑器、不读取私有编辑状态。

## 实施与验证计划

单一提交阶段：共享延迟安装辅助逻辑 → 三处接入 → 最小回归 → 审查和提交。

- 主会话实施；生命周期共享逻辑由独立 reviewer 做聚焦检查，不扩展范围。
- 补最小 reloadBox → editor 焦点恢复用例，验证 handler 不阻塞、恢复后功能安装；覆盖等待中关闭不产生晚安装。优先复用现有 harness，不建设真实终端 reload 驱动或扩展排列矩阵。
- 运行 typecheck 和三处已有 editor/owner 相关测试，具体命令与结果在实施后记录于本文件。
- 按项目工作流提交已验证的范围；不 push、不安装依赖、不操作个人 Pi 配置、不自动归档。

## 验收标准

- reload 焦点空窗不再触发三处的 unsupported/installation failed 永久降级。
- 焦点恢复后 ↓ 打开面板、Beautify 外观和 @ 路径补全重新可用，且同一 activation 不重复安装。
- 延迟安装保留原 live editor 身份与现有 handoff 保护；关闭后不再安装。
- 相关现有测试和 typecheck 通过；新增测试只覆盖本次缺陷及等待资源释放。

## 排除项与风险

不修改宿主 SDK，不做编辑器架构重构，不增加用户配置，不扩大为 overlay/对话框系统改造，不新增全面测试矩阵。

不能仅把 installed 后移：reload 完成后不会再发一次 session_start。延迟机制必须主动重试。实现不设等待超时，避免把慢 reload 判成能力不支持；等待随 activation 关闭清理。

## 实施结果与验证

- 已实现 `installWhenEditorFocused`：同步完成不挂载的 TUI probe；焦点未就绪时每 25ms 在事件 await 链之外重试。聚焦编辑器后进入各自原安装事务，关闭时清理 timer，不抢焦点、不关闭既有 overlay。
- 三处均接入同一辅助逻辑，安装启动标记防止重复 session_start 产生多个等待；延迟恢复保留 live editor 和原 handoff/rollback。
- 新增 `extensions/at-path-completion/__tests__/reload.test.ts` 两个针对性用例，组合验证三处恢复及等待中关闭。原 owner 失败矩阵移除 overlay（它现在属于延迟状态，不应期待 unsupported 错误）；其余能力失败、setter 回滚断言保留。
- `.trellis/spec/development/index.md` 补充 reload 时序和延迟安装约束，无用户文档或 SDK 改动。

检查使用现有 Pi SDK 1.4.0，主会话配置隔离于本次自建 `/tmp` 目录，未下载依赖或操作个人 Pi 配置：

| 命令 / 检查 | 结果 |
| --- | --- |
| `PI_CODING_AGENT_DIR=<本次临时目录>/agent pnpm typecheck` | PASS，exit 0 |
| 同一隔离环境 `node --test extensions/at-path-completion/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/beautify/__tests__/editor.test.ts` | PASS，105/105，自然退出，exit 0 |
| 独立 trellis-check：`node --test extensions/at-path-completion/__tests__/owner.test.ts extensions/at-path-completion/__tests__/reload.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/beautify/__tests__/editor.test.ts` | PASS，56/56，自然退出，exit 0；未发现阻塞缺陷，无文件修改 |
| 同一隔离环境 `pnpm check` | PASS，typecheck 与完整测试 1725/1725，exit 0；完整套件按项目配置使用 forced exit，自然退出由上述聚焦检查另行验证 |
| `git diff --check` | PASS，exit 0 |
| `python3 .trellis/scripts/get_context.py --mode packages --json` | PASS，development/testing 两层仍可发现 |

主会话已核对实际 diff 与主/子检查原始日志。本次无失败检查。未运行真实终端 `/reload`，实际宿主 focus/setter 由现有 SDK harness 驱动，不能据此宣称个人安装已更新或真实终端已验收。

未使用的 `implement.jsonl` 保持空，start 使用 `--allow-empty-context`；不把该选项描述为所有角色 manifest 的完整验证通过。任务留在当前会话，未归档、未 push。

