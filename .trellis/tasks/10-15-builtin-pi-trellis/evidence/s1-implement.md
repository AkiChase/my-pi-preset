# S1 实施记录（trellis-implement，自检，非独立审查）

基线：邻仓 `d0e07c94c8f586fdf6e6c98a3127133293faeb90`（`24e3cef` 之上的 "fix(init): restore menu actions for older manifests and unify menu copy"）。初次导出自 `24e3cef`（`git archive`），随后按路径映射用 `git apply` 套入 `24e3cef..d0e07c9` 的产品差异（`extensions/trellis.ts`→`extensions/trellis/index.ts`，`lib/`→`extensions/trellis/lib/`）。adoption/command/resources/task-browser command 与 d0e07c9 字节一致；index.ts、diagnostics.ts 仅保留本仓路径归属与严格类型改动。runtime/resources/agents/skills/licenses 与基线字节一致，无需改 hash/baseline。

## 测试策略（用户决定）
只保留纯函数/逻辑测试；移除 UI/TUI、真实 Pi host/SDK 会话、挂载 overlay 及低价值端到端用例。d0e07c9 的旧 manifest 补齐修复由 resource-update（Update 计划）与 init-diagnostics（Check 规则，已验证回退实现会失败）逻辑测试覆盖。

## 验证（隔离：临时 PI_CODING_AGENT_DIR，已链接的 SDK 1.2.0）
| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `node --test extensions/trellis/__tests__/*.test.mjs`（无 force-exit、无 preload） | 见最终报告 |
| `python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'` | 见最终报告 |
| `node --test scripts/pi-manifest.test.mjs scripts/sync.test.mjs` | 见最终报告 |
| `pnpm check` | 见最终报告 |

## 限制
- 未做真实 PTY、物理鼠标、在线模型、安装/sync/reload；真实 host 加载/挂载 UI 不再由本插件测试覆盖。
- dispatch.test.mjs 每例需要真实 init + Git + Python worktree fixture，决定套件墙钟时间。
