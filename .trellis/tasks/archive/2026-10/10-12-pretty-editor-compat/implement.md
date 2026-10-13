# 实施计划（正式实现已获批准）

- [x] 定位安装顺序、历史注入与 Pretty 替换行为。
- [x] 创建独立任务，记录现有 worktree 与提交基线。
- [x] 研究 Pretty constructor/render/lifecycle 接口，记录未验证风险。
- [x] 用户批准在独立 worktree 验证最小原型；本轮范围仅原型与验证，不授权发布/合并。
- [x] 创建持久独立 worktree `/Users/jyxc-dz-0101322/tools/my-pi-preset-pretty-editor-compat`，分支 `feat/pretty-editor-compat`，基线 `07ec6bc`；仅带入本任务规划与必要开发上下文，禁止复制无关未提交代码。
- [x] 在该 worktree 准备离线测试依赖和临时 agent-dir。
- [x] 补原始历史丢失的失败回归，使用真实 Pretty 集成行为、隔离 editor/history fixture。
- [x] 最小原型闭合实例装饰、working status、shutdown 所有权；不满足需求则回到设计评审。
- [x] 前轮原型已完成，本轮已获正式集成授权；此处旧“仅原型”限制不再适用。task.py start 属主会话生命周期，子代理未执行。
- [x] 原型验证与独立审查完成，用户批准正式实现；不自动合并原分支。
- [x] 原型问题先行：安装失败事务回滚、后来 padding 所有权、安全降级、实际 reload 顺序回归。
- [x] 将验证过的兼容 helper 接入正式 Pretty 集成，移除测试对本机 input-history 安装路径的默认依赖，建立可重复离线 fixture。
- [x] 覆盖双加载顺序、冷启动/new/reload、历史、草稿/光标、多行、补全、应用快捷键、窄屏与恢复清理。
- [x] 更新 README 相关行为说明和必要来源记录。
- [x] 在独立 worktree、临时 agent-dir 下运行 pnpm check、定向测试、git diff --check 与 Markdown 链接检查。
- [x] trellis-check 独立审查、真实 CLI 补证及证据复核通过。
- [x] 已更新 extension/testing 规范，修复提交 `5810141`，用户批准合并后主分支合并提交 `2803ccc`。
- [x] 已汇报合并结果并切回 main；本次用户批准归档与日志收尾。

## 回退点
原型验证失败时停止运行时改动并重新评审；不以调整本机加载顺序代替验收。兼容提交可独立回退，不涉及统一任务面板功能。

## 最终交付
- 独立实现提交 `5810141`，本地 main 合并 `2803ccc`，保留统一任务 coordinator/lifecycle/Down 接入。
- 合并后实际类型检查及全量 521/521、定向自然退出 54/54；旧 wrapper fixture 按新工具组合适配，未改生产逻辑。
- 真实 Pi 1.1.0 / Pretty 0.6.31 / input-history 1.1.3 的 regular TUI 双顺序 × cold/new/reload 六组合通过，实际箭头、Alt+R query/接受/取消和 debug 快照验证；独立审查确认验收闭合。
- 最终实施与 CLI 证据已同步到当前任务 research。fullscreen、复杂异步补全、未来任意 editor 及极窄既有上游缺陷仍为已说明边界。
- 未推送远端、未更改个人 Pi 安装。独立 worktree 保留，后续清理需显式决定。
