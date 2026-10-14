# tmux 实际宿主验证

Pi 1.2.0，已有 CLI 与 tmux；120×40 dark fullscreen，独立 `tmux -L completion-<temp-id>`、env -i、临时 HOME/PI_CODING_AGENT_DIR/cwd/session。只显式加载本仓库 task-composition 与测试 faux provider，不加载个人资源或认证，不联网。

## 首次失败（保留）

`python3 research/tmux/driver.py` exit 1：夹具等待 provider notification 标记超时。实际屏幕已经显示 `✓ general-purpose completed`，session 已持久化 custom_message；faux 收到 normalized transcript，而夹具误用 role custom 判断。产品没有据此修改；改为识别实际 task-notification 内容后重跑。

首次日志 `/tmp/pi-bg/b22c2a84w.log`，证据 root `/var/folders/fx/bn7t1rq16xn7_66t233x_s1h0000gn/T/completion-tmux-mzmuzfid`。

## 重跑

`python3 .trellis/tasks/10-14-subagent-completion-notification/research/tmux/driver.py` exit 0。

- 缺省 description：实际 RPC → child SDK → 完成通知 → 父模型 follow-up PASS。
- 空白 description：同上，description=general-purpose PASS。
- 非法 number description：RPC 返回失败、未多产生完成事件 PASS。
- Ctrl+D 正常退出 exit 0 PASS。

日志 `/tmp/pi-bg/b4hlvqf62.log`，证据 root `/var/folders/fx/bn7t1rq16xn7_66t233x_s1h0000gn/T/completion-tmux-j7jpswak`；screen 是 capture-pane 文本，不是图片。unique server 已停止，owned config/cwd 已删除，ps 检查无测试 CLI/child 残留。

仅最小矩阵；noncooperative stopped group及同步resume由actual factory/manager定向验证，不声称真实provider验证。

最终源码同一脚本重跑五项PASS，exit0：`/tmp/pi-bg/bnbd74yz1.log`，root `completion-tmux-1nqwb4wk`；新增formatter故障通过测试registry注入，实际CLI显示简短warning。提示异常、同步resume和stopped group自动回归覆盖完整；未跑在线模型、物理 IME/mouse、任意主题/plugin 组合。
