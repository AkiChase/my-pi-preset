# 全屏 Task Panel 与只读底部概览

## 父任务与目标
父任务：../10-13-task-panel-redesign。依托先行共享展示能力，交付已审阅的新任务浏览体验与主对话只读 agent/workflow 概览。

## 前置依赖
必须等待 ../10-13-task-presentation-unification 交付并验收共享展示规则/接口后才开始实施；本子任务复用其 helpers，不另写第二套状态/宽度/统计规则。父子链接不是调度依赖，此约束须同时写进 implement.md。

## 范围
- 全屏列表上方 Agents/workflow，下方 Processes，无页签、左右分栏或内联输出。
- 同一 interaction 的独立全屏详情页，Enter 进入详情，Esc 从详情返回列表、从列表关闭，返回保留选择、滚动与分组状态。
- 参考 `../pi-trellis` 的 `/trellis-task-viewer` 全终端 overlay：100% 宽高、top-left、margin 0；原生布局及背景填满实际终端行列，打开覆盖对话与编辑器、关闭恢复焦点和原文本。不切换 Pi 整体 fullscreen 模式，不照搬 Ctrl+C 拦截/文档 section 导航。
- 列表和详情正文直接使用公开原生 Stack/Scroll 布局与 `ScrollView` 的连续滚动视口/可视滚动条，header/footer 固定；不沿用 render 后 slice、手工 updateLayout、重复 offsets 或自行绘制滚动条。
- Fullscreen 支持鼠标滚轮并在上下边界阻止穿透底层对话；Regular 保留键盘与滚动条，不强行开启终端鼠标捕获。滚轮只移动视口、不移动选择，键盘选择变更时确保可见，每秒刷新不拉回旧选择；列表/详情状态独立，返回、折叠、内容变化和 resize 合理保持或收敛。
- 不保留手动分页及 PageUp/PageDown 处理/提示；方向键、Enter、Esc、树展开/收起和原有全局/选中任务操作保持。滚动条常驻/按需显示、行点击、拖动未确认，不擅自纳入实现范围，显示策略在实施前确认。
- 保留真实父子树，使用├─/└─/│，收起显示数量与上下文左右提示；不新增圆点旁三角符号。
- 两处● running / ○ 非运行态一致；面板选中背景不改变圆点。
- 输入框下方/footer上方只读 FleetView 风格根 agent/workflow 概览，单行、耗时与↓tokens右对齐、限高/hidden count、空态隐藏与终态短暂保留。
- 不恢复 main 行、原←/↓激活、键盘导航、独立 viewers 或 aboveEditor widget。
- waiting 和 background 分别表达；全局 Ctrl+Shift+B 解除全部等待与 selected stop/copy 分开。
- 删除 process-tasks 在输入框下方独立显示的 `bg-hint` 命令/耗时与快捷键两行提示，清除专有 renderer/show/clear/reset 接线，不新增另一套 shell widget 或把 shell/monitor 扩入 agent/workflow 概览。
- 共享底栏与面板以真实等待信息表达等待关系及配置驱动的全局解除入口；未绑定快捷键时使用 /bg。不改变前台/后台执行、自动转后台、取消、日志、通知、结果消费或 Trellis 环境隔离；保留共享 source 的计时刷新。
- 延续根组终态四秒、活跃后代保留、selected bounded final snapshot 语义。

## 验收
- Agents/Processes 上下分区单一选择，树形多级归属与折叠正确，不伪造并行通知组。
- description-first 与共享宽度规则覆盖各类型标题和阶段，详情完整可读。
- 全屏列表/详情的原生布局及背景填满实际终端行列，空态/极小屏不透出底层对话；regular/fullscreen 宿主模式、resize、主题切换、重复开关与关闭后的编辑器焦点/原文本恢复有验证。
- 原生滚动条准确反映长列表/长详情的视口，header/footer 固定，窄屏/中文/ANSI 正确预算滚动条宽度；滚轮不改选择、键盘选择可见、定时刷新不拉回，返回/折叠/任务移除/输出变化/resize 正确保留或收敛位置，无旧手动分页/PageUp/PageDown。
- Fullscreen 真实终端验证滚轮路由、上下边界不穿透与关闭后恢复；Regular 验证键盘和滚动条且不强行开启鼠标捕获，不把模拟测试当作真实鼠标验收。
- 详情返回定位、窄屏 resize、树形、ANSI 与连续选中背景有测试。
- 概览无输入拦截，无detail读取/父子统计求和；空态/expiry/timer/reset/shutdown 不泄漏或复活。
- 前台等待、后台无等待、后台 retrieval wait 显示准确，全局 detach 不改变执行契约。
- 超过两秒的前台 shell 无独立 `bg-hint`；多 shell/agent/retrieval 等待仅共享 UI 提示解除全部等待，完成/detach/reset/shutdown 无遗留 widget/timer；面板进程耗时正常更新。
- 复用先行子任务的前台 description 标题，详情完整命令与 Trellis 前缀不丢失。
- 现有 Beautify/editor/footer 与 agent/process 回归通过，完成实际宿主冒烟。

## 2026-10-14 范围补充
用户批准将删除独立前台 shell 提示纳入已有父任务，本子任务负责提示移除与共享等待 UI 收敛，先行子任务负责 description 数据传递。本次仅更新规划，不开始实施。

用户随后批准参考 `/trellis-task-viewer` 将面板从全宽弹窗改为全屏列表/详情，覆盖父任务旧的非全屏约束；同步更新容器、导航和验收规划。底部只读概览与先行共享展示子任务范围不变，本轮不 start、不改产品代码、不提交。

## 2026-10-15 滚动设计更新
用户认可邻仓 `10-15-task-viewer-mouse-scroll` 的新滚动方向并批准直接更新我们的设计，本轮仅修改既有规划，不 start、不改产品代码、不提交。父任务已同步原生连续滚动/滚动条/Fullscreen 滚轮与边界 containment，覆盖旧手动视口实现描述。

邻仓任务仍 planning，不作为整个重设计硬依赖；先行共享展示子任务不受影响。本子任务实施前须验证目标 SDK 的公开原生布局/输入路径，邻仓已有结果只能参考，不能代替本面板动态任务、布局及真实鼠标验收。遇原生能力阻碍报告，不改 SDK、不回退自制滚动条/手动截取。后续补齐本子任务 design/implement/context 时必须带入这些约束。

## 规划与边界
用户批准创建子任务，继承父任务已审阅方案；design/implement/context 待补齐，当前 planning。先行子任务未交付前不实施。
不得覆盖 monitor/.pi 无关改动；父任务持有最终集成验收。
