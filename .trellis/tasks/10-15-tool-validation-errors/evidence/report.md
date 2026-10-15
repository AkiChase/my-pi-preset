# 验证记录（进行中）

## 已确认
- 用户授权实施本任务、检查通过后本地提交并自行收尾；不包含 push、安装、个人 sync/reload。
- pi-trellis 尚未迁入，跨仓修改 owner 为 `../pi-trellis/lib/subagent-rpc.ts`，迁入任务须包含其最终提交。
- 真宿主 `validateToolArguments`：未知字段拒绝且指出字段；Number+multipleOf:1 拒绝数字/字符串小数，保留整数数字字符串转换；Unicode maxLength 接受160 emoji、拒绝161。
- Bash 真实本地进程：成功/非零/自发 SIGTERM/主动取消、超1MiB输出与手动detach均覆盖；非零恒显退出码，自发信号为失败，主动取消非失败；截断按字节范围而非字符串长度。
- `pnpm typecheck` exit 0；最终本仓全量 `pnpm check` **1036/1036，exit 0**（补修后重跑，非早先结果）。
- agent-tasks 全量自然退出 **230/230**。
- Memory 四工具调用名及 label 均为 lowercase snake_case；63/63，新增schema focused5/5。
- 首次全量 FAIL：retained-child初始化400ticks等待失败；单独9/9，源码和fixture未改，全量复跑949/949 exit0。该PASS早于后续补修，故以补修后的1036/1036为准。
- 独立审查要求补修：agent schema/message/nested resume/可见覆盖值；workflow helper作者错误与最终通知理由；bash signal/byte truncation。Bash与整数输入已补修提交；独立复核已确认原缺陷修复，自然退出36/36与真实宿主fraction/strict-schema probes PASS。该复核纠正了此前“A3需宿主修改”的错误结论。agent/workflow/dispatch剩余正在实现。
- task context初次validate FAIL（此前direct start使用allow-empty）；现已为implement/check各curate开发与测试规范，validate PASS。
- `09aa0af` 收口 agent 准入：五个固定 schema 闭合、空 steering 在副作用前拒绝、nested/root 共享 resume 冲突检查、前台/后台结果文本披露请求值与生效值；独立复核确认，自然退出 16/16。
- `5fbf096` 收口 workflow：helper 校验（文本/集合/边界/嵌套引用）归类为作者错误不再被吞成 null，容忍失败日志带分支/阶段/理由并进入最终文本与通知；新增真实宿主级通知/管理测试。
- 邻仓 `596955a`：dispatch 改普通闭合对象 + 纯校验函数，校验先于 query/FS/RPC；旧 stop 空字段改为拒绝（保留无 RPC/租约仍 running 断言）。定向 47/47、Python 32/32。

## 提交
本仓：`9cf9694`、`f108932`、`10a150c`、`b516d0f`、`19d7701`、`70b87d5`、`3a392dd`、`09aa0af`；邻仓 `596955a`。

## 提交
本仓：`9cf9694`、`f108932`、`10a150c`、`b516d0f`、`19d7701`、`70b87d5`、`3a392dd`、`09aa0af`、`5fbf096`；邻仓 `596955a`。

## 尚未完成
- 邻仓 `npm test` 目前 554/555：`tests/task-browser-ui.test.mjs:870` 子进程 SIGKILL，单独复跑同样失败；已交独立只读调查判断环境/宿主还是产品回归，未改动无关 UI。
- task 归档与 journal（检查通过后自行收尾）。

## NOT_RUN
- 在线模型质量（使用离线stub，不声称在线验收）。
- 真实PTY交互/个人配置写/安装sync/reload（本任务不需改个人环境）。

原始日志与临时probe留在仓库外 `/tmp`；本文件仅保留结论，不收纳完整终端输出。
