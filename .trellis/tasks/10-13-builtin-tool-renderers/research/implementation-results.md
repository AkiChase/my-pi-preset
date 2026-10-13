# 实施结果（交主会话独立审查）

## 范围与环境

- 任务：10-13-builtin-tool-renderers。仅实施 beautify 与 Pretty 移除，没有提前 rename bash-unified。
- 执行目录：`/Users/jyxc-dz-0101322/tools/my-pi-preset`，main；SDK 为实际安装 Pi 1.2.0，Node 24.14.1。
- 显式 SDK 路径：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules`。
- 验证均使用临时 `PI_CODING_AGENT_DIR`，后清理；editor harness 额外创建并清理自己的临时 agent/session。没有第二 SDK、在线模型／网络／真实 git 执行。
- 起始 dirty 为 `.pi` 四个集成文件与 builtin-tool-renderers、rename-task-composition、task-panel-redesign、task-presentation-unification 四个任务目录。未编辑 `.pi`、其他 task 或 spec；未 stage/commit/push/finish/archive，未个人 pi install/sync/reload。

## 实际修改

### 自有展示与输入框

- 新建 `extensions/beautify.ts`，独立入口；`extensions/beautify/index.ts` 只注册公开 `registerToolRenderer` resolver，仅匹配 read/bash/find/grep，其他工具调用 next。
- `beautify/{types,layout,highlight}.ts`：纯展示输入、外部控制字符清理、SDK 列宽布局、长路径中间省略与原子 offset、one-dark-pro Shiki、80k 上限、128 项／2Mi 字符 LRU、关闭清理及一次不含源代码／路径的诊断。
- `beautify/tools/{read,bash,find,grep,shared}.ts`：Read 1-based 行号、代码与精确 notice 分离、host 图片保留；Bash timeout／调用耗时 0／后台 ID/log/error 文案；Find/Grep 顺序分组、可见数量、match/context 分离、literal/ignoreCase 安全高亮。
- Read 复用 actual host result slot，每次内容／展开／宽度／主题变化使旧 revision 失效；Shiki 回调以独立函数 + WeakRef，不捕获旧 ctx，关闭后不刷新。host invalidate 的未变文本不会抹掉已成功 ANSI。
- `beautify/editor/{appearance,owner}.ts`：装饰实际活实例，不重建原 editor；上下原生规则、无左右竖边框、首行 ❯，续行／向上滚动不重复。原 native layout、IME marker、history/undo/paste/autocomplete/input/mouse 方法保持。
- 新建 `extensions/editor-handoff/index.ts`，局部抽取 task-ui 的 public descriptor／同步 protected handoff，仅增加 proxy define-then-throw 的 owned rollback；`task-ui/editor.ts` 复用，无 coordinator/panel 重构。
- appearance 与 Down 两种 session_start 顺序均通过实际 host 测试；Down 禁用仍有外观。失败时保原 UI，partial setter/focus mount 失败用同实例 protected rollback 修复容器；后来 wrapper/factory/padding 保留，cleanup 后无资源 inactive forwarder，reset-before-shutdown 不重装旧 factory。

### 依赖／执行／迁移

- `extensions/bash-unified.ts` 直接调用 processTasks 注册原始 Bash，保唯一 lifecycle/coordinator/UI owner 和 agent guard，删除 Pretty import、Proxy/capture、snippet patch 和 lifecycle bridge。
- 删除完整 `extensions/pretty-compat/`；有效 history/实际 host/输入状态/所有权/failure 回归迁移到 `beautify/__tests__`，Pretty 本身默认／Claude 样式算法与 FFF 专属断言不再适用。
- `package.json` 直接 dependencies 为 shiki、@shikijs/cli `^4.0.2`；`pnpm install` 更新当前 checkout/lock，实际解析 4.5.0。移除 Pretty 及其不再需要的依赖；SDK 仍为 host peer。
- `pi-preset.json` 删除整个 pi-pretty.json files 声明，不 tombstone、不读写或删除个人旧配置；Pretty source 保留在 conflicts 禁止共存。
- 迁移 `task-ui/__tests__/editor-host.mjs`、`editor.test.ts` 和 agent `host-loading-smoke.mjs` 的实际 Pretty/FFF imports。hard loader 的 root/child tools 仅计真实扩展注册，read/find/grep 继续由宿主内置工具提供；ALS/manager/shutdown 断言保留。
- scripts/pi-manifest 与 sync tests 增加独立入口、direct Shiki、无 Pretty dependency/config，以及 malformed legacy file 在 merge/prune 下均完全不触碰的回归。
- 更新 README 全部相关行为／依赖／配置／入口／检查说明，beautify PROVENANCE/TESTING 和两个后端 provenance；修正 process config、status-bar 的过时 Pretty 当前实现注释。规范更新按主会话指示留给主会话最后完成。

## 验证与实际结果

以下环境均设置 `PI_SDK_DIR` 为上述 1.2.0 路径、`PI_CODING_AGENT_DIR=$(mktemp -d)`，结束后删除临时目录。

| 命令 | 结果 |
| --- | --- |
| `pnpm install` | 成功；仅本 checkout/lock，Shiki/CLI 4.5.0，移除 Pretty |
| `pnpm check`（最终） | strict typecheck 成功；568/568 tests，0 skipped；约 20 秒。package test 自带 force-exit |
| `node --test extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/agent-tasks/__tests__/loading.test.ts scripts/pi-manifest.test.mjs scripts/sync.test.mjs`（最终） | 49/49，0 skipped，约 15 秒，自然退出 |
| `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts` | 519/519，0 skipped，约 15 秒，自然退出；后续 beautify-only 增补由最终全量覆盖 |
| `node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"`（最终，不加 force-exit） | 568/568，0 skipped，约 20 秒，自然退出 |
| `git diff --check` | 成功 |
| `python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-13-builtin-tool-renderers` | implement/check 各 9 entries 有效 |
| README、新 beautify PROVENANCE/TESTING 的本地 Markdown 文件链接检查 | 成功 |

