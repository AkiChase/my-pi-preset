# 规范迁移映射

本记录用于检查阶段1、2没有以精简名义丢弃有效开发约束，不是产品测试报告。原始正文保存在 baseline-spec/，原 README 开发章节保存在 baseline-readme-development.md；这些是历史基线，不是新的规范入口。

| 旧来源 | 新位置 | 保留或分类决定 |
| --- | --- | --- |
| preset/index | development Before Development、Documentation and Handoff；根 index | 入口直接正文，角色 JSONL 显式选材，不误称自动加载 |
| repository Layout/Runtime/Vendor | development Repository and Dependencies | 顶层发现、peer/runtime依赖、pnpm、SDK、vendor来源、基础设施排除 |
| extension Entry/State | development Repository、Extension Execution and State | 唯一执行owner、可选fallback、错误契约、origin identity、守卫内部seam |
| extension Lifecycle | development Lifecycle and Resource Ownership | factory不启长资源、部分失败/重入/迟到资源、before-switch区别、自然退出、保未知输出 |
| extension Editor/Rendering | development Editor, UI and Rendering | 活编辑器/receiver/history/focus、later owner、rollback、IME、宽度/controls/theme、bounded数据 |
| sync 全文 | development Synchronization and Configuration Safety | 选域/prune、null/数组、preserve、protectedfiles、reread/lock/rename、failure order、local source验证及切换 |
| documentation | development Documentation and Handoff | 英文spec/中文docs与任务、功能用户边界、当前链接/JSONL、归档保留；撤销docs/testing与插件测试归docs错误 |
| testing 全文 | testing Commands/Regression/Selecting/Reporting | actual-host、隔离、自然退出/force-exit区别、回归设计、证据边界、文档检查 |
| monitor-contract 转发 | development Extension/Lifecycle，testing Focused Plugin Checks | 不保插件独立spec壳；用户功能由Agent写Monitor文档 |
| guides | guides短checklists | 保技能必读路径，删除正文重复，链接development/testing |
| docs/testing/tmux | testing/tmux | 授权/隔离、最小矩阵、keys、条件等待/raw新frame、误判、清理/报告全部英文；相对历史证据路径重算 |
| README 开发章节 | testing Focused Plugin Checks、development Repository；原文task baseline | 保定向实际测试入口与夹具边界；历史PASS、版本/PTY结果不复制进规范或用户文档 |

## 当前引用
八份活动角色 JSONL 仅改旧 preset 文件引用到新 development/testing，原 reason 保留；不改归档历史，不改其他任务需求。任务自身 implement.jsonl 只引用已批准design供并行用户文档Agent，故spec变化不复制到其执行基线；Agent按design覆盖旧内容归属。

## 非本轮产品改动
不改 extensions 中既有 TESTING.md；它们的详细历史验证与开发说明不是用户docs，本轮不声称已把全仓库所有开发材料集中到spec。长期可复用的必要检查已归新规范。README本地检出说明保用户安装配置用途，标题由“测试本地修改”改“使用本地检出”；不执行任何安装/测试。
