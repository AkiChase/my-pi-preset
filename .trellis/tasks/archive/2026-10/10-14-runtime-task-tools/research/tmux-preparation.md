# tmux 夹具准备

准备阶段仅做 Python AST 与 TypeScript transpile 检查，未启动 CLI；实际结果见 [验证报告](tmux-validation-2026-10-15.md)。

夹具保留在原 worktree 的任务 `research/tmux-runtime/`：`provider.ts`、`driver.py`、`worker.py`、后补的 `check-background.py`。源码归档目录不包含这些脚本；不要将下面路径误当成归档内可执行入口。

- 本地 faux provider 决定工具调用，执行后端与 renderer 使用真实产品。
- unique tmux `-L`、env-i、临时 HOME/agent/cwd/logs，禁个人认证、发现资源与网络。
- 覆盖 list 三宽/Ctrl+O、错误、Bash partial→/bg→final、child 完整答案、Monitor wait/Esc/stop/finite；可选零 agent workflow 返回。
- resize 等真实新宽完整 raw frame；等待使用有截止条件，不固定 sleep。
- finally 正常 quit，验证实际 PID／server 退出；残留时不删除配置。

最终 source 验证使用 `--target <source-root>`，命令与结果在 [source 整合验证](source-integration-validation.md)。主题／物理交互等未运行项以最终报告为准。
