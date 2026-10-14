# 独立检查报告：@ 路径连续补全

## 审查范围与约束
本轮为 `trellis-check` 独立复核，不以实施报告代替源码检查。已读取 `check.jsonl` 每项（完整 hook 材料）、PRD/design/implement/feasibility/native-trigger/implementation-report，以及唯一入口、全部 5 个嵌套生产模块（初始合计 276 行）、全部原有测试/fixture/GC 脚本、TESTING、README 本任务片段、actual host loader 与 manifest diff。另核对本机 Pi 1.2.0 的 Editor/CustomEditor、autocomplete、keys、InteractiveMode provider/setter 的实际 JS。

已审查 staged/unstaged/untracked 状态；staged 为空。未给 Review base，**未审查已提交历史**。现有并行 Beautify shell-collapse、`.pi`、其他任务与 spec hunk 保留，未编辑。自修仅 `extensions/at-path-completion/{editor,provider}.ts`，新增 `__tests__/check-regressions.test.ts`，更新本扩展 TESTING 与本任务检查证据。未 stage/commit/push/install/sync/reload/archive、下载依赖、修改 SDK、派发其他 agent 或管理任务生命周期。PRD AC/spec 收尾留主会话。

## 确认问题与自修
1. `provider.ts:36-45`：原 `owned` 取决于请求开始时 `ready`，因此输入 `/` 后在 50ms native debounce 前失焦或打开 overlay，请求进入时反而不视为 owned，结果原样返回并开框。改为按 `@` token 确定范围，在调用 current 前验 focus/overlay/allowed，并在 await 后再校验。实际 early-focus/early-overlay 红测均复现 `true !== false`，修后通过。
2. `provider.ts:34-45` / `editor.ts:23-39`：原代次过滤作用于所有 provider 查询；`#` 自定义 trigger 的 pending request 遇 native no-op Copy 会被误丢，普通非 `@` force Tab 遇已处理 shortcut 会被 public setter 取消。改为额外过滤与 Tab intent 仅作用于 `@` token。另把候选 request revision 和后处理 generation 分离：native Copy 保候选请求（含 `@agent`），仍失效目录微任务。实际 native 对照 `#tagx` 为开框、增强原版却关闭；普通 Tab 红测停在 `plain` 而非 `completed`，均修复。
3. `editor.ts:70-102`：原 release/cancel 从当前顶层 `setAutocompleteProvider(lastObservedArgument)` 重入 later delegating setter，若 later 已转换 provider，会重复包一层。改为重放观察层收到的 exact public 参数到该层 predecessor，并要求当前 setter identity 与上次观察匹配；later nondelegating setter 未再经过本层时不回写旧 chain。真实 SDK 红测 shutdown 后一次 Tab query=2（应1），修后=1；后装 method identity 与 nondelegating 替换均保留。lease 关闭清 `providerOwner/cancelRequest`，原 GC 保持通过。
4. `editor.ts:7-13`：modifyOtherKeys slash 只接受 modifiers 1/2，遗漏 SDK 已支持 Caps/Num Lock。按 SDK printable 规则允许 Shift/64/128 bits、拒绝其他 bits，并保留实际插入前后文本／cursor验证。新增3个 actual TUI encoded slash 用例，均只发 ordinary 请求、不自动接受。

新增11个 check 用例还验证目录判断须同时满足原生 `label.endsWith('/')`、`@` value 与结果 `@.../` 光标，异形 agent/file/value 不续开。此 label 规则是 Pi 1.2 native `applyCompletion` 自身的目录判据，不扩大识别未知装饰 label。其余已有 Tab/Enter/mouse/forceTab、单项只展示、文件尾空格、submit、receiver、paste、history、undo、rollback、opaque retirement 与 GC 原断言均继续通过。

## 红证据
- 首组未修产品：5 tests，1 pass / 4 fail（early focus、early overlay、unrelated provider no-op Copy、later setter重复转换）；[check-red.log](./check-red.log)。
- 补充 agent mention：9 tests，8 pass / 1 fail；[check-agent-red.log](./check-agent-red.log)。
- 补充普通非 attachment Tab：10 tests，9 pass / 1 fail；[check-tab-red.log](./check-tab-red.log)。
- lock-modified编码在首组红后加入，未单独保存旧实现运行红日志；不声称其有已运行的红证据。

## 最终实际验证
读取既有 SDK node_modules：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules`。所有执行临时 `PI_CODING_AGENT_DIR`，离线，末尾删除；完整检查显式给 `PI_SDK_DIR`，SDK link 脚本报告 0 new links。

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
export PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir"
node --test extensions/at-path-completion/__tests__/*.test.ts
node --test extensions/beautify/__tests__/editor.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/agent-tasks/__tests__/loading.test.ts
node --test scripts/pi-manifest.test.mjs
pnpm check
# 实际逐条捕获 focus/related/manifest/full exit code，最后 rm -rf agent_dir
```

| 检查 | 实际最终结果 | 证据 |
| --- | --- | --- |
| 独立扩展，无 force-exit | PASS，60/60，exit0，自然退出，0 skip | [check-focused-final.log](./check-focused-final.log) |
| actual editor/host loader，无 force-exit | PASS，47/47，exit0，自然退出 | [check-related-final.log](./check-related-final.log) |
| manifest | PASS，6/6，exit0 | [check-manifest-final.log](./check-manifest-final.log) |
| strict typecheck | PASS，独立 `pnpm typecheck` 与最终 `pnpm check` 均exit0 | [check-full-final.log](./check-full-final.log) |
| 完整离线 tests | PASS，671/671，exit0，0 skip | [check-full-final.log](./check-full-final.log)；完整日志 `/tmp/at-path-check-full-final.log` |
| tracked whitespace | PASS，`git diff --check` exit0 | 本轮命令输出 |
| 本任务新源码/文档 whitespace | PASS，逐行扫描 `extensions/at-path-completion.ts` 与嵌套目录无尾空白 | 本轮命令输出 |
| lint | NOT_AVAILABLE；package 无独立 lint 命令 | package.json |

full 数量含并行任务新增用例，故由实施报告656增至671；不是本任务新增15项。full 按项目脚本带 `--test-force-exit`，不当自然资源退出证据。最终生产代码验证后仅文档/报告/日志有更新。

## 仍需明确的风险／未运行项
- 唯一 private 能力仍是 `tryTriggerAutocomplete(false)`；未新增 private state/requestId/history/undo/paste依赖。host 不支持 `dist/utils.js` 子路径，生产仍无 Node-only 私有路径 import，actual loader通过。
- 不重设计 search/sort/ignore/recursive/20cap；native fd 临时目录/home隔离用例实际执行、0 skip。
- provider 安装按宿主规则取消当时 list/request，这不是 live editor/history丢失。后装不委托 chain/factory 的未知插件不保证增强；ownership不匹配时宁可不回写旧provider，不能保证其自身未委托 native请求的取消。
- generation/query revision 可拦已观察输入与结果时的失焦；纯瞬时失焦后又在结果前回到同一实例且无输入，不存在全局focus订阅，本任务不承诺任意未知plugin瞬时行为。
- **真实 CLI/PTY、IME、实际 input-history 原包未运行**；actual SDK/TUI/setter、离线 public history/provider fixture 与 GC 不能冒称上述全链路验收。

## 结论
本次确认4类问题已窄范围自修，新增11个实际 SDK 回归；最终60/47/6定向及671完整离线全绿。当前无确认未修的任务范围内缺陷；以上兼容风险与终端验证限制保留。请主会话读取实际 diff并维护 specs/PRD AC，再按用户另行授权决定收尾。
