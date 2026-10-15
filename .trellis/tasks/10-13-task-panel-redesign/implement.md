# 实施计划

## start 前门禁
- [x] 用户已确认一起统一全部列出的呈现路径并完成方案审阅。
- [ ] 将父任务拆成两个串行子任务：shared presentation/现有 renderer 适配 → 新 Panel/overview；子任务文档明确依赖与范围。
- [ ] 补齐子任务上下文并 validate，核对目标 SDK、宿主模式及独立工作区基线，不覆盖 monitor/.pi 无关修改。
- [ ] Panel 实施前核实公开原生 Stack/Scroll/ScrollView 的 overlay 接入、Regular/Fullscreen 布局及鼠标路由；遇阻报告，不回退到自制滚动条/手动截取。邻仓滚动任务不是整个重设计的硬前置依赖。
- [x] 2026-10-15 用户批准直接更新设计：原生连续滚动、可视滚动条、Fullscreen 滚轮及边界不穿透；不沿用手动分页/PageUp/PageDown。仅规划，不 start、不改产品代码、不提交。
- [ ] 滚动条常驻/按需、任务行点击和拖动尚未确认；不得擅自纳入实现，显示策略在 Panel 实施前确认。
- [x] 2026-10-14 用户批准将独立 `bg-hint` 移除纳入已有规划；仅更新文档，不启动实施。
- [x] 2026-10-14 用户批准将面板从全宽弹窗调整为参考 `/trellis-task-viewer` 的全终端 overlay，Enter 进入详情、Esc 返回/关闭；本轮只更新任务规划，不启动实施。
- [ ] 根项概览五项上限仍为最小技术建议；底部概览与先行共享展示子任务范围不因全屏调整而扩大。

## 分阶段执行
0. 子任务一交付并验收共享规则与现有 Agent call/result、workflow card/dialog、conversation-viewer、shell/monitor 标题与 Beautify bash 本地适配；补齐前台 description→Job.name，不重写旧导航/后端。子任务二等待该接口就绪后执行下面 panel/overview 阶段。
1. 新增共享 presentation 工具及纯布局测试：description-first、状态圆点、tokens/耗时、Unicode/ANSI width、深层树缩进、protected suffix、小宽度降级。
2. 扩展 TaskPanelModel 树前缀、子项计数与选择 reconciliation，覆盖真实 parentRun/workflow、orphan/cycle、收起隐藏选中项、根组终态四秒及 final pin。
3. 重构 panel 为全屏 list/detail 状态，Agents/Processes 上下分区；owner 使用 100% 宽高、top-left、margin 0 的原生 overlay。先验证公开原生 Stack/Scroll 布局，再接入列表/详情各自的 `ScrollView`，完整正文交由原生布局裁剪并显示滚动条，header/footer 固定、背景填满终端，不用 render 后 slice/手工 updateLayout/重复 offsets 模拟视口。实现 Fullscreen 滚轮及边界 containment、Regular 键盘回退而不强开鼠标捕获；滚轮不改变选择，键盘选择变更时确保可见，定时刷新不拉回视口，返回/折叠/内容更新/resize 保留或收敛位置。移除手动分页及 PageUp/PageDown 处理/提示。保留 Enter→detail、Esc→list/close、树收起提示、selection background、全局 waits 与 selected actions 分离，以及 `/tasks` 和现有面板快捷入口；不切换宿主模式。
4. 新增 belowEditor 只读 overview，复用 metadata/格式化，owner 持有 widget/subscription/clock/expiry；不调用 detail、不恢复旧 raw input listener、main 行或 viewers。同阶段删除 process-tasks 独立 `bg-hint` 及 show/clear/reset/专有缓存接线，保留输出流转与共享计时刷新；共享底栏/面板表达实际等待与配置驱动的全局解除入口，不新增 shell 概览。
5. 按最终范围改造 active workflow progress 长标题/phase/stat 尾部布局；测试真实 card renderer 的宽度参数与 replay entry。
6. 精确更新 README、extension/testing 指南及 agent provenance；现有其他任务 hunks 保持原样。
7. 独立 trellis-check full-scope 审查，验证 UI 行为与后端契约，修复后复验；未经授权不提交/安装/归档。

