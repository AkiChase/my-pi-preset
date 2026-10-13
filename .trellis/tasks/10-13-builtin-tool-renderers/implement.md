# 实施计划

## 0. 实施前门禁

- [x] 用户确认 design.md §5 输入框外观；已同步到 PRD。
- [x] 收敛 PRD/design/implement，确认无阻塞 UX 决策。
- [ ] 用户在最终规划摘要后明确批准实施，再 task.py start；本轮不 start。
- [ ] 实施者读取 implement.jsonl 全部规范与研究。独立 check 读取 check.jsonl。
- [ ] 记录 git status 与共享文件无关 hunks；其他 task-panel 规划、.pi 集成不得修改或纳入提交。
- [ ] 记录当前真实 SDK 路径/版本、test baseline；依赖安装只在授权实施后使用 pnpm，不操作个人 Pi install/sync。

## 1. 建立原生 renderer 回归

- [ ] 建 beautify 嵌套美化模块与 node:test，tools/ 提供四类公开 registerToolRenderer，editor/ 提供输入框外观。
- [ ] 用真实 host resolver/ToolExecutionComponent 验证命中 renderer，不重注册工具；其余工具 next，图片只渲染一次。
- [ ] 实际 composition 断言 process Bash schema/execute/guidelines 不被更改，root/child 工具单一性与生命周期保留。

## 2. 四类视图和高亮

- [ ] 公共列宽、控制字符安全、标题与统计布局；折叠路径省略中段，:offset 原子性，展开完整路径。
- [ ] Read 原始文本/notice/图片/错误/空内容，1-based offset；代码行号与 notice 分开。
- [ ] 添加直接 runtime Shiki 依赖；支持既有语言映射、one-dark-pro、80k 字符上限、128项/2Mi字符 LRU、生命周期清理。
- [ ] 高亮异步 revision、宽度/展开/主题变更与迟到回调；plain fallback 和一次诊断。
- [ ] Bash 原始输出/空输出/错误/timeout/duration0/缺 duration/后台 handle，不伪造完成状态、不读取额外日志。
- [ ] Find 路径分组、可见数量、limits/no result。
- [ ] Grep match/context/limits 解析、literal/ignoreCase/无效及零宽 regex、歧义路径安全 fallback。
- [ ] Unicode/ANSI/宽度变化输出均不超过传入 width，长代码行 › 截断而非误折行。

## 3. 自有输入框（已确认上下规则样式）

- [ ] 实现 appearance 与 owner，保留原实例；仅外观方法装饰，不接管 mouse/clipboard/selection。
- [ ] 复用或局部抽取现有 preserveHandoff/descriptors，防 host setter 重置历史、paste、undo、补全与 callbacks/actions。
- [ ] 覆盖 history-first / appearance-first、有/无 Down opener、后续 factory、后来 opaque wrapper、安装部分失败、unsupported shape、reset-before-shutdown。
- [ ] 迁移 pretty-compat 中有效离线 history fixture、actual host editor regression 与 GC/ownership 证据到新目录；不能删测试以规避失败。
- [ ] IME marker/中文/自动折行/滚动/补全不变；宿主极窄已知问题对照记录，不宣称修复。

## 4. 切换与依赖清理

- [ ] bash-unified 直接 processTasks(pi)，保共享 coordinator/lifecycle/UI owner/agent guard。
- [ ] 独立 beautify.ts 注册 renderer 与 appearance；bash-unified 仅保留共享任务协调与 Down opener。验证两个接线顺序，删除 Pretty import/proxy/injection/snippet patch。
- [ ] 删除 Pretty dependency 与不再需要的传递依赖，pnpm-lock 更新，无第二 SDK/runtime。
- [ ] 删除 pretty-compat 专属源码/测试路径，确认对应安全回归已迁移。
- [ ] 去掉 manifest pi-pretty.json files 声明；保留 conflicts 禁止 standalone 共存；个人旧文件完全不碰。
- [ ] 更新 scripts/pi-manifest.test.mjs、sync.test.mjs、task-ui editor-host/editor tests、agent loading test 的实际 Pretty 依赖与断言。

## 5. 文档、独立审查与验证

- [ ] README 同步 overview、自带模块、代加载包、bash-unified、输入历史兼容、files、声明例子、开发检查与键位冲突。
- [ ] 若借用 Pretty 代码，来源/commit/MIT 版权文件保留，中文描述有意差异。
- [ ] 更新 owning preset spec 的 Pretty 实现描述为自有 renderer/editor 合同；保留无关规范。
- [ ] 独立 check 对全部本任务变更检查，不只看最新代码块；修复后重跑。

测试环境：PI_SDK_DIR 显式指实际 host node_modules，PI_CODING_AGENT_DIR 临时目录，清理 after/finally；不读个人 ~/.pi，必要时临时 HOME，隔离原 PRETTY_* 环境。

```sh
node --test extensions/beautify/__tests__/*.test.ts
node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts
node --test scripts/pi-manifest.test.mjs scripts/sync.test.mjs
pnpm check
git diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-13-builtin-tool-renderers
```

定向 node --test 不加 force-exit，确保退出/资源清理。实际 glob 随实施后的测试路径核对，不能用不存在文件命令假通过。全量 check 有现存 force-exit，因此不能替代自然退出检查。

- [ ] 列宽矩阵至少包含 1/2/8/20/40/80/120、中文/组合字符/ANSI、offset/path/footer metadata；检查不存在超宽与错误 offset。
- [ ] 通过真实 tool definition execution seam 验证 content/details/structuredContent 未改；grep 不执行额外 shell，Read renderer 不读文件。
- [ ] 高亮 reverse-test：去掉 ANSI 输出回归应失败；路径布局恢复旧拼接则长路径断言应失败；省略 safe handoff 则状态保存断言应失败。仅局部快照/恢复，不篡改无关工作。
- [ ] 如用户后续批准，临时 HOME/config/cwd/session 的 installed CLI/PTy 验证输入历史两个加载顺序、Alt+R、Down、展开与高亮；不运行在线模型、不改当前会话。不做语义复制验证。
- [ ] 汇总测试/实际 TUI 未验证项至 research/check-results.md。

## 6. 回滚与交付

- 每阶段留可验证边界；集成失败回退本任务对应文件/hunks，不 git reset、不丢无关任务。
- 依赖/renderer/entry/manifest 同套回滚，避免 standalone Pretty 与新 renderer 重复占有。
- 验证后才请求提交计划授权；不自动 stage/commit/install/sync/reload/push/finish/archive。
