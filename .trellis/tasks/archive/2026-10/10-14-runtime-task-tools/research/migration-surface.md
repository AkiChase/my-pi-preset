# 迁移面与前置基线核对

## 范围

本记录只覆盖展示、文档、规范和当前工作区边界；统一执行管理接口的源码研究另见 `runtime-interface-map.md`（研究完成后生成，不以预期代替事实）。

## 归档基线

前置任务 `.trellis/tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/task.json` 为 completed，completedAt=2026-10-14。

当前 `extension-guidelines.md` 记录六工具单行合同及背景 reset 防护；`testing-guidelines.md` 已指向归档的 tmux 验证与终端修复报告。不能再使用活跃任务旧路径，也不能丢失后续 `clipPlain` 修复。

## Beautify 真实耦合

- `extensions/beautify/index.ts`：固定名字 resolver 匹配 get_subagent_result/jobs。
- `tools/retrieval-contracts.ts`：合法参数字段及 text-only、details undefined 信封 guard。
- `tools/get-subagent-result.ts`：agent_id/wait/verbose，固定头部与等待释放信封，description 多行处理。
- `tools/jobs.ts`：action/jobId/pattern 等参数及 list/output/search/stats/attach/kill 六种头部；partial 只用于 following/waiting，不从正文推断状态。
- `__tests__/retrieval.test.ts`：真实宿主、真实注册工具、details={}异常、动态注册／历史／同名异形／state 隔离及原 renderer 异常。

因此新 task_manage 需要新的组合合同，不能把新参数强塞给旧 guard。用户已明确不考虑旧兼容：旧解析不保留为旧名历史专门适配，旧历史由宿主原／通用展示处理。新返回 metadata 若选择结构化格式，应当是明确版本化且可保守验证的合同，而非放宽旧 details guard 为任意对象。Beautify 不依赖执行模块私有状态；共享轻量纯类型／验证器可单独评估，不创建第二套执行状态。

## 文档同步清单

- README task-composition/agent-tasks/process-tasks/monitor/Beautify/开发与验证小节：公开工具、后台模式、等待示例、停止与通知、日志分页／搜索、保留期限及界限。
- `extensions/beautify/TESTING.md`：新管理工具实际注册／宿主案例及旧名不再专门适配的边界。
- agent-tasks/process-tasks `PROVENANCE.md`：新增本地偏离说明；不机械改写上游原文与历史事实。
- `.trellis/spec/preset/extension-guidelines.md`、`monitor-contract.md`、`testing-guidelines.md`：现行工具合同和验证命令迁移，保持原生命周期硬断言。
- 脚本、测试夹具、默认 agents／prompt 的旧工具名需要按实际使用而非全文替换迁移；纯历史引用允许保留。
- 外部 pi-trellis 文档／提示可能出现旧名；不得手改 `.pi/git/` 克隆或生成 agent 材料。RPC兼容由本任务接口研究核验；旧提示作为跨仓库后续更新风险明确交付。

## 工作区边界

规划期间 `git status --short` 显示已有 README、host-loading-smoke、pi-manifest、.pi 及 at-path 等并行修改。实施时先重核这些文件最新diff，做局部改动，不覆盖他人未提交成果；当前只写本任务文档。

## 规划结构

本交付是同一公开接口的跨后端和展示迁移，无法在保留完整可用接口的前提下独立发布某一后端。推荐一个任务内按阶段实施与验证，而非为每个文件／模块新建独立子任务。阶段先完成可调用管理能力，再切换公开工具和提示，最后完成展示／文档迁移及整体验收；不保留双重公开注册作为临时交付结果。