## 测试矩阵
- panel：上下分区、真实多级树、折叠与选择、详情返回定位、标题完整文本、有界输出、selected final pin、rows/columns resize。
- presentation：中文/emoji 输入（不主动使用 emoji 图标）、换行/控制字符/ANSI、安全截断、极窄屏、右侧统计与连续选中背景。
- overview：root/child 不重复汇总、states/等待、limit/hidden count、empty/四秒终态、计时与最终冻结、主题更新。
- fullscreen container：overlay 选项、原生布局树实际视口/背景填满终端、固定 header/footer，空态/小屏不透出底层内容；regular/fullscreen 宿主、resize、主题切换、重复打开/关闭，返回恢复编辑器焦点和原文本。
- native scrolling：长列表/长详情的原生裁剪与滚动条实际长度/位置，中文/ANSI/窄屏宽度预算扣除滚动条，移除旧手动截取及 PageUp/PageDown；滚轮与选择分离、键盘 ensure-visible、每秒刷新不拉回、返回/折叠/任务移除/输出更新/resize 的位置保持与收敛。
- mouse host：Fullscreen 真实终端验证正文滚轮路由、上下边界不穿透底层对话、关闭后主界面恢复；Regular 验证键盘/滚动条与无强制鼠标捕获。模拟布局或输入测试不替代真实鼠标验收。
- lifecycle：setter 同步 reentry、shutdown/reset、延迟 timer/callback、单 overlay、done 一次性与 dispose 幂等、自然退出无遗留 interval。
- waits：foreground launch、background retrieval、no waits、detach all 多等待、selected stop 不变、Owned 不误标主会话 wait。
- workflow progress：长 workflow/phase/child 文案保护状态与数字；不更改 token accounting。
- hint removal：运行超过两秒仍无独立提示、多 shell/agent/retrieval 混合等待、配置快捷键与 /bg 回退、完成/detach/reset/shutdown 清理、自然退出；前台 description 优先/缺失回退，完整实际命令与 Trellis 前缀不变，面板耗时继续刷新。
- integration：Beautify editor、footer semantic colors、SDK widget belowEditor placement、现有 agent/process 后端回归。

## 验证命令
先按 repository testing 指南确认 PI_CODING_AGENT_DIR 隔离与 PI_SDK_DIR；不得刷新真实用户配置。

```sh
node --test extensions/task-ui/__tests__/*.test.ts
node --test extensions/agent-tasks/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts
node --test extensions/beautify/__tests__/*.test.ts
pnpm check
git diff --check
```

全量 force-exit 不替代自然退出测试。新增 layout/renderer/SDK fixture 测试跟随相关 suite，手动宿主冒烟验证 regular/fullscreen 中的全终端覆盖、resize、打开/返回详情、Esc 关闭后编辑器焦点/文本恢复、输入框下方概览与主题。邻仓 viewer 的旧实现只作为容器/done 方式参考；新滚动任务的原生布局验证结果若已交付可借鉴，但不构成整个父任务硬依赖，亦不能用其历史测试替代本任务新验证。遇原生能力阻碍须报告，不擅自回退自制方案；真实鼠标验收未运行必须记为未验证。

## 风险与回滚
- owner/model/panel 为高风险共享边界，逐阶段保留测试绿灯。
- 不能用可见子行求和修 workflow tokens；现有统计时效/范围只解释不重算。
- overview reset 后不得重注册，timer 空闲必须停。
- 窄屏防止 suffix 或树缩进令任务标题全丢失。
- 任何回滚只撤销本任务 hunks/新增文件，不触碰 monitor 任务或生成 .pi 配置。
