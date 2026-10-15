# Beautify 前置成果与迁移约束

## 用户要求

用户提醒 `10-13-beautify-tool-shell-collapse` 已完成，本任务更改工具名称与管理接口时必须迁移其已完成的展示适配。已核 task.json 为 completed，目录为 `.trellis/tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/`。此要求已纳入本任务 PRD；当前仅规划，不修改前置任务源码或生命周期。

## 已核证据

- 前置任务 `prd.md`：实施与独立 check 完成，AC1–7 已勾选；初始自动验收为定向141/141、strict／完整606/606及自然退出606/606，属于历史阶段证据，不是最新全量结果。
- 后续 `research/terminal-fix-report.md`：保留 `clipPlain` 清理纯文本截断中 SDK full reset 的修复，避免标题／统计截断使宿主背景丢失。最终自动定向92/92、strict／全量671/671及自然退出671/671；实际隔离 tmux dark/fullscreen 定向9项PASS。实际终端证据限 Read resize、长 Bash、Read error、Ctrl+O 与背景，不代表所有六工具或主题矩阵均通过。
- task.json 已 completed 并归档，后续迁移使用归档路径；历史报告中的“未归档”等语句属于当时状态，不能当作现在状态。
- `design.md`：四类原工具与 `get_subagent_result`／`jobs` 六工具适配。可选 resolver 保守解析参数与返回信封，未知格式委托；展示不读取私有状态或额外获取结果。
- `implement.md` 的步骤9仍保留旧“待独立check”描述，与 PRD 最终验收不同；后续以实际源码、最终 check-report 与 PRD 最终证据核验，不能仅凭旧清单判断未完成。
- `extensions/beautify/index.ts`：resolver 明确匹配 `get_subagent_result` 和 `jobs`，分别调用 `agentContract` 与 `jobsContract`。
- 相关文件：`extensions/beautify/tools/get-subagent-result.ts`、`tools/jobs.ts`、`tools/optional.ts`、`tools/retrieval-contracts.ts`、`__tests__/retrieval.test.ts`。
- 测试直接依赖旧工具名称、参数 `agent_id`／`jobId`、action `attach`／`kill` 和旧返回文本。统一接口改变后必须迁移合同与实际注册工具测试，不能只改名称断言。

## 后续设计必须覆盖

1. 列出旧操作到 `task_manage` 的映射，保留两套查询展示的有效能力。
2. 明确新返回合同，按类型／操作保守提取元数据；不扫描正文猜状态或统计。
3. subagent 查询与等待共用新入口后仍保留 description、状态、用量、耗时、not found、verbose 全文及 waiting／released／cancelled 区别。
4. shell／monitor 保留输出字节范围、无输出、搜索、统计、partial、结束和停止请求；不把等待释放误报成任务终止。
5. workflow 的统一管理返回也需要契约覆盖；不因此新增启动工具 renderer。
6. 保留宿主主题背景、单行收缩、展开实际已返回全文、原 renderer state／lastComponent 隔离及未知格式降级。
7. 用户明确要求不考虑旧兼容：不注册旧执行别名，不保留旧名专门 renderer，不迁移旧记录／ID；历史旧名由宿主原／通用展示处理。前置能力迁移仅面向新 `task_manage` 合同。
8. actual-host 与 actual registered-tool 路径验证，无模型／网络／额外展示读取；Read/Bash/Find/Grep 同时回归。

## 边界

不改写前置任务历史验收事实，不覆盖无关或并行修改；执行本任务时以已归档任务对应的最新实际成果为基线。迁移承诺不等于所有未知格式均单行，不把自动宿主测试声称为真实终端验收。
