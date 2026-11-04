# 实施计划

## 授权与规划状态

用户授权创建任务与完善 planning，已确定固定 Ctrl+Shift+T、不可配置、完全隐藏与状态提示；本轮明确批准首次打开新实例、恢复隐藏旧实例及跨弹窗拉到最前这两项产品决定。用户已通过“可以”批准本方案实施、验证、独立审查及 scoped local commit；不授权依赖安装、push 或收尾。

- [x] 检查真实命令、组件、入口生命周期、文档与规范。
- [x] 确认首次打开与旧实例恢复的区别。
- [x] 确认前台弹窗存在时提升 viewer，并核对公开 SDK setHidden/focus/合成排序与输入分发。
- [x] 收敛 PRD/design，明确会话级监听与交互级 cleanup。
- [x] 用户确认最终实施计划。

## 执行路径与检查点

主会话实现一个可独立验收阶段：owner、按键、入口生命周期、测试与文档保持耦合，避免中间提交无法恢复的隐藏状态。由于涉及 task-browser 与扩展入口的生命周期接口，完成后安排 trellis-check 独立审查。

主会话已准备 check.jsonl 的实际规范引用（development/index.md、testing/index.md、development/widget-display.md 及相关 guides）；派发前核实引用与完整读取义务，角色默认只读源任务材料。独立审查已在共享源目录执行；输出置于本轮仓库外临时目录，禁止提交/安装/收尾。implement.jsonl 无实现派发保持为空，start 使用 allow-empty-context，不把空 manifest 的诊断描述成全量验证 PASS。

验证并独立审查通过后，主会话提交一个 scoped commit，不包含无关改动，不 push 或归档。

## 预计文件

- `extensions/trellis/lib/task-browser/command.ts`：command/raw listener 共用的 admission、open/present、toggle、临时反馈；必要时抽窄 owner helper。
- `extensions/trellis/lib/task-browser/component.ts`：必要的幂等外部关闭/dispose 与已有 hints；不重构渲染，不复制滚动状态。
- `extensions/trellis/index.ts`：支持项目会话监听安装与生命周期控制器接入，保留项目/runtime/source-authority 守卫。
- `extensions/trellis/__tests__/task-browser-toggle.test.mjs`（拟定）：fake-pi/handle 逻辑回归；必要时修改 project-activation fixture 的 onTerminalInput 能力与 session retirement 断言。
- `docs/extensions/trellis/tasks.md`：统一快捷入口、状态语义、前置行为、终端/模式限制；修正四页为 PRD / Design / Implement / Metadata。

## 顺序

1. 获批后刷新相关规范/指南和完整源/测试；再次检查 Git 与 task context，核实已准备的 review manifest，start 已获批任务。
2. 实现 factory activation 会话 owner、跨入口 admission 和上下文 generation；先确定清理责任，后安装 listener/custom。
3. 完成固定键 session raw listener：idle 打开、opening 去重、focused 隐藏、hidden 恢复、visible-not-focused 提升。关闭交互不注销会话入口；退休会话才注销。
4. 添加能力守卫、错误/迟到回调隔离、状态提示 ownership 与最小组件关闭接口。
5. 补逻辑测试和文档，运行针对回归及全量 checks，独立审查真实 diff、失败与 rerun；修复后重跑受影响检查。
6. 主会话最终 Git 审查并提交此阶段，记录 exact evidence 与未验证限制，不自动收尾。

## 回归矩阵

