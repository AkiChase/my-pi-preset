# 整理开发规范与用户文档职责

## 目标与授权
用户已批准参考邻仓 pi-trellis 的 development/testing 组织方式实施：主会话先做规范整理和测试归位（阶段1、2），用户文档（阶段3）由 Agent 同时开展。现有任务继续使用，不创建替代任务。此前仅规划限制被本次有界实施授权覆盖；保留既有不自动 commit/push/archive 指令，所有改动留待验收。

## 范围
- spec 全部英文，docs 中文，任务材料中文。docs 面向用户：功能、用法、命令、快捷键、配置和用户可见限制。开发、测试和必须遵守的约束全部归 spec，历史设计/执行证据归任务。
- 采用 `.trellis/spec/development/index.md`、`testing/index.md`、`testing/tmux.md`；根 index 短导航，guides 保必要兼容路径和短清单。取消 preset 层及 repository/documentation/extension/sync/monitor 专题拆分，不按插件新增规范。
- development 合并入口发现、公开 SDK、代码/资源所有权、生命周期、编辑器/UI 安全、同步与配置安全、文档维护。testing 包含真实命令、隔离、回归设计、按影响选测和证据边界。逐段归类，不机械拼成实现手册，不照抄邻仓产品契约。
- tmux 方法迁出 docs/testing，翻译成英文并修引用。README 与 docs 索引删除开发测试入口。
- 用户文档覆盖全部当前 preset 插件：本仓库七个顶层入口（现有五文档含Monitor，补status-bar/sse-normalize/blocked-signal），以及pi-preset.json六个第三方包。内部agent/process/task-ui说明统一由Task composition承载，不重复按内部模块建页面。第三方文档只讲本预设用法/配置并附上游链接，依据既有安装源码或可靠上游材料核对，不复制整本手册。
- README插件部分仅每插件一句话+详情链接，docs/index只导航；命令、快捷键、配置表、详细行为/限制在对应docs有唯一权威正文。保项目简介、安装与同步常用操作，避免插件说明大量重复。所有文档完成后统一核当前源码/配置/命令再最终审查。后续委派按用户要求普通Agent；只读研究/起草返回正文由主整合，不通过普通Agent绕过既有执行绑定。
- 更新受影响活动 Markdown/JSONL 引用，保归档历史。packages 只发现直属层，skills 从层 index 阅读，JSONL 明确选择材料，不误称自动注入。

## 不做
不改产品代码、同步语义、Trellis runtime/模板/技能/角色、依赖或个人配置。不安装、sync/reload、真实 tmux/provider/在线模型、恢复 Memory 工作、push、改写历史或归档。既有 worktree 与草稿保留；基线/材料协调需先预览并获批准，不绕过 managed dispatch。

## 验收
- [x] development/testing 被 packages 发现；index 有正文，guides 无重复规范。
- [x] spec 保有效开发/同步/生命周期/渲染/测试约束，无插件用途大全和历史执行结果。
- [x] tmux 与所有开发测试方法归 spec，docs 无 testing 目录或教程。
- [x] 用户文档完整可发现、与当前源码一致；README 职责及链接正确。
- [x] 当前 Markdown 链接/锚点、活动 JSONL、英文/中文和新增文件空白检查通过。
- [x] 主核实际产物及迁移约束映射，独立文档审查后复核；未运行测试如实记录。
- [x] 无产品/个人状态副作用，保并行 hunk、worktree 草稿和归档；不自动提交或收尾。
