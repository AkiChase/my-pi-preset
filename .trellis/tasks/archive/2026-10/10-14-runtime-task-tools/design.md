# 运行任务接口设计

## 架构与所有权

```text
task-composition：唯一 task_manage 注册
  ├─ process capability：原 registry、日志、停止与通知
  ├─ agent capability：原 manager、运行终态、结果消费与通知
  ├─ workflow capability：原 worker/control、脚本终态与通知
  └─ child capability：当前会话所属的嵌套代理

Beautify：只读取公开返回合同，不执行或消费结果
```

新增模块位于 `extensions/runtime-tasks/`，不新增顶层入口、总 registry 或任务数据库。`TaskView` 只保存展示快照，不持有 session/controller/promise。研究依据见 [research/index.md](research/index.md)。

## 身份与权限

公开身份为 `{task_id, run_id, task_type}`，类型为 `bash/monitor/subagent/workflow`。沿用后端 ID；子代理 resume 保持 task ID、更换 run ID，workflow replay 创建新任务。

指定任务必须在当前 scope 唯一解析。省略 run ID 时在调用入口捕获当前轮次；异步等待不能重新解析到新轮次。显式旧 run、歧义或越权返回错误。公共 RPC 保持真实 record ID、cwd、stop/consume 协议。

根列表可以展示 descendants，但子代理管理仍限 top-level；workflow 通过其 owner 管理。子会话只管理本地进程和允许的 owned nested，不访问根或兄弟分支。

## 管理动作

使用 flat schema，运行时按动作和类型拒绝不适用字段。

| action | 参数与结果 |
| --- | --- |
| `list` | 可选 `task_type`；返回保留期内状态、身份、分组和管理权限，不消费 |
| `status` | `task_id`、可选 `run_id`；状态、能力、统计和路径，不读日志或消费 |
| `output` | 进程可用 `offset/limit`；子代理可用 `verbose`；返回日志页、回答或脚本结果 |
| `wait` | 等整体终态；进程可用 `limit`、子代理可用 `verbose`；取消／释放只结束等待 |
| `stop` | 请求取消并返回观察状态；不承诺非协作 provider 已退出 |
| `search` | Bash／Monitor 日志正则；可选任务／类型、`ignore_case/context`，不消费 |
| `stats` | 可选类型；区分当前保留快照和 process activation 累计值 |

分页单位为字节，默认尾页；搜索沿用每任务 20 条展示上限和上下文。子代理最终回答、workflow 脚本返回不以 UI 16K 预览代替；verbose 是有省略的格式化对话，不是原始 trace。

`wait_outcome` 为 `waiting/completed/released/cancelled`。终态结果成功消费后才释放通知抑制；日志失败不消费。取消等待后重新检查未交付通知。

## 子会话生命周期

loader 使用可撤销 ALS holder 传递有限 capability，结束时清除；空 admission 遮蔽外层 scope，不保存全局根 manager。

- composition 存在时，只注册一个组合 facade，不用同名 customTool 覆盖本地进程能力。
- composition 缺席、允许嵌套且未禁管理工具时，提供 owned-only facade，不恢复本地进程或根能力。
- deny、isolated、nested-off 和扩展 narrowing 不被绕过；无收集入口时拒绝后台嵌套启动。
- retained session 的 admission 跟随合法当前 owner；每次操作冻结 owner 与 child run，关闭或替换后不发布旧结果。
- child shutdown 只关闭自身 facade，不 dispose 根 manager。

## 后端与错误处理

Bash 仅显式后台允许 `notify`；保留启动 rollback、特殊命令安全 timeout 和 TERM→KILL。普通 timeout 不新增后台硬截止。

子代理在 terminal resolve 时快照回答与格式化对话，避免同步 resume 污染旧等待；保留单次 usage 上报和精确 run 消费。

workflow 创建即拥有 terminal，覆盖初始化失败、提前取消和不可序列化返回；最终结果不可变。终态、通知交付、worker/host drain 分离。显式 stop 静默，running/paused 不允许 replay；菜单暂停／继续／跳过／重试保留。

日志扫描同时处理 stream/readline 错误，实际 fd 关闭后才返回或执行有界 tail fallback。失败的部分扫描先清空计数，避免重复；不可读返回 `log_error`，全局部分失败标明 incomplete。搜索 await 后核 closed/job identity，不删除日志。

## 返回与展示

正文放 `content`；不可变 `details.runtimeTask`（version 1）保存动作、身份、状态、等待结果、可靠统计、字节范围和错误码。guard 校验 action/type/id/run 与调用匹配、安全计数和范围。

Beautify 仅展示已返回正文。未知版本、异形 metadata、`details={}` 或动态同名工具委托原 renderer／安全降级；不读文件或消费。保留一次 padding、主题背景、`clipPlain`、鼠标边界和真实工具名。等待释放显示 target unchanged；stop 摘要使用 `stop · observed …`，不推测请求是否发生。

不新增代理／workflow／message／monitor 启动 renderer。活跃提示迁新名，历史记录与上游原文不机械改写。

## 集成边界

只整合本任务 owning diff，保留 main 上通知专项、其他插件和任务改动；不 reset 仓库或删除 dirty worktree。外部 `pi-trellis` 新名门禁由关联任务实施，不能靠旧别名或伪造 Agent 事件绕过。
