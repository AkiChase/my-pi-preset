# 设计

## 读者及结构
按读者分类，不按通用/插件专用分类。spec 英文供开发者使用，docs 中文供用户使用；任务中文记录一次性设计和执行证据。

```text
.trellis/spec/
  index.md
  development/index.md
  testing/index.md
  testing/tmux.md
  guides/index.md
  guides/code-reuse-thinking-guide.md
  guides/cross-layer-thinking-guide.md
docs/
  index.md
  extensions/<必要插件>.md
```

development/index 直接承载规范：仓库与依赖、入口/SDK、工具执行与结果边界、资源生命周期、编辑器及渲染、配置同步安全、文档维护。testing/index 直接承载检查清单、实际测试命令、隔离、回归和证据边界，tmux 为独立完整操作方法。guides 保技能使用路径，只有短清单与主规范链接。

逐段保留有效约束；当前用户行为说明归 docs，详细内部算法不机械搬家，历史结果保 tasks。删除 preset 旧文件前更新活动引用，归档原文不重写。

## 并行所有权
主会话拥有 spec、docs/index、README 的文档职责 hunk、任务计划与检查工具。Agent 仅拥有 docs/extensions/*.md 及任务 research 下各自证据；不编辑共享索引、产品或基础设施。每份插件文档核完整相关源码/注册/配置，主核实际产物。旧 worktree 存在旧基线和 Beautify 草稿；须按 managed 协议明确协调，不能临时 isolation/source fallback。

## 用户批准的补充范围
文档覆盖所有当前清单插件：七个本仓库顶层入口（Monitor是composition功能另页，非独立入口）及六个第三方包。补status-bar/sse-normalize/blocked-signal与cache/input-history/web/memory/question/recap说明。README插件区只一句话+链接，docs索引纯导航；详细配置、键位和限制只在对应页面。普通Agent只读研究并返回可整合正文，不写源/worktree以绕过既有绑定；主会话负责获批文档写入。全量生成后统一准确性审查。

## 审查及排除
主自检阶段1、2，最终独立文档审查。检查结构/发现、约束保留、语言、相对路径/anchors、JSONL、新文件空白和用户说明准确性。无真实终端或产品执行验收。保并行改动，保既有 no-commit 指令，不安装/个人sync/reload/push/archive，不改发现机制。
