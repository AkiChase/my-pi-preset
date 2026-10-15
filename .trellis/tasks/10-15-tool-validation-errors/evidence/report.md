# 验证记录

## 范围与授权
- 用户授权实施本任务、检查通过后本地提交并自行收尾（归档/记录 journal）；不包含 push、安装、个人 sync/reload。
- pi-trellis 尚未迁入本仓，S4 owner 为 `../pi-trellis/lib/subagent-rpc.ts`；迁入任务须包含该提交 `596955a`。

## 提交
本仓：`9cf9694`、`f108932`、`10a150c`、`b516d0f`、`19d7701`、`70b87d5`、`3a392dd`、`09aa0af`、`5fbf096`、`954610a`、`4e64103`。
邻仓：`596955a`。

## 各阶段结论
- S1（bash/monitor/task_manage）：参数对象闭合、timeout 上界、`structuredContent` 四条返回路径补齐、非零退出恒显退出码、自发信号为失败而主动取消非失败、截断按字节范围；未知字段在 schema 与直接调用两层拒绝。
- S2（agent）：失败分支 `isError`，`thinking` 枚举，prompt/description/message 非空，resume 与启动参数冲突前置拒绝；五个固定 schema 闭合（workflow `args` 保持自由 JSON）；nested resume 复用同一冲突检查；前台/后台结果文本披露请求值与实际生效值。
- S3（workflow）：helper 校验（文本/集合/边界/嵌套引用）与 agent 选项错误统一归类为作者错误，不再被 `parallel`/`pipeline` 吞成 `null`；普通子任务/分支失败仍容错为 `null` 且被记录；容忍失败与失败子代理的原因进入最终文本、通知与 `task_manage output`，诊断前置以避过通知/预览截断。
- S4（Memory + dispatch）：Memory 四工具闭合、`description`/`query` 与策略上限对齐 160、显示 label 改小写下划线；dispatch 参数由对象 `anyOf` 改为普通闭合对象 + 可测的 `validateDispatchParams()`，校验先于任何 query/FS/RPC 副作用，启动不确定文案保留“可能已存在执行”。

## 验证证据
- 真宿主 `validateToolArguments`：未知字段拒绝且指出字段路径；`Number + multipleOf: 1` 同时拒绝数字与字符串 `1.5`，并仍接受整数数字字符串；Unicode `maxLength` 接受 160 个 astral 码点、拒绝 161。
- Bash 真实本地进程：成功、非零退出、自发 SIGTERM、主动取消、超 1 MiB 输出、手动 detach 均覆盖；`truncated` 不再被多字节输出误报。
- 本仓 `pnpm check`：**1037/1037，exit 0**（最终修正后重跑）。该项跑在当前工作区，含其他会话未提交的改动，故不代表单独归因于本次提交。
- 可归因检查：用 `git archive HEAD` 的纯净快照（排除其他会话未提交改动）+ 链接既有 node_modules 再跑 `pnpm check`：**1016/1016，exit 0**。这才是单凭本次提交即可通过的证据。
- agent-tasks 全量自然退出 **230/230**。
- Memory 全量 63/63；含新增 schema 边界测试。
- 邻仓定向 dispatch：**47/47**；Python unittest：**32/32**。
- 独立审查：多轮只读复核确认 agent 准入、bash 信号/截断、整数 schema、workflow 分类与诊断链路；`5fbf096` 无阻塞缺陷，其提出的模型可见契约文案、effort 取值漂移与 detach 注释问题已在 `954610a` 修正。
- 首次全量曾 FAIL（retained-child 初始化等待超时）；该文件单独 9/9 且未改产品/fixture，属负载下的等待问题；其后多次全量均通过。

## 未通过 / 未完成
- 邻仓 `npm test` 为 **554/555，不是全通过**：`tests/task-browser-ui.test.mjs:870` 子进程 SIGKILL、无输出。单独复跑失败；用 `596955a~1` 的 `git archive` 纯净快照复现同样失败，证明为既有/环境问题而非本次 dispatch 改动引入。未改动该无关 UI，也未放宽断言。故 A9 的“邻仓 npm test 通过”一项不声称通过。

## NOT_RUN
- 在线模型质量（使用离线 stub 与真实宿主 validator，不声称在线验收）。
- 真实 PTY/终端外观、个人配置写、安装/sync/reload（本任务无需改个人环境；也未执行）。

原始日志与临时 probe 均留在仓库外 `/tmp`，未入库。本文件只保留结论。
