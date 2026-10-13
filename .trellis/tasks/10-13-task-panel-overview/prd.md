# 全宽 Task Panel 与只读底部概览

## 父任务与目标
父任务：../10-13-task-panel-redesign。依托先行共享展示能力，交付已审阅的新任务浏览体验与主对话只读 agent/workflow 概览。

## 前置依赖
必须等待 ../10-13-task-presentation-unification 交付并验收共享展示规则/接口后才开始实施；本子任务复用其 helpers，不另写第二套状态/宽度/统计规则。父子链接不是调度依赖，此约束须同时写进 implement.md。

## 范围
- 全宽列表上方 Agents/workflow，下方 Processes，无页签、左右分栏或内联输出。
- 同一 interaction 的独立全宽详情页，返回保留选择、滚动与分组状态。
- 保留真实父子树，使用├─/└─/│，收起显示数量与上下文左右提示；不新增圆点旁三角符号。
- 两处● running / ○ 非运行态一致；面板选中背景不改变圆点。
- 输入框下方/footer上方只读 FleetView 风格根 agent/workflow 概览，单行、耗时与↓tokens右对齐、限高/hidden count、空态隐藏与终态短暂保留。
- 不恢复 main 行、原←/↓激活、键盘导航、独立 viewers 或 aboveEditor widget。
- waiting 和 background 分别表达；全局 Ctrl+Shift+B 解除全部等待与 selected stop/copy 分开。
- 延续根组终态四秒、活跃后代保留、selected bounded final snapshot 语义。

## 验收
- Agents/Processes 上下分区单一选择，树形多级归属与折叠正确，不伪造并行通知组。
- description-first 与共享宽度规则覆盖各类型标题和阶段，详情完整可读。
- 详情返回定位、窄屏 resize、树形、ANSI 与连续选中背景有测试。
- 概览无输入拦截，无detail读取/父子统计求和；空态/expiry/timer/reset/shutdown 不泄漏或复活。
- 前台等待、后台无等待、后台 retrieval wait 显示准确，全局 detach 不改变执行契约。
- 现有 Pretty/editor/footer 与 agent/process 回归通过，完成实际宿主冒烟。

## 规划与边界
用户批准创建子任务，继承父任务已审阅方案；design/implement/context 待补齐，当前 planning。先行子任务未交付前不实施。
不得覆盖 monitor/.pi 无关改动；父任务持有最终集成验收。