| 场景 | 预期 |
| --- | --- |
| idle 在编辑器或其它弹窗焦点下按固定键 | 新实例一次打开；不依赖编辑器快捷键分发 |
| opening 重复按键/重复命令 | 只有一次 admission/mount；不排队隐藏 |
| focused→hidden→visible | setHidden 序列与提示正确，同一交互 identity，无额外 custom mount |
| hidden 且问卷等持焦点 | 恢复并置前，不调用其它 overlay 的 done/取消接口 |
| visible 且其它 overlay 覆盖 | 调用本 viewer focus()；不是误隐藏/忽略 |
| 重新执行命令 | 恢复/聚焦旧实例，不切换成隐藏、不重复挂载 |
| 完全关闭后再次按键 | 新实例，旧状态不持久化；session listener 仍有效 |
| 普通字符/Esc/Ctrl+C | 原始监听不消费，原组件/编辑器语义保持 |
| Kitty initial/repeat/release | 初始按下一次动作，repeat/release 不再次开关 |
| legacy Ctrl+T / ESC | 不作为 Ctrl+Shift+T fallback |
| viewer 关闭/打开失败 | 撤销交互状态与资源，后续可重新打开；不删除会话入口 |
| layout await/factory/onHandle 迟到 | 已退休交互不挂载/发布/聚焦 |
| 旧 finally 晚于新交互 | 不清除新 admission/handle/提示 |
| 同 root 更换 manager 或 ID | 旧会话入口与交互退休；新 ctx 独立接受 |
| shutdown/reload 与可取消切换 | 最终退休清理幂等；before-switch 未完成不误关闭 |
| 必要能力缺失 | 不进入不可恢复隐藏，命令仍能退出，能力限制明确 |
| notify/setStatus/unsubscribe 抛错 | 其它 cleanup 继续，owner 不卡在 opening |
| 错误项目/runtime/来源或非 TUI | 原拒绝与支持项目能力注册边界保持 |

测试只增加 Trellis `.mjs` fake-pi/handle 逻辑，不新增真实 Pi host 挂载、overlay rendering、TUI 或菜单测试。fake handle 证明调用、资源归属与实例复用，不证明真实终端视觉/物理键盘/任意第三方组合；公开 SDK 源码证据证明前置接口可行，不能替代运行验收。

## 检查命令与结果

在本轮自建仓库外临时 agent 目录与已有 SDK 隔离下，不访问个人配置/凭据/会话，不下载依赖：

1. `node --test extensions/trellis/__tests__/task-browser-toggle.test.mjs`（如最终命名变化，更新记录；不 force-exit）。
2. `node --test extensions/trellis/__tests__/*.test.mjs extensions/shared/scroll-panel/__tests__/*.test.ts`。
3. `pnpm check`。
4. `git diff --check`、文档链接与按键/标签/限制核对。
5. 独立审查后修复并重新执行受影响 checks。

记录具体命令、环境、exit codes、PASS/FAIL/NOT_RUN、首个失败原因与 rerun 关系，不用最终 PASS 抹掉失败事实。输出在自建系统临时目录，不写 research/；主会话确认完成且无进程使用后，只清理本轮拥有的临时目录。

## 当前记录

- 用户批准后运行 `task.py start .trellis/tasks/11-04-task-viewer-toggle --allow-empty-context`，planning → in_progress，退出 0。CLI 提示当前 main 与 base_branch 相同，未来 PR/归档需另行处理；本轮不改变并行会话分支，不归档。
- 已实现 owner.ts 会话级监听与单交互 admission、命令共用打开路径、组件 dispose 与 hints、index.ts start/shutdown 接入；文档与逻辑测试已补充。
- 独立审查上下文 check.jsonl 已准备；本轮共享源目录，审查期间主会话不同时编辑被审查产品文件。

### 执行证据

环境：Node v24.14.1、pnpm 10.33.0，使用已安装 Pi 1.4.0 SDK；`PI_CODING_AGENT_DIR` 指向本轮自建仓库外临时 agent 目录。`pnpm typecheck/check` 的 `PI_SDK_DIR` 从现有 SDK symlink 实际位置计算，未下载依赖或同步个人配置。执行输出保存在本轮独占系统临时目录，最终核实后按 ownership 清理；以下记录不依赖临时文件才能理解结果。

