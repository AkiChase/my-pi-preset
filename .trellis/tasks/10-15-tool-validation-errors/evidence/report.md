# 验证记录（进行中）

## 已确认
- 用户授权实施本任务、检查通过后本地提交并自行收尾；不包含 push、安装、个人 sync/reload。
- pi-trellis 尚未迁入，跨仓修改 owner 为 `../pi-trellis/lib/subagent-rpc.ts`，迁入任务须包含其最终提交。
- 真宿主 `validateToolArguments`：未知字段拒绝且指出字段；Number+multipleOf:1 拒绝数字/字符串小数，保留整数数字字符串转换；Unicode maxLength 接受160 emoji、拒绝161。
- Bash 真实本地进程：成功/非零/自发 SIGTERM/主动取消、超1MiB输出与手动detach均覆盖；非零恒显退出码，自发信号为失败，主动取消非失败；截断按字节范围而非字符串长度。
- `pnpm typecheck` exit 0；最新主会话 process/runtime/Memory/beautify 自然退出 580/580。
- Memory 四工具调用名及 label 均为 lowercase snake_case；63/63，新增schema focused5/5。
- 首次全量 FAIL：retained-child初始化400ticks等待失败；单独9/9，源码和fixture未改，全量复跑949/949 exit0。该PASS早于后续补修，最终需再跑。
- 独立审查要求补修：agent schema/message/nested resume/可见覆盖值；workflow helper作者错误与最终通知理由；bash signal/byte truncation。Bash与整数输入已补修提交；agent/workflow/dispatch剩余正在实现。
- task context初次validate FAIL（此前direct start使用allow-empty）；现已为implement/check各curate开发与测试规范，validate PASS。

## 提交
本仓：`9cf9694`、`f108932`、`10a150c`、`b516d0f`、`19d7701`、`70b87d5`、`3a392dd`（后续最终提交待补）。

## 尚未完成
- 剩余补修的源码复核、各仓完整回归、最终独立审查、task归档/journal。

## NOT_RUN
- 在线模型质量（使用离线stub，不声称在线验收）。
- 真实PTY交互/个人配置写/安装sync/reload（本任务不需改个人环境）。

原始日志与临时probe留在仓库外 `/tmp`；本文件仅保留结论，不收纳完整终端输出。
