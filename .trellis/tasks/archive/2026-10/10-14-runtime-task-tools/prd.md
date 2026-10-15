# 统一运行任务工具命名与管理入口

## 目标与范围

统一本仓库 Task Composition 的工具接口，覆盖 Bash、Monitor、子代理和 workflow；不重写执行引擎、不重设计 Task Panel、不修改 Pi SDK。

| 工具 | 用途 |
| --- | --- |
| `bash` | 前台／后台命令；吸收后台 `notify` 选项 |
| `monitor` | 命令与 WebSocket 监听 |
| `subagent_run` | 启动、继续或定时派发子代理 |
| `subagent_workflow` | 编排与重放 workflow |
| `subagent_message` | 向运行中的子代理发送指导 |
| `task_manage` | `list/status/output/wait/stop/search/stats` |

删除 `bash_bg`、`jobs`、`get_subagent_result` 和原代理工具名，不提供旧别名、旧名专用 renderer 或历史 ID 迁移。

## 必须保留的行为

- 四类任务均返回 `task_id/run_id/task_type`；前后台切换不替换执行身份。
- 子代理等待返回完整最终回答；workflow 输出区分脚本返回值与进度日志。
- Monitor 等待整个监听结束，不等待下一条事件；取消结果等待不停止执行。
- 保留日志字节分页、正则搜索、统计、完成通知、消息指导和会话隔离。
- 子会话只管理所属任务；resume 后管理入口可用，旧等待不能操作新轮次。
- Beautify 迁移至新合同，保留单行摘要、背景、窄宽、partial/final、动态委托和只读展开；Read/Bash/Find/Grep 不回退。
- 注册、提示、子会话过滤、内部调用和用户文档使用一致名称。

## 授权与排除项

用户批准实现、独立检查、隔离 tmux 验证及验收后收尾，后续明确批准提交。未授权自动 push、安装、个人配置同步或 reload。

交接材料中的“不自动 commit”没有可核验用户原话，不作为用户明确 opt-out；此次执行偏差和补正记录在 [实施记录](implement.md#提交与流程补正)。

外部 `pi-trellis` 的 `10-14-runtime-tool-names` 是独立关联任务：负责新名检测、材料注入、worktree 门禁和 provider 测试。本任务不实施外部仓库；组合适配仍是发布前置。

## 验收

- [x] 六工具集合及旧入口移除。
- [x] 四后端统一管理，完整结果、日志分页／搜索／统计保留。
- [x] 运行身份、权限、resume、等待释放及资源清理通过回归。
- [x] Beautify 新合同与原四工具展示通过回归。
- [x] strict、全量自然退出测试、独立检查和真实 tmux 通过。
- [x] 文档更新，未验证范围明确列出。

任务于 2026-10-15 完成。本仓库验收结果、提交与证据见 [implement.md](implement.md)；不表示外部组合或在线模型已验证。