1. `node --test extensions/trellis/__tests__/task-browser-toggle.test.mjs` 首跑退出 1：24 项中 23 PASS、1 FAIL。测试桩 deliverFactory 异步拒绝未按真实 SDK 转为 custom promise 拒绝，导致 component failed 未处理；不是产品挂载路径失败。仅修复 fake custom 的 catch → settled.reject。
2. 同一命令重跑退出 0：24/24 PASS，natural exit。覆盖首次打开、跨弹窗提升、同实例恢复、关闭重开、ordinary/Esc/Ctrl+C/legacy 不消费、repeat/release、opening 去重、迟到回调、manager/ID 退休、失败清理及缺失能力。
3. `pnpm typecheck` 退出 0；SDK linker linked 0 new of 7，无依赖获取。
4. 完整 Trellis/scroll-panel natural-exit suite 退出 0：410/410 PASS，87.56s。此轮覆盖最初实现与项目入口接入；审查后的 owner 修复由最终专项与全量重跑覆盖。
5. `pnpm check` 首轮全量未成功完成：reader 文件执行后剩余进程约 10 小时 CPU 为 0、日志不再推进，用户指出长时间等待后主会话立即停止该进程组。测试日志最终 1770 项、1769 PASS、1 CANCELLED，reader 文件报告 `Promise resolution is still pending but the event loop has already resolved`；管理工具终态 stopped/killed。不能记为 PASS。实际阻塞根因尚未复现，不将它归因于产品改动或测试环境；原 reader 文件和 reader 产品代码均未修改。`ps` 核实旧 PID 41882/41899/43694/59859 均已退出。
6. 独立 trellis-check 审查完整产品/测试/文档与所选规范，机械修复 command 拒绝路径的 notify/sendMessage sink 隔离，并补测试；其专项 25/25 PASS、strict tsc 退出 0、diff whitespace 退出 0。发现两个额外问题，用仓库外 fake-pi 探针分别退出 1：命令 root 校验提前返回残留隐藏交互；setHidden(true) 同步重入恢复后外层继续发布错误提示。
7. 主会话修复：所有 command/raw 入口 root/admission 校验统一到 owner.open 并绑定调用来源；present 增加 generation 与最终 hidden 核对，旧 presentation 不清除新提示。新增 root 缺失/失败、hide 中恢复、restore 中再次 hide 回归；`node --test --test-timeout=30000 extensions/trellis/__tests__/task-browser-toggle.test.mjs` 退出 0，28/28 PASS、natural exit（0.62s）。不是另一次独立审查，主会话承担修复闭环核实。
8. 原始 reviewer 两个失败探针用 `node --test --test-timeout=15000 --test-name-pattern=REVIEW <本轮临时目录>/review/command-root-probe.test.mjs` 重跑，退出 0，2/2 PASS（外层 process-group deadline 30s，实际0.6s）。没有弱化原断言。
9. 原停滞文件单独 `node --test --test-timeout=30000 extensions/trellis/__tests__/task-browser-reader.test.mjs` 重跑，外层 process-group deadline 60s；退出 0，37/37 PASS、natural exit，Node summary 0.30s。原停滞未复现。
10. 最终 `pnpm check` 在外层 process-group deadline 180s 下重跑（Node/package discovery 不变，新增 TMPDIR 指向本轮独占 tmp/）：strict no-emit typecheck PASS，全量 1773/1773 PASS、0 FAIL/0 CANCELLED；退出 0，外层79.2s、Node test summary74.99s。SDK linker linked0，无依赖下载。supervisor timeout 时只 TERM→KILL 本轮创建的进程组，本次未触发 deadline。
11. 最终 `git diff --check` 退出 0；check.jsonl 五个真实规范引用均存在；新增文件/任务文档无尾随空白并有末尾换行，文档 task-viewer anchor/固定键/四页标签核对通过。implement manifest 有意为空，不称全量 task validate PASS。

### 规范评估、留存与提交

会话/交互双层 ownership、source/ctx fencing、raw input 和 cosmetic failure 规则已有规范覆盖，本次没有修改 SDK 或建立新的共享接口约定，不新增重复 spec。固定按键与可见限制已进入用户文档。

本轮独占临时目录：`/var/folders/fx/bn7t1rq16xn7_66t233x_s1h0000gn/T/pi-task-viewer-toggle.ooZ33d/`。此前全量停滞的具体根因未复现，因此保留首轮全量日志、最终重跑日志与有限 supervisor/复现材料用于后续诊断，不声称临时目录清理完成。无本轮活跃 shell/Agent 仍使用该目录；未把原始日志或探针提交到仓库 research/evidence。

所有产品验收项已有相应逻辑/源码及最终回归证据；真实 Pi/TUI 挂载、终端外观、物理 Ctrl+Shift+T 和实际第三方插件组合 NOT_RUN，遵守 Trellis 逻辑测试边界，不声称真实终端验收通过。阶段实现已完成并提交为 `c17dca8`（`feat(trellis): toggle task viewer with Ctrl+Shift+T`），包含产品、测试、用户文档及必要任务材料；提交后工作树干净。该提交 hash 的后补记录单独作为任务检查点记录提交，不改变产品。等待用户使用验收，不自动归档/记录 journal/同步安装/reload。