实际 host seam：loadExtensions + ExtensionRunner.resolveToolRenderers + ToolExecutionComponent，不复制 host 实现；Read execute 的公开 ReadOperations 只读一次，definition.execute/parameters/guidelines 及原结果深比较保持；host imageComponents 为 1。四类组件测试实际 expanded/collapsed、outputPad、1/2/8/20/40/80/120 列、中文与窗口变化。keyboard hint 通过实际 user remap Alt+O（macOS 文案为 Option+O）。

实际 editor seam：InteractiveMode setter/reset、CustomEditor/TuiMainScreen；history-first/last × Down-first/last × enabled/disabled；cold/new/reload、搜索接受/取消、subclass/receiver、cursor/undo、history draft、active large-paste token、active autocomplete、IME marker、callbacks/actions、unsupported/accessor/nonextensible、partial mount/focus rollback、opaque wrapper/locked method 与真实 GC。原 Down GC 4/4 保留；新增 appearance/factory ctx/TUI GC 2/2。

### 反向验证与迭代

- 临时把真实 codeToANSI 返回改为 plain：`--test-name-pattern 'Shiki ANSI'` exit 1，ANSI 断言失败，恢复。
- 临时恢复旧 `clip(path + suffix)`：首轮旧测试 exit 0（不能称反向成功）；补强“width >= 3 必须保留 :65”后重跑 exit 1，恢复，最终绿。
- 临时省略 owner preserveHandoff：`--test-name-pattern 'live handoff preserves'` exit 1，实际 cursor 从 col6 被 host 重置为 col7，恢复。
- 初轮 Node strip-only 不支持新写的 parameter properties，已改普通字段；类型／fixture constructor／原始 host focus／single-item autocomplete／macOS Option 名称不匹配均已修正并重跑，未把 fixture 错误当产品红证据。
- 新 editor 极窄中文／光标断言显示 SDK 原生错误；测试用未装饰 native editor 对照，保留边界而不是删测试宣称修复。

## 不足与主会话后续

1. 未做实际 CLI/PTY、实际 pi-input-history 包、fullscreen 或任意第三方 editor 的端到端验收；这里是实际 host seam + 独立历史 fixture。
2. SDK 1.2.0 的一列正文双宽中文递归溢出、极窄聚焦光标超宽仍存在，native 对照确认；不在本任务修改宿主。
3. Grep regex 高亮只支持可安全同步处理的 JS 子集；nested quantifiers/backrefs/不支持语法/零宽/过长模式或行保守不高亮，搜索执行原样。未知 ambiguous path 保留原文本，不伪造统计。
4. 精确 host notice 模式无法消除源文本恰好与宿主 notice 完全同形的固有歧义；未知格式保留。超窄完整路径标题用列宽换行，不额外读文件。
5. 没有新增任何鼠标／选区／clipboard；不保证原生终端复制能还原软换行。
6. 本代理未派发 check（按角色禁止）；请主会话做独立审查、补规范与最终验收，再执行后续 rename task。PRD/计划验收未自行勾成独立审查通过。

测试详细日志保留在 `/tmp/beautify-check-final.log`、`/tmp/beautify-focused-final.log`、`/tmp/beautify-natural-final.log`、`/tmp/beautify-backends.log`、`/tmp/beautify-reverse-{ansi,path,handoff}.log`；这些是本机临时证据，不是发放资源。
