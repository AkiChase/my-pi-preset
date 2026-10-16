# Bash 工具契约与使用说明规范化

## 目标

先将覆盖原生工具的 bash 改造成模型可正确理解的工具，作为后续其他工具规范性改造的样板。统一参数名称、执行行为、模型可见说明和校验，避免模型依赖原生 bash 的旧语义。

## 授权与范围

- 用户已批准实施、自行迭代、验证后自动收尾；包括范围内本地提交、验收后归档和 journal。未授权安装、push 或修改无关变更。
- 本次仅实施 bash 及其必要的测试、文档、提示集成；其他工具不做全面改造。
- task_manage 管理 bash、monitor、subagent、workflow 运行时任务；本次说明其与 bash 的协作，不将其误称为仅管理后台进程的工具，也不改变 subagent 控制契约。
- system 用法说明采用官方 tools 简短索引、rules 单个多行 Bash usage: 条目，用户已确认。说明只包含当前合法接口，不介绍删除的 timeout/notify 或迁移历史。

## 已确认决策

1. 将表示前台等待后转后台的 timeout 更名，用户认可 background_after_seconds 方向；等待阈值不应表示终止命令的运行时限。
2. 移除模型侧 notify 参数：后台任务必须提供完成通知；前台完成通过工具结果自然返回。不得为了通知改变前台/后台执行选择。
3. 先修复 bash，并以此次契约与说明结构指导后续其他 tools。
4. 非交互模式默认前台等待至完成；显式 background_after_seconds 在启动前报错，不静默忽略。

## 已发现事实

- extensions/process-tasks/tools/bash-params.ts：timeout 描述为超时，但前台普通命令实际上到时转后台；notify 仅允许与显式 run_in_background=true 组合。
- extensions/process-tasks/tools/bash.ts：promptGuidelines 已提供并进入本轮 system，但未完整说明参数依赖和 timeout 新语义。前台计时逻辑对不可自动后台的命令及非交互模式存在例外，需调查后明确。
- extensions/runtime-tasks/facade.ts 和 contracts.ts：task_manage 包含 list/status/output/wait/stop/search/stats，支持 subagent 控制与结果读取；各 action 和任务类型的参数组合存在限制。
- 本轮前台 bash 调用因传入 notify 连续失败；正确修复应省略 notify，而不是把短命令改成后台。

## 需求

- 明确前台、立即后台、等待阈值后后台的契约及参数互斥/依赖。
- 新等待阈值参数不得暗示命令终止；例外行为和非交互模式必须纳入设计，不能只改名称。
- 移除 notify schema、执行参数和静默通知路径中的本次相关入口，确保后台完成通知与前台结果交付不重复或遗漏。
- 使用 Pi 现有提示能力优先，不预设必须引入新的注入机制；核查原生提示残留、最终上下文一致性和覆盖工具的注入路径。
- 后续工具必须有共同接入规范：优先复用 description、promptSnippet、promptGuidelines，工具所属插件维护说明；本次 bash 为首个样板，不全面改造其他工具。
- system 用法说明包括参数组合、任务句柄非成功结果、task_manage 协作、monitor 边界和最小示例。

## 验收标准

- 模型可见 schema、工具说明、system 指导与实际执行行为一致。
- 前台等待阈值不会作为终止期限误用；立即后台与阈值组合按已确认契约处理。
- 不再公开 notify；后台完成必通知，前台完成正常返回，避免重复交付。
- 测试覆盖参数校验、前后台完成、自动转后台及最终模型提示；不可执行的验证须明确记录。
- 用户确认具体 system 文本与完整实施方案后才开始产品修改。

## 实施决策

- 旧 timeout/notify 从 schema 移除；执行入口防御性拒绝，effects 前错误，不做兼容映射。纠错信息仅存在于工具错误，不加入 prompt。
- background_after_seconds 只负责前台等待后转后台，删除 sleep 特殊定时终止路径，保留固定等待的效果前拒绝和主动停止清理。
- 非交互模式默认前台等待至完成，显式阈值在启动前拒绝；保留现有立即后台能力，提示其会话退出生命周期。
- 配置 timeoutMs 和 PROCESS_TASKS_TIMEOUT_MS 本次保持名称与优先级，避免额外配置迁移；模型参数使用新名称，用户文档明确配置是交互前台等待阈值。
- 使用工具注册覆盖替换指导，最终 SDK 组装结果验证无原生执行规则叠加。
- 一阶段实现参数、生命周期、指导、测试与文档，完成独立 check 与验证后本地提交，再最终验收与批准收尾。
